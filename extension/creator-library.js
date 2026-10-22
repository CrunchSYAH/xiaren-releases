const ids = ['library-skip', 'main', 'library-notice', 'library-capacity', 'library-refresh', 'library-query', 'library-shop-filter', 'library-tag-filter', 'library-type-filter', 'library-verification-filter', 'library-body', 'library-empty', 'library-range', 'library-previous', 'library-next', 'library-selection-count', 'library-target-shop', 'library-return', 'library-clear-selection', 'library-export-json', 'library-export-csv', 'library-form', 'library-editor-title', 'library-name', 'library-identity-type', 'library-identity-value', 'library-shop', 'library-source-kind', 'library-source-label', 'library-tags', 'library-note', 'library-save', 'library-cancel-edit', 'library-import-file', 'library-import-text', 'library-import-format', 'library-import'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const typeNames = { shopee_user_id: 'Shopee 用户 ID', affiliate_id: '联盟伙伴 ID', unknown: '未知身份' };
const sourceNames = { manual: '手工整理', import: '文件导入', marketplace: '达人广场', leaderboard: '排行榜', specified: '指定伙伴' };
const formFields = ['library-name', 'library-identity-type', 'library-identity-value', 'library-shop', 'library-source-kind', 'library-source-label', 'library-tags', 'library-note'];
let view = null, ready = false, busy = false, page = 1, listSequence = 0, actionSequence = 0;
let editingId = null, editRevision = null;
const selected = new Set(), PAGE_SIZE = 10;

function create(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = String(value ?? '');
  if (className) node.className = className;
  return node;
}
function notice(value = '', error = false) {
  ui['library-notice'].textContent = value;
  ui['library-notice'].hidden = !value;
  ui['library-notice'].className = `notice${error ? ' error' : ''}`;
}
function filters() {
  return { query: ui['library-query'].value.trim(), shopId: ui['library-shop-filter'].value, tag: ui['library-tag-filter'].value, identityType: ui['library-type-filter'].value, verification: ui['library-verification-filter'].value };
}
async function request(type, values = {}) {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') throw new Error('请从已加载的“虾仁”扩展打开达人库。');
  const result = await chrome.runtime.sendMessage({ type, ...values });
  if (!result?.ok) throw new Error(result?.error || '达人库操作失败，请刷新重试；若刚更新扩展，请重新加载扩展。');
  return result;
}
function controls() {
  for (const id of [...formFields, 'library-save', 'library-import', 'library-import-file', 'library-import-text', 'library-import-format']) ui[id].disabled = busy || !ready;
  for (const id of ['library-export-json', 'library-export-csv']) ui[id].disabled = busy || !ready || !view?.records.length;
  ui['library-cancel-edit'].disabled = busy;
  ui['library-return'].disabled = busy || !ready || !selected.size || !ui['library-target-shop'].value.trim();
  ui['library-clear-selection'].disabled = busy || !selected.size;
  ui['library-selection-count'].textContent = `已选择 ${selected.size} 人`;
}
function setBusy(value) { busy = value; controls(); }
function clearSelection() { selected.clear(); controls(); }
function optionList(id, values, emptyLabel) {
  const old = ui[id].value, empty = create('option', emptyLabel); empty.value = '';
  ui[id].replaceChildren(empty);
  const choices = [...new Set([...values, ...(old ? [old] : [])])];
  for (const value of choices) { const option = create('option', value); option.value = value; ui[id].append(option); }
  ui[id].value = old;
}
function render() {
  const rows = view?.records || [], pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, pages); const start = (page - 1) * PAGE_SIZE;
  ui['library-body'].replaceChildren();
  for (const record of rows.slice(start, start + PAGE_SIZE)) {
    const row = create('tr'), choose = create('td'), checkbox = create('input');
    checkbox.type = 'checkbox'; checkbox.checked = selected.has(record.id);
    checkbox.disabled = busy || !record.shopeeUserId || !record.shopId || record.shopId !== ui['library-target-shop'].value.trim();
    checkbox.setAttribute('aria-label', `选择 ${record.name || record.identityValue}`);
    checkbox.title = !record.shopeeUserId ? '先核实 Shopee 用户 ID 映射' : !record.shopId ? '先补全店铺 ID' : '选择后仍须页面核对';
    checkbox.addEventListener('change', () => {
      if (busy || checkbox.disabled) return;
      actionSequence++;
      if (checkbox.checked) {
        if (selected.size >= 200) { checkbox.checked = false; notice('每次最多选择200人。', true); return; }
        selected.add(record.id);
      } else selected.delete(record.id);
      controls();
    });
    const checkTarget = create('label', undefined, 'checkbox-target'); checkTarget.append(checkbox); choose.append(checkTarget);
    const identity = create('td'); identity.append(create('strong', record.name || '未填写姓名'), create('small', `${typeNames[record.identityType]}：${record.identityValue}`));
    if (record.identityType !== 'shopee_user_id' && record.shopeeUserId) identity.append(create('small', `已记录用户 ID：${record.shopeeUserId}`));
    const scope = create('td', `ID · 印尼`); scope.append(create('small', record.shopId || '店铺待补全'));
    const memo = create('td', record.tags.length ? record.tags.join('、') : '无标签'); memo.append(create('small', record.note || '暂无备注', 'note'));
    const origin = create('td', sourceNames[record.source.kind] || '来源未记录');
    if (record.source.label) origin.append(create('small', record.source.label));
    origin.append(create('span', record.verification.status === 'page_verified' ? '曾经页面核实' : '待页面核实', `badge${record.verification.status === 'page_verified' ? ' good' : ''}`));
    const action = create('td'), edit = create('button', '编辑'); edit.type = 'button'; edit.disabled = busy;
    edit.addEventListener('click', () => editRecord(record)); action.append(edit);
    row.append(choose, identity, scope, memo, origin, action); ui['library-body'].append(row);
  }
  ui['library-empty'].hidden = rows.length > 0;
  ui['library-range'].textContent = rows.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} / ${rows.length} 条；第 ${page} / ${pages} 页` : '共 0 条';
  ui['library-previous'].disabled = page <= 1; ui['library-next'].disabled = page >= pages;
  controls();
}
async function loadList({ keepNotice = false } = {}) {
  const sequence = ++listSequence; actionSequence++; ready = false; view = null; page = 1; clearSelection(); render();
  ui['library-body'].setAttribute('aria-busy', 'true'); ui['library-empty'].textContent = '正在读取本机达人库…';
  if (!keepNotice) notice();
  try {
    const result = await request('panel:library-list', { filters: filters() });
    if (sequence !== listSequence) return;
    if (!Array.isArray(result.creatorLibrary?.records) || !Number.isSafeInteger(result.creatorLibrary.revision)) throw new Error('达人库响应不完整，请刷新重试。');
    view = result.creatorLibrary; ready = true;
    optionList('library-shop-filter', view.shops || [], '全部店铺'); optionList('library-tag-filter', view.tags || [], '全部标签');
    const cap = view.capacity;
    ui['library-capacity'].textContent = `${cap.count} / ${cap.limit} 条 · ${(cap.bytes / 1024).toFixed(1)} / ${(cap.maxBytes / 1024).toFixed(0)} KiB`;
    ui['library-empty'].textContent = '没有符合条件的达人。可以添加、导入或调整筛选条件。'; render();
  } catch (error) {
    if (sequence !== listSequence) return;
    ui['library-empty'].textContent = '达人库未能读取，请刷新重试。'; ui['library-capacity'].textContent = '读取失败'; notice(error.message, true);
  } finally { if (sequence === listSequence) { ui['library-body'].setAttribute('aria-busy', 'false'); controls(); } }
}
function resetEditor() {
  editingId = null; editRevision = null;
  for (const id of formFields) ui[id].value = '';
  ui['library-identity-type'].value = 'shopee_user_id'; ui['library-source-kind'].value = 'manual';
  ui['library-shop'].value = ui['library-target-shop'].value.trim();
  ui['library-editor-title'].textContent = '添加达人'; ui['library-save'].textContent = '保存达人'; ui['library-cancel-edit'].textContent = '清空表单';
}
function editRecord(record) {
  if (busy || !ready) return;
  editingId = record.id; editRevision = view.revision;
  const joinedTags = record.tags.join(', ');
  const tagText = record.tags.some(tag => /[,，]/.test(tag)) || joinedTags.trim().startsWith('[') ? JSON.stringify(record.tags) : joinedTags;
  for (const [id, value] of [['library-name', record.name], ['library-identity-type', record.identityType], ['library-identity-value', record.identityValue], ['library-shop', record.shopId], ['library-source-kind', record.source.kind], ['library-source-label', record.source.label], ['library-tags', tagText], ['library-note', record.note]]) ui[id].value = value;
  ui['library-editor-title'].textContent = '编辑达人'; ui['library-save'].textContent = '保存修改'; ui['library-cancel-edit'].textContent = '取消编辑'; ui['library-editor-title'].focus();
}
function draft() {
  const tagText = ui['library-tags'].value.trim(); let tags;
  if (tagText.startsWith('[')) {
    try { tags = JSON.parse(tagText); if (!Array.isArray(tags)) throw new Error(); }
    catch { throw new Error('标签数组格式无效，请使用完整的双引号与方括号，或改用逗号分隔。'); }
  } else tags = tagText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
  return { name: ui['library-name'].value, identityType: ui['library-identity-type'].value, identityValue: ui['library-identity-value'].value.trim(), site: 'ID', shopId: ui['library-shop'].value, source: { kind: ui['library-source-kind'].value, label: ui['library-source-label'].value }, tags, note: ui['library-note'].value };
}
async function save(event) {
  event.preventDefault(); if (busy || !ready) return;
  let values;
  try { values = { draft: draft(), expectedRevision: editingId ? editRevision : view.revision, ...(editingId ? { recordId: editingId } : {}) }; }
  catch (error) { notice(error.message, true); return; }
  const type = editingId ? 'panel:library-update' : 'panel:library-add';
  setBusy(true); notice();
  try { await request(type, values); resetEditor(); notice('达人已保存。身份仍须按当前店铺页面核对。'); await loadList({ keepNotice: true }); }
  catch (error) { notice(error.message + (editingId && /版本/.test(error.message) ? ' 请先保留草稿，刷新列表后重新点击该达人“编辑”，核对最新内容。' : ''), true); }
  finally { setBusy(false); render(); }
}
async function importRecords() {
  if (busy || !ready) return;
  const expectedRevision = view.revision, sequence = ++actionSequence;
  const file = ui['library-import-file'].files?.[0], pasted = ui['library-import-text'].value, format = ui['library-import-format'].value;
  setBusy(true); notice(); let timer;
  try {
    if (file && pasted.trim()) throw new Error('请选择文件或粘贴内容中的一种，避免导错名单。');
    if (file && file.size > 4 * 1024 * 1024) throw new Error('导入文件不能超过4MiB。');
    const content = file ? await Promise.race([file.text(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取文件超时，请重新选择文件。')), 10000); })]) : pasted;
    clearTimeout(timer);
    if (sequence !== actionSequence) return;
    if (!content.trim()) throw new Error('请先选择JSON/CSV文件或粘贴内容。');
    const result = await request('panel:library-import', { expectedRevision, content, format });
    ui['library-import-text'].value = ''; ui['library-import-file'].value = '';
    notice(`已导入 ${result.added} 条，跳过 ${result.skipped} 条重复身份；原记录未覆盖。`);
    await loadList({ keepNotice: true });
  } catch (error) { notice(error.message, true); }
  finally { clearTimeout(timer); setBusy(false); render(); }
}
async function exportRecords(format) {
  if (busy || !ready || !view.records.length) return;
  const sequence = ++actionSequence; setBusy(true); notice();
  try {
    const { creatorLibraryExport: report } = await request('panel:library-export', { format, filters: filters() });
    if (sequence !== actionSequence) return;
    if (typeof report?.content !== 'string') throw new Error('导出响应不完整，请刷新重试。');
    const url = URL.createObjectURL(new Blob([report.content], { type: report.mime })), link = create('a');
    link.href = url; link.download = `虾仁-达人库-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notice(`已导出 ${report.count} 条达人记录。文件包含身份和备注，请妥善保存。`);
  } catch (error) { if (sequence === actionSequence) notice(error.message, true); }
  finally { setBusy(false); render(); }
}
async function returnSelection() {
  if (busy || !ready || !selected.size) return;
  const sequence = ++actionSequence;
  const values = { recordIds: [...selected], expectedRevision: view.revision, site: 'ID', shopId: ui['library-target-shop'].value.trim() };
  setBusy(true); notice();
  try {
    const { creatorLibrarySelection: selection } = await request('panel:library-select', values);
    if (sequence !== actionSequence) return;
    if (selection?.kind !== 'creator-library-selection' || selection.requiresPageVerification !== true || !Array.isArray(selection.records)) throw new Error('选择响应不完整，请刷新重试。');
    // The dashboard re-reads these IDs on explicit apply; notes and tags do not
    // belong in a handoff and can exceed its temporary storage input limit.
    const handoff = { version: selection.version, kind: selection.kind, libraryRevision: selection.libraryRevision, site: selection.site, shopId: selection.shopId,
      records: selection.records.map(({ id }) => ({ id })), requiresPageVerification: true };
    sessionStorage.setItem('creatorLibrarySelection', JSON.stringify(handoff));
    location.href = 'dashboard.html';
  } catch (error) { if (sequence === actionSequence) notice(error.message || '交接名单失败，请重新选择。', true); }
  finally { setBusy(false); render(); }
}

ui['library-skip'].addEventListener('click', event => { event.preventDefault(); ui.main.focus(); });
ui['library-refresh'].addEventListener('click', () => loadList());
for (const id of ['library-shop-filter', 'library-tag-filter', 'library-type-filter', 'library-verification-filter']) ui[id].addEventListener('change', () => loadList());
ui['library-query'].addEventListener('input', () => loadList());
ui['library-target-shop'].addEventListener('input', () => { actionSequence++; clearSelection(); render(); });
ui['library-clear-selection'].addEventListener('click', () => { actionSequence++; clearSelection(); render(); });
ui['library-return'].addEventListener('click', returnSelection);
ui['library-form'].addEventListener('submit', save);
ui['library-cancel-edit'].addEventListener('click', () => { if (!busy) resetEditor(); });
ui['library-import'].addEventListener('click', importRecords);
ui['library-import-file'].addEventListener('change', () => {
  const file = ui['library-import-file'].files?.[0];
  if (file && /\.(csv|json)$/i.test(file.name)) ui['library-import-format'].value = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
});
ui['library-export-json'].addEventListener('click', () => exportRecords('json'));
ui['library-export-csv'].addEventListener('click', () => exportRecords('csv'));
for (const [id, delta] of [['library-previous', -1], ['library-next', 1]]) ui[id].addEventListener('click', () => {
  if (!ready || page + delta < 1 || page + delta > Math.max(1, Math.ceil(view.records.length / PAGE_SIZE))) return;
  page += delta; render();
});
try {
  const context = JSON.parse(sessionStorage.getItem('creatorLibraryContext') || 'null');
  sessionStorage.removeItem('creatorLibraryContext');
  if (context?.site === 'ID' && typeof context.shopId === 'string' && context.shopId.length <= 100) ui['library-target-shop'].value = context.shopId;
} catch { /* No shared browser storage is needed to browse the library. */ }
resetEditor();
loadList();
