import { normalizeMessages, normalizeTaskName } from './queue.mjs';
import { normalizeSource } from './audience.mjs';

const LIMIT = 100, MAX_BYTES = 3 * 1024 * 1024;
const TASK_STATUSES = new Set(['running', 'pausing', 'paused', 'stopping', 'stopped', 'completed']);
const ITEM_STATUSES = ['pending', 'preparing', 'prepared', 'sending', 'sent', 'rehearsed', 'skipped', 'failed', 'uncertain'];
const corrupt = () => new Error('本地任务记录损坏或版本不兼容；原记录已保留，请检查扩展版本');
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const validText = value => typeof value === 'string' && value.trim().length > 0;

export function emptyTaskHistory() { return { version: 1, tasks: [] }; }

function timestamp(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw corrupt();
  return value;
}

// Keep user-visible evidence, never the authority needed to resume execution.
// Message bodies live once in config rather than once per recipient.
function snapshotTask(task) {
  const config = task?.config;
  if (!validText(task?.id) || !TASK_STATUSES.has(task.status) || !config || !validText(config.shop?.id) || !validText(config.shop?.name)
      || !['send', 'dry-run'].includes(config.mode)
      || !Number.isFinite(config.intervalSeconds) || config.intervalSeconds <= 0 || !Number.isInteger(config.limit) || config.limit < 1
      || !Array.isArray(task.items)) throw corrupt();
  const content = {};
  try {
    if (Object.hasOwn(config, 'messages')) {
      if (Object.hasOwn(config, 'template') || Object.hasOwn(config, 'productLink')) throw corrupt();
      content.messages = normalizeMessages(config.messages);
    } else {
      if (typeof config.template !== 'string' || (Object.hasOwn(config, 'productLink') && typeof config.productLink !== 'string')) throw corrupt();
      content.template = config.template;
      if (Object.hasOwn(config, 'productLink')) content.productLink = config.productLink;
    }
    if (Object.hasOwn(config, 'taskName')) content.taskName = normalizeTaskName(config.taskName);
    if (Object.hasOwn(config, 'source')) content.source = normalizeSource(config.source);
  } catch { throw corrupt(); }
  if (Object.hasOwn(config, 'targetCount') && (!Number.isInteger(config.targetCount) || config.targetCount < 1)) throw corrupt();
  return {
    id: task.id, status: task.status, reason: typeof task.reason === 'string' ? task.reason : null,
    createdAt: timestamp(task.createdAt), updatedAt: timestamp(task.updatedAt),
    config: {
      shop: { id: config.shop.id, name: config.shop.name }, ...content,
      intervalSeconds: config.intervalSeconds, limit: config.limit,
      ...(Object.hasOwn(config, 'targetCount') ? { targetCount: config.targetCount } : {}), mode: config.mode,
    },
    items: task.items.map(item => {
      if (!validText(item?.id) || !validText(item.name) || !ITEM_STATUSES.includes(item.status)) throw corrupt();
      const messageCount = item.messageCount ?? (Array.isArray(item.messages) ? item.messages.length : content.messages?.length ?? 1);
      const submittedCount = item.submittedCount ?? (item.status === 'sent' ? messageCount : 0);
      if (!Number.isInteger(messageCount) || messageCount < 1 || !Number.isInteger(submittedCount) || submittedCount < 0 || submittedCount > messageCount) throw corrupt();
      const types = content.messages?.map(message => message.type);
      if (types && (messageCount !== types.length || (item.messageTypes !== undefined && (!Array.isArray(item.messageTypes) || item.messageTypes.length !== types.length || Array.from(item.messageTypes).some((type, index) => type !== types[index]))))) throw corrupt();
      return { id: item.id, name: item.name, status: item.status, reason: typeof item.reason === 'string' ? item.reason : null, submittedCount, messageCount, ...(types ? { messageTypes: types } : {}) };
    }),
  };
}

export function readTaskHistory(value) {
  if (value === undefined) return emptyTaskHistory();
  if (!value || value.version !== 1 || !Array.isArray(value.tasks)) throw corrupt();
  const tasks = value.tasks.map(task => {
    if (task?.status !== 'completed') throw corrupt();
    return snapshotTask(task);
  });
  return { version: 1, tasks };
}

export function archiveTask(history, task) {
  if (task?.status !== 'completed') throw new Error('只有已结束任务可以归档');
  const saved = readTaskHistory(history);
  const snapshot = snapshotTask(task);
  const next = { version: 1, tasks: [snapshot, ...saved.tasks.filter(row => row.id !== snapshot.id)] };
  if (next.tasks.length > LIMIT || bytes(next) > MAX_BYTES) throw new Error('任务记录已达到条数或容量上限；原记录已保留，本次未启动，请先导出备份');
  return next;
}

function mergedTasks(history, currentTask) {
  const records = new Map(readTaskHistory(history).tasks.map(task => [task.id, task]));
  if (currentTask) { const current = snapshotTask(currentTask); records.set(current.id, current); }
  return [...records.values()].sort((a, b) => (b.createdAt ?? b.updatedAt ?? 0) - (a.createdAt ?? a.updatedAt ?? 0) || a.id.localeCompare(b.id));
}

function dateBoundary(value, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('筛选日期格式无效，请选择有效日期');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('筛选日期无效，请选择有效日期');
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function selectedTasks(tasks, filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('任务筛选条件无效');
  for (const key of ['shopId', 'mode', 'status', 'query', 'fromDate', 'toDate']) if (filters[key] !== undefined && typeof filters[key] !== 'string') throw new Error('任务筛选条件无效');
  const { shopId = '', mode = '', status = '', query = '', fromDate = '', toDate = '' } = filters;
  if ((mode && !['send', 'dry-run'].includes(mode)) || (status && !TASK_STATUSES.has(status))) throw new Error('任务筛选条件无效');
  const from = fromDate ? dateBoundary(fromDate) : null, to = toDate ? dateBoundary(toDate, true) : null;
  if (from !== null && to !== null && from >= to) throw new Error('开始日期不能晚于结束日期');
  const keyword = query.trim().toLowerCase();
  return tasks.filter(task => (!shopId || task.config.shop.id === shopId) && (!mode || task.config.mode === mode) && (!status || task.status === status)
    && (!keyword || [task.id, task.config.shop.id, task.config.shop.name, task.config.taskName || ''].some(value => value.toLowerCase().includes(keyword)))
    && (from === null || (task.createdAt !== null && task.createdAt >= from)) && (to === null || (task.createdAt !== null && task.createdAt < to)));
}

function summary(task) {
  const counts = Object.fromEntries(ITEM_STATUSES.map(status => [status, 0]));
  for (const item of task.items) counts[item.status]++;
  return {
    id: task.id, ...(task.config.taskName !== undefined ? { taskName: task.config.taskName } : {}), shop: { ...task.config.shop }, mode: task.config.mode, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt,
    targetCount: task.config.targetCount ?? Math.min(task.config.limit, task.items.length), total: task.items.length, counts,
    submittedMessages: task.items.reduce((sum, item) => sum + item.submittedCount, 0),
  };
}

export function listTaskHistory(history, currentTask, filters = {}) {
  const all = mergedTasks(history, currentTask);
  const tasks = selectedTasks(all, filters).map(summary);
  const shops = new Map();
  for (const task of all) if (!shops.has(task.config.shop.id)) shops.set(task.config.shop.id, { ...task.config.shop });
  const saved = readTaskHistory(history);
  return { version: 1, tasks, total: tasks.length, shops: [...shops.values()], capacity: { count: saved.tasks.length, limit: LIMIT, maxBytes: MAX_BYTES, bytes: bytes(saved) } };
}

export function getTaskHistoryDetail(history, currentTask, taskId) {
  if (!validText(taskId)) throw new Error('请选择有效的任务记录');
  return mergedTasks(history, currentTask).find(task => task.id === taskId) || null;
}

export function exportTaskHistory(history, currentTask, filters = {}, exportedAt = Date.now()) {
  return { version: 1, exportedAt, tasks: selectedTasks(mergedTasks(history, currentTask), filters) };
}
