import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';

function fixture() {
  let data = {}, sequence = 0, clock = 1000, clicks = 0;
  const page = { origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', documentEpoch: 123,
    shop: { id: '10', name: '示例店铺' }, creators: [
      { id: '20', name: 'Ayu', rowKey: '0_120', chatAvailable: true },
      { id: '21', name: 'Budi', rowKey: '1_121', chatAvailable: true },
    ], list: { supported: true, hasMore: false, loading: false, renderedCount: 2 }, blocked: false, chat: null };
  const api = { runtime: { id: 'demo', getURL: p => `chrome-extension://demo/${p}` },
    storage: { local: { get: async () => structuredClone(data), set: async values => { data = { ...data, ...structuredClone(values) }; } }, session: { get: async () => ({ creatorBrowserSession: 'browser' }) } },
    tabs: { create: async () => ({ id: 7 }), get: async () => ({ url: page.origin, status: 'complete' }), update: async () => {} }, scripting: { executeScript: async () => [] } };
  const backend = createBackend(api, { now: () => clock, uid: () => `sequence-${++sequence}`, readSnapshot: async (_tab, _text, _doc, commit) => {
    const snapshot = structuredClone(page);
    if (commit) {
      assert.equal(data.creatorWorkspace.receipt.claimed, true, '最终点击前声明必须落盘');
      assert.equal(data.creatorWorkspace.receipt.messageIndex, data.creatorQueue.task.items.find(item => item.id === commit.itemId).messageIndex);
      clicks++; snapshot.commit = { clicked: true };
    }
    return snapshot;
  } });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = { id: 'demo', tab: { id: 7 }, documentId: 'doc', frameId: 0, url: page.origin + page.path };
  const call = (type, body = {}, from = panel) => backend.handle({ type, ...body }, from);
  const poll = () => call('page:poll', { pageId: 'page' }, sender);
  const connect = async () => { await call('panel:open'); await call('page:hello', { pageId: 'page' }, sender); };
  const config = collection => ({ shop: page.shop, creators: collection.creators.map(({ id, name }) => ({ id, name })),
    taskName: '新品邀请', messages: [{ type: 'text', content: 'Halo {{name}}' }, { type: 'link', content: 'https://shopee.co.id/product/1/2' }],
    source: collection.source, targetCount: collection.target, limit: collection.target, collectionId: collection.id, intervalSeconds: 5, mode: 'dry-run' });
  return { call, poll, connect, config, page, sender, advance: ms => { clock += ms; }, data: () => data, clicks: () => clicks };
}

test('来源与条件从准备锁定到预览启动，切换来源不能复用原名单', async () => {
  const f = fixture(); await f.connect();
  const source = { type: 'specified', creatorIds: ['21', '21'], nameIncludes: 'bu', nameExcludes: '' };
  const c = (await f.call('panel:collect', { targetCount: 1, source })).workspace.collection;
  assert.equal(c.status, 'ready'); assert.deepEqual(c.creators.map(row => row.id), ['21']);
  const config = f.config(c);
  for (const changed of [undefined, { ...c.source, nameIncludes: '' }, { ...c.source, creatorIds: ['20'] }]) {
    await assert.rejects(f.call('panel:preview', { config: { ...config, source: changed } }), /来源|筛选/);
  }
  const p = await f.call('panel:preview', { config });
  const started = await f.call('panel:start', { config, previewToken: p.previewToken });
  assert.deepEqual(started.state.task.config.source, c.source);
  assert.equal(started.state.task.config.taskName, '新品邀请');
  assert.equal(f.clicks(), 0);
});

test('指定ID未找到或被历史拦截时不补入别的达人、不允许启动', async () => {
  const f = fixture(); await f.connect();
  await f.call('panel:deny', { shopId: '10', creatorId: '20', name: 'Ayu', blocked: true });
  const c = (await f.call('panel:collect', { targetCount: 2, source: { type: 'specified', creatorIds: ['20', '99'] } })).workspace.collection;
  assert.equal(c.status, 'insufficient'); assert.equal(c.count, 0);
  assert.equal(c.missing, 1); assert.equal(c.excluded, 1);
  await assert.rejects(f.call('panel:preview', { config: f.config(c) }), /准备|备齐/);
  assert.equal(f.clicks(), 0);
});

test('消息内容、顺序、类型或任务名修改均撤销旧启动预览', async () => {
  for (const change of [
    c => ({ ...c, messages: c.messages.toReversed() }),
    c => ({ ...c, messages: [{ type: 'text', content: '不同的文字' }, c.messages[1]] }),
    c => ({ ...c, messages: [c.messages[0], { ...c.messages[1], type: 'text' }] }),
    c => ({ ...c, taskName: '不同任务名' }),
  ]) {
    const f = fixture(); await f.connect();
    const c = (await f.call('panel:collect', { targetCount: 1 })).workspace.collection, config = f.config(c);
    const p = await f.call('panel:preview', { config });
    await assert.rejects(f.call('panel:start', { config: change(config), previewToken: p.previewToken }), /变化|预览/);
    assert.equal(f.data().creatorQueue.task, null); assert.equal(f.clicks(), 0);
  }
});

test('十条消息逐条持久化授权与提交，迟到索引无效，全部完成才开始逐人间隔', async () => {
  const f = fixture(); await f.connect();
  const c = (await f.call('panel:collect', { targetCount: 2 })).workspace.collection;
  const config = { ...f.config(c), mode: 'send', messages: Array.from({ length: 10 }, (_, i) => ({ type: i % 2 ? 'link' : 'text', content: i % 2 ? `https://shopee.co.id/p/${i}` : `第${i + 1}条 {{name}}` })) };
  const p = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: p.previewToken, confirmed: true });
  const prepare = (await f.poll()).command;
  const context = { pageId: 'page', taskId: prepare.taskId, sessionId: prepare.sessionId, itemId: prepare.itemId };
  f.page.chat = { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, sendReady: true, editorText: '' };
  await f.call('page:prepared', { ...context, messageIndex: 0, ok: true }, f.sender);
  for (let index = 0; index < 10; index++) {
    const command = (await f.poll()).command; assert.equal(command.type, 'send'); assert.equal(command.messageIndex, index);
    f.page.chat.editorText = command.text;
    if (index > 0) {
      await f.call('page:commit', { ...context, messageIndex: index - 1 }, f.sender);
      assert.equal(f.clicks(), index);
    }
    await f.call('page:authorize', { ...context, messageIndex: index }, f.sender);
    assert.equal((await f.call('page:commit', { ...context, messageIndex: index }, f.sender)).committed, true);
    assert.equal(f.data().creatorQueue.task.items[0].submittedCount, index + 1);
    assert.equal(f.data().creatorQueue.task.items[0].status, index === 9 ? 'sent' : 'prepared');
    f.page.chat.editorText = '';
  }
  assert.equal(f.clicks(), 10); assert.equal((await f.poll()).command, null);
  const diagnostics = (await f.call('panel:export-diagnostics')).diagnostics;
  assert.ok(diagnostics.events.some(entry => entry.reason === '当前消息已提交，剩余消息待提交'));
  f.advance(5000); assert.equal((await f.poll()).command.itemId, '21');
});

test('旧窗口的人工确认不能确认下一条不明消息或新的会话', async () => {
  const f = fixture(); await f.connect();
  const c = (await f.call('panel:collect', { targetCount: 1 })).workspace.collection;
  const config = { ...f.config(c), mode: 'send', messages: Array.from({ length: 3 }, (_, i) => ({ type: 'text', content: `消息${i}` })) };
  const p = await f.call('panel:preview', { config });
  await f.call('panel:start', { config, previewToken: p.previewToken, confirmed: true });
  async function uncertain() {
    const prepare = (await f.poll()).command;
    const context = { pageId: 'page', taskId: prepare.taskId, sessionId: prepare.sessionId, itemId: prepare.itemId, messageIndex: prepare.messageIndex };
    f.page.chat = { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, sendReady: true, editorText: '' };
    await f.call('page:prepared', { ...context, ok: true }, f.sender);
    const send = (await f.poll()).command;
    f.page.chat.editorText = send.text;
    await f.call('page:authorize', context, f.sender);
    await f.call('page:result', { ...context, outcome: 'uncertain' }, f.sender);
    return { taskId: context.taskId, sessionId: context.sessionId, itemId: '20', messageIndex: context.messageIndex, resolution: 'sent' };
  }
  const old = await uncertain();
  await f.call('panel:resolve', old);
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 1);
  f.page.chat.editorText = '';
  await f.call('panel:resume');
  const current = await uncertain();
  const before = structuredClone(f.data().creatorQueue);
  await assert.rejects(f.call('panel:resolve', old), /变化|过期|核对|不符/);
  await assert.rejects(f.call('panel:resolve', { ...current, messageIndex: 0 }), /变化|过期|核对|不符/);
  assert.deepEqual(f.data().creatorQueue, before);
  await f.call('panel:resolve', current);
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 2);
  assert.equal(f.data().creatorQueue.task.items[0].messageIndex, 2);
  assert.equal(f.data().creatorQueue.task.status, 'paused');
  assert.equal(f.clicks(), 0);
});
