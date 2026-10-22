import { matchesAffiliateSnapshot, resolveAffiliateIdentities } from './affiliate-resolver.mjs';
import { matchesSource } from './audience.mjs';

export const AFFILIATE_PATH = '/portal/web-seller-affiliate/kol_marketplace/detail';
const invalid = (c, reason) => ({ ...c, status: 'invalid', action: null, reason });
export function observeAffiliates(c, page, state, now) {
  const ids = c.source.affiliateIds, evidence = page.affiliateEvidence;
  c.affiliateState ||= { observations: [], currentAffiliateId: ids[0], expectedAffiliateId: null, transitionAt: now };
  const a = c.affiliateState, expectedId = a.expectedAffiliateId || a.currentAffiliateId;
  if (!evidence || evidence.status !== 'verified') {
    if (evidence?.blocked || evidence?.shop?.id && evidence.shop.id !== c.binding.shopId || evidence?.reason && !['profile-unverified', 'shop-unavailable'].includes(evidence.reason)) return invalid(c, '联盟伙伴详情身份无法核实，请重新准备名单');
    if (now - (a.transitionAt ?? c.progressAt) >= 45000) return invalid(c, '联盟伙伴详情加载超时，请重新准备名单');
    c.pagePending = true; return c;
  }
  const record = evidence.affiliate;
  const expected = { affiliateId: expectedId, shopeeUserId: record?.shopeeUserId, shopId: c.binding.shopId, documentEpoch: c.binding.documentEpoch };
  if (!matchesAffiliateSnapshot(expected, evidence)) return invalid(c, '联盟伙伴详情与目标身份、店铺或文档不符，请重新准备名单');
  const prior = a.observations.find(p => p.affiliate.affiliateId === expectedId);
  if (prior && ['shopeeUserId', 'name', 'username'].some(key => prior.affiliate[key] !== record[key])) return invalid(c, '联盟伙伴身份映射或资料已变化，请重新准备名单');
  if (!prior && (c.status !== 'collecting' || ids[a.observations.length] !== expectedId)) return invalid(c, '联盟伙伴核对顺序已变化，请重新准备名单');
  if (!prior) { a.observations.push(structuredClone(evidence)); c.progressAt = now; }
  a.currentAffiliateId = expectedId; a.expectedAffiliateId = null; a.transitionAt = null;
  a.currentEpoch = evidence.documentEpoch; c.pagePending = false;
  const partialIds = ids.slice(0, a.observations.length);
  const resolved = resolveAffiliateIdentities(partialIds, a.observations, { shopId: c.binding.shopId });
  if (resolved.status !== 'resolved') return invalid(c, '联盟伙伴映射冲突或收件人重复，不能启动');
  const observed = resolved.identities.map(identity => ({ id: identity.shopeeUserId, name: identity.name, username: identity.username, rowKey: identity.affiliateId, affiliateId: identity.affiliateId, chatAvailable: true }));
  c.observed = observed;
  if (c.status === 'ready') return c;
  c.creators = observed.filter(row => matchesSource(c.source, row) && !Object.hasOwn(state.history?.[c.binding.shopId] || {}, row.id) && !Object.hasOwn(state.denied?.[c.binding.shopId] || {}, row.id));
  c.count = c.creators.length; c.shortfall = c.target - c.count; c.matched = observed.length; c.missing = ids.length - observed.length; c.excluded = observed.length - c.count;
  if (c.excluded) { c.status = 'insufficient'; c.reason = '指定联盟伙伴被筛选、历史或拒绝记录排除，不能补人启动'; c.action = null; }
  else if (observed.length === ids.length) { c.status = 'ready'; c.reason = '目标名单已备齐并锁定'; c.action = null; }
  return c;
}

export function affiliateRoster(c, creator) {
  const a = c.affiliateState;
  if (c.pagePending || !creator || a?.expectedAffiliateId || a?.currentAffiliateId !== creator.affiliateId || a?.currentEpoch !== c.binding.documentEpoch) throw new Error('联盟伙伴当前详情尚未核对或不是目标详情');
  return { creator, affiliate: { affiliateId: creator.affiliateId, shopeeUserId: creator.id, shopId: c.binding.shopId, documentEpoch: a.currentEpoch } };
}
