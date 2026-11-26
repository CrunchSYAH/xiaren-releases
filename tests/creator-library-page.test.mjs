import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { importCreatorLibraryRecords, selectCreatorLibrary } from '../extension/core/creator-library.mjs';

const optional = file => readFile(new URL(file, import.meta.url), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
const html = await optional('../extension/creator-library.html');
const script = await optional('../extension/creator-library.js');
const ids = ['library-skip', 'main', 'library-notice', 'library-capacity', 'library-refresh', 'library-query', 'library-shop-filter', 'library-tag-filter', 'library-type-filter', 'library-verification-filter', 'library-body', 'library-empty', 'library-range', 'library-previous', 'library-next', 'library-selection-count', 'library-target-shop', 'library-return', 'library-clear-selection', 'library-export-json', 'library-export-csv', 'library-form', 'library-editor-title', 'library-name', 'library-identity-type', 'library-identity-value', 'library-shop', 'library-source-kind', 'library-source-label', 'library-tags', 'library-note', 'library-save', 'library-cancel-edit', 'library-import-file', 'library-import-text', 'library-import-format', 'library-import'];
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.files = []; }
  set textContent(value) { this.content = String(value); this.children = []; }
  get textContent() { return (this.content || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('达人数据不能插入HTML'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.content = ''; this.children = nodes; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  focus() { this.focused = true; }
  fire(type, values = {}) { Object.assign(this, values); const event = { target: this, preventDefault() { this.prevented = true; } }; for (const handler of this.listeners[type] || []) handler(event); return event; }
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const records = () => [{ id: 'r1', name: '<img src=x onerror=1>', identityType: 'shopee_user_id', identityValue: '123', site: 'ID', shopId: '10', source: { kind: 'manual', label: '手工' }, tags: ['美妆'], note: '<script>note</script>', shopeeUserId: '123', verification: { status: 'unverified', checkedAt: null }, revision: 1, createdAt: 1, updatedAt: 1 }, { id: 'r2', name: '伙伴', identityType: 'affiliate_id', identityValue: '789', site: 'ID', shopId: '10', source: { kind: 'import', label: '' }, tags: [], note: '', shopeeUserId: null, verification: { status: 'unverified', checkedAt: null }, revision: 1, createdAt: 1, updatedAt: 1 }];
async function page({ opener = null, customRecords = null } = {}) {
  const nodes = new Map(ids.map(id => [id, new Element()]));
  nodes.get('library-identity-type').value = 'shopee_user_id'; nodes.get('library-source-kind').value = 'manual'; nodes.get('library-import-format').value = 'json';
  const messages = [], downloads = [], blobs = [], storage = new Map([['creatorLibraryContext', JSON.stringify({ site: 'ID', shopId: '10' })]]); let hook;
  const location = { href: '' };
  vm.runInNewContext(script, { window: { opener }, document: { getElementById: id => nodes.get(id), createElement: tag => { const node = new Element(tag); node.click = () => { if (tag === 'a') downloads.push(node.download); else node.fire('click'); }; return node; } }, chrome: { runtime: { id: 'demo', sendMessage: async message => {
    messages.push(structuredClone(message)); const value = await hook?.(message); if (value !== undefined) return value;
    if (message.type === 'panel:library-select') return { ok: true, creatorLibrarySelection: { version: 1, kind: 'creator-library-selection', libraryRevision: 1, site: 'ID', shopId: '10', records: records().slice(0, 1), creatorIds: ['123'], requiresPageVerification: true } };
    if (message.type === 'panel:library-export') return { ok: true, creatorLibraryExport: { format: message.format, mime: 'text/plain', content: 'backup', count: 2 } };
    return { ok: true, creatorLibrary: { version: 1, revision: 1, records: customRecords || records(), capacity: { count: 2, limit: 2000, bytes: 1000, maxBytes: 2097152 }, shops: ['10'], tags: ['美妆'] }, added: 1, skipped: 0 };
  } } }, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, location, Blob, URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:library'; }, revokeObjectURL() {} }, setTimeout, clearTimeout });
  await settle();
  return { nodes, messages, storage, downloads, blobs, location, hook: value => { hook = value; }, async fire(id, type = 'click', value) { nodes.get(id).fire(type, value); await settle(); }, async choose(index = 0) { const check = descendants(nodes.get('library-body').children[index]).find(node => node.tagName === 'input'); check.fire('change', { checked: true }); await settle(); return check; }, async edit(index = 0) { descendants(nodes.get('library-body').children[index]).find(node => node.tagName === 'button').fire('click'); await settle(); } };
}

test('库页独立加载和安全展示，伙伴身份禁选，入口齐全且无队列操作', async () => {
  assert.match(html, /src="creator-library\.js"/);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`));
  const ui = await page();
  assert.deepEqual(ui.messages.map(message => message.type), ['panel:library-list']);
  assert.match(ui.nodes.get('library-body').textContent, /<img src=x onerror=1>/);
  assert.match(ui.nodes.get('library-body').textContent, /待页面核实/);
  assert.equal(descendants(ui.nodes.get('library-body').children[1]).find(node => node.tagName === 'input').disabled, true);
  assert.equal(ui.nodes.get('library-target-shop').value, '10');
});

test('选人交回同标签页临时交接，仍需工作台显式套用与页面核对', async () => {
  const ui = await page(); await ui.choose(); await ui.fire('library-return');
  const request = ui.messages.find(message => message.type === 'panel:library-select');
  assert.deepEqual(request.recordIds, ['r1']); assert.equal(request.shopId, '10');
  const pending = JSON.parse(ui.storage.get('creatorLibrarySelection'));
  assert.equal(pending.requiresPageVerification, true);
  assert.equal(ui.location.href, 'dashboard.html');
  assert.equal(ui.messages.every(message => message.type.startsWith('panel:library-')), true);
});

test('200条合法长记录只交接记录ID，不因备注标签超过工作台读取上限', async () => {
  let id = 0;
  const { store } = importCreatorLibraryRecords(undefined, Array.from({ length: 200 }, (_, index) => ({
    identityType: 'shopee_user_id', identityValue: String(index + 1), site: 'ID', shopId: '10',
    name: 'n'.repeat(120), note: 'n'.repeat(1000), tags: Array.from({ length: 20 }, (_, tag) => String(tag).padEnd(30, 't')),
  })), { now: 1, expectedRevision: 0, uid: () => `r${++id}` });
  const ui = await page({ opener: { closed: true }, customRecords: store.records });
  ui.hook(message => message.type === 'panel:library-select' ? { ok: true, creatorLibrarySelection: selectCreatorLibrary(store, message) } : undefined);
  for (let page = 0; page < 20; page++) {
    for (let row = 0; row < 10; row++) await ui.choose(row);
    if (page < 19) await ui.fire('library-next');
  }
  await ui.fire('library-return');
  const raw = ui.storage.get('creatorLibrarySelection'), pending = JSON.parse(raw);
  assert.equal(pending.records.length, 200);
  assert.ok(raw.length < 300000, '合法名单必须能被工作台读取');
  assert.deepEqual(pending.records, store.records.map(({ id }) => ({ id })));
  assert.deepEqual(Object.keys(pending).sort(), ['version', 'kind', 'libraryRevision', 'site', 'shopId', 'records', 'requiresPageVerification'].sort());
  assert.equal(pending.libraryRevision, store.revision);
  assert.equal(ui.location.href, 'dashboard.html');
});

test('即使存在旧opener也在当前标签页交回，不聚焦或操作其他工作台', async () => {
  const messages = []; let focused = false;
  const ui = await page({ opener: { closed: false, postMessage: (message, origin) => messages.push({ message: structuredClone(message), origin }), focus: () => { focused = true; } } });
  await ui.choose(); await ui.fire('library-return');
  assert.equal(messages.length, 0);
  assert.deepEqual(JSON.parse(ui.storage.get('creatorLibrarySelection')).records, [{ id: 'r1' }]);
  assert.equal(ui.location.href, 'dashboard.html'); assert.equal(focused, false);
});

test('编辑标签备注使用编辑开始版本，刷新不覆盖草稿，错误保留输入', async () => {
  const ui = await page(); await ui.edit();
  await ui.fire('library-note', 'input', { value: '新备注' });
  await ui.fire('library-refresh');
  assert.equal(ui.nodes.get('library-note').value, '新备注');
  ui.hook(message => message.type === 'panel:library-update' ? { ok: false, error: '达人库版本已变化，请刷新' } : undefined);
  await ui.fire('library-form', 'submit');
  const request = ui.messages.find(message => message.type === 'panel:library-update');
  assert.equal(request.expectedRevision, 1); assert.equal(request.draft.note, '新备注'); assert.equal(request.recordId, 'r1');
  assert.equal(ui.nodes.get('library-note').value, '新备注');
  assert.match(ui.nodes.get('library-notice').textContent, /版本已变化/);
});

test('导入标签本身含逗号或数组样式文字时，只改备注无损保留标签', async () => {
  for (const tags of [['beauty, skincare', 'a，b'], ['["合作"]'], ['[合作]'], ['[合作]', '其他']]) {
    const imported = records(); imported[0].tags = tags;
    const ui = await page({ customRecords: imported }); await ui.edit();
    await ui.fire('library-note', 'input', { value: '只更新备注' }); await ui.fire('library-form', 'submit');
    assert.deepEqual(ui.messages.find(message => message.type === 'panel:library-update').draft.tags, imported[0].tags);
  }
});

test('过滤或刷新使旧选择导出回包失效，读取失败清空旧列表并禁用保存', async () => {
  const ui = await page(), response = deferred(); await ui.choose();
  ui.hook(message => message.type === 'panel:library-select' ? response.promise : undefined);
  await ui.fire('library-return'); await ui.fire('library-shop-filter', 'change', { value: '11' });
  response.resolve({ ok: true, creatorLibrarySelection: { kind: 'creator-library-selection', requiresPageVerification: true } }); await settle();
  assert.equal(ui.storage.has('creatorLibrarySelection'), false);
  assert.equal(ui.location.href, '');
  ui.hook(message => message.type === 'panel:library-list' ? { ok: false, error: '达人库读取失败' } : undefined);
  await ui.fire('library-refresh');
  assert.equal(ui.nodes.get('library-body').children.length, 0);
  assert.equal(ui.nodes.get('library-save').disabled, true);
  assert.match(ui.nodes.get('library-notice').textContent, /读取失败/);
});

test('JSON导入和导出仅走库接口，不附带发送声明', async () => {
  const ui = await page();
  await ui.fire('library-import-text', 'input', { value: '[{"identityType":"unknown"}]' });
  await ui.fire('library-import');
  const imported = ui.messages.find(message => message.type === 'panel:library-import');
  assert.equal(imported.format, 'json'); assert.equal(imported.expectedRevision, 1);
  assert.equal(imported.content, '[{"identityType":"unknown"}]');
  await ui.fire('library-export-json');
  assert.equal(ui.downloads.length, 1); assert.equal(await ui.blobs[0].text(), 'backup');
  assert.equal(ui.messages.every(message => message.type.startsWith('panel:library-')), true);
});
