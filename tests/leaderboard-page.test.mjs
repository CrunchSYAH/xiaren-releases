import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPage } from '../extension/page-snapshot.mjs';

function fixture() {
  let opens = 0, sends = 0, turns = 0;
  const node = props => ({ getClientRects: () => [1], __reactFiber$x: { memoizedProps: props } });
  const records = Array.from({ length: 20 }, (_, i) => ({ affiliateUserId: i + 1, affiliateId: i + 1001, displayName: `测试${i}`, shopeeUsername: `demo${i}` }));
  const chatButton = { ...node({}), textContent: 'Chat', getAttribute: () => null, click: () => { opens++; } };
  const rows = records.map(record => ({ ...node({ record }), getAttribute: () => String(record.affiliateId), querySelector: () => ({ textContent: record.displayName }), querySelectorAll: () => [chatButton] }));
  const tab = { activeKey: '1' }, category = { value: '0', onChange() {} }, channel = { value: 0, channels: [] };
  const dates = { dateRange: [{ _d: new Date(1000) }, { _d: new Date(2000) }], checkedPanelType: 'week' };
  const paging = { current: 1, pageSize: 20, total: 200 }, spinner = { spinning: false }, table = { dataSource: records, pageNum: 1, pageSize: 20, total: 200 };
  const editor = { ...node({ buyerId: '1', shopId: '10', currentConversation: { to_id: '1', shop_id: '10' }, drawerMedias: [], replyCardsList: [] }), value: 'Halo' };
  const send = { ...node({}), getAttribute: () => null, click: () => { sends++; } };
  const next = { ...node({}), disabled: false, getAttribute: () => null, click: () => { turns++; } };
  const map = { '[class*=AffiliateLeaderboard---tabs]': node(tab), '.categorySelectorChip': node(category), '[class*=AffiliateLeaderboard---filterWrapper]': { lastElementChild: node(channel) }, '[class*=AffiliateLeaderboard---datePeriod]': node(dates), '.aff-pagination': node(paging), '.eds-react-table': node(table), '[class*=affiliate-spin]': node(spinner), '.aff-pagination .eds-react-pagination-pager__button-next': next };
  const ctx = { Date, location: { origin: 'https://seller.shopee.co.id', pathname: '/portal/web-seller-affiliate/affiliate_leaderboard' }, performance: { timeOrigin: 123 }, window: { __$unstable_useRootStoreOutside: () => ({ shopId: '10', shopName: '测试店铺' }) }, getComputedStyle: () => ({ visibility: 'visible' }), document: {
    querySelectorAll: s => s.includes('tr[') ? rows : s.includes('textarea') ? [editor] : [],
    querySelector: s => map[s] || (s.includes('plW8rzAMob') ? send : null),
  } };
  const run = (commit = null, action = null) => vm.runInNewContext(`(${inspectPage.toString()})('Halo', ${JSON.stringify(commit)}, ${JSON.stringify(action)})`, ctx);
  const roster = () => { const p = run(); return { observed: p.creators, creator: p.creators[0], page: 1, context: p.list.pagination.context }; };
  return { run, roster, rows, records, tab, category, channel, dates, paging, table, spinner, chatButton, next, editor, opens: () => opens, sends: () => sends, turns: () => turns };
}

test('排行榜独立读取affiliateUserId与Chat链接，挂载顺序和分页条件可核对', () => {
  const f = fixture(), p = f.run();
  assert.equal(p.creators.length, 20); assert.equal(p.creators[0].id, '1'); assert.equal(p.creators[0].rowKey, '1001');
  assert.equal(p.list.supported, true); assert.equal(p.list.pagination.page, 1);
  const action = { type: 'open-chat', shopId: '10', documentEpoch: 123, path: p.path, creator: p.creators[0], roster: f.roster() };
  f.editor.value = '';
  assert.equal(f.run(null, action).listAction.performed, true); assert.equal(f.opens(), 1);
  f.records[0].affiliateUserId = 99;
  assert.equal(f.run(null, action).listAction.performed, false); assert.equal(f.opens(), 1);
});

test('排行榜打开聊天不切换或丢弃已有正文、附件和回复草稿', () => {
  for (const mutate of [f => {}, f => { f.editor.value = ''; f.editor.__reactFiber$x.memoizedProps.drawerMedias = [{}]; }, f => { f.editor.value = ''; f.editor.__reactFiber$x.memoizedProps.replyCardsList = [{}]; }]) {
    const f = fixture(); mutate(f);
    const p = f.run(), action = { type: 'open-chat', shopId: '10', documentEpoch: 123, path: p.path, creator: p.creators[0], roster: f.roster() };
    assert.equal(f.run(null, action).listAction.performed, false); assert.equal(f.opens(), 0);
  }
});

test('排行榜MAIN最终点击及翻页严格核对完整原页和来源条件', () => {
  const f = fixture(), p = f.run(), roster = f.roster();
  const commit = { shopId: '10', itemId: '1', documentEpoch: 123, marketplacePath: p.path, roster };
  assert.equal(f.run(commit).commit.clicked, true); assert.equal(f.sends(), 1);
  assert.equal(f.run({ shopId: '10', itemId: '1', documentEpoch: 123 }).commit.clicked, false, '排行榜不能使用无名单的旧点击入口');
  const action = { type: 'turn-page', shopId: '10', documentEpoch: 123, path: p.path, targetPage: 2, roster };
  assert.equal(f.run(null, action).listAction.performed, true); assert.equal(f.turns(), 1);
  for (const mutate of [() => { f.category.value = '9'; }, () => { f.tab.activeKey = '2'; }, () => { f.spinner.spinning = true; }, () => { f.rows.reverse(); }]) {
    mutate(); assert.equal(f.run(commit).commit.clicked, false); assert.equal(f.run(null, action).listAction.performed, false);
  }
  assert.equal(f.sends(), 1); assert.equal(f.turns(), 1);
});

test('排行榜显示名只容许首尾空白归一化，不以同名替代稳定身份', () => {
  const f = fixture(); f.records[0].displayName = '  测试0  ';
  f.rows[0].querySelector = () => ({ textContent: '测试0' });
  assert.equal(f.run().list.supported, true);
  f.records[0].affiliateUserId = 'other';
  assert.equal(f.run().list.supported, false);
});

test('未知加载标记、虚拟挂载、假行键或未知Chat结构都不能构成可发名单', () => {
  const f = fixture(); f.rows.pop(); assert.equal(f.run().list.supported, false);
  const g = fixture(); delete g.spinner.spinning; assert.equal(g.run().list.supported, false);
  const h = fixture(); h.chatButton.textContent = 'Other'; assert.equal(h.run().creators[0].chatAvailable, false);
  const i = fixture(); i.rows[0].getAttribute = () => '999'; assert.equal(i.run().list.supported, false);
});
