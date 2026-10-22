export const IMAGE_ASSET_LIMIT = 20;
export const IMAGE_ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_ASSETS_MAX_BYTES = 4 * 1024 * 1024;

const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const corrupt = () => new Error('本地图片资产损坏或版本不兼容；原数据已保留，请检查备份');
const invalidImage = () => new Error('图片内容或格式无效，请使用完整的PNG或JPEG文件');

export function emptyImageAssets() { return { version: 1, assets: [] }; }

function fileName(value) {
  if (typeof value !== 'string') throw new Error('图片文件名无效');
  let name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 120);
  if (/[\ud800-\udbff]$/.test(name)) name = name.slice(0, -1);
  if (!name) throw new Error('图片文件名不能为空');
  return name;
}

function assetId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error('图片资产ID须为1—100个字符且不含控制字符');
  return value.trim();
}

function validDimensions(width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 20000)) throw new Error('图片宽高须为1—20000像素的整数');
}

export function normalizeImageReference(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.type !== 'image') throw new Error('图片引用无效');
  if (Object.hasOwn(message, 'dataUrl') || Object.hasOwn(message, 'content')) throw new Error('图片引用不能混入图片数据或消息正文');
  const id = assetId(message.assetId), name = fileName(message.name);
  if (typeof message.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(message.sha256)) throw new Error('图片引用摘要须为64位小写SHA-256');
  const mime = message.mime === 'image/jpg' ? 'image/jpeg' : message.mime;
  if (!['image/png', 'image/jpeg'].includes(mime)) throw new Error('图片引用类型仅支持PNG或JPEG');
  if (!Number.isInteger(message.size) || message.size < 1 || message.size >= IMAGE_ASSET_MAX_BYTES) throw new Error('图片引用大小须小于2MiB');
  validDimensions(message.width, message.height);
  return { type: 'image', assetId: id, sha256: message.sha256, name, mime, size: message.size, width: message.width, height: message.height };
}

export function imageReference(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new Error('图片资产引用无效');
  return normalizeImageReference({ type: 'image', assetId: asset.id, sha256: asset.sha256, name: asset.name, mime: asset.mime, size: asset.size, width: asset.width, height: asset.height });
}

function validTime(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('图片创建时间无效');
  return value;
}

function decodeDataUrl(value, mime, size) {
  if (!['image/png', 'image/jpeg'].includes(mime)) throw new Error('图片类型仅支持PNG或JPEG');
  if (!Number.isInteger(size) || size < 1 || size >= IMAGE_ASSET_MAX_BYTES) throw new Error('单张图片大小须小于2MiB');
  const prefix = `data:${mime};base64,`;
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error('图片Data URL与MIME类型不匹配');
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length > Math.ceil((IMAGE_ASSET_MAX_BYTES - 1) / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('图片base64编码无效');
  let binary;
  try { binary = atob(encoded); } catch { throw new Error('图片base64编码无效'); }
  if (btoa(binary) !== encoded) throw new Error('图片base64编码不是规范格式');
  if (binary.length !== size) throw new Error('图片声明大小与实际内容不匹配');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function dimensions(bytes, mime) {
  if (mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 45 || signature.some((byte, index) => bytes[index] !== byte)) throw invalidImage();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let position = 8, width, height, sawData = false;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position), end = position + length + 12;
      if (end > bytes.length) throw invalidImage();
      const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
      if (position === 8) {
        if (type !== 'IHDR' || length !== 13) throw invalidImage();
        width = view.getUint32(position + 8); height = view.getUint32(position + 12);
        if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) throw invalidImage();
      } else if (type === 'IHDR') throw invalidImage();
      if (type === 'IDAT') sawData = true;
      if (type === 'IEND') {
        if (length !== 0 || end !== bytes.length || !sawData) throw invalidImage();
        return { width, height };
      }
      position = end;
    }
    throw invalidImage();
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalidImage();
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let position = 2, result;
  while (position + 1 < bytes.length) {
    if (bytes[position++] !== 0xff) throw invalidImage();
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (!marker || marker === 0xd8 || marker === 0xd9) throw invalidImage();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (position + 2 > bytes.length) throw invalidImage();
    const length = (bytes[position] << 8) | bytes[position + 1], end = position + length;
    if (length < 2 || end > bytes.length - 2) throw invalidImage();
    if (startOfFrame.has(marker)) {
      if (result || length < 8) throw invalidImage();
      const height = (bytes[position + 3] << 8) | bytes[position + 4], width = (bytes[position + 5] << 8) | bytes[position + 6];
      const components = bytes[position + 7];
      if (!width || !height || !components || length !== 8 + components * 3) throw invalidImage();
      result = { width, height };
    }
    if (marker === 0xda) {
      if (!result || end >= bytes.length - 2) throw invalidImage();
      return result;
    }
    position = end;
  }
  throw invalidImage();
}

async function imageFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图片资产内容无效');
  const name = fileName(value.name), bytes = decodeDataUrl(value.dataUrl, value.mime, value.size);
  const shape = dimensions(bytes, value.mime);
  validDimensions(shape.width, shape.height);
  for (const key of ['width', 'height']) if (value[key] !== undefined && value[key] !== shape[key]) throw new Error('图片尺寸与实际文件不匹配');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { name, mime: value.mime, size: bytes.length, sha256, ...shape, dataUrl: value.dataUrl };
}

function capacity(store) {
  return { count: store.assets.length, limit: IMAGE_ASSET_LIMIT, bytes: jsonBytes(store), maxBytes: IMAGE_ASSETS_MAX_BYTES, maxAssetBytes: IMAGE_ASSET_MAX_BYTES };
}

function checkCapacity(store) {
  const size = capacity(store);
  if (size.count > IMAGE_ASSET_LIMIT || size.bytes > IMAGE_ASSETS_MAX_BYTES) throw new Error('图片资产已达到20张或4MiB容量上限；原图片已保留，请减少新增图片');
  return store;
}

export async function readImageAssets(value) {
  if (value === undefined) return emptyImageAssets();
  try {
    if (!value || value.version !== 1 || !Array.isArray(value.assets) || value.assets.length > IMAGE_ASSET_LIMIT || jsonBytes(value) > IMAGE_ASSETS_MAX_BYTES) throw corrupt();
    const assets = [], ids = new Set(), hashes = new Set();
    for (const asset of value.assets) {
      if (!asset || !Number.isInteger(asset.width)) throw corrupt();
      const id = assetId(asset.id);
      if (ids.has(id)) throw corrupt();
      const fields = await imageFields(asset);
      if (!/^[a-f0-9]{64}$/.test(asset.sha256) || asset.sha256 !== fields.sha256 || hashes.has(fields.sha256)) throw corrupt();
      ids.add(id); hashes.add(fields.sha256);
      assets.push({ id, ...fields, createdAt: validTime(asset.createdAt) });
    }
    return checkCapacity({ version: 1, assets });
  } catch { throw corrupt(); }
}

export async function listImageAssets(store) {
  const saved = await readImageAssets(store);
  const assets = saved.assets.map(({ dataUrl, ...metadata }) => metadata).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { version: 1, assets, capacity: capacity(saved) };
}

export async function addImageAsset(store, draft, options = {}) {
  const saved = await readImageAssets(store), fields = await imageFields(draft);
  const existing = saved.assets.find(asset => asset.sha256 === fields.sha256);
  if (existing) return { store: saved, assetId: existing.id, reused: true };
  const { id, now } = options || {};
  const canonicalId = assetId(id);
  if (saved.assets.some(asset => asset.id === canonicalId)) throw new Error('图片资产ID已存在，请刷新后重试');
  const asset = { id: canonicalId, ...fields, createdAt: validTime(now) };
  return { store: checkCapacity({ version: 1, assets: [...saved.assets, asset] }), assetId: canonicalId, reused: false };
}

export async function getImageAsset(store, id) {
  const canonicalId = assetId(id);
  const saved = await readImageAssets(store);
  return saved.assets.find(asset => asset.id === canonicalId) || null;
}
