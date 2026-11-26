import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

test('共享后台库接口在业务初始化和串行日志前分流，成功失败均只触及达人库键', async () => {
  let data = { creatorQueue: { version: 99 }, creatorWorkspace: { untouched: true }, creatorDiagnostics: { untouched: true } }, reads = [], writes = [], id = 0;
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async keys => { reads.push(keys); return structuredClone(data); }, set: async v => { writes.push(Object.keys(v)); data = { ...data, ...structuredClone(v) }; } }, session: { get: async () => { throw new Error('不允许业务初始化'); } } } };
  const backend = createBackend(api, { uid: () => `id-${++id}`, now: () => 1000 });
  const sender = { id: 'demo', url: api.runtime.getURL('creator-library.html'), frameId: 0 };
  const call = (type, body = {}, from = sender) => backend.handle({ type, ...body }, from);
  assert.equal((await call('panel:library-list')).creatorLibrary.revision, 0);
  await call('panel:library-add', { expectedRevision: 0, draft: { name: '测试达人', site: 'ID', shopId: '10', identityType: 'shopee_user_id', identityValue: '20', tags: [], note: '' } });
  const selected = (await call('panel:library-select', { expectedRevision: 1, site: 'ID', shopId: '10', recordIds: ['id-1'] })).creatorLibrarySelection;
  assert.deepEqual(selected.creatorIds, ['20']);
  await assert.rejects(call('panel:library-add', { expectedRevision: 0, draft: {} }));
  const count = reads.length;
  for (const from of [{ ...sender, url: `${sender.url}?x=1` }, { ...sender, frameId: 1 }, { ...sender, url: api.runtime.getURL('history.html') }]) await assert.rejects(call('panel:library-list', {}, from));
  assert.equal(reads.length, count); assert.ok(reads.every(keys => keys.length === 1 && keys[0] === 'creatorLibrary'));
  assert.ok(writes.every(keys => keys.length === 1 && keys[0] === 'creatorLibrary'));
  assert.deepEqual(data.creatorQueue, { version: 99 }); assert.deepEqual(data.creatorDiagnostics, { untouched: true });
});
