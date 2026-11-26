import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPage } from '../extension/page-snapshot.mjs';

function fixture() {
  let clicks = 0;
  const conversation = { to_id: '20', shop_id: '10' };
  const props = { buyerId: '20', shopId: '10', currentConversation: conversation };
  const editor = { value: 'Halo', getClientRects: () => [1], __reactFiber$test: { memoizedProps: props } };
  const send = { getClientRects: () => [1], click() { clicks++; } };
  const context = { window: { __$unstable_useRootStoreOutside: () => ({ shopId: '10', shopName: 'Demo' }) }, location: { origin: 'https://seller.shopee.co.id', pathname: '/' }, performance: { timeOrigin: 123 }, getComputedStyle: () => ({ visibility: 'visible' }), document: {
    querySelectorAll: selector => selector.includes('textarea') ? [editor] : [],
    querySelector: selector => selector.includes('plW8rzAMob') ? send : null,
  } };
  const run = commit => vm.runInNewContext(`(${inspectPage.toString()})('Halo', ${JSON.stringify(commit ?? null)})`, context);
  const commit = { shopId: '10', itemId: '20', documentEpoch: 123 };
  return { run, commit, props, conversation, editor, send, context, clicks: () => clicks };
}

test('没有历史或回执结构也可完成受控点击，快照不读取聊天消息', () => {
  const f = fixture();
  const snapshot = f.run(f.commit);
  assert.equal(snapshot.commit.clicked, true);
  assert.equal(f.clicks(), 1);
  for (const field of ['messages', 'latestMessageId', 'evidenceSupported', 'emptyHistoryConfirmed']) assert.equal(Object.hasOwn(snapshot.chat, field), false);
});

test('最终点击同步核对稳定收件人、店铺与文档身份', () => {
  for (const field of ['shopId', 'itemId', 'documentEpoch']) {
    const f = fixture();
    assert.equal(f.run({ ...f.commit, [field]: 'wrong' }).commit.clicked, false);
    assert.equal(f.clicks(), 0);
  }
  const f = fixture(); f.props.buyerId = '21'; f.conversation.to_id = '21';
  assert.equal(f.run(f.commit).commit.clicked, false);
  assert.equal(f.clicks(), 0);
});

test('聊天身份缺失或互相不符时，即使同名控件还在也不能点击', () => {
  for (const change of [
    f => { delete f.conversation.to_id; },
    f => { f.conversation.shop_id = '11'; },
    f => { f.props.buyerId = '21'; },
    f => { delete f.props.currentConversation; },
  ]) {
    const f = fixture(); change(f);
    assert.equal(f.run(f.commit).commit.clicked, false);
    assert.equal(f.clicks(), 0);
  }
});

test('最终点击仍检查草稿、按钮、可见性及平台限制', () => {
  for (const change of [
    f => { f.editor.value = '用户修改后的草稿'; },
    f => { f.editor.disabled = true; },
    f => { f.editor.readOnly = true; },
    f => { f.send.disabled = true; },
    f => { f.send.getAttribute = () => 'true'; },
    f => { f.send.getClientRects = () => []; },
    f => { f.context.location.origin = 'https://example.com'; },
    f => { const query = f.context.document.querySelectorAll; f.context.document.querySelectorAll = s => s.includes('captcha') ? [{ getClientRects: () => [1], textContent: 'verification' }] : query(s); },
  ]) {
    const f = fixture(); change(f);
    assert.equal(f.run(f.commit).commit.clicked, false);
    assert.equal(f.clicks(), 0);
  }
});
