// Release reading for the in-extension updater. This module is the only place
// allowed to reach the network: read-only GETs to the fixed GitHub release
// endpoints, no credentials and no page, roster or message content.
import { releaseRepository } from './release-config.mjs';

export const RELEASE_HOSTS = ['https://api.github.com/', 'https://github.com/', 'https://objects.githubusercontent.com/', 'https://release-assets.githubusercontent.com/'];
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024, MAX_FILES = 200;
const UPDATER_FILES = ['update.cmd', 'update.ps1', 'release.json', 'README.txt'];
const FORBIDDEN_MANIFEST_FIELDS = ['optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable', 'update_url'];

export class UpdaterError extends Error {}

export const releaseAssetName = version => `xiaren-chrome-v${version}.zip`;
export const safeName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);

export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new UpdaterError('版本号格式无法识别');
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

// Only a public, non-draft release published from the configured repository can
// be installed, and only through the two asset URLs GitHub itself publishes.
export function selectRelease(release, currentVersion, repository = releaseRepository) {
  if (!safeName(repository)) throw new UpdaterError('发布仓库尚未配置');
  if (!release || typeof release !== 'object') throw new UpdaterError('无法读取最新发布信息');
  if (release.draft === true || release.prerelease === true) throw new UpdaterError('最新发布不是正式版本');
  const match = /^v(\d+\.\d+\.\d+)$/.exec(String(release.tag_name || ''));
  if (!match) throw new UpdaterError('最新发布的版本号格式无法识别');
  const version = match[1];
  const name = releaseAssetName(version);
  const base = `https://github.com/${repository}/releases/download/${release.tag_name}/`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const find = assetName => assets.filter(asset => asset?.name === assetName && asset.browser_download_url === base + assetName);
  const archive = find(name), checksum = find(`${name}.sha256`);
  if (archive.length !== 1 || checksum.length !== 1) throw new UpdaterError('最新发布缺少安装包或校验文件');
  const upToDate = compareVersions(version, currentVersion) <= 0;
  return { version, tag: release.tag_name, name, upToDate,
    zipUrl: archive[0].browser_download_url, checksumUrl: checksum[0].browser_download_url,
    size: Number.isSafeInteger(archive[0].size) ? archive[0].size : null,
    notes: typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/') ? release.html_url : null };
}

export async function fetchLatestRelease(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${releaseRepository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', redirect: 'follow',
  });
  if (!response.ok) throw new UpdaterError(`读取最新发布失败（HTTP ${response.status}）`);
  return response.json();
}

export async function downloadAsset(url, limit, fetchImpl = globalThis.fetch) {
  if (!RELEASE_HOSTS.some(prefix => String(url).startsWith(prefix))) throw new UpdaterError('下载地址不属于发布仓库');
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new UpdaterError(`下载失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new UpdaterError('下载内容为空');
  if (bytes.length > limit) throw new UpdaterError('下载内容超出大小上限');
  return bytes;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseChecksum(text, name) {
  const line = String(text || '').trim();
  const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
  if (!match) throw new UpdaterError('校验文件格式无效');
  if (match[2].trim() && match[2].trim() !== name) throw new UpdaterError('校验文件与安装包不匹配');
  return match[1].toLowerCase();
}

export async function verifyArchive(bytes, checksumText, name) {
  const expected = parseChecksum(checksumText, name);
  const actual = await sha256Hex(bytes);
  if (actual !== expected) throw new UpdaterError('安装包校验失败，未做任何修改');
  return actual;
}

const signature = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
const u16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const u32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new UpdaterError('当前浏览器不支持解压安装包');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal ZIP reader: the release archive only uses stored or deflated entries
// and never needs ZIP64 or encryption, so anything else is rejected outright.
export async function readArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw new UpdaterError('安装包不是有效的 ZIP 文件');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= 0 && offset >= bytes.length - 66_000; offset--) {
    if (u32(bytes, offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new UpdaterError('安装包不是有效的 ZIP 文件');
  const total = u16(bytes, end + 10), centralSize = u32(bytes, end + 12), centralOffset = u32(bytes, end + 16);
  if (!total || total > MAX_FILES) throw new UpdaterError('安装包文件数量异常');
  if (centralOffset + centralSize > bytes.length) throw new UpdaterError('安装包目录已损坏');
  const files = new Map();
  let cursor = centralOffset, totalBytes = 0;
  for (let index = 0; index < total; index++) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new UpdaterError('安装包目录已损坏');
    const method = u16(bytes, cursor + 10), compressedSize = u32(bytes, cursor + 20), size = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28), extraLength = u16(bytes, cursor + 30), commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (name.includes('\\') || name.includes('..') || name.startsWith('/') || files.has(name)) throw new UpdaterError('安装包包含不安全路径');
    if (u32(bytes, localOffset) !== 0x04034b50) throw new UpdaterError('安装包条目已损坏');
    const dataStart = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
    if (dataStart + compressedSize > bytes.length) throw new UpdaterError('安装包条目已损坏');
    totalBytes += size;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new UpdaterError('安装包解压后超出大小上限');
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = raw.slice();
    else if (method === 8) content = await inflateRaw(raw);
    else throw new UpdaterError('安装包使用了不支持的压缩方式');
    if (content.length !== size) throw new UpdaterError('安装包条目长度不符');
    files.set(name, content);
  }
  return files;
}

// The archive mirrors a release folder. Only the extension tree is installed in
// place; updater scripts, release metadata and the readme stay untouched.
export function planInstall(files, currentManifest) {
  if (!(files instanceof Map) || !files.size) throw new UpdaterError('安装包为空');
  const plan = new Map();
  for (const [name, content] of files) {
    if (UPDATER_FILES.includes(name)) continue;
    if (!name.startsWith('extension/')) throw new UpdaterError('安装包包含未知路径');
    const relative = name.slice('extension/'.length);
    if (!relative || relative.includes('/') && !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(relative)) throw new UpdaterError('安装包包含未知路径');
    if (!/\.(?:mjs|js|html|css|json|png|svg|txt)$/.test(relative)) throw new UpdaterError('安装包包含未知文件类型');
    plan.set(relative, content);
  }
  const manifestBytes = plan.get('manifest.json');
  if (!manifestBytes) throw new UpdaterError('安装包缺少 manifest.json');
  let next;
  try { next = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new UpdaterError('安装包的 manifest.json 无法解析'); }
  validateManifest(next, currentManifest);
  for (const required of ['background.mjs', 'dashboard.html', 'dashboard.mjs', 'update.html', 'updater.mjs', 'release-config.mjs']) {
    if (!plan.has(required)) throw new UpdaterError(`安装包缺少 ${required}`);
  }
  return { files: plan, manifest: next, version: next.version };
}

export function validateManifest(next, current) {
  if (!next || typeof next !== 'object' || !current) throw new UpdaterError('无法核对扩展身份');
  if (next.manifest_version !== 3) throw new UpdaterError('安装包不是 Manifest V3 扩展');
  if (next.name !== current.name) throw new UpdaterError('安装包的扩展名称不一致');
  const version = parseVersion(next.version);
  if (!version) throw new UpdaterError('安装包的版本号格式无效');
  if (compareVersions(next.version, current.version) <= 0) throw new UpdaterError('安装包版本不高于当前版本');
  for (const field of FORBIDDEN_MANIFEST_FIELDS) if (next[field] !== undefined) throw new UpdaterError(`安装包包含不允许的清单字段：${field}`);
  if (JSON.stringify(next.permissions || []) !== JSON.stringify(current.permissions || [])) throw new UpdaterError('安装包申请的权限与当前版本不一致');
  if (JSON.stringify(next.host_permissions || []) !== JSON.stringify(current.host_permissions || [])) throw new UpdaterError('安装包申请的站点权限与当前版本不一致');
  const currentKey = typeof current.key === 'string' ? current.key : '';
  const nextKey = typeof next.key === 'string' ? next.key : '';
  if (currentKey && nextKey && currentKey !== nextKey) throw new UpdaterError('安装包的扩展密钥不一致');
  return true;
}
