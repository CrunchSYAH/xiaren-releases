import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPage } from '../extension/page-snapshot.mjs';

test('目标模式同步点击仍核对锁定名单：允许追加，拒绝移除、重排和入口变化', () => {
  let clicks = 0;
  const row = (id, index) => {
    const button = { disabled: false, getClientRects: () => [1], getAttribute: () => null, querySelectorAll: () => [{ getAttribute: () => '#icon-chat-new' }] };
    return { button, getClientRects: () => [1], getAttribute: () => `${index}_${1000 + id}`, querySelector: () => ({ textContent: `测试${id}` }), querySelectorAll: () => [button], __reactFiber$x: { memoizedProps: { data: { shopeeUserId: id, affiliateId: 1000 + id } } } };
  };
  const rows = [row(20, 0), row(21, 1)];
  const editor = { value: 'Halo', getClientRects: () => [1], __reactFiber$x: { memoizedProps: { buyerId: '20', shopId: '10', currentConversation: { to_id: '20', shop_id: '10', latest_message_id: '100', opposite_last_deliver_msg_id: '0' } } } };
  const send = { getClientRects: () => [1], click: () => { clicks++; } };
  const path = '/portal/web-seller-affiliate/kol_marketplace';
  const ctx = { location: { origin: 'https://seller.shopee.co.id', pathname: path }, performance: { timeOrigin: 123 }, window: { __$unstable_useRootStoreOutside: () => ({ shopId: 10, username: 'Demo' }) }, getComputedStyle: () => ({ visibility: 'visible' }), document: { querySelectorAll: s => s.includes('textarea') ? [editor] : s.startsWith('tr.') ? rows : [], querySelector: s => s.includes('plW8rzAMob') ? send : s.includes('messagesContainer') ? { querySelectorAll: () => [] } : null } };
  const observed = rows.map((_, index) => ({ id: String(20 + index), name: `测试${20 + index}`, rowKey: `${index}_${1020 + index}`, chatAvailable: true }));
  const commit = { shopId: '10', itemId: '20', documentEpoch: 123, marketplacePath: path, roster: { observed, creator: observed[0] } };
  const run = () => vm.runInNewContext(`(${inspectPage.toString()})('Halo',${JSON.stringify(commit)})`, ctx).commit.clicked;
  assert.equal(run(), true);
  rows.push(row(22, 2)); assert.equal(run(), true); assert.equal(clicks, 2);
  const original = [...rows]; rows.shift(); assert.equal(run(), false); assert.equal(clicks, 2);
  rows.splice(0, rows.length, ...original.toReversed()); assert.equal(run(), false);
  rows.splice(0, rows.length, ...original); rows[0].button.disabled = true; assert.equal(run(), false);
  rows.splice(0); assert.equal(run(), false); assert.equal(clicks, 2);
});

test('最终同步点击不依赖历史水位，仍拒绝离开绑定路由或缺少目标名单', () => {
  let clicks = 0;
  const conversation = { to_id: '20', shop_id: '10', latest_message_id: '100', opposite_last_deliver_msg_id: '0' };
  const editor = { value: 'Halo', getClientRects: () => [1], __reactFiber$x: { memoizedProps: { buyerId: '20', shopId: '10', currentConversation: conversation } } };
  const send = { getClientRects: () => [1], click: () => { clicks++; } }, root = { querySelectorAll: () => [] };
  const ctx = { location: { origin: 'https://seller.shopee.co.id', pathname: '/portal/web-seller-affiliate/kol_marketplace' }, performance: { timeOrigin: 123 }, window: { __$unstable_useRootStoreOutside: () => ({ shopId: 10, username: 'Demo' }) }, getComputedStyle: () => ({ visibility: 'visible' }), document: { querySelectorAll: s => s.includes('textarea') ? [editor] : [], querySelector: s => s.includes('plW8rzAMob') ? send : s.includes('messagesContainer') ? root : null } };
  const commit = { shopId: '10', itemId: '20', documentEpoch: 123, marketplacePath: ctx.location.pathname };
  const run = () => vm.runInNewContext(`(${inspectPage.toString()})('Halo',${JSON.stringify(commit)})`, ctx);
  delete conversation.latest_message_id;
  ctx.location.pathname = '/portal/other'; assert.equal(run().commit.clicked, false); assert.equal(clicks, 0);
  ctx.location.pathname = commit.marketplacePath; assert.equal(run().commit.clicked, false); assert.equal(clicks, 0);
  delete commit.marketplacePath; assert.equal(run().commit.clicked, true); assert.equal(clicks, 1); // Legacy manual queue does not supply a target roster.
});
