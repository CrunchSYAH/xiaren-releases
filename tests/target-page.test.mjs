import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPage } from '../extension/page-snapshot.mjs';

function fixture() {
  let scrolls = 0, chats = 0;
  const flags = { list: Array.from({ length: 108 }), hasMore: true, loading: false };
  const layout = { getClientRects: () => [1], __reactFiber$x: { memoizedProps: flags } };
  const sentinel = { getClientRects: () => [1], scrollIntoView: () => { scrolls++; } };
  const rows = Array.from({ length: 108 }, (_, i) => {
    const button = { disabled: false, getClientRects: () => [1], getAttribute: () => null, querySelectorAll: () => [{ getAttribute: () => '#icon-chat-new' }], click: () => { chats++; } };
    return { getClientRects: () => [1], getAttribute: () => `${i}_${i + 1000}`, querySelector: () => ({ textContent: `测试${i}` }), querySelectorAll: () => [button], __reactFiber$x: { memoizedProps: { data: { shopeeUserId: i + 1, affiliateId: i + 1000 } } } };
  });
  const ctx = { location: { origin: 'https://seller.shopee.co.id', pathname: '/portal/web-seller-affiliate/kol_marketplace' }, performance: { timeOrigin: 123 }, window: { __$unstable_useRootStoreOutside: () => ({ shopId: 10, username: 'Demo' }) }, getComputedStyle: () => ({ visibility: 'visible' }), document: { querySelectorAll: s => s.startsWith('tr.') ? rows : [], querySelector: s => s === '.kol-card-layout-global' ? layout : s === '.kol-loading-more' ? sentinel : null } };
  const run = action => vm.runInNewContext(`(${inspectPage.toString()})('', null, ${JSON.stringify(action ?? null)})`, ctx);
  return { run, flags, rows, scrolls: () => scrolls, chats: () => chats };
}

test('真实追加结构可读，经过同次身份/名单核对才滚动，不调用私有回调', () => {
  const f = fixture(), p = f.run();
  assert.equal(p.creators.length, 108); assert.equal(p.list.supported, true); assert.equal(p.list.hasMore, true);
  const action = { type: 'load-more', shopId: '10', documentEpoch: 123, signature: p.list.signature };
  assert.equal(f.run(action).listAction.performed, true); assert.equal(f.scrolls(), 1);
  assert.equal(f.run({ ...action, shopId: '11' }).listAction.performed, false);
  f.rows.reverse(); assert.equal(f.run(action).listAction.performed, false); assert.equal(f.scrolls(), 1);
});

test('聊天入口点击在MAIN world同步核对身份/行键；不盲点旧行或替换目标', () => {
  const f = fixture(), row = f.run().creators[0];
  const action = { type: 'open-chat', shopId: '10', documentEpoch: 123, creator: row };
  assert.equal(f.run(action).listAction.performed, true); assert.equal(f.chats(), 1);
  f.rows[0].__reactFiber$x.memoizedProps.data.shopeeUserId = 999;
  assert.equal(f.run(action).listAction.performed, false); assert.equal(f.chats(), 1);
});

test('目标数上限不等于扫描上限：前200位不合格仍能读取后续达人', () => {
  const f = fixture(); const more = [...f.rows, ...f.rows.map((r, i) => ({ ...r, getAttribute: () => `${i + 108}_${i + 2000}`, __reactFiber$x: { memoizedProps: { data: { shopeeUserId: i + 109, affiliateId: i + 2000 } } } }))];
  f.rows.splice(0, f.rows.length, ...more);
  assert.equal(f.run().creators.length, 216);
});

test('隐藏或aria禁用的聊天入口不能计入可发送名单', () => {
  const f = fixture(), button = f.rows[0].querySelectorAll()[0];
  button.getClientRects = () => [];
  assert.equal(f.run().creators[0].chatAvailable, false);
  button.getClientRects = () => [1]; button.getAttribute = () => 'true';
  assert.equal(f.run().creators[0].chatAvailable, false);
});
