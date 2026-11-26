import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, previewTask, reduceQueue, currentText } from '../extension/core/queue.mjs';
import { emptyMessageTemplates, readMessageTemplates, listMessageTemplates, createMessageTemplate, updateMessageTemplate, copyMessageTemplate } from '../extension/core/message-templates.mjs';
import { emptyTaskHistory, readTaskHistory, archiveTask, getTaskHistoryDetail, listTaskHistory, exportTaskHistory } from '../extension/core/task-history.mjs';

const binding = { tabId: 3, pageId: 'page' };
const messages = () => [{ type: 'text', content: 'Hi {{name}}' }, { type: 'link', content: ' https://example.com/product ' }, { type: 'text', content: '下一条 {{name}}' }];
const config = (extra = {}) => ({ shop: { id: 'shop', name: '店铺' }, creators: [{ id: 'a', name: 'Ana' }], messages: messages(), intervalSeconds: 10, limit: 1, mode: 'send', ...extra });
let sequence = 0;
const step = (state, event, now = 1000) => reduceQueue(state, event, { now, uid: () => `sequence-${++sequence}` });
const start = (extra = {}) => step(initialState(), { type: 'start', config: config(extra), binding }).state;
const identity = state => ({ ...binding, shopId: 'shop', sessionId: state.task.sessionId, itemId: 'a', messageIndex: state.task.items[0].messageIndex });
const resolution = (state, decision = 'sent') => ({ type: 'resolve', taskId: state.task.id, sessionId: state.task.sessionId, itemId: 'a', messageIndex: state.task.items[0].messageIndex, resolution: decision });
function prepare(state) {
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'prepared', ...identity(state), ok: true }).state;
  return step(state, { type: 'poll', ...identity(state) }).state;
}
function submit(state, now = 1000) {
  state = step(state, { type: 'authorize', ...identity(state) }, now).state;
  return step(state, { type: 'result', ...identity(state), outcome: state.task.config.mode === 'send' ? 'sent' : 'rehearsed' }, now).state;
}

test('新序列按顺序生成1—10条逐人消息，文字替换姓名而链接独立校验且不保留输入引用', () => {
  const source = config({ taskName: '  秋季活动  ' });
  const state = step(initialState(), { type: 'start', config: source, binding }).state;
  assert.equal(state.task.config.taskName, '秋季活动');
  assert.deepEqual(state.task.config.messages, [{ type: 'text', content: 'Hi {{name}}' }, { type: 'link', content: 'https://example.com/product' }, { type: 'text', content: '下一条 {{name}}' }]);
  assert.equal(Object.hasOwn(state.task.config, 'template'), false);
  assert.deepEqual(state.task.items[0].messages, ['Hi Ana', 'https://example.com/product', '下一条 Ana']);
  assert.deepEqual(state.task.items[0].messageTypes, ['text', 'link', 'text']);
  assert.equal(currentText(state.task.items[0]), 'Hi Ana');
  source.messages[0].content = '外部修改';
  assert.equal(state.task.config.messages[0].content, 'Hi {{name}}');
  const one = previewTask(initialState(), config({ messages: [{ type: 'link', content: 'https://example.com' }] })).items[0];
  assert.deepEqual(one.messageTypes, ['link']);
  assert.equal(one.messageIndex, 0);
  assert.equal(one.submittedCount, 0);
  const ten = Array.from({ length: 10 }, (_, index) => ({ type: 'text', content: `第${index}条` }));
  assert.equal(previewTask(initialState(), config({ messages: ten })).items[0].messages.length, 10);
  assert.equal(previewTask(initialState(), config({ messages: [{ type: 'text', content: 'x'.repeat(2400) }] })).items[0].messages[0].length, 2400);
});

test('新序列拒绝空值、非法类型、图片、混合旧字段与未知变量，旧单双消息维持原结构', () => {
  for (const value of [undefined, null, [], {}, new Array(1), Array.from({ length: 11 }, () => ({ type: 'text', content: 'x' })), [null], [{ type: 'text', content: '  ' }], [{ type: 'text', content: 'x'.repeat(2401) }], [{ type: 'text', content: '{{bad}}' }], [{ type: 'text', content: '{{name' }], [{ type: 'image', content: 'data:image/png;base64,test' }], [{ type: 'link', content: 'https://' }], [{ type: 'link', content: 'https://user:pass@example.com' }], [{ type: 'link', content: 'https://example.com/a\nb' }]]) {
    assert.throws(() => previewTask(initialState(), config({ messages: value })), /消息|序列|变量|链接|网址/);
  }
  for (const extra of [{ template: 'legacy' }, { productLink: 'https://example.com' }, { template: undefined }, { productLink: undefined }]) assert.throws(() => previewTask(initialState(), config(extra)), /混用|同时|旧/);
  for (const taskName of [null, 123, 'a'.repeat(81)]) assert.throws(() => previewTask(initialState(), config({ taskName })), /任务名称/);
  const legacy = { ...config(), template: '旧 {{name}}' }; delete legacy.messages;
  assert.equal(previewTask(initialState(), legacy).items[0].messages, undefined);
  assert.deepEqual(previewTask(initialState(), { ...legacy, productLink: 'https://example.com' }).items[0].messages, ['旧 Ana', 'https://example.com']);
  assert.equal(previewTask(initialState(), legacy).items[0].messageTypes, undefined);
});

test('10条消息逐条单次授权，索引错位或迟到结果不推进，仅全部完成后计算逐人间隔', () => {
  const all = Array.from({ length: 10 }, (_, index) => ({ type: index % 2 ? 'link' : 'text', content: index % 2 ? `https://example.com/${index}` : `${index} {{name}}` }));
  let state = prepare(start({ messages: all }));
  for (let index = 0; index < 10; index++) {
    assert.equal(state.task.items[0].messageIndex, index);
    assert.equal(step(state, { type: 'authorize', ...identity(state), messageIndex: index + 1 }).command, null);
    state = step(state, { type: 'authorize', ...identity(state) }).state;
    assert.equal(step(state, { type: 'authorize', ...identity(state) }).command, null);
    const before = structuredClone(state);
    assert.deepEqual(step(state, { type: 'result', ...identity(state), messageIndex: index + 1, outcome: 'sent' }).state, before);
    state = step(state, { type: 'result', ...identity(state), outcome: 'sent' }, 2000 + index).state;
    assert.equal(state.task.items[0].submittedCount, index + 1);
    if (index < 9) {
      assert.equal(state.task.status, 'running');
      assert.equal(state.history.shop.a.status, 'uncertain');
      assert.equal(state.task.nextAt, 2000 + index);
      state = step(state, { type: 'poll', ...identity(state) }, 2000 + index).state;
    }
  }
  assert.equal(state.task.status, 'completed');
  assert.equal(state.task.items[0].status, 'sent');
  assert.equal(state.task.nextAt, 12009);
  assert.equal(state.history.shop.a.status, 'confirmed');
});

test('中间条不明只人工确认这一条，保持暂停且恢复仅处理余下内容', () => {
  let state = submit(prepare(start()));
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  const stale = identity(state);
  state = step(state, { type: 'interrupt', reason: '连接中断' }).state;
  assert.equal(state.task.items[0].status, 'uncertain');
  state = step(state, resolution(state)).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].status, 'pending');
  assert.equal(state.task.items[0].submittedCount, 2);
  assert.equal(state.task.items[0].messageIndex, 2);
  assert.equal(state.task.items[0].authorized, false);
  assert.equal(state.history.shop.a.status, 'uncertain');
  assert.equal(state.history.shop.a.submittedCount, 2);
  // 防重发记录带 updatedAt，必须用同一注入时钟；默认 Date.now() 会把测试时钟
  // 写入的记录当成已过 30 天窗口。
  assert.equal(previewTask(state, config(), { now: 1000 }).sendableCount, 0);
  assert.equal(step(state, { type: 'poll', ...stale }).command, null);
  state = step(state, { type: 'resume', binding }).state;
  const next = step(state, { type: 'poll', ...identity(state) });
  assert.equal(next.command.text, '下一条 Ana');
  assert.equal(next.command.messageIndex, 2);
  state = step(next.state, { type: 'prepared', ...identity(next.state), ok: true }).state;
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = submit(state);
  assert.equal(state.task.items[0].submittedCount, 3);
  assert.equal(state.task.items[0].status, 'sent');
});

test('第1条暂停前未授权不产生提交记录，已提交前缀跨重连保留，演练序列不污染历史', () => {
  let state = prepare(start());
  state = step(state, { type: 'pause' }).state;
  assert.equal(state.task.items[0].submittedCount, 0);
  assert.equal(state.history.shop?.a, undefined);
  state = step(state, { type: 'resume', binding }).state;
  state = submit(prepare(state));
  state = step(state, { type: 'interrupt' }).state;
  state = JSON.parse(JSON.stringify(state));
  state = step(state, { type: 'resume', binding }).state;
  assert.equal(step(state, { type: 'poll', ...identity(state) }).command.text, 'https://example.com/product');
  let dry = prepare(start({ mode: 'dry-run' }));
  for (let index = 0; index < 3; index++) {
    dry = submit(dry);
    if (index < 2) dry = step(dry, { type: 'poll', ...identity(dry) }).state;
  }
  assert.equal(dry.task.status, 'completed');
  assert.equal(dry.task.items[0].status, 'rehearsed');
  assert.equal(dry.task.items[0].submittedCount, 0);
  assert.deepEqual(dry.history, {});
});

test('旧双消息的首条不明同样只确认当前条，末条确认才变为已提交', () => {
  const legacy = { ...config(), template: 'Hi {{name}}', productLink: 'https://example.com' }; delete legacy.messages;
  let state = prepare(step(initialState(), { type: 'start', config: legacy, binding }).state);
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  state = step(state, { type: 'result', ...identity(state), outcome: 'uncertain' }).state;
  state = step(state, resolution(state)).state;
  assert.equal(state.task.items[0].submittedCount, 1);
  assert.equal(state.task.items[0].status, 'pending');
  state = step(state, { type: 'resume', binding }).state;
  state = prepare(state);
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  state = step(state, { type: 'result', ...identity(state), outcome: 'uncertain' }).state;
  state = step(state, resolution(state)).state;
  assert.equal(state.task.items[0].submittedCount, 2);
  assert.equal(state.task.items[0].status, 'sent');
  assert.equal(state.history.shop.a.status, 'confirmed');
  assert.equal(step(state, { type: 'resume', binding }).state.task.status, 'completed');
});

test('模板新旧结构兼容，序列更新和复制保持内容顺序与版本，读取不迁移旧值', () => {
  const legacy = createMessageTemplate(emptyMessageTemplates(), { name: '旧模板', template: '旧 {{name}}', productLink: 'https://example.com' }, { id: 'old', now: 1000 });
  const original = structuredClone(legacy);
  const store = createMessageTemplate(legacy, { name: '新模板', messages: messages() }, { id: 'new', now: 2000 });
  assert.deepEqual(legacy, original);
  assert.deepEqual(readMessageTemplates(legacy), original);
  const record = listMessageTemplates(store).templates.find(item => item.id === 'new');
  assert.deepEqual(record.messages.map(item => item.type), ['text', 'link', 'text']);
  assert.equal(Object.hasOwn(record, 'template'), false);
  const updated = updateMessageTemplate(store, { templateId: 'new', expectedRevision: 1, draft: { name: '新模板', messages: [messages()[2], messages()[0]] } }, { now: 3000 });
  const copied = copyMessageTemplate(updated, { templateId: 'new', expectedRevision: 2 }, { id: 'copy', now: 4000 });
  assert.deepEqual(copied.templates.find(item => item.id === 'copy').messages, [{ type: 'text', content: '下一条 {{name}}' }, { type: 'text', content: 'Hi {{name}}' }]);
  assert.equal(copied.templates.find(item => item.id === 'copy').revision, 1);
  const migrated = updateMessageTemplate(legacy, { templateId: 'old', expectedRevision: 1, draft: { name: '旧模板', messages: messages() } }, { now: 2000 });
  assert.equal(Object.hasOwn(migrated.templates[0], 'template'), false);
  record.messages[0].content = '外部篡改';
  assert.equal(store.templates[1].messages[0].content, 'Hi {{name}}');
  for (const draft of [{ name: '混合', messages: messages(), template: '旧', productLink: 'https://example.com' }, { name: '图片', messages: [{ type: 'image', content: 'x' }] }]) assert.throws(() => createMessageTemplate(store, draft, { id: 'bad', now: 4000 }), /消息|混用|同时|旧/);
});

test('序列任务历史保留任务名及原消息类型顺序，兼容归档副本并按名称检索', () => {
  let state = prepare(start({ taskName: '  活动甲  ' }));
  for (let index = 0; index < 3; index++) {
    state = submit(state);
    if (index < 2) state = step(state, { type: 'poll', ...identity(state) }).state;
  }
  const archived = archiveTask(emptyTaskHistory(), state.task);
  const detail = getTaskHistoryDetail(archived, null, state.task.id);
  assert.equal(detail.config.taskName, '活动甲');
  assert.deepEqual(detail.config.messages, state.task.config.messages);
  assert.deepEqual(detail.items[0].messageTypes, ['text', 'link', 'text']);
  assert.equal(detail.items[0].messageCount, 3);
  assert.equal(detail.items[0].submittedCount, 3);
  assert.equal(Object.hasOwn(detail.config, 'template'), false);
  assert.equal(JSON.stringify(detail).includes('messageIndex'), false);
  assert.deepEqual(readTaskHistory(archived), archived);
  assert.equal(listTaskHistory(archived, null, { query: '活动甲' }).total, 1);
  assert.equal(listTaskHistory(archived, null).tasks[0].taskName, '活动甲');
  assert.deepEqual(exportTaskHistory(archived, null).tasks[0].config.messages, state.task.config.messages);
  detail.config.messages[0].content = '副本变化';
  assert.equal(archived.tasks[0].config.messages[0].content, 'Hi {{name}}');
});

test('名单来源归一化后跟随任务和历史，原来源对象不能改动已锁定配置', () => {
  const source = { type: 'specified', creatorIds: ['20', '21', '20'], nameIncludes: ' Ana ', nameExcludes: '' };
  const state = start({ source });
  assert.deepEqual(state.task.config.source, { type: 'specified', creatorIds: ['20', '21'], nameIncludes: 'Ana', nameExcludes: '' });
  source.creatorIds.push('22');
  assert.equal(state.task.config.source.creatorIds.length, 2);
  const detail = getTaskHistoryDetail(emptyTaskHistory(), state.task, state.task.id);
  assert.deepEqual(detail.config.source, state.task.config.source);
  detail.config.source.creatorIds.push('23');
  assert.equal(state.task.config.source.creatorIds.length, 2);
  assert.equal(start().task.config.source.type, 'marketplace');
  assert.throws(() => start({ source: { type: 'other' } }), /来源/);
});

test('人工确认最后一条后才开始逐人间隔，首条不明确认不等待逐人间隔', () => {
  let state = prepare(start({ creators: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Budi' }], limit: 2, messages: [{ type: 'text', content: '一' }, { type: 'text', content: '二' }] }));
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  state = step(state, { type: 'result', ...identity(state), outcome: 'uncertain' }).state;
  state = step(state, resolution(state), 2000).state;
  state = step(state, { type: 'resume', binding }, 2000).state;
  state = step(state, { type: 'poll', ...identity(state) }, 2000).state;
  assert.equal(state.task.items[0].status, 'preparing');
  state = step(state, { type: 'prepared', ...identity(state), ok: true }, 2000).state;
  state = step(state, { type: 'poll', ...identity(state) }, 2000).state;
  state = step(state, { type: 'authorize', ...identity(state) }, 2000).state;
  state = step(state, { type: 'result', ...identity(state), outcome: 'uncertain' }, 2000).state;
  state = step(state, resolution(state), 3000).state;
  assert.equal(state.task.nextAt, 13000);
  state = step(state, { type: 'resume', binding }, 3000).state;
  assert.equal(step(state, { type: 'poll', ...identity(state) }, 12999).command, null);
  assert.equal(step(state, { type: 'poll', ...identity(state) }, 13000).command.itemId, 'b');
});

test('新模板或历史的空洞数组与消息类型计数不符均视为坏数据，不修改原值', () => {
  const malformed = { version: 1, templates: new Array(1) };
  assert.throws(() => readMessageTemplates(malformed), /损坏|不兼容/);
  assert.equal(0 in malformed.templates, false);
  const state = start();
  for (const extra of [{ messageTypes: new Array(3) }, { messageTypes: ['text', 'text', 'text'] }, { messageCount: 2 }]) {
    const task = structuredClone(state.task);
    Object.assign(task.items[0], extra);
    assert.throws(() => getTaskHistoryDetail(emptyTaskHistory(), task, task.id), /损坏|不兼容/);
  }
});

test('旧窗口首条人工确认不能推进后来不明的下一条，确认和跳过均须匹配任务会话与索引', () => {
  let state = prepare(start());
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  state = step(state, { type: 'result', ...identity(state), outcome: 'uncertain' }).state;
  const first = resolution(state);
  state = step(state, first).state;
  state = step(state, { type: 'resume', binding }).state;
  state = prepare(state);
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  state = step(state, { type: 'result', ...identity(state), outcome: 'uncertain' }).state;
  const current = resolution(state), before = structuredClone(state);
  for (const proof of [first, { ...current, messageIndex: 0 }, { ...current, messageIndex: undefined }, { ...current, taskId: undefined }, { ...current, taskId: 'other' }, { ...current, sessionId: undefined }, { ...current, sessionId: null }]) {
    for (const decision of ['sent', 'skip']) assert.throws(() => step(state, { ...proof, resolution: decision }), /过期|变化|刷新/);
    assert.deepEqual(state, before);
  }
  state = step(state, current).state;
  assert.equal(state.task.items[0].submittedCount, 2);
  assert.equal(state.task.items[0].messageIndex, 2);
  assert.equal(state.task.items[0].status, 'pending');
});

test('执行中断后的null会话也要精确确认，不能沿用中断前会话或省略会话', () => {
  let state = prepare(start());
  state = step(state, { type: 'authorize', ...identity(state) }).state;
  const oldProof = resolution(state);
  state = step(state, { type: 'interrupt', reason: '断开' }).state;
  assert.equal(state.task.sessionId, null);
  assert.throws(() => step(state, oldProof), /过期|变化|刷新/);
  const proof = resolution(state);
  delete proof.sessionId;
  assert.throws(() => step(state, proof), /过期|变化|刷新/);
  state = step(state, resolution(state)).state;
  assert.equal(state.task.items[0].submittedCount, 1);
  assert.equal(state.task.items[0].messageIndex, 1);
});
