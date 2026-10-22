// Collection never sends or reserves history. Only a complete, still-mounted
// roster may be handed to the existing single-use send queue.
import { normalizeSource, matchesSource } from './audience.mjs';
import { observeLeaderboard } from './leaderboard.mjs';
import { observeAffiliates } from './affiliate-source.mjs';

export const rosterSignature = creators => JSON.stringify(creators.map(({ id, name, rowKey, chatAvailable }) => [id, name, rowKey, chatAvailable]));
const eligible = (state, shopId, row) => row.chatAvailable === true &&
  !Object.hasOwn(state.history?.[shopId] || {}, row.id) && !Object.hasOwn(state.denied?.[shopId] || {}, row.id);
const candidateTargetFor = target => Math.min(200, target + Math.ceil(target / 10));
const selectable = c => c?.selectionVersion === 1 && ['marketplace', 'leaderboard'].includes(c.source?.type);

function withSelection(c, ids, excludedIds = c.excludedIds) {
  const selected = new Set(ids), unavailable = new Set(c.unavailableIds);
  const creators = c.candidates.filter(row => selected.has(row.id) && !unavailable.has(row.id));
  return { ...c, creators, selectedIds: creators.map(row => row.id), count: creators.length,
    shortfall: Math.max(0, c.target - creators.length), selectedCount: creators.length,
    selectionRemaining: Math.max(0, c.target - creators.length), excludedIds,
    candidateCount: c.candidates.length, candidateShortfall: Math.max(0, c.candidateTarget - c.candidates.length) };
}

function checkSelection(c) {
  if (!selectable(c) || c.status !== 'ready' || c.pagePending) throw new Error('名单尚未备齐或已进入任务，不能修改选择');
}

function refreshSelection(c, state) {
  const unavailableIds = c.candidates.filter(row => !matchesSource(c.source, row) || !eligible(state, c.binding.shopId, row)).map(row => row.id);
  const next = withSelection({ ...c, unavailableIds }, c.selectedIds);
  if (JSON.stringify(next.selectedIds) !== JSON.stringify(c.selectedIds) || JSON.stringify(unavailableIds) !== JSON.stringify(c.unavailableIds)) next.selectionRevision++;
  return next;
}

function selectRows(rows, state, shopId, source, startId) {
  // Keep the complete observed roster for replacement checks; only audience
  // selection starts at the fixed visible row captured during preparation.
  const candidates = source.type === 'marketplace' && source.startPosition === 'current' ? rows.slice(rows.findIndex(row => row.id === startId)) : rows;
  const seen = new Set();
  let matched = 0, excluded = 0;
  const creators = candidates.filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    if (source.type === 'specified' && !source.creatorIds.includes(row.id)) return false;
    matched++;
    if (!matchesSource(source, row) || !eligible(state, shopId, row)) { excluded++; return false; }
    return true;
  });
  return { creators, matched, missing: source.type === 'specified' ? source.creatorIds.length - matched : 0, excluded };
}

export function createCollection(target, binding, id, now, source) {
  if (!Number.isInteger(target) || target < 1 || target > 200) throw new Error('目标人数必须是 1–200 的整数');
  const normalized = normalizeSource(source);
  if (normalized.type === 'specified' && target !== normalized.creatorIds.length) throw new Error('目标人数必须等于指定名单的唯一 ID 数量');
  if (normalized.type === 'affiliates' && target !== normalized.affiliateIds.length) throw new Error('目标人数必须等于指定联盟伙伴的唯一 ID 数量');
  const selection = ['marketplace', 'leaderboard'].includes(normalized.type) ? { selectionVersion: 1, selectionRevision: 0,
    candidateTarget: candidateTargetFor(target), candidates: [], candidateCount: 0, candidateShortfall: candidateTargetFor(target),
    selectedIds: [], selectedCount: 0, selectionRemaining: target, excludedIds: [], unavailableIds: [], selectionInitialized: false } : {};
  return { id, target, ...selection,
    source: normalized, binding: structuredClone(binding), status: 'collecting', creators: [], observed: [], count: 0, shortfall: target,
    matched: 0, missing: normalized.affiliateIds?.length ?? normalized.creatorIds.length, excluded: 0, reason: null, startedAt: now, progressAt: now, updatedAt: now, action: null };
}

export function invalidateCollection(collection, reason) {
  return collection ? { ...collection, status: 'invalid', action: null, reason } : null;
}

export function updateCollection(collection, page, state, binding, now) {
  if (!collection || !['collecting', 'ready'].includes(collection.status)) return collection;
  let c = structuredClone(collection);
  let rows = page.creators || [];
  c.source = normalizeSource(c.source);
  c.updatedAt = now;
  const invalid = reason => invalidateCollection(c, reason);
  if (c.source.type === 'specified' && c.target !== c.source.creatorIds.length) return invalid('目标人数与指定名单不符，请重新准备名单');
  if (c.source.type === 'affiliates' && c.target !== c.source.affiliateIds.length) return invalid('目标人数与指定联盟伙伴不符，请重新准备名单');
  if (Object.keys(c.binding).some(key => c.binding[key] !== binding[key]) || page.shop.id !== c.binding.shopId) return invalid('店铺、文档或页面会话已变化，请重新准备名单');
  if (c.filterContext !== undefined && c.filterContext !== page.list?.filterContext) return invalid('页面筛选条件已变化，请重新准备名单');
  if (c.filterContext === undefined && typeof page.list?.filterContext === 'string' && page.list.filterContext) c.filterContext = page.list.filterContext;
  if (!c.observed.length && !page.list?.loading && typeof page.list?.startId === 'string' && page.list.startId) c.startId = page.list.startId;
  if (c.source.type === 'marketplace' && c.source.startPosition === 'current') {
    if (!c.observed.length && page.list?.loading) return now - c.progressAt >= 45_000 ? invalid('当前位置页面加载超时，请重新准备名单') : c;
    if (!page.list?.supported || typeof c.startId !== 'string' || !c.startId || !rows.some(row => row.id === c.startId) || (!c.observed.length && rows.filter(row => row.id === c.startId).length !== 1)) return invalid('当前屏幕没有可靠且唯一的可见达人位置，请定位后重新准备名单');
  }
  if (c.source.type === 'affiliates') {
    c = observeAffiliates(c, page, state, now);
    if (c.status === 'ready' && c.creators.some(row => !matchesSource(c.source, row) || !eligible(state, binding.shopId, row))) return invalid('锁定名单的历史或拒绝记录已变化，请重新准备名单');
    return c;
  }
  if (c.source.type === 'leaderboard') {
    c = observeLeaderboard(c, page, now);
    if (c.status === 'invalid' || c.pagePending) return c;
    rows = c.observed;
  } else if (rows.length < c.observed.length || rosterSignature(rows.slice(0, c.observed.length)) !== rosterSignature(c.observed)) return invalid('列表已替换、重排或入口已变化，请重新准备名单');
  if (c.status === 'ready') {
    if (!selectable(c) && c.creators.some(row => !matchesSource(c.source, row) || !eligible(state, binding.shopId, row))) return invalid('锁定名单的历史或拒绝记录已变化，请重新准备名单');
    if (['matched', 'missing', 'excluded'].some(key => c[key] === undefined)) {
      const { creators, ...counts } = selectRows(c.observed, state, binding.shopId, c.source, c.startId);
      Object.assign(c, counts);
    }
    return selectable(c) ? refreshSelection(c, state) : c;
  }
  if (rows.length > c.observed.length) c.progressAt = now;
  c.observed = rows.map(({ id, name, rowKey, chatAvailable, page }) => ({ id, name, rowKey, chatAvailable, ...(page === undefined ? {} : { page }) }));
  const { creators, ...counts } = selectRows(c.observed, state, binding.shopId, c.source, c.startId);
  c.creators = creators.slice(0, c.target);
  Object.assign(c, counts);
  c.count = c.creators.length;
  c.shortfall = c.target - c.count;
  if (selectable(c)) {
    // An explicit extension keeps the frozen pool (including cancelled rows) and
    // only appends newly observed, eligible identities. It never resets selection.
    const prior = new Set(c.candidates.map(row => row.id));
    c.candidates = (c.selectionInitialized ? [...c.candidates, ...creators.filter(row => !prior.has(row.id))] : creators).slice(0, c.candidateTarget);
    c = refreshSelection(c, state);
    if (!c.selectionInitialized) c = withSelection(c, c.candidates.slice(0, c.target).map(row => row.id));
  }
  if (selectable(c) ? !c.candidateShortfall : !c.shortfall) {
    c.status = 'ready'; c.action = null; c.reason = '目标名单已备齐并锁定';
    if (selectable(c)) c.selectionInitialized = true;
    return c;
  }
  const reason = page.list?.truncated ? '加载名单达到检查上限' : !page.list?.supported ? '当前页面加载结构无法可靠识别' : page.list.hasMore === false && !page.list.loading ? '页面已无更多达人' : now - c.progressAt >= 45_000 ? '页面加载停滞，未取得更多达人' : now - c.startedAt >= 600_000 ? '名单准备超时' : null;
  if (reason) {
    if (selectable(c) && page.list?.supported && !page.list.truncated && page.list.hasMore === false && !page.list.loading && c.candidateCount >= c.target) {
      c.status = 'ready'; c.action = null; c.reason = `候选缓冲不足：目标 ${c.target} 人，仅准备 ${c.candidateCount} 名候选；仍须选择 ${c.target} 人`;
      c.selectionInitialized = true;
    } else {
      c.status = 'insufficient'; c.action = null; c.reason = `${reason}：目标 ${c.target} 人，可用 ${c.count} 人，仍缺 ${c.shortfall} 人；不能启动`;
    }
  }
  return c;
}

export function selectCandidate(collection, creatorId, selected) {
  checkSelection(collection);
  if (typeof selected !== 'boolean' || typeof creatorId !== 'string') throw new Error('选择状态无效');
  const c = collection;
  if (!c.candidates.some(row => row.id === creatorId)) throw new Error('候选达人不在锁定名单中');
  if (selected && c.unavailableIds.includes(creatorId)) throw new Error('该候选已不可选，请核对历史或拒绝记录');
  if (selected === c.selectedIds.includes(creatorId)) return structuredClone(c);
  if (selected && c.count >= c.target) throw new Error(`已选满 ${c.target} 人，请先取消一名再选择`);
  const ids = selected ? [...c.selectedIds, creatorId] : c.selectedIds.filter(id => id !== creatorId);
  const excludedIds = selected ? c.excludedIds.filter(id => id !== creatorId) : [...new Set([...c.excludedIds, creatorId])];
  return withSelection({ ...c, selectionRevision: c.selectionRevision + 1 }, ids, excludedIds);
}

export function refillSelection(collection) {
  checkSelection(collection);
  const c = collection;
  const selectedIds = [...c.selectedIds];
  const selectedNow = new Set(c.selectedIds);
  const excluded = new Set([...c.excludedIds, ...c.unavailableIds]);
  const refillOrder = c.candidates.map(row => row.id).filter(id => !excluded.has(id));
  for (const id of refillOrder) {
    if (selectedIds.length >= c.target) break;
    if (!selectedNow.has(id)) selectedIds.push(id);
  }
  return withSelection({ ...c, selectionRevision: c.selectionRevision + 1 }, selectedIds);
}

export function resetSelection(c) {
  checkSelection(c);
  return withSelection({ ...c, selectionRevision: c.selectionRevision + 1 }, c.candidates.filter(row => !c.unavailableIds.includes(row.id)).slice(0, c.target).map(row => row.id), []);
}

export function extendCandidates(c, now) {
  checkSelection(c);
  if (c.candidates.length >= 200) throw new Error('候选已达200人上限，请手动勾回已取消人员');
  return { ...c, status: 'collecting', candidateTarget: Math.min(200, c.candidates.length + Math.ceil(c.target / 10)),
    action: null, startedAt: now, progressAt: now, updatedAt: now, selectionRevision: c.selectionRevision + 1, reason: '正在继续准备候选，原选择保留' };
}
