import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

function fixture() {
  let data = {}, clock = 1000, counter = 0, fail = false, scrolls = 0, opens = 0, commits = 0, lastCommit;
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: `测试${i + 1}`, rowKey: `${i}_${i + 1001}`, chatAvailable: true }));
  const snapshot = { origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', documentEpoch: 123, shop: { id: '10', name: '测试店铺' }, creators: rows(12), list: { supported: true, hasMore: true, loading: false, renderedCount: 12 }, chat: null, blocked: false };
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async () => structuredClone(data), set: async v => { if (fail) throw new Error('disk'); data = { ...data, ...structuredClone(v) }; } }, session: { get: async () => ({ creatorBrowserSession: 'browser' }) } }, tabs: { create: async () => ({ id: 7 }), get: async () => ({ url: snapshot.origin }) }, scripting: { executeScript: async () => [] } };
  const readSnapshot = async (tabId, text, documentId, commit, action) => {
    const p = structuredClone(snapshot);
    if (action?.type === 'load-more') { scrolls++; p.listAction = { performed: true }; }
    if (action?.type === 'open-chat') { opens++; p.listAction = { performed: true }; }
    if (commit) { commits++; lastCommit = commit; p.commit = { clicked: true }; }
    return p;
  };
  api.tabs.update = async () => {};
  const backend = createBackend(api, { now: () => clock, uid: () => `uid-${++counter}`, readSnapshot });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = { id: 'demo', tab: { id: 7 }, documentId: 'doc', frameId: 0, url: snapshot.origin + snapshot.path };
  const call = (type, body = {}, from = panel) => backend.handle({ type, ...body }, from);
  const poll = () => call('page:poll', { pageId: 'page' }, sender);
  const connect = async () => { await call('panel:open'); await call('page:hello', { pageId: 'page' }, sender); };
  const grow = n => { snapshot.creators = rows(n); snapshot.list.renderedCount = n; clock += 1000; };
  const config = c => ({ shop: snapshot.shop, creators: c.creators.map(({ id, name }) => ({ id, name })), template: 'Halo {{name}}', intervalSeconds: 1, limit: c.target, mode: 'dry-run', targetCount: c.target, collectionId: c.id });
  return { call, poll, connect, grow, config, snapshot, sender, backend, api, readSnapshot, panel, now: () => clock, advance: ms => { clock += ms; }, data: () => data, scrolls: () => scrolls, opens: () => opens, commits: () => commits, lastCommit: () => lastCommit, fail: () => { fail = true; } };
}

async function ready(f, target = 100) {
  await f.connect(); await f.call('panel:collect', { targetCount: target });
  f.grow(120); await f.poll();
  return (await f.call('panel:get')).workspace.collection;
}

test('准备直接核对当前页面店铺和名单，不复用上次识别结果', async () => {
  const f = fixture(); await f.connect();
  f.snapshot.shop = { id: '11', name: '新店铺' };
  f.snapshot.creators = [{ id: '201', name: '新达人', rowKey: '0_1201', chatAvailable: true }];
  f.snapshot.list.hasMore = false;
  const r = await f.call('panel:collect', { targetCount: 1 });
  assert.equal(r.workspace.shop.id, '11');
  assert.equal(r.workspace.collection.binding.shopId, '11');
  assert.equal(r.workspace.collection.creators[0].id, '201');
  assert.equal(r.workspace.collection.status, 'ready');
  assert.equal(f.opens(), 0); assert.equal(f.commits(), 0);
});

test('准备名单失败诊断保留固定原因但不泄露动态错误内容', async () => {
  const f = fixture(); await f.connect();
  await assert.rejects(f.call('panel:collect', { targetCount: 1, source: { type: 'marketplace', startPosition: 'current', webFilters: { category: 'invalid' } } }), /筛选条件须/);
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  const error = report.events.findLast(event => event.event === 'operation:error' && event.source === 'panel:collect');
  assert.equal(error.error.message, '网页筛选条件须为不超过100个字符且不含控制字符的文字');
  assert.equal(JSON.stringify(report).includes('测试店铺'), false);

  const g = fixture(); await g.connect();
  await assert.rejects(g.call('panel:collect', { targetCount: 1, source: { type: 'marketplace', webFilters: { category: 'x'.repeat(101) } } }), /筛选条件须/);
  const filtered = (await g.call('panel:export-diagnostics')).diagnostics;
  assert.equal(filtered.events.findLast(event => event.event === 'operation:error' && event.source === 'panel:collect').error.message, '网页筛选条件须为不超过100个字符且不含控制字符的文字');
});

test('直接准备时未登录或受限会阻止准备；登录后同一专用页可以再次准备', async () => {
  const f = fixture(); await f.connect();
  f.snapshot.shop = null;
  await assert.rejects(f.call('panel:collect', { targetCount: 1 }), /登录|店铺/);
  f.snapshot.shop = { id: '10', name: '测试店铺' }; f.snapshot.blocked = true;
  await assert.rejects(f.call('panel:collect', { targetCount: 1 }), /验证|限制/);
  f.snapshot.blocked = false;
  assert.equal((await f.call('panel:collect', { targetCount: 1 })).workspace.collection.status, 'ready');
  assert.equal(f.opens(), 0); assert.equal(f.commits(), 0);
});

test('需要追加加载时先保存准备状态，且不切换到专用页；已备齐也不切页', async () => {
  const f = fixture(); await f.connect();
  const activated = [];
  f.api.tabs.update = async (tabId, options) => {
    assert.equal(f.data().creatorWorkspace.collection.status, 'collecting');
    activated.push({ tabId, options });
  };
  await f.call('panel:collect', { targetCount: 100 });
  assert.deepEqual(activated, []);
  await f.call('panel:cancel-collection'); f.grow(120);
  await f.call('panel:collect', { targetCount: 100 });
  assert.equal(activated.length, 0);
});

test('准备名单不需要激活专用页，存储失败时也不切页', async () => {
  const f = fixture(); await f.connect();
  f.api.tabs.update = async () => { throw new Error('closed'); };
  const r = await f.call('panel:collect', { targetCount: 100 });
  assert.equal(r.workspace.collection.status, 'collecting');
  const g = fixture(); await g.connect(); let activated = false;
  g.api.tabs.update = async () => { activated = true; };
  g.fail(); await assert.rejects(g.call('panel:collect', { targetCount: 100 }), /存储|保存/);
  assert.equal(activated, false);
});

test('备齐100人前不预览启动，完成后锁定精确名单且不需要全部同时处于视口', async () => {
  const f = fixture(); await f.connect();
  let c = (await f.call('panel:collect', { targetCount: 100 })).workspace.collection;
  assert.equal(c.status, 'collecting'); assert.equal(c.shortfall, 88);
  await assert.rejects(f.call('panel:preview', { config: f.config(c) }), /备齐|准备/);
  const { command } = await f.poll(); assert.equal(command.type, 'collect');
  await f.call('page:collect-step', { pageId: 'page', collectionId: c.id, token: command.token }, f.sender);
  assert.equal(f.scrolls(), 1);
  for (const n of [24, 36, 48, 60, 72, 84, 96, 108, 120]) { f.grow(n); await f.poll(); }
  c = (await f.call('panel:get')).workspace.collection;
  assert.equal(c.status, 'ready'); assert.equal(c.count, 100); assert.equal(c.shortfall, 0);
  const config = f.config(c), p = await f.call('panel:preview', { config });
  assert.equal(p.preview.sendableCount, 100);
  const result = await f.call('panel:start', { config, previewToken: p.previewToken });
  assert.equal(result.state.task.items.length, 100);
  assert.equal(result.workspace.collection.status, 'consumed');
  const prepare = (await f.poll()).command; assert.equal(prepare.collectionId, c.id);
  assert.equal((await f.call('page:open-chat', { pageId: 'page', taskId: prepare.taskId, sessionId: prepare.sessionId, itemId: prepare.itemId }, f.sender)).opened, true);
  assert.equal(f.opens(), 1);
});

test('取消后迟到步骤/导航后旧文档不能滚动或启动；准备状态不会自动恢复', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:collect', { targetCount: 100 }); const command = (await f.poll()).command;
  await f.call('panel:cancel-collection');
  assert.equal((await f.call('page:collect-step', { pageId: 'page', collectionId: command.collectionId, token: command.token }, f.sender)).performed, false);
  assert.equal(f.scrolls(), 0);
  await f.call('panel:collect', { targetCount: 100 });
  await f.backend.onUpdated(7, { status: 'loading' });
  assert.equal((await f.call('panel:get')).workspace.collection.status, 'invalid');
  const g = fixture(), c = await ready(g); const config = g.config(c), p = await g.call('panel:preview', { config });
  g.snapshot.documentEpoch = 999;
  await assert.rejects(g.call('panel:start', { config, previewToken: p.previewToken }), /文档|准备/);
});

test('锁定名单禁止改人数、换人、静默少发；拒绝变化或列表替换使预览失效', async () => {
  const f = fixture(), c = await ready(f), config = f.config(c);
  for (const changed of [{ ...config, limit: 99 }, { ...config, targetCount: 99 }, { ...config, creators: config.creators.slice(0, 99) }, { ...config, creators: config.creators.toReversed() }]) await assert.rejects(f.call('panel:preview', { config: changed }), /名单|目标|人数/);
  const p = await f.call('panel:preview', { config });
  await f.call('panel:deny', { shopId: '10', creatorId: '1', name: '测试1', blocked: true });
  await assert.rejects(f.call('panel:start', { config, previewToken: p.previewToken }), /名单|准备|备齐/);
  const g = fixture(), d = await ready(g); g.snapshot.creators.reverse();
  await assert.rejects(g.call('panel:preview', { config: g.config(d) }), /名单|准备|备齐/);
});

test('未结束任务阻断收集；存储失败不得滚动，重复动作令牌只消费一次', async () => {
  const f = fixture(), c = await ready(f), config = f.config(c), p = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: p.previewToken });
  await f.call('panel:pause');
  await assert.rejects(f.call('panel:collect', { targetCount: 100 }), /任务/);
  const g = fixture(); await g.connect(); await g.call('panel:collect', { targetCount: 100 });
  const command = (await g.poll()).command, body = { pageId: 'page', collectionId: command.collectionId, token: command.token };
  await g.call('page:collect-step', body, g.sender); await g.call('page:collect-step', body, g.sender); assert.equal(g.scrolls(), 1);
  const h = fixture(); await h.connect(); await h.call('panel:collect', { targetCount: 100 }); const next = (await h.poll()).command; h.fail();
  await assert.rejects(h.call('page:collect-step', { pageId: 'page', collectionId: next.collectionId, token: next.token }, h.sender), /存储|保存/); assert.equal(h.scrolls(), 0);
});

test('页面耗尽反馈准确差额，账号变化失效；任务运行中失去行不会盲开聊天', async () => {
  const f = fixture(); await f.connect(); await f.call('panel:collect', { targetCount: 100 }); f.snapshot.list.hasMore = false; await f.poll();
  const c = (await f.call('panel:get')).workspace.collection; assert.equal(c.status, 'insufficient'); assert.equal(c.shortfall, 88);
  const g = fixture(), d = await ready(g); g.snapshot.shop = { id: '11', name: '其他店铺' };
  await assert.rejects(g.call('panel:preview', { config: g.config(d) }), /店铺|名单|准备/);
  const h = fixture(), e = await ready(h), config = h.config(e), p = await h.call('panel:preview', { config });
  await h.call('panel:start', { config, previewToken: p.previewToken }); const command = (await h.poll()).command;
  h.snapshot.creators.shift();
  assert.equal((await h.call('page:open-chat', { pageId: 'page', taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId }, h.sender)).opened, false);
  assert.equal(h.opens(), 0); assert.equal((await h.call('panel:get')).state.task.status, 'paused');
});

test('同文档离开达人路由或URL导航事件立即使目标名单失效', async () => {
  const f = fixture(), c = await ready(f), config = f.config(c), p = await f.call('panel:preview', { config });
  f.snapshot.path = '/portal/other';
  await assert.rejects(f.call('panel:start', { config, previewToken: p.previewToken }), /名单|页面|准备/);
  const g = fixture(), d = await ready(g), next = g.config(d), preview = await g.call('panel:preview', { config: next });
  await g.backend.onUpdated(7, { url: 'https://seller.shopee.co.id/portal/other' });
  assert.equal((await g.call('panel:get')).workspace.collection.status, 'invalid');
  await assert.rejects(g.call('panel:start', { config: next, previewToken: preview.previewToken }), /名单|准备/);
});

test('收集页面停止轮询超时失效，不能无限显示准备中', async () => {
  const f = fixture(); await f.connect(); await f.call('panel:collect', { targetCount: 100 });
  f.advance(46000);
  assert.equal((await f.call('panel:get')).workspace.collection.status, 'invalid');
});

async function authorized(f) {
  const c = await ready(f, 1), config = { ...f.config(c), mode: 'send' }, p = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: p.previewToken, confirmed: true });
  const command = (await f.poll()).command;
  const context = { pageId: 'page', taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId };
  f.snapshot.chat = { shopId: '10', recipientId: command.itemId, editorFound: true, sendFound: true, sendReady: true, evidenceSupported: true, latestMessageId: '100', messages: [], editorText: '' };
  await f.call('page:prepared', { ...context, ok: true }, f.sender); await f.poll();
  f.snapshot.chat.editorText = command.text;
  await f.call('page:authorize', context, f.sender);
  return context;
}

test('授权后收件人变化时不提交，保留待核对而非点击错误达人', async () => {
  const f = fixture(), context = await authorized(f);
  f.snapshot.chat.recipientId = '21';
  assert.equal((await f.call('page:commit', context, f.sender)).committed, false);
  assert.equal(f.commits(), 0);
  assert.equal((await f.call('panel:get')).state.task.status, 'paused');
});

test('最终同步核对交付完整名单和身份锚点，不依赖历史消息水位', async () => {
  const f = fixture(), context = await authorized(f);
  delete f.snapshot.chat.latestMessageId;
  assert.equal((await f.call('page:commit', context, f.sender)).committed, true);
  assert.equal(f.lastCommit().minimumMessageId, undefined);
  assert.equal(f.lastCommit().roster.creator.id, context.itemId);
  assert.ok(f.lastCommit().roster.observed.length > 0);
});

test('发送已获许可后同文档URL导航仍暂停，旧提交不会点击', async () => {
  const f = fixture(), context = await authorized(f);
  await f.backend.onUpdated(7, { url: 'https://seller.shopee.co.id/portal/other' });
  await f.call('page:commit', context, f.sender);
  assert.equal(f.commits(), 0);
  const result = await f.call('panel:get');
  assert.equal(result.state.task.status, 'paused'); assert.equal(result.state.task.items[0].status, 'uncertain');
  assert.equal(result.workspace.collection.status, 'invalid');
});

async function selection(f, c, type, values = {}) {
  return (await f.call(type, { collectionId: c.id, expectedRevision: c.selectionRevision, ...values })).workspace.collection;
}

test('候选选择落盘，默认前100；取消11人补到99后须手动或显式继续加载', async () => {
  const f = fixture(); let c = await ready(f);
  assert.equal(c.candidateCount, 110); assert.equal(c.count, 100);
  const original = f.config(c), oldPreview = await f.call('panel:preview', {config: original});
  for(let i=1;i<=11;i++) c = await selection(f, c, 'panel:select', {creatorId: String(i), selected: false});
  c = await selection(f, c, 'panel:refill-selection');
  assert.equal(c.count, 99); assert.equal(c.selectedIds.includes('1'), false);
  await assert.rejects(f.call('panel:preview', {config: f.config(c)}), /人数|选择|名单/);
  await assert.rejects(f.call('panel:start', {config:original, previewToken:oldPreview.previewToken}), /名单|变化/);
  c = await selection(f, c, 'panel:extend-candidates');
  assert.equal(c.status, 'ready'); assert.equal(c.candidateCount, 120); assert.equal(c.count, 99);
  c = await selection(f, c, 'panel:refill-selection');
  assert.equal(c.count, 100); assert.equal(c.selectedIds.at(-1), '111');
  assert.deepEqual(f.data().creatorWorkspace.collection.selectedIds, c.selectedIds);
  const cfg = f.config(c), p = await f.call('panel:preview', {config:cfg});
  assert.equal(p.preview.items.length, 100); assert.equal(p.preview.items.some(i => i.id === '1'), false);
  await f.call('panel:start', {config:cfg, previewToken:p.previewToken});
  assert.equal(f.data().creatorQueue.task.items.length, 100);
  await assert.rejects(selection(f, c, 'panel:select', {creatorId:'1', selected:true}), /任务/);
  assert.equal(f.commits(), 0);
});

test('候选选择防旧窗口覆盖、错误名单和非工作台来源，恢复默认必须显式操作', async () => {
  const f = fixture(); const old = await ready(f, 10);
  const c = await selection(f, old, 'panel:select', {creatorId:'1', selected:false});
  await assert.rejects(selection(f, old, 'panel:refill-selection'), /版本|刷新|变化/);
  await assert.rejects(f.call('panel:select', {collectionId:'wrong', expectedRevision:c.selectionRevision, creatorId:'2', selected:false}), /名单|变化/);
  await assert.rejects(f.call('panel:select', {collectionId:c.id, expectedRevision:c.selectionRevision, creatorId:'2', selected:false}, f.sender), /工作台/);
  const reset = await selection(f, c, 'panel:reset-selection');
  assert.equal(reset.count, 10); assert.equal(reset.selectedIds[0], '1');
});

test('拒绝已选人员只撤掉该选择，未选备选不得进入队列或绕过拒绝', async () => {
  const f = fixture(); let c = await ready(f, 10);
  await f.call('panel:deny', {shopId:'10', creatorId:'1', blocked:true});
  c = (await f.call('panel:get')).workspace.collection;
  assert.equal(c.status,'ready'); assert.equal(c.count,9);
  await assert.rejects(selection(f,c,'panel:select',{creatorId:'1',selected:true}), /不可|记录/);
  c = await selection(f,c,'panel:refill-selection'); assert.equal(c.count,10);
  const cfg=f.config(c), p=await f.call('panel:preview',{config:cfg});
  await f.call('panel:deny',{shopId:'10',creatorId:'1',blocked:false});
  await assert.rejects(f.call('panel:start',{config:cfg,previewToken:p.previewToken}), /变化|预览/);
  assert.equal((await f.call('panel:get')).workspace.collection.selectedIds.includes('1'),false);
});

test('来源已无下一批时显式继续仍可纳入已挂载的额外候选，耗尽则明确拒绝', async () => {
  const f=fixture();let c=await ready(f); f.snapshot.list.hasMore=false;
  c=await selection(f,c,'panel:extend-candidates');assert.equal(c.candidateCount,120);assert.equal(c.status,'ready');
  await assert.rejects(selection(f,c,'panel:extend-candidates'),/更多|耗尽/);
});

test('后台重新创建保留已选集合，选择写盘失败则保留磁盘原名单并阻止后续动作', async () => {
  const f=fixture();let c=await ready(f,10);
  c=await selection(f,c,'panel:select',{creatorId:'1',selected:false});
  const restarted=createBackend(f.api,{now:f.now,readSnapshot:f.readSnapshot});
  const restored=await restarted.handle({type:'panel:get'},f.panel);
  assert.deepEqual(restored.workspace.collection.selectedIds,c.selectedIds);
  const before=structuredClone(f.data().creatorWorkspace.collection);
  f.fail();await assert.rejects(selection(f,c,'panel:refill-selection'),/保存|存储/);
  assert.deepEqual(f.data().creatorWorkspace.collection,before);
  await assert.rejects(selection(f,c,'panel:reset-selection'),/保存|存储/);
  assert.equal(f.commits(),0);
});

test('隐藏标签被节流时由工作台轮询继续采集，不依赖页面心跳', async () => {
  const f = fixture(); await f.connect();
  f.snapshot.creators = f.snapshot.creators.slice(0, 12);
  await f.call('panel:collect', { targetCount: 100 });
  const started = f.scrolls();
  await f.call('panel:get');
  assert.equal(f.scrolls(), started, '页面仍在自己轮询时后台不抢动作');
  f.advance(5000);
  await f.call('panel:get');
  assert.equal(f.scrolls(), started + 1, '页面静默超过4秒后由后台继续加载');
  f.grow(30); f.advance(5000);
  await f.call('panel:get');
  const c = (await f.call('panel:get')).workspace.collection;
  assert.equal(c.status, 'collecting'); assert.ok(c.candidateCount >= 30);
  // 同一时刻只允许一个滚动动作，避免与页面执行器重复点击。
  assert.equal(c.action, null);
});

test('人数不足保留候选并可从工作台继续准备，继续后接着加载到备齐', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:collect', { targetCount: 100 });
  f.grow(24); await f.poll();
  // 页面一直在心跳，只是加载太慢；预算耗尽后差额保留为“人数不足”。
  for (let i = 0; i < 45; i++) { f.advance(40_000); await f.poll(); }
  const stalled = (await f.call('panel:get')).workspace.collection;
  assert.equal(stalled.status, 'insufficient');
  assert.equal(stalled.candidateCount, 24);
  assert.match(stalled.reason, /不能启动/);
  const resumed = await selection(f, stalled, 'panel:extend-candidates');
  assert.equal(resumed.status, 'collecting'); assert.equal(resumed.candidateCount, 24);
  assert.equal(resumed.selectedIds.length, 24);
  f.grow(120); await f.poll();
  const done = (await f.call('panel:get')).workspace.collection;
  assert.equal(done.status, 'ready'); assert.equal(done.candidateCount, 110); assert.equal(done.count, 100);
});
