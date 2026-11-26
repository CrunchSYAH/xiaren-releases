import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollection, updateCollection, selectCandidate, refillSelection, resetSelection, extendCandidates, continueCollection, STALL_MS, BUDGET_MS } from '../extension/core/collection.mjs';

const binding = { browserSessionId: 'browser', tabId: 7, documentId: 'doc', documentEpoch: 123, pageId: 'page', shopId: '10' };
const row = n => ({ id: String(n), name: `达人${n}`, rowKey: `${n - 1}_${n + 10000}`, chatAvailable: true });
const page = (n, hasMore = true) => ({ shop: { id: '10', name: '测试店铺' }, creators: Array.from({ length: n }, (_, i) => row(i + 1)), list: { supported: true, hasMore, loading: false, renderedCount: n, truncated: false } });
const state = () => ({ history: {}, denied: {} });

test('追加加载备齐100名发送目标和110名候选，过滤历史拒绝及无聊天入口，不提前ready', () => {
  const history = state(); history.history['10'] = { '1': { status: 'confirmed' }, '2': { status: 'uncertain' } }; history.denied['10'] = { '3': {} };
  let c = createCollection(100, binding, 'collection', 1000);
  for (const n of [12, 24, 36, 48, 60, 72, 84, 96, 108, 120]) {
    const p = page(n); p.creators[3].chatAvailable = false;
    c = updateCollection(c, p, history, binding, 1000 + n);
    assert.equal(c.status, n < 120 ? 'collecting' : 'ready');
    assert.equal(c.shortfall, Math.max(0, 104 - n));
  }
  assert.equal(c.candidates.length, 110); assert.equal(c.creators[0].id, '5'); assert.equal(c.creators.at(-1).id, '104');
  assert.equal(c.selectedIds.length, 100); assert.equal(c.selectedIds.at(-1), '104');
  assert.equal(new Set(c.creators.map(r => r.id)).size, 100);
});

test('不足、停滞及不支持加载均有明确差额，不能静默就绪', () => {
  const c = createCollection(100, binding, 'c', 1000);
  const end = updateCollection(c, page(24, false), state(), binding, 1100);
  assert.equal(end.status, 'insufficient'); assert.equal(end.shortfall, 76);
  const waiting = updateCollection(c, page(12), state(), binding, 1100);
  assert.equal(updateCollection(waiting, page(12), state(), binding, STALL_MS - 5000).status, 'collecting');
  assert.equal(updateCollection(waiting, page(12), state(), binding, STALL_MS + 5000).status, 'insufficient');
  const unknown = page(12); unknown.list.supported = false;
  assert.equal(updateCollection(c, unknown, state(), binding, 1100).status, 'insufficient');
  const capped = page(12); capped.list.truncated = true;
  assert.equal(updateCollection(c, capped, state(), binding, 1100).shortfall, 88);
  assert.equal(updateCollection(c, capped, state(), binding, 1100).status, 'insufficient');
  const timeout = updateCollection(c, page(24), state(), binding, BUDGET_MS + 2000);
  assert.equal(timeout.status, 'insufficient'); assert.match(timeout.reason, /超时/);
});

test('切店铺/文档/会话及DOM替换或重排使缓存名单失效', () => {
  const ready = updateCollection(createCollection(10, binding, 'c', 1000), page(12), state(), binding, 1100);
  for (const key of Object.keys(binding)) {
    const changed = updateCollection(ready, page(12), state(), { ...binding, [key]: 'other' }, 1200);
    assert.equal(changed.status, 'invalid', key);
  }
  const replaced = page(12); replaced.creators[0] = row(99);
  assert.equal(updateCollection(ready, replaced, state(), binding, 1200).status, 'invalid');
  assert.equal(updateCollection(ready, page(6), state(), binding, 1200).status, 'invalid');
  const changed = state(); changed.denied['10'] = { '1': {} };
  const checked = updateCollection(ready, page(12), changed, binding, 1200);
  assert.equal(checked.status, 'ready'); assert.equal(checked.shortfall, 1); assert.equal(checked.selectedIds.includes('1'), false);
});

test('只接受1到200整数；重复身份不补足名额', () => {
  for (const n of [0, -1, 201, NaN, Infinity, 1.5, '100', null]) assert.throws(() => createCollection(n, binding, 'c', 1), /目标/);
  const p = page(12, false); p.creators[11] = { ...p.creators[0], rowKey: '11_10001' };
  const c = updateCollection(createCollection(12, binding, 'c', 1), p, state(), binding, 2);
  assert.equal(c.count, 11); assert.equal(c.candidateTarget, 14); assert.equal(c.shortfall, 1); assert.equal(c.status, 'insufficient');
});

test('指定名单按页面顺序匹配唯一ID，缺失时继续加载且绝不以其他达人补位', () => {
  const source = { type: 'specified', creatorIds: ['8', '3', '8', '15'], nameIncludes: '', nameExcludes: '' };
  const start = createCollection(3, binding, 'specified', 1000, source);
  assert.deepEqual(start.source.creatorIds, ['8', '3', '15']);
  let c = updateCollection(start, page(12), state(), binding, 1100);
  assert.equal(c.status, 'collecting');
  assert.deepEqual(c.creators.map(row => row.id), ['3', '8']);
  assert.deepEqual([c.count, c.shortfall, c.matched, c.missing, c.excluded], [2, 1, 2, 1, 0]);
  c = updateCollection(c, page(24), state(), binding, 1200);
  assert.equal(c.status, 'ready');
  assert.deepEqual(c.creators.map(row => row.id), ['3', '8', '15']);
  assert.deepEqual([c.matched, c.missing, c.excluded], [3, 0, 0]);
  assert.equal(start.observed.length, 0);
  assert.deepEqual(source.creatorIds, ['8', '3', '8', '15']);
  assert.throws(() => createCollection(4, binding, 'wrong', 1000, source), /目标|指定|人数|名单/);
});

test('指定ID缺失或被姓名、历史、拒绝及入口拦截均保留差额，汇总不包含身份', () => {
  const source = { type: 'specified', creatorIds: ['1', '2', '3', '4', '5', '6', '99'], nameIncludes: 'ayu', nameExcludes: 'bot' };
  const p = page(12, false);
  p.creators.forEach(row => { row.name = `AYU ${row.id}`; });
  p.creators[1].name = 'Ayu BOT';
  p.creators[2].name = 'Budi';
  p.creators[5].chatAvailable = false;
  const protectedState = state(); protectedState.history['10'] = { '4': { status: 'uncertain', submittedCount: 1 } }; protectedState.denied['10'] = { '5': {} };
  const c = updateCollection(createCollection(7, binding, 'specified', 1000, source), p, protectedState, binding, 1100);
  assert.equal(c.status, 'insufficient');
  assert.deepEqual(c.creators.map(row => row.id), ['1']);
  assert.deepEqual([c.count, c.shortfall, c.matched, c.missing, c.excluded], [1, 6, 6, 1, 5]);
  for (const key of ['matched', 'missing', 'excluded']) assert.equal(typeof c[key], 'number');
  assert.match(c.reason, /目标 7 人，可用 1 人，仍缺 6 人/);
  assert.equal(c.reason.includes('AYU'), false);
  assert.equal(protectedState.history['10']['4'].submittedCount, 1);
});

test('广场姓名筛选不绕过防重发或拒绝规则，旧collection无source仍可继续和就绪', () => {
  const source = { type: 'marketplace', nameIncludes: ' ayu ', nameExcludes: ' BOT ' };
  const p = page(12, false);
  p.creators.forEach(row => { row.name = `AYU ${row.id}`; });
  p.creators[0].name = 'Budi'; p.creators[1].name = 'AYU BOT';
  const protectedState = state(); protectedState.history['10'] = { '3': { status: 'confirmed' } }; protectedState.denied['10'] = { '4': {} };
  const c = updateCollection(createCollection(2, binding, 'filtered', 1000, source), p, protectedState, binding, 1100);
  assert.equal(c.status, 'ready');
  assert.deepEqual(c.creators.map(row => row.id), ['5', '6']);
  assert.deepEqual(c.selectedIds, ['5', '6']);
  assert.deepEqual([c.matched, c.missing, c.excluded], [12, 0, 4]);
  const legacy = createCollection(15, binding, 'old', 1000); delete legacy.source;
  const partial = updateCollection(legacy, page(12), state(), binding, 1100);
  assert.equal(partial.status, 'collecting');
  const finished = updateCollection(partial, page(24), state(), binding, 1200);
  assert.equal(finished.status, 'ready');
  assert.equal(finished.count, 15);
  assert.equal(finished.selectedCount, 15);
  assert.deepEqual(finished.source, { type: 'marketplace', creatorIds: [], nameIncludes: '', nameExcludes: '' });
});

test('指定名单仍锁定完整原始前缀，重排、移除、入口变化或新增防重发记录即失效', () => {
  const c = updateCollection(createCollection(2, binding, 'specified', 1000, { type: 'specified', creatorIds: ['3', '8'] }), page(12), state(), binding, 1100);
  assert.equal(c.status, 'ready'); assert.equal(c.observed.length, 12);
  const appended = updateCollection(c, page(24), state(), binding, 1200);
  assert.equal(appended.status, 'ready'); assert.deepEqual(appended.creators, c.creators);
  for (const mutate of [p => p.creators.reverse(), p => p.creators.shift(), p => { p.creators[2].chatAvailable = false; }]) {
    const changed = page(12); mutate(changed);
    assert.equal(updateCollection(c, changed, state(), binding, 1200).status, 'invalid');
  }
  const protectedState = state(); protectedState.history['10'] = { '3': { status: 'uncertain' } };
  assert.equal(updateCollection(c, page(12), protectedState, binding, 1200).status, 'invalid');
});

test('旧ready名单补齐默认来源与统计但不改已锁定人选，恢复的指定人数不符则失效', () => {
  const protectedState = state(); protectedState.denied['10'] = { '1': {} };
  const legacy = updateCollection(createCollection(2, binding, 'legacy', 1000), page(12), protectedState, binding, 1100);
  const original = structuredClone(legacy.creators);
  for (const key of ['source', 'matched', 'missing', 'excluded']) delete legacy[key];
  const checked = updateCollection(legacy, page(24), protectedState, binding, 1200);
  assert.equal(checked.status, 'ready');
  assert.deepEqual(checked.creators, original);
  assert.deepEqual([checked.matched, checked.missing, checked.excluded], [12, 0, 1]);
  assert.equal(legacy.source, undefined);
  const specified = createCollection(2, binding, 'bad-restored', 1000, { type: 'specified', creatorIds: ['3', '8'] });
  specified.target = 1;
  assert.equal(updateCollection(specified, page(12), state(), binding, 1200).status, 'invalid');
});

test('从广场可见锚点起准备，保留完整挂载前缀且继续排除历史与拒绝', () => {
  const protectedState = state(); protectedState.history['10'] = { '6': { status: 'confirmed' } }; protectedState.denied['10'] = { '7': {} };
  const first = page(12); first.list.startId = '5'; first.list.filterContext = 'Beauty|Shopee Video|';
  let c = updateCollection(createCollection(8, binding, 'current', 1000, { startPosition: 'current' }), first, protectedState, binding, 1100);
  assert.equal(c.startId, '5');
  assert.equal(c.filterContext, first.list.filterContext);
  assert.equal(c.status, 'collecting');
  assert.deepEqual(c.creators.map(row => row.id), ['5', '8', '9', '10', '11', '12']);
  assert.deepEqual([c.matched, c.missing, c.excluded], [8, 0, 2]);
  assert.equal(c.observed.length, 12);
  const next = page(24); next.list.startId = '10'; next.list.filterContext = first.list.filterContext;
  c = updateCollection(c, next, protectedState, binding, 1200);
  assert.equal(c.status, 'ready');
  assert.equal(c.startId, '5');
  assert.deepEqual(c.creators.map(row => row.id), ['5', '8', '9', '10', '11', '12', '13', '14']);
  assert.deepEqual(c.selectedIds, ['5', '8', '9', '10', '11', '12', '13', '14']);
  const replacedPrefix = structuredClone(next); replacedPrefix.creators[0] = row(99);
  assert.equal(updateCollection(c, replacedPrefix, protectedState, binding, 1300).status, 'invalid');
});

test('广场当前位置无唯一可见锚点明确失效，加载期间等待可靠位置', () => {
  const initial = () => createCollection(2, binding, 'current', 1000, { startPosition: 'current' });
  for (const startId of [undefined, null, '', '99', 1]) {
    const p = page(12); p.list.startId = startId;
    const c = updateCollection(initial(), p, state(), binding, 1100);
    assert.equal(c.status, 'invalid'); assert.match(c.reason, /可见|位置|锚点/);
  }
  const duplicate = page(12); duplicate.list.startId = '5'; duplicate.creators[11] = { ...row(5), rowKey: 'duplicate' };
  assert.equal(updateCollection(initial(), duplicate, state(), binding, 1100).status, 'invalid');
  const loading = page(12); loading.list.loading = true;
  const waiting = updateCollection(initial(), loading, state(), binding, 1100);
  assert.equal(waiting.status, 'collecting'); assert.equal(waiting.count, 0); assert.equal(waiting.startId, undefined);
  const loaded = page(12); loaded.list.startId = '5';
  assert.deepEqual(updateCollection(waiting, loaded, state(), binding, 1200).creators.map(row => row.id), ['5', '6']);
});

test('恢复的当前位置名单丢失或损坏固定锚点时拒绝，不退回最后一人', () => {
  const p = page(12); p.list.startId = '5';
  for (const target of [2, 20]) {
    const c = updateCollection(createCollection(target, binding, 'current', 1000, { startPosition: 'current' }), p, state(), binding, 1100);
    for (const startId of [undefined, null, '', '99']) {
      const restored = { ...c, startId };
      assert.equal(updateCollection(restored, p, state(), binding, 1200).status, 'invalid');
    }
  }
});

test('页面筛选上下文锁定后变化或消失即失效，旧名单不强制新增上下文', () => {
  const first = page(12); first.list.filterContext = 'Beauty|Shopee Video|ayu';
  const c = updateCollection(createCollection(2, binding, 'filters', 1000, { webFilters: { category: 'Beauty', channel: 'Shopee Video' } }), first, state(), binding, 1100);
  assert.equal(c.filterContext, first.list.filterContext);
  for (const filterContext of ['Health|Shopee Video|ayu', undefined, '', null]) {
    const changed = page(12); changed.list.filterContext = filterContext;
    assert.equal(updateCollection(c, changed, state(), binding, 1200).status, 'invalid');
  }
  const old = updateCollection(createCollection(2, binding, 'old', 1000), page(12), state(), binding, 1100);
  assert.equal(Object.hasOwn(old, 'filterContext'), false);
  assert.equal(updateCollection(old, page(12), state(), binding, 1200).status, 'ready');
  const consumed = { ...c, status: 'consumed' };
  assert.deepEqual(updateCollection(consumed, page(12), state(), binding, 1200), consumed);
});

test('旧名称搜索来源和完整筛选锁保持可读，原页人工搜索变化仍使名单失效', () => {
  const p = page(12);
  p.list.filterContext = JSON.stringify({ source: 'marketplace', current: { category: 'Beauty', channel: '102', search: 'ayu' }, fields: { affiliateName: 'ayu' }, applied: { user_name: 'ayu' }, sort: 0 });
  const c = createCollection(2, binding, 'legacy-search', 1000);
  c.source.webFilters = { category: 'Beauty', channel: '102', search: 'ayu' };
  c.filterContext = p.list.filterContext;
  const before = structuredClone(c), ready = updateCollection(c, p, state(), binding, 1100);
  assert.equal(ready.status, 'ready'); assert.deepEqual(ready.source, c.source);
  assert.deepEqual(c, before);
  const changed = structuredClone(p); changed.list.filterContext = p.list.filterContext.replaceAll('ayu', 'other');
  assert.equal(updateCollection(ready, changed, state(), binding, 1200).status, 'invalid');
});

test('100人目标缓冲到110名候选，默认选择页面顺序前100人', () => {
  const c = updateCollection(createCollection(100, binding, 'candidates', 1000), page(120), state(), binding, 1100);
  assert.equal(c.status, 'ready');
  assert.equal(c.target, 100);
  assert.equal(c.candidateTarget, 110);
  assert.equal(c.candidateCount, 110);
  assert.equal(c.candidates.length, 110); assert.equal(c.creators.length, 100);
  assert.deepEqual(c.selectedIds, c.candidates.slice(0, 100).map(row => row.id));
  assert.equal(c.selectedCount, 100);
  assert.equal(c.selectionRemaining, 0);
});

test('取消默认前10人后可补足，优先选择未进入默认前100的101至110', () => {
  let c = updateCollection(createCollection(100, binding, 'candidates', 1000), page(120), state(), binding, 1100);
  for (const id of Array.from({ length: 10 }, (_, i) => String(i + 1))) c = selectCandidate(c, id, false);
  assert.equal(c.selectedCount, 90);
  assert.equal(c.selectionRemaining, 10);
  c = refillSelection(c);
  assert.equal(c.selectedCount, 100);
  assert.equal(c.selectionRemaining, 0);
  assert.equal(c.selectedIds.includes('1'), false);
  assert.deepEqual(c.selectedIds.slice(-10), Array.from({ length: 10 }, (_, i) => String(i + 101)));
});

test('备选用尽后补足不会偷偷恢复已取消的人，仍保持人数不足', () => {
  let c = updateCollection(createCollection(100, binding, 'candidates', 1000), page(110), state(), binding, 1100);
  for (const id of Array.from({ length: 11 }, (_, i) => String(i + 1))) c = selectCandidate(c, id, false);
  c = refillSelection(c);
  assert.equal(c.selectedCount, 99); assert.equal(c.selectionRemaining, 1);
  assert.equal(c.selectedIds.includes('1'), false);
  const again = refillSelection(c); assert.deepEqual(again.selectedIds, c.selectedIds);
  c = selectCandidate(c, '1', true); assert.equal(c.selectedCount, 100);
});

test('已选满时不能静默挤人，取消后可以勾选备选；任务已消费不能再改', () => {
  let c = updateCollection(createCollection(2, binding, 'candidates', 1000), page(4), state(), binding, 1100);
  assert.deepEqual(c.selectedIds, ['1', '2']);
  assert.throws(() => selectCandidate(c, '3', true), /取消|超出|已选/);
  c = selectCandidate(c, '1', false);
  c = selectCandidate(c, '3', true);
  assert.deepEqual(c.selectedIds, ['2', '3']);
  const consumed = { ...c, status: 'consumed' };
  assert.throws(() => selectCandidate(consumed, '4', true), /任务|锁定|状态/);
  assert.throws(() => refillSelection(consumed), /任务|锁定|状态/);
});

test('候选目标按10%向上取整且绝不突破200', () => {
  for (const [target, candidateTarget] of [[1, 2], [100, 110], [150, 165], [181, 200], [182, 200], [200, 200]]) {
    const c = createCollection(target, binding, `rounded-${target}`, 1000);
    assert.equal(c.candidateTarget, candidateTarget, String(target));
  }
});

test('候选池耗尽但已达N人仍可完成，缓冲不足明确显示', () => {
  let c = updateCollection(createCollection(100, binding, 'short-buffer', 1000), page(105, false), state(), binding, 1100);
  assert.equal(c.status, 'ready');
  assert.equal(c.candidateCount, 105);
  assert.equal(c.selectedCount, 100);
  assert.match(c.reason, /候选|缓冲/);
});

test('旧名单没有显式选择时恢复为已锁定creators，不重新选择用户名单', () => {
  const old = updateCollection(createCollection(3, binding, 'legacy', 1000), page(5), state(), binding, 1100);
  for (const key of ['candidateTarget', 'candidates', 'selectedIds', 'selectionVersion', 'selectionRevision', 'excludedIds']) delete old[key];
  delete old.creators;
  old.creators = Array.from({ length: 3 }, (_, i) => row(i + 1));
  const restored = updateCollection(old, page(5), state(), binding, 1200);
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.creators.map(row => row.id), ['1', '2', '3']);
  assert.equal(restored.selectionVersion, undefined);
});

test('选择按原页排序，取消过的备选不会自动补回，恢复默认需显式触发', () => {
  let c = updateCollection(createCollection(10, binding, 'c', 1), page(20), state(), binding, 2);
  c = selectCandidate(c, '1', false); c = selectCandidate(c, '11', true);
  c = selectCandidate(c, '11', false); c = refillSelection(c);
  assert.equal(c.count, 9); assert.equal(c.selectedIds.includes('1'), false);
  c = selectCandidate(c, '1', true); assert.deepEqual(c.creators.map(r => r.id), Array.from({length:10}, (_,i) => String(i+1)));
  c = selectCandidate(c, '1', false); c = resetSelection(c);
  assert.equal(c.count, 10); assert.equal(c.selectedIds[0], '1');
});

test('显式继续加载保留旧选择且只追加到200上限，完成后不自动选新候选', () => {
  let c = updateCollection(createCollection(100, binding, 'c', 1), page(120), state(), binding, 2);
  for(let i=1;i<=11;i++) c = selectCandidate(c, String(i), false);
  c = refillSelection(c); c = extendCandidates(c, 1000);
  assert.equal(c.status, 'collecting'); assert.equal(c.candidateTarget, 120);
  c = updateCollection(c, page(120), state(), binding, 1100);
  assert.equal(c.status, 'ready'); assert.equal(c.count, 99);
  c = refillSelection(c); assert.equal(c.count, 100); assert.equal(c.selectedIds.at(-1), '111');
  const capped = updateCollection(createCollection(200, binding, 'cap', 1), page(204), state(), binding, 2);
  assert.throws(() => extendCandidates(capped, 3), /200|上限/);
});

test('被历史或拒绝排除的备选不能勾选，已选移除后不会自动补人', () => {
  let c = updateCollection(createCollection(10, binding, 'c', 1), page(12), state(), binding, 2);
  const nextState = state(); nextState.denied['10'] = {'11': {}}; nextState.history['10'] = {'1': {status:'uncertain'}};
  c = updateCollection(c, page(12), nextState, binding, 3);
  assert.equal(c.status, 'ready'); assert.equal(c.count, 9); assert.equal(c.selectedIds.includes('1'), false);
  assert.throws(() => selectCandidate(c, '11', true), /不可|记录/);
  assert.equal(refillSelection(c).count, 9);
});

test('首次准备过程中资格变化不占候选名额，默认前N来自当前可用人选', () => {
  let c=updateCollection(createCollection(10,binding,'c',1),page(8),state(),binding,2);
  const changed=state();changed.denied['10']={'1':{}};
  c=updateCollection(c,page(11),changed,binding,3);
  assert.equal(c.status,'collecting');assert.equal(c.candidateCount,10);assert.equal(c.count,10);
  c=updateCollection(c,page(12),changed,binding,4);
  assert.equal(c.status,'ready');assert.equal(c.candidates[0].id,'2');assert.equal(c.selectedIds.at(-1),'11');
});

test('人数不足时保留候选并可继续准备，继续后接着加载到备齐', () => {
  const stalled = updateCollection(createCollection(100, binding, 'c', 1), page(24), state(), binding, BUDGET_MS + 2000);
  assert.equal(stalled.status, 'insufficient'); assert.equal(stalled.candidateCount, 24);
  const resumed = continueCollection(stalled, 10_000);
  assert.equal(resumed.status, 'collecting'); assert.equal(resumed.candidateCount, 24);
  assert.equal(resumed.selectedIds.length, 24); assert.equal(resumed.candidateTarget, 110);
  assert.throws(() => continueCollection({ ...stalled, status: 'ready' }, 10_000), /不能继续准备/);
  assert.throws(() => continueCollection({ ...stalled, candidateTarget: 200, candidates: Array.from({ length: 200 }, (_, i) => row(i + 1)) }, 10_000), /200/);
  const next = updateCollection(resumed, page(120), state(), binding, 12_000);
  assert.equal(next.status, 'ready'); assert.equal(next.candidateCount, 110); assert.equal(next.count, 100);
});
