// Pagination replaces mounted rows. Only a persisted, controlled transition may
// introduce a new page; revisited pages must match their entire original roster.
export const LEADERBOARD_PATH = '/portal/web-seller-affiliate/affiliate_leaderboard';
const signature = rows => JSON.stringify(rows.map(({ id, name, rowKey, chatAvailable }) => [id, name, rowKey, chatAvailable]));
const invalid = (c, reason) => ({ ...c, status: 'invalid', action: null, reason });

export function observeLeaderboard(collection, page, now) {
  const c = collection, p = page.list?.pagination;
  if (c.pagination && typeof p?.context === 'string' && c.pagination.context !== p.context) return invalid(c, '榜单、周期、分类、渠道或分页条件已变化，请重新准备名单');
  if (c.pagination?.expectedPage !== null && c.pagination?.expectedPage !== undefined && now - c.pagination.transitionAt >= 45000) return invalid(c, '排行榜翻页超时，请重新准备名单');
  if (page.list?.loading && (c.status === 'collecting' || c.pagination?.expectedPage)) {
    if (now - (c.pagination?.transitionAt ?? c.progressAt) >= 45000) return invalid(c, '排行榜加载超时，请重新准备名单');
    return { ...c, pagePending: true };
  }
  if (!page.list?.supported || !p || !Number.isInteger(p.page) || p.page < 1 || p.pageSize !== 20 || !Number.isInteger(p.total) || p.total < 0 || p.total > 200 || p.page > Math.max(1, Math.ceil(p.total / p.pageSize)) || typeof p.context !== 'string' || !p.context) return invalid(c, '排行榜分页结构无法可靠识别，请重新准备名单');
  c.pagination ||= { context: p.context, pages: [], currentPage: p.page, expectedPage: null, transitionAt: null };
  const paging = c.pagination;
  if (p.page !== paging.currentPage && p.page !== paging.expectedPage) return invalid(c, '排行榜出现非受控翻页，请重新准备名单');
  if (page.list.loading || (paging.expectedPage !== null && p.page === paging.currentPage)) return { ...c, pagePending: true };
  const rows = page.creators || [], prior = paging.pages.find(entry => entry.page === p.page);
  if (prior && signature(prior.rows) !== signature(rows)) return invalid(c, '排行榜原页名单已替换或重排，请重新准备名单');
  if (!prior) {
    if (paging.pages.length && (c.status !== 'collecting' || p.page !== paging.expectedPage || p.page !== paging.pages.at(-1).page + 1)) return invalid(c, '排行榜页序不符，请重新准备名单');
    paging.pages.push({ page: p.page, rows: rows.map(({ id, name, rowKey, chatAvailable }) => ({ id, name, rowKey, chatAvailable, page: p.page })) });
    c.progressAt = now;
  }
  paging.currentPage = p.page; paging.expectedPage = null; paging.transitionAt = null;
  c.pagePending = false;
  c.observed = paging.pages.flatMap(entry => entry.rows);
  return c;
}

export function claimLeaderboardPage(collection, target, now) {
  const c = structuredClone(collection), p = c.pagination;
  if (!p || p.expectedPage !== null || !Number.isInteger(target) || Math.abs(target - p.currentPage) !== 1 || target < 1 || target > 10) throw new Error('排行榜翻页状态无效');
  if (c.status !== 'collecting' && !p.pages.some(entry => entry.page === target)) throw new Error('排行榜目标页未锁定');
  p.expectedPage = target; p.transitionAt = now; c.pagePending = true; c.action = null;
  return c;
}

export function leaderboardRoster(collection, creator) {
  const p = collection.pagination;
  if (!p || p.expectedPage !== null || p.currentPage !== creator?.page) throw new Error('排行榜目标页与当前页不符');
  const observed = p.pages.find(entry => entry.page === creator.page)?.rows;
  if (!observed?.some(row => signature([row]) === signature([creator]))) throw new Error('排行榜目标页名单未锁定');
  return { observed, creator, page: creator.page, context: p.context };
}
