import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../extension/core/task-history.mjs');
const { emptyTaskHistory, readTaskHistory, archiveTask, listTaskHistory, getTaskHistoryDetail, exportTaskHistory } = api;
const task = (id = 'old', extra = {}) => ({
  id, sessionId: 'do-not-archive-session', binding: { tabId: 7, pageId: 'do-not-archive-page' },
  createdAt: new Date(2026, 9, 19, 10).getTime(), updatedAt: new Date(2026, 9, 19, 11).getTime(), status: 'completed', reason: null,
  config: { shop: { id: 'shop-1', name: '第一店铺' }, template: 'Halo {{name}} <script>', productLink: 'https://shopee.co.id/product/1/2', intervalSeconds: 30, limit: 1, targetCount: 1, mode: 'send', collectionId: 'private-binding' },
  items: [{ id: '__proto__', name: 'A <img>', text: 'duplicated message', messages: ['duplicated message', 'duplicated link'], messageIndex: 1, status: 'sent', submittedCount: 2, authorized: true, reason: '已提交' }],
  ...extra,
});

test('旧数据没有归档键时可读取当前任务，返回副本且不伪造时间', () => {
  const history = readTaskHistory(undefined);
  assert.deepEqual(history, { version: 1, tasks: [] });
  const current = task('legacy', { createdAt: undefined, updatedAt: undefined });
  const detail = getTaskHistoryDetail(history, current, 'legacy');
  assert.equal(detail.createdAt, null);
  assert.equal(detail.updatedAt, null);
  detail.config.shop.name = 'changed';
  assert.equal(current.config.shop.name, '第一店铺');
  assert.equal(listTaskHistory(history, current).total, 1);
});

test('结束任务归档精确保留配置、结果与提交进度，剔除运行权限和重复正文', () => {
  const original = task();
  const history = archiveTask(emptyTaskHistory(), original);
  const detail = getTaskHistoryDetail(history, null, 'old');
  assert.equal(detail.config.template, 'Halo {{name}} <script>');
  assert.equal(detail.config.productLink, original.config.productLink);
  assert.deepEqual(detail.items, [{ id: '__proto__', name: 'A <img>', status: 'sent', reason: '已提交', submittedCount: 2, messageCount: 2 }]);
  for (const key of ['binding', 'sessionId', 'collectionId', 'authorized', 'messageIndex', 'duplicated message']) assert.equal(JSON.stringify(detail).includes(key), false, key);
  assert.equal(original.items[0].authorized, true);
  assert.equal(original.config.collectionId, 'private-binding');
  const summary = listTaskHistory(history, null).tasks[0];
  assert.equal(summary.counts.sent, 1);
  assert.equal(summary.submittedMessages, 2);
  assert.equal(summary.total, 1);
});

test('旧网页名称搜索来源只读保留，历史查询和归档不改写原记录', () => {
  const source = { type: 'marketplace', creatorIds: [], nameIncludes: '', nameExcludes: '', webFilters: { category: '100630', channel: '102', search: 'Ayu' } };
  const saved = archiveTask(emptyTaskHistory(), task('legacy-search'));
  saved.tasks[0].config.source = structuredClone(source);
  const current = task('current-search', { status: 'paused', config: { ...task().config, source: structuredClone(source) } });
  const completed = task('new-search', { config: { ...task().config, source: structuredClone(source) } });
  const before = structuredClone({ saved, current, completed });

  const read = readTaskHistory(saved);
  assert.deepEqual(read.tasks[0].config.source, source);
  assert.deepEqual(listTaskHistory(saved, current).tasks.map(row => row.id).sort(), ['current-search', 'legacy-search']);
  const detail = getTaskHistoryDetail(saved, current, 'legacy-search');
  assert.deepEqual(detail.config.source, source);
  assert.deepEqual(getTaskHistoryDetail(saved, current, 'current-search').config.source, source);
  const exported = exportTaskHistory(saved, current, {}, 1234);
  assert.equal(exported.tasks.length, 2);
  for (const row of exported.tasks) assert.deepEqual(row.config.source, source);
  const archived = archiveTask(saved, completed);
  assert.deepEqual(archived.tasks.map(row => row.id), ['new-search', 'legacy-search']);
  for (const row of archived.tasks) assert.deepEqual(row.config.source, source);

  read.tasks[0].config.source.webFilters.search = 'changed read';
  detail.config.source.webFilters.search = 'changed detail';
  for (const row of exported.tasks) row.config.source.webFilters.search = 'changed export';
  for (const row of archived.tasks) row.config.source.webFilters.search = 'changed archive';
  assert.deepEqual({ saved, current, completed }, before);
});

test('当前任务按ID覆盖归档，重启重复归档不增加记录，排序与店铺选项稳定', () => {
  let history = archiveTask(emptyTaskHistory(), task());
  history = archiveTask(history, task());
  assert.equal(history.tasks.length, 1);
  const current = task('new', { status: 'paused', createdAt: new Date(2026, 9, 20).getTime(), config: { ...task().config, shop: { id: 'shop-2', name: '第二店铺' }, mode: 'dry-run' } });
  const list = listTaskHistory(history, current);
  assert.deepEqual(list.tasks.map(row => row.id), ['new', 'old']);
  assert.deepEqual(list.shops.map(shop => shop.id), ['shop-2', 'shop-1']);
  const updated = task('old', { status: 'paused', reason: '人工核对' });
  assert.equal(listTaskHistory(history, updated).tasks.length, 1);
  assert.equal(getTaskHistoryDetail(history, updated, 'old').status, 'paused');
});

test('筛选按店铺、模式、状态、关键词及本地日期闭区间工作，导出与列表一致', () => {
  const history = archiveTask(emptyTaskHistory(), task());
  const current = task('new', { status: 'paused', createdAt: new Date(2026, 9, 20).getTime(), config: { ...task().config, shop: { id: 'shop-2', name: '第二店铺' }, mode: 'dry-run' } });
  for (const filters of [{ shopId: 'shop-1' }, { mode: 'send' }, { status: 'completed' }, { query: ' OLD ' }, { query: '第一' }, { fromDate: '2026-10-19', toDate: '2026-10-19' }]) {
    assert.deepEqual(listTaskHistory(history, current, filters).tasks.map(row => row.id), ['old']);
    assert.deepEqual(exportTaskHistory(history, current, filters, 1234).tasks.map(row => row.id), ['old']);
  }
  assert.equal(exportTaskHistory(history, current, {}, 1234).exportedAt, 1234);
  assert.equal(listTaskHistory(history, current, { fromDate: '2026-10-20', toDate: '2026-10-20' }).tasks[0].id, 'new');
  assert.equal(listTaskHistory(history, current, { shopId: 'missing' }).total, 0);
  assert.equal(getTaskHistoryDetail(history, current, 'missing'), null);
  for (const filters of [{ fromDate: '2026-10-21', toDate: '2026-10-19' }, { fromDate: '2026-02-30' }, { toDate: 'bad' }, { mode: 'other' }, { status: 'sent' }, { query: {} }, null]) assert.throws(() => listTaskHistory(history, current, filters), /日期|筛选/);
});

test('旧单消息任务保持单条语义，双消息部分提交和演练结果不混成已送达', () => {
  const legacy = task('legacy');
  delete legacy.config.productLink;
  delete legacy.items[0].messages;
  delete legacy.items[0].submittedCount;
  const single = getTaskHistoryDetail(emptyTaskHistory(), legacy, 'legacy');
  assert.equal(single.items[0].messageCount, 1);
  assert.equal(single.items[0].submittedCount, 1);
  assert.equal(Object.hasOwn(single.config, 'productLink'), false);
  const partial = task('partial', { status: 'paused', items: [{ ...task().items[0], status: 'uncertain', submittedCount: 1 }] });
  const summary = listTaskHistory(emptyTaskHistory(), partial).tasks[0];
  assert.equal(summary.counts.uncertain, 1);
  assert.equal(summary.counts.sent, 0);
  assert.equal(summary.submittedMessages, 1);
  const rehearsal = task('dry', { config: { ...task().config, mode: 'dry-run' }, items: [{ ...task().items[0], status: 'rehearsed', submittedCount: 0 }] });
  assert.equal(listTaskHistory(emptyTaskHistory(), rehearsal).tasks[0].submittedMessages, 0);
});

test('达到条数或UTF-8字节容量时拒绝新增，不删除或改写已有任务', () => {
  let history = emptyTaskHistory();
  for (let i = 0; i < 100; i++) history = archiveTask(history, task(`task-${i}`));
  const before = JSON.stringify(history);
  assert.throws(() => archiveTask(history, task('overflow')), /容量|上限|已满/);
  assert.equal(JSON.stringify(history), before);
  assert.equal(archiveTask(history, task('task-99')).tasks.length, 100);
  const big = task('big', { items: Array.from({ length: 200 }, (_, i) => ({ ...task().items[0], id: String(i), name: '虾'.repeat(6000) })) });
  assert.throws(() => archiveTask(emptyTaskHistory(), big), /容量|上限|已满/);
  assert.equal(listTaskHistory(history, null).capacity.limit, 100);
  assert.equal(listTaskHistory(history, null).capacity.maxBytes, 3 * 1024 * 1024);
});

test('损坏或未知版本保留原值并报错，活动任务不能归档', () => {
  for (const saved of [null, {}, { version: 2, tasks: [] }, { version: 1, tasks: {} }, { version: 1, tasks: [{}] }]) {
    const before = JSON.stringify(saved);
    assert.throws(() => readTaskHistory(saved), /任务记录|任务历史/);
    assert.equal(JSON.stringify(saved), before);
  }
  assert.throws(() => archiveTask(emptyTaskHistory(), task('active', { status: 'paused' })), /结束/);
  const history = archiveTask(emptyTaskHistory(), task());
  assert.deepEqual(readTaskHistory(history), history);
});
