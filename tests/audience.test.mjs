import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSource, matchesSource } from '../extension/core/audience.mjs';

test('缺省来源兼容旧任务，来源只保留约定字段并返回独立ID列表', () => {
  const defaults = { type: 'marketplace', creatorIds: [], nameIncludes: '', nameExcludes: '' };
  assert.deepEqual(normalizeSource(), defaults);
  assert.deepEqual(normalizeSource({}), defaults);
  const draft = { type: 'specified', creatorIds: ['20', '10', '20'], nameIncludes: ' AyU ', nameExcludes: ' BOT ', private: 'discard' };
  const normalized = normalizeSource(draft);
  assert.deepEqual(normalized, { type: 'specified', creatorIds: ['20', '10'], nameIncludes: 'AyU', nameExcludes: 'BOT' });
  normalized.creatorIds.push('30');
  assert.deepEqual(draft.creatorIds, ['20', '10', '20']);
  const first = normalizeSource(); first.creatorIds.push('1');
  assert.deepEqual(normalizeSource(), defaults);
});

test('来源类型、指定ID与姓名条件边界明确拒绝，不将其他来源降级为广场', () => {
  for (const value of [null, [], 'specified', { type: 'ranking' }, { type: '' }, { type: 1 }, { creatorIds: '20' }, { nameIncludes: 1 }, { nameExcludes: null }, { nameIncludes: 'x'.repeat(101) }, { nameExcludes: 'x'.repeat(101) }]) assert.throws(() => normalizeSource(value), /来源|名单|姓名|条件|ID/);
  for (const creatorIds of [[], Array(1), [''], [' 20 '], ['0'], ['-1'], ['1.5'], ['1e3'], ['abc'], [20], ['1', null], Array.from({ length: 201 }, (_, index) => String(index + 1))]) assert.throws(() => normalizeSource({ type: 'specified', creatorIds }), /ID|名单|200/);
  const full = Array.from({ length: 200 }, (_, index) => String(index + 1));
  assert.equal(normalizeSource({ type: 'specified', creatorIds: [...full, ...full] }).creatorIds.length, 200);
  assert.equal(normalizeSource({ nameIncludes: `  ${'x'.repeat(100)}  ` }).nameIncludes.length, 100);
  assert.deepEqual(normalizeSource({ type: 'marketplace', creatorIds: ['20'], nameIncludes: ' Ayu ' }), { type: 'marketplace', creatorIds: [], nameIncludes: 'Ayu', nameExcludes: '' });
});

test('姓名包含和排除均按字面且不区分大小写，指定ID严格匹配', () => {
  const source = normalizeSource({ type: 'specified', creatorIds: ['20'], nameIncludes: ' AyU ', nameExcludes: ' BOT ' });
  assert.equal(matchesSource(source, { id: '20', name: 'Ayu Beauty' }), true);
  assert.equal(matchesSource(source, { id: '21', name: 'Ayu Beauty' }), false);
  assert.equal(matchesSource(source, { id: '20', name: 'AYU BOT Beauty' }), false);
  assert.equal(matchesSource(source, { id: '20', name: 'Budi' }), false);
  assert.equal(matchesSource(normalizeSource({ nameIncludes: '[vip]' }), { id: '20', name: '[VIP] Ayu' }), true);
  assert.equal(matchesSource(normalizeSource({ nameIncludes: '[vip]' }), { id: '20', name: 'vip Ayu' }), false);
  assert.equal(matchesSource(normalizeSource(), null), false);
  assert.equal(matchesSource(normalizeSource(), { id: '20' }), false);
});

test('页面筛选和当前位置仅适用于广场与排行榜，缺省保持旧配置形状', () => {
  for (const type of ['marketplace', 'leaderboard']) {
    const source = { type, startPosition: 'current', webFilters: { category: ' Beauty ', channel: ' Shopee Video ' } };
    const normalized = normalizeSource(source);
    assert.equal(normalized.startPosition, 'current');
    assert.deepEqual(normalized.webFilters, { category: 'Beauty', channel: 'Shopee Video' });
    normalized.webFilters.category = 'other';
    assert.equal(source.webFilters.category, ' Beauty ');
  }
  for (const source of [{ type: 'specified', creatorIds: ['1'] }, { type: 'affiliates', affiliateIds: ['1'] }]) {
    assert.throws(() => normalizeSource({ ...source, startPosition: 'current' }), /当前位置|来源/);
    assert.throws(() => normalizeSource({ ...source, webFilters: { category: '', channel: '' } }), /筛选|来源/);
  }
  assert.equal(Object.hasOwn(normalizeSource(), 'startPosition'), false);
  assert.equal(Object.hasOwn(normalizeSource(), 'webFilters'), false);
});

test('页面筛选和起始位置拒绝未知值、错误类型、超长文字及控制字符', () => {
  for (const startPosition of [null, '', 'first', true, 1]) assert.throws(() => normalizeSource({ startPosition }), /位置/);
  const filters = { category: '', channel: '' };
  for (const webFilters of [null, [], 'Beauty', { ...filters, category: null }, { ...filters, channel: 1 }, { ...filters, category: 'x'.repeat(101) }, { ...filters, channel: 'x'.repeat(101) }, { ...filters, unknown: 'x' }]) assert.throws(() => normalizeSource({ webFilters }), /筛选/);
  assert.deepEqual(normalizeSource({ webFilters: filters }).webFilters, filters);
  assert.equal(normalizeSource({ webFilters: { ...filters, channel: ` ${'x'.repeat(100)} ` } }).webFilters.channel.length, 100);
  for (const search of [undefined, null, 1, 'x'.repeat(101), 'a\nb']) assert.throws(() => normalizeSource({ webFilters: { ...filters, search } }), /筛选/);
});

test('旧网页搜索值仅作只读兼容，归一化保留且不改写输入', () => {
  for (const type of ['marketplace', 'leaderboard']) {
    const source = { type, webFilters: { category: 'Beauty', channel: '102', search: type === 'marketplace' ? ' ayu ' : '' } };
    const original = structuredClone(source), normalized = normalizeSource(source);
    assert.equal(normalized.webFilters.search, original.webFilters.search.trim());
    assert.deepEqual(normalizeSource(normalized), normalized);
    normalized.webFilters.search = 'changed';
    assert.deepEqual(source, original);
  }
});
