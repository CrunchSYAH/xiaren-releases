import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IMAGE_ASSET_LIMIT, IMAGE_ASSET_MAX_BYTES, IMAGE_ASSETS_MAX_BYTES, emptyImageAssets, readImageAssets, listImageAssets, addImageAsset, getImageAsset } from '../extension/core/image-assets.mjs';
import * as imageAssets from '../extension/core/image-assets.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSj8AAAAASUVORK5CYII=', 'base64');
// A 2 x 3 JPEG generated once in memory with Windows GDI; tests need no decoder.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==', 'base64');
const draft = (bytes = png, mime = 'image/png', extra = {}) => ({ name: '邀请图片.png', mime, size: bytes.length, dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, ...extra });
const add = (store, bytes = png, id = 'asset-1', extra = {}, now = 1000) => addImageAsset(store, draft(bytes, bytes === jpeg ? 'image/jpeg' : 'image/png', extra), { id, now });
const bytesOf = value => Buffer.byteLength(JSON.stringify(value));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function withText(text) {
  const payload = Buffer.from(`note\0${text}`), chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); chunk.write('tEXt', 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
const paddedPNG = (size, character = 'x') => withText(character.repeat(size - png.length - 17));

test('空资产不共享引用，缺失旧键只返回空副本，导出常量与容量一致', async () => {
  assert.deepEqual(await readImageAssets(undefined), { version: 1, assets: [] });
  assert.notEqual(emptyImageAssets().assets, emptyImageAssets().assets);
  assert.equal(IMAGE_ASSET_LIMIT, 20);
  assert.equal(IMAGE_ASSET_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(IMAGE_ASSETS_MAX_BYTES, 4 * 1024 * 1024);
  const list = await listImageAssets(emptyImageAssets());
  assert.deepEqual(list.assets, []);
  assert.deepEqual(list.capacity, { count: 0, limit: 20, maxAssetBytes: 2097152, maxBytes: 4194304, bytes: bytesOf(emptyImageAssets()) });
});

test('添加PNG自行计算摘要和尺寸，清理文件名且不信调用者提供的摘要', async () => {
  const empty = emptyImageAssets();
  const result = await add(empty, png, 'asset-1', { name: ' \n邀请\u0000图片.png\t ', sha256: '0'.repeat(64) });
  assert.equal(result.assetId, 'asset-1');
  assert.equal(result.reused, false);
  assert.deepEqual(empty, emptyImageAssets());
  const asset = result.store.assets[0];
  assert.deepEqual(asset, { id: 'asset-1', name: '邀请图片.png', mime: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex'), width: 1, height: 1, dataUrl: draft().dataUrl, createdAt: 1000 });
  assert.equal((await add(empty, png, 'long', { name: '图'.repeat(130) })).store.assets[0].name.length, 120);
  assert.equal((await add(empty, jpeg, 'jpeg')).store.assets[0].mime, 'image/jpeg');
});

test('真实JPEG头解析出尺寸，提供的尺寸必须与文件一致且不能伪造', async () => {
  const result = await add(emptyImageAssets(), jpeg, 'jpeg', { name: '邀请.jpg', width: 2, height: 3 });
  assert.equal(result.store.assets[0].width, 2);
  assert.equal(result.store.assets[0].height, 3);
  for (const extra of [{ width: 9 }, { height: 9 }, { width: 0 }, { height: '3' }]) await assert.rejects(add(emptyImageAssets(), jpeg, 'jpeg', extra), /尺寸|宽|高/);
});

test('列表仅返回元数据，get与read返回完整独立副本', async () => {
  const { store } = await add(emptyImageAssets());
  const before = structuredClone(store);
  const list = await listImageAssets(store);
  assert.equal(list.version, 1);
  assert.equal(Object.hasOwn(list.assets[0], 'dataUrl'), false);
  assert.equal(JSON.stringify(list).includes('base64'), false);
  assert.equal(list.capacity.bytes, bytesOf(store));
  const asset = await getImageAsset(store, 'asset-1');
  assert.equal(asset.dataUrl, draft().dataUrl);
  asset.name = '修改'; list.assets[0].sha256 = '外部修改';
  const copy = await readImageAssets(store); copy.assets[0].dataUrl = '';
  assert.deepEqual(store, before);
  assert.equal(await getImageAsset(store, 'missing'), null);
});

test('同摘要图片复用已有ID和原元数据，读取后的重复仍能识别', async () => {
  const { store } = await add(emptyImageAssets());
  const result = await add(await readImageAssets(JSON.parse(JSON.stringify(store))), png, 'another', { name: '新名字.png' }, 5000);
  assert.equal(result.assetId, 'asset-1');
  assert.equal(result.reused, true);
  assert.deepEqual(result.store, store);
  result.store.assets[0].name = '外部修改';
  assert.equal(store.assets[0].name, '邀请图片.png');
});

test('仅允许PNG和JPEG，MIME、Data URL、实际magic及声明size必须一致', async () => {
  const invalid = [
    { mime: 'image/gif' }, { mime: 'image/jpg' }, { mime: 'image/jpeg' }, { size: png.length + 1 }, { size: 0 }, { size: '1' },
    { dataUrl: draft(jpeg, 'image/png').dataUrl }, { dataUrl: 'data:image/png;base64,' }, { dataUrl: 'data:image/png;charset=utf-8;base64,' + png.toString('base64') },
    { dataUrl: draft(Buffer.from('not-an-image')).dataUrl, size: 12 }, { dataUrl: draft(png.subarray(0, 16)).dataUrl, size: 16 },
  ];
  for (const extra of invalid) await assert.rejects(add(emptyImageAssets(), png, 'bad', extra), /图片|格式|类型|大小|内容|MIME|base64/);
});

test('base64严格拒绝空白、URL编码、错误padding和非规范尾位', async () => {
  const base64 = png.toString('base64');
  for (const value of [base64 + '\n', base64.slice(0, 8) + ' ' + base64.slice(8), base64.replace('=', ''), base64 + '=', 'AA=A', 'AAAA====', base64.replace(/=$/, '%3D'), base64.slice(0, -2) + 'J=']) {
    await assert.rejects(add(emptyImageAssets(), png, 'bad', { dataUrl: `data:image/png;base64,${value}` }), /base64|编码|图片/);
  }
});

test('单张必须小于2MiB，临界减一可存，临界及更大均拒绝', async () => {
  const below = paddedPNG(IMAGE_ASSET_MAX_BYTES - 1);
  assert.equal((await add(emptyImageAssets(), below)).store.assets[0].size, IMAGE_ASSET_MAX_BYTES - 1);
  for (const size of [IMAGE_ASSET_MAX_BYTES, IMAGE_ASSET_MAX_BYTES + 1]) await assert.rejects(add(emptyImageAssets(), paddedPNG(size)), /2MiB|大小|上限/);
});

test('20张容量满拒绝新增但重复hash可复用，不淘汰现有图片', async () => {
  let store = emptyImageAssets();
  for (let index = 0; index < 20; index++) store = (await add(store, withText(String(index)), `asset-${index}`)).store;
  const before = structuredClone(store);
  await assert.rejects(add(store, withText('overflow'), 'overflow'), /20|容量|上限/);
  assert.deepEqual(store, before);
  const duplicate = await add(store, withText('0'), 'new');
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.assetId, 'asset-0');
  assert.equal(duplicate.store.assets.length, 20);
});

test('JSON总量以UTF-8字节限制4MiB，超限拒绝且原数据完整保留', async () => {
  const { store } = await add(emptyImageAssets(), paddedPNG(1600000, 'a'), 'first');
  const before = structuredClone(store);
  await assert.rejects(add(store, paddedPNG(1600000, 'b'), 'second'), /4MiB|容量|上限/);
  assert.deepEqual(store, before);
  assert.ok((await listImageAssets(store)).capacity.bytes < IMAGE_ASSETS_MAX_BYTES);
});

test('损坏数据、篡改摘要或重复标识不覆盖原值，缺失和非法参数明确拒绝', async () => {
  const { store } = await add(emptyImageAssets());
  const invalid = [null, {}, { version: 2, assets: [] }, { version: 1, assets: {} }, { version: 1, assets: new Array(1) },
    { version: 1, assets: [store.assets[0], store.assets[0]] }];
  for (const extra of [{ sha256: '0'.repeat(64) }, { width: 2 }, { height: 2 }, { size: 1 }, { createdAt: -1 }, { dataUrl: draft(withText('tampered')).dataUrl }]) invalid.push({ version: 1, assets: [{ ...store.assets[0], ...extra }] });
  for (const value of invalid) {
    const before = structuredClone(value);
    await assert.rejects(readImageAssets(value), /图片资产.*损坏|版本.*不兼容/);
    assert.deepEqual(value, before);
  }
  for (const extra of [{ name: '\u0000\n ' }, { name: null }]) await assert.rejects(add(emptyImageAssets(), png, 'id', extra), /文件名|名称/);
  for (const now of [-1, NaN, Infinity, undefined]) await assert.rejects(addImageAsset(emptyImageAssets(), draft(), { id: 'new', now }), /时间/);
  for (const id of ['', '  ', null]) await assert.rejects(add(emptyImageAssets(), withText('new'), id), /标识|ID/);
  await assert.rejects(add(store, withText('different'), 'asset-1'), /标识|ID|已存在/);
  assert.equal((await add(emptyImageAssets(), png, '__proto__', {}, 0)).store.assets[0].createdAt, 0);
});

test('图片引用同步返回唯一规范形状，JPG别名归一且不携带数据正文', async () => {
  assert.equal(typeof imageAssets.normalizeImageReference, 'function');
  assert.equal(typeof imageAssets.imageReference, 'function');
  const { store } = await add(emptyImageAssets(), jpeg, 'jpeg');
  const asset = store.assets[0], expected = { type: 'image', assetId: 'jpeg', sha256: asset.sha256, name: asset.name, mime: 'image/jpeg', size: asset.size, width: 2, height: 3 };
  const reference = imageAssets.imageReference(asset);
  assert.deepEqual(reference, expected);
  assert.equal(reference instanceof Promise, false);
  assert.equal(JSON.stringify(reference).includes('base64'), false);
  const canonical = imageAssets.normalizeImageReference({ ...reference, assetId: ' jpeg ', name: ' \n名称\u0000.jpg ', mime: 'image/jpg', extra: '剥离' });
  assert.deepEqual(canonical, { ...expected, assetId: 'jpeg', name: '名称.jpg' });
  canonical.name = '变化';
  assert.equal(asset.name, '邀请图片.png');
});

test('图片引用拒绝缺字段、无效摘要、尺寸、类型、ID以及混入消息正文', async () => {
  assert.equal(typeof imageAssets.normalizeImageReference, 'function');
  const { store } = await add(emptyImageAssets()), valid = { type: 'image', assetId: 'asset-1', ...store.assets[0] };
  delete valid.id; delete valid.dataUrl; delete valid.createdAt;
  for (const extra of [{ type: 'text' }, { assetId: '' }, { assetId: '\nasset' }, { assetId: 'x'.repeat(101) }, { sha256: 'A'.repeat(64) }, { sha256: 'bad' }, { mime: 'image/gif' }, { size: 0 }, { size: 2097152 }, { size: 1.5 }, { width: 0 }, { width: 20001 }, { height: null }, { height: 20001 }, { dataUrl: undefined }, { content: undefined }, { content: 'base64' }]) {
    assert.throws(() => imageAssets.normalizeImageReference({ ...valid, ...extra }), /图片|引用|尺寸|标识|ID|摘要|正文/);
  }
  for (const key of ['assetId', 'sha256', 'name', 'mime', 'size', 'width', 'height']) {
    const missing = { ...valid }; delete missing[key];
    assert.throws(() => imageAssets.normalizeImageReference(missing), /图片|引用|尺寸|标识|ID|摘要|正文/);
  }
  assert.throws(() => imageAssets.normalizeImageReference(null), /图片|引用/);
});

test('资产ID与实际尺寸符合引用边界，读取旧损坏metadata时不静默补造必填宽度', async () => {
  for (const id of ['\nasset', 'x'.repeat(101)]) await assert.rejects(add(emptyImageAssets(), png, id), /ID|标识/);
  const trimmed = await add(emptyImageAssets(), png, ' asset ');
  assert.equal(trimmed.assetId, 'asset');
  const missing = structuredClone(trimmed.store); delete missing.assets[0].width;
  await assert.rejects(readImageAssets(missing), /图片资产.*损坏/);
  const tooWide = Buffer.from(png); tooWide.writeUInt32BE(20001, 16);
  await assert.rejects(add(emptyImageAssets(), tooWide), /图片|尺寸/);
});

test('资产JSON恰4MiB可保存，超出一字节拒绝而不删除既有图片', async () => {
  const first = (await add(emptyImageAssets(), paddedPNG(1500000, 'a'), 'first')).store;
  const initial = await add(first, paddedPNG(1500000, 'b'), 'second');
  const gap = IMAGE_ASSETS_MAX_BYTES - bytesOf(initial.store);
  const adjustedBytes = paddedPNG(1500000 + Math.floor(gap / 4) * 3, 'b');
  const adjusted = await add(first, adjustedBytes, 'second');
  const remaining = IMAGE_ASSETS_MAX_BYTES - bytesOf(adjusted.store);
  const id = 'second' + 'x'.repeat(remaining);
  const exact = await add(first, adjustedBytes, id);
  assert.equal(bytesOf(exact.store), IMAGE_ASSETS_MAX_BYTES);
  assert.equal((await listImageAssets(exact.store)).capacity.bytes, IMAGE_ASSETS_MAX_BYTES);
  const before = structuredClone(first);
  await assert.rejects(add(first, adjustedBytes, id + 'x'), /容量|上限/);
  assert.deepEqual(first, before);
});
