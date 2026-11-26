import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';
import { affiliateDetailUrl } from '../extension/core/affiliate-resolver.mjs';

function fixture() {
  let data = {}, clock = 1000, serial = 0, epoch = 123, doc = 'doc-1', pageId = 'page-1', url = affiliateDetailUrl('100'), recipient = null, text = '', opens = 0, clicks = 0;
  let transform = value => value;
  const mappings = { '100': '20', '200': '21' }, transitions = [], claims = [];
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` }, storage: { local: { get: async () => structuredClone(data), set: async v => { data = { ...data, ...structuredClone(v) }; } }, session: { get: async () => ({ creatorBrowserSession: 'b' }) } }, tabs: { create: async v => ({ id: 7, ...v }), get: async () => ({ url }), update: async (_id, opts) => { if (opts.url) { assert.equal(data.creatorWorkspace.navigation.url, opts.url); transitions.push(opts.url); url = opts.url; } } }, scripting: { executeScript: async () => [] } };
  const snapshot = () => {
    const affiliateId = new URL(url).searchParams.get('affiliate_id'), id = mappings[affiliateId];
    return { origin: 'https://seller.shopee.co.id', path: new URL(url).pathname, documentEpoch: epoch, shop: { id: '10', name: '测试店铺' }, creators: [{ id, name: `测试${affiliateId}`, rowKey: affiliateId, affiliateId, chatAvailable: true }], list: { supported: true, loading: false, hasMore: false }, blocked: false,
      affiliateEvidence: { origin: 'https://seller.shopee.co.id', path: new URL(url).pathname, documentEpoch: epoch, shop: { id: '10' }, status: 'verified', blocked: false, affiliate: { affiliateId, shopeeUserId: id, name: `测试${affiliateId}`, username: `demo${affiliateId}`, chatAvailable: true } },
      chat: recipient ? { shopId: '10', recipientId: recipient, editorFound: true, sendFound: true, sendReady: true, editorText: text, mediaCount: 0, replyCount: 0 } : null };
  };
  const backend = createBackend(api, { now: () => clock, uid: () => `id-${++serial}`, readSnapshot: async (_tab, _text, documentId, commit, action) => {
    assert.equal(documentId, doc);
    const p = transform(snapshot());
    if (action) { p.listAction = { performed: true }; if (action.type === 'open-chat') { opens++; recipient = action.creator.id; } }
    if (commit) { assert.equal(data.creatorWorkspace.receipt.claimed, true); claims.push(commit.roster.affiliate); clicks++; text = ''; p.commit = { clicked: true }; }
    return p;
  } });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = () => ({ id: 'demo', tab: { id: 7 }, documentId: doc, frameId: 0, url });
  const call = (type, body = {}, from = panel) => { clock += 100; return backend.handle({ type, ...body }, from); };
  const page = (type, body = {}) => call(type, { pageId, ...body }, sender());
  const connect = async () => { await call('panel:open', { source: { type: 'affiliates', affiliateIds: ['100', '200'] } }); await page('page:hello'); };
  const completeNavigation = async () => { await backend.onUpdated(7, { status: 'loading', url }); epoch++; doc = `doc-${epoch}`; pageId = `page-${epoch}`; recipient = null; text = ''; await backend.onUpdated(7, { status: 'complete' }); return page('page:hello'); };
  const collect = async () => { await connect(); await call('panel:collect', { targetCount: 2, source: { type: 'affiliates', affiliateIds: ['100', '200'] } }); const cmd = (await page('page:poll')).command; await page('page:collect-step', { collectionId: cmd.collectionId, token: cmd.token }); await completeNavigation(); return (await call('panel:get')).workspace.collection; };
  const start = async () => { const c = await collect(), config = { shop: snapshot().shop, creators: c.creators, source: c.source, messages: [{ type: 'text', content: 'Halo' }, { type: 'link', content: 'https://shopee.co.id/product/1/2' }], intervalSeconds: 1, limit: 2, collectionId: c.id, targetCount: 2, mode: 'send' }; const preview = await call('panel:preview', { config }); await call('panel:start', { config, previewToken: preview.previewToken, confirmed: true }); return (await page('page:poll')).command; };
  return { backend, api, call, page, connect, collect, start, completeNavigation, snapshot, sender, transitions, mappings, claims, setSnapshot: fn => { transform = fn; }, setText: v => { text = v; }, data: () => data, opens: () => opens, clicks: () => clicks, advance: ms => { clock += ms; } };
}

const missingShop = page => ({ ...page, shop: null, creators: [], affiliateEvidence: { ...page.affiliateEvidence, shop: null, affiliate: null, status: 'blocked', reason: 'shop-unavailable' } });
async function beginNavigation(f, running = true) {
  if (running) {
    const cmd = await f.start();
    await f.page('page:open-chat', { ...cmd, type: 'page:open-chat' });
    return cmd;
  }
  await f.connect();
  await f.call('panel:collect', { targetCount: 2, source: { type: 'affiliates', affiliateIds: ['100', '200'] } });
  const cmd = (await f.page('page:poll')).command;
  await f.page('page:collect-step', { collectionId: cmd.collectionId, token: cmd.token });
  return cmd;
}

test('受控详情新文档暂缺店铺时只等待，恢复后继续收集或重新准备，旧会话无效', async () => {
  for (const running of [false, true]) {
    const f = fixture(), old = await beginNavigation(f, running), oldSender = f.sender();
    const startedAt = f.data().creatorWorkspace.navigation.startedAt;
    f.setSnapshot(missingShop);
    await f.completeNavigation();
    const waiting = f.data().creatorWorkspace;
    assert.equal(waiting.collection.status, running ? 'consumed' : 'collecting');
    assert.equal(waiting.collection.pagePending, true);
    assert.equal(waiting.navigation.startedAt, startedAt);
    assert.equal((await f.page('page:poll')).command, null);
    for (const type of ['page:open-chat', 'page:authorize', 'page:commit', 'page:image-stage']) {
      const reply = await f.page(type, { ...old, type });
      assert.ok(!reply.opened && !reply.staged && !reply.committed && !reply.command);
    }
    assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
    f.setSnapshot(value => value);
    const reply = await f.page('page:poll');
    assert.equal(f.data().creatorWorkspace.navigation, null);
    assert.equal(f.data().creatorWorkspace.collection.pagePending, false);
    if (running) {
      assert.equal(f.data().creatorQueue.task.status, 'running');
      assert.equal(reply.command.type, 'prepare');
      assert.notEqual(reply.command.sessionId, old.sessionId);
      assert.equal((await f.page('page:authorize', { ...old, type: 'page:authorize' })).command, null);
      await assert.rejects(f.call('page:authorize', { ...old, type: 'page:authorize', pageId: 'old' }, oldSender), /文档|会话/);
      assert.equal((await f.page('page:open-chat', { ...reply.command, type: 'page:open-chat' })).opened, true);
    } else assert.equal(f.data().creatorWorkspace.collection.status, 'ready');
  }
});

test('受控详情等待沿用导航原时限，重复hello和心跳不续期', async () => {
  const f = fixture(); await beginNavigation(f);
  f.advance(40000); f.setSnapshot(missingShop); await f.completeNavigation();
  const startedAt = f.data().creatorWorkspace.navigation.startedAt;
  await f.page('page:hello');
  assert.equal(f.data().creatorWorkspace.navigation.startedAt, startedAt);
  for (let i = 0; i < 3; i++) assert.equal((await f.page('page:poll')).command, null);
  f.advance(5000); await f.call('panel:get');
  assert.equal(f.data().creatorWorkspace.collection.status, 'invalid');
  assert.equal(f.data().creatorQueue.task.status, 'paused');
  assert.equal(f.data().creatorWorkspace.navigation, null);
  f.setSnapshot(value => value); assert.equal((await f.page('page:poll')).command, null);
  assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
});

test('详情已核实但店铺名称尚未加载时仍只等待，解析出的其他店铺不能冒充', async () => {
  for (const wrongShop of [false, true]) {
    const f = fixture(); await beginNavigation(f);
    f.setSnapshot(page => ({ ...page, shop: null, creators: [], affiliateEvidence: { ...page.affiliateEvidence, shop: { id: wrongShop ? '99' : '10' } } }));
    await f.completeNavigation();
    assert.equal(f.data().creatorWorkspace.collection.status, wrongShop ? 'invalid' : 'consumed');
    assert.equal((await f.page('page:poll')).command, null);
    if (!wrongShop) {
      f.setSnapshot(value => value);
      assert.equal((await f.page('page:poll')).command.type, 'prepare');
    }
    assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
  }
});

test('详情核对往返跨过原导航期限时，不能因资料已返回而继续任务', async () => {
  for (const running of [false, true]) {
    const f = fixture(); await beginNavigation(f, running);
    f.setSnapshot(missingShop); await f.completeNavigation(); f.advance(43000);
    let delayed = true;
    f.setSnapshot(page => { if (delayed) { delayed = false; f.advance(3000); } return page; });
    assert.equal((await f.page('page:poll')).command, null);
    assert.equal(f.data().creatorWorkspace.collection.status, 'invalid');
    assert.equal(f.data().creatorWorkspace.navigation, null);
    if (running) assert.equal(f.data().creatorQueue.task.status, 'paused');
    assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
  }
});

test('详情等待中暂停停止不自动恢复，店铺就绪后显式继续才重新准备', async () => {
  for (const type of ['panel:pause', 'panel:stop']) {
    const f = fixture(); await beginNavigation(f);
    f.setSnapshot(missingShop); await f.completeNavigation(); await f.call(type);
    assert.equal((await f.page('page:poll')).command, null);
    f.setSnapshot(value => value); assert.equal((await f.page('page:poll')).command, null);
    assert.equal(f.data().creatorQueue.task.status, type === 'panel:pause' ? 'paused' : 'stopped');
    assert.equal(f.data().creatorWorkspace.collection.status, 'consumed');
    assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
    await f.call('panel:resume'); assert.equal((await f.page('page:poll')).command.type, 'prepare');
  }
});

test('详情等待中错店铺、路由、时间基准或替换文档仍作废名单', async () => {
  const changes = [
    p => ({ ...p, shop: { id: '99', name: '另一店铺' }, affiliateEvidence: { ...p.affiliateEvidence, shop: { id: '99' } } }),
    p => ({ ...missingShop(p), path: '/portal/web-seller-affiliate/kol_marketplace' }),
    p => ({ ...missingShop(p), documentEpoch: p.documentEpoch + 1 }),
    p => ({ ...missingShop(p), blocked: true }),
  ];
  for (const change of changes) {
    const f = fixture(); await beginNavigation(f);
    f.setSnapshot(missingShop); await f.completeNavigation();
    f.setSnapshot(change); assert.equal((await f.page('page:poll')).command, null);
    assert.equal(f.data().creatorWorkspace.collection.status, 'invalid');
    assert.equal(f.data().creatorQueue.task.status, 'paused');
    assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
  }
  const f = fixture(); await beginNavigation(f); f.setSnapshot(missingShop); await f.completeNavigation();
  const sender = { ...f.sender(), documentId: 'replacement' };
  await f.call('page:hello', { pageId: 'replacement' }, sender);
  assert.equal(f.data().creatorWorkspace.collection.status, 'invalid');
  assert.equal(f.data().creatorQueue.task.status, 'paused');
  assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
});

test('指定联盟伙伴官方详情跨文档准备，保持输入顺序，发送导航后重绑会话且旧包无效', async () => {
  const f = fixture(), command = await f.start(), oldSender = f.sender();
  assert.deepEqual(f.data().creatorWorkspace.collection.creators.map(r => r.id), ['20', '21']);
  assert.equal((await f.page('page:open-chat', { ...command, type: 'page:open-chat' })).navigating, true);
  await f.completeNavigation();
  await assert.rejects(f.call('page:authorize', { ...command, type: 'page:authorize', pageId: 'page-old' }, oldSender), /文档|会话/);
  let cmd = (await f.page('page:poll')).command;
  assert.notEqual(cmd.sessionId, command.sessionId);
  assert.equal((await f.page('page:open-chat', { ...cmd, type: 'page:open-chat' })).opened, true);
  await f.page('page:prepared', { ...cmd, type: 'page:prepared', ok: true });
  cmd = (await f.page('page:poll')).command; f.setText(cmd.text);
  await f.page('page:authorize', { ...cmd, type: 'page:authorize' });
  assert.equal((await f.page('page:commit', { ...cmd, type: 'page:commit' })).committed, true);
  assert.equal(f.clicks(), 1); assert.equal(f.claims[0].affiliateId, '100'); assert.equal(f.claims[0].shopeeUserId, '20');
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 1);
});

test('受控详情导航期间暂停或停止不会因新hello自动恢复，也不打开聊天', async () => {
  for (const type of ['panel:pause', 'panel:stop']) {
    const f = fixture(), cmd = await f.start();
    await f.page('page:open-chat', { ...cmd, type: 'page:open-chat' }); await f.call(type); await f.completeNavigation();
    assert.equal(f.data().creatorQueue.task.status, type === 'panel:pause' ? 'paused' : 'stopped');
    assert.equal((await f.page('page:poll')).command, null); assert.equal(f.opens(), 0); assert.equal(f.clicks(), 0);
  }
});

test('人工导航、受控URL不符、超时和映射改变均阻断且不按姓名或数字相等补人', async () => {
  const f = fixture(); await f.collect();
  await f.backend.onUpdated(7, { url: affiliateDetailUrl('300') });
  assert.equal(f.data().creatorWorkspace.collection.status, 'invalid');
  const g = fixture(), cmd = await g.start(); await g.page('page:open-chat', { ...cmd, type: 'page:open-chat' }); g.advance(46000);
  await g.completeNavigation(); assert.equal(g.data().creatorQueue.task.status, 'paused'); assert.equal(g.clicks(), 0);
  const h = fixture(); await h.collect(); h.mappings['200'] = '99';
  const c = h.data().creatorWorkspace.collection, config = { shop: h.snapshot().shop, creators: c.creators, source: c.source, messages: [{ type: 'text', content: 'Halo' }], intervalSeconds: 1, limit: 2, targetCount: 2, collectionId: c.id, mode: 'dry-run' };
  await assert.rejects(h.call('panel:preview', { config }), /失效|准备/); assert.equal(h.clicks(), 0);
});
