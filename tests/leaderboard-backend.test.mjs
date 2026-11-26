import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

const path = '/portal/web-seller-affiliate/affiliate_leaderboard';
function fixture() {
  let data = {}, serial = 0, tick = 1000, number = 1, turns = 0, opens = 0, commits = 0;
  const context = 'fixed leaderboard conditions';
  const rows = () => Array.from({ length: 20 }, (_, i) => ({ id: String((number - 1) * 20 + i + 1), name: `测试${(number - 1) * 20 + i + 1}`, rowKey: String((number - 1) * 20 + i + 1001), chatAvailable: true }));
  const snapshot = () => ({ origin: 'https://seller.shopee.co.id', path, documentEpoch: 123, shop: { id: '10', name: '测试店铺' }, creators: rows(), list: { supported: true, hasMore: number < 10, loading: false, pagination: { page: number, pageSize: 20, total: 200, context } }, blocked: false });
  const actions = [], saveChecks = [];
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async () => structuredClone(data), set: async v => { data = { ...data, ...structuredClone(v) }; } }, session: { get: async () => ({ creatorBrowserSession: 'b' }) } }, tabs: { create: async opts => ({ id: 7, ...opts }), get: async () => ({ url: `https://seller.shopee.co.id${path}` }), update: async () => {} }, scripting: { executeScript: async () => [] } };
  const backend = createBackend(api, { now: () => tick, uid: () => `id-${++serial}`, readSnapshot: async (tabId, text, doc, commit, action) => {
    const p = snapshot();
    if (action) {
      actions.push(action);
      if (action.type === 'turn-page') { saveChecks.push(data.creatorWorkspace.collection.pagination.expectedPage === action.targetPage); number = action.targetPage; turns++; }
      if (action.type === 'open-chat') opens++;
      p.listAction = { performed: true };
    }
    if (commit) { commits++; p.commit = { clicked: true }; }
    return p;
  } });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = { id: 'demo', tab: { id: 7 }, documentId: 'doc', frameId: 0, url: `https://seller.shopee.co.id${path}` };
  const call = (type, body = {}, from = panel) => { tick += 100; return backend.handle({ type, ...body }, from); };
  const poll = () => call('page:poll', { pageId: 'page' }, sender);
  const connect = async () => { await call('panel:open', { source: { type: 'leaderboard' } }); await call('page:hello', { pageId: 'page' }, sender); };
  const config = c => ({ shop: snapshot().shop, creators: c.creators.map(({ id, name }) => ({ id, name })), source: c.source, messages: [{ type: 'text', content: 'Halo' }], limit: c.target, targetCount: c.target, collectionId: c.id, intervalSeconds: 1, mode: 'dry-run' });
  return { call, poll, connect, config, sender, actions, saveChecks, data: () => data, turns: () => turns, opens: () => opens, commits: () => commits, setPage: n => { number = n; } };
}

test('后台排行榜受控跨页准备25人，翻页声明先落盘，启动后先回原目标页再打开会话', async () => {
  const f = fixture(); await f.connect();
  let c = (await f.call('panel:collect', { targetCount: 25, source: { type: 'leaderboard' } })).workspace.collection;
  assert.equal(c.status, 'collecting');
  const load = (await f.poll()).command;
  await f.call('page:collect-step', { pageId: 'page', collectionId: c.id, token: load.token }, f.sender);
  await f.poll();
  c = (await f.call('panel:get')).workspace.collection;
  assert.equal(c.status, 'ready'); assert.equal(c.creators.length, 25); assert.equal(f.turns(), 1);
  const cfg = f.config(c), preview = await f.call('panel:preview', { config: cfg });
  await f.call('panel:start', { config: cfg, previewToken: preview.previewToken });
  const cmd = (await f.poll()).command, body = { taskId: cmd.taskId, sessionId: cmd.sessionId, itemId: cmd.itemId, messageIndex: cmd.messageIndex, pageId: 'page' };
  assert.equal((await f.call('page:open-chat', body, f.sender)).navigating, true);
  assert.equal(f.opens(), 0);
  assert.equal((await f.call('page:open-chat', body, f.sender)).opened, true);
  assert.equal(f.opens(), 1); assert.equal(f.commits(), 0);
  assert.ok(f.saveChecks.every(Boolean));
  const open = f.actions.find(a => a.type === 'open-chat');
  assert.equal(open.roster.page, 1); assert.equal(open.path, path);
});

test('来源与路径不可互相冒充，起始页不是第一页时拒绝静默跳过榜首', async () => {
  const f = fixture(); await f.connect();
  await assert.rejects(f.call('panel:collect', { targetCount: 1 }), /来源|页面|广场/);
  f.setPage(2);
  await assert.rejects(f.call('panel:collect', { targetCount: 1, source: { type: 'leaderboard' } }), /第一|榜首/);
});

test('准备后人工翻页使名单失效，不能凭缓存启动或点击聊天', async () => {
  const f = fixture(); await f.connect();
  const c = (await f.call('panel:collect', { targetCount: 1, source: { type: 'leaderboard' } })).workspace.collection;
  f.setPage(2);
  await assert.rejects(f.call('panel:preview', { config: f.config(c) }), /失效|准备/);
  assert.equal(f.opens(), 0); assert.equal(f.commits(), 0);
});

test('从排行榜当前第四页准备，跨第五页后仍受控回第四页处理首位', async () => {
  const f = fixture(); await f.connect(); f.setPage(4);
  let c = (await f.call('panel:collect', { targetCount: 25, source: { type: 'leaderboard', startPosition: 'current' } })).workspace.collection;
  assert.equal(c.status, 'collecting'); assert.equal(c.creators[0].id, '61');
  const step = (await f.poll()).command;
  await f.call('page:collect-step', { pageId: 'page', collectionId: c.id, token: step.token }, f.sender);
  await f.poll(); c = (await f.call('panel:get')).workspace.collection;
  assert.equal(c.status, 'ready'); assert.equal(c.creators.at(-1).id, '85');
  const config = f.config(c), preview = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: preview.previewToken });
  const command = (await f.poll()).command;
  const body = { pageId: 'page', taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId, messageIndex: command.messageIndex };
  assert.equal((await f.call('page:open-chat', body, f.sender)).navigating, true);
  assert.equal((await f.call('page:open-chat', body, f.sender)).opened, true);
  assert.equal(f.actions.find(action => action.type === 'open-chat').roster.page, 4);
  assert.ok(f.saveChecks.every(Boolean)); assert.equal(f.commits(), 0);
});
