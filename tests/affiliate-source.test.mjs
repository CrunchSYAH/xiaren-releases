import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollection, updateCollection } from '../extension/core/collection.mjs';
import { affiliateRoster } from '../extension/core/affiliate-source.mjs';
import { initialState, reduceQueue } from '../extension/core/queue.mjs';
const binding = { shopId: '10', documentEpoch: 123 };
const state = { history: {}, denied: {} };
const evidence = (affiliateId = '100', shopeeUserId = '20', epoch = 123) => ({ origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace/detail', documentEpoch: epoch, status: 'verified', blocked: false, shop: { id: '10' }, affiliate: { affiliateId, shopeeUserId, name: `测试${affiliateId}`, username: `demo${affiliateId}`, chatAvailable: true } });
const page = e => ({ shop: { id: '10' }, affiliateEvidence: e });
const create = () => createCollection(2, binding, 'c', 1000, { type: 'affiliates', affiliateIds: ['100', '200'] });

test('联盟伙伴准备只用官方核实映射，输入顺序保留，不能以已加载用户ID冒充', () => {
  let c = updateCollection(create(), page(evidence()), state, binding, 1100);
  assert.equal(c.count, 1); assert.equal(c.status, 'collecting');
  c.affiliateState.expectedAffiliateId = '200'; c.affiliateState.transitionAt = 1200;
  c = updateCollection(c, page(evidence('200', '21')), state, binding, 1300);
  assert.equal(c.status, 'ready'); assert.deepEqual(c.creators.map(r => r.id), ['20', '21']);
  assert.deepEqual(c.creators.map(r => r.affiliateId), ['100', '200']);
  assert.equal(affiliateRoster(c, c.creators[1]).affiliate.shopeeUserId, '21');
  assert.throws(() => affiliateRoster(c, c.creators[0]), /详情|当前/);
});

test('映射冲突、同收件人、原资料改名、非受控详情及历史记录都不补人', () => {
  const first = updateCollection(create(), page(evidence()), state, binding, 1100);
  assert.equal(updateCollection(first, page(evidence('200', '21')), state, binding, 1200).status, 'invalid');
  const changed = evidence(); changed.affiliate.name = 'changed';
  assert.equal(updateCollection(first, page(changed), state, binding, 1200).status, 'invalid');
  const pending = structuredClone(first); pending.affiliateState.expectedAffiliateId = '200'; pending.affiliateState.transitionAt = 1200;
  assert.equal(updateCollection(pending, page(evidence('200', '20')), state, binding, 1300).status, 'invalid');
  const denied = updateCollection(create(), page(evidence()), { ...state, denied: { '10': { '20': {} } } }, binding, 1100);
  assert.equal(denied.status, 'insufficient'); assert.equal(denied.count, 0);
});

test('未加载详情只有限等待，店铺、文档和绑定仍严格核对', () => {
  const loading = evidence(); loading.status = 'blocked'; loading.affiliate = null; loading.reason = 'profile-unverified';
  const c = updateCollection(create(), page(loading), state, binding, 1100);
  assert.equal(c.pagePending, true); assert.equal(c.count, 0);
  assert.equal(updateCollection(c, page(loading), state, binding, 47000).status, 'invalid');
  assert.equal(updateCollection(create(), page(evidence()), state, { ...binding, documentEpoch: 124 }, 1100).status, 'invalid');
});

test('受控详情文档切换只接受preparing目标并旋转会话，暂停停止不被恢复', () => {
  const config = { shop: { id: '10', name: '测试店' }, creators: [{ id: '20', name: '测试100' }], source: { type: 'affiliates', affiliateIds: ['100'] }, messages: [{ type: 'text', content: 'Halo' }], intervalSeconds: 1, limit: 1, targetCount: 1, collectionId: 'c', mode: 'send' };
  let serial = 0; const deps = { now: 1000, uid: () => `id-${++serial}` };
  let s = reduceQueue(initialState(), { type: 'start', config, binding: { tabId: 7, pageId: 'old' } }, deps).state;
  s = reduceQueue(s, { type: 'poll', tabId: 7, pageId: 'old', shopId: '10', sessionId: s.task.sessionId }, deps).state;
  const event = { type: 'source-document', taskId: s.task.id, sessionId: s.task.sessionId, itemId: '20', binding: { tabId: 7, pageId: 'new' } };
  const next = reduceQueue(s, event, deps).state;
  assert.equal(next.task.binding.pageId, 'new'); assert.notEqual(next.task.sessionId, s.task.sessionId); assert.equal(next.task.items[0].status, 'pending');
  for (const type of ['pause', 'stop']) {
    const paused = reduceQueue(s, { type }, deps).state;
    const result = reduceQueue(paused, event, deps).state;
    assert.equal(result.task.status, type === 'pause' ? 'paused' : 'stopped');
  }
  const sending = structuredClone(s); sending.task.items[0].status = 'sending'; sending.task.items[0].authorized = true;
  assert.throws(() => reduceQueue(sending, event, deps), /文档|导航/);
});
