import { normalizeAffiliateIds } from './affiliate-resolver.mjs';

export function normalizeSource(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('名单来源无效');
  const type = source.type === undefined ? 'marketplace' : source.type;
  if (!['marketplace', 'specified', 'leaderboard', 'affiliates'].includes(type)) throw new Error('名单来源无效，仅支持达人广场、排行榜、指定联盟伙伴或指定已加载名单');
  const ids = source.creatorIds === undefined ? [] : source.creatorIds;
  if (!Array.isArray(ids) || Array.from(ids).some(id => typeof id !== 'string' || !/^\d+$/.test(id) || /^0+$/.test(id))) throw new Error('指定名单须使用数字字符串形式的 Shopee 用户 ID');
  const creatorIds = type === 'specified' ? [...new Set(ids)] : [];
  if (type === 'specified' && (creatorIds.length < 1 || creatorIds.length > 200)) throw new Error('指定名单须包含1—200个不同的 Shopee 用户 ID');
  const conditions = {};
  for (const key of ['nameIncludes', 'nameExcludes']) {
    const value = source[key] === undefined ? '' : source[key];
    if (typeof value !== 'string' || value.trim().length > 100) throw new Error('姓名筛选条件须为不超过100个字符的文字');
    conditions[key] = value.trim();
  }
  const pageOptions = {};
  if (source.startPosition !== undefined) {
    if (!['marketplace', 'leaderboard'].includes(type)) throw new Error('当前名单来源不支持从当前位置准备');
    if (source.startPosition !== 'current') throw new Error('名单起始位置无效');
    pageOptions.startPosition = 'current';
  }
  if (source.webFilters !== undefined) {
    if (!['marketplace', 'leaderboard'].includes(type)) throw new Error('当前名单来源不支持网页筛选');
    const filters = source.webFilters, keys = ['category', 'channel'];
    if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => ![...keys, 'search'].includes(key))) throw new Error('网页筛选条件无效');
    // Preserve the legacy search value in saved tasks/rosters; new preparation
    // rejects it and the page adapter never accepts a search action.
    if (Object.hasOwn(filters, 'search')) keys.push('search');
    pageOptions.webFilters = {};
    for (const key of keys) {
      const value = filters[key];
      if (typeof value !== 'string' || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('网页筛选条件须为不超过100个字符且不含控制字符的文字');
      pageOptions.webFilters[key] = value.trim();
    }
  }
  return { type, creatorIds, ...(type === 'affiliates' ? { affiliateIds: normalizeAffiliateIds(source.affiliateIds) } : {}), ...conditions, ...pageOptions };
}

// The caller normalizes the source once before checking the observed rows.
// This matcher only narrows the audience; eligibility remains in collection.
export function matchesSource(source, row) {
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return false;
  const name = row.name.toLowerCase();
  return (source.type !== 'specified' || source.creatorIds.includes(row.id)) &&
    (!source.nameIncludes || name.includes(source.nameIncludes.toLowerCase())) &&
    (!source.nameExcludes || !name.includes(source.nameExcludes.toLowerCase()));
}

