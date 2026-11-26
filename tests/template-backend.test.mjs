import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

const draft = (extra = {}) => ({ name: '合作邀请', template: 'Halo {{name}}', productLink: 'https://shopee.co.id/product/1/2', ...extra });
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(seed = {}) {
  let data = structuredClone(seed), clock = 1000, sequence = 0, sessionReads = 0, sessionWrites = 0, pageReads = 0, injections = 0, failure = null, readFailure = false;
  const reads = [], writes = [];
  const page = { documentEpoch: 123, origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu', rowKey: 'row', chatAvailable: true }], blocked: false,
    chat: { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, sendReady: true, editorText: '' } };
  const api = {
    runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` },
    storage: { local: {
      get: async keys => { reads.push(structuredClone(keys)); if (readFailure && keys.includes('creatorMessageTemplates')) throw new Error('disk'); return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])); },
      set: async values => { writes.push(Object.keys(values)); if (failure?.(values)) throw new Error('disk'); data = { ...data, ...structuredClone(values) }; },
    }, session: { get: async () => { sessionReads++; return { creatorBrowserSession: 'browser' }; }, set: async () => { sessionWrites++; } } },
    tabs: { create: async () => ({ id: 7 }), get: async () => ({ url: page.origin, status: 'complete' }) }, scripting: { executeScript: async () => { injections++; return []; } },
  };
  const sender = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const backend = createBackend(api, { now: () => clock, uid: () => `template-${++sequence}`, readSnapshot: async () => { pageReads++; return structuredClone(page); } });
  const call = (type, body = {}, from = sender) => backend.handle({ type, ...body }, from);
  return { api, sender, call, data: () => data, reads, writes,
    activity: () => ({ sessionReads, sessionWrites, pageReads, injections }),
    fail: predicate => { failure = predicate; }, failRead: value => { readFailure = value; }, advance: ms => { clock += ms; },
  };
}

function readyFixture() {
  return fixture({ creatorQueue: { version: 1, task: null, history: {}, denied: {} }, creatorWorkspace: { browserSessionId: 'browser', tabId: 7, pageId: 'page', documentId: 'doc', documentEpoch: 123, shop: { id: '10', name: '示例店铺' }, creators: [], lastSeen: 1000 } });
}

const config = { shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu' }], template: 'Halo {{name}}', intervalSeconds: 30, limit: 1, mode: 'dry-run' };

test('首次读取旧键缺失只读模板键，不初始化或写入默认值', async () => {
  const f = fixture();
  const reply = await f.call('panel:template-list');
  assert.deepEqual(reply.messageTemplates.templates, []);
  assert.deepEqual(reply.messageTemplates.capacity, { count: 0, limit: 50, bytes: 28, maxBytes: 524288 });
  assert.deepEqual(f.reads, [['creatorMessageTemplates']]);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.activity(), { sessionReads: 0, sessionWrites: 0, pageReads: 0, injections: 0 });
  assert.deepEqual(f.data(), {});
});

test('新建更新复制只读写独立键，复制使用保存内容且返回容量和保存标识', async () => {
  const f = fixture();
  const created = await f.call('panel:template-create', { draft: draft({ name: ' 邀请 ', mode: 'send', creators: [{ id: 'private' }] }) });
  const id = created.savedTemplateId;
  assert.equal(created.messageTemplates.templates[0].id, id);
  assert.equal(created.messageTemplates.templates[0].name, '邀请');
  f.advance(10);
  const updated = await f.call('panel:template-update', { templateId: id, expectedRevision: 1, draft: draft({ name: '新邀请', template: '更新 {{name}}' }) });
  assert.equal(updated.savedTemplateId, id);
  assert.equal(updated.messageTemplates.templates[0].revision, 2);
  const copied = await f.call('panel:template-copy', { templateId: id, expectedRevision: 2, draft: draft({ template: '不允许读取的草稿' }) });
  const copy = copied.messageTemplates.templates.find(item => item.id === copied.savedTemplateId);
  assert.equal(copy.name, '新邀请 · 副本');
  assert.equal(copy.template, '更新 {{name}}');
  assert.equal(copy.revision, 1);
  assert.equal(copied.messageTemplates.capacity.count, 2);
  assert.ok(f.reads.every(keys => keys.length === 1 && keys[0] === 'creatorMessageTemplates'));
  assert.ok(f.writes.every(keys => keys.length === 1 && keys[0] === 'creatorMessageTemplates'));
  assert.deepEqual(f.activity(), { sessionReads: 0, sessionWrites: 0, pageReads: 0, injections: 0 });
  assert.deepEqual(Object.keys(f.data()), ['creatorMessageTemplates']);
});

test('精确来源校验在读取和初始化前完成，历史页不能管理模板', async () => {
  const f = fixture();
  for (const from of [{ ...f.sender, id: 'other' }, { ...f.sender, url: f.api.runtime.getURL('history.html') }, { ...f.sender, url: `${f.sender.url}?x=1` }, { ...f.sender, url: 'https://example.com' }]) {
    for (const type of ['panel:template-list', 'panel:template-create', 'panel:template-update', 'panel:template-copy']) await assert.rejects(f.call(type, { draft: draft() }, from), /工作台/);
  }
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.activity(), { sessionReads: 0, sessionWrites: 0, pageReads: 0, injections: 0 });
});

test('坏数据和未知版本保留原值，失败不影响后续普通业务初始化', async () => {
  for (const value of [null, { version: 99, templates: [] }, { version: 1, templates: 'broken' }]) {
    const f = fixture({ creatorMessageTemplates: value }), before = structuredClone(f.data());
    for (const type of ['panel:template-list', 'panel:template-create']) await assert.rejects(f.call(type, { draft: draft() }), /模板.*损坏|版本.*不兼容|格式/);
    assert.deepEqual(f.data(), before);
    assert.deepEqual(f.writes, []);
    assert.equal(f.activity().sessionReads, 0);
    assert.equal((await f.call('panel:get')).state.task, null);
  }
});

test('写入和读取失败仅影响模板操作，旧数据保留且可以直接重试', async () => {
  const f = fixture();
  const created = await f.call('panel:template-create', { draft: draft() }), id = created.savedTemplateId;
  const before = structuredClone(f.data());
  f.fail(values => Object.hasOwn(values, 'creatorMessageTemplates'));
  await assert.rejects(f.call('panel:template-update', { templateId: id, expectedRevision: 1, draft: draft({ name: '修改' }) }), /模板.*保存|模板.*存储/);
  assert.deepEqual(f.data(), before);
  f.fail(null);
  const updated = await f.call('panel:template-update', { templateId: id, expectedRevision: 1, draft: draft({ name: '修改' }) });
  assert.equal(updated.messageTemplates.templates[0].revision, 2);
  f.failRead(true);
  await assert.rejects(f.call('panel:template-list'), /模板.*读取|模板.*存储/);
  f.failRead(false);
  assert.equal((await f.call('panel:template-list')).messageTemplates.templates[0].revision, 2);
  assert.equal((await f.call('panel:get')).state.task, null);
});

test('并发更新以expectedRevision防止静默覆盖，并发复制自动避开重名', async () => {
  const f = fixture(), created = await f.call('panel:template-create', { draft: draft() }), id = created.savedTemplateId;
  const updates = await Promise.allSettled([
    f.call('panel:template-update', { templateId: id, expectedRevision: 1, draft: draft({ name: '第一改动' }) }),
    f.call('panel:template-update', { templateId: id, expectedRevision: 1, draft: draft({ name: '第二改动' }) }),
  ]);
  assert.equal(updates.filter(item => item.status === 'fulfilled').length, 1);
  assert.match(updates.find(item => item.status === 'rejected').reason.message, /版本|刷新/);
  await Promise.all([f.call('panel:template-copy', { templateId: id, expectedRevision: 2 }), f.call('panel:template-copy', { templateId: id, expectedRevision: 2 })]);
  const names = (await f.call('panel:template-list')).messageTemplates.templates.map(item => item.name);
  assert.deepEqual(new Set(names), new Set(['第一改动', '第一改动 · 副本', '第一改动 · 副本2']));
});

test('模板错误和保存不消耗业务预览，模板写失败不设置业务faulted', async () => {
  const f = readyFixture();
  const preview = await f.call('panel:preview', { config });
  await turn();
  const before = structuredClone(f.data()), activity = f.activity();
  f.fail(values => Object.hasOwn(values, 'creatorMessageTemplates'));
  await assert.rejects(f.call('panel:template-create', { draft: draft() }), /模板.*保存|模板.*存储/);
  f.fail(null);
  await f.call('panel:template-create', { draft: draft() });
  assert.deepEqual(f.data().creatorQueue, before.creatorQueue);
  assert.deepEqual(f.data().creatorWorkspace, before.creatorWorkspace);
  assert.deepEqual(f.data().creatorDiagnostics, before.creatorDiagnostics);
  assert.deepEqual(f.activity(), activity);
  const started = await f.call('panel:start', { config, previewToken: preview.previewToken });
  assert.equal(started.state.task.status, 'running');
});

test('运行中超时与旧dirty日志不由模板操作触发，成功失败均不写排查日志', async () => {
  const f = readyFixture(), preview = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: preview.previewToken });
  await turn();
  f.fail(values => Object.hasOwn(values, 'creatorDiagnostics'));
  await f.call('panel:pause');
  await turn();
  f.fail(null); f.advance(60000);
  const before = structuredClone(f.data()), activity = f.activity(), writeCount = f.writes.length;
  const created = await f.call('panel:template-create', { draft: draft() }), id = created.savedTemplateId;
  await f.call('panel:template-list');
  await assert.rejects(f.call('panel:template-update', { templateId: id, expectedRevision: 5, draft: draft() }), /版本|刷新/);
  await f.call('panel:template-copy', { templateId: id, expectedRevision: 1 });
  await turn();
  assert.deepEqual(f.data().creatorQueue, before.creatorQueue);
  assert.deepEqual(f.data().creatorWorkspace, before.creatorWorkspace);
  assert.deepEqual(f.data().creatorDiagnostics, before.creatorDiagnostics);
  assert.deepEqual(f.activity(), activity);
  assert.ok(f.writes.slice(writeCount).every(keys => keys.length === 1 && keys[0] === 'creatorMessageTemplates'));
  const report = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.equal(report.persistence.unsaved, true);
  assert.equal(report.events.some(event => event.event === 'operation:error'), false);
  const serial = JSON.stringify(report);
  for (const value of ['合作邀请', 'Halo', 'shopee.co.id/product']) assert.equal(serial.includes(value), false);
});

test('业务写盘故障时模板仍可读取与保存，不能解除原业务故障', async () => {
  const f = readyFixture();
  f.fail(values => Object.hasOwn(values, 'creatorQueue'));
  await assert.rejects(f.call('panel:preview', { config }), /存储|保存/);
  f.fail(null);
  const before = structuredClone(f.data().creatorQueue);
  const saved = await f.call('panel:template-create', { draft: draft() });
  assert.equal(saved.messageTemplates.templates.length, 1);
  assert.equal((await f.call('panel:template-list')).messageTemplates.templates.length, 1);
  assert.deepEqual(f.data().creatorQueue, before);
  await assert.rejects(f.call('panel:get'), /存储|保存/);
});
