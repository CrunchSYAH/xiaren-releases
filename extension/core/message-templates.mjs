import { normalizeMessages } from './queue.mjs';

const LIMIT = 50, MAX_BYTES = 512 * 1024;
const corrupt = () => new Error('本地消息模板损坏或版本不兼容；原数据已保留，请先检查备份');
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const nameKey = name => name.trim().toLowerCase();

export function emptyMessageTemplates() { return { version: 1, templates: [] }; }

function normalizeDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('消息模板内容无效');
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (!name || name.length > 50 || /[\u0000-\u001f\u007f-\u009f]/.test(draft.name)) throw new Error('模板名称须为1—50个字符，不能包含控制字符');
  if (Object.hasOwn(draft, 'messages')) {
    if (Object.hasOwn(draft, 'template') || Object.hasOwn(draft, 'productLink')) throw new Error('消息序列不能与旧话术或产品链接字段混用');
    return { name, messages: normalizeMessages(draft.messages) };
  }
  const template = draft.template;
  if (typeof template !== 'string' || !template.trim() || template.length > 2000) throw new Error('模板话术不能为空，最多2000个字符');
  const remainder = template.replace(/\{\{name\}\}/g, '');
  if (remainder.includes('{{') || remainder.includes('}}')) throw new Error('模板话术仅支持 {{name}} 变量，请检查未知或未闭合变量');
  const productLink = typeof draft.productLink === 'string' ? draft.productLink.trim() : '';
  let url;
  try { url = new URL(productLink); } catch { throw new Error('产品链接必须是完整的 HTTP 或 HTTPS 网址'); }
  if (!productLink || productLink.length > 2000 || /\s/.test(productLink) || !/^https?:\/\//i.test(productLink) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('产品链接必须是不含空白或凭证的完整 HTTP 或 HTTPS 网址，最多2000个字符');
  return { name, template, productLink };
}

function validTime(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('模板时间无效');
  return value;
}

function capacity(store) {
  return { count: store.templates.length, limit: LIMIT, bytes: jsonBytes(store), maxBytes: MAX_BYTES };
}

function checkCapacity(store) {
  const size = capacity(store);
  if (size.count > LIMIT || size.bytes > MAX_BYTES) throw new Error('消息模板已达到50条或512KiB容量上限；原数据已保留，请精简内容后重试');
  return store;
}

export function readMessageTemplates(value) {
  if (value === undefined) return emptyMessageTemplates();
  try {
    if (!value || value.version !== 1 || !Array.isArray(value.templates)) throw corrupt();
    const ids = new Set(), names = new Set();
    const templates = Array.from(value.templates, record => {
      if (!record || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id) || !Number.isSafeInteger(record.revision) || record.revision < 1) throw corrupt();
      const fields = normalizeDraft(record), key = nameKey(fields.name);
      if (names.has(key)) throw corrupt();
      ids.add(record.id); names.add(key);
      return { id: record.id, ...fields, revision: record.revision, createdAt: validTime(record.createdAt), updatedAt: validTime(record.updatedAt) };
    });
    return checkCapacity({ version: 1, templates });
  } catch { throw corrupt(); }
}

export function listMessageTemplates(store) {
  const saved = readMessageTemplates(store);
  return { version: 1, templates: [...saved.templates].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)), capacity: capacity(saved) };
}

function checkName(store, name, exceptId) {
  if (store.templates.some(record => record.id !== exceptId && nameKey(record.name) === nameKey(name))) throw new Error('模板名称已存在，请使用其他名称');
}

function checkId(store, id) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('模板ID不能为空');
  if (store.templates.some(record => record.id === id)) throw new Error('模板ID已存在，请刷新后重试');
}

function existingTemplate(store, templateId, expectedRevision) {
  const record = store.templates.find(item => item.id === templateId);
  if (!record) throw new Error('模板不存在，请刷新模板列表');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== record.revision) throw new Error('模板版本已变化，请刷新模板列表后重试');
  return record;
}

export function createMessageTemplate(store, draft, options = {}) {
  const { id, now } = options || {};
  const saved = readMessageTemplates(store), fields = normalizeDraft(draft);
  checkId(saved, id); checkName(saved, fields.name);
  const record = { id, ...fields, revision: 1, createdAt: validTime(now), updatedAt: now };
  return checkCapacity({ version: 1, templates: [...saved.templates, record] });
}

export function updateMessageTemplate(store, input = {}, options = {}) {
  const { templateId, expectedRevision, draft } = input || {}, { now } = options || {};
  const saved = readMessageTemplates(store), current = existingTemplate(saved, templateId, expectedRevision);
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('模板版本已达到上限，请复制为新模板');
  const fields = normalizeDraft(draft);
  checkName(saved, fields.name, current.id);
  const updated = { id: current.id, ...fields, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: validTime(now) };
  return checkCapacity({ version: 1, templates: saved.templates.map(record => record.id === current.id ? updated : record) });
}

function copyName(store, original) {
  for (let index = 1; ; index++) {
    const suffix = ` · 副本${index === 1 ? '' : index}`;
    let prefix = original.slice(0, 50 - suffix.length);
    if (/[\ud800-\udbff]$/.test(prefix)) prefix = prefix.slice(0, -1);
    const name = prefix + suffix;
    if (!store.templates.some(record => nameKey(record.name) === nameKey(name))) return name;
  }
}

export function copyMessageTemplate(store, input = {}, options = {}) {
  const { templateId, expectedRevision, name } = input || {}, { id, now } = options || {};
  const saved = readMessageTemplates(store), source = existingTemplate(saved, templateId, expectedRevision);
  const content = source.messages ? { messages: source.messages } : { template: source.template, productLink: source.productLink };
  return createMessageTemplate(saved, { name: name === undefined ? copyName(saved, source.name) : name, ...content }, { id, now });
}
