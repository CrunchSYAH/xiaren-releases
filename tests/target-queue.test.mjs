import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, previewTask, reduceQueue } from '../extension/core/queue.mjs';
const config = { shop: { id: '10', name: '测试店' }, creators: [{ id: '20', name: '测试达人' }], template: '你好', intervalSeconds: 1, limit: 1, mode: 'send', collectionId: 'collection', targetCount: 1 };
const options = { now: 1, uid: () => 'uid' };
test('目标配置穿过队列且少一人也不能启动', () => {
  const started = reduceQueue(initialState(), { type: 'start', config, binding: { tabId: 7, pageId: 'p' } }, options).state;
  assert.equal(started.task.config.collectionId, 'collection'); assert.equal(started.task.config.targetCount, 1);
  const state = initialState(); state.denied['10'] = { '20': {} };
  assert.throws(() => previewTask(state, config), /目标|名单/);
  for (const changed of [{ ...config, limit: 2 }, { ...config, targetCount: 2 }, { ...config, collectionId: '' }]) assert.throws(() => previewTask(initialState(), changed));
});
test('目标名单运行中被拒绝时暂停说明差额，不悄悄跳过继续', () => {
  let state = reduceQueue(initialState(), { type: 'start', config, binding: { tabId: 7, pageId: 'p' } }, options).state;
  state.denied['10'] = { '20': {} };
  const result = reduceQueue(state, { type: 'poll', tabId: 7, pageId: 'p', shopId: '10', sessionId: state.task.sessionId }, options);
  assert.equal(result.command, null); assert.equal(result.state.task.status, 'paused'); assert.match(result.state.task.reason, /目标|名单/);
});
