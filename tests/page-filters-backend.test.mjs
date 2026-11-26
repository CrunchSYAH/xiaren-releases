import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

const path = '/portal/web-seller-affiliate/kol_marketplace';
const desired = { category: '100630', channel: '102' };
function fixture() {
  let data = {}, tick = 1000, id = 0, applications = 0, failed = false, snapshotDelay = 0, filterWaiting = false;
  let tabUrl = `https://seller.shopee.co.id${path}`;
  const events = [], creates = [];
  const page = { origin: 'https://seller.shopee.co.id', path, documentEpoch: 123, shop: { id: '10', name: '店铺' }, creators: [1, 2, 3].map(n => ({ id: String(n), name: `Ayu${n}`, rowKey: `0_${n}`, chatAvailable: true })), list: { supported: true, loading: false, hasMore: false, startId: '2' }, blocked: false };
  const current = { category: '0', channel: '1000000' };
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async () => structuredClone(data), set: async v => { data = { ...data, ...structuredClone(v) }; } }, session: { get: async () => ({ creatorBrowserSession: 'browser' }) } },
    tabs: { create: async value => { creates.push(value); tabUrl = value.url; return { id: 7 }; }, get: async () => ({ url: tabUrl, status: 'complete' }), update: async (_, value) => { events.push(['update', value]); if (value.url) tabUrl = value.url; } }, scripting: { executeScript: async value => { events.push(['script', value.files || value.func?.name]); return []; } } };
  const filters = () => ({ path: page.path, documentEpoch: page.documentEpoch, supported: { category: true, channel: true }, current: { ...current }, options: { categories: [{ value: '0', label: 'All' }, { value: '100630', label: 'Beauty' }], channels: [{ value: '1000000', label: 'All' }, { value: '102', label: 'Shopee Video' }] }, loading: filterWaiting, ...(filterWaiting ? { error: '无法核对原页筛选及列表状态' } : {}), filterContext: JSON.stringify(current) });
  const dependencies = { now: () => tick, uid: () => `id-${++id}`, readSnapshot: async () => { tick += snapshotDelay; return structuredClone({ ...page, list: { ...page.list, filterContext: JSON.stringify(current) } }); },
    readPageFilters: async (_tab, expected, requested) => {
      assert.equal(expected.documentEpoch, page.documentEpoch); assert.equal(expected.shopId, page.shop?.id);
      if (requested) {
        assert.equal(data.creatorWorkspace.preparation.status, 'filtering', '筛选动作前必须落盘');
        assert.equal(data.creatorWorkspace.preparation.changed, true, '潜在位置重置必须在动作前落盘');
        if (failed) throw new Error('lost filter response');
        const key = Object.keys(current).find(key => current[key] !== requested[key]);
        if (key) { applications++; const result = filters(); current[key] = requested[key]; return { ...result, performed: true, matched: false }; }
      }
      return { ...filters(), performed: false, matched: !requested || Object.keys(current).every(key => current[key] === requested[key]) };
    } };
  let backend = createBackend(api, dependencies);
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = { id: 'demo', tab: { id: 7 }, frameId: 0, documentId: 'doc', url: tabUrl };
  const call = (type, body = {}, from = panel) => backend.handle({ type, ...body }, from);
  const connect = async () => { await call('panel:open'); await call('page:hello', { pageId: 'page' }, sender); };
  const poll = () => call('page:poll', { pageId: 'page' }, sender);
  return { api, get backend() { return backend; }, call, connect, poll, page, current, events, creates, restart: () => { backend = createBackend(api, dependencies); }, applications: () => applications, fail: () => { failed = true; }, waitForFilters: value => { filterWaiting = value; }, delaySnapshot: ms => { snapshotDelay = ms; }, advance: ms => { tick += ms; }, data: () => data };
}

test('筛选读取只允许工作台及已绑定专用文档，不改变名单或发指令', async () => {
  const f = fixture(); await assert.rejects(f.call('panel:filters'), /专用|连接/);
  await f.connect();
  const r = await f.call('panel:filters'); assert.equal(r.pageFilters.current.category, '0');
  assert.equal(r.workspace.collection, undefined); assert.equal(f.applications(), 0);
  await assert.rejects(f.call('panel:filters', {}, { id: 'demo', url: 'https://example.com' }), /工作台/);
});

test('网页筛选先落盘且每轮至多一项，全部匹配后才建立锁定名单', async () => {
  const f = fixture(); await f.connect();
  let r = await f.call('panel:collect', { targetCount: 2, source: { type: 'marketplace', webFilters: desired } });
  assert.equal(r.workspace.preparation.status, 'filtering'); assert.equal(r.workspace.collection, undefined); assert.equal(f.applications(), 1);
  await f.poll(); assert.equal(f.applications(), 2);
  await f.poll(); r = await f.call('panel:get');
  assert.equal(r.workspace.collection.status, 'ready'); assert.equal(r.workspace.collection.selectedCount, 2);
  assert.deepEqual(r.workspace.collection.source.webFilters, desired);
  assert.equal(r.state.task, null);
});

test('新准备拒绝旧搜索参数，恢复旧搜索准备时失效且不再执行页面动作', async () => {
  const f = fixture(); await f.connect();
  await assert.rejects(f.call('panel:collect', { targetCount: 1, source: { webFilters: { ...desired, search: 'ayu' } } }), /名称搜索.*移除|名称搜索.*取消/);
  assert.equal(f.applications(), 0); assert.equal(f.data().creatorWorkspace.preparation, undefined);
  for (const matching of [false, true]) {
    const g = fixture(); await g.connect(); g.waitForFilters(true);
    await g.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
    g.data().creatorWorkspace.preparation.source.webFilters.search = 'ayu';
    if (matching) Object.assign(g.current, desired);
    g.restart(); g.waitForFilters(false); g.events.length = 0;
    await g.poll(); const result = await g.call('panel:get');
    assert.equal(result.workspace.preparation.status, 'invalid');
    assert.match(result.workspace.preparation.reason, /名称搜索.*移除|名称搜索.*取消/);
    assert.equal(result.workspace.collection, undefined); assert.equal(g.applications(), 0);
    assert.equal(g.events.some(event => event[0] === 'update' && event[1].active === true), false);
  }
});

test('恢复含旧搜索来源的锁定名单仍可预览启动和暂停后继续，来源不被改写', async () => {
  const f = fixture(); await f.connect(); Object.assign(f.current, desired);
  await f.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  f.data().creatorWorkspace.collection.source.webFilters.search = 'ayu';
  f.restart();
  const restored = await f.call('panel:get'), c = restored.workspace.collection;
  assert.equal(c.status, 'ready');
  const config = { shop: { id: '10', name: '店铺' }, creators: c.creators.map(({ id, name }) => ({ id, name })), template: 'Halo {{name}}', intervalSeconds: 30, limit: 1, targetCount: 1, collectionId: c.id, source: c.source, mode: 'dry-run' };
  const preview = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: preview.previewToken });
  await f.call('panel:pause'); f.restart();
  const resumed = await f.call('panel:resume');
  assert.equal(resumed.state.task.status, 'running');
  assert.equal(resumed.workspace.collection.status, 'consumed');
  assert.deepEqual(resumed.state.task.config.source, c.source);
  assert.deepEqual(resumed.workspace.collection.source, c.source);
  assert.equal(f.applications(), 0);
});

test('取消筛选后旧心跳不会继续改条件；超过固定期限也不动作', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:collect', { targetCount: 2, source: { webFilters: desired } });
  await f.call('panel:cancel-collection'); await f.poll(); assert.equal(f.applications(), 1);
  const g = fixture(); await g.connect();
  await g.call('panel:collect', { targetCount: 2, source: { webFilters: desired } });
  g.advance(45001); await g.poll();
  assert.equal(g.applications(), 1); assert.equal((await g.call('panel:get')).workspace.preparation.status, 'invalid');
});

test('当前位置遇到筛选变化只应用并提示重新定位，再次准备才锁定当前位置', async () => {
  const f = fixture(); await f.connect();
  const source = { type: 'marketplace', startPosition: 'current', webFilters: desired };
  await f.call('panel:collect', { targetCount: 1, source });
  for (let i = 0; i < 2; i++) await f.poll();
  let r = await f.call('panel:get'); assert.equal(r.workspace.collection, undefined);
  assert.equal(r.workspace.preparation.status, 'invalid'); assert.match(r.workspace.preparation.reason, /定位|位置/);
  r = await f.call('panel:collect', { targetCount: 1, source });
  assert.equal(r.workspace.collection.status, 'ready'); assert.equal(r.workspace.collection.creators[0].id, '2');
});

test('筛选动作结果不明后终止准备，不自动重试', async () => {
  const f = fixture(); await f.connect(); f.fail();
  const r = await f.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  assert.equal(r.workspace.preparation.status, 'invalid'); assert.equal(r.workspace.collection, undefined);
  await f.poll(); assert.equal(f.applications(), 0);
});

test('切换排行榜先停止旧执行器并使旧文档与准备失效，再导航', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  f.events.length = 0;
  const r = await f.call('panel:open', { source: { type: 'leaderboard' } });
  assert.equal(r.workspace.pageId, null); assert.equal(r.workspace.preparation.status, 'invalid');
  const navigate = f.events.findIndex(e => e[0] === 'update' && e[1].url);
  assert.ok(navigate > 0); assert.equal(f.events[0][0], 'script');
  assert.match(f.events[navigate][1].url, /affiliate_leaderboard$/);
  assert.deepEqual(f.events[navigate][1], { url: 'https://seller.shopee.co.id/portal/web-seller-affiliate/affiliate_leaderboard', active: false });
  assert.equal(f.events.some(e => e[0] === 'update' && e[1].active === true), false);
});

test('首次打开排行榜在后台创建专用页，不抢占当前工作台焦点', async () => {
  const f = fixture();
  await f.call('panel:open', { source: { type: 'leaderboard' } });
  assert.deepEqual(f.creates, [{ url: 'https://seller.shopee.co.id/portal/web-seller-affiliate/affiliate_leaderboard', active: false }]);
  assert.equal(f.events.some(event => event[0] === 'update' || event[0] === 'create'), false);
});

test('筛选准备期间拒绝重复准备以及旧兼容任务预览/启动/继续', async () => {
  const f = fixture(); await f.connect();
  const input = { targetCount: 1, source: { webFilters: desired, startPosition: 'current' } };
  await f.call('panel:collect', input);
  for (const type of ['panel:collect', 'panel:preview', 'panel:start', 'panel:resume']) await assert.rejects(f.call(type, input), /筛选.*准备|等待|取消/);
  assert.equal(f.data().creatorWorkspace.preparation.changed, true); assert.equal(f.applications(), 1);
});

test('仅URL变化的同文档导航也取消网页筛选，旧poll不能再执行动作', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  await f.backend.onUpdated(7, { url: `https://seller.shopee.co.id${path}?manual=1` });
  await f.poll(); assert.equal(f.applications(), 1);
  assert.equal((await f.call('panel:get')).workspace.preparation.status, 'invalid');
});

test('名单快照返回时已跨过筛选原期限，不能重新计时建立集合', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  await f.poll();
  f.advance(44000); f.delaySnapshot(2000); await f.poll();
  const r = await f.call('panel:get');
  assert.equal(r.workspace.preparation?.status, 'invalid');
  assert.equal(r.workspace.collection, undefined);
});

test('冷开筛选控件未挂载时等待并复核，等待不会续期或提前动作', async () => {
  const f = fixture(); await f.connect(); f.waitForFilters(true);
  assert.equal((await f.call('panel:filters')).pageFilters.loading, true);
  let r = await f.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  assert.equal(r.workspace.preparation.status, 'filtering'); assert.equal(f.applications(), 0);
  f.advance(44000); await f.poll(); f.waitForFilters(false); f.advance(1001); await f.poll();
  r = await f.call('panel:get'); assert.equal(r.workspace.preparation.status, 'invalid'); assert.equal(f.applications(), 0);
  const g = fixture(); await g.connect(); g.waitForFilters(true);
  await g.call('panel:collect', { targetCount: 1, source: { webFilters: desired } });
  g.waitForFilters(false); for (let i = 0; i < 3; i++) await g.poll();
  assert.equal((await g.call('panel:get')).workspace.collection.status, 'ready');
});
