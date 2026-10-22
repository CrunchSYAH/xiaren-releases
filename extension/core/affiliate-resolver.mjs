const ORIGIN = 'https://seller.shopee.co.id';
const DETAIL_PATH = '/portal/web-seller-affiliate/kol_marketplace/detail';
const validId = value => typeof value === 'string' && /^[1-9]\d{0,39}$/.test(value);
const validEpoch = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function normalizeAffiliateIds(values) {
  if (!Array.isArray(values) || Array.from(values).some(value => !validId(value))) throw new Error('联盟伙伴 ID 须为无前导零的正整数字符串');
  const ids = [...new Set(values)];
  if (ids.length < 1 || ids.length > 200) throw new Error('指定联盟伙伴须包含1—200个不同的 ID');
  return ids;
}

export function affiliateDetailUrl(affiliateId) {
  if (!validId(affiliateId)) throw new Error('联盟伙伴 ID 无效');
  return `${ORIGIN}${DETAIL_PATH}?affiliate_id=${affiliateId}`;
}

function verifiedSnapshot(page, shopId) {
  const record = page?.affiliate;
  return page?.origin === ORIGIN && page.path === DETAIL_PATH && page.status === 'verified' && page.blocked === false
    && page.shop?.id === shopId && validEpoch(page.documentEpoch) && validId(record?.affiliateId) && validId(record?.shopeeUserId)
    && typeof record.name === 'string' && !!record.name.trim() && typeof record.username === 'string' && record.chatAvailable === true;
}

// Resolution is identity evidence, not a ready queue or permission to send.
// Every detail must be re-read in the sending document immediately before use.
export function resolveAffiliateIdentities(values, observations, { shopId } = {}) {
  const ids = normalizeAffiliateIds(values);
  if (!validId(shopId) || !Array.isArray(observations) || observations.length > 2000) throw new Error('联盟伙伴核对上下文无效');
  const candidates = new Map(ids.map(id => [id, []]));
  for (const page of observations) {
    if (verifiedSnapshot(page, shopId) && candidates.has(page.affiliate.affiliateId)) candidates.get(page.affiliate.affiliateId).push(page);
  }
  const identities = [], unresolved = [];
  for (const affiliateId of ids) {
    const pages = candidates.get(affiliateId);
    const userIds = new Set(pages.map(page => page.affiliate.shopeeUserId));
    if (userIds.size !== 1) {
      unresolved.push({ affiliateId, reason: userIds.size ? 'conflicting-mapping' : 'not-observed' });
      continue;
    }
    const page = pages.at(-1), record = page.affiliate;
    identities.push({ affiliateId, shopeeUserId: record.shopeeUserId, name: record.name, username: record.username,
      shopId, documentEpoch: page.documentEpoch, path: DETAIL_PATH, evidence: 'official-detail-profile' });
  }
  const recipients = new Map();
  for (const identity of identities) recipients.set(identity.shopeeUserId, (recipients.get(identity.shopeeUserId) || 0) + 1);
  const unique = identities.filter(identity => {
    if (recipients.get(identity.shopeeUserId) === 1) return true;
    unresolved.push({ affiliateId: identity.affiliateId, reason: 'duplicate-recipient' });
    return false;
  });
  unresolved.sort((a, b) => ids.indexOf(a.affiliateId) - ids.indexOf(b.affiliateId));
  return { status: unresolved.length ? 'blocked' : 'resolved', identities: unique, unresolved };
}

export function matchesAffiliateSnapshot(expected, page, { requireChat = false } = {}) {
  if (!validId(expected?.affiliateId) || !validId(expected?.shopeeUserId) || !validId(expected?.shopId) || !validEpoch(expected?.documentEpoch)
    || !verifiedSnapshot(page, expected.shopId) || page.documentEpoch !== expected.documentEpoch
    || page.affiliate.affiliateId !== expected.affiliateId || page.affiliate.shopeeUserId !== expected.shopeeUserId) return false;
  return !requireChat || (page.chat?.editorFound === true && page.chat.shopId === expected.shopId && page.chat.recipientId === expected.shopeeUserId);
}
