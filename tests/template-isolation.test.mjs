import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';
import { initialState, reduceQueue } from '../extension/core/queue.mjs';

const TEMPLATE_KEY = 'creatorMessageTemplates';
const tick = () => new Promise(resolve => setImmediate(resolve));
const draft = (name = '合作邀请') => ({ name, template: 'Halo {{name}}', productLink: 'https://shopee.co.id/product/1/2' });
const config = () => ({ shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu' }], ...draft(), intervalSeconds: 30, limit: 1, mode: 'send' });

// Build a real reducer state after the first of two messages was submitted.
// No content script, browser, or send operation runs in this fixture.
function partialQueue(status = 'running') {
  let sequence = 0, state = initialState();
  const apply = event => { state = reduceQueue(state, event, { now: 1000, uid: () => `existing-${++sequence}` }).state; };
  apply({ type: 'start', config: config(), binding: { tabId: 7, pageId: 'page' } });
  const context = { sessionId: state.task.sessionId, tabId: 7, pageId: 'page', shopId: '10', itemId: '20', messageIndex: 0 };
  apply({ type: 'poll', ...context });
  apply({ type: 'prepared', ...context, ok: true });
  apply({ type: 'poll', ...context });
  apply({ type: 'authorize', ...context });
  apply({ type: 'result', ...context, outcome: 'sent' });
  if (status === 'paused') apply({ type: 'pause' });
  apply({ type: 'deny', shopId: '10', creatorId: '99', name: '保留拒绝项', blocked: true });
  assert.equal(state.task.status, status);
  assert.equal(state.task.items[0].submittedCount, 1);
  return state;
}

function fixture({ queue = partialQueue(), stale = false, templates } = {}) {
  let clock = stale ? 90000 : 3000, sequence = 0, failure = null;
  let data = { creatorQueue: structuredClone(queue), creatorTaskHistory: { version: 1, tasks: [] }, creatorDiagnostics: { version: 1, dropped: 0, events: [] },
    creatorWorkspace: { browserSessionId: stale ? 'previous-browser' : 'browser', tabId: 7, pageId: 'page', documentId: 'doc', documentEpoch: 123,
      shop: { id: '10', name: '示例店铺' }, creators: [], lastSeen: stale ? 0 : 3000 } };
  if (templates !== undefined) data[TEMPLATE_KEY] = structuredClone(templates);
  const reads = [], writes = [], activity = { sessionReads: 0, sessionWrites: 0, tabs: 0, injections: 0, snapshots: 0, clicks: 0 };
  const api = {
    runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` },
    storage: {
      local: {
        get: async keys => { const names = typeof keys === 'string' ? [keys] : keys; reads.push([...names]); return Object.fromEntries(names.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])); },
        set: async values => { writes.push(Object.keys(values)); if (failure?.(values)) throw new Error('disk unavailable'); data = { ...data, ...structuredClone(values) }; },
      },
      session: { get: async () => { activity.sessionReads++; return { creatorBrowserSession: 'browser' }; }, set: async () => { activity.sessionWrites++; } },
    },
    tabs: { get: async () => { activity.tabs++; return { url: 'https://seller.shopee.co.id', status: 'complete' }; }, create: async () => { activity.tabs++; return { id: 7 }; } },
    scripting: { executeScript: async () => { activity.injections++; return []; } },
  };
  const backend = createBackend(api, { now: () => clock, uid: () => `new-${++sequence}`, readSnapshot: async (_tab, _text, _doc, commit) => {
    activity.snapshots++; if (commit) activity.clicks++;
    return { documentEpoch: 123, origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace',
      shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu', chatAvailable: true }], blocked: false };
  } });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  return { panel, reads, writes, activity, data: () => structuredClone(data), fail: value => { failure = value; }, advance: ms => { clock += ms; },
    call: (type, body = {}, sender = panel) => backend.handle({ type, ...body }, sender) };
}

async function exerciseTemplates(f) {
  const listed = await f.call('panel:template-list');
  assert.ok(Array.isArray(listed.messageTemplates.templates));
  const created = await f.call('panel:template-create', { draft: draft() });
  const id = created.savedTemplateId;
  assert.equal(typeof id, 'string');
  const record = created.messageTemplates.templates.find(row => row.id === id);
  assert.ok(record);
  const updated = await f.call('panel:template-update', { templateId: id, expectedRevision: record.revision, draft: { ...draft('合作邀请新版'), template: '邀请 {{name}}' } });
  const saved = updated.messageTemplates.templates.find(row => row.id === id);
  const copied = await f.call('panel:template-copy', { templateId: id, expectedRevision: saved.revision });
  assert.notEqual(copied.savedTemplateId, id);
  assert.equal(copied.messageTemplates.templates.length, 2);
  await tick();
}

function assertTemplateBoundary(f, before, offset = { reads: 0, writes: 0, activity: Object.fromEntries(Object.keys(f.activity).map(key => [key, 0])) }) {
  const after = f.data();
  for (const key of Object.keys(before).filter(key => key !== TEMPLATE_KEY)) assert.deepEqual(after[key], before[key], `${key} must remain unchanged`);
  assert.ok(f.reads.slice(offset.reads).every(keys => keys.length === 1 && keys[0] === TEMPLATE_KEY), 'template operations may read only their own key');
  assert.ok(f.writes.slice(offset.writes).every(keys => keys.length === 1 && keys[0] === TEMPLATE_KEY), 'template operations may write only their own key, including failure paths');
  assert.deepEqual(f.activity, offset.activity, 'template operations must not initialize sessions, inspect pages, inject, or click');
}

for (const status of ['running', 'paused']) {
  test(`首次模板增改复制不初始化或过期${status}双消息任务，也不改防重发及拒绝记录`, async () => {
    const f = fixture({ queue: partialQueue(status), stale: true }), before = f.data();
    await exerciseTemplates(f);
    assertTemplateBoundary(f, before);
  });

  test(`已初始化后模板操作不刷新日志或过期${status}任务，内存和磁盘配置均保留`, async () => {
    const f = fixture({ queue: partialQueue(status) });
    await f.call('panel:get'); await tick();
    f.advance(90000);
    const before = f.data(), offset = { reads: f.reads.length, writes: f.writes.length, activity: { ...f.activity } };
    await exerciseTemplates(f);
    assertTemplateBoundary(f, before, offset);
    const detail = (await f.call('panel:history-detail', { taskId: before.creatorQueue.task.id })).taskRecord;
    assert.equal(detail.status, status);
    assert.deepEqual(detail.config.template, before.creatorQueue.task.config.template);
    assert.deepEqual(detail.config.productLink, before.creatorQueue.task.config.productLink);
    assert.equal(detail.items[0].submittedCount, 1);
  });
}

test('模板写失败可用同一请求重试，保留原数据且不导致业务故障锁', async () => {
  const f = fixture(), before = f.data(), request = { draft: draft() };
  f.fail(values => Object.hasOwn(values, TEMPLATE_KEY));
  await assert.rejects(f.call('panel:template-create', request), /模板|保存|存储/);
  await tick();
  assert.deepEqual(f.data(), before);
  assert.equal((await f.call('panel:template-list')).messageTemplates.templates.length, 0);
  f.fail(null);
  assert.equal((await f.call('panel:template-create', request)).messageTemplates.templates.length, 1);
  await tick();
  assertTemplateBoundary(f, before);
  assert.equal((await f.call('panel:get')).state.task.status, 'running');
});

test('模板成功和失败均不消耗队列预览令牌，原预览仍能启动原配置', async () => {
  const f = fixture({ queue: initialState() });
  const original = config();
  const preview = await f.call('panel:preview', { config: original });
  await tick();
  await exerciseTemplates(f);
  f.fail(values => Object.hasOwn(values, TEMPLATE_KEY));
  await assert.rejects(f.call('panel:template-create', { draft: draft('失败后仍保留预览') }), /模板|保存|存储/);
  f.fail(null);
  const started = await f.call('panel:start', { config: original, previewToken: preview.previewToken, confirmed: true });
  assert.equal(started.state.task.status, 'running');
  assert.equal(started.state.task.config.template, original.template);
  assert.equal(started.state.task.config.productLink, original.productLink);
  assert.equal(f.activity.clicks, 0);
});

test('暂停的部分提交任务经过模板操作后继续时，下一指令仍只处理产品链接', async () => {
  const f = fixture({ queue: partialQueue('paused') });
  const before = f.data().creatorQueue;
  await exerciseTemplates(f);
  await f.call('panel:resume');
  const sender = { id: 'demo', url: 'https://seller.shopee.co.id', documentId: 'doc', tab: { id: 7 }, frameId: 0 };
  const next = await f.call('page:poll', { pageId: 'page' }, sender);
  assert.equal(next.command.messageIndex, 1);
  assert.equal(next.command.text, before.task.config.productLink);
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 1);
  assert.deepEqual(f.data().creatorQueue.history, before.history);
  assert.deepEqual(f.data().creatorQueue.denied, before.denied);
  assert.equal(f.activity.clicks, 0);
});

test('业务存储已故障时模板列表仍可读取，且不重试业务或诊断写盘', async () => {
  const f = fixture({ queue: initialState() });
  f.fail(values => Object.hasOwn(values, 'creatorQueue'));
  await assert.rejects(f.call('panel:preview', { config: config() }), /存储|保存/);
  await assert.rejects(f.call('panel:get'), /存储|保存/);
  await tick();
  const before = f.data(), offset = { reads: f.reads.length, writes: f.writes.length, activity: { ...f.activity } };
  const listed = await f.call('panel:template-list');
  assert.equal(listed.messageTemplates.templates.length, 0);
  await tick();
  assertTemplateBoundary(f, before, offset);
});

for (const initialized of [false, true]) {
  test(`${initialized ? '已初始化' : '首次访问'}时历史页、外部页及变形工作台地址均无模板读写权限`, async () => {
    const f = fixture();
    if (initialized) { await f.call('panel:get'); await tick(); }
    const before = f.data(), offset = { reads: f.reads.length, writes: f.writes.length, activity: { ...f.activity } };
    const senders = [
      { id: 'demo', url: 'chrome-extension://demo/history.html' },
      { id: 'demo', url: 'https://example.com/dashboard.html' },
      { ...f.panel, id: 'another-extension' },
      { ...f.panel, url: `${f.panel.url}?other=1` },
      { ...f.panel, url: `${f.panel.url}#main` },
    ];
    const operations = [
      ['panel:template-list', {}], ['panel:template-create', { draft: draft() }],
      ['panel:template-update', { templateId: 'missing', expectedRevision: 1, draft: draft() }],
      ['panel:template-copy', { templateId: 'missing', expectedRevision: 1 }],
    ];
    for (const sender of senders) for (const [type, body] of operations) await assert.rejects(f.call(type, body, sender), /允许|工作台|来源/);
    await tick();
    assert.deepEqual(f.data(), before);
    assert.equal(f.reads.length, offset.reads, 'unauthorized requests must be rejected before storage reads');
    assert.equal(f.writes.length, offset.writes, 'unauthorized requests must not write diagnostics');
    assert.deepEqual(f.activity, offset.activity);
  });
}

test('损坏模板不会进入业务初始化或阻断现有双消息任务，读取报错也不写日志', async () => {
  const f = fixture({ templates: { version: 99, templates: [] } });
  const task = (await f.call('panel:get')).state.task;
  assert.equal(task.status, 'running');
  await tick();
  const before = f.data(), offset = { reads: f.reads.length, writes: f.writes.length, activity: { ...f.activity } };
  await assert.rejects(f.call('panel:template-list'), /模板|损坏|版本/);
  await tick();
  assertTemplateBoundary(f, before, offset);
  assert.deepEqual((await f.call('panel:get')).state.task, task);
});
