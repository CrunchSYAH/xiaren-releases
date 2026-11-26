// 防重发记录按店铺与达人保存。记录只在最后一次写入（登记发送意图或确认提交）
// 之后满 HISTORY_WINDOW_MS 才失效，让同一达人可以被重新建联。
// 没有可信 updatedAt 的记录（旧数据、异常写入）永远保持阻断：宁可少发，也不因为
// 时间不明就把可能已经收到消息的达人再发一遍。
export const HISTORY_WINDOW_DAYS = 30;
export const HISTORY_WINDOW_MS = HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function historyExpired(record, now) {
  const updatedAt = record?.updatedAt;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  // A clock that went backwards must not release anything.
  return Number.isFinite(now) && now - updatedAt >= HISTORY_WINDOW_MS;
}

function ownValue(object, key) {
  return object && Object.hasOwn(object, key) ? object[key] : undefined;
}

// Only an own key counts: "constructor" or "__proto__" as creator ids must never
// resolve to inherited members and look like an existing record.
export function activeHistory(state, shopId, creatorId, now) {
  const record = ownValue(ownValue(state?.history, shopId), creatorId);
  return record && !historyExpired(record, now) ? record : null;
}

// Drops expired records in place and returns how many were removed, so callers
// that already cloned a state can prune it without paying for another copy.
export function pruneHistory(history, now) {
  if (!history || typeof history !== 'object') return 0;
  let removed = 0;
  for (const shopId of Object.keys(history)) {
    const shop = history[shopId];
    if (!shop || typeof shop !== 'object') continue;
    for (const creatorId of Object.keys(shop)) {
      if (!historyExpired(shop[creatorId], now)) continue;
      delete shop[creatorId];
      removed++;
    }
    if (!Object.keys(shop).length) delete history[shopId];
  }
  return removed;
}
