import { taskElapsedMs, formatDuration } from './core/task-duration.mjs';

const ui = Object.fromEntries([
  'history-skip', 'main',
  'history-shop', 'history-mode', 'history-status', 'history-query', 'history-from', 'history-to',
  'history-refresh', 'history-export', 'history-notice', 'history-body', 'history-empty',
  'history-range', 'history-page', 'history-previous', 'history-next', 'history-capacity',
  'history-detail', 'detail-title', 'detail-meta', 'detail-reason', 'detail-messages', 'detail-task-name', 'detail-source',
  'detail-interval', 'detail-target', 'detail-duration', 'detail-items', 'detail-export', 'detail-close',
].map(id => [id, document.getElementById(id)]));
const PAGE_SIZE = 10;
const statusNames = {
  running: '正在处理', pausing: '正在安全暂停', paused: '已暂停', stopping: '正在安全停止', stopped: '已停止', completed: '已结束',
  pending: '等待处理', preparing: '正在打开对话', prepared: '消息准备就绪', sending: '正在提交消息', sent: '已提交',
  confirmed: '已提交', rehearsed: '已演练', skipped: '已跳过', failed: '失败', uncertain: '等待人工核对',
};
let tasks = [], page = 1, listReady = false;
let listSequence = 0, detailSequence = 0, exportSequence = 0;
let selectedTaskId = null, selectedButton = null;
let exporting = false;

function create(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value ?? '');
  return node;
}
function notice(message = '', error = false) {
  ui['history-notice'].textContent = message;
  ui['history-notice'].hidden = !message;
  ui['history-notice'].className = `notice${error ? ' error' : ''}`;
}
function filters() {
  return {
    shopId: ui['history-shop'].value, mode: ui['history-mode'].value, status: ui['history-status'].value,
    query: ui['history-query'].value.trim(), fromDate: ui['history-from'].value, toDate: ui['history-to'].value,
  };
}
function validDates(values) {
  return !values.fromDate || !values.toDate || values.fromDate <= values.toDate;
}
async function request(message) {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') throw new Error('无法连接扩展后台。请从已加载的“虾仁”扩展打开任务记录。');
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '读取失败，请刷新记录；若扩展刚刚更新，请重新加载扩展。');
  return result;
}
function date(value) {
  if (value === null || value === undefined || value === '') return '时间未记录';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '时间未记录' : time.toLocaleString('zh-CN', { hour12: false });
}
function number(value) { return Number.isFinite(value) && value >= 0 ? value : 0; }
function mode(value) { return value === 'send' ? '真实发送' : value === 'dry-run' ? '演练' : '模式未记录'; }
function status(value) { return statusNames[value] || '状态未记录'; }
function tag(value, isMode = false) {
  const mood = isMode ? (value === 'send' ? 'warn' : 'good') : ['sent', 'confirmed', 'rehearsed', 'completed'].includes(value) ? 'good' : ['uncertain', 'failed'].includes(value) ? 'bad' : ['paused', 'stopped', 'skipped'].includes(value) ? 'warn' : '';
  return create('span', `state-tag${mood ? ` ${mood}` : ''}`, isMode ? mode(value) : status(value));
}
function resultSummary(task) {
  const pieces = Object.keys(statusNames).filter(key => number(task.counts?.[key]) > 0).map(key => `${status(key)} ${task.counts[key]} 人`);
  if (!pieces.length) pieces.push(`共 ${number(task.total)} 人`);
  pieces.push(`共提交 ${number(task.submittedMessages)} 条消息`);
  return pieces.join('；');
}
function closeDetail(returnFocus = false) {
  detailSequence++;
  selectedTaskId = null;
  ui['history-detail'].hidden = true;
  ui['history-detail'].setAttribute('aria-busy', 'false');
  for (const id of ['detail-meta', 'detail-reason', 'detail-messages', 'detail-task-name', 'detail-source', 'detail-interval', 'detail-target', 'detail-duration', 'detail-items']) ui[id].textContent = '';
  ui['detail-export'].disabled = true;
  if (returnFocus) selectedButton?.focus();
  selectedButton = null;
}
function updateExportButtons() {
  ui['history-export'].disabled = exporting || !listReady || tasks.length === 0;
  ui['detail-export'].disabled = exporting || !selectedTaskId;
}
function invalidateExport() {
  exportSequence++;
  exporting = false;
  updateExportButtons();
}
function renderList() {
  const pages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  page = Math.min(page, pages);
  const start = (page - 1) * PAGE_SIZE;
  const now = Date.now();
  ui['history-body'].replaceChildren();
  for (const task of tasks.slice(start, start + PAGE_SIZE)) {
    const row = create('tr');
    const fullId = String(task.id ?? '未记录');
    const shortId = fullId.length > 24 ? `${fullId.slice(0, 12)}…${fullId.slice(-8)}` : fullId;
    const id = create('td', 'history-task-id', task.taskName || shortId);
    if (task.taskName) id.append(create('span', 'history-person-id', shortId));
    id.title = fullId;
    const taskMode = create('td'); taskMode.append(tag(task.mode, true));
    const taskStatus = create('td'); taskStatus.append(tag(task.status));
    const action = create('td');
    const open = create('button', 'text-button', '查看详情');
    open.type = 'button';
    open.setAttribute('aria-label', `查看任务 ${fullId} 的详情`);
    open.addEventListener('click', () => openDetail(task.id, open));
    action.append(open);
    row.append(id, create('td', '', task.shop?.name || task.shop?.id || '店铺未记录'), create('td', '', date(task.createdAt)), taskMode, taskStatus, create('td', 'history-duration', formatDuration(taskElapsedMs(task, now))), create('td', 'history-result', resultSummary(task)), action);
    ui['history-body'].append(row);
  }
  ui['history-empty'].hidden = tasks.length > 0;
  ui['history-range'].textContent = tasks.length ? `第 ${start + 1}–${Math.min(start + PAGE_SIZE, tasks.length)} 条，共 ${tasks.length} 条` : '共 0 条';
  ui['history-page'].textContent = `第 ${page} / ${pages} 页`;
  ui['history-previous'].disabled = page <= 1;
  ui['history-next'].disabled = page >= pages;
  updateExportButtons();
}
function renderShops(shops) {
  const selected = ui['history-shop'].value;
  ui['history-shop'].replaceChildren(create('option', '', '全部店铺'));
  ui['history-shop'].children[0].value = '';
  const seen = new Set();
  for (const shop of Array.isArray(shops) ? shops : []) {
    if (!shop?.id || seen.has(String(shop.id))) continue;
    seen.add(String(shop.id));
    const option = create('option', '', shop.name || shop.id); option.value = String(shop.id);
    ui['history-shop'].append(option);
  }
  if (selected && !seen.has(selected)) {
    const option = create('option', '', `${selected}（当前筛选）`); option.value = selected;
    ui['history-shop'].append(option);
  }
  ui['history-shop'].value = selected;
}
function renderCapacity(capacity = {}) {
  const count = number(capacity.count), limit = number(capacity.limit) || 100;
  const bytesFull = number(capacity.maxBytes) > 0 && number(capacity.bytes) >= capacity.maxBytes;
  ui['history-capacity'].textContent = `本机保留 ${count} / ${limit} 条任务${count >= limit || bytesFull ? '；容量已满，请先导出记录，新任务将被阻止。' : '；容量满时会阻止新任务，请定期导出。'}`;
}
async function loadList() {
  const sequence = ++listSequence;
  closeDetail();
  listReady = false;
  tasks = []; page = 1;
  invalidateExport();
  renderList();
  const values = filters();
  if (!validDates(values)) {
    ui['history-body'].setAttribute('aria-busy', 'false');
    ui['history-empty'].textContent = '请调整日期后重新查看记录。';
    notice('开始日期不能晚于结束日期。', true);
    return;
  }
  notice();
  ui['history-empty'].textContent = '正在读取任务记录…';
  ui['history-body'].setAttribute('aria-busy', 'true');
  try {
    const result = await request({ type: 'panel:history-list', filters: values });
    if (sequence !== listSequence) return;
    const history = result.taskHistory;
    if (!Array.isArray(history?.tasks)) throw new Error('任务记录格式不完整，请重新加载扩展后刷新记录。');
    tasks = history.tasks.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    listReady = true;
    renderShops(history.shops);
    renderCapacity(history.capacity);
    ui['history-empty'].textContent = '没有符合条件的任务记录。可调整筛选条件，或完成任务后刷新记录。';
    renderList();
  } catch (error) {
    if (sequence !== listSequence) return;
    ui['history-empty'].textContent = '任务记录未能加载，请点击“刷新记录”重试。';
    notice(error.message || '读取任务记录失败，请刷新重试。', true);
  } finally {
    if (sequence === listSequence) ui['history-body'].setAttribute('aria-busy', 'false');
  }
}
async function openDetail(taskId, button) {
  closeDetail();
  invalidateExport();
  selectedButton = button;
  const sequence = ++detailSequence;
  ui['history-detail'].hidden = false;
  ui['history-detail'].setAttribute('aria-busy', 'true');
  ui['detail-title'].textContent = '正在读取任务详情…';
  notice();
  try {
    const result = await request({ type: 'panel:history-detail', taskId });
    if (sequence !== detailSequence) return;
    const record = result.taskRecord;
    if (!record || record.id !== taskId || !record.config || !Array.isArray(record.items)) throw new Error('任务详情不完整，请刷新记录重试。');
    selectedTaskId = record.id;
    ui['detail-title'].textContent = '任务详情';
    ui['detail-meta'].textContent = `${record.id} · ${record.config.shop?.name || record.config.shop?.id || '店铺未记录'} · ${mode(record.config.mode)} · ${status(record.status)}\n创建于 ${date(record.createdAt)}；更新于 ${date(record.updatedAt)}`;
    ui['detail-reason'].textContent = record.reason || '';
    ui['detail-reason'].hidden = !record.reason;
    ui['detail-task-name'].textContent = record.config.taskName || '未命名任务';
    const messages = Array.isArray(record.config.messages) ? record.config.messages : [{ type: 'text', content: record.config.template ?? '话术未记录' }, ...(record.config.productLink ? [{ type: 'link', content: record.config.productLink }] : [])];
    messages.forEach((message, index) => {
      const card = create('article', 'history-message');
      const image = message.type === 'image';
      const content = image ? `${message.name} · ${message.width} × ${message.height} · ${(number(message.size) / 1024).toFixed(1)} KiB · ${message.mime}\n图片引用：${message.assetId}\nSHA-256：${message.sha256}\n此记录仅保存引用，不包含图片原件。` : message.content;
      card.append(create('h3', '', `第 ${index + 1} 条 · ${image ? '图片消息' : message.type === 'link' ? '商品链接' : '文字消息'}`), create('p', 'history-content', content));
      ui['detail-messages'].append(card);
    });
    const source = record.config.source;
    ui['detail-source'].textContent = source ? `${source.type === 'specified' ? `指定已加载 Shopee 用户 ID：${(source.creatorIds || []).join('、')}` : source.type === 'affiliates' ? `指定联盟伙伴 ID：${(source.affiliateIds || []).join('、')}` : source.type === 'leaderboard' ? 'Shopee 达人排行榜（从上到下）' : 'Shopee 达人广场'}；名称包含：${source.nameIncludes || '不限'}；名称排除：${source.nameExcludes || '不限'}` : 'Shopee 达人广场；旧任务未记录名称筛选条件';
    ui['detail-interval'].textContent = record.config.intervalSeconds === null || record.config.intervalSeconds === undefined ? '间隔未记录' : `${record.config.intervalSeconds} 秒`;
    const target = record.config.targetCount ?? record.config.limit;
    ui['detail-target'].textContent = `${target ?? '未记录'} 人；记录名单 ${record.items.length} 人`;
    ui['detail-duration'].textContent = formatDuration(taskElapsedMs(record, Date.now()));
    for (const item of record.items) {
      const row = create('tr'), person = create('td'), itemStatus = create('td');
      person.append(create('span', '', item.name || '姓名未记录'), create('span', 'history-person-id', item.id || ''));
      itemStatus.append(tag(item.status));
      row.append(person, itemStatus, create('td', '', `${number(item.submittedCount)} / ${number(item.messageCount)} 条`), create('td', '', item.reason || '—'));
      ui['detail-items'].append(row);
    }
    updateExportButtons();
    ui['detail-title'].focus();
  } catch (error) {
    if (sequence !== detailSequence) return;
    closeDetail();
    notice(error.message || '读取任务详情失败，请刷新记录重试。', true);
  } finally {
    if (sequence === detailSequence) ui['history-detail'].setAttribute('aria-busy', 'false');
  }
}
async function exportRecords(currentOnly = false) {
  if (exporting || (currentOnly ? !selectedTaskId : !listReady || !tasks.length)) return;
  const values = filters();
  if (!validDates(values)) { notice('开始日期不能晚于结束日期。', true); return; }
  const sequence = ++exportSequence;
  const message = currentOnly ? { type: 'panel:history-export', taskId: selectedTaskId } : { type: 'panel:history-export', filters: values };
  exporting = true;
  updateExportButtons();
  notice();
  try {
    const result = await request(message);
    if (sequence !== exportSequence) return;
    const report = result.taskHistoryExport;
    if (!Array.isArray(report?.tasks)) throw new Error('导出数据不完整，请刷新记录后重试。');
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = create('a');
    link.href = url;
    link.download = `虾仁-任务记录-${currentOnly ? '单条-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(`已导出 ${report.tasks.length} 条任务记录。文件包含消息内容与达人结果；图片只保存引用，不含图片原件，不能作为图片原件备份，请妥善保管。`);
  } catch (error) {
    if (sequence === exportSequence) notice(error.message || '导出失败，请重试。', true);
  } finally {
    if (sequence === exportSequence) { exporting = false; updateExportButtons(); }
  }
}

ui['history-skip'].addEventListener('click', event => {
  event.preventDefault();
  ui.main.focus();
});
for (const id of ['history-shop', 'history-mode', 'history-status', 'history-from', 'history-to']) ui[id].addEventListener('change', loadList);
ui['history-query'].addEventListener('input', loadList);
ui['history-refresh'].addEventListener('click', loadList);
ui['history-export'].addEventListener('click', () => exportRecords());
ui['detail-export'].addEventListener('click', () => exportRecords(true));
ui['detail-close'].addEventListener('click', () => { closeDetail(true); invalidateExport(); });
for (const [id, direction] of [['history-previous', -1], ['history-next', 1]]) ui[id].addEventListener('click', () => {
  const next = page + direction;
  if (next < 1 || next > Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))) return;
  closeDetail(); invalidateExport(); page = next; renderList();
});
loadList();
