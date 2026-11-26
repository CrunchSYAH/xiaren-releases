import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorLibraryHandler, isCreatorLibraryMessage } from '../extension/core/creator-library-handler.mjs';

const draft = extra => ({ name: '示例', identityType: 'shopee_user_id', identityValue: '123', site: 'ID', shopId: '10', tags: [], note: '', source: { kind: 'manual', label: '' }, ...extra });
function fixture(seed = {}) {
  let data = structuredClone(seed), id = 0, failRead = false, failWrite = false;
  const reads = [], writes = [];
  const api = { runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` }, storage: { local: {
    get: async keys => { reads.push(keys); if (failRead) throw Error('private read detail'); return structuredClone(data); },
    set: async value => { writes.push(Object.keys(value)); if (failWrite) throw Error('private write detail'); data = { ...data, ...structuredClone(value) }; },
  } } };
  const handler = createCreatorLibraryHandler(api, { now: () => 1000, uid: () => `r${++id}` });
  const sender = { id: 'demo', url: api.runtime.getURL('creator-library.html') };
  return { handler, sender, reads, writes, data: () => structuredClone(data), failRead: value => { failRead = value; }, failWrite: value => { failWrite = value; }, call: (type, values = {}, from = sender) => handler.handle({ type, ...values }, from) };
}

test('消息集合不接管其他业务，缺失键读取不写默认数据', async () => {
  assert.equal(isCreatorLibraryMessage({ type: 'panel:library-list' }), true);
  for (const type of ['panel:start', 'panel:library-verify', 'panel:library-anything', undefined]) assert.equal(isCreatorLibraryMessage({ type }), false);
  const f = fixture({ creatorQueue: { task: 'untouched' } });
  assert.equal((await f.call('panel:library-list')).creatorLibrary.records.length, 0);
  assert.deepEqual(f.reads, [['creatorLibrary']]); assert.deepEqual(f.writes, []);
});

test('精确校验ID和URL，包括查询参数、子页、非顶层拒绝，在所有存储读取前完成', async () => {
  const f = fixture();
  for (const sender of [{ ...f.sender, id: 'other' }, { ...f.sender, url: `${f.sender.url}?x=1` }, { ...f.sender, url: `${f.sender.url}#x` }, { ...f.sender, url: 'chrome-extension://demo/history.html' }, { ...f.sender, frameId: 1 }, { ...f.sender, url: 'https://seller.shopee.co.id/' }]) {
    for (const type of ['panel:library-list', 'panel:library-add', 'panel:library-update', 'panel:library-import', 'panel:library-export', 'panel:library-select']) await assert.rejects(f.call(type, {}, sender), /工作台|达人库|顶层/);
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
  const dashboard = { id: 'demo', url: 'chrome-extension://demo/dashboard.html' };
  assert.equal((await f.call('panel:library-list', {}, dashboard)).creatorLibrary.revision, 0);
});

test('并发添加只允许一个旧版本写入，失败可重试，只触及独立键', async () => {
  const f = fixture({ creatorQueue: { task: 'stable' }, creatorDiagnostics: { unchanged: true } });
  const results = await Promise.allSettled([f.call('panel:library-add', { draft: draft(), expectedRevision: 0 }), f.call('panel:library-add', { draft: draft({ identityValue: '456' }), expectedRevision: 0 })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /版本/);
  const before = f.data(); f.failWrite(true);
  await assert.rejects(f.call('panel:library-update', { recordId: 'r1', draft: draft({ note: 'new' }), expectedRevision: 1 }), /达人库.*保存/);
  assert.deepEqual(f.data(), before);
  f.failWrite(false);
  assert.equal((await f.call('panel:library-update', { recordId: 'r1', draft: draft({ note: 'new' }), expectedRevision: 1 })).creatorLibrary.revision, 2);
  assert.ok(f.reads.every(keys => keys.length === 1 && keys[0] === 'creatorLibrary'));
  assert.ok(f.writes.every(keys => keys.length === 1 && keys[0] === 'creatorLibrary'));
  assert.deepEqual(f.data().creatorQueue, before.creatorQueue); assert.deepEqual(f.data().creatorDiagnostics, before.creatorDiagnostics);
});

test('导出选择为只读不保存交接键，导入必须原子成功，存储错误不泄露异常详情', async () => {
  const f = fixture();
  await f.call('panel:library-import', { records: [draft(), draft({ identityValue: '456' })], expectedRevision: 0 });
  const writes = f.writes.length;
  const selection = (await f.call('panel:library-select', { recordIds: ['r2', 'r1'], expectedRevision: 1, site: 'ID', shopId: '10' })).creatorLibrarySelection;
  assert.deepEqual(selection.creatorIds, ['456', '123']);
  assert.equal((await f.call('panel:library-export', { format: 'json' })).creatorLibraryExport.format, 'json');
  assert.equal(f.writes.length, writes);
  const before = f.data();
  await assert.rejects(f.call('panel:library-import', { records: [draft({ identityValue: '789' }), draft({ identityValue: 'nope' })], expectedRevision: 1 }));
  assert.deepEqual(f.data(), before);
  f.failRead(true); await assert.rejects(f.call('panel:library-list'), error => /达人库.*读取/.test(error.message) && !/private/.test(error.message));
  f.failRead(false); assert.equal((await f.call('panel:library-list')).creatorLibrary.records.length, 2);
});

test('损坏值拒绝读写并保留原始值，接口不能写可信页面核实', async () => {
  const f = fixture({ creatorLibrary: { version: 99 } });
  const before = f.data();
  await assert.rejects(f.call('panel:library-list'), /损坏|版本/);
  await assert.rejects(f.call('panel:library-add', { draft: draft(), expectedRevision: 0 }), /损坏|版本/);
  await assert.rejects(f.call('panel:library-verify'), /不支持/);
  assert.deepEqual(f.data(), before); assert.deepEqual(f.writes, []);
});
