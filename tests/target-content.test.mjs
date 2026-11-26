import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createBackend } from '../extension/core/backend.mjs';
import { addImageAsset, imageReference } from '../extension/core/image-assets.mjs';

const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n9sAAAAASUVORK5CYII=';
const imageStore = (await addImageAsset(undefined, { name: '测试图.png', mime: 'image/png', size: 68, dataUrl: imageData }, { id: 'fixture-image', now: 1000 })).store;
const imageMessage = imageReference(imageStore.assets[0]);

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
async function runner(mode = 'dry-run', failAt = 0, productLink, options = {}) {
  const targetCount = options.targetCount ?? 100;
  let storage = options.assets ? { creatorImageAssets: structuredClone(options.assets) } : {}, now = 1000, id = 0, value = '', clicked = 0, opened = [], stagedImages = 0, previewReads = 0;
  const messages = [], timers = [], submissions = [];
  const grow = n => { page.creators = Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: `达人${i + 1}`, rowKey: `${i}_${i + 1001}`, chatAvailable: true })); page.list.renderedCount = n; };
  const page = { origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', documentEpoch: 123, shop: { id: '10', name: '虚构测试店' }, creators: [], list: { supported: true, hasMore: true, loading: false }, blocked: false, chat: null }; grow(12);
  const sourceSelection = options.leaderboard ? { type: 'leaderboard' } : undefined;
  const turnPage = number => {
    page.path = '/portal/web-seller-affiliate/affiliate_leaderboard';
    page.creators = Array.from({ length: 20 }, (_, i) => ({ id: String((number - 1) * 20 + i + 1), name: `达人${(number - 1) * 20 + i + 1}`, rowKey: String((number - 1) * 20 + i + 1001), chatAvailable: true }));
    page.list = { supported: true, hasMore: number < 10, loading: false, pagination: { page: number, pageSize: 20, total: 200, context: 'fixed leaderboard conditions' } };
  };
  if (options.leaderboard) turnPage(1);
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async () => structuredClone(storage), set: async v => { storage = { ...storage, ...structuredClone(v) }; } }, session: { get: async () => ({ creatorBrowserSession: 'browser' }) } }, tabs: { create: async () => ({ id: 7 }), get: async () => ({ url: page.origin }) }, scripting: { executeScript: async () => [] } };
  api.tabs.update = async () => {};
  const editor = { get value() { return value; }, isConnected: true, dispatchEvent() {} }, send = { isConnected: true };
  const backend = createBackend(api, { uid: () => `id-${++id}`, now: () => now, readSnapshot: async (tab, text, doc, commit, action) => {
    if (action?.type === 'turn-page') {
      assert.equal(storage.creatorWorkspace.collection.pagination.expectedPage, action.targetPage);
      const prior = structuredClone(page); turnPage(action.targetPage); return { ...prior, listAction: { performed: true } };
    }
    if (action?.type === 'load-more') { grow(page.creators.length + 12); return { ...structuredClone(page), listAction: { performed: true } }; }
    if (action?.type === 'open-chat') { opened.push(action.creator.id); value = ''; page.chat = { shopId: '10', recipientId: action.creator.id, editorFound: true, sendFound: true, sendReady: true, editorText: '', ...(options.assets ? { imageSupported: true, mediaCount: 0, replyCount: 0 } : {}) }; return { ...structuredClone(page), listAction: { performed: true } }; }
    if (action?.type === 'stage-image') {
      assert.equal(storage.creatorWorkspace.imageDraft.token, action.token, '预备图令牌先落盘');
      stagedImages++;
      page.chat.mediaCount = 1;
      page.chat.imageDraft = { token: action.token, taskId: action.taskId, itemId: action.itemId, messageIndex: action.messageIndex, assetId: action.asset.assetId, sha256: action.asset.sha256, ready: true };
      return { ...structuredClone(page), listAction: { performed: true } };
    }
    if (!commit && previewReads > 0 && --previewReads === 0) { page.chat.mediaCount = 0; page.chat.imageDraft = null; }
    const p = structuredClone(page); if (p.chat) p.chat.editorText = value;
    if (commit) { if (options.leaderboard) { assert.equal(commit.roster.page, page.list.pagination.page); assert.equal(commit.roster.context, page.list.pagination.context); assert.equal(storage.creatorWorkspace.receipt.claimed, true); } clicked++; submissions.push({ itemId: commit.itemId, text: value, ...(commit.image ? { assetId: commit.image.assetId } : {}) }); if (clicked === failAt) throw new Error('本次页面提交中断，结果未知'); if (!options.keepDraft) value = ''; if (commit.image && !options.keepImageDraft) { if (options.imageClearDelay) previewReads = options.imageClearDelay; else { page.chat.mediaCount = 0; page.chat.imageDraft = null; } } return { ...p, commit: { clicked: true } }; }
    return p;
  } });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') }, sender = { id: 'demo', documentId: 'doc', tab: { id: 7 }, frameId: 0, url: page.origin + page.path };
  const call = (type, body = {}) => backend.handle({ type, ...body }, panel);
  await call('panel:open', { ...(sourceSelection ? { source: sourceSelection } : {}) });
  const context = { crypto: { randomUUID: () => 'page' }, location: { origin: page.origin }, document: { querySelectorAll: () => { throw new Error('目标模式禁止隔离世界盲点行'); }, querySelector: s => s.includes('textarea') ? editor : s.includes('plW8rzAMob') ? send : null }, HTMLTextAreaElement: function () {}, Event: class {}, addEventListener() {}, clearTimeout() {}, setTimeout: (fn, delay) => { if (delay < 1000) queueMicrotask(fn); else timers.push(fn); }, chrome: { runtime: { sendMessage: async message => {
    messages.push(message);
    try {
      const reply = await backend.handle(message, sender);
      await options.onReply?.(message, reply, { call, clicked, page, setValue: text => { value = text; } });
      return { ok: true, ...reply };
    } catch (error) { return { ok: false, error: error.message }; }
  } } } };
  Object.defineProperty(context.HTMLTextAreaElement.prototype, 'value', { set: v => { value = v; } });
  vm.runInNewContext(source, context); await turn(); await turn();
  async function tick(elapsed = 1100) { now += elapsed; await timers.shift()?.(); }
  await call('panel:collect', { targetCount, ...(sourceSelection ? { source: sourceSelection } : {}) });
  for (let i = 0; i < 15 && storage.creatorWorkspace.collection.status === 'collecting'; i++) await tick();
  if (options.chooseCandidates) {
    let selection = storage.creatorWorkspace.collection;
    selection = (await call('panel:select', { collectionId: selection.id, expectedRevision: selection.selectionRevision, creatorId: selection.creators[0].id, selected: false })).workspace.collection;
    await call('panel:refill-selection', { collectionId: selection.id, expectedRevision: selection.selectionRevision });
  }
  const c = storage.creatorWorkspace.collection;
  if (c.status === 'ready') {
    const config = { shop: page.shop, creators: c.creators, ...(sourceSelection ? { source: c.source } : {}), ...(options.messages ? { messages: options.messages } : { template: 'Halo {{name}}', ...(productLink ? { productLink } : {}) }), intervalSeconds: options.intervalSeconds ?? 1, limit: targetCount, mode, targetCount, collectionId: c.id };
    const p = await call('panel:preview', { config }); await call('panel:start', { config, previewToken: p.previewToken, confirmed: mode === 'send' });
  }
  return { call, tick, messages, submissions, now: () => now, data: () => storage, clicks: () => clicked, stagedImages: () => stagedImages, opened, value: () => value };
}

test('同一达人两条消息无需额外调度等待，整组完成后才开始十秒逐人间隔', async () => {
  const r = await runner('send', 0, 'https://shopee.co.id/product/1/2', { targetCount: 2, intervalSeconds: 10 });
  const start = r.messages.length;
  await r.tick();
  assert.equal(r.clicks(), 2, '一次调度应完成当前达人的准备和两条提交');
  assert.deepEqual(r.opened, ['1']);
  assert.equal(r.data().creatorQueue.task.nextAt, r.now() + 10_000);
  const actions = r.messages.slice(start).map(m => m.type);
  assert.equal(actions[0], 'page:poll');
  assert.equal(actions[1], 'page:open-chat', '打开前的核对由后台执行，不重复请求快照');
  assert.equal(actions.filter(type => type === 'page:authorize').length, 2);
  await r.tick(9999);
  assert.equal(r.clicks(), 2, '冷却结束前不能开始下一位');
  await r.tick(1);
  assert.equal(r.clicks(), 4);
  assert.deepEqual(r.opened, ['1', '2']);
  assert.equal(r.data().creatorQueue.task.status, 'completed');
});

test('十条消息在同一达人内连续调度，每条仍独立授权和提交', async () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ type: 'text', content: `第${i + 1}条` }));
  const r = await runner('send', 0, undefined, { targetCount: 1, messages });
  await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.clicks(), 10);
  assert.deepEqual(r.submissions.map(s => s.text), messages.map(m => m.content));
  assert.deepEqual(r.messages.filter(m => m.type === 'page:authorize').map(m => m.messageIndex), messages.map((_, i) => i));
});

test('排行榜200人跨十页按首次行序完整演练，执行器只请求后台受控定位页', async () => {
  const r = await runner('dry-run', 0, undefined, { leaderboard: true, targetCount: 200, messages: [{ type: 'text', content: 'Halo' }] });
  for (let i = 0; i < 205 && r.data().creatorQueue.task?.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task?.status, 'completed');
  assert.deepEqual(r.opened, Array.from({ length: 200 }, (_, i) => String(i + 1)));
  assert.ok(r.messages.filter(m => m.type === 'page:open-chat').length > 200, '定位页经过额外受控轮询');
  assert.equal(r.clicks(), 0); assert.equal(r.value(), '');
});

test('排行榜跨页三条混排保留逐条授权声明和组内调度，导航回包暂停不打开聊天', async () => {
  const messages = [imageMessage, { type: 'text', content: 'Halo {{name}}' }, { type: 'link', content: 'https://shopee.co.id/product/1/2' }];
  const r = await runner('send', 0, undefined, { leaderboard: true, targetCount: 25, assets: imageStore, messages });
  for (let i = 0; i < 30 && r.data().creatorQueue.task?.status === 'running'; i++) await r.tick();
  assert.equal(r.clicks(), 75); assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.deepEqual(r.opened, Array.from({ length: 25 }, (_, i) => String(i + 1)));
  assert.equal(r.messages.filter(m => m.type === 'page:authorize').length, 75);
  const stopped = await runner('send', 0, undefined, { leaderboard: true, targetCount: 25, onReply: async (message, reply, { call }) => {
    if (message.type === 'page:open-chat' && reply.navigating) await call('panel:pause');
  } });
  await stopped.tick();
  assert.equal(stopped.data().creatorQueue.task.status, 'paused');
  assert.equal(stopped.clicks(), 0); assert.equal(stopped.opened.length, 0);
});

test('准备完成回包期间暂停，连续调度也不能填入或提交第一条', async () => {
  const r = await runner('send', 0, undefined, { targetCount: 1, onReply: async (message, _reply, { call }) => {
    if (message.type === 'page:prepared' && message.ok) await call('panel:pause');
  } });
  await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  assert.equal(r.clicks(), 0); assert.equal(r.value(), '');
  assert.equal(r.messages.some(m => m.type === 'page:authorize'), false);
});

test('第一条提交回包期间停止，剩余消息不会因连续调度而提交', async () => {
  const r = await runner('send', 0, 'https://shopee.co.id/product/1/2', { targetCount: 1, onReply: async (message, reply, { call, clicked }) => {
    if (message.type === 'page:commit' && reply.committed && clicked === 1) await call('panel:stop');
  } });
  await r.tick(); await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'stopped');
  assert.equal(r.clicks(), 1);
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 1);
  assert.equal(r.messages.filter(m => m.type === 'page:authorize').length, 1);
});

test('准备指令回包后名单重排，后台打开聊天前仍会拦截', async () => {
  const r = await runner('send', 0, undefined, { targetCount: 2, onReply: (message, reply, { page }) => {
    if (message.type === 'page:poll' && reply.command?.type === 'prepare') page.creators.reverse();
  } });
  await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  assert.equal(r.data().creatorWorkspace.collection.status, 'invalid');
  assert.deepEqual(r.opened, []);
  assert.equal(r.clicks(), 0); assert.equal(r.value(), '');
  assert.equal(r.messages.some(m => m.type === 'page:authorize'), false);
});

test('图片与文字混排经实际执行器逐条预备授权提交，图片正文不进入命令或状态', async () => {
  const r = await runner('send', 0, undefined, { targetCount: 1, assets: imageStore, messages: [imageMessage, { type: 'text', content: 'Halo {{name}}' }, imageMessage] });
  for (let i = 0; i < 9 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.stagedImages(), 2); assert.equal(r.clicks(), 3);
  assert.deepEqual(r.submissions, [{ itemId: '1', text: '', assetId: 'fixture-image' }, { itemId: '1', text: 'Halo 达人1' }, { itemId: '1', text: '', assetId: 'fixture-image' }]);
  assert.equal(JSON.stringify(r.data().creatorQueue).includes('data:image'), false);
});

test('图片演练只核对入口与资产，不预备文件、不点击发送', async () => {
  const r = await runner('dry-run', 0, undefined, { targetCount: 1, assets: imageStore, messages: [imageMessage] });
  for (let i = 0; i < 5 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.stagedImages(), 0); assert.equal(r.clicks(), 0); assert.equal(r.value(), '');
});

test('图片点击后本地预览未清空，不混发下一条文字或覆盖附件', async () => {
  const r = await runner('send', 0, undefined, { targetCount: 1, assets: imageStore, keepImageDraft: true, messages: [imageMessage, { type: 'text', content: '后续文字' }] });
  for (let i = 0; i < 8; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  assert.equal(r.stagedImages(), 1); assert.equal(r.clicks(), 1); assert.equal(r.value(), '');
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 1);
});

test('连续相同图片等待前条预览清空，不把同一资产的上一条误认作本条', async () => {
  const r = await runner('send', 0, undefined, { targetCount: 1, assets: imageStore, imageClearDelay: 7, messages: [imageMessage, imageMessage] });
  for (let i = 0; i < 7 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.stagedImages(), 2); assert.equal(r.clicks(), 2);
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 2);
});

test('新序列可仅发送一条链接，执行器不要求预先存在文字话术', async () => {
  const r = await runner('send', 0, undefined, { targetCount: 1, messages: [{ type: 'link', content: 'https://shopee.co.id/p/1' }] });
  for (let i = 0; i < 5 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.deepEqual(r.submissions, [{ itemId: '1', text: 'https://shopee.co.id/p/1' }]);
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 1);
});

test('十条自定义序列按编排提交，中途暂停恢复不重发已提交前缀', async () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ type: i % 2 ? 'text' : 'link', content: i % 2 ? `第${i + 1}条 {{name}}` : `https://shopee.co.id/p/${i}` }));
  const r = await runner('send', 0, undefined, { targetCount: 1, messages, onReply: async (message, reply, { call, clicked }) => {
    if (message.type === 'page:commit' && reply.committed && clicked === 3) await call('panel:pause');
  } });
  await r.tick();
  assert.equal(r.clicks(), 3);
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  for (let i = 0; i < 3; i++) await r.tick();
  assert.equal(r.clicks(), 3);
  await r.call('panel:resume');
  for (let i = 0; i < 15 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.clicks(), 10);
  assert.deepEqual(r.submissions.map(row => row.text), messages.map(message => message.content.replace('{{name}}', '达人1')));
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 10);
});

test('两条之间暂停不再点击；手动继续仅提交链接，不重发话术', async () => {
  const link = 'https://shopee.co.id/product/1/2', r = await runner('send', 0, link, { onReply: async (message, reply, { call, clicked }) => {
    if (message.type === 'page:commit' && reply.committed && clicked === 1) await call('panel:pause');
  } });
  await r.tick();
  assert.equal(r.clicks(), 1);
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  for (let i = 0; i < 3; i++) await r.tick();
  assert.equal(r.clicks(), 1);
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 1);
  await r.call('panel:resume');
  await r.tick();
  assert.deepEqual(r.submissions.slice(0, 2), [{ itemId: '1', text: 'Halo 达人1' }, { itemId: '1', text: link }]);
  assert.equal(r.data().creatorQueue.task.items[0].status, 'sent');
});

test('话术点击后草稿未清空，不覆盖原草稿或强行提交产品链接', async () => {
  const r = await runner('send', 0, 'https://shopee.co.id/product/1/2', { keepDraft: true });
  for (let i = 0; i < 8; i++) await r.tick();
  assert.equal(r.clicks(), 1);
  assert.equal(r.value(), 'Halo 达人1');
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 1);
});

test('100人双消息依次提交话术和独立链接，每人只打开一次聊天', async () => {
  const link = 'https://shopee.co.id/product/1/2';
  const r = await runner('send', 0, link);
  for (let i = 0; i < 330 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.clicks(), 200);
  assert.equal(r.opened.length, 100);
  assert.deepEqual(r.submissions.slice(0, 4), [
    { itemId: '1', text: 'Halo 达人1' }, { itemId: '1', text: link },
    { itemId: '2', text: 'Halo 达人2' }, { itemId: '2', text: link },
  ]);
  assert.equal(r.data().creatorQueue.task.items.every(i => i.status === 'sent' && i.submittedCount === 2), true);
});

test('链接点击结果不明时保留已提交话术进度，暂停且不补发', async () => {
  const r = await runner('send', 2, 'https://shopee.co.id/product/1/2');
  for (let i = 0; i < 12; i++) await r.tick();
  assert.equal(r.clicks(), 2);
  assert.equal(r.data().creatorQueue.task.status, 'paused');
  assert.equal(r.data().creatorQueue.task.items[0].status, 'uncertain');
  assert.equal(r.data().creatorQueue.task.items[0].submittedCount, 1);
  assert.equal(r.data().creatorQueue.history['10']['1'].status, 'uncertain');
  assert.equal(r.opened.length, 1);
});

test('双消息演练不填草稿、不点击发送，完成两条检查', async () => {
  const r = await runner('dry-run', 0, 'https://shopee.co.id/product/1/2');
  for (let i = 0; i < 330 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.clicks(), 0); assert.equal(r.value(), '');
  assert.equal(r.messages.filter(m => m.type === 'page:authorize').length, 200);
  assert.equal(Object.keys(r.data().creatorQueue.history).length, 0);
});

test('内容执行链真实收集到100、锁定后逐个演练且无草稿无发送', async () => {
  const r = await runner();
  assert.equal(r.data().creatorWorkspace.collection.status, 'consumed');
  for (let i = 0; i < 220 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed');
  assert.equal(r.data().creatorQueue.task.items.filter(i => i.status === 'rehearsed').length, 100);
  assert.equal(r.clicks(), 0); assert.equal(r.value(), ''); assert.equal(new Set(r.opened).size, 100);
});

test('100人无回执提交每人只点击一次；第3次提交中断立即暂停且不补发', async () => {
  const r = await runner('send', 3);
  assert.equal(r.data().creatorWorkspace.collection.status, 'consumed');
  for (let i = 0; i < 25; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'paused'); assert.equal(r.clicks(), 3);
  assert.equal(r.data().creatorQueue.task.items.filter(i => i.status === 'sent').length, 2);
  assert.equal(r.data().creatorQueue.task.items.filter(i => i.status === 'pending').length, 97);
  assert.equal(r.data().creatorQueue.task.items.filter(i => i.status === 'uncertain').length, 1);
  assert.equal(r.messages.filter(m => m.type === 'page:commit').length, 3);
});

test('100人完整无回执提交依锁定顺序各点击一次并保留100条防重发历史', async () => {
  const r = await runner('send');
  for (let i = 0; i < 220 && r.data().creatorQueue.task.status === 'running'; i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status, 'completed'); assert.equal(r.clicks(), 100);
  assert.equal(r.data().creatorQueue.task.items.filter(i => i.status === 'sent').length, 100);
  assert.equal(Object.keys(r.data().creatorQueue.history['10']).length, 100);
  assert.deepEqual(r.opened, Array.from({ length: 100 }, (_, i) => String(i + 1)));
  assert.equal(r.messages.filter(m => m.type === 'page:commit').length, 100);
});

test('换选后实际执行器仅向最终两人提交，未选候选没有聊天动作或防重发记录', async () => {
  const r = await runner('send', 0, undefined, {targetCount:2, chooseCandidates:true});
  for(let i=0;i<6&&r.data().creatorQueue.task.status==='running';i++) await r.tick();
  assert.equal(r.data().creatorQueue.task.status,'completed');
  assert.equal(r.data().creatorWorkspace.collection.candidateCount,3);
  assert.deepEqual(r.opened,['2','3']);assert.equal(r.clicks(),2);
  assert.deepEqual(Object.keys(r.data().creatorQueue.history['10']),['2','3']);
});
