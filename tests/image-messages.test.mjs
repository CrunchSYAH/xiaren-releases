import test from 'node:test';
import assert from 'node:assert/strict';
import * as queue from '../extension/core/queue.mjs';
import { emptyMessageTemplates, createMessageTemplate, updateMessageTemplate, copyMessageTemplate, readMessageTemplates } from '../extension/core/message-templates.mjs';
import { emptyTaskHistory, archiveTask, getTaskHistoryDetail, listTaskHistory, exportTaskHistory, readTaskHistory } from '../extension/core/task-history.mjs';

const image = (extra = {}) => ({ type: 'image', assetId: 'asset-one', sha256: 'a'.repeat(64), name: '商品.png', mime: 'image/png', size: 321, width: 100, height: 80, ...extra });
const messages = () => [{ type: 'text', content: 'Hi {{name}}' }, image(), { type: 'link', content: 'https://example.com/product' }];
const binding = { tabId: 7, pageId: 'page' };
const config = (extra = {}) => ({ shop: { id: 'shop', name: '店铺' }, creators: [{ id: 'a', name: 'Ana' }], messages: messages(), intervalSeconds: 10, limit: 1, mode: 'send', ...extra });
let nextId = 0;
const step = (state, event, now = 1000) => queue.reduceQueue(state, event, { now, uid: () => `image-${++nextId}` });
const start = (extra = {}) => step(queue.initialState(), { type: 'start', config: config(extra), binding }).state;
const identity = (state, itemId = 'a') => ({ ...binding, shopId: 'shop', taskId: state.task.id, sessionId: state.task.sessionId, itemId, messageIndex: state.task.items.find(item => item.id === itemId).messageIndex });
function prepare(state) {
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'prepared', ...identity(state), ok: true }).state;
  return step(state, { type: 'poll', ...identity(state) });
}
function submit(state, now = 1000) {
  state = step(state, { type: 'authorize', ...identity(state) }, now).state;
  return step(state, { type: 'result', ...identity(state), outcome: state.task.config.mode === 'send' ? 'sent' : 'rehearsed' }, now).state;
}

test('图片与文字链接混排保留规范引用，逐人渲染文字且不共享可变图片对象', () => {
  const source = config({ creators: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Budi' }], limit: 2 });
  const normalized = queue.normalizeMessages(source.messages);
  assert.deepEqual(normalized, source.messages);
  assert.notEqual(normalized[1], source.messages[1]);
  const state = step(queue.initialState(), { type: 'start', config: source, binding }).state;
  assert.deepEqual(state.task.config.messages, messages());
  assert.deepEqual(state.task.items[0].messages, ['Hi Ana', image(), 'https://example.com/product']);
  assert.deepEqual(state.task.items[1].messages, ['Hi Budi', image(), 'https://example.com/product']);
  assert.deepEqual(state.task.items[0].messageTypes, ['text', 'image', 'link']);
  source.messages[1].name = '外部改变';
  assert.equal(state.task.config.messages[1].name, '商品.png');
  state.task.items[0].messages[1].name = '第一个副本';
  assert.equal(state.task.items[1].messages[1].name, '商品.png');
  assert.equal(state.task.config.messages[1].name, '商品.png');
});

test('图片引用缺字段或夹带正文及二进制必须拒绝，混排序列仍限定1至10条', () => {
  for (const extra of [{ assetId: '' }, { sha256: 'A'.repeat(64) }, { mime: 'image/gif' }, { size: 2 * 1024 * 1024 }, { width: 20001 }, { height: 0 }, { name: '' }, { content: undefined }, { dataUrl: 'data:image/png;base64,secret' }]) {
    assert.throws(() => queue.normalizeMessages([image(extra)]), /图片|消息|引用/);
  }
  const incomplete = image(); delete incomplete.assetId;
  for (const value of [[], [incomplete], [null], [{ type: 'video', content: 'x' }], new Array(1), Array.from({ length: 11 }, () => image())]) assert.throws(() => queue.normalizeMessages(value), /图片|消息|引用/);
  const ten = Array.from({ length: 10 }, (_, index) => index % 2 ? { type: 'text', content: '第 {{name}} 条' } : image());
  assert.equal(queue.previewTask(queue.initialState(), config({ messages: ten })).items[0].messages.length, 10);
});

test('当前图片命令仅携带独立引用且text为空，原文本及旧单双消息命令保持原结构', () => {
  const first = image();
  const initial = start({ messages: [first] });
  const prepared = step(initial, { type: 'poll', ...identity(initial) });
  assert.equal(prepared.command.type, 'prepare');
  assert.equal(prepared.command.text, '');
  assert.deepEqual(prepared.command.message, first);
  assert.deepEqual(queue.currentMessage(prepared.state.task.items[0]), first);
  assert.equal(queue.currentText(prepared.state.task.items[0]), '');
  prepared.command.message.name = '命令变化';
  assert.equal(prepared.state.task.items[0].messages[0].name, first.name);
  const text = start({ messages: [{ type: 'link', content: 'https://example.com' }] });
  const command = step(text, { type: 'poll', ...identity(text) }).command;
  assert.equal(Object.hasOwn(command, 'message'), false);
  assert.equal(command.text, 'https://example.com');
  assert.deepEqual(queue.currentMessage(text.task.items[0]), { type: 'link', content: command.text });
  assert.deepEqual(queue.currentMessage({ text: '旧单条' }), { type: 'text', content: '旧单条' });
  assert.deepEqual(queue.currentMessage({ text: '旧话术', messages: ['旧话术', 'https://example.com'], messageIndex: 1 }), { type: 'link', content: 'https://example.com' });
  assert.equal(queue.currentText({ text: '旧单条' }), '旧单条');
  assert.equal(queue.currentMessage(undefined), null);
});

test('中间图片单独授权，中断核对仅推进这一条且旧图片回包不能确认后面的链接', () => {
  let state = prepare(start({ creators: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Budi' }], limit: 2 })).state;
  state = submit(state);
  const sendingImage = step(state, { type: 'poll', ...identity(state) });
  assert.deepEqual(sendingImage.command.message, image());
  assert.equal(sendingImage.command.messageIndex, 1);
  assert.equal(sendingImage.command.text, '');
  state = step(sendingImage.state, { type: 'authorize', ...identity(sendingImage.state) }).state;
  const oldImageIdentity = identity(state);
  state = step(state, { type: 'interrupt', reason: '连接中断' }).state;
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.task.items[0].status, 'uncertain');
  assert.equal(state.task.items[0].submittedCount, 1);
  assert.deepEqual(queue.currentMessage(state.task.items[0]), image());
  assert.throws(() => step(state, { type: 'resume', binding }), /核对/);
  state = step(state, { type: 'resolve', ...identity(state), resolution: 'sent' }).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].messageIndex, 2);
  assert.equal(state.task.items[0].submittedCount, 2);
  state = step(state, { type: 'resume', binding }).state;
  const resumed = prepare(state);
  assert.equal(resumed.command.text, 'https://example.com/product');
  assert.equal(Object.hasOwn(resumed.command, 'message'), false);
  state = step(resumed.state, { type: 'authorize', ...identity(resumed.state) }).state;
  assert.deepEqual(step(state, { type: 'result', ...oldImageIdentity, outcome: 'sent' }).state, state);
  assert.throws(() => step(state, { type: 'resolve', ...oldImageIdentity, resolution: 'sent' }), /过期|变化|刷新|暂停/);
  state = step(state, { type: 'result', ...identity(state), outcome: 'sent' }, 2000).state;
  assert.equal(state.task.items[0].submittedCount, 3);
  assert.equal(state.task.nextAt, 12000);
  assert.equal(step(state, { type: 'poll', ...identity(state) }, 11999).command, null);
  assert.equal(step(state, { type: 'poll', ...identity(state) }, 12000).command.itemId, 'b');
});

test('图片授权前暂停可恢复，十条图片演练不产生真实提交或防重发记录', () => {
  let state = prepare(start({ messages: [image(), { type: 'text', content: '末条' }] })).state;
  state = step(state, { type: 'pause' }).state;
  assert.equal(state.task.items[0].status, 'pending');
  assert.equal(state.task.items[0].submittedCount, 0);
  assert.equal(state.history.shop?.a, undefined);
  state = step(state, { type: 'resume', binding }).state;
  assert.deepEqual(prepare(state).command.message, image());
  state = prepare(start({ mode: 'dry-run', messages: Array.from({ length: 10 }, () => image()) })).state;
  for (let index = 0; index < 10; index++) {
    state = submit(state);
    if (index < 9) state = step(state, { type: 'poll', ...identity(state) }).state;
  }
  assert.equal(state.task.status, 'completed');
  assert.equal(state.task.items[0].status, 'rehearsed');
  assert.equal(state.task.items[0].submittedCount, 0);
  assert.deepEqual(state.history, {});
});

test('模板新建更新复制保存图片引用和混排顺序，不包含二进制也不共享外部引用', () => {
  const draft = { name: '图片混排', messages: messages() };
  const saved = createMessageTemplate(emptyMessageTemplates(), draft, { id: 'template', now: 1000 });
  const updated = updateMessageTemplate(saved, { templateId: 'template', expectedRevision: 1, draft: { ...draft, messages: [image(), draft.messages[0]] } }, { now: 2000 });
  const copied = copyMessageTemplate(updated, { templateId: 'template', expectedRevision: 2 }, { id: 'copy', now: 3000 });
  assert.deepEqual(copied.templates[1].messages, [image(), { type: 'text', content: 'Hi {{name}}' }]);
  assert.deepEqual(readMessageTemplates(copied), copied);
  draft.messages[1].assetId = '外部变化';
  assert.equal(saved.templates[0].messages[1].assetId, 'asset-one');
  copied.templates[1].messages[0].name = '副本变化';
  assert.equal(updated.templates[0].messages[0].name, '商品.png');
  assert.doesNotMatch(JSON.stringify(saved), /dataUrl|base64|blob:/);
});

test('图片任务历史保留类型计数、来源和任务名，只导出图片引用并拒绝错误类型计数', () => {
  let state = prepare(start({ taskName: '图片活动', source: { type: 'marketplace', creatorIds: [], nameIncludes: 'Ana', nameExcludes: 'Bot' } })).state;
  for (let index = 0; index < 3; index++) {
    state = submit(state);
    if (index < 2) state = step(state, { type: 'poll', ...identity(state) }).state;
  }
  const history = archiveTask(emptyTaskHistory(), state.task);
  const detail = getTaskHistoryDetail(history, null, state.task.id);
  assert.deepEqual(detail.config.messages, messages());
  assert.equal(detail.config.taskName, '图片活动');
  assert.deepEqual(detail.config.source, state.task.config.source);
  assert.deepEqual(detail.items[0].messageTypes, ['text', 'image', 'link']);
  assert.equal(detail.items[0].messageCount, 3);
  assert.equal(detail.items[0].submittedCount, 3);
  assert.deepEqual(readTaskHistory(history), history);
  assert.equal(listTaskHistory(history, null).tasks[0].submittedMessages, 3);
  const exported = exportTaskHistory(history, null);
  assert.deepEqual(exported.tasks[0].config.messages[1], image());
  assert.doesNotMatch(JSON.stringify(exported), /dataUrl|base64|blob:|messageIndex|authorized/);
  detail.config.messages[1].name = '读取副本变化';
  assert.equal(history.tasks[0].config.messages[1].name, '商品.png');
  const corrupt = structuredClone(history);
  corrupt.tasks[0].items[0].messageTypes[1] = 'text';
  assert.throws(() => readTaskHistory(corrupt), /损坏|不兼容/);
});
