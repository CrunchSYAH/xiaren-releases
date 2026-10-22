// Pure local library. No queue, browser, network or task authority belongs here.
export const CREATOR_LIBRARY_KEY = 'creatorLibrary';
export const CREATOR_LIBRARY_LIMIT = 2000;
export const CREATOR_LIBRARY_MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['shopee_user_id', 'affiliate_id', 'unknown'];
const SOURCES = ['manual', 'import', 'marketplace', 'leaderboard', 'specified'];
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const corrupt = () => new Error('本地达人库损坏或版本不兼容；原数据已保留，请先导出浏览器存储备份后检查');
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function emptyCreatorLibrary() { return { version: 1, revision: 0, records: [] }; }

function text(value, name, max, { optional = false, multiline = false } = {}) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/).test(value)) throw new Error(`${name}须为${optional ? '0' : '1'}—${max}个字符且不含控制字符`);
  return value.trim();
}
function numericId(value, name) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,29}$/.test(value)) throw new Error(`${name}须为1—30位非零开头的数字字符串`);
  return value;
}
function scope(value) {
  if (!object(value) || value.site !== 'ID') throw new Error('达人库站点仅支持 ID（印尼）');
  const shopId = text(value.shopId, '店铺ID', 100, { optional: true });
  return { site: 'ID', shopId };
}
function fields(value, defaultSource = 'manual') {
  if (!object(value) || !TYPES.includes(value.identityType)) throw new Error('达人身份类型须为 Shopee 用户 ID、联盟伙伴 ID 或未知身份');
  const identityValue = value.identityType === 'unknown' ? text(value.identityValue, '未知身份标识', 100) : numericId(value.identityValue, '达人身份ID');
  const tags = value.tags === undefined ? [] : value.tags;
  if (!Array.isArray(tags) || tags.length > 20) throw new Error('标签最多20个，每个最多30个字符');
  const normalizedTags = [...new Set(Array.from(tags, tag => text(tag, '标签', 30)))];
  const source = value.source === undefined ? { kind: defaultSource, label: '' } : value.source;
  if (!object(source) || !SOURCES.includes(source.kind)) throw new Error('达人来源无效');
  return { name: text(value.name, '达人姓名', 120, { optional: true }), identityType: value.identityType, identityValue, ...scope(value),
    source: { kind: source.kind, label: text(source.label, '来源说明', 120, { optional: true }) }, tags: normalizedTags,
    note: text(value.note, '备注', 1000, { optional: true, multiline: true }) };
}
const identityKey = record => JSON.stringify([record.site, record.shopId, record.identityType, record.identityValue]);
const unverified = () => ({ status: 'unverified', checkedAt: null });
const initialUserId = record => record.identityType === 'shopee_user_id' ? record.identityValue : null;
function validTime(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('达人记录时间无效');
  return value;
}
function capacity(store) { return { count: store.records.length, limit: CREATOR_LIBRARY_LIMIT, bytes: bytes(store), maxBytes: CREATOR_LIBRARY_MAX_BYTES }; }
function checkCapacity(store) {
  if (store.records.length > CREATOR_LIBRARY_LIMIT || bytes(store) > CREATOR_LIBRARY_MAX_BYTES) throw new Error('达人库达到2000条或2MiB容量上限；原记录已保留，请减少新增内容');
  return store;
}
function revision(store, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== store.revision) throw new Error('达人库版本已变化，请刷新后重试；未覆盖其他窗口修改');
  if (store.revision === Number.MAX_SAFE_INTEGER) throw new Error('达人库版本达到上限，请先导出备份');
}

export function readCreatorLibrary(value) {
  if (value === undefined) return emptyCreatorLibrary();
  try {
    if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.records) || value.records.length > CREATOR_LIBRARY_LIMIT || bytes(value) > CREATOR_LIBRARY_MAX_BYTES) throw corrupt();
    const ids = new Set(), identities = new Set();
    const records = Array.from(value.records, record => {
      if (!object(record) || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision > value.revision) throw corrupt();
      const id = text(record.id, '达人记录ID', 100), normalized = fields(record), key = identityKey(normalized);
      if (ids.has(id) || identities.has(key) || !object(record.verification)) throw corrupt();
      ids.add(id); identities.add(key);
      let verification, shopeeUserId;
      if (record.verification.status === 'unverified') {
        if (record.verification.checkedAt !== null || record.shopeeUserId !== initialUserId(normalized)) throw corrupt();
        verification = unverified(); shopeeUserId = initialUserId(normalized);
      } else if (record.verification.status === 'page_verified') {
        if (!normalized.shopId || normalized.identityType === 'unknown') throw corrupt();
        shopeeUserId = numericId(record.shopeeUserId, '核实后的 Shopee 用户 ID');
        if (normalized.identityType === 'shopee_user_id' && shopeeUserId !== normalized.identityValue) throw corrupt();
        verification = { status: 'page_verified', checkedAt: validTime(record.verification.checkedAt) };
      } else throw corrupt();
      return { id, ...normalized, shopeeUserId, verification, revision: record.revision, createdAt: validTime(record.createdAt), updatedAt: validTime(record.updatedAt) };
    });
    return checkCapacity({ version: 1, revision: value.revision, records });
  } catch { throw corrupt(); }
}

export function listCreatorLibrary(store, filters = {}) {
  const saved = readCreatorLibrary(store);
  if (!object(filters)) throw new Error('达人库筛选条件无效');
  const query = text(filters.query, '关键词', 200, { optional: true }).toLowerCase();
  const tag = text(filters.tag, '标签', 30, { optional: true });
  const shopId = text(filters.shopId, '店铺ID', 100, { optional: true });
  if (filters.site !== undefined && filters.site !== '' && filters.site !== 'ID') throw new Error('站点仅支持 ID');
  if (filters.identityType && !TYPES.includes(filters.identityType)) throw new Error('身份筛选无效');
  if (filters.verification && !['unverified', 'page_verified'].includes(filters.verification)) throw new Error('核实状态筛选无效');
  const records = saved.records.filter(record => (!shopId || record.shopId === shopId) && (!tag || record.tags.includes(tag)) && (!filters.identityType || record.identityType === filters.identityType) && (!filters.verification || record.verification.status === filters.verification) && (!query || [record.name, record.identityValue, record.shopeeUserId || '', record.note, record.source.label, ...record.tags].some(value => value.toLowerCase().includes(query))));
  return { version: 1, revision: saved.revision, records, capacity: capacity(saved), shops: [...new Set(saved.records.map(record => record.shopId).filter(Boolean))], tags: [...new Set(saved.records.flatMap(record => record.tags))] };
}

export function createCreatorLibraryRecord(store, draft, options = {}) {
  const saved = readCreatorLibrary(store);
  revision(saved, options.expectedRevision);
  const normalized = fields(draft), id = text(options.id, '达人记录ID', 100), now = validTime(options.now);
  if (saved.records.some(record => record.id === id || identityKey(record) === identityKey(normalized))) throw new Error('该店铺的此身份已存在，请查询后编辑原记录');
  const record = { id, ...normalized, shopeeUserId: initialUserId(normalized), verification: unverified(), revision: saved.revision + 1, createdAt: now, updatedAt: now };
  return checkCapacity({ ...saved, revision: saved.revision + 1, records: [...saved.records, record] });
}

export function updateCreatorLibraryRecord(store, input = {}, options = {}) {
  const saved = readCreatorLibrary(store); revision(saved, input.expectedRevision);
  const current = saved.records.find(record => record.id === input.recordId);
  if (!current) throw new Error('达人记录不存在，请刷新后重试');
  const normalized = fields(input.draft), changedIdentity = identityKey(current) !== identityKey(normalized);
  if (saved.records.some(record => record.id !== current.id && identityKey(record) === identityKey(normalized))) throw new Error('该店铺的此身份已存在，请编辑原记录');
  const updated = { id: current.id, ...normalized, shopeeUserId: changedIdentity ? initialUserId(normalized) : current.shopeeUserId, verification: changedIdentity ? unverified() : current.verification, revision: saved.revision + 1, createdAt: current.createdAt, updatedAt: validTime(options.now) };
  return checkCapacity({ ...saved, revision: saved.revision + 1, records: saved.records.map(record => record.id === current.id ? updated : record) });
}

// Trusted integration ONLY: evidence must come from a freshly verified page,
// never from a runtime message, CSV/JSON, name match or equal numeric IDs.
// The runtime handler deliberately exposes no verification message.
export function verifyCreatorLibraryRecord(store, input = {}, options = {}) {
  const saved = readCreatorLibrary(store); revision(saved, input.expectedRevision);
  const current = saved.records.find(record => record.id === input.recordId), evidence = input.evidence;
  if (!current || current.identityType === 'unknown' || !current.shopId || !object(evidence) || identityKey(evidence) !== identityKey(current)) throw new Error('页面核实身份或店铺不符，不能保存映射');
  const shopeeUserId = numericId(evidence.shopeeUserId, '核实后的 Shopee 用户 ID');
  if (current.identityType === 'shopee_user_id' && current.identityValue !== shopeeUserId) throw new Error('页面核实与原 Shopee 用户身份矛盾');
  const now = validTime(options.now);
  const updated = { ...current, shopeeUserId, verification: { status: 'page_verified', checkedAt: now }, revision: saved.revision + 1, updatedAt: now };
  return checkCapacity({ ...saved, revision: saved.revision + 1, records: saved.records.map(record => record.id === current.id ? updated : record) });
}

export function importCreatorLibraryRecords(store, drafts, options = {}) {
  const saved = readCreatorLibrary(store); revision(saved, options.expectedRevision);
  if (!Array.isArray(drafts) || drafts.length < 1 || drafts.length > CREATOR_LIBRARY_LIMIT) throw new Error('每次导入须含1—2000条达人记录');
  const normalized = Array.from(drafts, row => fields(row, 'import'));
  const identities = new Set(saved.records.map(identityKey)), ids = new Set(saved.records.map(record => record.id));
  const records = [...saved.records], now = validTime(options.now); let added = 0, skipped = 0;
  for (const row of normalized) {
    const key = identityKey(row);
    if (identities.has(key)) { skipped++; continue; }
    const id = text(options.uid?.(), '达人记录ID', 100);
    if (ids.has(id)) throw new Error('导入记录ID重复，请刷新后重试');
    ids.add(id); identities.add(key);
    records.push({ id, ...row, shopeeUserId: initialUserId(row), verification: unverified(), revision: saved.revision + 1, createdAt: now, updatedAt: now }); added++;
  }
  return { store: checkCapacity({ ...saved, revision: saved.revision + (added ? 1 : 0), records }), added, skipped };
}

export function selectCreatorLibrary(store, input = {}) {
  const saved = readCreatorLibrary(store); revision(saved, input.expectedRevision);
  const context = scope(input);
  if (!context.shopId) throw new Error('请先指定当前店铺，之后仍须在工作台核对');
  if (!Array.isArray(input.recordIds) || input.recordIds.length < 1 || input.recordIds.length > 200 || Array.from(input.recordIds).some(id => typeof id !== 'string')) throw new Error('请选择1—200条达人记录');
  const records = [...new Set(input.recordIds)].map(id => {
    const record = saved.records.find(item => item.id === id);
    if (!record) throw new Error('选择的达人记录不存在，请刷新');
    if (record.site !== context.site || record.shopId !== context.shopId) throw new Error('所选达人与当前站点或店铺不符，请重新筛选');
    if (!record.shopeeUserId) throw new Error('所选身份尚无核实后的 Shopee 用户 ID 映射；不能交给任务');
    return record;
  });
  return { version: 1, kind: 'creator-library-selection', libraryRevision: saved.revision, ...context, creatorIds: [...new Set(records.map(record => record.shopeeUserId))], records, requiresPageVerification: true };
}

const CSV_HEADERS = ['name', 'identityType', 'identityValue', 'site', 'shopId', 'sourceKind', 'sourceLabel', 'tags', 'note'];
// Spreadsheet formula protection and numeric-string preservation. JSON is the
// lossless backup format; CSV quoting alone does not prevent formulas.
const csvCell = value => {
  const raw = String(value ?? ''), safe = /^(?:'|\s*[=+\-@]|\d+$)/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
const fromCsvCell = value => /^'(?:'|\s*[=+\-@]|\d+$)/.test(value) ? value.slice(1) : value;

export function exportCreatorLibrary(store, input = {}) {
  const result = listCreatorLibrary(store, input.filters), format = input.format ?? 'json';
  if (!['json', 'csv'].includes(format)) throw new Error('导出格式仅支持JSON或CSV');
  const content = format === 'json' ? JSON.stringify({ format: 'creator-library', version: 1, revision: result.revision, records: result.records }, null, 2) : '\ufeff' + [CSV_HEADERS.map(csvCell).join(','), ...result.records.map(record => [record.name, record.identityType, record.identityValue, record.site, record.shopId, record.source.kind, record.source.label, JSON.stringify(record.tags), record.note].map(csvCell).join(','))].join('\r\n');
  return { format, content, mime: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8', count: result.records.length, revision: result.revision };
}

function parseCsv(content) {
  const rows = []; let row = [], cell = '', quoted = false, afterQuote = false;
  const pushCell = () => { row.push(fromCsvCell(cell)); cell = ''; afterQuote = false; };
  const pushRow = () => { pushCell(); if (row.some(value => value !== '')) rows.push(row); row = []; if (rows.length > CREATOR_LIBRARY_LIMIT + 1) throw new Error('CSV最多2000条记录'); };
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"') { if (content[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; afterQuote = true; } }
      else cell += char;
    } else if (char === ',') pushCell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && content[index + 1] === '\n') index++; pushRow(); }
    else if (char === '"' && !cell && !afterQuote) quoted = true;
    else { if (afterQuote || char === '"') throw new Error('CSV引号或分隔符格式无效'); cell += char; }
  }
  if (quoted) throw new Error('CSV引号未闭合');
  if (cell || row.length || afterQuote) pushRow();
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length || headers.some(header => !CSV_HEADERS.includes(header)) || !['identityType', 'identityValue', 'site', 'shopId'].every(header => headers.includes(header))) throw new Error('CSV须包含identityType、identityValue、site、shopId列，且只能使用规定列名');
  return rows.map(values => {
    if (values.length !== headers.length) throw new Error('CSV行的列数与标题不一致');
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    let tags = [];
    try { if (row.tags) tags = JSON.parse(row.tags); } catch { throw new Error('CSV tags列须为JSON字符串数组，例如 ["美妆"]'); }
    return { name: row.name || '', identityType: row.identityType, identityValue: row.identityValue, site: row.site, shopId: row.shopId, source: { kind: row.sourceKind || 'import', label: row.sourceLabel || '' }, tags, note: row.note || '' };
  });
}

export function parseCreatorLibraryImport(content, format) {
  // Pretty JSON/quoted CSV may expand a valid 2MiB store, so files have their
  // own 4MiB input ceiling. Persisted normalized data still has a 2MiB ceiling.
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > CREATOR_LIBRARY_MAX_BYTES * 2) throw new Error('导入文件不能超过4MiB；保存后的达人库仍限2MiB');
  const clean = content.replace(/^\ufeff/, ''); let rows;
  if (format === 'csv') rows = parseCsv(clean);
  else if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(clean); } catch { throw new Error('JSON格式无效，请检查文件'); }
    if (Array.isArray(parsed)) rows = parsed;
    else if (object(parsed) && parsed.format === 'creator-library' && parsed.version === 1 && Array.isArray(parsed.records)) rows = parsed.records;
    else throw new Error('JSON格式须为达人数组或虾仁达人库导出文件');
  } else throw new Error('导入格式仅支持JSON或CSV');
  if (!rows.length || rows.length > CREATOR_LIBRARY_LIMIT) throw new Error('导入须包含1—2000条记录');
  return Array.from(rows, row => fields(row, 'import'));
}
