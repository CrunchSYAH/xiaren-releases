import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createBackend } from '../extension/core/backend.mjs';
import { affiliateDetailUrl } from '../extension/core/affiliate-resolver.mjs';
import { addImageAsset, imageReference } from '../extension/core/image-assets.mjs';
const code = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const store = (await addImageAsset(undefined, { name: 'fixture.png', mime: 'image/png', size: 68, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n9sAAAAASUVORK5CYII=' }, { id: 'fixture-image', now: 1 })).store;

async function runner({ mode = 'send', pauseAfterFirst = false, failAt = 0, shopDelay = 0 } = {}) {
  let data = { creatorImageAssets: store }, now = 1000, counter = 0, epoch = 123, ctx, backend, url = affiliateDetailUrl('100'), value = '', chat = null, stopped = false;
  let pendingShopReads = 0;
  const timers = [], submissions = [], opened = [], events = [], failures = [];
  const mappings = { '100': '20', '200': '21' }, panel = { id: 'demo', url: 'chrome-extension://demo/dashboard.html' };
  const snapshot = () => {
    const affiliateId = new URL(url).searchParams.get('affiliate_id'), id = mappings[affiliateId];
    return { origin: 'https://seller.shopee.co.id', path: new URL(url).pathname, documentEpoch: epoch, shop: { id: '10', name: '测试店铺' }, creators: [{ id, name: `测试${affiliateId}`, affiliateId, rowKey: affiliateId, chatAvailable: true }], blocked: false, list: { supported: true, hasMore: false, loading: false }, chat: chat ? { ...structuredClone(chat), editorText: value } : null,
      affiliateEvidence: { origin: 'https://seller.shopee.co.id', path: new URL(url).pathname, documentEpoch: epoch, shop: { id: '10' }, status: 'verified', blocked: false, affiliate: { affiliateId, shopeeUserId: id, name: `测试${affiliateId}`, username: `demo${affiliateId}`, chatAvailable: true } } };
  };
  const call = (type, body = {}) => backend.handle({ type, ...body }, panel);
  function injectContent() {
    const boundEpoch = epoch, boundUrl = url;
    const editor = { get value() { return value; }, dispatchEvent() {}, isConnected: true }, send = { isConnected: true };
    ctx = vm.createContext({ crypto: { randomUUID: () => `page-${boundEpoch}` }, location: { origin: 'https://seller.shopee.co.id' }, navigator: { onLine: true }, document: { visibilityState: 'visible', querySelectorAll() { throw new Error('不能在隔离世界自行找目标'); }, querySelector: s => s.includes('textarea') ? editor : send }, HTMLTextAreaElement: function () {}, Event: class {}, addEventListener() {}, clearTimeout() {}, setTimeout(fn, ms) { if (ms < 1000) queueMicrotask(fn); else timers.push(fn); }, chrome: { runtime: { sendMessage: async message => {
      events.push(message);
      try {
        const reply = await backend.handle(message, { id: 'demo', frameId: 0, tab: { id: 7 }, documentId: `doc-${boundEpoch}`, url: boundUrl });
        if (pauseAfterFirst && !stopped && message.type === 'page:commit' && submissions.length === 1) { stopped = true; await call('panel:pause'); }
        return { ok: true, ...reply };
      } catch (error) { return { ok: false, error: error.message }; }
    } } } });
    Object.defineProperty(ctx.HTMLTextAreaElement.prototype, 'value', { set(v) { value = v; } });
    vm.runInContext(code, ctx);
  }
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async () => structuredClone(data), set: async v => { data = { ...data, ...structuredClone(v) }; } }, session: { get: async () => ({ creatorBrowserSession: 'b' }) } }, tabs: { create: async () => ({ id: 7 }), get: async () => ({ url }), update: async (_tab, opts) => {
    if (!opts.url) return;
    assert.equal(data.creatorWorkspace.navigation.url, opts.url);
    url = opts.url; pendingShopReads = shopDelay;
    setImmediate(() => void (async () => { await backend.onUpdated(7, { url, status: 'loading' }); epoch++; value = ''; chat = null; await backend.onUpdated(7, { status: 'complete' }); })().catch(error => failures.push(error)));
  } }, scripting: { executeScript: async details => {
    if (details.files) injectContent();
    else if (details.func && details.func.name !== 'affiliateResolverPage' && ctx) vm.runInContext(`(${details.func.toString()})()`, ctx);
    return [];
  } } };
  backend = createBackend(api, { now: () => now, uid: () => `id-${++counter}`, readSnapshot: async (_tab, _text, documentId, commit, action) => {
    assert.equal(documentId, `doc-${epoch}`);
    if (action?.type === 'open-chat') { opened.push(action.creator.id); value = ''; chat = { shopId: '10', recipientId: action.creator.id, editorFound: true, sendFound: true, sendReady: true, imageSupported: true, mediaCount: 0, replyCount: 0 }; }
    if (action?.type === 'stage-image') { assert.equal(data.creatorWorkspace.imageDraft.token, action.token); chat.mediaCount = 1; chat.imageDraft = { token: action.token, taskId: action.taskId, itemId: action.itemId, messageIndex: action.messageIndex, assetId: action.asset.assetId, sha256: action.asset.sha256, ready: true }; }
    const p = snapshot();
    if (pendingShopReads > 0) {
      pendingShopReads--;
      p.shop = null; p.creators = [];
      p.affiliateEvidence = { ...p.affiliateEvidence, shop: null, affiliate: null, status: 'blocked', reason: 'shop-unavailable' };
    }
    if (action) p.listAction = { performed: true };
    if (commit) {
      assert.equal(data.creatorWorkspace.receipt.claimed, true); assert.equal(commit.roster.affiliate.documentEpoch, epoch);
      assert.equal(commit.roster.affiliate.shopeeUserId, commit.itemId); assert.equal(commit.roster.affiliate.affiliateId, new URL(url).searchParams.get('affiliate_id'));
      submissions.push({ id: commit.itemId, text: value, image: !!commit.image });
      if (submissions.length === failAt) throw new Error('fixture click unknown');
      value = ''; chat.mediaCount = 0; chat.imageDraft = null; p.commit = { clicked: true };
    }
    return p;
  } });
  await call('panel:open', { source: { type: 'affiliates', affiliateIds: ['100', '200'] } }); await backend.onUpdated(7, { status: 'complete' }); await turn(); await turn();
  const tick = async () => { now += 1100; await timers.shift()?.(); await turn(); await turn(); assert.equal(failures.length, 0, failures[0]?.message); };
  await call('panel:collect', { targetCount: 2, source: { type: 'affiliates', affiliateIds: ['100', '200'] } });
  for (let i = 0; i < 15 && data.creatorWorkspace.collection.status === 'collecting'; i++) await tick();
  assert.equal(data.creatorWorkspace.collection.status, 'ready');
  const c = data.creatorWorkspace.collection, config = { shop: snapshot().shop, creators: c.creators, source: c.source, messages: [imageReference(store.assets[0]), { type: 'text', content: 'Halo {{name}}' }, { type: 'link', content: 'https://shopee.co.id/product/1/2' }], intervalSeconds: 1, limit: 2, targetCount: 2, collectionId: c.id, mode };
  const p = await call('panel:preview', { config }); await call('panel:start', { config, previewToken: p.previewToken, confirmed: mode === 'send' });
  return { tick, call, data: () => data, submissions, opened, events };
}

test('实际执行器跨官方详情文档按联盟伙伴输入顺序完成三条混排，每条独立授权提交', async () => {
  const f = await runner();
  for (let i = 0; i < 30 && f.data().creatorQueue.task.status === 'running'; i++) await f.tick();
  assert.equal(f.data().creatorQueue.task.status, 'completed'); assert.deepEqual(f.opened, ['20', '21']);
  assert.deepEqual(f.submissions.map(s => s.id), ['20', '20', '20', '21', '21', '21']);
  assert.deepEqual(f.submissions.map(s => s.image), [true, false, false, true, false, false]);
  assert.equal(f.events.filter(e => e.type === 'page:authorize').length, 6);
});

test('实际执行器等待每次新详情店铺延迟加载后，仍按原序完成逐条核对且演练零填入零提交', async () => {
  const f = await runner({ mode: 'dry-run', shopDelay: 2 });
  for (let i = 0; i < 30 && f.data().creatorQueue.task.status === 'running'; i++) await f.tick();
  assert.equal(f.data().creatorQueue.task.status, 'completed');
  assert.deepEqual(f.opened, ['20', '21']);
  assert.equal(f.submissions.length, 0);
  assert.equal(f.events.filter(e => e.type === 'page:authorize').length, 6);
  assert.equal(f.events.some(e => e.type === 'page:image-stage' || e.type === 'page:commit'), false);
  assert.ok(f.data().creatorQueue.task.items.every(item => item.status === 'rehearsed'));
});

test('详情消息部分提交暂停恢复不重发前缀，点击结果未知不自动重试，演练无提交', async () => {
  const f = await runner({ pauseAfterFirst: true });
  for (let i = 0; i < 10 && f.data().creatorQueue.task.status === 'running'; i++) await f.tick();
  assert.equal(f.data().creatorQueue.task.status, 'paused'); assert.equal(f.submissions.length, 1);
  await f.call('panel:resume');
  for (let i = 0; i < 25 && f.data().creatorQueue.task.status === 'running'; i++) await f.tick();
  assert.equal(f.submissions.length, 6); assert.equal(f.data().creatorQueue.task.status, 'completed');
  const unknown = await runner({ failAt: 2 });
  for (let i = 0; i < 10 && unknown.data().creatorQueue.task.status === 'running'; i++) await unknown.tick();
  assert.equal(unknown.data().creatorQueue.task.status, 'paused'); assert.equal(unknown.submissions.length, 2);
  for (let i = 0; i < 3; i++) await unknown.tick();
  assert.equal(unknown.submissions.length, 2);
  const dry = await runner({ mode: 'dry-run' });
  for (let i = 0; i < 20 && dry.data().creatorQueue.task.status === 'running'; i++) await dry.tick();
  assert.equal(dry.data().creatorQueue.task.status, 'completed'); assert.equal(dry.submissions.length, 0);
});
