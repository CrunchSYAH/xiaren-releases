import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8').catch(() => '');
const turn = () => new Promise(resolve => setImmediate(resolve));

function runner(mode = 'dry-run', authorize = true, options = {}) {
  let sendClicks = 0, value = '', readyAfter = options.sendReadyAfter ?? 0, page = { shop: { id: '10' }, creators: [{ id: '20', rowKey: '0_99', chatAvailable: true }], chat: null, blocked: false };
  const editor = { get value() { return value; }, set value(v) { value = v; }, isConnected: true, dispatchEvent() {}, disabled: false, readOnly: false };
  const header = { textContent: 'Ayu' };
  const button = { isConnected: true, click() { sendClicks++; value = ''; page.chat.messages = [{ id: '2', confirmed: !options.pending }]; if (options.disableAfter) { page.chat.sendFound = false; page.chat.editorFound = false; } } };
  const chatButton = { disabled: false, querySelectorAll: () => [{ getAttribute: name => name === 'xlink:href' ? '#icon-chat-new' : null }], click() { page.chat = { shopId: '10', recipientId: '20', editorFound: true, sendFound: true, sendReady: true, editorText: '', headerText: 'Ayu' }; } };
  const row = { getAttribute: () => '0_99', querySelectorAll: () => [chatButton] };
  const messages = [], timers = [];
  const command = { type: 'prepare', taskId: 't', sessionId: 's', itemId: '20', creator: { id: '20', name: 'Ayu' }, text: 'Halo Ayu', mode };
  let next = 'prepare';
  const context = {
    crypto: { randomUUID: () => 'page' }, location: { origin: 'https://seller.shopee.co.id' },
    document: {
      querySelectorAll: selector => selector.startsWith('tr.') ? [row] : [],
      querySelector: selector => selector.includes('textarea') ? editor : selector.includes('lyWL3rDmij') ? header : selector.includes('plW8rzAMob') ? button : null,
    },
    HTMLTextAreaElement: function () {}, Event: class {},
    setTimeout: (fn, delay) => { if (delay < 1000) queueMicrotask(fn); else timers.push(fn); }, clearTimeout() {},
    addEventListener() {},
    chrome: { runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.type === 'page:snapshot') {
        // 真实页面在输入框为空、或输入尚未刷进 React 状态时，发送按钮不可用。
        const ready = value !== '' && readyAfter <= 0;
        if (value !== '' && readyAfter > 0) readyAfter--;
        return { ok: true, snapshot: structuredClone({ ...page, chat: page.chat && { ...page.chat, editorText: value, sendReady: ready } }) };
      }
      if (message.type === 'page:poll') { const type = next; next = null; return { ok: true, command: type ? { ...command, type } : null }; }
      if (message.type === 'page:prepared') { next = 'send'; if (options.preparedDraft) value = options.preparedDraft; }
      if (message.type === 'page:authorize') { if (options.authorizeError) throw new Error('connection lost'); return { ok: true, command: authorize ? { ...command, type: 'permit' } : null }; }
      if (message.type === 'page:commit') { button.click(); return { ok: true, committed: true }; }
      return { ok: true };
    } } },
  };
  Object.defineProperty(context.HTMLTextAreaElement.prototype, 'value', { set(v) { value = v; } });
  vm.runInNewContext(source, context);
  return { context, messages, timers, clicks: () => sendClicks, value: () => value, setValue: text => { value = text; }, async advance() { await turn(); const timer = timers.shift(); if (timer) await timer(); await turn(); await turn(); } };
}

test('页面脚本已实现并在演练模式完整执行但不点击发送或填入草稿', async () => {
  assert.ok(source.includes('page:authorize'), '缺少页面执行与授权逻辑');
  const r = runner();
  for (let i = 0; i < 5; i++) await r.advance();
  assert.equal(r.clicks(), 0); assert.equal(r.value(), '');
  assert.equal(r.messages.find(message => message.type === 'page:result')?.outcome, 'rehearsed');
});

test('真实模式只请求一次提交，不等待回执或另行自报成功', async () => {
  const r = runner('send');
  for (let i = 0; i < 5; i++) await r.advance();
  assert.equal(r.clicks(), 1);
  const commitAt = r.messages.findIndex(message => message.type === 'page:commit');
  assert.ok(commitAt >= 0);
  assert.equal(r.messages.slice(commitAt + 1).some(message => message.type === 'page:snapshot' || message.type === 'page:result'), false);
});

test('许可被拒绝时不发送且保留草稿，避免自动清理误删切换会话的同文本草稿', async () => {
  const r = runner('send', false);
  for (let i = 0; i < 5; i++) await r.advance();
  assert.equal(r.clicks(), 0); assert.equal(r.value(), 'Halo Ayu');
});

test('发送许可请求中断时保留草稿并暂停，不自动重试', async () => {
  const r = runner('send', true, { authorizeError: true });
  for (let i = 0; i < 5; i++) await r.advance();
  assert.equal(r.clicks(), 0); assert.equal(r.value(), 'Halo Ayu');
  assert.equal(r.messages.filter(message => message.type === 'page:authorize').length, 1);
  assert.equal(r.messages.some(message => message.type === 'page:error'), true);
});

test('发送前出现与本次文本相同的用户草稿，也不能清除用户草稿', async () => {
  const r = runner('send', true, { preparedDraft: 'Halo Ayu' });
  for (let i = 0; i < 3; i++) await r.advance();
  assert.equal(r.clicks(), 0); assert.equal(r.value(), 'Halo Ayu');
});

test('提交后控件禁用不再等待额外结果', async () => {
  const r = runner('send', true, { disableAfter: true });
  for (let i = 0; i < 5; i++) await r.advance();
  assert.equal(r.clicks(), 1);
  assert.equal(r.messages.some(message => message.type === 'page:result'), false);
});

test('没有回执时不进入等待或自报待核对', async () => {
  const r = runner('send', true, { pending: true });
  for (let i = 0; i < 5; i++) await r.advance();
  assert.equal(r.clicks(), 1);
  assert.equal(r.messages.some(message => message.type === 'page:result'), false);
  assert.equal(r.messages.filter(message => message.type === 'page:commit').length, 1);
});

test('旧执行器在读取途中被停止时不再填草稿、授权或提交', async () => {
  const r = runner('send');
  const original = r.context.chrome.runtime.sendMessage;
  r.context.chrome.runtime.sendMessage = async message => {
    const reply = await original(message);
    if (message.type === 'page:snapshot' && r.messages.some(m => m.type === 'page:prepared')) r.context.__creatorOutreachPage.stopped = true;
    return reply;
  };
  await r.advance();
  assert.equal(r.value(), '');
  assert.equal(r.messages.some(message => message.type === 'page:authorize' || message.type === 'page:commit'), false);
  assert.equal(r.clicks(), 0);
});

test('准备失败回报具体原因和阶段，发送异常保留原始连接错误与页面可见性', async () => {
  const draft = runner('send');
  draft.setValue('用户已有草稿');
  await draft.advance();
  const failure = draft.messages.find(m => m.type === 'page:prepared' && m.ok === false);
  assert.equal(failure?.stage, 'prepare');
  assert.equal(failure?.error?.message, '当前聊天已有草稿');
  assert.equal(draft.clicks(), 0);
  const lost = runner('send', true, { authorizeError: true });
  lost.context.document.visibilityState = 'hidden';
  lost.context.navigator = { onLine: false };
  for (let i = 0; i < 5; i++) await lost.advance();
  const error = lost.messages.find(m => m.type === 'page:error');
  assert.equal(error?.stage, 'authorize'); assert.equal(error?.error?.message, 'connection lost');
  assert.equal(error?.visibility, 'hidden'); assert.equal(error?.online, false);
  assert.equal(lost.clicks(), 0);
});

test('发送按钮稍后才可用时只读等待，期间不申请许可也不清空草稿', async () => {
  const r = runner('send', true, { sendReadyAfter: 3 });
  for (let i = 0; i < 6; i++) await r.advance();
  assert.equal(r.clicks(), 1);
  const authorizeAt = r.messages.findIndex(message => message.type === 'page:authorize');
  assert.ok(authorizeAt > 0);
  // 填入后先连续读页面确认文本与按钮，再申请许可。
  assert.ok(r.messages.slice(0, authorizeAt).filter(message => message.type === 'page:snapshot').length >= 5);
  assert.equal(r.messages.some(message => message.type === 'page:error'), false);
});

test('发送控件始终不可用时按白名单原因停止，不点击也不清空草稿', async () => {
  const r = runner('send', true, { sendReadyAfter: 999 });
  for (let i = 0; i < 6; i++) await r.advance();
  assert.equal(r.clicks(), 0);
  assert.equal(r.value(), 'Halo Ayu');
  assert.equal(r.messages.some(message => message.type === 'page:authorize'), false);
  const error = r.messages.find(message => message.type === 'page:error');
  assert.equal(error?.stage, 'fill');
  assert.equal(error?.error?.message, '发送控件尚不可用，已阻止发送');
});
