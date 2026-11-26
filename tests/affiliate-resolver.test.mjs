import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalizeAffiliateIds, affiliateDetailUrl, resolveAffiliateIdentities, matchesAffiliateSnapshot } from '../extension/core/affiliate-resolver.mjs';
import { affiliateResolverPage } from '../extension/affiliate-resolver-page.mjs';

const origin = 'https://seller.shopee.co.id';
const path = '/portal/web-seller-affiliate/kol_marketplace/detail';
const expected = { affiliateId: '101', shopeeUserId: '201', shopId: '700', documentEpoch: 123 };
const observation = (affiliateId = '101', shopeeUserId = '201') => ({ origin, path, documentEpoch: 123, shop: { id: '700' }, blocked: false, status: 'verified',
  affiliate: { affiliateId, shopeeUserId, name: '样本达人', username: 'sample_creator', chatAvailable: true },
  chat: { shopId: '700', recipientId: shopeeUserId, editorFound: true, draftEmpty: true, mediaCount: 0, replyCount: 0 } });

test('affiliate IDs remain separate strings, preserve first occurrence and reject ambiguous numeric input', () => {
  assert.deepEqual(normalizeAffiliateIds(['101', '102', '101']), ['101', '102']);
  for (const ids of [null, [], Array(1), [101], ['0'], ['00'], ['01'], [' 101'], ['1e3'], Array.from({ length: 201 }, (_, i) => String(i + 1))]) assert.throws(() => normalizeAffiliateIds(ids));
  assert.deepEqual(normalizeAffiliateIds(['9007199254740993']), ['9007199254740993']);
});

test('detail links use only the observed official route and affiliate_id', () => {
  assert.equal(affiliateDetailUrl('101'), `${origin}${path}?affiliate_id=101`);
  assert.throws(() => affiliateDetailUrl('101&shopee_user_id=201'));
});

test('resolution preserves requested affiliate order and never substitutes a same-name identity', () => {
  const result = resolveAffiliateIdentities(['102', '101'], [observation(), observation('102', '202')], { shopId: '700' });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.identities.map(x => [x.affiliateId, x.shopeeUserId]), [['102', '202'], ['101', '201']]);
  const missing = resolveAffiliateIdentities(['999'], [observation()], { shopId: '700' });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.unresolved[0].reason, 'not-observed');
});

test('conflicting mappings, recipient aliases and unavailable chat block the entire result', () => {
  const conflict = resolveAffiliateIdentities(['101'], [observation(), observation('101', '999')], { shopId: '700' });
  assert.equal(conflict.unresolved[0].reason, 'conflicting-mapping');
  const aliases = resolveAffiliateIdentities(['101', '102'], [observation(), observation('102', '201')], { shopId: '700' });
  assert.equal(aliases.status, 'blocked');
  assert.ok(aliases.unresolved.every(x => x.reason === 'duplicate-recipient'));
  const unavailable = observation(); unavailable.affiliate.chatAvailable = false;
  assert.equal(resolveAffiliateIdentities(['101'], [unavailable], { shopId: '700' }).status, 'blocked');
});

test('untrusted context, wrong shop and stale or unverified observations cannot resolve', () => {
  for (const patch of [{ origin: 'https://example.com' }, { path: '/other' }, { shop: { id: '701' } }, { status: 'blocked' }, { blocked: true }, { documentEpoch: null }]) {
    assert.equal(resolveAffiliateIdentities(['101'], [{ ...observation(), ...patch }], { shopId: '700' }).status, 'blocked');
  }
  assert.throws(() => resolveAffiliateIdentities(['101'], [observation()], {}));
});

test('backend guard requires all locked identity and document fields and optionally the actual chat', () => {
  const page = observation();
  assert.equal(matchesAffiliateSnapshot(expected, page), true);
  for (const patch of [{ affiliateId: '102' }, { shopeeUserId: '202' }, { shopId: '701' }, { documentEpoch: 124 }, { documentEpoch: undefined }]) assert.equal(matchesAffiliateSnapshot({ ...expected, ...patch }, page), false);
  assert.equal(matchesAffiliateSnapshot(expected, { ...page, chat: null }, { requireChat: true }), false);
  assert.equal(matchesAffiliateSnapshot(expected, page, { requireChat: true }), true);
});

function fixture() {
  const profile = { affiliateId: '101', shopeeUserId: '201', displayName: '样本达人', username: 'sample_creator', contactInfo: 'never-export' };
  const state = { loading: false, blocked: false, rootShop: '700', clicked: 0, href: `${origin}${path}?affiliate_id=101` };
  const visible = () => [1];
  const props = { shopeeUserId: '201', shopId: '700', detail: { profile }, detailLoading: false };
  const card = { getClientRects: visible, __reactFiber$x: { memoizedProps: {}, return: { memoizedProps: props } } };
  const button = { getClientRects: visible, disabled: false, getAttribute: () => null, querySelectorAll: () => [{ getAttribute: () => '#icon-chat-new' }], click: () => state.clicked++ };
  card.querySelectorAll = () => [button];
  const editorProps = { buyerId: '201', shopId: '700', currentConversation: { to_id: '201', shop_id: '700' }, drawerMedias: [], replyCardsList: [] };
  const editor = { getClientRects: visible, value: '', disabled: false, readOnly: false, __reactFiber$x: { memoizedProps: editorProps } };
  const context = { URL, location: { origin, pathname: path, get href() { return state.href; } }, performance: { timeOrigin: 123 },
    getComputedStyle: () => ({ visibility: 'visible' }), window: { __$unstable_useRootStoreOutside: () => ({ shopId: state.rootShop, isLoggedIn: true }) },
    document: { querySelectorAll: s => s.includes('UserInfo---userinfo-card') ? [card] : s === 'button' ? [button] : s.includes('textarea') ? [editor] : s.includes('captcha') ? (state.blocked ? [{ getClientRects: visible, textContent: 'captcha', getAttribute: () => '' }] : []) : [], querySelector: () => null } };
  const run = (lock = null, action = 'inspect') => JSON.parse(JSON.stringify(vm.runInNewContext(`(${affiliateResolverPage.toString()})(${JSON.stringify(lock)},${JSON.stringify(action)})`, context)));
  return { state, profile, props, button, editor, editorProps, card, context, run };
}

test('serializable page inspector reads only the observed detail profile and whitelisted fields', () => {
  const f = fixture(), result = f.run();
  assert.equal(result.status, 'verified');
  assert.equal(result.affiliate.affiliateId, '101');
  assert.equal(result.affiliate.shopeeUserId, '201');
  assert.equal(result.chat.recipientId, '201');
  assert.doesNotMatch(JSON.stringify(result), /contactInfo|never-export|currentConversation/);
});

test('detail inspection rejects query/profile mismatch, duplicate ID query, loading and component mismatch', () => {
  const cases = [f => f.profile.affiliateId = '102', f => f.state.href += '&affiliate_id=101', f => f.props.detailLoading = true,
    f => f.props.shopeeUserId = '202', f => f.props.shopId = '701', f => f.state.rootShop = '701', f => f.state.blocked = true,
    f => f.profile.affiliateId = 9007199254740992, f => f.profile.shopeeUserId = '0'];
  for (const change of cases) { const f = fixture(); change(f); assert.equal(f.run().status, 'blocked'); }
});

test('inactive React alternate is not accepted as current detail evidence', () => {
  const f = fixture();
  const stale = f.card.__reactFiber$x;
  const root = { stateNode: { current: {} } }; stale.return.return = root;
  assert.equal(f.run().status, 'blocked');
});

test('current React alternate supplies the profile, while stale props are ignored', () => {
  const f = fixture();
  const activeRoot = {}, oldRoot = { stateNode: { current: activeRoot } };
  const active = { memoizedProps: f.props, return: activeRoot };
  f.card.__reactFiber$x = { memoizedProps: { ...f.props, shopeeUserId: '999' }, return: oldRoot, alternate: active };
  assert.equal(f.run().status, 'verified');
});

test('only a fully locked current identity can open the official chat button', () => {
  const f = fixture();
  assert.equal(f.run(expected, 'open-chat').action.performed, true);
  assert.equal(f.state.clicked, 1);
  for (const lock of [null, { ...expected, affiliateId: '102' }, { ...expected, shopeeUserId: '202' }, { ...expected, documentEpoch: 124 }, { ...expected, shopId: '701' }]) {
    assert.equal(f.run(lock, 'open-chat').action.performed, false);
  }
  assert.equal(f.state.clicked, 1);
});

test('chat entry must belong to the verified profile card, never a different page section', () => {
  const f = fixture(); f.card.querySelectorAll = () => [];
  assert.equal(f.run().affiliate.chatAvailable, false);
  assert.equal(f.run(expected, 'open-chat').action.performed, false);
  assert.equal(f.state.clicked, 0);
});

test('opening chat never discards an existing text, image, or reply draft', () => {
  for (const change of [f => f.editor.value = 'manual draft', f => f.editorProps.drawerMedias = [{}], f => f.editorProps.replyCardsList = [{}], f => delete f.editorProps.drawerMedias]) {
    const f = fixture(); change(f); assert.equal(f.run(expected, 'open-chat').action.performed, false); assert.equal(f.state.clicked, 0);
  }
});

test('hidden mounted chat drafts also prevent changing recipient', () => {
  const f = fixture(); f.editor.getClientRects = () => []; f.editor.value = 'hidden manual draft';
  assert.equal(f.run(expected, 'open-chat').action.performed, false);
  assert.equal(f.state.clicked, 0);
});

test('chat identity requires editor and conversation to agree with the current shop and profile', () => {
  const f = fixture(); f.editorProps.currentConversation.to_id = '999';
  assert.equal(f.run().chat.recipientId, null);
  assert.equal(matchesAffiliateSnapshot(expected, f.run(), { requireChat: true }), false);
});

test('installed synchronous inspector can be called in the final MAIN verification boundary', () => {
  const f = fixture(); assert.equal(f.run(null, 'install').installed, true);
  const result = f.context.window.__creatorAffiliateResolverPage(expected);
  assert.equal(result.status, 'verified');
  f.profile.affiliateId = '999';
  assert.equal(f.context.window.__creatorAffiliateResolverPage(expected).status, 'blocked');
});
