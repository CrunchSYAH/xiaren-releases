import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../extension/core/backend.mjs';
import { addImageAsset, emptyImageAssets, imageReference } from '../extension/core/image-assets.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSj8AAAAASUVORK5CYII=', 'base64');

async function fixture() {
  const assetStore = (await addImageAsset(emptyImageAssets(), { name: '执行图片.png', mime: 'image/png', size: png.length, dataUrl: `data:image/png;base64,${png.toString('base64')}` }, { id: 'asset', now: 1000 })).store;
  const asset = assetStore.assets[0], reference = imageReference(asset);
  let data = { creatorImageAssets: assetStore }, serial = 0, clock = 1000, failWrite = null;
  const actions = [], clicks = [];
  const page = { origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace', documentEpoch: 123,
    shop: { id: '10', name: '测试店铺' }, creators: [{ id: '20', name: 'Ana', rowKey: '0_120', chatAvailable: true }],
    list: { supported: true, hasMore: false, loading: false, renderedCount: 1 }, blocked: false, chat: null };
  const api = { runtime: { id: 'demo', getURL: path => `chrome-extension://demo/${path}` },
    storage: { local: { get: async () => structuredClone(data), set: async values => { if (failWrite?.(values)) throw new Error('disk'); data = { ...data, ...structuredClone(values) }; } }, session: { get: async () => ({ creatorBrowserSession: 'browser' }) } },
    tabs: { create: async () => ({ id: 7 }), get: async () => ({ url: page.origin + page.path, status: 'complete' }), update: async () => {} }, scripting: { executeScript: async () => [] } };
  const backend = createBackend(api, { now: () => clock, uid: () => `image-execution-${++serial}`, readSnapshot: async (_tab, text, _doc, commit, action) => {
    if (action?.type === 'stage-image') {
      assert.equal(data.creatorWorkspace.imageDraft.token, action.token, '图片预备声明须先落盘');
      assert.equal(data.creatorWorkspace.imageDraft.assetId, reference.assetId);
      assert.deepEqual(action.asset, reference);
      assert.equal(action.dataUrl, asset.dataUrl);
      actions.push(structuredClone(action));
      page.chat.mediaCount = 1;
      page.chat.imageDraft = { token: action.token, taskId: action.taskId, itemId: action.itemId, messageIndex: action.messageIndex,
        assetId: reference.assetId, sha256: reference.sha256, ready: Boolean(action.adoptToken) };
      return { ...structuredClone(page), listAction: { performed: true } };
    }
    if (commit) {
      assert.equal(data.creatorWorkspace.receipt.claimed, true, '最终提交声明须先落盘');
      assert.equal(data.creatorWorkspace.receipt.messageIndex, data.creatorQueue.task.items[0].messageIndex);
      clicks.push({ text, image: commit.image && structuredClone(commit.image) });
      page.chat.editorText = ''; page.chat.mediaCount = 0; delete page.chat.imageDraft;
      return { ...structuredClone(page), commit: { clicked: true } };
    }
    return structuredClone(page);
  } });
  const panel = { id: 'demo', url: api.runtime.getURL('dashboard.html') };
  const sender = { id: 'demo', tab: { id: 7 }, documentId: 'doc', frameId: 0, url: page.origin + page.path };
  const call = (type, body = {}, from = panel) => backend.handle({ type, ...body }, from);
  const context = command => ({ pageId: 'page', taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId, messageIndex: command.messageIndex });
  const poll = () => call('page:poll', { pageId: 'page' }, sender);
  async function start(messages = [reference], mode = 'send') {
    await call('panel:open'); await call('page:hello', { pageId: 'page' }, sender);
    const c = (await call('panel:collect', { targetCount: 1 })).workspace.collection;
    const config = { shop: page.shop, creators: [{ id: '20', name: 'Ana' }], source: c.source, collectionId: c.id, targetCount: 1, limit: 1, messages, intervalSeconds: 5, mode };
    const preview = await call('panel:preview', { config });
    await call('panel:start', { config, previewToken: preview.previewToken, confirmed: mode === 'send' });
  }
  async function prepare() {
    const command = (await poll()).command;
    page.chat ||= { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, sendReady: true, editorText: '', mediaCount: 0, replyCount: 0, imageSupported: true };
    await call('page:prepared', { ...context(command), ok: true }, sender);
    return (await poll()).command;
  }
  const stage = command => call('page:image-stage', context(command), sender);
  const authorize = command => call('page:authorize', context(command), sender);
  const commit = command => call('page:commit', context(command), sender);
  return { call, sender, page, reference, start, prepare, poll, stage, authorize, commit, context, actions, clicks, data: () => data, fail: predicate => { failWrite = predicate; }, ready: () => { page.chat.imageDraft.ready = true; }, advance: ms => { clock += ms; } };
}

test('真实图片资产驱动图文混排，预备与逐条声明落盘后才动作，重复提交不再点击', async () => {
  const f = await fixture();
  await f.start([{ type: 'text', content: 'Hi {{name}}' }, f.reference, { type: 'link', content: 'https://example.com/product' }]);
  let command = await f.prepare();
  assert.equal((await f.stage(command)).staged, false);
  f.page.chat.editorText = command.text;
  await f.authorize(command); assert.equal((await f.commit(command)).committed, true);
  command = (await f.poll()).command;
  assert.deepEqual(command.message, f.reference);
  assert.equal((await f.stage(command)).staged, true);
  assert.equal(f.page.chat.imageDraft.ready, false);
  assert.equal((await f.stage(command)).staged, false);
  f.ready(); await f.authorize(command);
  assert.equal((await f.commit(command)).committed, true);
  await f.commit(command);
  assert.equal(f.actions.length, 1); assert.equal(f.clicks.length, 2);
  assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 2);
  command = (await f.poll()).command;
  assert.equal(command.text, 'https://example.com/product');
  f.page.chat.editorText = command.text;
  await f.authorize(command); await f.commit(command);
  assert.equal(f.clicks.length, 3); assert.equal(f.data().creatorQueue.task.status, 'completed');
  assert.equal(f.data().creatorQueue.history['10']['20'].status, 'confirmed');
});

test('图片预备后授权前暂停，恢复仅接管相同已保留附件而不重复选择文件', async () => {
  const f = await fixture(); await f.start();
  const old = await f.prepare(); await f.stage(old); f.ready();
  const originalToken = f.page.chat.imageDraft.token;
  await f.call('panel:pause');
  assert.equal(f.data().creatorQueue.task.items[0].status, 'pending');
  await f.call('panel:resume');
  const resumed = await f.prepare();
  assert.notEqual(resumed.sessionId, old.sessionId);
  assert.equal(resumed.type, 'send');
  assert.equal((await f.stage(resumed)).staged, true);
  assert.equal(f.actions[1].adoptToken, originalToken);
  assert.notEqual(f.actions[1].token, originalToken);
  assert.equal(f.actions.filter(action => !action.adoptToken).length, 1);
  await f.authorize(resumed); await f.commit(resumed);
  assert.equal(f.clicks.length, 1); assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 1);
});

test('预备声明或最终单次声明保存失败均不能产生对应页面动作', async () => {
  for (const phase of ['stage', 'commit']) {
    const f = await fixture(); await f.start(); const command = await f.prepare();
    if (phase === 'commit') { await f.stage(command); f.ready(); await f.authorize(command); }
    let failed = false;
    f.fail(values => {
      const matches = phase === 'stage' ? values.creatorWorkspace?.imageDraft && !values.creatorQueue?.task.items[0].authorized : values.creatorWorkspace?.receipt?.claimed;
      if (!failed && matches) { failed = true; return true; }
      return false;
    });
    const result = phase === 'stage' ? await f.stage(command) : await f.commit(command);
    assert.equal(result[phase === 'stage' ? 'staged' : 'committed'], false);
    assert.equal(failed, true); assert.equal(f.clicks.length, 0);
    assert.equal(f.actions.length, phase === 'stage' ? 0 : 1);
    assert.equal(f.data().creatorQueue.task.status, 'paused');
  }
});

test('错误图片摘要或非本条附件阻断预览和授权，页面自报成功不能推进', async () => {
  const invalid = await fixture();
  await assert.rejects(invalid.start([{ ...invalid.reference, sha256: '0'.repeat(64) }]), /图片|不符|缺失/);
  assert.equal(invalid.data().creatorQueue.task, null); assert.equal(invalid.actions.length, 0);
  for (const tamper of [f => { f.page.chat.imageDraft.sha256 = '0'.repeat(64); }, f => { f.page.chat.replyCount = 1; }, f => { f.page.chat.editorText = '手工草稿'; }, f => { f.page.chat.mediaCount = 2; }]) {
    const f = await fixture(); await f.start(); const command = await f.prepare(); await f.stage(command); f.ready(); tamper(f);
    assert.equal((await f.authorize(command)).command, null);
    assert.equal(f.data().creatorQueue.task.status, 'paused');
    assert.equal(f.data().creatorQueue.task.items[0].submittedCount, 0);
    assert.equal(f.clicks.length, 0);
  }
  const f = await fixture(); await f.start(); const command = await f.prepare(); await f.stage(command); f.ready(); await f.authorize(command);
  await f.call('page:result', { ...f.context(command), outcome: 'sent' }, f.sender);
  assert.equal(f.data().creatorQueue.task.items[0].status, 'uncertain');
  assert.equal(f.clicks.length, 0);
});

test('图片演练不预备附件不点击，完成后仍没有真实防重发记录', async () => {
  const f = await fixture(); await f.start([f.reference, { type: 'text', content: '后续' }], 'dry-run');
  let command = await f.prepare();
  assert.equal((await f.stage(command)).staged, false);
  await f.authorize(command);
  await f.call('page:result', { ...f.context(command), outcome: 'rehearsed' }, f.sender);
  command = (await f.poll()).command;
  await f.authorize(command);
  await f.call('page:result', { ...f.context(command), outcome: 'rehearsed' }, f.sender);
  assert.equal(f.actions.length, 0); assert.equal(f.clicks.length, 0);
  assert.deepEqual(f.data().creatorQueue.history, {});
  assert.equal(f.data().creatorQueue.task.status, 'completed');
});

test('图片缺失不阻断模板列表、文本模板保存及历史引用读取，失败写入不改变当前任务', async () => {
  const f = await fixture();
  const saved = await f.call('panel:template-create', { draft: { name: '原图片模板', messages: [f.reference] } });
  const template = saved.messageTemplates.templates[0];
  await f.start();
  f.data().creatorImageAssets = emptyImageAssets();
  const beforeQueue = structuredClone(f.data().creatorQueue), beforeWorkspace = structuredClone(f.data().creatorWorkspace);
  const listed = await f.call('panel:template-list');
  assert.deepEqual(listed.messageTemplates.templates[0].messages, [f.reference]);
  for (const [type, input] of [
    ['panel:template-create', { draft: { name: '新图片模板', messages: [f.reference] } }],
    ['panel:template-update', { templateId: template.id, expectedRevision: template.revision, draft: { name: '修改图片模板', messages: [f.reference] } }],
    ['panel:template-copy', { templateId: template.id, expectedRevision: template.revision }],
  ]) await assert.rejects(f.call(type, input), /图片|缺失|不符/);
  assert.equal(f.data().creatorMessageTemplates.templates.length, 1);
  assert.equal(f.data().creatorMessageTemplates.templates[0].revision, template.revision);
  const text = await f.call('panel:template-create', { draft: { name: '仍可保存文本', messages: [{ type: 'text', content: 'Hi {{name}}' }] } });
  assert.equal(text.messageTemplates.templates.length, 2);
  const history = await f.call('panel:history-detail', { taskId: beforeQueue.task.id });
  assert.deepEqual(history.taskRecord.config.messages, [f.reference]);
  assert.deepEqual(f.data().creatorQueue, beforeQueue);
  assert.deepEqual(f.data().creatorWorkspace, beforeWorkspace);
  assert.equal(f.actions.length, 0); assert.equal(f.clicks.length, 0);
});
