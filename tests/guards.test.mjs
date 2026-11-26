import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePage, validateChat } from '../extension/core/page-guards.mjs';

const page = () => ({ origin: 'https://seller.shopee.co.id', shop: { id: '10', name: '示例店铺' }, creators: [{ id: '20', name: 'Ayu', rowKey: '0_99' }], chat: { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, editorText: '', evidenceSupported: true, messages: [] }, blocked: false });

test('可信店铺与稳定达人标识可读取，外域和空身份拒绝', () => {
  assert.equal(validatePage(page()).shop.id, '10');
  assert.throws(() => validatePage({ ...page(), origin: 'https://example.com' }), /印尼/);
  assert.throws(() => validatePage({ ...page(), shop: null }), /店铺/);
  assert.throws(() => validatePage({ ...page(), blocked: true }), /验证|限制/);
});

test('不能用同名达人替代聊天中的稳定标识', () => {
  assert.equal(validateChat(page(), { id: '20' }, '10').recipientId, '20');
  const p = page(); p.chat.recipientId = '21';
  assert.throws(() => validateChat(p, { id: '20' }, '10'), /收件人/);
  p.chat.recipientId = '20'; p.chat.shopId = '11';
  assert.throws(() => validateChat(p, { id: '20' }, '10'), /店铺/);
});

test('缺失控件和已有草稿阻止发送准备', () => {
  for (const field of ['editorFound', 'sendFound']) {
    const p = page(); p.chat[field] = false;
    assert.throws(() => validateChat(p, { id: '20' }, '10'));
  }
  const p = page(); p.chat.editorText = '原有草稿';
  assert.throws(() => validateChat(p, { id: '20' }, '10'), /草稿/);
  p.chat.editorText = '本次文本'; p.chat.latestMessageId = '1'; p.chat.sendReady = true;
  assert.equal(validateChat(p, { id: '20' }, '10', '本次文本').editorText, '本次文本');
});

test('缺少历史与回执不再阻断，但发送文本和按钮仍须核对', () => {
  const p = page(); delete p.chat.evidenceSupported;
  p.chat.editorText = '本次文本'; p.chat.sendReady = true;
  assert.equal(validateChat(p, { id: '20' }, '10', '本次文本').recipientId, '20');
  assert.throws(() => validateChat(p, { id: '20' }, '10', '其他文本'), /文本/);
  p.chat.sendReady = false;
  assert.throws(() => validateChat(p, { id: '20' }, '10', '本次文本'), /控件/);
});
