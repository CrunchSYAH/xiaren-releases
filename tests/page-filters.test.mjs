import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectFilters } from '../extension/page-filters-page.mjs';
import { inspectPage } from '../extension/page-snapshot.mjs';

function fixture(leaderboard = false) {
  const changes = [], fields = {}, applied = {};
  const node = props => ({ getClientRects: () => [1], getAttribute: () => null, __reactFiber$x: { memoizedProps: props }, querySelector: () => null });
  const category = { activeKey: '0', items: [{ label: 'All', value: '0' }, { label: 'Beauty', value: '100630' }], onChange(value) { changes.push(['category', value]); category.activeKey = value; fields.kolCategory = value; } };
  const channel = { activeKey: leaderboard ? 0 : '1000000', items: [{ label: 'All', value: leaderboard ? 0 : '1000000' }, { label: 'Shopee Video', value: leaderboard ? 102 : '102' }], onChange(value) { changes.push(['channel', value]); channel.activeKey = value; fields.socialMediaSelect = Number(value) === 1000000 ? undefined : Number(value); } };
  const list = { list: [], hasMore: false, loading: false, sortByKey: 0, trackingData: { filterOptions: applied } };
  const form = node({ name: 'filter_search', form: { getFieldsValue: () => ({ ...fields }) } });
  const apply = { ...node({}), textContent: 'Apply', disabled: false, click() { changes.push(['apply']); for (const key of Object.keys(applied)) delete applied[key]; if (fields.kolCategory && fields.kolCategory !== '0') applied.category = fields.kolCategory; if (fields.socialMediaSelect) applied.social_media = fields.socialMediaSelect; if (fields.affiliateName) applied.user_name = fields.affiliateName; } };
  const categoryNode = node(category), channelNode = node(channel), categoryRoot = { ...node({ value: '0', onChange() {} }), querySelector: () => categoryNode };
  const channelRoot = { ...node({ channels: [0, 102], value: 0, onChange() {} }), querySelector: () => channelNode };
  const tabs = { activeKey: '1' }, dates = { dateRange: [{ _d: new Date(1000) }, { _d: new Date(2000) }], checkedPanelType: 'week' }, spin = { spinning: false };
  const map = { '.categorySelectorChip': categoryRoot, '.categorySelectorChip .eds-react-chip': categoryNode, '[class*=KOLFiltersGroup---socialMediaSelect] .eds-react-chip': channelNode, '[class*=KOLFiltersGroup---socialMediaSelect]': { querySelector: () => channelNode }, 'form': form, 'form[name="filter_search"]': form, '.kol-card-layout-global': node(list), '[class*=AffiliateLeaderboard---filterWrapper]': { lastElementChild: channelRoot }, '[class*=AffiliateLeaderboard---tabs]': node(tabs), '[class*=AffiliateLeaderboard---datePeriod]': node(dates), '[class*=affiliate-spin]': node(spin) };
  const context = { Date, location: { origin: 'https://seller.shopee.co.id', pathname: `/portal/web-seller-affiliate/${leaderboard ? 'affiliate_leaderboard' : 'kol_marketplace'}` }, performance: { timeOrigin: 123 }, window: { __$unstable_useRootStoreOutside: () => ({ shopId: '10', shopName: '测试店铺' }) }, getComputedStyle: () => ({ visibility: 'visible' }), document: {
    querySelector: selector => map[selector] || null,
    querySelectorAll: selector => selector === 'form button' ? [apply] : selector === 'form' ? [form] : [],
  } };
  const expected = { shopId: '10', documentEpoch: 123, path: context.location.pathname };
  const run = (requested = null, bound = expected) => JSON.parse(JSON.stringify(vm.runInNewContext(`(${inspectFilters.toString()})(${JSON.stringify(bound)},${JSON.stringify(requested)})`, context)));
  return { run, expected, context, fields, applied, changes, category, channel, list, map, tabs, dates, spin, node };
}

test('广场筛选读取真实选项；依次设置分类、社媒，原页应用后才完成', () => {
  const f = fixture(), initial = f.run();
  assert.deepEqual(initial.supported, { category: true, channel: true });
  assert.deepEqual(initial.current, { category: '0', channel: '1000000' });
  assert.equal(initial.matched, true);
  const desired = { category: '100630', channel: '102' };
  for (let index = 0; index < 3; index++) { const result = f.run(desired); assert.equal(result.performed, true); assert.equal(result.matched, false); assert.equal(f.changes.length, index + 1); }
  assert.deepEqual(f.changes, [['category', '100630'], ['channel', '102'], ['apply']]);
  assert.equal(f.run(desired).matched, true);
  assert.notEqual(f.run().filterContext, initial.filterContext);
});

test('仅表单选中或列表加载均不能声称筛选已完成', () => {
  const f = fixture(); f.fields.kolCategory = '100630'; f.category.activeKey = '100630';
  assert.equal(f.run().matched, false);
  f.applied.category = '100630'; assert.equal(f.run().matched, true);
  f.list.loading = true; assert.equal(f.run().matched, false);
  assert.equal(f.run({ category: '0', channel: '1000000' }).performed, false);
});

test('删除名称操作后保留原页人工搜索与旧筛选锁，公开接口只含分类和渠道', () => {
  const f = fixture(); f.fields.affiliateName = 'ayu'; f.applied.user_name = 'ayu';
  const input = { ...f.node({ id: 'filter_search_affiliateName', onChange() { throw new Error('不应操作搜索'); } }), value: 'ayu' };
  f.map['input[placeholder="Search by affiliate name"]'] = input;
  const first = f.run();
  assert.deepEqual(Object.keys(first.current), ['category', 'channel']);
  assert.deepEqual(Object.keys(first.supported), ['category', 'channel']);
  assert.equal(first.matched, true);
  assert.equal(first.filterContext, JSON.stringify({ source: 'marketplace', current: { category: '0', channel: '1000000', search: 'ayu' }, fields: { affiliateName: 'ayu' }, applied: { user_name: 'ayu' }, sort: 0 }));
  const desired = { category: '100630', channel: '102' };
  for (let i = 0; i < 3; i++) assert.equal(f.run(desired).performed, true);
  assert.equal(f.run(desired).matched, true);
  assert.deepEqual(f.changes, [['category', '100630'], ['channel', '102'], ['apply']]);
  assert.equal(input.value, 'ayu'); assert.equal(f.fields.affiliateName, 'ayu'); assert.equal(f.applied.user_name, 'ayu');
  const locked = f.run().filterContext;
  input.value = f.fields.affiliateName = f.applied.user_name = 'other';
  assert.notEqual(f.run().filterContext, locked);
  assert.equal(f.run({ ...desired, search: 'other' }).performed, false);
  assert.match(f.run({ ...desired, search: 'other' }).error, /参数/);
  const rank = fixture(true).run();
  assert.equal(JSON.parse(rank.filterContext).current.search, '');
});

test('人工名称搜索尚未应用时阻止准备，不代按Apply或修改其他筛选', () => {
  const f = fixture(); f.fields.affiliateName = 'manual';
  assert.equal(f.run().matched, false);
  const result = f.run({ category: '100630', channel: '102' });
  assert.equal(result.performed, false); assert.match(result.error, /名称.*应用|应用.*名称/);
  assert.deepEqual(f.changes, []);
});

test('绑定、验证码、未知选项、未知状态及人工草稿阻止任何筛选动作', () => {
  const desired = { category: '100630', channel: '1000000' };
  for (const bound of [{ shopId: '11' }, { documentEpoch: 999 }, { path: '/' }]) { const f = fixture(); const p = f.run(desired, { ...f.expected, ...bound }); assert.equal(p.performed, false); assert.ok(p.error); }
  const f = fixture(); assert.equal(f.run({ ...desired, category: '999' }).performed, false); assert.ok(f.run({ ...desired, category: '999' }).error);
  const g = fixture(); delete g.list.trackingData; assert.equal(g.run(desired).performed, false); assert.ok(g.run(desired).error);
  const h = fixture(); const query = h.context.document.querySelectorAll; h.context.document.querySelectorAll = s => s.includes('textarea') ? [{ ...h.node({ drawerMedias: [], replyCardsList: [] }), value: 'manual' }] : query(s); assert.equal(h.run(desired).performed, false); assert.ok(h.run(desired).error);
  const i = fixture(); const query2 = i.context.document.querySelectorAll; i.context.document.querySelectorAll = s => s.includes('captcha') ? [{ ...i.node({}), textContent: 'verification' }] : query2(s); assert.equal(i.run(desired).performed, false); assert.ok(i.run(desired).error);
});

test('排行榜使用真实数值社媒回调，缺失分类明确不支持', () => {
  const f = fixture(true), initial = f.run();
  assert.deepEqual(initial.supported, { category: true, channel: true });
  assert.equal(f.run({ category: '0', channel: '102' }).performed, true);
  assert.deepEqual(f.changes, [['channel', 102]]);
  f.tabs.activeKey = '3'; delete f.map['.categorySelectorChip']; delete f.map['.categorySelectorChip .eds-react-chip'];
  assert.equal(f.run().supported.category, false);
  assert.equal(f.run({ category: '100630', channel: '102' }).performed, false);
  assert.notEqual(f.run().filterContext, initial.filterContext);
});

test('筛选锁涵盖额外表单条件与排序，不随仅对象键顺序改变', () => {
  const f = fixture(), first = f.run().filterContext;
  f.fields.recommended = ['golden']; assert.notEqual(f.run().filterContext, first);
  const second = f.run().filterContext; f.list.sortByKey = 1; assert.notEqual(f.run().filterContext, second);
  f.fields.follower = { max: 100, min: 1 }; const third = f.run().filterContext;
  f.fields.follower = { min: 1, max: 100 }; assert.equal(f.run().filterContext, third);
});

test('快照只选屏幕真正可见的首个达人，并在最终名单核对中锁定筛选', () => {
  let sends = 0;
  const f = fixture(), node = f.node;
  const records = [{ shopeeUserId: '21', affiliateId: '101', name: '甲' }, { shopeeUserId: '22', affiliateId: '102', name: '乙' }];
  const rows = records.map((data, index) => { const button = { ...node({}), querySelectorAll: () => [{ getAttribute: () => '#icon-chat-new' }] }; const row = { ...node({ data }), getAttribute: () => `${index}_${data.affiliateId}`, querySelector: () => ({ textContent: data.name }), querySelectorAll: () => [button], getBoundingClientRect: () => ({ top: index * 100 - 120, bottom: index * 100 - 20, left: 0, right: 500 }), contains: target => target === row }; return row; });
  const editor = { ...node({ buyerId: '22', shopId: '10', currentConversation: { to_id: '22', shop_id: '10' }, drawerMedias: [], replyCardsList: [] }), value: 'Halo' };
  const send = { ...node({}), click() { sends++; } };
  Object.assign(f.context.window, { innerHeight: 600, innerWidth: 800 });
  f.context.document.elementFromPoint = () => rows[1];
  const query = f.context.document.querySelectorAll, one = f.context.document.querySelector;
  f.context.document.querySelectorAll = s => s.startsWith('tr.') ? rows : s.includes('textarea') ? [editor] : query(s);
  f.context.document.querySelector = s => s.includes('plW8rzAMob') ? send : one(s);
  f.run();
  const run = commit => JSON.parse(JSON.stringify(vm.runInNewContext(`(${inspectPage.toString()})('Halo',${JSON.stringify(commit || null)})`, f.context)));
  const p = run(); assert.equal(p.list.startId, '22'); assert.equal(p.list.filterContext, f.run().filterContext);
  f.list.loading = true; assert.equal(run().list.filterContext, p.list.filterContext, '加载本身不能破坏原筛选锁'); f.list.loading = false;
  const roster = { observed: p.creators, creator: p.creators[1], filterContext: p.list.filterContext };
  const commit = { shopId: '10', itemId: '22', documentEpoch: 123, marketplacePath: p.path, roster };
  assert.equal(run(commit).commit.clicked, true);
  f.fields.recommended = ['changed']; assert.equal(run(commit).commit.clicked, false); assert.equal(sends, 1);
});
