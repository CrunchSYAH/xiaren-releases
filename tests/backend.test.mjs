import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createBackend } from '../extension/core/backend.mjs';

function fixture() {
  let data = {}, sessionData = {}, writes = 0, failWrite = false, clock = 1000;
  const snapshot = { documentEpoch: 123, origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu', rowKey: '0_99', chatAvailable: true }], chat: { shopId: '10', recipientId: '20', latestMessageId: '100', editorFound: true, sendFound: true, sendReady: true, editorText: '', evidenceSupported: true, messages: [] }, blocked: false };
  const api = {
    runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` },
    storage: { local: { get: async () => structuredClone(data), set: async values => { writes++; if (failWrite) throw new Error('disk'); data = { ...data, ...structuredClone(values) }; } }, session: { get: async () => structuredClone(sessionData), set: async values => { sessionData = { ...sessionData, ...values }; } } },
    tabs: { create: async () => ({ id: 7 }), get: async id => ({ id, url: 'https://seller.shopee.co.id/portal/web-seller-affiliate/kol_marketplace', status: 'complete' }) },
    scripting: { executeScript: async () => [] },
  };
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = { id: 'demo', documentId: 'doc-1', tab: { id: 7 }, frameId: 0, url: 'https://seller.shopee.co.id/portal/web-seller-affiliate/kol_marketplace' };
  let counter = 0;
  let commits = 0, loseCommitReply = false, failCommitSave = false;
  const backend = createBackend(api, { readSnapshot: async (tabId, text, documentId, commit) => {
    if (commit) { assert.equal(data.creatorWorkspace.receipt.claimed, true); commits++; if (loseCommitReply) throw new Error('lost-after-click'); if (failCommitSave) failWrite = true; }
    return { ...structuredClone(snapshot), ...(commit ? { commit: { clicked: true } } : {}) };
  }, uid: () => `uid-${++counter}`, now: () => clock });
  const call = (type, body = {}, from = panel) => backend.handle({ type, ...body }, from);
  const config = { shop: snapshot.shop, creators: snapshot.creators, template: 'Halo {{name}}', intervalSeconds: 30, limit: 1, mode: 'dry-run' };
  const connect = async () => { await call('panel:open'); await call('page:hello', { pageId: 'page-1' }, sender); };
  return { backend, call, config, connect, sender, snapshot, api, advance: ms => { clock += ms; }, loseReply: () => { loseCommitReply = true; }, failAfterClick: () => { failCommitSave = true; }, recoverStorage: () => { failWrite = false; }, commits: () => commits, data: () => data, writes: () => writes, fail: () => { failWrite = true; }, restartSession: () => { sessionData = {}; } };
}

test('工作台状态明确声明目标人数功能已由当前后台加载', async () => {
  const f = fixture();
  assert.equal((await f.call('panel:get')).capabilities?.targetCount, true);
  await f.connect();
  assert.equal((await f.call('panel:get')).capabilities?.targetCount, true);
});

test('外域、原有标签页和伪造面板不能操作队列', async () => {
  const f = fixture();
  await assert.rejects(f.call('panel:get', {}, { id: 'demo', url: 'https://example.com' }));
  await assert.rejects(f.call('page:hello', { pageId: 'p' }, f.sender), /专用/);
  await f.connect();
  await assert.rejects(f.call('page:poll', { pageId: 'page-1' }, { ...f.sender, tab: { id: 8 } }), /专用/);
  await assert.rejects(f.call('page:poll', { pageId: 'page-1' }, { ...f.sender, frameId: 1 }), /顶层/);
});

test('预览后配置变化必须重新预览，未经预览不能启动', async () => {
  const f = fixture(); await f.connect();
  await assert.rejects(f.call('panel:start', { config: f.config }), /预览/);
  const preview = await f.call('panel:preview', { config: f.config });
  await assert.rejects(f.call('panel:start', { config: { ...f.config, template: 'changed' }, previewToken: preview.previewToken }), /预览/);
  const task = await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  assert.equal(task.state.task.status, 'running');
});

test('并发 poll 只派发一次，存储成功后才能返回指令', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  const responses = await Promise.all([f.call('page:poll', { pageId: 'page-1' }, f.sender), f.call('page:poll', { pageId: 'page-1' }, f.sender)]);
  assert.equal(responses.filter(r => r.command?.type === 'prepare').length, 1);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'preparing');
  assert.ok(f.writes() > 0);
});

test('写盘失败不交付指令，后续操作保持阻断', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  f.fail();
  await assert.rejects(f.call('page:poll', { pageId: 'page-1' }, f.sender), /保存|存储/);
  await assert.rejects(f.call('page:poll', { pageId: 'page-1' }, f.sender), /保存|存储/);
});

test('页面重载暂停旧任务；后台重新实例化不重新派发活跃指令', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  const reloaded = await f.call('page:hello', { pageId: 'page-2' }, f.sender);
  assert.equal(reloaded.state.task.status, 'paused');
  assert.equal((await f.call('page:poll', { pageId: 'page-1' }, f.sender)).command, null);
  const nextBackend = createBackend(f.api, { readSnapshot: async () => f.snapshot });
  assert.equal((await nextBackend.handle({ type: 'panel:get' }, { id: 'demo', url: f.api.runtime.getURL('dashboard.html') })).state.task.status, 'paused');
});

async function beginSend(f, extra = {}) {
  await f.connect();
  const config = { ...f.config, mode: 'send', ...extra };
  const preview = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: preview.previewToken, confirmed: true });
  const { command } = await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  const context = { pageId: 'page-1', taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId, text: command.text, ...(command.messageIndex !== undefined ? { messageIndex: command.messageIndex } : {}) };
  await f.call('page:prepared', { ...context, ok: true }, f.sender);
  await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  f.snapshot.chat.editorText = command.text;
  return context;
}

test('双消息逐条提交，旧话术授权或提交包不能误发链接，链接完成后才结束', async () => {
  const f = fixture(), productLink = 'https://shopee.co.id/product/1/2';
  const context = await beginSend(f, { productLink });
  await f.call('page:authorize', context, f.sender);
  assert.equal((await f.call('page:commit', context, f.sender)).committed, true);
  assert.equal(f.data().creatorQueue.task.status, 'running');
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 1);
  const second = (await f.call('page:poll', { pageId: 'page-1' }, f.sender)).command;
  assert.equal(second.text, productLink);
  f.snapshot.chat.editorText = productLink;
  assert.equal((await f.call('page:authorize', context, f.sender)).command, null);
  const next = { ...context, text: productLink, messageIndex: second.messageIndex };
  assert.equal((await f.call('page:authorize', next, f.sender)).command?.type, 'permit');
  assert.equal((await f.call('page:commit', context, f.sender)).committed, false);
  assert.equal((await f.call('page:commit', next, f.sender)).committed, true);
  assert.equal(f.commits(), 2);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'sent');
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 2);
  assert.equal((await f.call('page:commit', next, f.sender)).committed, false);
});

test('预览后替换产品链接也必须重新预览', async () => {
  const f = fixture(); await f.connect();
  const config = { ...f.config, productLink: 'https://shopee.co.id/product/1/2' };
  const p = await f.call('panel:preview', { config });
  await assert.rejects(f.call('panel:start', { config: { ...config, productLink: 'https://shopee.co.id/product/3/4' }, previewToken: p.previewToken }), /预览/);
});

test('双消息第一条点击后保存失败，重启只保留待核对记录，不推进链接或重发话术', async () => {
  const f = fixture(), context = await beginSend(f, { productLink: 'https://shopee.co.id/product/1/2' });
  await f.call('page:authorize', context, f.sender);
  f.failAfterClick();
  await assert.rejects(f.call('page:commit', context, f.sender), /存储/);
  assert.equal(f.commits(), 1);
  f.recoverStorage();
  const restarted = createBackend(f.api, { readSnapshot: async () => f.snapshot });
  const report = await restarted.handle({ type: 'panel:get' }, { id: 'demo', url: f.api.runtime.getURL('dashboard.html') });
  assert.equal(report.state.task.items[0].status, 'uncertain');
  assert.equal(report.state.task.items[0].submittedCount, 0);
  assert.equal(report.workspace.receipt.claimed, true);
  await restarted.handle({ type: 'page:hello', pageId: 'page-2' }, f.sender);
  const checked = await restarted.handle({ type: 'panel:get' }, { id: 'demo', url: f.api.runtime.getURL('dashboard.html') });
  assert.equal(checked.state.task.items[0].status, 'uncertain');
  assert.equal(f.commits(), 1);
});

test('双消息排查日志保留逐条进度，不包含链接内容', async () => {
  const f = fixture(), context = await beginSend(f, { productLink: 'https://shopee.co.id/product/987/654' });
  await f.call('page:authorize', context, f.sender);
  await f.call('page:commit', context, f.sender);
  const { diagnostics } = await f.call('panel:export-diagnostics');
  assert.equal(diagnostics.summary.workspace.submittedCount, 1);
  assert.equal(diagnostics.summary.workspace.messageIndex, 1);
  assert.equal(diagnostics.events.some(e => e.context.submittedCount === 1), true);
  assert.equal(JSON.stringify(diagnostics).includes('987/654'), false);
});

test('真实发送须明确确认，许可返回前已保存发送意图和授权状态', async () => {
  const f = fixture(); await f.connect();
  const config = { ...f.config, mode: 'send' };
  const preview = await f.call('panel:preview', { config });
  await assert.rejects(f.call('panel:start', { config, previewToken: preview.previewToken }), /确认/);
  const g = fixture(), context = await beginSend(g);
  assert.equal(g.data().creatorQueue.history['10']['20'].status, 'uncertain');
  assert.equal((await g.call('page:authorize', context, g.sender)).command.type, 'permit');
  assert.equal(g.data().creatorQueue.task.items[0].authorized, true);
  assert.equal((await g.call('page:authorize', context, g.sender)).command, null);
});

test('没有受控提交时，发送端自报成功不能推进真实任务', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender);
  await f.call('page:result', { ...context, outcome: 'sent', baselineIds: [] }, f.sender);
  const { state } = await f.call('panel:get');
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].status, 'uncertain');
});

test('受控点击完成后后台立即保存提交结果，不要求消息回执或页面二次报告', async () => {
  const f = fixture(), context = await beginSend(f);
  f.snapshot.chat.latestMessageId = null; f.snapshot.chat.evidenceSupported = false;
  assert.equal((await f.call('page:authorize', context, f.sender)).command?.type, 'permit');
  const reply = await f.call('page:commit', context, f.sender);
  assert.equal(reply.committed, true);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'sent');
  assert.equal(f.data().creatorQueue.task.status, 'completed');
  assert.equal(f.data().creatorQueue.history['10']['20'].status, 'confirmed');
  assert.equal((await f.call('page:commit', context, f.sender)).committed, false);
  assert.equal(f.commits(), 1);
});

test('发送准备后加入拒绝名单仍阻止最终授权', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('panel:deny', { shopId: '10', creatorId: '20', name: 'Ayu', blocked: true });
  assert.equal((await f.call('page:authorize', context, f.sender)).command, null);
  assert.equal(f.data().creatorQueue.task.status, 'paused');
});

test('切换账号后暂停旧任务并拒绝在新店铺恢复', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender);
  f.snapshot.shop = { id: '11', name: '另一示例店铺' };
  await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  const { state, workspace } = await f.call('panel:get');
  assert.equal(state.task.status, 'paused'); assert.equal(state.task.items[0].status, 'uncertain');
  assert.equal(workspace.shop.id, '11');
  await assert.rejects(f.call('panel:resume'), /店铺/);
});

test('已暂停任务可明确结束，保留防重发记录后才能建立新任务', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender);
  await f.call('page:result', { ...context, outcome: 'uncertain' }, f.sender);
  await assert.rejects(f.call('panel:finish'), /核对/);
  const unresolvedTask = f.data().creatorQueue.task;
  await f.call('panel:resolve', { taskId: unresolvedTask.id, sessionId: unresolvedTask.sessionId, itemId: '20', resolution: 'skip' });
  const { state } = await f.call('panel:finish');
  assert.equal(state.task.status, 'completed');
  assert.equal(state.history['10']['20'].status, 'uncertain');
});

test('Chrome 重启或扩展重载后，不按旧标签页编号注入用户其他标签页', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  f.restartSession();
  const restarted = createBackend(f.api, { readSnapshot: async () => f.snapshot });
  const result = await restarted.handle({ type: 'panel:get' }, { id: 'demo', url: f.api.runtime.getURL('dashboard.html') });
  assert.equal(result.workspace, null);
  assert.equal(result.state.task.status, 'paused');
});

test('最终提交先保存单次声明，重复提交或暂停后提交不会再次执行', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender);
  assert.equal((await f.call('page:commit', context, f.sender)).committed, true);
  assert.equal((await f.call('page:commit', context, f.sender)).committed, false);
  assert.equal(f.commits(), 1);
  const g = fixture(), next = await beginSend(g);
  await g.call('page:authorize', next, g.sender);
  await g.call('panel:pause');
  assert.equal((await g.call('page:commit', next, g.sender)).committed, false);
  assert.equal(g.commits(), 0);
  assert.equal(g.data().creatorQueue.task.status, 'paused');
  assert.equal(g.data().creatorQueue.task.items[0].status, 'uncertain');
});

test('收件人或原文档身份变化时不能取得真实发送许可', async () => {
  const f = fixture(), context = await beginSend(f);
  f.snapshot.chat.recipientId = '21';
  assert.equal((await f.call('page:authorize', context, f.sender)).command, null);
  const g = fixture(), next = await beginSend(g);
  g.snapshot.documentEpoch = 456;
  assert.equal((await g.call('page:authorize', next, g.sender)).command, null);
  const h = fixture(); await h.connect();
  await assert.rejects(h.call('page:poll', { pageId: 'page-1' }, { ...h.sender, documentId: 'doc-2' }), /文档/);
});

test('没有受控提交时旧版页面自报sent或failed均不能冒充成功；已提交不被迟到结果撤销', async () => {
  for (const outcome of ['sent', 'failed']) {
    const f = fixture(), context = await beginSend(f);
    await f.call('page:authorize', context, f.sender);
    await f.call('page:result', { ...context, outcome }, f.sender);
    assert.equal(f.data().creatorQueue.task.items[0].status, 'uncertain');
  }
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender); await f.call('page:commit', context, f.sender);
  await f.call('page:result', { ...context, outcome: 'uncertain' }, f.sender);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'sent');
  assert.equal(f.data().creatorQueue.task.status, 'completed');
});

test('点击提交已持久化但content回包丢失时，重启不重发且按原间隔处理下一位', async () => {
  const f = fixture();
  f.snapshot.creators.push({ id: '21', name: 'Budi', rowKey: '1_100', chatAvailable: true });
  f.config.limit = 2;
  const context = await beginSend(f);
  await f.call('page:authorize', context, f.sender); await f.call('page:commit', context, f.sender);
  assert.equal(f.data().creatorQueue.task.status, 'running');
  assert.equal((await f.call('page:poll', { pageId: 'page-1' }, f.sender)).command, null);
  const restarted = createBackend(f.api, { readSnapshot: async () => f.snapshot, now: () => 31000 });
  assert.equal((await restarted.handle({ type: 'page:commit', ...context }, f.sender)).committed, false);
  const next = await restarted.handle({ type: 'page:poll', pageId: 'page-1' }, f.sender);
  assert.equal(next.command.itemId, '21');
  assert.equal(next.command.type, 'prepare');
  assert.equal(f.commits(), 1);
});

test('最终点击后回包丢失或后台重新实例化，均不再次提交', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender);
  f.loseReply();
  assert.equal((await f.call('page:commit', context, f.sender)).committed, false);
  await f.call('page:commit', context, f.sender);
  assert.equal(f.commits(), 1);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'uncertain');
  assert.equal(f.data().creatorQueue.history['10']['20'].status, 'uncertain');
  const g = fixture(), next = await beginSend(g);
  await g.call('page:authorize', next, g.sender);
  await g.call('page:commit', next, g.sender);
  const restarted = createBackend(g.api, { readSnapshot: async () => g.snapshot, now: () => 1000 });
  assert.equal((await restarted.handle({ type: 'page:commit', ...next }, g.sender)).committed, false);
  assert.equal(g.commits(), 1);
});

test('提交声明存储失败时不能点击；生产注入精确指定原文档', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender);
  f.fail();
  await assert.rejects(f.call('page:commit', context, f.sender), /保存|存储/);
  assert.equal(f.commits(), 0);
  const g = fixture(); await g.connect();
  const injections = [];
  g.api.scripting.executeScript = async options => { injections.push(options); return [{ documentId: 'doc-1', result: structuredClone(g.snapshot) }]; };
  const backend = createBackend(g.api);
  await backend.handle({ type: 'page:snapshot', pageId: 'page-1' }, g.sender);
  assert.deepEqual(injections[0].target, { tabId: 7, documentIds: ['doc-1'] });
  g.api.scripting.executeScript = async () => [{ documentId: 'doc-2', result: structuredClone(g.snapshot) }];
  await assert.rejects(backend.handle({ type: 'page:snapshot', pageId: 'page-1' }, g.sender), /文档/);
});

test('点击后结果写盘失败时停止推进；重启保留声明转待核对，不重复点击', async () => {
  const f = fixture(), context = await beginSend(f);
  await f.call('page:authorize', context, f.sender); f.failAfterClick();
  await assert.rejects(f.call('page:commit', context, f.sender), /存储|保存/);
  assert.equal(f.commits(), 1);
  assert.equal(f.data().creatorWorkspace.receipt.claimed, true);
  assert.equal(f.data().creatorWorkspace.receipt.committed, false);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'sending');
  await assert.rejects(f.call('page:poll', { pageId: 'page-1' }, f.sender), /存储|保存/);
  f.recoverStorage();
  const restarted = createBackend(f.api, { readSnapshot: async () => f.snapshot, now: () => 47000 });
  const status = await restarted.handle({ type: 'panel:get' }, { id: 'demo', url: f.api.runtime.getURL('dashboard.html') });
  assert.equal(status.state.task.status, 'paused');
  assert.equal(status.state.task.items[0].status, 'uncertain');
  await restarted.handle({ type: 'page:commit', ...context }, f.sender);
  assert.equal(f.commits(), 1);
});

test('首次连接时店铺尚未就绪，登录后可直接准备名单，不需要刷新或轮询读取', async () => {
  const f = fixture();
  f.snapshot.shop = null;
  await f.connect();
  const waiting = await f.call('panel:get');
  assert.match(waiting.workspace.error, /店铺/);
  assert.equal(waiting.workspace.shop, null);
  assert.equal(waiting.workspace.documentEpoch, 123);
  await assert.rejects(f.call('panel:preview', { config: f.config }), /店铺/);
  f.snapshot.shop = f.config.shop;
  f.snapshot.list = { supported: true, hasMore: false, loading: false };
  const ready = await f.call('panel:collect', { targetCount: 1 });
  assert.deepEqual(ready.workspace.shop, f.config.shop);
  assert.deepEqual(ready.workspace.creators, f.config.creators);
  assert.equal(ready.workspace.error, null);
  assert.equal(ready.workspace.collection.status, 'ready');
  assert.equal(ready.workspace.collection.binding.shopId, f.config.shop.id);
});

test('等待店铺就绪期间仍拒绝文档或页面时间基准变化', async () => {
  const f = fixture();
  f.snapshot.shop = null;
  await f.connect();
  f.snapshot.shop = f.config.shop;
  f.snapshot.documentEpoch = 456;
  await assert.rejects(f.call('panel:collect', { targetCount: 1 }), /文档/);
  await assert.rejects(f.call('page:poll', { pageId: 'page-1' }, { ...f.sender, documentId: 'doc-2' }), /文档/);
});

test('首次连接缺少有效页面时间基准时仍不能绑定或读取', async () => {
  for (const epoch of [null, undefined, 0, NaN, Infinity]) {
    const f = fixture();
    f.snapshot.documentEpoch = epoch;
    await f.connect();
    const invalid = await f.call('panel:get');
    assert.equal(invalid.workspace.documentEpoch, null);
    assert.match(invalid.workspace.error, /文档/);
    f.snapshot.documentEpoch = 123;
    await assert.rejects(f.call('panel:collect', { targetCount: 1 }), /文档/);
  }
});

test('筛选触发loading但复用原文档时，重连先停止旧执行器再注入，旧回调不能恢复任务', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  await f.backend.onUpdated(7, { status: 'loading' });
  const controller = { stopped: false }, calls = [];
  f.api.scripting.executeScript = async options => {
    calls.push(options);
    if (options.func && options.world !== 'MAIN') vm.runInNewContext(`(${options.func.toString()})(...${JSON.stringify(options.args)})`, { __creatorOutreachPage: controller });
    if (options.files) assert.equal(controller.stopped, true);
    return [];
  };
  await f.backend.onUpdated(7, { status: 'complete' });
  assert.equal(controller.stopped, true);
  assert.ok(calls.some(options => options.world === 'MAIN' && options.func?.name === 'inspectFilters'));
  assert.equal(calls.at(-1).files[0], 'content.js');
  await f.call('page:hello', { pageId: 'page-2' }, f.sender);
  const status = await f.call('panel:get');
  assert.equal(status.workspace.pageId, 'page-2');
  assert.equal(status.state.task.status, 'paused');
  assert.equal((await f.call('page:poll', { pageId: 'page-1' }, f.sender)).command, null);
});

test('工作台轮询发现专用页已complete但绑定为空时自动重连，不需要额外读取步骤', async () => {
  const f = fixture(); await f.connect();
  await f.backend.onUpdated(7, { status: 'loading' });
  let injections = 0;
  f.api.scripting.executeScript = async () => { injections++; return []; };
  await f.call('panel:get');
  assert.ok(injections > 0);
  const waiting = injections;
  await f.call('panel:get');
  assert.equal(injections, waiting); // One hello may still be queued.
  await f.call('page:hello', { pageId: 'page-2' }, f.sender);
  const count = injections;
  const status = await f.call('panel:get');
  assert.equal(status.workspace.pageId, 'page-2');
  assert.equal(status.workspace.error, null);
  assert.equal(injections, count);
});

test('连接失败会显示原因，页面仍在loading时不反复注入', async () => {
  const f = fixture(); await f.connect(); await f.backend.onUpdated(7, { status: 'loading' });
  let injections = 0;
  f.api.tabs.get = async () => ({ url: f.sender.url, status: 'loading' });
  f.api.scripting.executeScript = async () => { injections++; throw new Error('页面暂不允许注入'); };
  await f.call('panel:get');
  assert.equal(injections, 0);
  f.api.tabs.get = async () => ({ url: f.sender.url, status: 'complete' });
  await f.call('panel:get');
  const status = await f.call('panel:get');
  assert.match(status.workspace.error, /连接|注入/);
  assert.equal(injections, 1);
});

test('自动重连不对外域注入；用户重试可解除连接失败状态', async () => {
  const f = fixture(); await f.connect(); await f.backend.onUpdated(7, { status: 'loading' });
  let injections = 0;
  f.api.tabs.get = async () => ({ url: 'https://example.com/', status: 'complete' });
  f.api.scripting.executeScript = async () => { injections++; return []; };
  const blocked = await f.call('panel:get');
  assert.match(blocked.workspace.error, /印尼卖家站/);
  assert.equal(injections, 0);
  f.api.tabs.get = async () => ({ url: f.sender.url, status: 'complete' });
  await f.call('panel:open');
  assert.ok(injections > 0);
  await f.call('page:hello', { pageId: 'page-2' }, f.sender);
  assert.equal((await f.call('panel:get')).workspace.error, null);
});

test('排查日志在暂停恢复、后台重建和新任务后仍保留原因，导出不暴露正文或身份', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  const { command } = await f.call('page:poll', { pageId: 'page-1', visibility: 'hidden', online: true }, f.sender);
  await f.call('page:error', { pageId: 'page-1', itemId: command.itemId, stage: 'prepare', error: { name: 'Error', message: '等待聊天页面超时' }, visibility: 'hidden', online: true }, f.sender);
  await f.call('panel:resume'); await f.call('panel:pause'); await f.call('panel:finish');
  const nextPreview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: nextPreview.previewToken });
  const restarted = createBackend(f.api, { readSnapshot: async () => f.snapshot, now: () => 2000 });
  const report = (await restarted.handle({ type: 'panel:export-diagnostics' }, { id: 'demo', url: f.api.runtime.getURL('dashboard.html') })).diagnostics;
  const error = report.events.find(e => e.event === 'page:error');
  assert.equal(error.stage, 'prepare'); assert.equal(error.error.message, '等待聊天页面超时');
  assert.equal(error.context.itemIndex, 1); assert.equal(error.context.visibility, 'hidden');
  assert.ok(report.events.some(e => e.event === 'panel:resume'));
  assert.ok(report.events.filter(e => e.event === 'task:state' && e.to === 'running').length >= 3);
  assert.ok(report.events.some(e => e.event === 'task:state' && e.to === 'paused'));
  const serialized = JSON.stringify(report);
  for (const privateValue of ['Halo', 'Ayu', '示例店铺', 'seller.shopee.co.id', 'page-1', 'doc-1']) assert.equal(serialized.includes(privateValue), false, privateValue);
});

test('超时日志保留心跳与动作耗时及可见性；诊断导出本身不使运行任务超时', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  await f.call('page:poll', { pageId: 'page-1', visibility: 'hidden', online: false }, f.sender);
  f.advance(46000);
  const before = structuredClone(f.data());
  const first = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.equal(first.summary.task.status, 'running');
  assert.deepEqual(f.data().creatorQueue, before.creatorQueue);
  assert.deepEqual(f.data().creatorWorkspace, before.creatorWorkspace);
  // 隐藏标签页约每分钟才有一次心跳，两拍之内不算失联。
  await f.call('panel:get');
  assert.equal((await f.call('panel:export-diagnostics')).diagnostics.summary.task.status, 'running');
  f.advance(105000);
  await f.call('panel:get');
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  const timeout = report.events.find(e => e.event === 'page:timeout');
  assert.equal(timeout.context.sinceLastSeenMs, 151000);
  assert.equal(timeout.context.actionAgeMs, 151000);
  assert.equal(timeout.context.visibility, 'hidden'); assert.equal(timeout.context.online, false);
  assert.equal(report.summary.task.status, 'paused');
});

test('可见页面静默超过45秒即暂停，隐藏页不因节流被判超时', async () => {
  const visible = fixture(); await visible.connect();
  const preview = await visible.call('panel:preview', { config: visible.config });
  await visible.call('panel:start', { config: visible.config, previewToken: preview.previewToken });
  await visible.call('page:poll', { pageId: 'page-1', visibility: 'visible' }, visible.sender);
  visible.advance(46000);
  await visible.call('panel:get');
  assert.equal((await visible.call('panel:export-diagnostics')).diagnostics.summary.task.status, 'paused');

  const hidden = fixture(); await hidden.connect();
  const second = await hidden.call('panel:preview', { config: hidden.config });
  await hidden.call('panel:start', { config: hidden.config, previewToken: second.previewToken });
  await hidden.call('page:poll', { pageId: 'page-1', visibility: 'hidden' }, hidden.sender);
  hidden.advance(46000);
  await hidden.call('panel:get');
  assert.equal((await hidden.call('panel:export-diagnostics')).diagnostics.summary.task.status, 'running');
});

test('日志存储故障不阻止受控提交；业务存储故障后也能导出诊断', async () => {
  const f = fixture(), context = await beginSend(f);
  const originalSet = f.api.storage.local.set;
  f.api.storage.local.set = async values => {
    if (Object.hasOwn(values, 'creatorDiagnostics')) throw new Error('log disk failure');
    return originalSet(values);
  };
  await f.call('page:authorize', context, f.sender);
  await f.call('page:commit', context, f.sender);
  assert.equal(f.commits(), 1); assert.equal(f.data().creatorQueue.task.items[0].status, 'sent');
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.equal(report.persistence.healthy, false);
  assert.ok(report.events.some(e => e.event === 'diagnostics:storage-error'));
  f.fail(); await assert.rejects(f.call('panel:deny', { shopId: '10', creatorId: '20', blocked: true }), /存储|保存/);
  const fault = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.equal(fault.summary.storageFaulted, true);
  assert.ok(fault.events.some(e => e.event === 'storage:error'));
  assert.equal(f.commits(), 1);
});

test('历史日志有界且再次过滤，任意异常文本、凭证及额外字段不进入排查文件', async () => {
  const f = fixture();
  const secret = 'test-secret-not-a-real-credential';
  f.data().creatorDiagnostics = { version: 1, dropped: 0, events: Array.from({ length: 3005 }, (_, i) => ({ at: i, event: 'panel:pause', token: secret, error: { name: secret, message: secret }, context: { text: secret, visibility: 'visible' } })) };
  await f.connect();
  await f.call('page:error', { pageId: 'page-1', stage: secret, error: { name: 'TypeError', message: `Authorization: Bearer ${secret}` }, text: secret }, f.sender);
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.ok(report.events.length > 0 && report.events.length <= 3000); assert.ok(report.dropped >= 5);
  assert.equal(report.limit, 3000); assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.events.at(-1).error?.name, 'TypeError');
  await assert.rejects(f.call('panel:export-diagnostics', {}, f.sender), /工作台/);
});

test('日志写盘一直未返回时不阻塞授权、提交或导出，迟到写盘不覆盖后续事件', { timeout: 2000 }, async () => {
  const f = fixture(), context = await beginSend(f);
  await new Promise(resolve => setImmediate(resolve));
  const originalSet = f.api.storage.local.set;
  let release, pending = true;
  const gate = new Promise(resolve => { release = resolve; });
  f.api.storage.local.set = async values => {
    if (Object.hasOwn(values, 'creatorDiagnostics') && pending) { pending = false; await gate; }
    await originalSet(values);
  };
  try {
    assert.equal((await f.call('page:authorize', context, f.sender)).command.type, 'permit');
    assert.equal((await f.call('page:commit', context, f.sender)).committed, true);
    const report = (await f.call('panel:export-diagnostics')).diagnostics;
    assert.equal(report.summary.task.status, 'completed');
    assert.equal(report.persistence.unsaved, true); assert.equal(f.commits(), 1);
  } finally { release(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.data().creatorDiagnostics.events.some(e => e.event === 'item:state' && e.to === 'sent'));
  assert.ok(f.data().creatorDiagnostics.events.some(e => e.event === 'task:state' && e.to === 'completed'));
});

test('空或损坏的旧日志不会影响业务，空闲轮询不产生重复事件', async () => {
  const f = fixture();
  f.data().creatorDiagnostics = { version: 1, events: [null, {}, { event: 'panel:pause', at: 1, context: null }, { event: 'panel:stop', at: 2, context: { arbitrary: 'drop' } }] };
  await f.connect();
  await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  const first = (await f.call('panel:export-diagnostics')).diagnostics;
  for (let i = 0; i < 4; i++) { await f.call('page:poll', { pageId: 'page-1' }, f.sender); await f.call('panel:get'); }
  const next = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.equal(next.events.length, first.events.length);
  assert.equal(next.summary.workspace.pageBound, true);
  assert.equal(JSON.stringify(next).includes('arbitrary'), false);
});

test('专用页地址不可见时按目标来源切回，不抛 Invalid URL', async () => {
  const f = fixture(); await f.connect();
  await f.backend.onUpdated(7, { status: 'loading' });
  const updates = [];
  f.api.tabs.update = async (id, props) => { updates.push({ id, ...props }); return { id, windowId: 1 }; };
  // 未申请 tabs 权限：离开卖家站后 Chrome 不再提供 tab.url。
  f.api.tabs.get = async id => ({ id, status: 'complete' });
  const blocked = await f.call('panel:get');
  assert.match(blocked.workspace.error, /印尼卖家站/);
  assert.equal(blocked.workspace.error.includes('Invalid URL'), false);
  assert.equal(updates.length, 0);
  const reply = await f.call('panel:open', { source: { type: 'marketplace' } });
  assert.deepEqual(updates, [{ id: 7, url: 'https://seller.shopee.co.id/portal/web-seller-affiliate/kol_marketplace', active: false }]);
  assert.equal(reply.workspace.pageId, null);
  assert.equal(reply.workspace.documentId, null);
  f.api.tabs.get = async id => ({ id, url: f.sender.url, status: 'complete' });
  await f.call('page:hello', { pageId: 'page-2' }, f.sender);
  assert.equal((await f.call('panel:get')).workspace.error, null);
});

test('准备阶段的慢导航不被短超时打断，动作耗时超出准备预算后仍会中断', async () => {
  const f = fixture(); await f.connect();
  const preview = await f.call('panel:preview', { config: f.config });
  await f.call('panel:start', { config: f.config, previewToken: preview.previewToken });
  const { command } = await f.call('page:poll', { pageId: 'page-1' }, f.sender);
  assert.equal(command.type, 'prepare');
  // 页面持续心跳（每次 poll 都在 45 秒内），动作耗时依次到 20s、40s、60s。
  for (const step of [20000, 20000, 20000]) { f.advance(step); await f.call('page:poll', { pageId: 'page-1' }, f.sender); }
  const running = await f.call('panel:get');
  assert.equal(running.state.task.status, 'running');
  assert.equal(f.data().creatorQueue.task.items[0].status, 'preparing');
  f.advance(31000);
  const timedOut = await f.call('panel:get');
  assert.equal(timedOut.state.task.status, 'paused');
  assert.match(timedOut.state.task.reason, /超时/);
});

test('两份工作台各自持有预览令牌，互不作废且不能混用', async () => {
  const f = fixture(); await f.connect();
  const panelA = { id: 'demo', url: f.api.runtime.getURL('dashboard.html'), tab: { id: 11 } };
  const panelB = { id: 'demo', url: f.api.runtime.getURL('dashboard.html'), tab: { id: 12 } };
  const a = await f.call('panel:preview', { config: f.config }, panelA);
  const b = await f.call('panel:preview', { config: f.config }, panelB);
  assert.notEqual(a.previewToken, b.previewToken);
  await assert.rejects(f.call('panel:start', { config: f.config, previewToken: a.previewToken }, panelB), /预览/);
  await assert.rejects(f.call('panel:start', { config: f.config }, panelA), /预览/);
  const started = await f.call('panel:start', { config: f.config, previewToken: a.previewToken }, panelA);
  assert.equal(started.state.task.status, 'running');
  await assert.rejects(f.call('panel:start', { config: f.config, previewToken: b.previewToken }, panelB), /任务|预览/);
});
