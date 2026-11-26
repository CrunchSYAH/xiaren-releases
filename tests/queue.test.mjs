import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../extension/core/queue.mjs');
const { initialState, previewTask, reduceQueue } = api;
const binding = { tabId: 3, pageId: 'page-1' };
const config = (extra = {}) => ({ shop: { id: 'shop-1', name: '店铺' }, creators: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Budi' }], template: 'Hi {{name}}', intervalSeconds: 10, limit: 10, mode: 'send', ...extra });
let sequence = 0;
function step(state, event, now = 1000) {
  return reduceQueue(state, event, { now, uid: () => `id-${++sequence}` });
}
function start(extra = {}, state = initialState()) {
  return step(state, { type: 'start', config: config(extra), binding }).state;
}
function identity(state, extra = {}) {
  return { ...state.task.binding, shopId: state.task.config.shop.id, sessionId: state.task.sessionId, ...extra };
}
function sendReady(state) {
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: true, ...(state.task.items[0].messages ? { messageIndex: state.task.items[0].messageIndex } : {}) }).state;
  return step(state, { type: 'poll', ...identity(state) });
}
function authorize(state) {
  return step(state, { type: 'authorize', ...identity(state), itemId: 'a' });
}
function result(state, outcome = 'sent', now = 2000) {
  return step(state, { type: 'result', ...identity(state), itemId: 'a', outcome }, now);
}
function resolution(state, decision = 'sent') {
  const item = state.task.items[0];
  return { type: 'resolve', taskId: state.task.id, sessionId: state.task.sessionId, itemId: item.id, resolution: decision, ...(item.messages ? { messageIndex: item.messageIndex } : {}) };
}

test('exports the pure queue API', () => {
  for (const key of ['initialState', 'previewTask', 'reduceQueue']) assert.equal(typeof api[key], 'function', `缺少 ${key}`);
});

test('双消息按话术、链接顺序逐条授权，两条完成才记为已提交并计算逐人间隔', () => {
  let state = start({ productLink: 'https://shopee.co.id/product/1/2' });
  let ready = sendReady(state);
  assert.equal(ready.command.messageIndex, 0);
  state = step(ready.state, { type: 'authorize', ...identity(ready.state), itemId: 'a', messageIndex: 0 }).state;
  state = step(state, { type: 'result', ...identity(state), itemId: 'a', messageIndex: 0, outcome: 'sent' }, 2000).state;
  assert.equal(state.task.items[0].status, 'prepared');
  assert.equal(state.task.items[0].submittedCount, 1);
  assert.equal(state.history['shop-1'].a.status, 'uncertain');
  ready = step(state, { type: 'poll', ...identity(state) }, 2000);
  assert.equal(ready.command.text, 'https://shopee.co.id/product/1/2');
  assert.equal(ready.command.messageIndex, 1);
  state = ready.state;
  assert.equal(step(state, { type: 'authorize', ...identity(state), itemId: 'a', messageIndex: 0 }).command, null);
  state = step(state, { type: 'authorize', ...identity(state), itemId: 'a', messageIndex: 1 }).state;
  state = step(state, { type: 'result', ...identity(state), itemId: 'a', messageIndex: 1, outcome: 'sent' }, 3000).state;
  assert.equal(state.task.items[0].status, 'sent');
  assert.equal(state.task.items[0].submittedCount, 2);
  assert.equal(state.history['shop-1'].a.status, 'confirmed');
  assert.equal(state.task.nextAt, 13000);
});

test('话术已提交后暂停、重连，只继续链接且保留防重发历史', () => {
  let state = sendReady(start({ productLink: 'https://shopee.co.id/product/1/2' })).state;
  state = step(state, { type: 'authorize', ...identity(state), itemId: 'a', messageIndex: 0 }).state;
  state = step(state, { type: 'result', ...identity(state), itemId: 'a', messageIndex: 0, outcome: 'sent' }).state;
  state = step(state, { type: 'interrupt' }).state;
  state = step(state, { type: 'resume', binding }).state;
  const preparation = step(state, { type: 'poll', ...identity(state) });
  assert.equal(preparation.command?.text, 'https://shopee.co.id/product/1/2');
  assert.equal(preparation.command?.messageIndex, 1);
  state = step(preparation.state, { type: 'prepared', ...identity(preparation.state), itemId: 'a', messageIndex: 1, ok: true }).state;
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'pause' }).state;
  assert.equal(state.history['shop-1'].a.status, 'uncertain');
  assert.equal(state.task.items[0].submittedCount, 1);
});

test('产品链接拒绝空值、非网址、多行及凭证，不改变旧任务的单消息配置', () => {
  for (const productLink of ['', '  ', null, 123, 'javascript:alert(1)', 'https://a.com\nhttps://b.com', 'https://user:pass@shopee.co.id/p', 'https://']) {
    assert.throws(() => previewTask(initialState(), config({ productLink })), /产品链接/);
  }
  assert.equal(previewTask(initialState(), config()).items[0].text, 'Hi Ana');
});

test('initial state is fresh and serializable', () => {
  assert.deepEqual(initialState(), { version: 1, task: null, history: {}, denied: {} });
  assert.notEqual(initialState().history, initialState().history);
});

test('validates template, identities, limits and storage bounds with Chinese errors', () => {
  const invalid = [
    { template: '{{unknown}}' }, { template: '  ' }, { template: 'x'.repeat(2001) },
    { template: '{{name' }, { creators: [] }, { creators: [{ id: 'a', name: ' ' }] },
    { creators: [{ id: '', name: 'A' }] }, { shop: { id: '', name: '店' } },
    { shop: { id: 's', name: '' } }, { intervalSeconds: 0 }, { intervalSeconds: Infinity },
    { intervalSeconds: '2' }, { limit: 0 }, { limit: 1.5 }, { mode: 'other' },
    { creators: Array.from({ length: 201 }, (_, i) => ({ id: `${i}`, name: 'A' })) },
  ];
  for (const extra of invalid) assert.throws(() => previewTask(initialState(), config(extra)), /[\u4e00-\u9fff]/);
});

test('preview renders names literally, deduplicates and applies limit', () => {
  const preview = previewTask(initialState(), config({ creators: [{ id: 'a', name: '$&' }, { id: 'a', name: 'dup' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], limit: 2 }));
  assert.equal(preview.sendableCount, 2);
  assert.equal(preview.skippedCount, 2);
  assert.equal(preview.items[0].text, 'Hi $&');
  assert.equal(preview.items.filter(item => item.status === 'pending').length, 2);
});

test('deny is shop isolated and safe for prototype property keys', () => {
  let state = step(initialState(), { type: 'deny', shopId: '__proto__', creatorId: 'constructor', name: 'A', blocked: true }).state;
  const special = config({ shop: { id: '__proto__', name: '店' }, creators: [{ id: 'constructor', name: 'A' }] });
  assert.equal(previewTask(state, special).sendableCount, 0);
  assert.equal(previewTask(state, config()).sendableCount, 2);
  state = step(state, { type: 'deny', shopId: '__proto__', creatorId: 'constructor', blocked: false }).state;
  assert.equal(previewTask(state, special).sendableCount, 1);
  assert.equal({}.polluted, undefined);
});

test('only one unfinished task may run and all-skipped tasks cannot start', () => {
  const state = start();
  assert.throws(() => start({}, state), /[\u4e00-\u9fff]/);
  const paused = step(state, { type: 'pause' }).state;
  assert.throws(() => start({}, paused), /[\u4e00-\u9fff]/);
  let denied = step(initialState(), { type: 'deny', shopId: 'shop-1', creatorId: 'a', blocked: true }).state;
  assert.throws(() => start({ creators: [{ id: 'a', name: 'A' }] }, denied), /[\u4e00-\u9fff]/);
});

test('poll matches full identity and dispatches each stage once', () => {
  let state = start();
  for (const extra of [{ tabId: 4 }, { pageId: 'other' }, { shopId: 'other' }, { sessionId: 'old' }]) {
    assert.equal(step(state, { type: 'poll', ...identity(state, extra) }).command, null);
  }
  const preparation = step(state, { type: 'poll', ...identity(state) });
  assert.deepEqual(preparation.command, { type: 'prepare', taskId: state.task.id, sessionId: state.task.sessionId, itemId: 'a', creator: { id: 'a', name: 'Ana' }, text: 'Hi Ana', mode: 'send' });
  state = preparation.state;
  assert.equal(step(state, { type: 'poll', ...identity(state) }).command, null);
  assert.equal(step(state, { type: 'prepared', ...identity(state, { sessionId: 'old' }), itemId: 'a', ok: true }).state.task.items[0].status, 'preparing');
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: true }).state;
  const sending = step(state, { type: 'poll', ...identity(state) });
  assert.equal(sending.command.type, 'send');
  assert.equal(sending.state.history['shop-1'].a.status, 'uncertain');
  assert.equal(step(sending.state, { type: 'poll', ...identity(state) }).command, null);
});

test('authorization is single use and results require authorization', () => {
  let state = sendReady(start()).state;
  assert.equal(result(state).state.task.items[0].status, 'sending');
  assert.equal(step(state, { type: 'authorize', ...identity(state), itemId: 'b' }).command, null);
  const permit = authorize(state);
  assert.deepEqual(permit.command, { type: 'permit', taskId: state.task.id, sessionId: state.task.sessionId, itemId: 'a', mode: 'send' });
  state = permit.state;
  assert.equal(authorize(state).command, null);
  state = result(state).state;
  assert.equal(state.history['shop-1'].a.status, 'confirmed');
  assert.equal(result(state, 'uncertain').state.task.items[0].status, 'sent');
});

test('interval is measured from result and never catches up', () => {
  const state = result(authorize(sendReady(start()).state).state, 'sent', 50000).state;
  assert.equal(state.task.nextAt, 60000);
  assert.equal(step(state, { type: 'poll', ...identity(state) }, 59999).command, null);
  assert.equal(step(state, { type: 'poll', ...identity(state) }, 100000).command.itemId, 'b');
});

test('pause during preparation waits and then cancels without sending', () => {
  let state = start();
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'pause', reason: '检查' }).state;
  assert.equal(state.task.status, 'pausing');
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: true }).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].status, 'pending');
  assert.equal(step(state, { type: 'poll', ...identity(state) }).command, null);
});

test('pause before authorization clears intent and cancels permit', () => {
  let state = sendReady(start()).state;
  state = step(state, { type: 'pause' }).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].status, 'pending');
  assert.equal(Object.hasOwn(state.history['shop-1'], 'a'), false);
  assert.equal(authorize(state).command, null);
});

test('stop after authorization waits for result and takes precedence', () => {
  let state = authorize(sendReady(start()).state).state;
  state = step(state, { type: 'stop' }).state;
  assert.equal(state.task.status, 'stopping');
  assert.equal(authorize(state).command, null);
  state = result(state).state;
  assert.equal(state.task.status, 'stopped');
  assert.equal(state.task.items[0].status, 'sent');
});

test('interrupt after authorization preserves uncertain and invalidates old session', () => {
  let state = authorize(sendReady(start()).state).state;
  const oldIdentity = identity(state);
  state = step(state, { type: 'interrupt', reason: '页面替换' }).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].status, 'uncertain');
  assert.equal(step(state, { type: 'result', ...oldIdentity, itemId: 'a', outcome: 'sent' }).state.task.items[0].status, 'uncertain');
  assert.throws(() => step(state, { type: 'resume', binding }), /[\u4e00-\u9fff]/);
  state = step(state, resolution(state, 'skip')).state;
  assert.equal(state.history['shop-1'].a.status, 'uncertain');
  state = step(state, { type: 'resume', binding: { tabId: 4, pageId: 'new' } }).state;
  assert.notEqual(state.task.sessionId, oldIdentity.sessionId);
  assert.equal(step(state, { type: 'poll', ...identity(state) }).command.itemId, 'b');
});

test('interrupt before authorization safely returns item to pending', () => {
  for (const stage of ['preparing', 'prepared', 'sending']) {
    let state = start();
    state = step(state, { type: 'poll', ...identity(state) }).state;
    if (stage !== 'preparing') state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: true }).state;
    if (stage === 'sending') state = step(state, { type: 'poll', ...identity(state) }).state;
    state = step(state, { type: 'interrupt', reason: '关闭' }).state;
    assert.equal(state.task.items[0].status, 'pending');
    assert.equal(state.history['shop-1']?.a, undefined);
  }
});

test('prepare failure pauses and resume skips failed items', () => {
  let state = start();
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: false, reason: '找不到输入框' }).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.items[0].status, 'failed');
  state = step(state, { type: 'resume', binding }).state;
  assert.equal(state.task.items[0].status, 'skipped');
  assert.equal(step(state, { type: 'poll', ...identity(state) }).command.itemId, 'b');
});

test('failed sending pauses conservatively and wrong outcome becomes uncertain', () => {
  for (const outcome of ['failed', 'uncertain', 'rehearsed', 'nonsense']) {
    const state = result(authorize(sendReady(start()).state).state, outcome).state;
    assert.equal(state.task.status, 'paused');
    assert.equal(state.history['shop-1'].a.status, 'uncertain');
    assert.equal(state.task.items[0].status, outcome === 'failed' ? 'failed' : 'uncertain');
  }
});

test('dry run rehearses without polluting real history and rejects sent outcome', () => {
  let state = authorize(sendReady(start({ mode: 'dry-run', creators: [{ id: 'a', name: 'Ana' }] })).state).state;
  assert.deepEqual(state.history, {});
  state = result(state, 'rehearsed').state;
  assert.equal(state.task.status, 'completed');
  assert.deepEqual(state.history, {});
  assert.equal(previewTask(state, config()).sendableCount, 2);
  const wrong = result(authorize(sendReady(start({ mode: 'dry-run' })).state).state, 'sent').state;
  assert.equal(wrong.task.items[0].status, 'uncertain');
});

test('sent and uncertain history block all modes but isolate shops', () => {
  let state = result(authorize(sendReady(start({ creators: [{ id: 'a', name: 'Ana' }] })).state).state).state;
  assert.equal(state.task.status, 'completed');
  // 30 天窗口内（记录 updatedAt 为 2000）仍然阻断。
  assert.equal(previewTask(state, config(), { now: 10_000 }).sendableCount, 1);
  assert.equal(previewTask(state, config({ mode: 'dry-run' }), { now: 10_000 }).sendableCount, 1);
  assert.equal(previewTask(state, config({ shop: { id: 'shop-2', name: '店2' } }), { now: 10_000 }).sendableCount, 2);
  state = start({}, state);
  assert.equal(step(state, { type: 'poll', ...identity(state) }).command.itemId, 'b');
});

test('deny during a task skips pending work before dispatch', () => {
  let state = start();
  state = step(state, { type: 'deny', shopId: 'shop-1', creatorId: 'a', blocked: true }).state;
  const next = step(state, { type: 'poll', ...identity(state) });
  assert.equal(next.state.task.items[0].status, 'skipped');
  assert.equal(next.command.itemId, 'b');
});

test('manual sent resolution confirms history and completed resume stays completed', () => {
  let state = authorize(sendReady(start({ creators: [{ id: 'a', name: 'Ana' }] })).state).state;
  state = step(state, { type: 'interrupt', reason: '断开' }).state;
  state = step(state, resolution(state)).state;
  assert.equal(state.history['shop-1'].a.status, 'confirmed');
  assert.equal(step(state, { type: 'resume', binding }).state.task.status, 'completed');
});

test('reducer and preview never mutate input or retain config references', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const source = config();
  let state = step(freeze(initialState()), { type: 'start', config: source, binding }).state;
  source.creators[0].name = 'changed';
  assert.equal(state.task.config.creators[0].name, 'Ana');
  previewTask(freeze(state), config());
  state = step(freeze(state), { type: 'poll', ...identity(state) }).state;
  assert.equal(state.task.items[0].status, 'preparing');
});

test('special history keys survive persisted round trips and still deduplicate', () => {
  let state = start({ shop: { id: '__proto__', name: '店' }, creators: [{ id: 'constructor', name: 'A' }] });
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'constructor', ok: true }).state;
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'authorize', ...identity(state), itemId: 'constructor' }).state;
  state = step(state, { type: 'result', ...identity(state), itemId: 'constructor', outcome: 'sent' }).state;
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.history.__proto__.constructor.status, 'confirmed');
  assert.equal(previewTask(state, config({ shop: { id: '__proto__', name: '店' }, creators: [{ id: 'constructor', name: 'A' }] }), { now: 10_000 }).sendableCount, 0);
  assert.equal(Object.getPrototypeOf(state.history), Object.prototype);
});

test('manual skip keeps uncertain history across subsequent tasks and modes', () => {
  let state = authorize(sendReady(start({ creators: [{ id: 'a', name: 'Ana' }] })).state).state;
  state = step(state, { type: 'interrupt', reason: '断开' }).state;
  state = step(state, resolution(state, 'skip')).state;
  state = step(state, { type: 'resume', binding }).state;
  for (const mode of ['send', 'dry-run']) assert.equal(previewTask(state, config({ mode }), { now: 10_000 }).items[0].status, 'skipped');
  assert.equal(start({}, state).task.items[0].status, 'skipped');
});

test('stop during preparation and pause after prepared both safely return pending', () => {
  let state = start();
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'stop' }).state;
  state = step(state, { type: 'pause' }).state;
  assert.equal(state.task.status, 'stopping');
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: false }).state;
  assert.equal(state.task.status, 'stopped');
  assert.equal(state.task.items[0].status, 'pending');
  state = step(state, { type: 'resume', binding }).state;
  state = step(state, { type: 'poll', ...identity(state) }).state;
  state = step(state, { type: 'prepared', ...identity(state), itemId: 'a', ok: true }).state;
  state = step(state, { type: 'pause' }).state;
  assert.equal(state.task.items[0].status, 'pending');
  assert.deepEqual(state.history, {});
});

test('a pause request wins over completion for an authorized final item', () => {
  let state = authorize(sendReady(start({ creators: [{ id: 'a', name: 'Ana' }] })).state).state;
  state = step(state, { type: 'pause', reason: '检查' }).state;
  assert.equal(state.task.status, 'pausing');
  state = result(state).state;
  assert.equal(state.task.status, 'paused');
  assert.equal(state.task.reason, '检查');
  assert.equal(step(state, { type: 'resume', binding }).state.task.status, 'completed');
});

test('all newly denied pending items finish without producing a command', () => {
  let state = start();
  for (const creatorId of ['a', 'b']) state = step(state, { type: 'deny', shopId: 'shop-1', creatorId, blocked: true }).state;
  const outcome = step(state, { type: 'poll', ...identity(state) });
  assert.equal(outcome.command, null);
  assert.equal(outcome.state.task.status, 'completed');
});

test('legacy single-message resolution requires exact task and session identity across tasks', () => {
  let state = authorize(sendReady(start({ mode: 'dry-run', creators: [{ id: 'a', name: 'Ana' }] })).state).state;
  state = step(state, { type: 'interrupt' }).state;
  const oldProof = resolution(state);
  assert.throws(() => step(initialState(), oldProof), /过期|变化|刷新/);
  state = step(state, oldProof).state;
  state = step(state, { type: 'resume', binding }).state;
  state = start({ mode: 'dry-run', creators: [{ id: 'a', name: 'Ana' }] }, state);
  state = authorize(sendReady(state).state).state;
  state = step(state, { type: 'interrupt' }).state;
  const before = structuredClone(state), current = resolution(state);
  for (const proof of [oldProof, { ...current, taskId: undefined }, { ...current, sessionId: undefined }, { ...current, sessionId: 'old-session' }]) {
    assert.throws(() => step(state, proof), /过期|变化|刷新/);
    assert.deepEqual(state, before);
  }
  state = step(state, current).state;
  assert.equal(state.task.items[0].status, 'rehearsed');
});

test('发送间隔须为不小于1秒的有限数，工作台与队列同一口径', () => {
  assert.throws(() => previewTask(initialState(), config({ intervalSeconds: 0.5 })), /不小于1秒/);
  assert.throws(() => previewTask(initialState(), config({ intervalSeconds: 0 })), /不小于1秒/);
  assert.equal(previewTask(initialState(), config({ intervalSeconds: 1 })).sendableCount, 2);
});
