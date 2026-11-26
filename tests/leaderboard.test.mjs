import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource } from '../extension/core/audience.mjs';
import { createCollection, updateCollection } from '../extension/core/collection.mjs';
import { claimLeaderboardPage, leaderboardRoster } from '../extension/core/leaderboard.mjs';

const binding = { shopId: '10', documentEpoch: 123 };
const state = { history: {}, denied: {} };
const context = JSON.stringify({ tab: '1', category: '0', channel: 0, period: 'week', range: [100, 200], pageSize: 20, total: 200 });
const rows = (start, count = 20) => Array.from({ length: count }, (_, i) => ({ id: String(start + i), name: `测试${start + i}`, rowKey: String(1000 + start + i), chatAvailable: true, page: Math.ceil(start / 20) }));
const page = (number = 1, creators = rows((number - 1) * 20 + 1)) => ({ shop: { id: '10' }, creators, list: { supported: true, loading: false, hasMore: number < 10, pagination: { page: number, pageSize: 20, total: 200, context } } });
const initial = target => updateCollection(createCollection(target, binding, 'c', 1000, { type: 'leaderboard' }), page(), state, binding, 1000);

test('排行榜来源与广场隔离，按跨页首次出现顺序去重并完整锁定', () => {
  assert.equal(normalizeSource({ type: 'leaderboard' }).type, 'leaderboard');
  let c = initial(25);
  assert.equal(c.status, 'collecting');
  c = claimLeaderboardPage(c, 2, 1100);
  c = updateCollection(c, page(2, [{ ...rows(20, 1)[0], page: 2 }, ...rows(21, 19).map(r => ({ ...r, page: 2 }))]), state, binding, 1200);
  assert.equal(c.status, 'ready');
  assert.deepEqual(c.creators.map(r => r.id), Array.from({ length: 25 }, (_, i) => String(i + 1)));
  assert.equal(c.creators[20].page, 2);
  assert.equal(c.pagination.pages.length, 2);
});

test('非受控翻页、榜单条件改变及页内重排均立即失效', () => {
  const c = initial(25);
  assert.equal(updateCollection(c, page(2), state, binding, 1100).status, 'invalid');
  const changed = page(); changed.list.pagination.context += 'changed';
  assert.equal(updateCollection(c, changed, state, binding, 1100).status, 'invalid');
  assert.equal(updateCollection(c, page(1, [...page().creators].reverse()), state, binding, 1100).status, 'invalid');
});

test('翻页等待不采旧行，返回页精确核对，最终名单只使用当前目标页', () => {
  let c = claimLeaderboardPage(initial(25), 2, 1100);
  const pending = updateCollection(c, page(), state, binding, 1200);
  assert.equal(pending.count, 20); assert.equal(pending.pagination.expectedPage, 2);
  c = updateCollection(c, page(2), state, binding, 1300);
  c = claimLeaderboardPage(c, 1, 1400);
  c = updateCollection(c, page(), state, binding, 1500);
  assert.equal(c.status, 'ready');
  const roster = leaderboardRoster(c, c.creators[0]);
  assert.equal(roster.page, 1); assert.equal(roster.context, context); assert.equal(roster.observed.length, 20);
  assert.throws(() => leaderboardRoster(c, c.creators[20]), /当前页|目标页/);
  const bad = claimLeaderboardPage(c, 2, 1600);
  assert.equal(updateCollection(bad, page(2, rows(41)), state, binding, 1700).status, 'invalid');
});

test('未知或虚拟列表结构拒绝准备；翻页超时失效；人数1—200继续严格校验', () => {
  const c = createCollection(1, binding, 'c', 1000, { type: 'leaderboard' });
  const unsupported = page(); unsupported.list.supported = false;
  assert.equal(updateCollection(c, unsupported, state, binding, 1100).status, 'invalid');
  const loading = page(); loading.list.loading = true;
  assert.equal(updateCollection(c, loading, state, binding, 1100).count, 0);
  const wait = claimLeaderboardPage(initial(25), 2, 1100);
  assert.equal(updateCollection(wait, page(), state, binding, 47000).status, 'invalid');
  for (const target of [0, 201]) assert.throws(() => createCollection(target, binding, 'c', 1, { type: 'leaderboard' }));
});

test('排行榜从当前页准备并锁定整页，之后只允许受控连续下一页', () => {
  const first = page(4); first.list.startId = '61'; first.list.filterContext = 'rank|Beauty|video';
  let c = updateCollection(createCollection(25, binding, 'current', 1000, { type: 'leaderboard', startPosition: 'current' }), first, state, binding, 1000);
  assert.equal(c.status, 'collecting'); assert.equal(c.pagination.currentPage, 4);
  assert.equal(c.startId, '61'); assert.equal(c.pagination.pages[0].rows.length, 20);
  assert.deepEqual(c.creators.map(row => row.id), Array.from({ length: 20 }, (_, i) => String(i + 61)));
  assert.equal(updateCollection(c, page(5), state, binding, 1100).status, 'invalid');
  assert.throws(() => claimLeaderboardPage(c, 6, 1100), /翻页/);
  const next = page(5); next.list.filterContext = first.list.filterContext;
  c = updateCollection(claimLeaderboardPage(c, 5, 1100), next, state, binding, 1200);
  assert.equal(c.status, 'ready'); assert.equal(c.startId, '61');
  assert.deepEqual(c.creators.map(row => row.id), Array.from({ length: 25 }, (_, i) => String(i + 61)));
  c = claimLeaderboardPage(c, 4, 1300);
  const revisited = page(4); revisited.list.filterContext = first.list.filterContext;
  c = updateCollection(c, revisited, state, binding, 1400);
  assert.equal(c.status, 'ready'); assert.equal(leaderboardRoster(c, c.creators[0]).observed.length, 20);
  const reordered = structuredClone(revisited); reordered.creators.reverse();
  assert.equal(updateCollection(c, reordered, state, binding, 1500).status, 'invalid');
});

test('当前位置排行榜页码仍须在总人数可覆盖范围内', () => {
  const initial = () => createCollection(2, binding, 'current', 1000, { type: 'leaderboard', startPosition: 'current' });
  assert.equal(updateCollection(initial(), page(11), state, binding, 1100).status, 'invalid');
  const overTotal = page(4); overTotal.list.pagination.total = 40;
  assert.equal(updateCollection(initial(), overTotal, state, binding, 1100).status, 'invalid');
});
