import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { taskElapsedMs, formatDuration } from '../extension/core/task-duration.mjs';

const readOptional = file => readFile(new URL(file, import.meta.url), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
const html = await readOptional('../extension/history.html');
const source = await readOptional('../extension/history.mjs');
const script = source.replace("import { taskElapsedMs, formatDuration } from './core/task-duration.mjs';", '');
const ids = ['history-skip', 'main', 'history-shop', 'history-mode', 'history-status', 'history-query', 'history-from', 'history-to', 'history-refresh', 'history-export', 'history-notice', 'history-body', 'history-empty', 'history-range', 'history-page', 'history-previous', 'history-next', 'history-capacity', 'history-detail', 'detail-title', 'detail-meta', 'detail-reason', 'detail-messages', 'detail-task-name', 'detail-source', 'detail-interval', 'detail-target', 'detail-duration', 'detail-items', 'detail-export', 'detail-close'];

// Exercise the actual page script with a tiny DOM. Layout is checked in a browser.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.parent = null; this.listeners = {};
    this.value = ''; this.disabled = false; this.hidden = false; this.className = ''; this.dataset = {}; this.attributes = {};
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
  }
  set textContent(value) { this.content = String(value); for (const child of this.children) child.parent = null; this.children = []; }
  get textContent() { return (this.content || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('记录内容必须使用 textContent'); }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.focused = true; }
  fire(type, values = {}) {
    Object.assign(this, values);
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of this.listeners[type] || []) handler(event);
    return event;
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const summaries = (count = 23) => Array.from({ length: count }, (_, index) => ({
  id: `task-${index + 1}`, shop: { id: '700', name: '测试店铺' }, mode: index % 2 ? 'send' : 'dry-run', status: 'completed', createdAt: 100000 + index * 1000, updatedAt: 200000, targetCount: 2, total: 2, counts: { sent: 1, uncertain: 1 }, submittedMessages: 3,
}));
const snapshot = id => ({ id, status: 'completed', reason: null, createdAt: 100000, updatedAt: 200000, config: { shop: { id: '700', name: '测试店铺' }, template: '你好 {{name}}', productLink: 'https://shopee.co.id/product/1/2', intervalSeconds: 30, limit: 2, targetCount: 2, mode: 'send' }, items: [{ id: 'creator-1', name: '达人甲', status: 'uncertain', reason: '结果待核对', submittedCount: 1, messageCount: 2 }] });
async function history({ tasks = summaries(), handler, now = 300000 } = {}) {
  const nodes = new Map(ids.map(id => [id, new Element()]));
  const messages = [], downloads = [], blobs = [], timers = [];
  let currentTime = now;
  class ClockDate extends Date { static now() { return currentTime; } }
  let requestHook = handler;
  const sendMessage = async message => {
    messages.push(structuredClone(message));
    if (requestHook) { const response = await requestHook(message); if (response !== undefined) return response; }
    if (message.type === 'panel:history-list') return { ok: true, taskHistory: { version: 1, tasks: structuredClone(tasks), total: tasks.length, shops: [{ id: '700', name: '测试店铺' }], capacity: { count: tasks.length, limit: 100, bytes: 4000, maxBytes: 3145728 } } };
    if (message.type === 'panel:history-detail') return { ok: true, taskRecord: snapshot(message.taskId) };
    if (message.type === 'panel:history-export') return { ok: true, taskHistoryExport: { version: 1, exportedAt: 300000, tasks: message.taskId ? [snapshot(message.taskId)] : tasks.map(task => snapshot(task.id)) } };
    throw new Error(`记录页不应调用 ${message.type}`);
  };
  vm.runInNewContext(script, { document: { body: new Element('body'), getElementById: id => nodes.get(id) || null, createElement(tag) { const node = new Element(tag); node.click = () => { if (tag === 'a') downloads.push({ filename: node.download, href: node.href }); else node.fire('click'); }; return node; } }, chrome: { runtime: { sendMessage } }, Blob, Date: ClockDate, taskElapsedMs, formatDuration, URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:history'; }, revokeObjectURL() {} }, setTimeout: (callback, delay) => { timers.push(delay); callback(); }, clearTimeout: () => {} });
  await settle();
  return { nodes, messages, downloads, blobs, timers, rows: () => nodes.get('history-body').children,
    async fire(id, type = 'click', values) { const event = nodes.get(id).fire(type, values); await settle(); return event; },
    async open(index = 0) { const button = descendants(nodes.get('history-body').children[index] || new Element()).find(node => node.tagName === 'button'); assert.ok(button, '任务行应可打开详情'); button.fire('click'); await settle(); },
    hook(next) { requestHook = next; },
    setNow(value) { currentTime = value; },
  };
}

test('独立任务记录页只读取历史，不读取专用页或启动、暂停、恢复任务', async () => {
  const ui = await history();
  assert.deepEqual(ui.messages.map(message => message.type), ['panel:history-list']);
  assert.match(html, /src="history\.mjs"/);
  assert.doesNotMatch(html, /dashboard\.mjs/);
  assert.match(html, /href="dashboard\.html"/);
  assert.match(html, /已提交表示完成发送点击，不核对平台接受、送达或已读/);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `页面需提供 ${id}`);
  assert.doesNotMatch(html, /<(?:button|a)[^>]*>\s*(?:删除|重发)/);
});

test('键盘跳到任务记录时阻止片段导航并聚焦主内容，不另发后台请求', async () => {
  const ui = await history();
  const event = await ui.fire('history-skip');
  assert.equal(event.defaultPrevented, true);
  assert.equal(ui.nodes.get('main').focused, true);
  assert.match(html, /<a\b[^>]*id="history-skip"[^>]*href="#main"/);
  assert.match(html, /<main\b[^>]*id="main"[^>]*tabindex="-1"/);
  assert.deepEqual(ui.messages.map(message => message.type), ['panel:history-list']);
});

test('筛选值传给历史接口，空结果提示可调整条件，日期反向时阻止读取', async () => {
  const ui = await history({ tasks: [] });
  for (const [id, value] of [['history-shop', '700'], ['history-mode', 'send'], ['history-status', 'paused'], ['history-query', '测试 task'], ['history-from', '2026-10-01'], ['history-to', '2026-10-19']]) await ui.fire(id, id === 'history-query' ? 'input' : 'change', { value });
  assert.deepEqual(ui.messages.at(-1).filters, { shopId: '700', mode: 'send', status: 'paused', query: '测试 task', fromDate: '2026-10-01', toDate: '2026-10-19' });
  assert.equal(ui.nodes.get('history-empty').hidden, false);
  assert.match(ui.nodes.get('history-empty').textContent, /没有.*记录|暂无.*记录/);
  const count = ui.messages.length;
  await ui.fire('history-from', 'change', { value: '2026-10-20' });
  assert.equal(ui.messages.length, count);
  assert.match(ui.nodes.get('history-notice').textContent, /开始日期.*结束日期/);
  assert.equal(ui.nodes.get('history-export').disabled, true);
});

test('列表按创建时间倒序且每页10条，翻页不向后台发队列消息', async () => {
  const ui = await history();
  assert.equal(ui.rows().length, 10);
  assert.match(ui.rows()[0].textContent, /task-23/);
  assert.match(ui.rows()[0].textContent, /已提交.*1.*等待人工核对.*1.*3.*条/);
  await ui.fire('history-next');
  assert.equal(ui.rows().length, 10);
  assert.match(ui.rows()[0].textContent, /task-13/);
  await ui.fire('history-next');
  assert.equal(ui.rows().length, 3);
  assert.equal(ui.nodes.get('history-next').disabled, true);
  assert.match(ui.nodes.get('history-range').textContent, /21.*23.*23/);
  await ui.fire('history-previous');
  assert.equal(ui.rows().length, 10);
  assert.equal(ui.messages.length, 1);
});

test('任务列表展示总耗时，结束任务固定，未结束任务在原刷新操作中更新且不新增计时器', async () => {
  const tasks = ['completed', 'running', 'pausing', 'paused', 'stopping', 'stopped'].map(status => ({ ...summaries(1)[0], id: `duration-${status}`, status, createdAt: 100000, updatedAt: 162000 }));
  const ui = await history({ tasks, now: 226000 });
  const duration = status => ui.rows().find(row => row.children[0].textContent === `duration-${status}`).children[5].textContent;
  assert.match(html, /<th\b[^>]*>总耗时<\/th>/);
  assert.match(html, /总耗时[^<]*间隔[^<]*暂停/);
  assert.equal(duration('completed'), '1 分 02 秒');
  for (const status of ['running', 'pausing', 'paused', 'stopping', 'stopped']) assert.equal(duration(status), '2 分 06 秒');
  ui.setNow(288000);
  await ui.fire('history-refresh');
  assert.equal(duration('completed'), '1 分 02 秒');
  for (const status of ['running', 'pausing', 'paused', 'stopping', 'stopped']) assert.equal(duration(status), '3 分 08 秒');
  assert.deepEqual(ui.timers, []);
  assert.deepEqual(ui.messages.map(message => message.type), ['panel:history-list', 'panel:history-list']);
});

test('任务详情展示总耗时，重新查看未结束任务会更新，收起时清除旧值', async () => {
  const record = { ...snapshot('task-1'), status: 'paused', createdAt: 100000, updatedAt: 162000 };
  const ui = await history({ tasks: summaries(1), now: 3823000, handler: message => message.type === 'panel:history-detail' ? { ok: true, taskRecord: record } : undefined });
  await ui.open();
  assert.equal(ui.nodes.get('detail-duration').textContent, '1 小时 02 分 03 秒');
  await ui.fire('detail-close');
  assert.equal(ui.nodes.get('detail-duration').textContent, '');
  ui.setNow(3885000);
  await ui.open();
  assert.equal(ui.nodes.get('detail-duration').textContent, '1 小时 03 分 05 秒');
  assert.deepEqual(ui.timers, []);
  assert.deepEqual(ui.messages.map(message => message.type), ['panel:history-list', 'panel:history-detail', 'panel:history-detail']);
});

test('缺失或倒序时间的总耗时显示未记录，零耗时不被当作缺失', async () => {
  const cases = [{ id: 'missing-start', createdAt: null, updatedAt: 162000 }, { id: 'missing-end', createdAt: 100000, updatedAt: null }, { id: 'reversed', createdAt: 162000, updatedAt: 100000 }, { id: 'zero', createdAt: 0, updatedAt: 0 }];
  const tasks = cases.map(value => ({ ...summaries(1)[0], ...value }));
  const ui = await history({ tasks, handler: message => message.type === 'panel:history-detail' ? { ok: true, taskRecord: { ...snapshot(message.taskId), ...cases.find(value => value.id === message.taskId) } } : undefined });
  for (let index = 0; index < ui.rows().length; index++) {
    const row = ui.rows()[index], expected = row.children[0].textContent === 'zero' ? '0 秒' : '未记录';
    assert.equal(row.children[5].textContent, expected);
    await ui.open(index);
    assert.equal(ui.nodes.get('detail-duration').textContent, expected);
  }
});

test('详情按字面展示原配置、逐人原因和提交数，不执行来自记录的标记', async () => {
  const record = snapshot('task-1');
  record.config.template = '<img src=x onerror=alert(1)> {{name}}';
  record.config.productLink = '<script>alert(2)</script>';
  record.items[0].name = '<svg onload=alert(3)>';
  record.items[0].reason = '<b>需核对</b>';
  const ui = await history({ tasks: summaries(1), handler: message => message.type === 'panel:history-detail' ? { ok: true, taskRecord: record } : undefined });
  await ui.open();
  assert.equal(ui.nodes.get('history-detail').hidden, false);
  assert.equal(ui.nodes.get('detail-messages').children[0].children[1].textContent, record.config.template);
  assert.equal(ui.nodes.get('detail-messages').children[1].children[1].textContent, record.config.productLink);
  assert.match(ui.nodes.get('detail-interval').textContent, /30.*秒/);
  assert.match(ui.nodes.get('detail-target').textContent, /2.*人/);
  assert.match(ui.nodes.get('detail-items').textContent, /<svg onload=alert\(3\)>.*等待人工核对.*1.*2.*<b>需核对<\/b>/);
  assert.equal(descendants(ui.nodes.get('history-detail')).some(node => ['img', 'script', 'svg', 'input', 'textarea'].includes(node.tagName)), false);
});

test('切换筛选立即收起旧详情，列表和详情的迟到响应均不能覆盖新条件', async () => {
  const detail = deferred(), oldList = deferred();
  const ui = await history();
  ui.hook(message => message.type === 'panel:history-detail' ? detail.promise : undefined);
  await ui.open();
  ui.hook(message => message.type === 'panel:history-list' ? (message.filters.query === '旧' ? oldList.promise : { ok: true, taskHistory: { tasks: [summaries(1)[0]], shops: [], capacity: {} } }) : undefined);
  await ui.fire('history-query', 'input', { value: '旧' });
  await ui.fire('history-query', 'input', { value: '新' });
  detail.resolve({ ok: true, taskRecord: snapshot('task-23') });
  oldList.resolve({ ok: true, taskHistory: { tasks: summaries(), shops: [], capacity: {} } });
  await settle();
  assert.equal(ui.rows().length, 1);
  assert.match(ui.rows()[0].textContent, /task-1/);
  assert.equal(ui.nodes.get('history-detail').hidden, true);
  assert.equal(ui.nodes.get('detail-messages').textContent, '');
});

test('筛选结果与当前条目分别导出后台JSON，不触发连接或队列操作', async () => {
  const ui = await history({ tasks: summaries(1) });
  await ui.fire('history-mode', 'change', { value: 'send' });
  await ui.fire('history-export');
  assert.equal(ui.messages.at(-1).type, 'panel:history-export');
  assert.equal(ui.messages.at(-1).filters.mode, 'send');
  assert.match(ui.downloads[0].filename, /虾仁-任务记录-.*\.json$/);
  assert.equal(JSON.parse(await ui.blobs[0].text()).tasks[0].config.template, '你好 {{name}}');
  await ui.open();
  await ui.fire('detail-export');
  assert.deepEqual(ui.messages.at(-1), { type: 'panel:history-export', taskId: 'task-1' });
  assert.equal(JSON.parse(await ui.blobs[1].text()).tasks.length, 1);
  assert.equal(ui.messages.every(message => message.type.startsWith('panel:history-')), true);
});

test('读取失败会清掉旧列表并提示刷新，刷新后可恢复且容量满不承诺自动删除', async () => {
  const ui = await history({ tasks: summaries(1) });
  ui.hook(message => message.type === 'panel:history-list' ? { ok: false, error: '本机存储读取失败' } : undefined);
  await ui.fire('history-refresh');
  assert.equal(ui.rows().length, 0);
  assert.match(ui.nodes.get('history-notice').textContent, /本机存储读取失败/);
  assert.equal(ui.nodes.get('history-export').disabled, true);
  ui.hook(message => message.type === 'panel:history-list' ? { ok: true, taskHistory: { tasks: summaries(1), shops: [], capacity: { count: 100, limit: 100, bytes: 3145728, maxBytes: 3145728 } } } : undefined);
  await ui.fire('history-refresh');
  assert.equal(ui.rows().length, 1);
  assert.match(ui.nodes.get('history-capacity').textContent, /100.*100/);
  assert.match(ui.nodes.get('history-capacity').textContent, /导出/);
  assert.doesNotMatch(ui.nodes.get('history-capacity').textContent, /自动删除|自动清理/);
});

test('读取中把日期改为反向会结束加载状态，并忽略先前列表与导出的迟到响应', async () => {
  const oldList = deferred(), oldExport = deferred();
  const ui = await history({ tasks: summaries(1) });
  ui.hook(message => message.type === 'panel:history-export' ? oldExport.promise : undefined);
  await ui.fire('history-export');
  ui.hook(message => message.type === 'panel:history-list' ? oldList.promise : undefined);
  await ui.fire('history-from', 'change', { value: '2026-10-20' });
  assert.equal(ui.nodes.get('history-body').attributes['aria-busy'], 'true');
  await ui.fire('history-to', 'change', { value: '2026-10-19' });
  assert.equal(ui.nodes.get('history-body').attributes['aria-busy'], 'false');
  oldList.resolve({ ok: true, taskHistory: { tasks: summaries(1), shops: [], capacity: {} } });
  oldExport.resolve({ ok: true, taskHistoryExport: { version: 1, tasks: [snapshot('task-1')] } });
  await settle();
  assert.equal(ui.rows().length, 0);
  assert.equal(ui.downloads.length, 0);
  assert.match(ui.nodes.get('history-notice').textContent, /开始日期不能晚于结束日期/);
});

test('新历史展示任务名称、消息顺序与来源条件，保留原文而不显示旧固定双消息字段', async () => {
  const record = snapshot('task-sequence');
  record.config = { shop: record.config.shop, taskName: '<b>新品合作</b>', mode: 'send', messages: [{ type: 'link', content: 'https://shopee.co.id/product/3/4' }, { type: 'text', content: '你好 {{name}} <script>安全展示</script>' }, { type: 'text', content: '第三条原文' }], source: { type: 'specified', creatorIds: ['100', '200'], nameIncludes: 'beauty', nameExcludes: 'bot' }, intervalSeconds: 30, targetCount: 2, limit: 2 };
  const ui = await history({ tasks: [{ ...summaries(1)[0], id: record.id, taskName: record.config.taskName }], handler: message => message.type === 'panel:history-detail' ? { ok: true, taskRecord: record } : undefined });
  await ui.open();
  assert.match(ui.rows()[0].textContent, /<b>新品合作<\/b>/);
  assert.equal(ui.nodes.get('detail-task-name').textContent, record.config.taskName);
  assert.equal(ui.nodes.get('detail-messages').children.length, 3);
  assert.equal(ui.nodes.get('detail-messages').children[1].children[1].textContent, record.config.messages[1].content);
  assert.match(ui.nodes.get('detail-messages').textContent, /第 1 条.*链接.*第 2 条.*文字.*第 3 条.*第三条原文/);
  assert.match(ui.nodes.get('detail-source').textContent, /指定.*Shopee.*100.*200.*beauty.*bot/);
});

test('图片历史仅展示引用元数据，导出说明不包含原件备份且不调用图片读取接口', async () => {
  const record = snapshot('task-image');
  record.config = { shop: record.config.shop, messages: [{ type: 'image', assetId: 'image-1', sha256: 'a'.repeat(64), name: '<图片>.png', mime: 'image/png', size: 2048, width: 640, height: 480 }], mode: 'send', intervalSeconds: 30, limit: 1 };
  const ui = await history({ tasks: [{ ...summaries(1)[0], id: record.id }], handler: message => message.type === 'panel:history-detail' ? { ok: true, taskRecord: record } : message.type === 'panel:history-export' ? { ok: true, taskHistoryExport: { version: 1, tasks: [record] } } : undefined });
  await ui.open();
  assert.match(ui.nodes.get('detail-messages').textContent, /第 1 条.*图片.*<图片>\.png.*640.*480.*2\.0 KiB.*image-1/s);
  assert.equal(descendants(ui.nodes.get('detail-messages')).some(node => node.tagName === 'img'), false);
  await ui.fire('detail-export');
  assert.match(ui.nodes.get('history-notice').textContent, /图片.*引用.*不含.*原件/);
  assert.equal(ui.messages.every(message => message.type.startsWith('panel:history-')), true);
  assert.equal(JSON.parse(await ui.blobs[0].text()).tasks[0].config.messages[0].assetId, 'image-1');
});

test('搜索框防抖：输入法组合期间不发请求，组合结束才按延迟读取一次', async () => {
  const ui = await history({ tasks: [] });
  const before = ui.messages.length;
  await ui.fire('history-query', 'compositionstart');
  await ui.fire('history-query', 'input', { value: '合' });
  await ui.fire('history-query', 'input', { value: '合作' });
  assert.equal(ui.messages.length, before, '组合输入期间不应读取');
  await ui.fire('history-query', 'compositionend', { value: '合作' });
  await settle();
  assert.equal(ui.messages.length, before + 1);
  assert.equal(ui.messages.at(-1).filters.query, '合作');
  assert.ok(ui.timers.includes(250), '搜索应经过防抖延迟');
});
