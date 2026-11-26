import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_WINDOW_DAYS, HISTORY_WINDOW_MS, historyExpired, activeHistory, pruneHistory } from '../extension/core/history-window.mjs';
import { initialState, previewTask, reduceQueue } from '../extension/core/queue.mjs';
import { createCollection, updateCollection } from '../extension/core/collection.mjs';

const bind = { tabId: 3, pageId: 'page-1' };
const config = (extra = {}) => ({ shop: { id: 'shop-1', name: '店铺' }, creators: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Budi' }], template: 'Hi {{name}}', intervalSeconds: 10, limit: 10, mode: 'send', ...extra });
const at = (base, offset) => base + offset;
const base = 1_000_000;
const record = (extra = {}) => ({ status: 'confirmed', taskId: 'task-old', sessionId: 'session-old', updatedAt: base, ...extra });
const collectionBinding = { browserSessionId: 'browser', tabId: 7, documentId: 'doc', documentEpoch: 123, pageId: 'page', shopId: '10' };
const row = n => ({ id: String(n), name: `达人${n}`, rowKey: `${n - 1}_${n + 10000}`, chatAvailable: true });
const page = n => ({ shop: { id: '10', name: '测试店铺' }, creators: Array.from({ length: n }, (_, i) => row(i + 1)), list: { supported: true, hasMore: false, loading: false, renderedCount: n, truncated: false } });

test('防重发窗口固定为 30 天，边界按最后一次写入计算', () => {
  assert.equal(HISTORY_WINDOW_DAYS, 30);
  assert.equal(HISTORY_WINDOW_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(historyExpired(record(), at(base, HISTORY_WINDOW_MS - 1)), false);
  assert.equal(historyExpired(record(), at(base, HISTORY_WINDOW_MS)), true);
  assert.equal(historyExpired(record(), at(base, HISTORY_WINDOW_MS + 86_400_000)), true);
});

test('时间不可信或时钟回拨时不释放，宁可继续阻断', () => {
  for (const updatedAt of [undefined, null, 0, -1, NaN, Infinity, '1000']) {
    assert.equal(historyExpired({ status: 'confirmed', updatedAt }, at(base, HISTORY_WINDOW_MS * 2)), false, `updatedAt=${String(updatedAt)}`);
  }
  assert.equal(historyExpired(record(), at(base, -HISTORY_WINDOW_MS * 2)), false);
});

test('activeHistory 只认自有键，特殊 ID 不会命中原型成员', () => {
  const state = { history: {} };
  for (const id of ['constructor', '__proto__', 'toString']) assert.equal(activeHistory(state, 'shop-1', id, base), null);
  const stored = { 'shop-1': {} };
  for (const id of ['constructor', '__proto__']) {
    Object.defineProperty(stored['shop-1'], id, { value: record(), configurable: true, writable: true, enumerable: true });
  }
  assert.equal(activeHistory({ history: stored }, 'shop-1', 'constructor', at(base, 1)).updatedAt, base);
  assert.equal(activeHistory({ history: stored }, 'shop-1', '__proto__', at(base, 1)).updatedAt, base);
  assert.equal(activeHistory({ history: stored }, 'shop-1', 'constructor', at(base, HISTORY_WINDOW_MS)), null);
  assert.equal(Object.getPrototypeOf(stored['shop-1']), Object.prototype);
});

test('pruneHistory 只清理过期项，保留未过期与时间不明的记录，并移除空店铺', () => {
  const history = {
    'shop-1': { a: record(), b: record({ updatedAt: at(base, HISTORY_WINDOW_MS - 1000) }) },
    'shop-2': { c: record({ status: 'uncertain' }) },
    'shop-3': { d: { status: 'confirmed' } },
  };
  const removed = pruneHistory(history, at(base, HISTORY_WINDOW_MS + 1000));
  assert.equal(removed, 2);
  assert.deepEqual(Object.keys(history['shop-1']), ['b']);
  assert.equal(Object.hasOwn(history, 'shop-2'), false);
  assert.equal(Object.hasOwn(history['shop-3'], 'd'), true);
  assert.equal(pruneHistory({}, base), 0);
  assert.equal(pruneHistory(undefined, base), 0);
});

test('预览与启动按同一窗口放行：窗口内仍跳过，满 30 天后可重新建发', () => {
  const state = { ...initialState(), history: { 'shop-1': { a: record() } } };
  const inside = at(base, HISTORY_WINDOW_MS - 1);
  assert.equal(previewTask(state, config(), { now: inside }).sendableCount, 1);
  assert.equal(previewTask(state, config(), { now: inside }).items[0].reason, '已有发送或不确定记录');
  const outside = at(base, HISTORY_WINDOW_MS);
  assert.equal(previewTask(state, config(), { now: outside }).sendableCount, 2);
  assert.equal(previewTask(state, config(), { now: outside }).items[0].status, 'pending');

  const blocked = reduceQueue(state, { type: 'start', config: config(), binding: bind }, { now: inside, uid: () => 'id-1' }).state;
  assert.equal(blocked.task.items[0].status, 'skipped');
  assert.equal(blocked.task.items[1].status, 'pending');

  const released = reduceQueue(state, { type: 'start', config: config(), binding: bind }, { now: outside, uid: () => 'id-2' }).state;
  assert.equal(Object.hasOwn(released.history['shop-1'] || {}, 'a'), false, '启动时同时清理过期记录');
  assert.equal(released.task.items[0].status, 'pending');
});

test('未满窗口的拒绝名单不受时间影响，窗口只作用于发送记录', () => {
  const state = { ...initialState(), denied: { 'shop-1': { a: {} } } };
  assert.equal(previewTask(state, config(), { now: at(base, HISTORY_WINDOW_MS * 10) }).items[0].reason, '拒绝名单');
});

test('名单准备在窗口内继续排除，过期后重新进入可选候选人', () => {
  const state = () => ({ history: { 10: { 1: record() } }, denied: {} });
  const inside = updateCollection(createCollection(2, collectionBinding, 'c-1', base), page(4), state(), collectionBinding, at(base, HISTORY_WINDOW_MS - 1));
  assert.equal(inside.creators[0].id, '2');
  assert.equal(inside.excluded, 1);
  const outside = updateCollection(createCollection(2, collectionBinding, 'c-2', base), page(4), state(), collectionBinding, at(base, HISTORY_WINDOW_MS));
  assert.equal(outside.creators[0].id, '1');
  assert.equal(outside.excluded, 0);
});
