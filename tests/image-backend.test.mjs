import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';
import { emptyImageAssets, addImageAsset } from '../extension/core/image-assets.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSj8AAAAASUVORK5CYII=', 'base64');
const draft = (extra = {}) => ({ name: '仅资产图片.png', mime: 'image/png', size: png.length, dataUrl: `data:image/png;base64,${png.toString('base64')}`, ...extra });
const turn = () => new Promise(resolve => setImmediate(resolve));
function variantPNG(index) {
  const payload = Buffer.from(`note\0variant-${index}`), chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); chunk.write('tEXt', 4); payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

function fixture(seed = {}) {
  let data = structuredClone(seed), clock = 1000, sequence = 0, failWrite = null, failRead = null;
  const activity = { sessionReads: 0, sessionWrites: 0, pageReads: 0, injections: 0 }, reads = [], writes = [];
  const api = {
    runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` },
    storage: { local: {
      get: async keys => { const names = typeof keys === 'string' ? [keys] : keys; reads.push([...names]); if (failRead?.(names)) throw new Error('disk'); return Object.fromEntries(names.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])); },
      set: async values => { writes.push(Object.keys(values)); if (failWrite?.(values)) throw new Error('disk'); data = { ...data, ...structuredClone(values) }; },
    }, session: { get: async () => { activity.sessionReads++; return { creatorBrowserSession: 'browser' }; }, set: async () => { activity.sessionWrites++; } } },
    tabs: { get: async () => ({ url: 'https://seller.shopee.co.id/', status: 'complete' }) },
    scripting: { executeScript: async () => { activity.injections++; return []; } },
  };
  const sender = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const backend = createBackend(api, { now: () => clock, uid: () => `image-${++sequence}`, readSnapshot: async () => { activity.pageReads++; throw new Error('图片接口不得读取页面'); } });
  const call = (type, body = {}, from = sender) => backend.handle({ type, ...body }, from);
  return { api, sender, call, data: () => data, reads, writes, activity: () => ({ ...activity }), failWrite: predicate => { failWrite = predicate; }, failRead: predicate => { failRead = predicate; }, advance: ms => { clock += ms; } };
}

function pausedFixture(stale = false, extra = {}) {
  return fixture({ creatorQueue: { version: 1, task: {
    id: 'paused-task', sessionId: null, binding: { tabId: 7, pageId: 'page' }, status: 'paused', reason: '用户暂停', createdAt: 100, updatedAt: 500, nextAt: 1000,
    config: { shop: { id: '10', name: '示例店铺' }, template: '不应改动 {{name}}', productLink: 'https://example.com/product', intervalSeconds: 30, limit: 1, mode: 'send' },
    items: [{ id: '20', name: '达人', status: 'pending', reason: null, messages: ['不应改动 达人', 'https://example.com/product'], messageIndex: 1, submittedCount: 1, authorized: false }],
  }, history: { '10': { '20': { status: 'uncertain', taskId: 'paused-task', submittedCount: 1 } } }, denied: { '10': { '21': { name: '拒绝记录' } } } },
  creatorWorkspace: { browserSessionId: stale ? 'previous-browser' : 'browser', tabId: 7, pageId: 'page', documentId: 'doc', documentEpoch: 123, shop: { id: '10', name: '示例店铺' }, creators: [], lastSeen: 1000 }, ...extra });
}

function businessState(f) {
  return Object.fromEntries(['creatorQueue', 'creatorWorkspace', 'creatorDiagnostics'].map(key => [key, structuredClone(f.data()[key])]));
}

test('冷后台图片列表只读独立旧键，缺失时不初始化、不写空值或诊断', async () => {
  const f = fixture();
  const reply = await f.call('panel:image-list');
  assert.deepEqual(reply.imageAssets.assets, []);
  assert.equal(reply.imageAssets.capacity.limit, 20);
  assert.equal(reply.imageAssets.capacity.maxBytes, 4 * 1024 * 1024);
  assert.deepEqual(f.reads, [['creatorImageAssets']]);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.activity(), { sessionReads: 0, sessionWrites: 0, pageReads: 0, injections: 0 });
  assert.deepEqual(f.data(), {});
});

test('冷后台陈旧会话的暂停任务不被图片添加读取改变，列表不带正文而get返回完整资产', async () => {
  const f = pausedFixture(true), before = businessState(f);
  f.advance(60000);
  const saved = await f.call('panel:image-add', { draft: draft({ sha256: '0'.repeat(64) }) });
  assert.equal(saved.reused, false);
  assert.equal(saved.assetId, saved.imageAsset.id);
  assert.equal(saved.imageAsset.dataUrl, draft().dataUrl);
  assert.notEqual(saved.imageAsset.sha256, '0'.repeat(64));
  assert.equal(saved.imageAssets.assets.length, 1);
  assert.equal(Object.hasOwn(saved.imageAssets.assets[0], 'dataUrl'), false);
  const got = await f.call('panel:image-get', { assetId: saved.assetId });
  assert.deepEqual(got.imageAsset, saved.imageAsset);
  assert.equal((await f.call('panel:image-list')).imageAssets.assets[0].id, saved.assetId);
  assert.deepEqual(businessState(f), before);
  assert.deepEqual(f.activity(), { sessionReads: 0, sessionWrites: 0, pageReads: 0, injections: 0 });
  assert.ok(f.reads.every(keys => keys.length === 1 && keys[0] === 'creatorImageAssets'));
  assert.ok(f.writes.every(keys => keys.length === 1 && keys[0] === 'creatorImageAssets'));
});

test('已初始化暂停任务中的图片成功与失败操作均不写诊断或改变业务状态', async () => {
  const f = pausedFixture();
  await f.call('panel:get'); await turn();
  const before = businessState(f), activity = f.activity(), firstWrite = f.writes.length;
  f.advance(60000);
  const saved = await f.call('panel:image-add', { draft: draft() });
  await f.call('panel:image-list');
  await f.call('panel:image-get', { assetId: saved.assetId });
  await assert.rejects(f.call('panel:image-get', { assetId: 'missing' }), /图片|资产|不存在/);
  await assert.rejects(f.call('panel:image-add', { draft: draft({ size: 1 }) }), /图片|大小|格式/);
  await turn();
  assert.deepEqual(businessState(f), before);
  assert.deepEqual(f.activity(), activity);
  assert.ok(f.writes.slice(firstWrite).every(keys => keys.length === 1 && keys[0] === 'creatorImageAssets'));
  const diagnostics = JSON.stringify((await f.call('panel:export-diagnostics')).diagnostics);
  for (const value of [draft().name, draft().dataUrl, saved.imageAsset.sha256, 'image-add', 'image-get']) assert.equal(diagnostics.includes(value), false, value);
});

test('冷后台及已初始化后的精确权限拒绝均先于存储和业务操作', async () => {
  for (const initialized of [false, true]) {
    const f = pausedFixture();
    if (initialized) { await f.call('panel:get'); await turn(); }
    const before = structuredClone(f.data()), activity = f.activity(), readCount = f.reads.length, writeCount = f.writes.length;
    for (const from of [{ ...f.sender, id: 'other' }, { ...f.sender, url: f.api.runtime.getURL('history.html') }, { ...f.sender, url: `${f.sender.url}?x=1` }, { ...f.sender, url: 'https://example.com/dashboard.html' }]) {
      for (const type of ['panel:image-list', 'panel:image-add', 'panel:image-get']) await assert.rejects(f.call(type, { draft: draft(), assetId: 'missing' }, from), /工作台|允许/);
    }
    await turn();
    assert.equal(f.reads.length, readCount);
    assert.equal(f.writes.length, writeCount);
    assert.deepEqual(f.activity(), activity);
    assert.deepEqual(f.data(), before);
  }
});

test('资产存储损坏和未知版本保留原值，校验失败不设置业务故障', async () => {
  const { store } = await addImageAsset(emptyImageAssets(), draft(), { id: 'stored', now: 1000 });
  for (const value of [null, { version: 2, assets: [] }, { version: 1, assets: 'broken' }, { version: 1, assets: [{ ...store.assets[0], sha256: '0'.repeat(64) }] }]) {
    const f = pausedFixture(false, { creatorImageAssets: value }), before = structuredClone(f.data());
    for (const type of ['panel:image-list', 'panel:image-add', 'panel:image-get']) await assert.rejects(f.call(type, { draft: draft(), assetId: 'missing' }), /图片资产.*损坏|版本.*不兼容/);
    assert.deepEqual(f.data(), before);
    assert.equal(f.writes.length, 0);
    assert.equal(f.activity().sessionReads, 0);
    assert.equal((await f.call('panel:get')).state.task.status, 'paused');
  }
});

test('图片写盘或读取失败保留旧资产且允许直接重试，不锁住普通任务接口', async () => {
  const f = fixture(), before = structuredClone(f.data());
  f.failWrite(values => Object.hasOwn(values, 'creatorImageAssets'));
  await assert.rejects(f.call('panel:image-add', { draft: draft() }), /图片|资产|保存|存储/);
  assert.deepEqual(f.data(), before);
  f.failWrite(null);
  const saved = await f.call('panel:image-add', { draft: draft() });
  const snapshot = structuredClone(f.data());
  f.failRead(keys => keys.includes('creatorImageAssets'));
  await assert.rejects(f.call('panel:image-list'), /图片|资产|读取|存储/);
  assert.deepEqual(f.data(), snapshot);
  f.failRead(null);
  assert.equal((await f.call('panel:image-get', { assetId: saved.assetId })).imageAsset.id, saved.assetId);
  assert.equal((await f.call('panel:get')).state.task, null);
});

test('并发添加相同图片复用最初资产，名称和创建时间不被后一次覆盖', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.call('panel:image-add', { draft: draft() }), f.call('panel:image-add', { draft: draft({ name: '另一个文件名.png' }) })]);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.assetId, first.assetId);
  assert.deepEqual(second.imageAsset, first.imageAsset);
  assert.equal(f.data().creatorImageAssets.assets.length, 1);
  assert.ok(f.writes.every(keys => keys.length === 1 && keys[0] === 'creatorImageAssets'));
});

test('已有未落盘日志不由图片接口成功、失败或权限拒绝触发刷新', async () => {
  const f = pausedFixture();
  f.failWrite(values => Object.hasOwn(values, 'creatorDiagnostics'));
  await f.call('panel:get'); await turn();
  f.failWrite(null); f.advance(6000);
  const before = businessState(f), activity = f.activity(), firstWrite = f.writes.length;
  const saved = await f.call('panel:image-add', { draft: draft() });
  await f.call('panel:image-list');
  await f.call('panel:image-get', { assetId: saved.assetId });
  await assert.rejects(f.call('panel:image-get', { assetId: 'missing' }), /图片|资产|不存在/);
  await assert.rejects(f.call('panel:image-add', { draft: draft({ dataUrl: 'bad' }) }), /图片|格式|类型/);
  await assert.rejects(f.call('panel:image-list', {}, { ...f.sender, id: 'other' }), /工作台|允许/);
  await turn();
  assert.deepEqual(businessState(f), before);
  assert.deepEqual(f.activity(), activity);
  assert.ok(f.writes.slice(firstWrite).every(keys => keys.length === 1 && keys[0] === 'creatorImageAssets'));
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.equal(report.persistence.unsaved, true);
  assert.equal(report.events.some(event => event.event === 'operation:error'), false);
});

test('业务写盘已故障时图片读取添加仍可用，不能解除原业务故障', async () => {
  const f = fixture();
  f.failWrite(values => Object.hasOwn(values, 'creatorQueue'));
  await assert.rejects(f.call('panel:pause'), /存储|保存/);
  await turn(); f.failWrite(null);
  const before = businessState(f), activity = f.activity();
  const saved = await f.call('panel:image-add', { draft: draft() });
  assert.equal((await f.call('panel:image-list')).imageAssets.assets.length, 1);
  assert.equal((await f.call('panel:image-get', { assetId: saved.assetId })).imageAsset.id, saved.assetId);
  assert.deepEqual(businessState(f), before);
  assert.deepEqual(f.activity(), activity);
  await assert.rejects(f.call('panel:get'), /存储|保存/);
});

test('图片容量失败只拒绝新增，保留全部旧资产和暂停任务', async () => {
  let store = emptyImageAssets();
  for (let index = 0; index < 20; index++) {
    const bytes = variantPNG(index);
    store = (await addImageAsset(store, draft({ size: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }), { id: `saved-${index}`, now: 1000 })).store;
  }
  const f = pausedFixture(true, { creatorImageAssets: store }), before = structuredClone(f.data());
  const bytes = variantPNG(30);
  await assert.rejects(f.call('panel:image-add', { draft: draft({ size: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }) }), /容量|上限|20/);
  assert.deepEqual(f.data(), before);
  assert.equal(f.writes.length, 0);
  assert.equal(f.activity().sessionReads, 0);
});

test('一次图片请求只全量校验资产库一遍，列表取图走已验证投影，新增只额外校验新图', async () => {
  let store = emptyImageAssets();
  for (const index of [1, 2, 3]) {
    const bytes = variantPNG(index);
    store = (await addImageAsset(store, { name: `图${index}.png`, mime: 'image/png', size: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }, { id: `stored-${index}`, now: 1000 + index })).store;
  }
  const f = pausedFixture(false, { creatorImageAssets: store });
  const original = crypto.subtle.digest;
  let digests = 0;
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: (...args) => { digests++; return original.apply(crypto.subtle, args); } });
  try {
    digests = 0; await f.call('panel:image-list');
    assert.equal(digests, 3, '列表只校验一遍资产库');
    digests = 0; await f.call('panel:image-get', { assetId: 'stored-2' });
    assert.equal(digests, 3, '取图只校验一遍资产库');
    const added = variantPNG(4);
    digests = 0;
    const reply = await f.call('panel:image-add', { draft: { name: '新图.png', mime: 'image/png', size: added.length, dataUrl: `data:image/png;base64,${added.toString('base64')}` } });
    assert.equal(digests, 4, '新增只额外校验新图片');
    assert.equal(reply.reused, false);
    assert.equal(reply.imageAssets.assets.length, 4);
  } finally { delete crypto.subtle.digest; }
});
