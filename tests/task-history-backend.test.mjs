import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

function oldTask(id = 'old-task', extra = {}) {
  return {
    id, sessionId: 'old-session', binding: { tabId: 7, pageId: 'page' }, status: 'completed', reason: null,
    createdAt: 1000, updatedAt: 1100, nextAt: 1100,
    config: { shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu' }], template: 'Halo {{name}}', intervalSeconds: 30, limit: 1, mode: 'dry-run' },
    items: [{ id: '20', name: 'Ayu', text: 'Halo Ayu', status: 'rehearsed', reason: null, authorized: true }],
    ...extra,
  };
}

function archivedTask(id) {
  const task = oldTask(id);
  const { creators, ...config } = task.config;
  return { id, status: task.status, reason: null, createdAt: task.createdAt, updatedAt: task.updatedAt, config,
    items: [{ id: '20', name: 'Ayu', status: 'rehearsed', reason: null, submittedCount: 0, messageCount: 1 }] };
}

function fixture(seed = {}) {
  let data = structuredClone(seed), sessionReads = 0, sessionWrites = 0, injections = 0, snapshots = 0, clicks = 0, counter = 0, clock = 3000;
  let failure = null;
  const reads = [], writes = [];
  const page = { documentEpoch: 123, origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', shop: { id: '10', name: '示例店铺' },
    creators: [{ id: '20', name: 'Ayu', rowKey: '0_99', chatAvailable: true }], blocked: false,
    chat: { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, sendReady: true, editorText: '', evidenceSupported: true, messages: [] } };
  const api = {
    runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` },
    storage: {
      local: {
        get: async keys => { reads.push(structuredClone(keys)); return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])); },
        set: async values => { writes.push(Object.keys(values)); if (failure?.(values)) throw new Error('disk'); data = { ...data, ...structuredClone(values) }; },
      },
      session: { get: async () => { sessionReads++; return { creatorBrowserSession: 'browser' }; }, set: async () => { sessionWrites++; } },
    },
    tabs: { create: async () => ({ id: 7 }), get: async () => ({ url: page.origin, status: 'complete' }) },
    scripting: { executeScript: async () => { injections++; return []; } },
  };
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') }, historyPanel = { id: 'demo', url: api.runtime.getURL('history.html') };
  const sender = { id: 'demo', documentId: 'doc', tab: { id: 7 }, frameId: 0, url: page.origin };
  const makeBackend = () => createBackend(api, { now: () => clock, uid: () => `new-${++counter}`, readSnapshot: async (_tab, _text, _doc, commit) => {
    snapshots++; if (commit) clicks++;
    return { ...structuredClone(page), ...(commit ? { commit: { clicked: true } } : {}) };
  } });
  let backend = makeBackend();
  const call = (type, body = {}, from = panel) => backend.handle({ type, ...body }, from);
  return { api, panel, historyPanel, sender, page, call, data: () => data, reads, writes,
    activity: () => ({ sessionReads, sessionWrites, injections, snapshots, clicks }),
    businessWrites: () => writes.filter(keys => keys.includes('creatorQueue') || keys.includes('creatorWorkspace')).length,
    archiveWrites: () => writes.filter(keys => keys.includes('creatorTaskHistory')).length,
    fail: predicate => { failure = predicate; }, advance: ms => { clock += ms; },
    restart: () => { backend = makeBackend(); }, replaceQueue: queue => { data.creatorQueue = structuredClone(queue); },
  };
}

function seeded(task = oldTask(), extra = {}) {
  return fixture({ creatorQueue: { version: 1, task, history: {}, denied: {} },
    creatorWorkspace: { browserSessionId: 'browser', tabId: 7, pageId: 'page', documentId: 'doc', documentEpoch: 123, shop: { id: '10', name: '示例店铺' }, creators: [], lastSeen: 3000 }, ...extra });
}

async function preview(f, extra = {}) {
  const config = { ...oldTask().config, ...extra };
  const reply = await f.call('panel:preview', { config });
  return { config, previewToken: reply.previewToken, ...(config.mode === 'send' ? { confirmed: true } : {}) };
}

async function completeDryRun(f) {
  const { command } = await f.call('page:poll', { pageId: 'page' }, f.sender);
  const context = { pageId: 'page', taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId };
  await f.call('page:prepared', { ...context, ok: true }, f.sender);
  await f.call('page:poll', { pageId: 'page' }, f.sender);
  await f.call('page:authorize', context, f.sender);
  await f.call('page:result', { ...context, outcome: 'rehearsed' }, f.sender);
  assert.equal(f.data().creatorQueue.task.status, 'completed');
}

test('旧记录可由历史页首次读取、详情和单条导出，且不初始化、过期或重连', async () => {
  const f = seeded(oldTask('legacy', { status: 'running' }));
  f.advance(60000);
  const before = structuredClone(f.data());
  const list = await f.call('panel:history-list', {}, f.historyPanel);
  assert.equal(list.taskHistory.total, 1);
  assert.equal(list.taskHistory.tasks[0].id, 'legacy');
  assert.equal(list.taskHistory.tasks[0].status, 'running');
  const detail = await f.call('panel:history-detail', { taskId: 'legacy' }, f.historyPanel);
  assert.equal(detail.taskRecord.config.template, 'Halo {{name}}');
  assert.equal(detail.taskRecord.items[0].messageCount, 1);
  assert.equal(Object.hasOwn(detail.taskRecord, 'binding'), false);
  assert.equal(Object.hasOwn(detail.taskRecord, 'sessionId'), false);
  const exported = await f.call('panel:history-export', { taskId: 'legacy' }, f.historyPanel);
  assert.deepEqual(exported.taskHistoryExport.tasks.map(task => task.id), ['legacy']);
  assert.deepEqual(f.activity(), { sessionReads: 0, sessionWrites: 0, injections: 0, snapshots: 0, clicks: 0 });
  assert.deepEqual(f.data(), before);
  assert.equal(f.writes.length, 0);
  assert.ok(f.reads.every(keys => !keys.includes('creatorWorkspace') && !keys.includes('creatorDiagnostics')));
  await assert.rejects(f.call('panel:history-detail', { taskId: 'missing' }, f.historyPanel), /任务|记录/);
});

test('空历史无需初始化，历史页仅可读，伪造来源和带参数地址不能取得权限', async () => {
  const f = fixture();
  assert.equal((await f.call('panel:history-list', {}, f.historyPanel)).taskHistory.total, 0);
  assert.deepEqual((await f.call('panel:history-export', {}, f.panel)).taskHistoryExport.tasks, []);
  for (const from of [{ ...f.historyPanel, id: 'other' }, { ...f.historyPanel, url: `${f.historyPanel.url}?x=1` }, { ...f.historyPanel, url: 'https://example.com/history.html' }]) {
    await assert.rejects(f.call('panel:history-list', {}, from), /允许|工作台|历史/);
  }
  for (const type of ['panel:get', 'panel:start', 'panel:pause', 'panel:export-diagnostics']) await assert.rejects(f.call(type, {}, f.historyPanel), /工作台/);
  assert.equal(f.businessWrites(), 0);
});

test('历史页越权调用队列指令在初始化前拒绝，不改变重启后的旧任务', async () => {
  const f = seeded(oldTask('running-old', { status: 'running' }));
  f.data().creatorWorkspace.browserSessionId = 'previous-browser';
  const before = structuredClone(f.data());
  await assert.rejects(f.call('panel:get', {}, f.historyPanel), /工作台/);
  assert.deepEqual(f.data(), before);
  assert.equal(f.activity().sessionReads, 0);
  assert.equal(f.writes.length, 0);
});

test('连续任务在替换前归档且重启去重，演练执行链不额外读取或写入历史', async () => {
  const f = seeded();
  await f.call('panel:start', await preview(f));
  assert.deepEqual(f.data().creatorTaskHistory.tasks.map(task => task.id), ['old-task']);
  const firstId = f.data().creatorQueue.task.id;
  const historyReads = f.reads.filter(keys => keys.includes('creatorTaskHistory')).length, archiveWrites = f.archiveWrites();
  await completeDryRun(f);
  assert.equal(f.archiveWrites(), archiveWrites);
  assert.equal(f.reads.filter(keys => keys.includes('creatorTaskHistory')).length, historyReads);
  await f.call('panel:start', await preview(f));
  assert.deepEqual(new Set(f.data().creatorTaskHistory.tasks.map(task => task.id)), new Set(['old-task', firstId]));
  await f.call('panel:pause');
  await f.call('panel:finish');
  const secondId = f.data().creatorQueue.task.id;
  await f.call('panel:start', await preview(f));
  assert.ok(f.data().creatorTaskHistory.tasks.some(task => task.id === secondId));
  f.restart();
  const list = (await f.call('panel:history-list', {}, f.historyPanel)).taskHistory;
  assert.equal(list.total, 4);
  assert.equal(new Set(list.tasks.map(task => task.id)).size, 4);
  assert.equal(f.activity().clicks, 0);
});

test('归档写失败保留旧任务与预览令牌，恢复后同一启动请求可重试', async () => {
  const f = seeded(), start = await preview(f), before = structuredClone(f.data().creatorQueue);
  f.fail(values => Object.hasOwn(values, 'creatorTaskHistory'));
  await assert.rejects(f.call('panel:start', start), /归档|历史|保存|存储/);
  assert.deepEqual(f.data().creatorQueue, before);
  assert.equal(f.data().creatorTaskHistory, undefined);
  assert.equal((await f.call('panel:history-list')).taskHistory.total, 1);
  f.fail(null);
  const result = await f.call('panel:start', start);
  assert.equal(result.state.task.status, 'running');
  assert.deepEqual(f.data().creatorTaskHistory.tasks.map(task => task.id), ['old-task']);
  assert.equal(f.activity().clicks, 0);
});

test('归档成功后业务保存失败保持原故障语义，历史去重且故障时仍能读导出', async () => {
  const f = seeded(), start = await preview(f), before = structuredClone(f.data().creatorQueue);
  f.fail(values => Object.hasOwn(values, 'creatorQueue'));
  await assert.rejects(f.call('panel:start', start), /存储|保存/);
  assert.deepEqual(f.data().creatorQueue, before);
  assert.deepEqual(f.data().creatorTaskHistory.tasks.map(task => task.id), ['old-task']);
  await assert.rejects(f.call('panel:get'), /存储|保存/);
  const activity = f.activity(), writes = f.businessWrites();
  const list = (await f.call('panel:history-list', {}, f.historyPanel)).taskHistory;
  assert.equal(list.total, 1);
  assert.equal((await f.call('panel:history-export', {}, f.historyPanel)).taskHistoryExport.tasks.length, 1);
  assert.deepEqual(f.activity(), activity);
  assert.equal(f.businessWrites(), writes);
  f.fail(null); f.restart();
  assert.equal((await f.call('panel:history-list')).taskHistory.total, 1);
  await f.call('panel:start', await preview(f));
  assert.equal(f.data().creatorTaskHistory.tasks.length, 1);
});

test('历史容量已满或格式损坏时不删旧数据，不替换旧任务，不锁死业务', async () => {
  for (const history of [{ version: 1, tasks: Array.from({ length: 100 }, (_, index) => archivedTask(`archive-${index}`)) }, { version: 99, tasks: [] }, { version: 1, tasks: 'broken' }]) {
    const f = seeded(oldTask(), { creatorTaskHistory: history }), start = await preview(f), before = structuredClone(f.data());
    await assert.rejects(f.call('panel:start', start), /历史|容量|记录|版本|格式|损坏|上限|100/);
    assert.deepEqual(f.data().creatorTaskHistory, before.creatorTaskHistory);
    assert.deepEqual(f.data().creatorQueue, before.creatorQueue);
    assert.equal((await f.call('panel:get')).state.task.id, 'old-task');
    assert.equal(f.activity().clicks, 0);
  }
});

test('已初始化时查询采用内存当前任务，筛选、详情、全量与单条导出一致', async () => {
  const archived = archivedTask('archived');
  archived.config.shop = { id: '11', name: '另一店铺' };
  const f = seeded(oldTask(), { creatorTaskHistory: { version: 1, tasks: [archived] } });
  const started = await f.call('panel:start', await preview(f));
  const id = started.state.task.id;
  f.replaceQueue({ version: 1, task: oldTask('stale-disk'), history: {}, denied: {} });
  f.advance(60000);
  const before = structuredClone(f.data()), activity = f.activity(), writes = f.businessWrites();
  const list = (await f.call('panel:history-list', { filters: { shopId: '10', mode: 'dry-run', status: 'running' } })).taskHistory;
  assert.deepEqual(list.tasks.map(task => task.id), [id]);
  const detail = (await f.call('panel:history-detail', { taskId: id })).taskRecord;
  assert.equal(detail.status, 'running');
  const exported = (await f.call('panel:history-export', { filters: { shopId: '10', status: 'running' } })).taskHistoryExport;
  assert.deepEqual(exported.tasks, [detail]);
  const single = (await f.call('panel:history-export', { taskId: 'archived', filters: { shopId: '10' } })).taskHistoryExport;
  assert.deepEqual(single.tasks.map(task => task.id), ['archived']);
  assert.deepEqual(f.activity(), activity);
  assert.equal(f.businessWrites(), writes);
  assert.deepEqual(f.data(), before);
});

test('真实双消息与防重发索引独立，归档结果保留两条提交数且不流入诊断', async () => {
  const task = oldTask('sent-task', { config: { ...oldTask().config, mode: 'send', productLink: 'https://shopee.co.id/product/1/2' },
    items: [{ id: '20', name: 'Ayu', text: 'Halo Ayu', messages: ['Halo Ayu', 'https://shopee.co.id/product/1/2'], messageIndex: 1, submittedCount: 2, status: 'sent', reason: null, authorized: true }] });
  const blocked = { '10': { '20': { status: 'confirmed', taskId: task.id, updatedAt: 1100, submittedCount: 2 } } };
  const f = seeded(task);
  f.replaceQueue({ version: 1, task, history: blocked, denied: { '10': { blocked: { name: '拒绝示例' } } } });
  f.page.creators = [{ id: '21', name: 'Budi', rowKey: '0_100', chatAvailable: true }];
  await f.call('panel:start', await preview(f, { creators: [{ id: '21', name: 'Budi' }] }));
  assert.deepEqual(f.data().creatorQueue.history, blocked);
  assert.deepEqual(f.data().creatorQueue.denied, { '10': { blocked: { name: '拒绝示例' } } });
  const detail = (await f.call('panel:history-detail', { taskId: task.id })).taskRecord;
  assert.equal(detail.items[0].submittedCount, 2);
  assert.equal(detail.items[0].messageCount, 2);
  assert.equal(detail.config.productLink, task.config.productLink);
  const diagnostics = JSON.stringify((await f.call('panel:export-diagnostics')).diagnostics);
  for (const privateValue of ['Halo', 'Ayu', 'Budi', '示例店铺', 'shopee.co.id/product', 'sent-task']) assert.equal(diagnostics.includes(privateValue), false, privateValue);
});

test('首个真实双消息任务启动及逐条授权提交不读写归档，损坏归档不阻断发送链', async () => {
  const f = seeded(null, { creatorTaskHistory: { version: 99, tasks: [] } });
  const malformed = structuredClone(f.data().creatorTaskHistory);
  const started = await f.call('panel:start', await preview(f, { mode: 'send', productLink: 'https://shopee.co.id/product/1/2' }));
  const { command } = await f.call('page:poll', { pageId: 'page' }, f.sender);
  const context = { pageId: 'page', taskId: started.state.task.id, sessionId: command.sessionId, itemId: command.itemId, messageIndex: 0 };
  await f.call('page:prepared', { ...context, ok: true }, f.sender);
  for (const text of ['Halo Ayu', 'https://shopee.co.id/product/1/2']) {
    const next = await f.call('page:poll', { pageId: 'page' }, f.sender);
    context.messageIndex = next.command.messageIndex;
    f.page.chat.editorText = text;
    assert.equal((await f.call('page:authorize', context, f.sender)).command.type, 'permit');
    assert.equal((await f.call('page:commit', context, f.sender)).committed, true);
  }
  assert.equal(f.data().creatorQueue.task.status, 'completed');
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 2);
  assert.equal(f.activity().clicks, 2);
  assert.equal(f.archiveWrites(), 0);
  assert.equal(f.reads.filter(keys => keys.includes('creatorTaskHistory')).length, 0);
  assert.deepEqual(f.data().creatorTaskHistory, malformed);
});

test('已初始化后的历史请求成功或失败均不写任何存储，也不记录历史错误', async () => {
  const f = seeded();
  await f.call('panel:get');
  await new Promise(resolve => setImmediate(resolve));
  const before = structuredClone(f.data()), writes = f.writes.length;
  const requests = [
    () => f.call('panel:history-list', {}, f.historyPanel),
    () => f.call('panel:history-detail', { taskId: 'old-task' }, f.historyPanel),
    () => f.call('panel:history-export', {}, f.historyPanel),
    () => f.call('panel:history-export', { taskId: 'old-task' }, f.historyPanel),
    () => assert.rejects(f.call('panel:history-list', { filters: { mode: 'invalid' } }, f.historyPanel), /筛选/),
    () => assert.rejects(f.call('panel:history-detail', { taskId: 'missing' }, f.historyPanel), /任务记录不存在/),
    () => assert.rejects(f.call('panel:history-export', { taskId: 'missing' }, f.historyPanel), /任务记录不存在/),
    () => assert.rejects(f.call('panel:history-list', {}, { ...f.historyPanel, id: 'other' }), /只允许/),
  ];
  for (const request of requests) {
    await request();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.writes.length, writes, '历史成功与失败路径均不得写入诊断或业务存储');
    assert.deepEqual(f.data(), before);
  }
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.deepEqual(report.events, before.creatorDiagnostics.events);
});

test('已有未落盘诊断日志时，历史成功与失败路径均不触发重试刷新', async () => {
  for (const request of [
    f => f.call('panel:history-list', {}, f.historyPanel),
    f => f.call('panel:history-detail', { taskId: 'old-task' }, f.historyPanel),
    f => f.call('panel:history-export', {}, f.historyPanel),
    f => assert.rejects(f.call('panel:history-list', { filters: { mode: 'invalid' } }, f.historyPanel), /筛选/),
    f => assert.rejects(f.call('panel:history-detail', { taskId: 'missing' }, f.historyPanel), /任务记录不存在/),
    f => assert.rejects(f.call('panel:history-export', { taskId: 'missing' }, f.historyPanel), /任务记录不存在/),
  ]) {
    const f = seeded();
    f.fail(values => Object.hasOwn(values, 'creatorDiagnostics'));
    await f.call('panel:get');
    await new Promise(resolve => setImmediate(resolve));
    f.fail(null); f.advance(6000);
    const before = structuredClone(f.data()), writes = f.writes.length;
    await request(f);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.writes.length, writes, '历史请求不得刷新之前积累的未落盘日志');
    assert.deepEqual(f.data(), before);
    const report = (await f.call('panel:export-diagnostics')).diagnostics;
    assert.equal(report.persistence.unsaved, true);
    assert.equal(report.events.some(event => event.event === 'operation:error'), false);
  }
});
