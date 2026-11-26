import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { initialState, previewTask } from '../extension/core/queue.mjs';
import { taskElapsedMs, formatDuration } from '../extension/core/task-duration.mjs';
import { selectCandidate, refillSelection, resetSelection } from '../extension/core/collection.mjs';
import * as messageRules from '../extension/core/message-rules.mjs';
import * as historyWindow from '../extension/core/history-window.mjs';

const html = await readFile(new URL('../extension/dashboard.html', import.meta.url), 'utf8');
// 工作台在 VM 里以脚本形式执行，没有模块系统：去掉指向 core/ 的 import 语句，
// 再把被导入的绑定显式注入上下文（见下方 messageRules 与 duration 绑定）。
const source = (await readFile(new URL('../extension/dashboard.mjs', import.meta.url), 'utf8'))
  .replace(/^import [^;]*?from '\.\/core\/[^']+';?\r?\n/gm, '');

// Run the actual dashboard with a minimal DOM and a deterministic background.
// Browser verification separately covers layout and native controls.
class Element {
  constructor(tag = 'div', register = () => {}) {
    this.register = register;
    this.tagName = tag; this.children = []; this.parent = null; this.listeners = {};
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.className = ''; this.dataset = {}; this.style = {}; this.attributes = {};
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
  }
  set textContent(value) { this.content = String(value); for (const child of this.children) child.parent = null; this.children = []; }
  get textContent() { return (this.content || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('记录内容必须按字面展示'); }
  set id(value) { this.nodeId = value; this.register(value, this); }
  get id() { return this.nodeId; }
  focus() { this.focused = true; }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  insertBefore(node, cursor) { node.remove(); const index = cursor ? this.children.indexOf(cursor) : this.children.length; node.parent = this; this.children.splice(index, 0, node); }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  fire(type, values = {}, event = {}) { Object.assign(this, values); for (const handler of this.listeners[type] || []) handler({ target: this, preventDefault() {}, ...event }); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const savedTemplate = (id = 'saved-a', changes = {}) => ({ id, name: `模板 ${id}`, template: '已存邀请 {{name}}', productLink: 'https://shopee.co.id/product/7/8', revision: 1, createdAt: 1000, updatedAt: 1000, ...changes });
const templateReply = (templates, savedTemplateId) => ({ ok: true, messageTemplates: { version: 1, templates: structuredClone(templates), capacity: { count: templates.length, limit: 50, bytes: 1000, maxBytes: 524288 } }, ...(savedTemplateId ? { savedTemplateId } : {}) });
const isTemplateMessage = message => message.type.startsWith('panel:template-');
const isImageMessage = message => message.type.startsWith('panel:image-');
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=';
const imageAsset = (id = 'asset-1', changes = {}) => ({ id, sha256: 'a'.repeat(64), name: '合作图片.png', mime: 'image/png', size: Buffer.from(PNG_DATA.split(',')[1], 'base64').length, width: 1, height: 1, createdAt: 1000, dataUrl: PNG_DATA, ...changes });
const imageReference = asset => ({ type: 'image', assetId: asset.id, sha256: asset.sha256, name: asset.name, mime: asset.mime, size: asset.size, width: asset.width, height: asset.height });
const imageListReply = assets => ({ ok: true, imageAssets: { version: 1, assets: assets.map(({ dataUrl, ...metadata }) => metadata), capacity: { count: assets.length, limit: 20, bytes: 1000, maxBytes: 4194304, maxAssetBytes: 2097152 } } });
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
async function dashboard(count = 23, { legacy = false, unread = false, templates = [], templateHandler, getHandler, filterHandler, assets = [], imageHandler, fileReaderHandler, imageCapability = true, decodeHandler, bitmapCapability = false, bitmapHandler, imageDecodeMethod, libraryHandler, librarySelection, session = new Map(), clock = () => Date.now() } = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  nodes.get('interval').value = html.match(/<input\b[^>]*id="interval"[^>]*\bvalue="([^"]*)"/)?.[1] || '';
  nodes.get('mode').value = html.match(/<select\b[^>]*id="mode"[^>]*>[\s\S]*?<option\b[^>]*value="([^"]*)"/)?.[1] || '';
  nodes.get('source-type').value = html.match(/<select\b[^>]*id="source-type"[^>]*>[\s\S]*?<option\b[^>]*value="([^"]*)"/)?.[1] || 'marketplace';
  nodes.get('limit').value = String(Math.min(count, 200));
  for (const id of ['web-filters-enabled', 'start-current']) nodes.get(id).checked = /\bchecked\b/.test(html.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`))?.[0] || '');
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const node = nodes.get(match[2].match(/\bid="([^"]*)"/)?.[1]);
    if (node) for (const attribute of match[2].matchAll(/\b([\w-]+)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
  }
  let state = initialState();
  const creators = Array.from({ length: count }, (_, index) => ({ id: String(index + 1), name: `达人${index + 1}`, chatAvailable: true }));
  let workspace = { pageId: 'page', shop: unread ? null : { id: '700', name: '测试店铺' }, creators: unread ? [] : creators, error: unread ? '尚未登录' : null };
  const messages = [], downloads = [], blobs = [];
  const documentEvents = {};
  const windowEvents = {}, openedWindows = [], sessionValues = new Map(session);
  if (librarySelection) sessionValues.set('creatorLibrarySelection', JSON.stringify(librarySelection));
  const location = { href: '' };
  const mockWindow = { location, sessionStorage: { setItem: (k, v) => sessionValues.set(k, v), getItem: k => sessionValues.get(k) ?? null, removeItem: k => sessionValues.delete(k) }, open: () => { const w = {}; openedWindows.push(w); return w; }, addEventListener: (type, fn) => { windowEvents[type] = fn; } };
  let onPreview = null;
  let onCollect = null, onSelection = null, periodic = null;
  let onTemplate = templateHandler, onGet = getHandler, onResolve = null, templateId = 0;
  let storedTemplates = structuredClone(templates);
  let storedImages = structuredClone(assets), onImage = imageHandler, onFileReader = fileReaderHandler, imageId = 0;
  let onDecode = decodeHandler, timerId = 0;
  const imageTimers = new Map();
  const bitmaps = [], bitmapCalls = [], canvasDraws = [];
  const current = () => ({ state: structuredClone(state), workspace: structuredClone(workspace), ...(legacy ? {} : { capabilities: { targetCount: true, dualMessage: true, messageSequence: true, sourceSelection: true, imageMessages: imageCapability, candidateSelection: true } }) });
  const previewConfig = config => config.messages ? { sendableCount: config.creators.length, items: config.creators.map(creator => ({ ...creator, status: 'pending', messages: config.messages.map(message => message.content), messageIndex: 0, submittedCount: 0 })) } : previewTask(state, config);
  const sendMessage = async message => {
    messages.push(structuredClone(message));
    if (['panel:select', 'panel:refill-selection', 'panel:reset-selection', 'panel:extend-candidates'].includes(message.type)) {
      if (onSelection) { const response = await onSelection(message, current()); if (response !== undefined) return response; }
      const c = workspace.collection;
      assert.equal(message.collectionId, c.id); assert.equal(message.expectedRevision, c.selectionRevision);
      workspace.collection = message.type === 'panel:select' ? selectCandidate(c, message.creatorId, message.selected) : message.type === 'panel:refill-selection' ? refillSelection(c) : message.type === 'panel:reset-selection' ? resetSelection(c) : {...c,status:'collecting',candidateTarget:120};
      return {ok:true, ...current()};
    }
    if (message.type === 'panel:filters') return filterHandler ? filterHandler(message) : { ok: true, pageFilters: { supported: { category: true, channel: true }, current: { category: 'all', channel: 'all' }, options: { categories: [{ value: 'all', label: '全部' }, { value: 'beauty', label: 'Beauty' }], channels: [{ value: 'all', label: '全部' }, { value: 'video', label: 'Shopee Video' }] } } };
    if (message.type.startsWith('panel:library-')) return libraryHandler ? libraryHandler(message) : { ok: false, error: '达人库版本已变化，请重新选择' };
    if (isImageMessage(message)) {
      if (onImage) { const reply = await onImage(message); if (reply !== undefined) return reply; }
      if (message.type === 'panel:image-list') return imageListReply(storedImages);
      if (message.type === 'panel:image-get') { const asset = storedImages.find(asset => asset.id === message.assetId); return asset ? { ok: true, imageAsset: structuredClone(asset) } : { ok: false, error: '图片不存在，请重新选择图片' }; }
      if (message.type === 'panel:image-add') {
        const asset = imageAsset(`imported-${++imageId}`, { ...message.draft });
        storedImages.push(asset);
        return { ...imageListReply(storedImages), imageAsset: structuredClone(asset), assetId: asset.id };
      }
      throw new Error('未声明的图片接口');
    }
    if (isTemplateMessage(message)) {
      if (onTemplate) { const response = await onTemplate(message); if (response !== undefined) return response; }
      if (message.type === 'panel:template-list') return templateReply(storedTemplates);
      let record;
      if (message.type === 'panel:template-create') record = savedTemplate(`saved-new-${++templateId}`, message.draft);
      if (message.type === 'panel:template-update') {
        const previous = storedTemplates.find(item => item.id === message.templateId);
        assert.ok(previous, '更新需指定已存模板');
        record = { ...previous, ...message.draft, revision: previous.revision + 1 };
        storedTemplates = storedTemplates.filter(item => item.id !== record.id);
      }
      if (message.type === 'panel:template-copy') {
        const previous = storedTemplates.find(item => item.id === message.templateId);
        assert.ok(previous, '复制需指定已存模板');
        record = { ...previous, id: `saved-copy-${++templateId}`, name: `${previous.name} · 副本`, revision: 1 };
      }
      assert.ok(record, '只接受模板契约内的操作');
      storedTemplates.push(record);
      return templateReply(storedTemplates, record.id);
    }
    if (message.type === 'panel:get' && onGet) { const response = await onGet(message, { ok: true, ...current() }); if (response !== undefined) return response; }
    if (message.type === 'panel:resolve' && onResolve) { const response = await onResolve(message); if (response !== undefined) return response; }
    if (message.type === 'panel:export-diagnostics') return { ok: true, diagnostics: { version: 1, events: [{ event: 'panel:pause', at: 1000 }], summary: { task: null } } };
    if (message.type === 'panel:collect' && onCollect) await onCollect(message.targetCount, structuredClone(message.source));
    if (message.type === 'panel:cancel-collection' && workspace.collection) workspace.collection = { ...workspace.collection, status: 'cancelled', reason: '用户取消准备' };
    if (message.type === 'panel:preview') {
      const preview = previewConfig(message.config);
      if (onPreview) await onPreview();
      return { ok: true, ...current(), preview, previewToken: 'once' };
    }
    if (message.type === 'panel:start') state.task = { id: 'task', sessionId: 'session', status: 'running', config: message.config, items: previewConfig(message.config).items };
    return { ok: true, ...current() };
  };
  class LocalFileReader {
    readAsDataURL(file) { Promise.resolve().then(async () => { if (onFileReader) return onFileReader(file); if (file.error) throw new Error(file.error); return file.dataUrl || PNG_DATA; }).then(result => { this.result = result; this.onload?.(); }, () => this.onerror?.()); }
  }
  class LocalImage {
    constructor() { this.naturalWidth = this.naturalHeight = 1; }
    set src(value) { this.url = value; Promise.resolve().then(() => onDecode?.(value)).then(() => this.onload?.(), () => this.onerror?.()); }
    get src() { return this.url; }
    decode() { return imageDecodeMethod ? imageDecodeMethod() : Promise.resolve(); }
  }
  const decodeBitmap = async (blob, options) => {
    bitmapCalls.push({ blob, options: structuredClone(options) });
    const value = await bitmapHandler?.(blob, options);
    const bitmap = { width: 1, height: 1, ...value, closed: false, close() { this.closed = true; } }; bitmaps.push(bitmap); return bitmap;
  };
  vm.runInNewContext(source, { ...historyWindow, ...messageRules, taskElapsedMs, formatDuration, Date: class extends Date { static now() { return clock(); } }, document: { body: new Element('body'), visibilityState: 'visible', addEventListener(type, callback) { documentEvents[type] = callback; }, getElementById: id => nodes.get(id) || null, createElement: tag => { const element = new Element(tag, (id, node) => nodes.set(id, node)); element.click = () => downloads.push({ filename: element.download, href: element.href }); if (tag === 'canvas') element.getContext = () => ({ drawImage(...args) { canvasDraws.push(args); }, getImageData() { return { data: new Uint8ClampedArray(4) }; } }); return element; } }, chrome: { runtime: { sendMessage, id: 'demo', getURL: p => 'chrome-extension://demo/' + p } }, window: mockWindow, setInterval(callback) { periodic = callback; }, clearInterval() {}, setTimeout(callback, delay) { if (delay >= 10000) { const id = ++timerId; imageTimers.set(id, callback); return id; } callback(); return 0; }, clearTimeout(id) { imageTimers.delete(id); }, URL: class extends URL { static createObjectURL(blob) { blobs.push(blob); return 'blob:diagnostics'; } static revokeObjectURL() {} }, Blob, FileReader: LocalFileReader, Image: LocalImage, atob: value => Buffer.from(value, 'base64').toString('binary'), ...(bitmapCapability ? { createImageBitmap: decodeBitmap } : {}) });
  await settle();
  return {
    nodes, messages, downloads, blobs, bitmaps, bitmapCalls, canvasDraws, openedWindows, sessionValues, location, rows: () => nodes.get('roster-body').children,
    async fire(id, type = 'click', values) { assert.ok(nodes.has(id), `缺少控件 ${id}`); nodes.get(id).fire(type, values); await settle(); },
    async chooseFilter(id, value) { const group = nodes.get(`${id}-options`); const button = group?.children.find(node => node.dataset.value === value); assert.ok(button, `缺少筛选选项 ${id}=${value}`); button.fire('click'); await settle(); return button; },
    replaceRoster(count) { workspace.creators = workspace.creators.slice(0, count); },
    changeShop() { workspace = { ...workspace, shop: { id: '701', name: '另一店铺' } }; },
    shopReady() { workspace = { ...workspace, shop: { id: '700', name: '测试店铺' }, creators, error: null }; },
    disconnectPage() { workspace = { ...workspace, pageId: null, error: '页面加载中' }; },
    reconnectPage() { workspace = { ...workspace, pageId: 'page-2', error: null }; },
    async show() { documentEvents.visibilitychange?.(); await settle(); },
    previewHook(hook) { onPreview = hook; },
    collectHook(hook) { onCollect = hook; },
    selectionHook(hook) { onSelection = hook; },
    setCandidates(target = 100, amount = 110) {
      const candidates = workspace.creators.slice(0, amount), chosen = candidates.slice(0, target);
      workspace.collection = {id:'candidates',target,selectionVersion:1,selectionRevision:0,selectionInitialized:true,status:'ready',
        candidates,candidateTarget:Math.min(200,target+Math.ceil(target/10)),candidateCount:amount,candidateShortfall:0,
        creators:chosen,selectedIds:chosen.map(row=>row.id),count:chosen.length,shortfall:0,selectedCount:chosen.length,selectionRemaining:0,
        excludedIds:[],unavailableIds:[],binding:{shopId:workspace.shop.id},source:{type:'marketplace',creatorIds:[],nameIncludes:'',nameExcludes:''}};
    },
    templateHook(hook) { onTemplate = hook; },
    getHook(hook) { onGet = hook; },
    resolveHook(hook) { onResolve = hook; },
    imageHook(hook) { onImage = hook; },
    fileReaderHook(hook) { onFileReader = hook; },
    decodeHook(hook) { onDecode = hook; },
    async expireImageOperations() { for (const callback of [...imageTimers.values()]) callback(); await settle(); },
    getState() { return structuredClone(state); },
    getWorkspace() { return structuredClone(workspace); },
    messageRows() { return nodes.get('message-editor')?.children || []; },
    async message(index, role, type = 'click', values) { const node = descendants(nodes.get('message-editor')?.children[index] || new Element()).find(node => node.dataset.role === role); assert.ok(node, `消息${index + 1}缺少${role}`); node.fire(type, values); await settle(); },
    setTask(task) { state.task = structuredClone(task); },
    collectionStats(values) { Object.assign(workspace.collection, values); },
    setPreparation(preparation) { workspace.preparation = structuredClone(preparation); },
    async poll() { periodic(); await settle(); },
    setCollection(status, target = count, amount = target, rows = workspace.creators.slice(0, amount)) {
      const type = nodes.get('source-type').value, webpage = ['marketplace', 'leaderboard'].includes(type);
      const category = nodes.get('web-filter-category-options'), channel = nodes.get('web-filter-channel-options');
      const selected = group => group.children.find(node => node.getAttribute('aria-checked') === 'true')?.dataset.value || '';
      const source = {
        type, creatorIds: type === 'specified' ? [...new Set(nodes.get('source-ids').value.split(/[,，\s]+/).filter(Boolean))] : [],
        nameIncludes: nodes.get('source-includes').value.trim(), nameExcludes: nodes.get('source-excludes').value.trim(),
        ...(webpage && nodes.get('web-filters-enabled').checked && (category.children.length || channel.children.length)
          ? { webFilters: { category: selected(category), channel: selected(channel) } } : {}),
        ...(webpage && nodes.get('start-current').checked ? { startPosition: 'current' } : {}),
      };
      workspace.collection = { id: 'collection', target, count: amount, shortfall: target - amount, status, creators: rows, source, binding: { shopId: workspace.shop.id, documentId: 'doc' }, reason: status === 'insufficient' ? `仍缺 ${target - amount} 人；不能启动` : null };
    },
  };
}

test('没有任务或页面未连接时也可一键导出排查日志，下载不触发发送或恢复', async () => {
  const ui = await dashboard(1, { unread: true });
  assert.equal(ui.nodes.get('export-diagnostics')?.disabled, false);
  await ui.fire('export-diagnostics');
  assert.deepEqual(ui.messages.filter(m => m.type !== 'panel:get' && !isTemplateMessage(m)).map(m => m.type), ['panel:export-diagnostics']);
  assert.match(ui.downloads[0]?.filename || '', /虾仁-排查日志-.*\.json$/);
  const report = JSON.parse(await ui.blobs[0].text());
  assert.equal(report.events[0].event, 'panel:pause');
  assert.match(ui.nodes.get('notice').textContent, /排查日志/);
});
async function ready(ui, mode = 'dry-run', target = Number(ui.nodes.get('limit').value)) {
  await ui.message(0, 'content', 'input', { value: 'Halo {{name}}, 合作邀请' });
  await ui.message(1, 'type', 'change', { value: 'link' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/1/2' });
  await ui.fire('interval', 'input', { value: '30' });
  await ui.fire('limit', 'input', { value: String(target) });
  await ui.fire('mode', 'change', { value: mode });
  await ui.fire('message-next');
}

test('任务总耗时随现有轮询增长，暂停也计时，结束后固定且不新增后台操作', async () => {
  let now = 1000;
  const ui = await dashboard(1, { clock: () => now });
  assert.equal(ui.nodes.get('queue-duration')?.hidden, true);
  const config = { shop: { id: '700', name: '测试店铺' }, messages: [{ type: 'text', content: '邀请' }], intervalSeconds: 10, limit: 1, mode: 'send' };
  const task = { id: 'timed-task', status: 'running', createdAt: 1000, updatedAt: 1000, config, items: [] };
  ui.setTask(task); now = 63000; await ui.poll();
  assert.equal(ui.nodes.get('queue-duration').hidden, false);
  assert.match(ui.nodes.get('queue-duration').textContent, /任务总耗时：1 分 02 秒/);
  ui.setTask({ ...task, status: 'paused', updatedAt: 63000 }); now = 91000; await ui.poll();
  assert.match(ui.nodes.get('queue-duration').textContent, /1 分 30 秒/);
  ui.setTask({ ...task, status: 'completed', updatedAt: 92000 }); now = 200000; await ui.poll();
  assert.match(ui.nodes.get('queue-duration').textContent, /1 分 31 秒/);
  now = 400000; await ui.poll();
  assert.match(ui.nodes.get('queue-duration').textContent, /1 分 31 秒/);
  assert.equal(ui.messages.every(message => ['panel:get', 'panel:template-list'].includes(message.type)), true);
  assert.match(html, /包含逐人间隔和暂停时间/);
});

test('新任务默认真实发送，仍须准备名单并手动确认才能启动', async () => {
  const ui = await dashboard(1);
  assert.equal(ui.nodes.get('mode').value, 'send');
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.message(0, 'content', 'input', { value: '合作邀请' });
  await ui.message(1, 'type', 'change', { value: 'link' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/1/2' });
  await ui.fire('message-next');
  ui.setCollection('ready'); await ui.poll();
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.fire('start-button');
  assert.equal(ui.messages.some(message => message.type === 'panel:start'), false);
  await ui.fire('send-consent', 'change', { checked: true });
  assert.equal(ui.nodes.get('start-button').disabled, false);
  await ui.fire('start-button');
  assert.equal(ui.messages.find(message => message.type === 'panel:start')?.config.mode, 'send');
});

test('网页筛选和当前位置首次默认勾选，取消后轮询与再次进入本步都不强勾', async () => {
  const ui = await dashboard();
  await ready(ui);
  assert.equal(ui.nodes.get('web-filters-enabled').checked, true);
  assert.equal(ui.nodes.get('start-current').checked, true);
  await ui.fire('web-filters-enabled', 'change', { checked: false });
  await ui.fire('start-current', 'change', { checked: false });
  await ui.poll(); await ui.fire('message-back'); await ui.fire('message-next'); await ui.poll();
  assert.equal(ui.nodes.get('web-filters-enabled').checked, false);
  assert.equal(ui.nodes.get('start-current').checked, false);
  assert.equal(ui.nodes.get('send-consent').checked, false);
});

test('首次读取筛选默认勾选，来源切换和用户取消不会被悄悄改回', async () => {
  let rail = 'marketplace';
  const ui = await dashboard(23, { filterHandler: () => ({
    ok: true,
    pageFilters: { supported: { category: true, channel: true }, current: { category: rail === 'marketplace' ? 'all' : 'rank', channel: 'all' }, options: { categories: [{ value: rail === 'marketplace' ? 'all' : 'rank', label: rail === 'marketplace' ? '全部' : '排行类目' }], channels: [{ value: 'all', label: '全部' }] } },
  }) });
  await ready(ui); await ui.poll();
  assert.equal(ui.nodes.get('web-filters-enabled').checked, true);
  assert.equal(ui.nodes.get('start-current').checked, true);
  await ui.fire('web-filters-enabled', 'change', { checked: false });
  await ui.fire('start-current', 'change', { checked: false });
  ui.setCollection('ready'); await ui.poll();
  assert.equal(ui.nodes.get('web-filters-enabled').checked, false);
  assert.equal(ui.nodes.get('start-current').checked, false);
  rail = 'leaderboard';
  await ui.fire('source-type', 'change', { value: 'leaderboard' });
  await ui.fire('web-filters-enabled', 'change', { checked: false });
  await ui.fire('start-current', 'change', { checked: false });
  assert.equal(ui.nodes.get('web-filters-enabled').checked, false);
  assert.equal(ui.nodes.get('start-current').checked, false);
  await ui.poll();
  assert.equal(ui.nodes.get('web-filters-enabled').checked, false);
  assert.equal(ui.nodes.get('start-current').checked, false);
  const fresh = await dashboard();
  assert.equal(fresh.nodes.get('web-filters-enabled').checked, true);
  assert.equal(fresh.nodes.get('start-current').checked, true);
});

test('网页筛选读取成功不会把用户取消的当前位置重新勾回', async () => {
  const first = deferred(), second = deferred();
  let reads = 0;
  const ui = await dashboard(23, { filterHandler: () => ++reads === 1 ? first.promise : second.promise });
  await ready(ui);
  first.resolve({ ok: true, pageFilters: { supported: { category: true, channel: true }, current: { category: 'all', channel: 'all' }, options: { categories: [{ value: 'all', label: '全部' }], channels: [{ value: 'all', label: '全部' }] } } }); await settle();
  assert.equal(ui.nodes.get('web-filters-enabled').disabled, false);
  await ui.fire('start-current', 'change', { checked: false });
  assert.equal(ui.nodes.get('start-current').checked, false);
  await ui.fire('web-filter-refresh');
  second.resolve({ ok: true, pageFilters: { supported: { category: true, channel: true }, current: { category: 'all', channel: 'all' }, options: { categories: [{ value: 'all', label: '全部' }], channels: [{ value: 'all', label: '全部' }] } } }); await settle();
  assert.equal(ui.nodes.get('start-current').checked, false);
  assert.equal(ui.nodes.get('web-filters-enabled').checked, true);
});

test('锁定名单每页10人，跨页不会改动人数或丢失锁定状态', async () => {
  const ui = await dashboard();
  await ready(ui);
  ui.setCollection('ready'); await ui.poll();
  ui.setCollection('ready'); await ui.poll();
  assert.equal(ui.rows().length, 10);
  assert.equal(ui.nodes.get('selection-count').textContent, '已准备 23 / 23 人');
  await ui.fire('roster-next');
  assert.equal(ui.rows().length, 10);
  assert.match(ui.rows()[0].textContent, /达人11/);
  await ui.fire('roster-next');
  assert.equal(ui.rows().length, 3);
  assert.equal(ui.nodes.get('roster-next').disabled, true);
  await ui.fire('roster-previous'); await ui.fire('roster-previous');
  assert.equal(ui.rows()[0].children[0].children[0].checked, true);
  assert.equal(ui.rows()[0].children[0].children[0].disabled, true);
  assert.equal(ui.nodes.get('selection-count').textContent, '已准备 23 / 23 人');
});

test('产品链接单独预览并随配置锁定，修改链接撤销发送确认', async () => {
  const ui = await dashboard();
  await ready(ui, 'send'); await ui.fire('message-back');
  ui.setCollection('ready'); await ui.poll();
  assert.equal(ui.nodes.get('preview-link').textContent, 'https://shopee.co.id/product/1/2');
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/3/4' });
  await ui.fire('message-next');
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.fire('start-button');
  assert.equal(ui.messages.find(m => m.type === 'panel:start').config.messages[1].content, 'https://shopee.co.id/product/3/4');
  assert.equal(ui.nodes.get('settings-fields').disabled, true);
});

test('名单状态自动更新后收回到有效页码，翻页不改消息配置', async () => {
  const ui = await dashboard();
  await ready(ui);
  ui.setCollection('ready'); await ui.poll();
  await ui.fire('message-back');
  await ui.message(0, 'content', 'input', { value: '保留此消息' });
  await ui.fire('roster-next'); await ui.fire('roster-next');
  ui.replaceRoster(3); await ui.poll();
  assert.equal(ui.rows().length, 3);
  assert.equal(ui.nodes.get('roster-previous').disabled, false);
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '保留此消息');
  ui.replaceRoster(0); await ui.poll();
  assert.equal(ui.rows().length, 3);
});

test('打开专用页后可直接准备，自动识别店铺，不需要读取按钮或读取请求', async () => {
  const ui = await dashboard(100, { unread: true });
  assert.equal(ui.nodes.has('refresh-list'), false);
  await ready(ui);
  assert.equal(ui.nodes.get('prepare-list').disabled, false);
  ui.collectHook(target => { ui.shopReady(); ui.setCollection('ready', target); });
  await ui.fire('prepare-list');
  assert.deepEqual(ui.messages.filter(m => !['panel:get', 'panel:filters'].includes(m.type) && !isTemplateMessage(m)).map(m => m.type), ['panel:collect']);
  assert.equal(ui.nodes.get('shop-name').textContent, '测试店铺');
  await ui.poll();
  assert.equal(ui.nodes.get('start-button').disabled, false);
});

test('切店铺后可直接重新准备，发送确认仍需重新勾选', async () => {
  const ui = await dashboard(100);
  await ready(ui, 'send');
  ui.setCollection('ready'); await ui.poll();
  await ui.fire('send-consent', 'change', { checked: true });
  ui.changeShop(); ui.setCollection('invalid'); await ui.poll();
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.nodes.get('prepare-list').disabled, false);
  ui.collectHook(target => ui.setCollection('ready', target));
  await ui.fire('prepare-list');
  assert.equal(ui.nodes.get('send-consent').disabled, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.fire('message-next');
  await ui.fire('send-consent', 'change', { checked: true });
  assert.equal(ui.nodes.get('start-button').disabled, false);
  assert.equal(ui.messages.some(m => m.type === 'panel:refresh'), false);
});

test('专用页尚未连接时提示等待，不能用旧店铺状态准备名单', async () => {
  const ui = await dashboard(100);
  ui.disconnectPage(); await ui.poll();
  assert.equal(ui.nodes.get('prepare-list').disabled, true);
  await ui.fire('prepare-list');
  assert.equal(ui.messages.some(m => m.type === 'panel:collect'), false);
  assert.match(ui.nodes.get('notice').textContent, /加载|连接|专用/);
});

test('从专用页切回工作台时立即刷新连接状态，不等待后台页节流后的定时器', async () => {
  const ui = await dashboard(100); await ready(ui);
  ui.disconnectPage(); await ui.poll();
  assert.equal(ui.nodes.get('prepare-list').disabled, true);
  ui.reconnectPage(); await ui.show();
  assert.equal(ui.nodes.get('prepare-list').disabled, false);
  assert.equal(ui.nodes.get('connection-state').textContent, '专用页面已连接');
});

test('发送人数只接受1到200整数，改人数不能复用旧锁定名单', async () => {
  const ui = await dashboard(201);
  ui.setCollection('ready', 200, 200); await ui.poll();
  await ready(ui);
  for (const value of ['0', '-1', '1.5', '201', '', '199']) {
    await ui.fire('limit', 'input', { value });
    assert.equal(ui.nodes.get('start-button').disabled, true);
  }
  assert.equal(ui.messages.some(message => message.type === 'panel:start'), false);
});

test('内容随模板实时预览，无生成按钮或逐人切换；启动自动校验最新配置', async () => {
  const ui = await dashboard();
  assert.equal(ui.nodes.has('preview-button'), false);
  assert.equal(ui.nodes.has('preview-person'), false);
  ui.setCollection('ready'); await ui.poll();
  await ready(ui); ui.setCollection('ready'); await ui.poll();
  assert.equal(ui.nodes.get('preview-message').textContent, 'Halo 达人1, 合作邀请');
  assert.equal(ui.messages.some(message => message.type === 'panel:preview'), false);
  assert.equal(ui.nodes.get('start-button').disabled, false);
  await ui.message(0, 'content', 'input', { value: '最新邀请 {{name}}' });
  await ui.fire('start-button');
  assert.deepEqual(ui.messages.filter(message => ['panel:preview', 'panel:start'].includes(message.type)).map(message => message.type), ['panel:preview', 'panel:start']);
  assert.equal(ui.messages.find(message => message.type === 'panel:start').config.messages[0].content, '最新邀请 {{name}}');
});

test('真实任务明确说明提交后继续，不要求送达或已读回执', async () => {
  const ui = await dashboard();
  ui.setCollection('ready'); await ui.poll(); await ready(ui, 'send');
  assert.match(ui.nodes.get('mode-help').textContent, /提交.*间隔.*下一位/);
  assert.match(ui.nodes.get('mode-help').textContent, /不等待.*送达.*已读/);
});

test('真实发送仍须确认；改配置撤销确认，启动核对中切店铺则不能发送', async () => {
  const ui = await dashboard();
  ui.setCollection('ready'); await ui.poll();
  await ready(ui, 'send');
  ui.setCollection('ready'); await ui.poll();
  assert.match(ui.nodes.get('settings-note').textContent, /真实发送/);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.fire('send-consent', 'change', { checked: true });
  assert.equal(ui.nodes.get('start-button').disabled, false);
  await ui.fire('message-back');
  await ui.message(0, 'content', 'input', { value: '修改后需重新确认' });
  assert.equal(ui.nodes.get('send-consent').checked, false);
  await ui.fire('message-next');
  await ui.fire('send-consent', 'change', { checked: true });
  ui.previewHook(() => ui.changeShop());
  await ui.fire('start-button');
  assert.equal(ui.messages.some(message => message.type === 'panel:start'), false);
  assert.match(ui.nodes.get('notice').textContent, /变化|切换/);
});

test('目标人数：未备齐不能启动，准备100人的消息发给后台且显示差额', async () => {
  const ui = await dashboard(108);
  await ready(ui, 'dry-run', 100); // Filling a template cannot bypass preparation.
  assert.equal(ui.nodes.get('start-button').disabled, true);
  ui.collectHook(target => ui.setCollection('collecting', target, 12));
  await ui.fire('prepare-list');
  assert.equal(ui.messages.find(message => message.type === 'panel:collect').targetCount, 100);
  assert.match(ui.nodes.get('selection-count').textContent, /12.*100/);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.fire('cancel-preparation');
  assert.equal(ui.messages.some(message => message.type === 'panel:cancel-collection'), true);
  assert.equal(ui.nodes.get('start-button').disabled, true);
});

test('目标人数：准备后显示锁定100人，翻页只改变展示，启动交付完整名单', async () => {
  const ui = await dashboard(108);
  await ui.message(0, 'content', 'input', { value: 'Halo {{name}}' });
  await ui.message(1, 'type', 'change', { value: 'link' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/1/2' });
  await ui.fire('interval', 'input', { value: '30' });
  await ui.fire('limit', 'input', { value: '100' });
  await ui.fire('message-next');
  ui.setCollection('ready', 100, 100);
  await ui.poll();
  await ui.fire('roster-next');
  assert.equal(ui.rows().length, 10);
  await ui.fire('send-consent', 'change', { checked: true });
  assert.equal(ui.nodes.get('start-button').disabled, false);
  await ui.fire('start-button');
  const config = ui.messages.find(message => message.type === 'panel:start')?.config;
  assert.equal(config?.creators.length, 100);
  assert.equal(config?.collectionId, 'collection');
  assert.equal(config?.targetCount, 100);
  assert.equal(config?.limit, 100);
});

test('目标人数：准备状态失效会撤销发送确认，不能退回手选启动', async () => {
  const ui = await dashboard(100);
  await ready(ui, 'send');
  ui.setCollection('ready'); await ui.poll();
  await ui.fire('send-consent', 'change', { checked: true });
  assert.equal(ui.nodes.get('start-button').disabled, false);
  ui.setCollection('invalid'); await ui.poll();
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
});

test('目标人数：使用锁定名单而非工作区前200条，人数不足明确阻断', async () => {
  const ui = await dashboard(200);
  const locked = Array.from({ length: 100 }, (_, i) => ({ id: String(201 + i), name: `锁定达人${201 + i}`, chatAvailable: true }));
  await ui.message(0, 'content', 'input', { value: 'Halo {{name}}' });
  await ui.message(1, 'type', 'change', { value: 'link' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/1/2' });
  await ui.fire('limit', 'input', { value: '100' });
  await ui.fire('message-next');
  ui.setCollection('ready', 100, 100, locked); await ui.poll();
  await ui.fire('send-consent', 'change', { checked: true });
  assert.match(ui.rows()[0].textContent, /锁定达人201/);
  await ui.fire('start-button');
  assert.equal(ui.messages.find(message => message.type === 'panel:start').config.creators[99].id, '300');
  const missing = await dashboard(12); await ready(missing, 'dry-run', 100);
  missing.collectHook(target => missing.setCollection('insufficient', target, 12));
  await missing.fire('limit', 'input', { value: '100' });
  await missing.fire('prepare-list');
  assert.match(missing.nodes.get('collection-reason').textContent, /仍缺 88/);
  assert.equal(missing.nodes.get('start-button').disabled, true);
  assert.equal(missing.nodes.get('prepare-list').disabled, false);
});

test('重新打开工作台能还原已准备的人数；重复轮询不撤销有效确认', async () => {
  const ui = await dashboard(100);
  ui.setCollection('ready', 50); await ui.poll();
  await ready(ui, 'send');
  assert.equal(ui.nodes.get('limit').value, '50');
  assert.equal(ui.nodes.get('limit').disabled, true);
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.poll();
  assert.equal(ui.nodes.get('send-consent').checked, true);
  assert.equal(ui.nodes.get('start-button').disabled, false);
});

test('工作台比已加载后台新时，就地提示重新加载，不发出后台不支持的准备请求', async () => {
  const ui = await dashboard(100, { legacy: true }); await ready(ui);
  assert.equal(ui.nodes.get('prepare-list').disabled, true);
  assert.match(ui.nodes.get('collection-reason').textContent, /后台.*未更新|重新加载/);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.fire('prepare-list');
  assert.equal(ui.messages.some(message => message.type === 'panel:collect'), false);
  assert.match(ui.nodes.get('notice').textContent, /重新加载/);
});

test('模板列表独立加载，不会让先前发出的业务轮询失效', async () => {
  const pending = deferred();
  const record = savedTemplate('saved-a', { name: '<img src=x onerror=alert(1)>' });
  const ui = await dashboard(23, { templates: [record], getHandler: (_message, reply) => pending.promise.then(() => reply) });
  await ready(ui);
  assert.deepEqual(ui.messages.map(message => message.type), ['panel:get', 'panel:template-list']);
  assert.equal(ui.nodes.get('message-template-select')?.children[1]?.textContent, record.name);
  pending.resolve(); await settle();
  assert.equal(ui.nodes.get('connection-state').textContent, '专用页面已连接');
  assert.equal(ui.nodes.get('prepare-list').disabled, false);
});

test('选中模板只改名称，显式套用更新两条预览、撤销确认并保留名单及其他配置', async () => {
  const record = savedTemplate();
  const ui = await dashboard(23, { templates: [record] });
  await ready(ui, 'send'); ui.setCollection('ready'); await ui.poll();
  await ui.fire('send-consent', 'change', { checked: true });
  const before = ui.getWorkspace();
  await ui.fire('message-template-select', 'change', { value: record.id });
  assert.equal(ui.nodes.get('message-template-name').value, record.name);
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, 'Halo {{name}}, 合作邀请');
  assert.equal(ui.nodes.get('send-consent').checked, true);
  await ui.fire('message-template-apply');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, record.template);
  assert.equal(descendants(ui.messageRows()[1]).find(node => node.dataset.role === 'content').value, record.productLink);
  assert.equal(ui.nodes.get('preview-message').textContent, '已存邀请 达人1');
  assert.equal(ui.nodes.get('preview-link').textContent, record.productLink);
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.deepEqual([ui.nodes.get('interval').value, ui.nodes.get('limit').value, ui.nodes.get('mode').value], ['30', '23', 'send']);
  assert.deepEqual(ui.getWorkspace(), before);
  assert.deepEqual(ui.messages.filter(message => !['panel:get', 'panel:filters'].includes(message.type)).map(message => message.type), ['panel:template-list']);
});

test('新建和更新只在保存成功后选中记录，复制使用保存内容并由后台生成名称', async () => {
  const ui = await dashboard();
  await ready(ui);
  await ui.fire('message-template-name', 'input', { value: '首轮邀请' });
  await ui.fire('message-template-create');
  const created = ui.nodes.get('message-template-select').value;
  assert.equal(created, 'saved-new-1');
  assert.deepEqual(ui.messages.find(message => message.type === 'panel:template-create').draft, { name: '首轮邀请', messages: [{ type: 'text', content: 'Halo {{name}}, 合作邀请' }, { type: 'link', content: 'https://shopee.co.id/product/1/2' }] });
  await ui.fire('message-template-name', 'input', { value: '修改后的邀请' });
  await ui.message(0, 'content', 'input', { value: '修改后的话术' });
  await ui.fire('message-template-update');
  assert.deepEqual(ui.messages.find(message => message.type === 'panel:template-update'), { type: 'panel:template-update', templateId: created, expectedRevision: 1, draft: { name: '修改后的邀请', messages: [{ type: 'text', content: '修改后的话术' }, { type: 'link', content: 'https://shopee.co.id/product/1/2' }] } });
  await ui.message(0, 'content', 'input', { value: '尚未保存的草稿' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/9/10' });
  await ui.fire('message-template-copy');
  assert.deepEqual(ui.messages.find(message => message.type === 'panel:template-copy'), { type: 'panel:template-copy', templateId: created, expectedRevision: 2 });
  assert.equal(ui.nodes.get('message-template-name').value, '修改后的邀请 · 副本');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '尚未保存的草稿');
  assert.equal(descendants(ui.messageRows()[1]).find(node => node.dataset.role === 'content').value, 'https://shopee.co.id/product/9/10');
  await ui.fire('message-template-apply');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '修改后的话术');
  assert.equal(descendants(ui.messageRows()[1]).find(node => node.dataset.role === 'content').value, 'https://shopee.co.id/product/1/2');
});

test('未完成任务与业务核对忙碌时锁定模板写入和套用，保留原任务配置', async () => {
  const record = savedTemplate();
  const ui = await dashboard(23, { templates: [record] });
  await ready(ui); ui.setCollection('ready'); await ui.poll();
  await ui.fire('message-template-select', 'change', { value: record.id });
  const pending = deferred();
  ui.previewHook(() => pending.promise);
  await ui.fire('start-button');
  for (const id of ['message-template-create', 'message-template-update', 'message-template-copy', 'message-template-apply']) {
    assert.equal(ui.nodes.get(id).disabled, true);
    await ui.fire(id);
  }
  assert.equal(ui.messages.some(message => ['panel:template-create', 'panel:template-update', 'panel:template-copy'].includes(message.type)), false);
  pending.resolve(); await settle();
  const config = ui.getState().task.config;
  for (const taskStatus of ['running', 'paused', 'stopped']) {
    const task = ui.getState().task; task.status = taskStatus; ui.setTask(task); await ui.poll();
    for (const id of ['message-template-create', 'message-template-update', 'message-template-copy', 'message-template-apply']) {
      assert.equal(ui.nodes.get(id).disabled, true);
      await ui.fire(id);
    }
    assert.deepEqual(ui.getState().task.config, config);
  }
});

test('准备名单期间允许套用模板，不改变准备进度、人数或间隔', async () => {
  const record = savedTemplate();
  const ui = await dashboard(23, { templates: [record] });
  await ready(ui); ui.setCollection('collecting', 23, 3); await ui.poll();
  const before = ui.getWorkspace();
  await ui.fire('message-template-select', 'change', { value: record.id });
  assert.equal(ui.nodes.get('message-template-apply').disabled, false);
  await ui.fire('message-template-apply');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, record.template);
  assert.equal(ui.nodes.get('limit').value, '23');
  assert.equal(ui.nodes.get('interval').value, '30');
  assert.deepEqual(ui.getWorkspace(), before);
});

test('模板写入失败保留原选择、名称及草稿，并显示改名或刷新方向', async () => {
  const record = savedTemplate();
  const ui = await dashboard(23, { templates: [record] });
  await ready(ui);
  await ui.fire('message-template-select', 'change', { value: record.id });
  await ui.fire('message-template-name', 'input', { value: '保留此名称' });
  for (const error of ['名称已存在，请改名', '模板版本已变化，请刷新模板']) {
    ui.templateHook(message => message.type === 'panel:template-update' ? { ok: false, error } : undefined);
    await ui.fire('message-template-update');
    assert.equal(ui.nodes.get('message-template-select').value, record.id);
    assert.equal(ui.nodes.get('message-template-name').value, '保留此名称');
    assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, 'Halo {{name}}, 合作邀请');
    assert.equal(descendants(ui.messageRows()[1]).find(node => node.dataset.role === 'content').value, 'https://shopee.co.id/product/1/2');
    assert.equal(ui.nodes.get('message-template-status').textContent.includes(error), true);
  }
});

test('迟到的模板列表保留后来选择、名称编辑与草稿，列表失败不影响业务启动', async () => {
  const a = savedTemplate(), b = savedTemplate('saved-b');
  const ui = await dashboard(23, { templates: [a, b] });
  await ready(ui); ui.setCollection('ready'); await ui.poll();
  const pending = deferred();
  ui.templateHook(message => message.type === 'panel:template-list' ? pending.promise : undefined);
  await ui.fire('message-template-refresh');
  await ui.fire('message-template-select', 'change', { value: b.id });
  await ui.fire('message-template-name', 'input', { value: '后来编辑的名称' });
  await ui.message(0, 'content', 'input', { value: '后来编辑的草稿' });
  pending.resolve(templateReply([a, { ...b, name: '后台的新名称' }])); await settle();
  assert.equal(ui.nodes.get('message-template-select').value, b.id);
  assert.equal(ui.nodes.get('message-template-name').value, '后来编辑的名称');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '后来编辑的草稿');
  ui.templateHook(() => ({ ok: true }));
  await ui.fire('message-template-refresh');
  assert.match(ui.nodes.get('message-template-status').textContent, /刷新|重新加载/);
  assert.equal(ui.nodes.get('start-button').disabled, false);
});

test('迟到的保存成功不能覆盖新选择或用户后来编辑的名称及草稿', async () => {
  const a = savedTemplate(), b = savedTemplate('saved-b'), created = savedTemplate('saved-new-1', { name: '请求时的名称' });
  const ui = await dashboard(23, { templates: [a, b] });
  await ready(ui); await ui.fire('message-template-name', 'input', { value: created.name });
  const pending = deferred();
  ui.templateHook(message => message.type === 'panel:template-create' ? pending.promise : undefined);
  await ui.fire('message-template-create');
  assert.equal(ui.nodes.get('message-template-select').value, '');
  await ui.fire('message-template-select', 'change', { value: b.id });
  await ui.fire('message-template-name', 'input', { value: '新的名称' });
  await ui.message(0, 'content', 'input', { value: '新的草稿' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/11/12' });
  pending.resolve(templateReply([a, b, created], created.id)); await settle();
  assert.equal(ui.nodes.get('message-template-select').value, b.id);
  assert.equal(ui.nodes.get('message-template-name').value, '新的名称');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '新的草稿');
  assert.equal(descendants(ui.messageRows()[1]).find(node => node.dataset.role === 'content').value, 'https://shopee.co.id/product/11/12');
  assert.equal(ui.nodes.get('message-template-select').children.some(option => option.value === created.id), true);
});

test('只在保存请求之后改名称，也不能被迟到的成功响应改回或自动选中新模板', async () => {
  const created = savedTemplate('saved-new-1', { name: '请求时名称' });
  const ui = await dashboard();
  await ready(ui); await ui.fire('message-template-name', 'input', { value: created.name });
  const pending = deferred();
  ui.templateHook(message => message.type === 'panel:template-create' ? pending.promise : undefined);
  await ui.fire('message-template-create');
  for (const id of ['message-template-create', 'message-template-update', 'message-template-copy', 'message-template-apply']) assert.equal(ui.nodes.get(id).disabled, true);
  await ui.fire('message-template-name', 'input', { value: '尚未保存的新名称' });
  pending.resolve(templateReply([created], created.id)); await settle();
  assert.equal(ui.nodes.get('message-template-name').value, '尚未保存的新名称');
  assert.equal(ui.nodes.get('message-template-select').value, '');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, 'Halo {{name}}, 合作邀请');
});

test('模板连续刷新只采用最新请求，迟到列表不会回退选中模板的保存版本', async () => {
  const record = savedTemplate(), oldList = deferred(), newList = deferred();
  const ui = await dashboard(23, { templates: [record] });
  await ready(ui); await ui.fire('message-template-select', 'change', { value: record.id });
  let count = 0;
  ui.templateHook(message => message.type === 'panel:template-list' ? (++count === 1 ? oldList.promise : newList.promise) : undefined);
  await ui.fire('message-template-refresh'); await ui.fire('message-template-refresh');
  newList.resolve(templateReply([{ ...record, revision: 2, template: '更新后的保存内容' }])); await settle();
  oldList.resolve(templateReply([record])); await settle();
  await ui.fire('message-template-apply');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '更新后的保存内容');
  ui.templateHook(message => message.type === 'panel:template-update' ? { ok: false, error: '测试已核对请求版本' } : undefined);
  await ui.fire('message-template-update');
  assert.equal(ui.messages.find(message => message.type === 'panel:template-update').expectedRevision, 2);
});

test('两步编排支持1到10条文字与链接，新增删除排序和重置均更新预览', async () => {
  const ui = await dashboard();
  assert.equal(ui.nodes.get('configuration-step')?.hidden, false);
  assert.equal(ui.nodes.get('audience-step')?.hidden, true);
  await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  assert.match(ui.nodes.get('notice').textContent, /消息/);
  await ready(ui);
  await ui.fire('message-back');
  await ui.fire('message-add');
  await ui.message(2, 'content', 'input', { value: '第三条' });
  await ui.message(2, 'up');
  assert.match(ui.nodes.get('message-preview-list').textContent, /第 2 条.*第三条/);
  await ui.message(1, 'remove');
  assert.equal(ui.messageRows().length, 2);
  for (let index = 2; index < 10; index++) await ui.fire('message-add');
  assert.equal(ui.messageRows().length, 10);
  assert.equal(ui.nodes.get('message-add').disabled, true);
  await ui.fire('message-add');
  assert.equal(ui.messageRows().length, 10);
  await ui.fire('message-reset');
  assert.equal(ui.messageRows().length, 1);
  assert.match(ui.messageRows()[0].textContent, /0 \/ 2400/);
  assert.match(html, /PNG.*JPEG.*2\s*MiB/);
});

test('单文字消息允许2400字，插入姓名变量，启动仅发送规范化messages和可选任务名', async () => {
  const ui = await dashboard();
  ui.setCollection('ready'); await ui.poll();
  await ui.message(1, 'remove');
  await ui.message(0, 'content', 'input', { value: 'a'.repeat(2400) });
  await ui.fire('interval', 'input', { value: '30' });
  await ui.fire('task-name', 'input', { value: ' 新品邀请 ' });
  await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, false);
  await ui.fire('message-back');
  await ui.message(0, 'content', 'input', { value: 'Halo ', selectionStart: 5, selectionEnd: 5 });
  await ui.message(0, 'variable');
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, 'Halo {{name}}');
  await ui.fire('message-next'); await ui.fire('send-consent', 'change', { checked: true }); await ui.fire('start-button');
  const config = ui.messages.find(message => message.type === 'panel:start').config;
  assert.deepEqual(config.messages, [{ type: 'text', content: 'Halo {{name}}' }]);
  assert.equal(config.template, undefined); assert.equal(config.productLink, undefined);
  assert.equal(config.taskName, '新品邀请');
});

test('指定来源按Shopee用户ID去重计数并携带名称条件，来源变化立即使旧名单失效', async () => {
  const ui = await dashboard();
  ui.setCollection('ready'); await ui.poll(); await ready(ui, 'send');
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.fire('source-type', 'change', { value: 'specified' });
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.rows().length, 0);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  await ui.fire('source-ids', 'input', { value: '100, 200\n100，300' });
  await ui.fire('source-includes', 'input', { value: ' beauty ' });
  await ui.fire('source-excludes', 'input', { value: ' bot ' });
  ui.collectHook(target => ui.setCollection('ready', target, target));
  await ui.fire('prepare-list');
  const collect = ui.messages.findLast(message => message.type === 'panel:collect');
  assert.deepEqual(collect.source, { type: 'specified', creatorIds: ['100', '200', '300'], nameIncludes: 'beauty', nameExcludes: 'bot' });
  assert.equal(collect.targetCount, 3);
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.fire('start-button');
  assert.deepEqual(ui.messages.find(message => message.type === 'panel:start').config.source, collect.source);
});

test('指定来源拒绝非数字和超过200个ID，返回空来源不能借旧名单启动', async () => {
  const ui = await dashboard(); await ready(ui);
  await ui.fire('source-type', 'change', { value: 'specified' });
  await ui.fire('source-ids', 'input', { value: 'affiliate-A' }); await ui.fire('prepare-list');
  assert.match(ui.nodes.get('notice').textContent, /Shopee.*用户.*ID/);
  await ui.fire('source-ids', 'input', { value: Array.from({ length: 201 }, (_, i) => String(i + 1)).join(',') }); await ui.fire('prepare-list');
  assert.match(ui.nodes.get('notice').textContent, /200/);
  assert.equal(ui.messages.some(message => message.type === 'panel:collect'), false);
});

test('排行榜来源显式交付后台，按锁定顺序启动且切换来源撤销确认', async () => {
  const ui = await dashboard(); await ready(ui);
  await ui.fire('source-type', 'change', { value: 'leaderboard' });
  await ui.fire('open-page');
  assert.equal(ui.messages.findLast(message => message.type === 'panel:open').source.type, 'leaderboard');
  ui.collectHook(target => ui.setCollection('ready', target, target));
  await ui.fire('prepare-list'); await ui.fire('start-button');
  assert.equal(ui.messages.findLast(message => message.type === 'panel:start').config.source.type, 'leaderboard');
});

test('选择排行榜即自动打开专用榜单并读取分类与社媒，名称搜索不出现也不提交', async () => {
  const ui = await dashboard(); await ready(ui);
  assert.equal(html.includes('Shopee 达人名称搜索'), false);
  await ui.fire('source-type', 'change', { value: 'leaderboard' });
  assert.equal(ui.messages.findLast(message => message.type === 'panel:open')?.source.type, 'leaderboard');
  assert.ok(ui.messages.some(message => message.type === 'panel:filters'));
  assert.deepEqual(ui.nodes.get('web-filter-category-options').children.map(option => option.dataset.value), ['all', 'beauty']);
  assert.deepEqual(ui.nodes.get('web-filter-category-options').children.map(option => option.getAttribute('role')), ['radio', 'radio']);
  const beauty = await ui.chooseFilter('web-filter-category', 'beauty');
  assert.equal(beauty.getAttribute('aria-checked'), 'true');
  assert.equal(ui.nodes.get('web-filter-category-options').children[0].getAttribute('aria-checked'), 'false');
  await ui.chooseFilter('web-filter-channel', 'video');
  assert.deepEqual(ui.nodes.get('web-filter-category-options').children.map(option => option.getAttribute('aria-checked')), ['false', 'true']);
  await ui.fire('start-current', 'change', { checked: true });
  ui.collectHook(target => ui.setCollection('ready', target)); await ui.fire('prepare-list');
  const collect = ui.messages.findLast(message => message.type === 'panel:collect');
  assert.deepEqual(collect.source.webFilters, { category: 'beauty', channel: 'video' });
  assert.equal(collect.source.startPosition, 'current');
  assert.equal(ui.nodes.get('start-button').disabled, false);
});

test('读取网页筛选前禁止选择，加载完成后按页面能力禁用不支持的条件，改变筛选撤销锁定', async () => {
  const reply = deferred();
  const ui = await dashboard(23, { filterHandler: () => reply.promise }); await ready(ui, 'send');
  assert.equal(ui.nodes.get('web-filters-enabled')?.disabled, true);
  assert.match(ui.nodes.get('web-filter-status')?.textContent || '', /读取|等待/);
  reply.resolve({ ok: true, pageFilters: { supported: { category: false, channel: true }, current: { category: '', channel: 'all' }, options: { categories: [], channels: [{ value: 'all', label: '全部' }] } } }); await settle();
  assert.equal(ui.nodes.get('web-filter-category-options').getAttribute('aria-disabled'), 'true');
  assert.ok(ui.nodes.get('web-filter-category-options').children.every(option => option.disabled));
  assert.equal(ui.nodes.get('web-filter-channel-options').getAttribute('aria-disabled'), 'false');
  assert.ok(ui.nodes.get('web-filter-channel-options').children.every(option => !option.disabled));
  ui.collectHook(target => ui.setCollection('ready', target)); await ui.fire('prepare-list');
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.chooseFilter('web-filter-channel', 'all');
  assert.equal(ui.nodes.get('send-consent').checked, true);
  await ui.fire('web-filter-refresh');
  await ui.fire('web-filters-enabled', 'change', { checked: false });
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  assert.equal(ui.rows().length, 0);
});

test('旧锁定名单含名称搜索仍可使用，预览和启动提交原锁定来源', async () => {
  const ui = await dashboard(); await ready(ui); ui.setCollection('ready');
  const source = { ...ui.getWorkspace().collection.source, webFilters: { category: 'all', channel: 'all', search: '旧名称' } };
  ui.collectionStats({ source }); await ui.poll();
  assert.equal(ui.nodes.get('start-button').disabled, false);
  await ui.fire('start-button');
  for (const type of ['panel:preview', 'panel:start']) assert.deepEqual(ui.messages.findLast(message => message.type === type)?.config.source, source);
});

test('队列独立每页10人，轮询不跳页，新任务复位且待核对可直接定位', async () => {
  const ui = await dashboard(); await ready(ui); ui.setCollection('ready'); await ui.poll(); await ui.fire('start-button');
  const queue = () => ui.nodes.get('queue-items').children;
  assert.equal(queue().length, 10);
  assert.match(ui.nodes.get('queue-range').textContent, /第 1—10 位.*共 23 人/);
  await ui.fire('queue-next'); await ui.poll();
  assert.match(queue()[0].textContent, /达人11/);
  assert.match(ui.nodes.get('queue-page').textContent, /第 2 \/ 3 页/);
  const task = ui.getState().task; task.status = 'paused'; task.items[22].status = 'uncertain'; ui.setTask(task); await ui.poll();
  assert.equal(ui.nodes.get('queue-show-uncertain').hidden, false);
  await ui.fire('queue-show-uncertain');
  assert.equal(queue().length, 3); assert.match(queue()[2].textContent, /达人23.*等待人工核对/);
  assert.equal(descendants(queue()[2]).find(node => node.tagName === 'button').disabled, false);
  ui.setTask({ ...task, id: 'next-task' }); await ui.poll();
  assert.match(queue()[0].textContent, /达人1/); assert.equal(queue().length, 10);
  assert.equal(ui.getState().task.items.length, 23);
});

test('后台先应用网页筛选时显示准备状态，取消可用，定位提示后允许再次准备且不启动任务', async () => {
  const ui = await dashboard(); await ready(ui);
  await ui.fire('web-filters-enabled', 'change', { checked: true });
  ui.collectHook((target, source) => ui.setPreparation({ status: 'filtering', targetCount: target, source, reason: '正在应用网页筛选' }));
  await ui.fire('prepare-list');
  assert.match(ui.nodes.get('collection-status').textContent, /正在应用网页筛选/);
  assert.equal(ui.nodes.get('prepare-list').disabled, true);
  assert.equal(ui.nodes.get('cancel-preparation').hidden, false);
  assert.equal(ui.nodes.get('source-fields').disabled, true);
  assert.equal(ui.nodes.get('web-filters-enabled').disabled, true);
  assert.equal(ui.nodes.get('start-current').disabled, true);
  assert.equal(ui.nodes.get('cancel-preparation').hidden, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  const preparation = ui.getWorkspace().preparation;
  ui.setPreparation({ ...preparation, status: 'invalid', reason: '筛选已应用，页面位置已重置；请在专用页定位后再次准备' }); await ui.poll();
  assert.match(ui.nodes.get('collection-reason').textContent, /定位后再次准备/);
  assert.equal(ui.nodes.get('prepare-list').disabled, false);
  assert.equal(ui.messages.some(message => message.type === 'panel:start'), false);
});

test('来源导航未完成时轮询重读筛选，旧来源迟到结果不能覆盖新来源', async () => {
  const old = deferred(); let requests = 0;
  const filters = { supported: { category: true, channel: true }, current: { category: 'rank', channel: 'all' }, options: { categories: [{ value: 'rank', label: '排行榜类目' }], channels: [{ value: 'all', label: '全部' }] } };
  const ui = await dashboard(23, { filterHandler: () => ++requests === 1 ? old.promise : requests === 2 ? { ok: true, pageFilters: { loading: true } } : { ok: true, pageFilters: filters } });
  await ready(ui); await ui.fire('source-type', 'change', { value: 'leaderboard' });
  assert.equal(ui.nodes.get('web-filters-enabled').disabled, true);
  await ui.poll();
  assert.equal(ui.nodes.get('web-filters-enabled').disabled, false);
  assert.deepEqual(ui.nodes.get('web-filter-category-options').children.map(option => option.dataset.value), ['rank']);
  old.resolve({ ok: true, pageFilters: { ...filters, current: { category: 'old', channel: 'all' }, options: { ...filters.options, categories: [{ value: 'old', label: '旧广场' }] } } }); await settle();
  assert.deepEqual(ui.nodes.get('web-filter-category-options').children.map(option => option.dataset.value), ['rank']);
});

test('网页筛选结构等待固定45秒后停止自动重读，显式读取或切换来源才能重新等待', async () => {
  for (const message of ['无法核对原页筛选及列表状态', '无法核对排行榜筛选及列表状态']) {
    let now = 1000, reads = 0;
    const ui = await dashboard(23, { clock: () => now, filterHandler: () => { reads++; return { ok: true, pageFilters: { loading: true, error: message } }; } });
    await ready(ui);
    now = 30000; await ui.poll();
    now = 45999; await ui.poll();
    assert.equal(ui.nodes.get('web-filters-enabled').disabled, true);
    now = 46000; await ui.poll();
    assert.match(ui.nodes.get('web-filter-status').textContent, /网页筛选尚未就绪，请等待Shopee加载后点击读取页面筛选重试/);
    const expiredReads = reads; now = 60000; await ui.poll();
    assert.equal(reads, expiredReads);
    await ui.fire('web-filter-refresh');
    assert.equal(reads, expiredReads + 1);
    now = 104999; await ui.poll();
    assert.doesNotMatch(ui.nodes.get('web-filter-status').textContent, /尚未就绪/);
    now = 105000; await ui.poll();
    assert.match(ui.nodes.get('web-filter-status').textContent, /尚未就绪/);
    await ui.fire('source-type', 'change', { value: 'leaderboard' });
    assert.doesNotMatch(ui.nodes.get('web-filter-status').textContent, /尚未就绪/);
  }
});

test('专用页连接或登录等待不受筛选结构45秒限制', async () => {
  let now = 1000, reads = 0;
  const ui = await dashboard(23, { clock: () => now, filterHandler: () => { reads++; return { ok: true, pageFilters: { loading: true, error: '等待专用页连接或登录' } }; } });
  await ready(ui);
  now = 100000; await ui.poll();
  assert.equal(reads, 2);
  assert.doesNotMatch(ui.nodes.get('web-filter-status').textContent, /尚未就绪/);
  assert.equal(ui.nodes.get('web-filters-enabled').disabled, true);
});

test('已有筛选重读后等待结构超时，不能重新启用过期选项或用旧条件准备', async () => {
  let now = 1000, waiting = false;
  const filters = { supported: { category: true, channel: true }, current: { category: 'all', channel: 'all' }, options: { categories: [{ value: 'all', label: '全部' }], channels: [{ value: 'all', label: '全部' }] } };
  const ui = await dashboard(23, { clock: () => now, filterHandler: () => ({ ok: true, pageFilters: waiting ? { loading: true, error: '无法核对原页筛选及列表状态' } : filters }) });
  await ready(ui); await ui.fire('web-filters-enabled', 'change', { checked: true });
  waiting = true; await ui.fire('web-filter-refresh');
  now = 46000; await ui.poll();
  assert.equal(ui.nodes.get('web-filters-enabled').disabled, true);
  assert.equal(ui.nodes.get('web-filter-category-options').getAttribute('aria-disabled'), 'true');
  assert.ok(ui.nodes.get('web-filter-category-options').children.every(option => option.disabled));
  assert.equal(ui.nodes.get('prepare-list').disabled, true);
});

test('网页筛选勾选后刷新只更新选项，不会悄悄改回页面旧条件；返回草稿保留筛选与起点', async () => {
  let category = 'all';
  const filters = () => ({ ok: true, pageFilters: { supported: { category: true, channel: true }, current: { category, channel: 'all' }, options: { categories: [{ value: 'all', label: '全部' }, { value: 'beauty', label: 'Beauty' }], channels: [{ value: 'all', label: '全部' }] } } });
  const ui = await dashboard(23, { filterHandler: filters }); await ready(ui);
  await ui.chooseFilter('web-filter-category', 'beauty');
  await ui.chooseFilter('web-filter-category', 'all');
  category = 'beauty'; await ui.fire('web-filter-refresh');
  assert.deepEqual(ui.nodes.get('web-filter-category-options').children.map(option => option.getAttribute('aria-checked')), ['true', 'false']);
  await ui.fire('start-current', 'change', { checked: true }); await ui.fire('open-library');
  const returned = await dashboard(23, { session: ui.sessionValues, filterHandler: filters });
  assert.equal(returned.nodes.get('web-filters-enabled').checked, true);
  assert.equal(returned.nodes.get('start-current').checked, true);
  await returned.poll();
  assert.deepEqual(returned.nodes.get('web-filter-category-options').children.map(option => option.getAttribute('aria-checked')), ['true', 'false']);
});

test('取消应用网页筛选后胶囊不可改，重新启用保留草稿，选择不直接操作Shopee页面', async () => {
  const ui = await dashboard(); await ready(ui);
  await ui.chooseFilter('web-filter-category', 'beauty');
  await ui.fire('web-filters-enabled', 'change', { checked: false });
  const group = ui.nodes.get('web-filter-category-options');
  assert.equal(group.getAttribute('aria-disabled'), 'true');
  assert.ok(group.children.every(button => button.disabled));
  await ui.chooseFilter('web-filter-category', 'all');
  await ui.fire('web-filters-enabled', 'change', { checked: true });
  assert.equal(group.children.find(button => button.getAttribute('aria-checked') === 'true').dataset.value, 'beauty');
  assert.equal(ui.messages.some(message => ['panel:collect', 'panel:preview', 'panel:start'].includes(message.type)), false);
});

test('胶囊键盘单选移动焦点并撤销旧名单确认，运行或筛选准备期间保持禁用', async () => {
  const ui = await dashboard(); await ready(ui, 'send');
  ui.setCollection('ready'); await ui.poll();
  await ui.fire('send-consent', 'change', { checked: true });
  const group = ui.nodes.get('web-filter-category-options');
  const [all, beauty] = group.children;
  assert.equal(all.tabIndex, 0); assert.equal(beauty.tabIndex, -1);
  all.fire('keydown', {}, { key: 'ArrowRight' }); await settle();
  assert.equal(beauty.getAttribute('aria-checked'), 'true');
  assert.equal(beauty.tabIndex, 0); assert.equal(all.tabIndex, -1);
  assert.equal(beauty.focused, true);
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  beauty.fire('keydown', {}, { key: 'ArrowRight' }); await settle();
  assert.equal(all.getAttribute('aria-checked'), 'true');
  ui.collectHook((target, source) => ui.setPreparation({ status: 'filtering', targetCount: target, source }));
  await ui.fire('prepare-list');
  assert.ok(group.children.every(button => button.disabled));
  await ui.chooseFilter('web-filter-category', 'beauty');
  assert.equal(group.children[0].getAttribute('aria-checked'), 'true');
});

test('筛选选项刷新移除当前选择后明确阻断，不自动换成页面默认条件', async () => {
  let removed = false;
  const ui = await dashboard(23, { filterHandler: () => ({ ok: true, pageFilters: {
    supported: { category: true, channel: true }, current: { category: 'all', channel: 'all' },
    options: { categories: [{ value: 'all', label: '全部' }, ...(!removed ? [{ value: 'beauty', label: 'Beauty' }] : [])], channels: [{ value: 'all', label: '全部' }] },
  } }) });
  await ready(ui); await ui.chooseFilter('web-filter-category', 'beauty');
  removed = true; await ui.fire('web-filter-refresh'); await ui.fire('prepare-list');
  assert.match(ui.nodes.get('notice').textContent, /筛选已变化.*重新读取/);
  assert.equal(ui.messages.some(message => message.type === 'panel:collect'), false);
});

test('网页筛选刷新失败后套用达人库，隐藏的网页条件不能阻止指定用户准备', async () => {
  let fail = false;
  const filters = { supported: { category: true, channel: true }, current: { category: 'all', channel: 'all' }, options: { categories: [{ value: 'all', label: '全部' }], channels: [{ value: 'all', label: '全部' }] } };
  const ui = await dashboard(23, { librarySelection: libraryChoice(), libraryHandler: () => ({ ok: true, creatorLibrarySelection: libraryChoice() }), filterHandler: () => fail ? { ok: false, error: '页面加载中' } : { ok: true, pageFilters: filters } });
  await ready(ui); await ui.fire('web-filters-enabled', 'change', { checked: true });
  fail = true; await ui.fire('web-filter-refresh');
  await ui.fire('library-selection-apply');
  assert.equal(ui.nodes.get('source-type').value, 'specified');
  assert.equal(ui.nodes.get('prepare-list').disabled, false);
  ui.collectHook(target => ui.setCollection('ready', target)); await ui.fire('prepare-list');
  const collect = ui.messages.findLast(message => message.type === 'panel:collect');
  assert.equal(collect.source.webFilters, undefined); assert.equal(collect.source.startPosition, undefined);
});

test('指定联盟伙伴ID独立计数及传递，不能混成已加载Shopee用户ID', async () => {
  const ui = await dashboard(); await ready(ui);
  await ui.fire('source-type', 'change', { value: 'affiliates' });
  await ui.fire('source-affiliate-ids', 'input', { value: '200,100,200' });
  await ui.fire('open-page');
  assert.deepEqual(ui.messages.findLast(m => m.type === 'panel:open').source.affiliateIds, ['200', '100']);
  ui.collectHook(target => ui.setCollection('ready', target, target));
  await ui.fire('prepare-list');
  const message = ui.messages.findLast(m => m.type === 'panel:collect');
  assert.equal(message.targetCount, 2); assert.deepEqual(message.source.affiliateIds, ['200', '100']); assert.deepEqual(message.source.creatorIds, []);
});

const libraryChoice = (changes = {}) => ({ version: 1, kind: 'creator-library-selection', libraryRevision: 2, site: 'ID', shopId: '700', creatorIds: ['2', '1'], records: [{ id: 'record-2' }, { id: 'record-1' }], requiresPageVerification: true, ...changes });
test('精简的200条库交接须显式按版本与当前店铺重读，不覆盖消息草稿', async () => {
  const records = Array.from({ length: 200 }, (_, i) => ({ id: `record-${i + 1}` }));
  const selection = libraryChoice({ records }); delete selection.creatorIds;
  const ui = await dashboard(200, { librarySelection: selection, libraryHandler: message => ({ ok: true, creatorLibrarySelection: libraryChoice({ records, creatorIds: message.recordIds.map((_, i) => String(i + 1)) }) }) });
  await ready(ui);
  const before = ui.messageRows()[0].children.map(n => n.textContent).join('');
  assert.equal(ui.sessionValues.has('creatorLibrarySelection'), false);
  assert.equal(ui.messages.some(m => m.type === 'panel:library-select'), false);
  assert.match(ui.nodes.get('library-selection-status').textContent, /200/);
  await ui.fire('library-selection-apply');
  assert.deepEqual(ui.messages.findLast(m => m.type === 'panel:library-select'), { type: 'panel:library-select', expectedRevision: 2, site: 'ID', shopId: '700', recordIds: records.map(r => r.id) });
  assert.equal(ui.nodes.get('source-ids').value.split(', ').length, 200);
  assert.equal(ui.messageRows()[0].children.map(n => n.textContent).join(''), before);
  assert.equal(ui.nodes.get('start-button').disabled, true);
});

test('过大或无效的库临时交接明确报错，不静默丢失选择或改变来源', async () => {
  for (const selection of [libraryChoice({ extra: 'x'.repeat(300000) }), libraryChoice({ kind: 'invalid' })]) {
    const ui = await dashboard(23, { librarySelection: selection });
    assert.equal(ui.sessionValues.has('creatorLibrarySelection'), false);
    assert.match(ui.nodes.get('notice').textContent, /达人库.*重新选择/);
    assert.equal(ui.nodes.get('notice').hidden, false);
    assert.equal(ui.nodes.get('source-type').value, 'marketplace');
    assert.equal(ui.nodes.get('library-selection-apply').disabled, true);
    assert.equal(ui.messages.some(m => m.type === 'panel:library-select'), false);
  }
});

test('达人库在当前标签页往返保留草稿，显式套用后仍须重新准备', async () => {
  const ui = await dashboard(); await ready(ui, 'send');
  await ui.fire('task-name', 'input', { value: '待发布任务' });
  await ui.fire('source-includes', 'input', { value: 'beauty' });
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.fire('open-library');
  assert.equal(ui.openedWindows.length, 0);
  assert.equal(ui.location.href, 'creator-library.html');
  assert.deepEqual(JSON.parse(ui.sessionValues.get('creatorLibraryContext')), { site: 'ID', shopId: '700' });
  const returned = await dashboard(23, { session: ui.sessionValues, librarySelection: libraryChoice(), libraryHandler: () => ({ ok: true, creatorLibrarySelection: libraryChoice() }) });
  assert.equal(descendants(returned.messageRows()[0]).find(node => node.dataset.role === 'content').value, 'Halo {{name}}, 合作邀请');
  assert.equal(descendants(returned.messageRows()[1]).find(node => node.dataset.role === 'content').value, 'https://shopee.co.id/product/1/2');
  assert.equal(returned.nodes.get('task-name').value, '待发布任务');
  assert.equal(returned.nodes.get('interval').value, '30');
  assert.equal(returned.nodes.get('source-includes').value, 'beauty');
  assert.equal(returned.nodes.get('configuration-step').hidden, true);
  assert.equal(returned.nodes.get('source-type').value, 'marketplace');
  assert.equal(returned.nodes.get('send-consent').checked, false);
  assert.equal(returned.messages.some(m => m.type === 'panel:library-select'), false);
  assert.equal(returned.sessionValues.has('creatorDashboardDraft'), false);
  await returned.fire('library-selection-apply');
  const select = returned.messages.findLast(m => m.type === 'panel:library-select');
  assert.deepEqual(select, { type: 'panel:library-select', expectedRevision: 2, site: 'ID', shopId: '700', recordIds: ['record-2', 'record-1'] });
  assert.equal(returned.nodes.get('source-type').value, 'specified'); assert.equal(returned.nodes.get('source-ids').value, '2, 1');
  assert.equal(returned.nodes.get('start-button').disabled, true);
  assert.equal(descendants(returned.messageRows()[0]).find(node => node.dataset.role === 'content').value, 'Halo {{name}}, 合作邀请');
});

test('同页返回保留未完成草稿与图片引用，重新读取图片且不保存原件', async () => {
  const asset = imageAsset();
  const ui = await dashboard(23, { assets: [asset] });
  assert.equal(ui.nodes.get('interval').value, '10');
  await ui.message(0, 'content', 'input', { value: '尚未完成 {{' });
  await ui.message(1, 'type', 'change', { value: 'image' });
  await ui.message(1, 'image-select', 'change', { value: asset.id });
  await ui.fire('interval', 'input', { value: '' });
  await ui.fire('open-library');
  assert.equal(ui.location.href, 'creator-library.html');
  assert.equal(ui.sessionValues.get('creatorDashboardDraft').includes('data:image'), false);
  const returned = await dashboard(23, { session: ui.sessionValues, assets: [asset] });
  await settle();
  assert.equal(descendants(returned.messageRows()[0]).find(node => node.dataset.role === 'content').value, '尚未完成 {{');
  assert.equal(returned.nodes.get('interval').value, '');
  assert.equal(descendants(returned.messageRows()[1]).find(n => n.dataset.role === 'image-select').value, asset.id);
  assert.ok(returned.messages.some(m => m.type === 'panel:image-get' && m.assetId === asset.id));
});

test('草稿暂存失败留在工作台，错误明确且不丢当前输入', async () => {
  const ui = await dashboard();
  await ui.message(0, 'content', 'input', { value: '保留当前输入' });
  ui.sessionValues.set = () => { throw new Error('storage full'); };
  await ui.fire('open-library');
  assert.equal(ui.location.href, '');
  assert.equal(ui.openedWindows.length, 0);
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '保留当前输入');
  assert.match(ui.nodes.get('notice').textContent, /草稿.*暂存|暂存.*草稿/);
});

test('达人库往返保留切换消息类型前的文字与图片选择', async () => {
  const asset = imageAsset(), ui = await dashboard(23, { assets: [asset] });
  await ui.message(0, 'content', 'input', { value: '切换类型前的文字' });
  await ui.message(0, 'type', 'change', { value: 'image' });
  await ui.message(0, 'image-select', 'change', { value: asset.id });
  await ui.message(1, 'type', 'change', { value: 'image' });
  await ui.message(1, 'image-select', 'change', { value: asset.id });
  await ui.message(1, 'type', 'change', { value: 'text' });
  await ui.fire('open-library');
  const returned = await dashboard(23, { session: ui.sessionValues, assets: [asset] });
  await settle();
  await returned.message(0, 'type', 'change', { value: 'text' });
  assert.equal(descendants(returned.messageRows()[0]).find(node => node.dataset.role === 'content').value, '切换类型前的文字');
  await returned.message(1, 'type', 'change', { value: 'image' });
  await settle();
  assert.equal(descendants(returned.messageRows()[1]).find(n => n.dataset.role === 'image-select').value, asset.id);
});

test('返回工作台保留尚未重新准备的人数，不被旧锁定名单覆盖', async () => {
  const ui = await dashboard(); await ready(ui);
  ui.setCollection('ready'); await ui.poll();
  await ui.fire('limit', 'input', { value: '10' });
  await ui.fire('open-library');
  const workspace = ui.getWorkspace();
  const returned = await dashboard(23, { session: ui.sessionValues, getHandler: (_, reply) => ({ ...reply, workspace }) });
  assert.equal(returned.nodes.get('limit').value, '10');
  assert.equal(returned.nodes.get('start-button').disabled, true);
});

test('返回时未结束任务始终使用后台配置，不被暂存草稿覆盖', async () => {
  const ui = await dashboard(); await ready(ui, 'send'); await ui.fire('open-library');
  const task = { id: 'active-task', status: 'paused', items: [], config: { shop: { id: '700', name: '测试店铺' }, messages: [{ type: 'text', content: '后台锁定消息' }], taskName: '后台任务', intervalSeconds: 45, limit: 1, mode: 'dry-run', source: { type: 'marketplace', creatorIds: [], nameIncludes: '', nameExcludes: '' } } };
  const returned = await dashboard(23, { session: ui.sessionValues, getHandler: (_, reply) => ({ ...reply, state: { ...reply.state, task } }) });
  assert.equal(descendants(returned.messageRows()[0]).find(node => node.dataset.role === 'content').value, '后台锁定消息');
  assert.equal(returned.nodes.get('task-name').value, '后台任务');
  assert.equal(returned.nodes.get('interval').value, '45');
  assert.equal(returned.nodes.get('mode').value, 'dry-run');
  assert.equal(returned.nodes.get('settings-fields').disabled, true);
  assert.equal(returned.nodes.get('send-consent').checked, false);
});

test('库交接过期版本、错店铺和未结束任务不能套用，也不自动启动或覆盖原草稿', async () => {
  const ui = await dashboard(23, { librarySelection: libraryChoice() }); await ready(ui);
  await ui.fire('library-selection-apply'); assert.match(ui.nodes.get('notice').textContent, /版本|重新选择/);
  assert.equal(ui.nodes.get('source-type').value, 'marketplace');
  const mismatch = await dashboard(23, { librarySelection: libraryChoice({ shopId: '999' }) }); await ready(mismatch);
  assert.equal(mismatch.sessionValues.has('creatorLibrarySelection'), false);
  await mismatch.fire('library-selection-apply'); assert.match(mismatch.nodes.get('notice').textContent, /店铺/);
  const task = await dashboard(23, { librarySelection: libraryChoice() }); await ready(task); task.setCollection('ready'); await task.poll(); await task.fire('start-button');
  await task.fire('library-selection-apply'); assert.match(task.nodes.get('notice').textContent, /结束当前任务/);
  assert.equal(task.messages.some(m => m.type === 'panel:library-select'), false);
});

test('运行或暂停任务允许只读往返两步，模板和消息编辑始终保持锁定', async () => {
  const ui = await dashboard(); ui.setCollection('ready'); await ui.poll(); await ready(ui); await ui.fire('start-button');
  for (const status of ['running', 'paused']) {
    const task = ui.getState().task; task.status = status; ui.setTask(task); await ui.poll();
    await ui.fire('message-back');
    assert.equal(ui.nodes.get('configuration-step').hidden, false);
    assert.equal(ui.nodes.get('settings-fields').disabled, true);
    assert.equal(ui.nodes.get('message-template-apply').disabled, true);
    await ui.fire('message-next');
    assert.equal(ui.nodes.get('audience-step').hidden, false);
    assert.equal(ui.nodes.get('start-button').disabled, true);
    for (const id of ['web-filter-category-options', 'web-filter-channel-options']) assert.ok(ui.nodes.get(id).children.every(button => button.disabled));
  }
});

test('人工核对仅确认当前一条，并发送用户所见任务、会话与条目序号上下文', async () => {
  const ui = await dashboard(); ui.setCollection('ready'); await ui.poll(); await ready(ui); await ui.fire('start-button');
  const task = ui.getState().task; task.status = 'paused'; task.items[0].status = 'uncertain'; task.items[0].messageIndex = 1; task.items[0].submittedCount = 1;
  ui.setTask(task); await ui.poll();
  const confirm = descendants(ui.nodes.get('queue-items').children[0]).find(node => node.tagName === 'button');
  assert.equal(confirm.textContent, '确认第 2 条已演练');
  ui.resolveHook(() => ({ ok: false, error: '核对条目已变化，请刷新后重新核对' }));
  confirm.fire('click'); await settle();
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:resolve'), { type: 'panel:resolve', taskId: 'task', sessionId: 'session', itemId: '1', messageIndex: 1, resolution: 'sent' });
  assert.match(ui.nodes.get('notice').textContent, /刷新.*核对/);
});

test('指定名单不足时说明未找到和被排除人数，不能用部分名单启动', async () => {
  const ui = await dashboard(); await ready(ui);
  await ui.fire('source-type', 'change', { value: 'specified' });
  await ui.fire('source-ids', 'input', { value: '100,200,300' });
  ui.collectHook(target => { ui.setCollection('insufficient', target, 1); ui.collectionStats({ missing: 1, excluded: 1 }); });
  await ui.fire('prepare-list');
  assert.match(ui.nodes.get('collection-reason').textContent, /未找到 1.*被排除 1/);
  assert.equal(ui.nodes.get('start-button').disabled, true);
});

test('消息超长、未知变量和含凭证链接均不能进入第二步，任务名称允许80字', async () => {
  const ui = await dashboard();
  await ui.fire('interval', 'input', { value: '30' });
  await ui.message(1, 'remove');
  for (const value of ['x'.repeat(2401), '未知 {{shop}}', '未闭合 {{name']) {
    await ui.message(0, 'content', 'input', { value }); await ui.fire('message-next');
    assert.equal(ui.nodes.get('audience-step').hidden, true);
  }
  await ui.message(0, 'type', 'change', { value: 'link' });
  await ui.message(0, 'content', 'input', { value: 'https://user:secret@example.com/product' }); await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  await ui.message(0, 'content', 'input', { value: 'https://shopee.co.id/product/1/2' });
  await ui.fire('task-name', 'input', { value: '名'.repeat(81) }); await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  await ui.fire('task-name', 'input', { value: '名'.repeat(80) }); await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, false);
  assert.equal(ui.messages.some(message => ['panel:preview', 'panel:start'].includes(message.type)), false);
});

test('来源条件改动后即使改回原值或收到旧轮询，仍须重新准备名单', async () => {
  const ui = await dashboard(); ui.setCollection('ready'); await ui.poll(); await ready(ui, 'send');
  await ui.fire('send-consent', 'change', { checked: true });
  await ui.fire('source-includes', 'input', { value: '新条件' });
  await ui.fire('source-includes', 'input', { value: '' }); await ui.poll();
  assert.equal(ui.rows().length, 0);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.match(ui.nodes.get('preview-note').textContent, /重新准备/);
  ui.collectHook(target => ui.setCollection('ready', target, target)); await ui.fire('prepare-list');
  assert.equal(ui.rows().length, 10);
  await ui.fire('send-consent', 'change', { checked: true });
  assert.equal(ui.nodes.get('start-button').disabled, false);
});

test('新序列模板按保存顺序显式套用，保存新模板只携带名称与messages', async () => {
  const messages = [{ type: 'link', content: 'https://shopee.co.id/product/7/8' }, { type: 'text', content: '第二条 {{name}}' }, { type: 'text', content: '第三条' }];
  const record = { id: 'sequence-template', name: '序列模板', messages, revision: 2, createdAt: 1000, updatedAt: 1000 };
  const ui = await dashboard(23, { templates: [record] }); await ready(ui);
  await ui.fire('message-template-select', 'change', { value: record.id });
  assert.equal(ui.messageRows().length, 2);
  await ui.fire('message-template-apply');
  assert.equal(ui.messageRows().length, 3);
  assert.match(ui.nodes.get('message-preview-list').textContent, /第 1 条.*商品链接.*第 2 条.*第二条.*第 3 条.*第三条/);
  await ui.fire('message-template-create');
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:template-create').draft, { name: record.name, messages });
});

test('图片落盘成功后才写入引用，可与文字链接排序混排，启动配置不携带图片原件', async () => {
  const pending = deferred(), asset = imageAsset('imported-test');
  const ui = await dashboard(); ui.setCollection('ready'); await ui.poll(); await ready(ui); await ui.fire('message-back');
  await ui.fire('message-add'); await ui.message(2, 'type', 'change', { value: 'image' });
  ui.imageHook(message => message.type === 'panel:image-add' ? pending.promise : undefined);
  await ui.message(2, 'image-file', 'change', { files: [{ name: asset.name, type: asset.mime, size: asset.size, dataUrl: asset.dataUrl }] });
  await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  assert.match(ui.nodes.get('notice').textContent, /图片.*读取|图片.*保存/);
  pending.resolve({ ...imageListReply([asset]), assetId: asset.id, imageAsset: asset }); await settle();
  await ui.message(2, 'up'); await ui.fire('message-next'); await ui.fire('start-button');
  const config = ui.messages.findLast(message => message.type === 'panel:start').config;
  assert.deepEqual(config.messages[1], imageReference(asset));
  assert.deepEqual(config.messages.map(message => message.type), ['text', 'image', 'link']);
  assert.equal(JSON.stringify(config).includes('data:image'), false);
  assert.equal(config.messages[1].content, undefined);
  assert.equal(descendants(ui.nodes.get('message-preview-list')).some(node => node.tagName === 'img' && node.src === PNG_DATA), true);
});

test('已存图片列表只含元数据，选中后读取原件预览，缺图不能前进或保存模板', async () => {
  const asset = imageAsset('asset-existing', { name: '<img onerror=alert(1)>.png' });
  const ui = await dashboard(23, { assets: [asset] }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' });
  assert.equal(ui.messages.some(message => message.type === 'panel:image-get'), false);
  await ui.message(1, 'image-select', 'change', { value: asset.id });
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:image-get'), { type: 'panel:image-get', assetId: asset.id });
  assert.match(ui.messageRows()[1].textContent, /<img onerror=alert\(1\)>\.png/);
  await ui.fire('message-template-name', 'input', { value: '含图片模板' }); await ui.fire('message-template-create');
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages[1], imageReference(asset));
  const missing = imageReference(imageAsset('asset-missing'));
  const template = { id: 'missing-image-template', name: '丢失图片', messages: [missing], revision: 1 };
  ui.templateHook(message => message.type === 'panel:template-list' ? templateReply([template]) : undefined);
  await ui.fire('message-template-refresh'); await ui.fire('message-template-select', 'change', { value: template.id }); await ui.fire('message-template-apply');
  await ui.fire('message-next'); await ui.fire('message-template-create');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  assert.match(ui.nodes.get('message-template-status').textContent, /图片不存在|重新选择图片/);
  assert.equal(ui.messages.filter(message => message.type === 'panel:template-create').length, 1);
});

test('无效文件、读取失败和保存失败均保留旧图片，图片失败不改变业务状态', async () => {
  const asset = imageAsset(); const ui = await dashboard(23, { assets: [asset] }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
  const before = ui.getWorkspace();
  for (const file of [{ name: 'bad.gif', type: 'image/gif', size: 10 }, { name: 'big.png', type: 'image/png', size: 2097152 }, { name: 'broken.png', type: 'image/png', size: asset.size, error: '读取失败' }]) await ui.message(1, 'image-file', 'change', { files: [file] });
  assert.equal(ui.messages.some(message => message.type === 'panel:image-add'), false);
  ui.imageHook(message => message.type === 'panel:image-add' ? { ok: false, error: '图片存储已满，请减少新增图片' } : undefined);
  await ui.message(1, 'image-file', 'change', { files: [{ name: 'new.png', type: 'image/png', size: asset.size }] });
  assert.match(ui.messageRows()[1].textContent, /图片存储已满/);
  await ui.fire('message-template-name', 'input', { value: '保留原图' }); await ui.fire('message-template-create');
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages[1], imageReference(asset));
  assert.deepEqual(ui.getWorkspace(), before);
});

test('导入迟到不能覆盖后来选择，读取期间删行或换类型后不能回写草稿', async () => {
  const old = imageAsset(), chosen = imageAsset('asset-chosen', { sha256: 'b'.repeat(64), name: '后来选择.png' }), imported = imageAsset('asset-late', { sha256: 'c'.repeat(64) });
  const ui = await dashboard(23, { assets: [old, chosen] }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' });
  const pending = deferred(); ui.imageHook(message => message.type === 'panel:image-add' ? pending.promise : undefined);
  await ui.message(1, 'image-file', 'change', { files: [{ name: 'late.png', type: 'image/png', size: old.size }] });
  await ui.message(1, 'image-select', 'change', { value: chosen.id });
  pending.resolve({ ...imageListReply([old, chosen, imported]), imageAsset: imported, assetId: imported.id }); await settle();
  await ui.fire('message-template-name', 'input', { value: '保留后来选择' }); await ui.fire('message-template-create');
  assert.equal(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages[1].assetId, chosen.id);
  const read = deferred(); ui.fileReaderHook(() => read.promise);
  await ui.message(1, 'image-file', 'change', { files: [{ name: 'reading.png', type: 'image/png', size: old.size }] });
  const count = ui.messages.filter(message => message.type === 'panel:image-add').length;
  await ui.message(1, 'remove'); read.resolve(PNG_DATA); await settle();
  assert.equal(ui.messageRows().length, 1);
  assert.equal(ui.messages.filter(message => message.type === 'panel:image-add').length, count);
});

test('JPG MIME映射为JPEG，图片解码错误阻止提交且重新选择可重新校验预览', async () => {
  const asset = imageAsset('asset-jpeg', { name: '邀请.jpg', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2Q==', size: 4 });
  const ui = await dashboard(23, { assets: [asset] }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' });
  await ui.message(1, 'image-file', 'change', { files: [{ name: asset.name, type: 'image/jpg', size: 4, dataUrl: 'data:image/jpg;base64,/9j/2Q==' }] });
  const added = ui.messages.findLast(message => message.type === 'panel:image-add');
  assert.equal(added.draft.mime, 'image/jpeg'); assert.equal(added.draft.dataUrl, asset.dataUrl);
  const importedId = descendants(ui.messageRows()[1]).find(node => node.dataset.role === 'image-select').value;
  const preview = descendants(ui.nodes.get('message-preview-list')).find(node => node.tagName === 'img');
  preview.fire('error'); await settle();
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, true);
  await ui.message(1, 'image-select', 'change', { value: importedId });
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, false);
});

test('切换图片消息为文字后忽略迟到导入，图片接口不提前推进业务轮询序号', async () => {
  const polling = deferred(), list = deferred(), asset = imageAsset();
  let gets = 0;
  const ui = await dashboard(23, { getHandler: (_message, reply) => ++gets === 2 ? polling.promise.then(() => reply) : undefined, imageHandler: message => message.type === 'panel:image-list' ? list.promise : undefined });
  await ready(ui); await ui.fire('message-back');
  const waitPoll = ui.poll(); await settle();
  await ui.message(1, 'type', 'change', { value: 'image' });
  list.resolve(imageListReply([asset])); await settle(); polling.resolve(); await waitPoll;
  assert.equal(ui.nodes.get('connection-state').textContent, '专用页面已连接');
  const pending = deferred(); ui.imageHook(message => message.type === 'panel:image-add' ? pending.promise : undefined);
  await ui.message(1, 'image-file', 'change', { files: [{ name: asset.name, type: asset.mime, size: asset.size }] });
  await ui.message(1, 'type', 'change', { value: 'text' }); await ui.message(1, 'content', 'input', { value: '后来输入的文字' });
  pending.resolve({ ...imageListReply([asset]), imageAsset: asset, assetId: asset.id }); await settle();
  await ui.fire('message-template-name', 'input', { value: '后来文字模板' }); await ui.fire('message-template-create');
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages[1], { type: 'text', content: '后来输入的文字' });
});

test('旧后台不提供图片能力时禁用图片选项，含图模板不能启动且文字链接不受影响', async () => {
  const asset = imageAsset(), imageTemplate = { id: 'image-template', name: '图片模板', messages: [imageReference(asset)], revision: 1 };
  const ui = await dashboard(23, { assets: [asset], templates: [imageTemplate], imageCapability: false });
  ui.setCollection('ready'); await ui.poll(); await ready(ui);
  assert.equal(ui.nodes.get('start-button').disabled, false);
  const type = descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'type');
  assert.equal(type.children.find(option => option.value === 'image').disabled, true);
  await ui.fire('message-back'); await ui.fire('message-template-select', 'change', { value: imageTemplate.id }); await ui.fire('message-template-apply');
  await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  assert.match(ui.nodes.get('notice').textContent, /图片.*后台.*重新加载/);
  assert.equal(ui.messages.some(message => message.type === 'panel:start'), false);
});

test('已存图片列表失败不清空原图，刷新恢复并显示本机容量', async () => {
  const asset = imageAsset(), ui = await dashboard(23, { assets: [asset] }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
  ui.imageHook(message => message.type === 'panel:image-list' ? { ok: false, error: '图片读取失败，请刷新图片列表' } : undefined);
  await ui.message(1, 'image-refresh');
  assert.match(ui.messageRows()[1].textContent, /图片读取失败/);
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, false);
  ui.imageHook(undefined); await ui.fire('message-back'); await ui.message(1, 'image-refresh');
  assert.match(ui.nodes.get('image-library-status').textContent, /1 \/ 20.*4 MiB/);
  assert.equal(descendants(ui.messageRows()[1]).some(node => node.tagName === 'img' && node.src === asset.dataUrl), true);
});

test('套用只含图片引用的模板后可切换为空文字并重新编辑，不遗留图片字段到配置', async () => {
  const asset = imageAsset(), template = { id: 'only-image', name: '单图模板', messages: [imageReference(asset)], revision: 1 };
  const ui = await dashboard(23, { assets: [asset], templates: [template] }); await ready(ui); await ui.fire('message-back');
  await ui.fire('message-template-select', 'change', { value: template.id }); await ui.fire('message-template-apply');
  await ui.message(0, 'type', 'change', { value: 'text' });
  assert.equal(descendants(ui.messageRows()[0]).find(node => node.dataset.role === 'content').value, '');
  await ui.message(0, 'content', 'input', { value: '替换图片的文字' });
  await ui.fire('message-template-name', 'input', { value: '单文字模板' }); await ui.fire('message-template-create');
  assert.deepEqual(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages, [{ type: 'text', content: '替换图片的文字' }]);
});

test('图片解码完成前不能下一步、启动或保存模板，load成功后才可使用', async () => {
  const decoded = deferred(), asset = imageAsset();
  const ui = await dashboard(23, { assets: [asset], decodeHandler: () => decoded.promise });
  ui.setCollection('ready'); await ui.poll(); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
  await ui.fire('message-template-name', 'input', { value: '等待解码' }); await ui.fire('message-next'); await ui.fire('message-template-create');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  assert.equal(ui.messages.some(message => message.type === 'panel:template-create'), false);
  decoded.resolve(); await settle();
  await ui.fire('message-next'); assert.equal(ui.nodes.get('start-button').disabled, false);
  await ui.fire('message-template-create'); assert.equal(ui.messages.filter(message => message.type === 'panel:template-create').length, 1);
});

test('导入新图片解码失败保留旧图，重新导入解码成功后才能替换', async () => {
  const old = imageAsset(); const ui = await dashboard(23, { assets: [old] }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: old.id });
  ui.decodeHook(() => { throw new Error('无法解码'); });
  await ui.message(1, 'image-file', 'change', { files: [{ name: '新图.png', type: 'image/png', size: old.size }] });
  assert.match(ui.messageRows()[1].textContent, /解码|无法打开/);
  await ui.fire('message-template-name', 'input', { value: '保留旧图' }); await ui.fire('message-template-create');
  assert.equal(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages[1].assetId, old.id);
  ui.decodeHook(undefined);
  await ui.message(1, 'image-file', 'change', { files: [{ name: '新图.png', type: 'image/png', size: old.size }] });
  await ui.fire('message-template-create');
  assert.notEqual(ui.messages.findLast(message => message.type === 'panel:template-create').draft.messages[1].assetId, old.id);
});

test('选择或导入图片超过10秒会结束等待，迟到解码或文件读取不能回写且可重试', async () => {
  const decoded = deferred(), read = deferred(), asset = imageAsset();
  const ui = await dashboard(23, { assets: [asset], decodeHandler: () => decoded.promise }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
  await ui.expireImageOperations();
  assert.match(ui.messageRows()[1].textContent, /10.*秒.*重试/);
  decoded.resolve(); await settle(); await ui.fire('message-next');
  assert.equal(ui.nodes.get('audience-step').hidden, true);
  ui.decodeHook(undefined); ui.fileReaderHook(() => read.promise);
  await ui.message(1, 'image-file', 'change', { files: [{ name: asset.name, type: asset.mime, size: asset.size }] });
  await ui.expireImageOperations();
  assert.match(ui.messageRows()[1].textContent, /10.*秒.*重试/);
  read.resolve(PNG_DATA); await settle();
  assert.equal(ui.messages.some(message => message.type === 'panel:image-add'), false);
  ui.fileReaderHook(undefined); await ui.message(1, 'image-select', 'change', { value: asset.id });
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, false);
});

test('后台标签页优先以bitmap解码，完成前保持阻断并以none方向核对尺寸和释放资源', async () => {
  const pending = deferred(), asset = imageAsset('wide-image', { width: 2, height: 3 });
  const ui = await dashboard(23, { assets: [asset], bitmapCapability: true, bitmapHandler: () => pending.promise, decodeHandler: () => { throw new Error('不应使用Image路径'); } });
  await ready(ui); await ui.fire('message-back'); await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
  assert.equal(ui.bitmapCalls.length, 1);
  assert.deepEqual(ui.bitmapCalls[0].options, { imageOrientation: 'none' });
  assert.equal(ui.bitmapCalls[0].blob.type, 'image/png'); assert.equal(ui.bitmapCalls[0].blob.size, asset.size);
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, true);
  pending.resolve({ width: 2, height: 3 }); await settle();
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, false);
  assert.equal(ui.bitmaps[0].closed, true);
  assert.equal(ui.canvasDraws.length, 0);
});

test('bitmap拒绝和EXIF方向导致尺寸变化时明确报错，不改引用或回退Image路径', async () => {
  for (const bitmapHandler of [() => { throw new Error('坏图'); }, () => ({ width: 3, height: 2 })]) {
    const asset = imageAsset('rotated', { width: 2, height: 3, mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2Q==', size: 4 });
    const ui = await dashboard(23, { assets: [asset], bitmapCapability: true, bitmapHandler }); await ready(ui); await ui.fire('message-back');
    await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
    assert.equal(ui.bitmapCalls.length, 1);
    await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, true);
    assert.match(ui.messageRows()[1].textContent, /无法解码|另存.*重新导入/);
    if (ui.bitmaps.length) { assert.equal(ui.bitmaps[0].closed, true); assert.match(ui.messageRows()[1].textContent, /尺寸.*旋转.*另存/); }
    assert.equal(ui.canvasDraws.length, 0);
  }
});

test('候选110默认前100勾选，跨页取消11人后补足99人，手动勾回才可启动', async () => {
  const ui = await dashboard(110); await ready(ui,'send',100);
  await ui.fire('web-filters-enabled','change',{checked:false}); await ui.fire('start-current','change',{checked:false});
  ui.collectHook(() => ui.setCandidates()); await ui.fire('prepare-list');
  assert.equal(ui.rows()[0].children[0].children[0].disabled,false);
  assert.equal(ui.rows()[0].children[0].children[0].checked,true);
  assert.match(ui.nodes.get('selection-count').textContent,/110.*100/);
  await ui.fire('send-consent','change',{checked:true});
  for(let i=0;i<10;i++){ui.rows()[i].children[0].children[0].fire('change',{checked:false});await settle();}
  assert.equal(ui.nodes.get('send-consent').checked,false);
  await ui.fire('roster-next');ui.rows()[0].children[0].children[0].fire('change',{checked:false});await settle();
  await ui.fire('refill-selection');
  assert.equal(ui.getWorkspace().collection.count,99); assert.equal(ui.nodes.get('start-button').disabled,true);
  assert.match(ui.nodes.get('collection-reason').textContent,/还差 1/);
  await ui.fire('roster-previous'); assert.equal(ui.rows()[0].children[0].children[0].checked,false);
  ui.rows()[0].children[0].children[0].fire('change',{checked:true});await settle();
  assert.equal(ui.getWorkspace().collection.count,100);
  await ui.fire('send-consent','change',{checked:true});await ui.fire('start-button');
  const config = ui.messages.findLast(m=>m.type==='panel:start').config;
  assert.equal(config.creators.length,100);assert.equal(config.creators[0].id,'1');assert.equal(config.creators.some(r=>r.id==='2'),false);
  assert.equal(ui.rows()[0].children[0].children[0].disabled,true);
});

test('选择保存后迟到的旧轮询不能恢复默认勾选或覆盖当前人数', async () => {
  const ui=await dashboard(110);await ready(ui,'send',100);
  await ui.fire('web-filters-enabled','change',{checked:false});await ui.fire('start-current','change',{checked:false});
  ui.collectHook(()=>ui.setCandidates());await ui.fire('prepare-list');
  const pending=deferred();ui.getHook((_message,reply)=>pending.promise.then(()=>reply));
  const oldPoll=ui.poll();await settle();
  ui.rows()[0].children[0].children[0].fire('change',{checked:false});await settle();
  assert.equal(ui.getWorkspace().collection.count,99);
  pending.resolve();await oldPoll;
  assert.equal(ui.rows()[0].children[0].children[0].checked,false);
  assert.match(ui.nodes.get('selection-count').textContent,/99 \/ 100/);
  assert.equal(ui.nodes.get('start-button').disabled,true);
});

test('恢复默认与显式继续加载有独立入口，选择待保存时可继续操作但不能启动', async () => {
  const ui = await dashboard(110);await ready(ui,'send',100);
  await ui.fire('web-filters-enabled','change',{checked:false});await ui.fire('start-current','change',{checked:false});
  ui.collectHook(()=>ui.setCandidates());await ui.fire('prepare-list');
  const pending = deferred();ui.selectionHook(()=>pending.promise);
  ui.rows()[0].children[0].children[0].fire('change',{checked:false});await settle();
  assert.equal(ui.nodes.get('start-button').disabled,true);
  assert.equal(ui.rows()[0].children[0].children[0].disabled,false);
  assert.equal(ui.rows()[0].children[0].children[0].checked,false);
  await ui.fire('start-button');
  assert.equal(ui.messages.some(m=>m.type==='panel:preview'||m.type==='panel:start'),false);
  pending.resolve({ok:false,error:'选择保存失败',workspace:ui.getWorkspace(),state:ui.getState(),capabilities:{targetCount:true,messageSequence:true,sourceSelection:true,candidateSelection:true}});await settle();
  assert.equal(ui.rows()[0].children[0].children[0].checked,true);
  ui.selectionHook(undefined);ui.rows()[0].children[0].children[0].fire('change',{checked:false});await settle();
  await ui.fire('reset-selection');assert.equal(ui.getWorkspace().collection.count,100);assert.equal(ui.rows()[0].children[0].children[0].checked,true);
  await ui.fire('extend-candidates');assert.equal(ui.getWorkspace().collection.status,'collecting');
  assert.equal(ui.nodes.get('start-button').disabled,true);assert.equal(ui.getWorkspace().collection.count,100);
});

test('快速连续取消、勾回及同人反复操作即时显示，并按最新revision串行保存', async () => {
  const ui = await dashboard(110); await ready(ui, 'send', 100);
  await ui.fire('web-filters-enabled', 'change', { checked: false }); await ui.fire('start-current', 'change', { checked: false });
  ui.collectHook(() => ui.setCandidates()); await ui.fire('prepare-list');
  const first = deferred(), second = deferred(), writes = [];
  ui.selectionHook(message => {
    writes.push(message);
    return writes.length === 1 ? first.promise : second.promise;
  });
  const checkbox = () => ui.rows()[0].children[0].children[0];
  checkbox().fire('change', { checked: false }); await settle();
  assert.equal(checkbox().checked, false);
  assert.equal(ui.nodes.get('selection-count').textContent.includes('99 / 100'), true);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  checkbox().fire('change', { checked: true }); await settle();
  assert.equal(checkbox().checked, true);
  checkbox().fire('change', { checked: false }); await settle();
  assert.equal(checkbox().checked, false);
  assert.equal(writes.length, 1, '第一条未回包时不得并发提交后续revision');
  first.resolve(undefined); await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(message => [message.creatorId, message.selected, message.expectedRevision]), [
    ['1', false, 0], ['1', true, 1],
  ]);
  assert.equal(checkbox().checked, false, '队列中尚未提交的最后一次操作仍即时显示');
  second.resolve(undefined); await settle(); await settle();
  assert.equal(ui.getWorkspace().collection.selectionRevision, 3);
  assert.equal(ui.getWorkspace().collection.selectedIds.includes('1'), false);
  assert.equal(checkbox().checked, false);
  assert.equal(writes.length, 3);
  assert.deepEqual([writes[2].creatorId, writes[2].selected, writes[2].expectedRevision], ['1', false, 2]);
});

test('保存失败与丢失回包都读取后台权威名单并回退，不自动重试写入', async () => {
  for (const lostReply of [false, true]) {
    const ui = await dashboard(110); await ready(ui);
    await ui.fire('web-filters-enabled', 'change', { checked: false }); await ui.fire('start-current', 'change', { checked: false });
    ui.collectHook(() => ui.setCandidates()); await ui.fire('prepare-list');
    const recovery = deferred();
    let writes = 0, reads = 0;
    let authoritative = ui.getWorkspace();
    ui.selectionHook(message => {
      writes++;
      if (lostReply) return Promise.reject(new Error('后台回包丢失'));
      return { ok: false, error: '选择保存失败', workspace: authoritative, state: ui.getState(), capabilities: { targetCount: true, messageSequence: true, sourceSelection: true, candidateSelection: true } };
    });
    ui.getHook((_message, reply) => { reads++; return recovery.promise.then(() => ({ ...reply, workspace: authoritative })); });
    const checkbox = ui.rows()[0].children[0].children[0];
    checkbox.fire('change', { checked: false }); await settle(); await settle();
    assert.equal(ui.rows()[0].children[0].children[0].checked, true);
    assert.equal(reads, 1);
    recovery.resolve(); await settle(); await settle();
    assert.equal(ui.rows()[0].children[0].children[0].checked, true);
    assert.equal(writes, 1, '失败恢复只读后台状态，不得重发写操作');
    assert.equal(ui.nodes.get('start-button').disabled, false);
  }
});

test('失败读回期间立即锁定勾选，避免恢复窗口产生未提交操作', async () => {
  const ui = await dashboard(110); await ready(ui);
  await ui.fire('web-filters-enabled', 'change', { checked: false }); await ui.fire('start-current', 'change', { checked: false });
  ui.collectHook(() => ui.setCandidates()); await ui.fire('prepare-list');
  const recovery = deferred();
  ui.selectionHook(() => ({ ok: false, error: '保存失败', workspace: ui.getWorkspace(), state: ui.getState(), capabilities: { targetCount: true, messageSequence: true, sourceSelection: true, candidateSelection: true } }));
  ui.getHook((_message, reply) => recovery.promise.then(() => reply));
  ui.rows()[0].children[0].children[0].fire('change', { checked: false }); await settle(); await settle();
  const checkbox = ui.rows()[0].children[0].children[0];
  assert.equal(checkbox.checked, true, '失败后待保存视图应先回到当前权威名单');
  assert.equal(checkbox.disabled, true, 'panel:get尚未返回时不得接收新的选择操作');
  checkbox.fire('change', { checked: false });
  assert.equal(ui.messages.filter(message => message.type === 'panel:select').length, 1);
  recovery.resolve(); await settle(); await settle();
  assert.equal(ui.rows()[0].children[0].children[0].disabled, false);
  assert.equal(ui.rows()[0].children[0].children[0].checked, true);
});

test('名单变化后丢弃旧集合的排队选择，不能启动未保存名单', async () => {
  const ui = await dashboard(110); await ready(ui);
  await ui.fire('web-filters-enabled', 'change', { checked: false }); await ui.fire('start-current', 'change', { checked: false });
  ui.collectHook(() => ui.setCandidates()); await ui.fire('prepare-list');
  const pending = deferred(); let writes = 0;
  ui.selectionHook(() => {
    writes++;
    return pending.promise.then(() => {
      ui.collectionStats({ id: 'replacement-collection', status: 'collecting' });
      return { ok: true, workspace: ui.getWorkspace(), state: ui.getState(), capabilities: { targetCount: true, messageSequence: true, sourceSelection: true, candidateSelection: true } };
    });
  });
  const checkbox = () => ui.rows()[0].children[0].children[0];
  checkbox().fire('change', { checked: false }); await settle();
  checkbox().fire('change', { checked: true }); await settle();
  pending.resolve();
  await settle(); await settle();
  assert.equal(writes, 1);
  assert.equal(ui.messages.filter(message => message.type === 'panel:select').length, 1);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  assert.equal(ui.messages.some(message => message.type === 'panel:preview' || message.type === 'panel:start'), false);
});

test('后台已保存后丢回包保留已保存结果，丢弃排队操作并使用读回revision继续', async () => {
  const ui = await dashboard(110); await ready(ui, 'send', 100);
  await ui.fire('web-filters-enabled', 'change', { checked: false }); await ui.fire('start-current', 'change', { checked: false });
  ui.collectHook(() => ui.setCandidates()); await ui.fire('prepare-list');
  await ui.fire('send-consent', 'change', { checked: true });
  const pending = deferred();
  ui.selectionHook(async message => {
    await pending.promise;
    ui.collectionStats(selectCandidate(ui.getWorkspace().collection, message.creatorId, message.selected));
    throw new Error('已保存但回复丢失');
  });
  ui.rows()[0].children[0].children[0].fire('change', { checked: false });
  ui.rows()[1].children[0].children[0].fire('change', { checked: false });
  assert.equal(ui.rows()[1].children[0].children[0].checked, false);
  pending.resolve(); await settle(); await settle();
  assert.equal(ui.rows()[0].children[0].children[0].checked, false);
  assert.equal(ui.rows()[1].children[0].children[0].checked, true);
  assert.equal(ui.getWorkspace().collection.selectionRevision, 1);
  assert.equal(ui.messages.filter(message => message.type === 'panel:select').length, 1);
  assert.equal(ui.nodes.get('send-consent').checked, false);
  assert.equal(ui.nodes.get('start-button').disabled, true);
  ui.selectionHook(undefined);
  ui.rows()[0].children[0].children[0].fire('change', { checked: true }); await settle();
  const writes = ui.messages.filter(message => message.type === 'panel:select');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedRevision, 1);
  assert.equal(ui.getWorkspace().collection.selectionRevision, 2);
  assert.equal(ui.getWorkspace().collection.count, 100);
  assert.equal(ui.nodes.get('send-consent').checked, false);
});

test('bitmap超时后迟到结果只释放资源，能力缺失时使用load加canvas而不等待Image.decode', async () => {
  const pending = deferred(), asset = imageAsset();
  const ui = await dashboard(23, { assets: [asset], bitmapCapability: true, bitmapHandler: () => pending.promise }); await ready(ui); await ui.fire('message-back');
  await ui.message(1, 'type', 'change', { value: 'image' }); await ui.message(1, 'image-select', 'change', { value: asset.id });
  await ui.expireImageOperations(); assert.match(ui.messageRows()[1].textContent, /10.*秒/);
  pending.resolve({ width: 1, height: 1 }); await settle();
  await ui.fire('message-next'); assert.equal(ui.nodes.get('audience-step').hidden, true); assert.equal(ui.bitmaps[0].closed, true);
  const fallback = await dashboard(23, { assets: [asset], imageDecodeMethod: () => new Promise(() => {}) }); await ready(fallback); await fallback.fire('message-back');
  await fallback.message(1, 'type', 'change', { value: 'image' }); await fallback.message(1, 'image-select', 'change', { value: asset.id });
  await fallback.fire('message-next'); assert.equal(fallback.nodes.get('audience-step').hidden, false);
  assert.equal(fallback.canvasDraws.length, 1);
});

test('间隔输入框与校验同一口径：少于1秒不进入选择达人步骤', async () => {
  assert.match(html, /<input\b[^>]*id="interval"[^>]*\bmin="1"/);
  const ui = await dashboard(3);
  await ui.message(0, 'content', 'input', { value: 'Halo {{name}}' });
  await ui.message(1, 'type', 'change', { value: 'link' });
  await ui.message(1, 'content', 'input', { value: 'https://shopee.co.id/product/1/2' });
  await ui.fire('interval', 'input', { value: '0.5' });
  await ui.fire('message-next');
  assert.match(ui.nodes.get('notice').textContent, /不小于 1 秒/);
  assert.equal(ui.nodes.get('configuration-step').hidden, false);
  assert.equal(ui.nodes.get('audience-step').hidden, true);
});
