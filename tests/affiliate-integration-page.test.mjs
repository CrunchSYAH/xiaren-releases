import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPage } from '../extension/page-snapshot.mjs';
import { affiliateResolverPage } from '../extension/affiliate-resolver-page.mjs';

function fixture() {
  let chats = 0, sends = 0;
  const node = props => ({ getClientRects: () => [1], __reactFiber$x: { memoizedProps: props } });
  const profile = { affiliateId: '100', shopeeUserId: '20', displayName: '测试达人', username: 'demo' };
  const chatButton = { ...node({}), disabled: false, getAttribute: () => null, querySelectorAll: () => [{ getAttribute: () => '#icon-chat-new' }], click: () => { chats++; } };
  const card = { ...node({ detail: { profile }, detailLoading: false, shopeeUserId: '20', shopId: '10' }), querySelectorAll: () => [chatButton] };
  const props = { buyerId: '20', shopId: '10', currentConversation: { to_id: '20', shop_id: '10' }, drawerMedias: [], replyCardsList: [] };
  const editor = { ...node(props), value: 'Halo' }, send = { ...node({}), getAttribute: () => null, click: () => { sends++; } };
  const context = { URL, performance: { timeOrigin: 123 }, location: { origin: 'https://seller.shopee.co.id', pathname: '/portal/web-seller-affiliate/kol_marketplace/detail', href: 'https://seller.shopee.co.id/portal/web-seller-affiliate/kol_marketplace/detail?affiliate_id=100' }, window: { __$unstable_useRootStoreOutside: () => ({ shopId: '10', shopName: '测试店铺' }) }, getComputedStyle: () => ({ visibility: 'visible' }), document: {
    querySelectorAll: s => s.includes('userinfo-card') ? [card] : s.includes('textarea') ? [editor] : [], querySelector: s => s.includes('plW8rzAMob') ? send : null,
  } };
  vm.createContext(context);
  vm.runInContext(`(${affiliateResolverPage.toString()})(null,'install')`, context);
  const run = (commit = null, action = null) => vm.runInContext(`(${inspectPage.toString()})('Halo',${JSON.stringify(commit)},${JSON.stringify(action)})`, context);
  const affiliate = { affiliateId: '100', shopeeUserId: '20', shopId: '10', documentEpoch: 123 };
  const creator = { id: '20', name: '测试达人', rowKey: '100', affiliateId: '100', chatAvailable: true };
  const commit = { shopId: '10', itemId: '20', documentEpoch: 123, marketplacePath: context.location.pathname, roster: { creator, affiliate } };
  return { context, profile, editor, props, run, commit, chats: () => chats, sends: () => sends };
}

test('详情来源MAIN紧邻点击调用resolver完整核对，不伪造广场挂载行', () => {
  const f = fixture(), p = f.run();
  assert.equal(p.affiliateEvidence.status, 'verified'); assert.equal(p.creators[0].id, '20');
  assert.equal(f.run(f.commit).commit.clicked, true); assert.equal(f.sends(), 1);
  assert.equal(f.run({ shopId: '10', itemId: '20', documentEpoch: 123 }).commit.clicked, false);
});

test('详情解析器缺失、资料或query变化、错文档/收件人都拒绝最终提交', () => {
  for (const change of [f => { delete f.context.window.__creatorAffiliateResolverPage; }, f => { f.profile.shopeeUserId = '21'; }, f => { f.context.location.href += '&affiliate_id=100'; }, f => { f.commit.roster.affiliate.documentEpoch = 122; }, f => { f.props.currentConversation.to_id = '21'; }]) {
    const f = fixture(); change(f);
    assert.equal(f.run(f.commit).commit.clicked, false); assert.equal(f.sends(), 0);
  }
});

test('详情聊天入口通过原resolver受控打开，导航预检保护全部草稿', () => {
  const f = fixture(), action = { type: 'open-chat', shopId: '10', documentEpoch: 123, path: f.context.location.pathname, creator: f.commit.roster.creator, roster: f.commit.roster };
  assert.equal(f.run(null, action).listAction.performed, false);
  f.editor.value = '';
  assert.equal(f.run(null, action).listAction.performed, true); assert.equal(f.chats(), 1);
  const check = { ...action, type: 'check-navigation' };
  assert.equal(f.run(null, check).listAction.performed, true);
  f.editor.value = '人工草稿'; assert.equal(f.run(null, check).listAction.performed, false);
  assert.equal(f.sends(), 0);
});
