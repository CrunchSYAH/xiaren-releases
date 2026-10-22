import { taskElapsedMs, formatDuration } from './core/task-duration.mjs';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'connection-dot', 'connection-state', 'shop-name', 'connection-detail', 'open-page', 'export-results', 'export-diagnostics',
  'mode-badge', 'notice', 'settings-fields', 'settings-note', 'interval', 'limit', 'mode', 'mode-help',
  'dashboard-skip', 'main', 'configuration-step', 'audience-step', 'step-one-indicator', 'step-two-indicator',
  'message-editor', 'message-add', 'message-reset', 'message-next', 'message-back', 'message-sequence-count',
  'image-library-status',
  'message-preview-list', 'preview-sequence-count', 'task-name', 'source-fields', 'source-type', 'source-ids', 'source-help',
  'source-ids-field', 'source-ids-count', 'source-includes', 'source-excludes', 'marketplace-count-field', 'launch-area', 'consent-copy',
  'source-affiliate-field', 'source-affiliate-ids', 'source-affiliate-count',
  'web-filter-fields', 'web-filters-enabled', 'web-filter-refresh', 'web-filter-category-options', 'web-filter-category-empty', 'web-filter-channel-options', 'web-filter-channel-empty', 'web-filter-status', 'start-current', 'start-current-help',
  'open-library', 'library-selection', 'library-selection-status', 'library-selection-apply',
  'message-template-select', 'message-template-name', 'message-template-refresh', 'message-template-apply', 'message-template-create',
  'message-template-update', 'message-template-copy', 'message-template-status', 'message-template-capacity',
  'roster-count', 'prepare-list', 'cancel-preparation', 'collection-status', 'collection-reason', 'collection-progress', 'selection-count', 'roster-body', 'roster-empty',
  'roster-previous', 'roster-next', 'roster-range', 'roster-page', 'preview-note',
  'selection-tools', 'refill-selection', 'reset-selection', 'extend-candidates', 'roster-help',
  'consent-label', 'send-consent', 'start-button', 'launch-help', 'queue-status', 'queue-context',
  'pause-button', 'stop-button', 'resume-button', 'finish-button', 'progress-fill', 'progress-summary', 'queue-duration', 'queue-duration-help',
  'queue-reason', 'queue-guidance', 'queue-items', 'deny-count', 'deny-empty', 'deny-items',
  'queue-previous', 'queue-next', 'queue-range', 'queue-page', 'queue-show-uncertain',
].map(id => [id, $(id)]));

const available = typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
const statusNames = {
  running: '正在处理', pausing: '正在安全暂停', paused: '已暂停', stopping: '正在安全停止', stopped: '已停止', completed: '已结束',
  pending: '等待处理', preparing: '正在打开对话', prepared: '消息准备就绪', sending: '正在提交消息', sent: '已提交',
  rehearsed: '已演练', skipped: '已跳过', failed: '失败', uncertain: '等待人工核对',
};
let state = { task: null, history: {}, denied: {} };
let workspace = null;
const PAGE_SIZE = 10;
let rosterPage = 1;
let queuePage = 1, queueTaskId = null;
let busy = false;
let selectionSaving = false;
const pendingSelections = [];
let polling = false;
let needsPreparation = false;
let hydratedTaskId = null;
let workspaceRevision = null;
let deniedRevision = null;
let lastKnownShopId = null;
let requestSequence = 0;
let latestApplied = 0;
let targetCountAvailable = false;
let candidateSelectionAvailable = false;
const reloadHelp = '扩展后台尚未更新。请在 chrome://extensions 重新加载“虾仁”，再从工具栏重新打开工作台；只刷新此网页不会更新后台。';
const rosterRows = new Map();
const queueRows = new Map();
const denyRows = new Map();
let messageTemplates = [];
let templatesReady = false, templatesLoading = false, templateWriting = false;
let templateListSequence = 0, templateWriteSequence = 0;
let templateEditRevision = 0;
let templateSelection = '';
let templateCapacity = null;
let currentStep = 1, nextMessageId = 0;
let messageDraft = [{ id: ++nextMessageId, type: 'text', content: '', contentId: 'template' }, { id: ++nextMessageId, type: 'link', content: '', contentId: 'product-link' }];
const editorRows = new Map();
let sourceDirty = false, sourceEditRevision = 0;
let pageFilters = null, pageFiltersType = '', pageFiltersLoading = false, pageFiltersPending = false, pageFiltersError = '', pageFiltersSequence = 0;
let pageFilterSelectionEdited = false;
let pageFiltersStructureStartedAt = null;
const pageFilterStructureWaiting = new Set(['无法核对原页筛选及列表状态', '无法核对排行榜筛选及列表状态']);
let webFilterDraft = { category: '', channel: '' }, webFiltersEdited = false;
let pendingLibrarySelection = null, librarySelectionRevision = 0;
let restoredDashboardDraft = false;
const dashboardDraftFields = ['task-name', 'interval', 'limit', 'mode', 'source-type', 'source-ids', 'source-affiliate-ids', 'source-includes', 'source-excludes', 'message-template-select', 'message-template-name'];
let imageMessagesAvailable = false;
let imageAssets = [], imageAssetsLoading = false, imageAssetsReady = false, imageAssetsError = '';
let imageListSequence = 0, imageDataSequence = 0, latestImageData = 0;
let imageCapacity = null;
const imageCache = new Map(), imageReads = new Map(), imageDecodeErrors = new Set(), decodedImages = new Set();
const IMAGE_KEYS = ['assetId', 'sha256', 'name', 'mime', 'size', 'width', 'height'];
ui['source-type'].value ||= 'marketplace';

function text(node, value) {
  const next = String(value ?? '');
  if (node.textContent !== next) node.textContent = next;
}
function showNotice(message, kind = '') {
  text(ui.notice, message);
  ui.notice.className = `notice${kind ? ` ${kind}` : ''}`;
  ui.notice.hidden = !message;
}
function create(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) text(node, content);
  return node;
}
function own(object, key) {
  return object && Object.hasOwn(object, key) ? object[key] : undefined;
}
function shop() { return workspace?.shop || null; }
function deniedForShop() { return own(state.denied, shop()?.id) || {}; }
function isDenied(id) { return Boolean(own(deniedForShop(), id)); }
function taskOpen() { return Boolean(state.task && state.task.status !== 'completed'); }
function hasActiveItem() { return (state.task?.items || []).some(item => ['preparing', 'prepared', 'sending'].includes(item.status)); }
function connected() { return Boolean(workspace?.shop?.id && workspace?.pageId && !workspace.error); }
function editable() { return available && !busy && !taskOpen(); }
function collection() { return workspace?.collection || null; }
function isCollecting() { return collection()?.status === 'collecting' || workspace?.preparation?.status === 'filtering'; }
function creatorList() {
  const seen = new Set();
  const c = collection();
  if (sourceDirty || !collectionSourceMatches(c)) return [];
  const rows = c && c.binding?.shopId === shop()?.id && !['cancelled', 'invalid'].includes(c.status) ? c.candidates || c.creators : workspace?.creators;
  return (rows || []).filter(creator => creator?.id && !seen.has(creator.id) && seen.add(creator.id));
}
function resetConfirmation() {
  ui['send-consent'].checked = false;
}
function selectionEditable() {
  const c = collection();
  return candidateSelectionAvailable && available && (!busy || selectionSaving) && !taskOpen() && connected() && !sourceDirty && !needsPreparation
    && collectionSourceMatches(c) && c?.selectionVersion === 1 && c.status === 'ready' && !c.pagePending;
}
function selectionView() {
  const c = collection();
  if (!pendingSelections.length || c?.id !== pendingSelections[0].collectionId) return c;
  const selected = new Set(c.selectedIds), excluded = new Set(c.excludedIds || []);
  for (const operation of pendingSelections) {
    if (operation.selected) { selected.add(operation.creatorId); excluded.delete(operation.creatorId); }
    else { selected.delete(operation.creatorId); excluded.add(operation.creatorId); }
  }
  const creators = c.candidates.filter(creator => selected.has(creator.id));
  return { ...c, creators, selectedIds: creators.map(creator => creator.id), excludedIds: [...excluded], count: creators.length, shortfall: Math.max(0, c.target - creators.length) };
}
async function saveSelections() {
  selectionSaving = true;
  busy = true;
  render();
  try {
    while (pendingSelections.length) {
      const operation = pendingSelections[0], c = collection();
      if (!selectionEditable() || c.id !== operation.collectionId) throw new Error('名单或来源已变化，请重新核对选择。');
      await request('panel:select', { ...operation, expectedRevision: c.selectionRevision });
      pendingSelections.shift();
      render();
    }
    showNotice('选择已保存，请核对最终名单后重新确认发送。');
  } catch (error) {
    selectionSaving = false;
    pendingSelections.length = 0;
    render();
    // A lost reply may follow a successful save. Reload the authoritative state
    // before permitting a new revision-based operation; never retry the write.
    try { await request('panel:get'); }
    catch { needsPreparation = true; }
    showNotice(`选择保存失败，已撤销待保存选择：${error instanceof Error ? error.message : '请检查页面连接。'}`, 'error');
  } finally {
    selectionSaving = false;
    busy = false;
    resetConfirmation();
    render();
  }
}
function changeSelection(type, values = {}) {
  if (!selectionEditable()) { renderRoster(); return; }
  const c = collection(), revision = sourceEditRevision;
  resetConfirmation();
  if (type === 'panel:select') {
    pendingSelections.push({ collectionId: c.id, creatorId: values.creatorId, selected: values.selected });
    showNotice('正在保存选择，可继续勾选；保存完成前不能启动任务。');
    if (!selectionSaving) void saveSelections();
    else render();
    return;
  }
  if (selectionSaving) return;
  void action(async () => {
    await request(type, { collectionId: c.id, expectedRevision: c.selectionRevision, ...values });
    if (sourceEditRevision !== revision || collection()?.id !== c.id) return;
    const current = collection();
    showNotice(current.status === 'collecting' ? '正在继续加载候选，原有选择已保留。准备完成后再补足。'
      : current.count === current.target ? `已选 ${current.target} 人，请重新核对并确认发送。`
      : `已选 ${current.count} / ${current.target} 人，还差 ${current.shortfall} 人。可一键补足、手动勾回或继续加载候选。`);
  });
}
function readDraftMessages() {
  if (messageDraft.length < 1 || messageDraft.length > 10) throw new Error('消息序列须包含 1—10 条消息。');
  return messageDraft.map((message, index) => {
    const label = `第 ${index + 1} 条消息`;
    if (message.type === 'image') {
      if (!imageMessagesAvailable) throw new Error('图片功能后台尚未更新，请重新加载扩展后重试。');
      if (message._image?.pending) throw new Error(`${label}的图片正在读取或保存，请稍候。`);
      const reference = imageReference(message);
      if (!cachedImage(reference)) throw new Error(message._image?.error || `${label}尚未选择可用图片，请选择或重新导入图片。`);
      return { type: 'image', ...reference };
    }
    if (!['text', 'link'].includes(message.type) || typeof message.content !== 'string' || !message.content.trim()) throw new Error(`${label}不能为空，请填写内容或删除此条。`);
    if (message.type === 'text') {
      if (message.content.length > 2400) throw new Error(`${label}最多 2400 字。`);
      const remainder = message.content.replace(/\{\{name\}\}/g, '');
      if (remainder.includes('{{') || remainder.includes('}}')) throw new Error(`${label}只支持 {{name}}，请检查未知或未闭合变量。`);
      return { type: 'text', content: message.content };
    }
    const content = message.content.trim();
    let url;
    try { url = new URL(content); } catch { throw new Error(`${label}须填写完整的 HTTP 或 HTTPS 产品链接。`); }
    if (content.length > 2000 || /\s/.test(content) || !/^https?:\/\//i.test(content) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error(`${label}须为不含空白或凭证的完整网址，最多 2000 字。`);
    return { type: 'link', content };
  });
}
function savedMessages(config) {
  if (Array.isArray(config?.messages)) return config.messages.map(message => message.type === 'image' ? { type: 'image', ...imageReference(message) } : { type: message.type, content: message.content });
  return [{ type: 'text', content: config?.template || '' }, ...(config?.productLink ? [{ type: 'link', content: config.productLink }] : [])];
}
function setDraftMessages(messages) {
  messageDraft = messages.map((message, index) => ({ ...message, id: ++nextMessageId, contentId: index === 0 ? 'template' : index === 1 ? 'product-link' : `message-content-${nextMessageId}` }));
  // Remove old IDs before creating the replacement fields; there are no hidden legacy inputs.
  for (const row of editorRows.values()) row.node.remove();
  editorRows.clear();
  templateEditRevision++;
  resetConfirmation();
  for (const message of messageDraft) if (message.type === 'image') void loadMessageImage(message);
  if (messageDraft.some(message => message.type === 'image') && !imageAssetsReady && !imageAssetsLoading) void loadImageAssets();
}
function imageReference(value) {
  const reference = Object.fromEntries(IMAGE_KEYS.map(key => [key, value?.[key]]));
  return reference;
}
function imageKey(value) { return `${value?.assetId}:${value?.sha256}`; }
function validImageReference(value) {
  return typeof value?.assetId === 'string' && Boolean(value.assetId.trim()) && /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.name === 'string' && Boolean(value.name.trim()) && ['image/png', 'image/jpeg'].includes(value.mime) &&
    Number.isInteger(value.size) && value.size > 0 && value.size < 2 * 1024 * 1024 &&
    Number.isInteger(value.width) && value.width > 0 && Number.isInteger(value.height) && value.height > 0;
}
function assetReference(asset) { return { ...imageReference(asset), assetId: asset.id }; }
function validateImageAsset(asset, expected) {
  const reference = assetReference(asset || {});
  if (!validImageReference(reference) || typeof asset.dataUrl !== 'string' || !asset.dataUrl.startsWith(`data:${reference.mime};base64,`) || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.dataUrl)) throw new Error('图片内容不完整，请重新导入图片。');
  if (expected && IMAGE_KEYS.some(key => reference[key] !== expected[key])) throw new Error('图片与保存的引用不一致，请重新选择或导入图片。');
  return reference;
}
function cachedImage(reference) {
  if (!validImageReference(reference) || !decodedImages.has(imageKey(reference)) || imageDecodeErrors.has(imageKey(reference))) return null;
  const asset = imageCache.get(imageKey(reference));
  return asset && IMAGE_KEYS.every(key => assetReference(asset)[key] === reference[key]) ? asset : null;
}
function imageState(message) { return message._image ||= { revision: 0, pending: false, error: '' }; }
function imageContextCurrent(message, revision) {
  return messageDraft.includes(message) && message.type === 'image' && imageState(message).revision === revision;
}
function formatImage(reference) {
  return `${reference.name} · ${(reference.size / 1024).toFixed(1)} KiB · ${reference.width} × ${reference.height} · ${reference.mime === 'image/png' ? 'PNG' : 'JPEG'}`;
}
async function imageRequest(type, payload = {}) {
  if (!available) throw new Error('无法连接扩展后台，请重新打开工作台。');
  const reply = await chrome.runtime.sendMessage({ type, ...payload });
  if (reply?.ok !== true) throw new Error(reply?.error || '图片操作失败，请刷新图片列表；若扩展刚更新，请重新加载扩展。');
  return reply;
}
function runImageOperation(operation) {
  return new Promise((resolve, reject) => {
    let active = true;
    const cleanups = [];
    const scope = { active: () => active, cleanup: callback => cleanups.push(callback) };
    const finish = (error, value) => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('图片处理超过 10 秒，请重新选择图片或重试。')), 10000);
    Promise.resolve().then(() => operation(scope)).then(value => finish(null, value), error => finish(error));
  });
}
async function decodeImageAsset(asset, scope) {
  const decodeError = () => new Error('图片无法解码，请重新选择或导入图片。');
  const checkDimensions = (width, height) => {
    if (width !== asset.width || height !== asset.height) throw new Error('图片尺寸与原件记录不一致，可能含旋转信息；请另存为 PNG 或 JPEG 后重新导入。');
  };
  if (typeof createImageBitmap === 'function') {
    let bitmap;
    try {
      const bytes = Uint8Array.from(atob(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1)), character => character.charCodeAt(0));
      bitmap = await createImageBitmap(new Blob([bytes], { type: asset.mime }), { imageOrientation: 'none' });
    } catch { throw decodeError(); }
    try {
      if (!scope.active()) return;
      checkDimensions(bitmap.width, bitmap.height);
      return asset;
    } finally { bitmap.close(); }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    scope.cleanup(() => { image.onload = image.onerror = null; });
    image.onload = () => {
      if (!scope.active()) return;
      try {
        checkDimensions(image.naturalWidth, image.naturalHeight);
      } catch (error) { reject(error); return; }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      try {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw decodeError();
        context.drawImage(image, 0, 0, 1, 1);
        context.getImageData(0, 0, 1, 1);
        resolve(asset);
      } catch { reject(decodeError()); }
      finally { canvas.width = canvas.height = 0; }
    };
    image.onerror = () => reject(decodeError());
    image.src = asset.dataUrl;
  });
}
function rememberDecodedImage(reference, asset) {
  imageDecodeErrors.delete(imageKey(reference));
  decodedImages.add(imageKey(reference));
  imageCache.set(imageKey(reference), asset);
}
function applyImageAssets(reply, sequence) {
  const data = reply.imageAssets;
  if (data?.version !== 1 || !Array.isArray(data.assets)) throw new Error('图片列表不完整，请刷新图片列表。');
  if (sequence < latestImageData) return;
  latestImageData = sequence;
  imageAssets = data.assets;
  imageCapacity = data.capacity || null;
  imageAssetsReady = true;
  imageAssetsError = '';
}
async function loadImageAssets() {
  const sequence = ++imageListSequence, dataSequence = ++imageDataSequence;
  imageAssetsLoading = true;
  imageAssetsError = '';
  render();
  try {
    const reply = await runImageOperation(() => imageRequest('panel:image-list'));
    if (sequence !== imageListSequence) return;
    applyImageAssets(reply, dataSequence);
  } catch (error) {
    if (sequence === imageListSequence) imageAssetsError = error.message || '读取图片列表失败，请刷新重试。';
  } finally {
    if (sequence === imageListSequence) { imageAssetsLoading = false; render(); }
  }
}
async function getStoredImage(reference) {
  const known = cachedImage(reference);
  if (known) return known;
  if (!validImageReference(reference)) throw new Error('保存的图片引用不完整，请重新选择图片。');
  const key = imageKey(reference);
  if (!imageReads.has(key)) imageReads.set(key, runImageOperation(async scope => {
    const reply = await imageRequest('panel:image-get', { assetId: reference.assetId });
    if (!scope.active()) return null;
    validateImageAsset(reply.imageAsset, reference);
    await decodeImageAsset(reply.imageAsset, scope);
    return reply.imageAsset;
  }).finally(() => imageReads.delete(key)));
  return imageReads.get(key);
}
async function loadMessageImage(message) {
  const state = imageState(message), revision = ++state.revision;
  state.pending = true; state.error = '';
  try {
    const reference = imageReference(message);
    const asset = await getStoredImage(reference);
    if (!imageContextCurrent(message, revision)) return;
    rememberDecodedImage(reference, asset);
  } catch (error) {
    if (imageContextCurrent(message, revision)) state.error = error.message || '图片不存在，请重新选择图片。';
  } finally {
    if (imageContextCurrent(message, revision)) { state.pending = false; render(); }
  }
}
function readImageFile(file, scope) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    scope.cleanup(() => { reader.onload = reader.onerror = reader.onabort = null; if (reader.readyState === 1) reader.abort(); });
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('读取图片失败，请重新选择文件。'));
    reader.onerror = reader.onabort = () => reject(new Error('读取图片失败，请重新选择文件。'));
    reader.readAsDataURL(file);
  });
}
async function chooseImage(message, assetId) {
  if (!editable() || !imageMessagesAvailable || message.type !== 'image') return;
  const state = imageState(message), revision = ++state.revision;
  state.pending = true; state.error = ''; templateEditRevision++; resetConfirmation(); render();
  try {
    const metadata = imageAssets.find(asset => asset.id === assetId);
    if (!metadata) throw new Error('请从已存图片中选择一张图片，或导入新图片。');
    const reference = assetReference(metadata);
    const asset = await getStoredImage(reference);
    if (!imageContextCurrent(message, revision) || !editable()) return;
    rememberDecodedImage(reference, asset);
    Object.assign(message, reference);
  } catch (error) {
    if (imageContextCurrent(message, revision)) state.error = error.message || '图片无法读取，请重新选择。';
  } finally {
    if (imageContextCurrent(message, revision)) { state.pending = false; draftChanged(); }
  }
}
async function importImage(message, file) {
  if (!file || !editable() || !imageMessagesAvailable || message.type !== 'image') return;
  const state = imageState(message), revision = ++state.revision;
  state.pending = true; state.error = ''; templateEditRevision++; resetConfirmation(); render();
  try {
    const mime = file.type?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type?.toLowerCase();
    if (!['image/png', 'image/jpeg'].includes(mime)) throw new Error('仅支持 PNG 或 JPEG 图片。');
    if (!Number.isInteger(file.size) || file.size < 1 || file.size >= 2 * 1024 * 1024) throw new Error('单张图片须小于 2 MiB，请压缩后重新选择。');
    const result = await runImageOperation(async scope => {
      const raw = await readImageFile(file, scope);
      if (!scope.active() || !imageContextCurrent(message, revision) || !editable()) return null;
      if (!/^data:image\/(?:png|jpeg|jpg);base64,/.test(raw)) throw new Error('读取的图片格式无效，请重新选择文件。');
      const dataUrl = raw.replace(/^data:image\/(?:png|jpeg|jpg);base64,/, `data:${mime};base64,`);
      const dataSequence = ++imageDataSequence;
      const reply = await imageRequest('panel:image-add', { draft: { name: file.name, mime, size: file.size, dataUrl } });
      if (!scope.active() || !imageContextCurrent(message, revision) || !editable()) return null;
      const reference = validateImageAsset(reply.imageAsset);
      if (reply.assetId !== reference.assetId) throw new Error('图片保存结果不完整，请刷新图片列表后重新选择。');
      await decodeImageAsset(reply.imageAsset, scope);
      return { reply, reference, dataSequence };
    });
    if (!result || !imageContextCurrent(message, revision) || !editable()) return;
    const { reply, reference, dataSequence } = result;
    applyImageAssets(reply, dataSequence);
    rememberDecodedImage(reference, reply.imageAsset);
    Object.assign(message, reference);
  } catch (error) {
    if (imageContextCurrent(message, revision)) state.error = error.message || '图片导入失败，请重试。';
  } finally {
    if (imageContextCurrent(message, revision)) { state.pending = false; draftChanged(); }
  }
}
function renderImagePreview(container, message) {
  const reference = imageReference(message), asset = cachedImage(reference);
  if (!asset) { container.append(create('p', 'field-help', message._image?.error || (message._image?.pending ? '图片正在读取或保存…' : '尚未选择可用图片，请选择或导入。'))); return; }
  const image = create('img', 'message-image'); image.src = asset.dataUrl; image.alt = reference.name; image.width = reference.width; image.height = reference.height;
  image.addEventListener('error', () => {
    imageDecodeErrors.add(imageKey(reference));
    decodedImages.delete(imageKey(reference));
    const current = messageDraft.find(item => item.type === 'image' && imageKey(item) === imageKey(reference));
    if (current) imageState(current).error = '图片预览无法打开，请重新导入图片。';
    resetConfirmation(); render();
  });
  container.append(image, create('p', 'image-description', formatImage(reference)));
}
function getSource() {
  const type = ui['source-type'].value;
  if (!['marketplace', 'specified', 'leaderboard', 'affiliates'].includes(type)) throw new Error('请选择有效的名单来源。');
  const creatorIds = type === 'specified' ? [...new Set(ui['source-ids'].value.split(/[,，\s]+/).filter(Boolean))] : [];
  if (type === 'specified' && (creatorIds.length < 1 || creatorIds.length > 200)) throw new Error('请输入 1—200 个不同的 Shopee 用户 ID，并非联盟伙伴 ID。');
  if (creatorIds.some(id => !/^\d+$/.test(id) || /^0+$/.test(id))) throw new Error('请填写数字形式的 Shopee 用户 ID，并非联盟伙伴 ID。');
  const affiliateIds = type === 'affiliates' ? [...new Set(ui['source-affiliate-ids'].value.split(/[,，\s]+/).filter(Boolean))] : [];
  if (type === 'affiliates' && (affiliateIds.length < 1 || affiliateIds.length > 200 || affiliateIds.some(id => !/^[1-9]\d{0,39}$/.test(id)))) throw new Error('请输入1—200个无前导零的联盟伙伴数字ID，最多40位，并非Shopee用户ID。');
  const nameIncludes = ui['source-includes'].value.trim(), nameExcludes = ui['source-excludes'].value.trim();
  if (nameIncludes.length > 100 || nameExcludes.length > 100) throw new Error('达人名称包含和排除条件最多 100 字。');
  const webpage = ['marketplace', 'leaderboard'].includes(type);
  let webFilters;
  if (webpage && ui['web-filters-enabled'].checked) {
    if (!pageFilters || pageFiltersType !== type || pageFiltersLoading || pageFiltersPending) throw new Error('请等待读取 Shopee 网页筛选，或点击“读取页面筛选”重试。');
    webFilters = { category: webFilterDraft.category, channel: webFilterDraft.channel };
    for (const [field, options] of [['category', 'categories'], ['channel', 'channels']]) {
      if (pageFilters.supported[field] && !pageFilters.options[options].some(option => option.value === webFilters[field])) throw new Error('所选网页筛选已变化，请重新读取页面筛选并选择。');
    }
  }
  return { type, creatorIds, ...(type === 'affiliates' ? { affiliateIds } : {}), nameIncludes, nameExcludes,
    ...(webFilters ? { webFilters } : {}), ...(webpage && ui['start-current'].checked ? { startPosition: 'current' } : {}) };
}
function clearPageFilters({ resetDefaults = false, resetCheckboxes = resetDefaults } = {}) {
  pageFiltersSequence++; pageFilters = null; pageFiltersType = ''; pageFiltersLoading = false; pageFiltersPending = false; pageFiltersError = '';
  pageFiltersStructureStartedAt = null;
  webFilterDraft = { category: '', channel: '' }; webFiltersEdited = false;
  if (resetDefaults) {
    ui['web-filters-enabled'].checked = true;
    ui['start-current'].checked = true;
  } else if (resetCheckboxes) {
    ui['web-filters-enabled'].checked = false;
    ui['start-current'].checked = false;
  }
}
async function loadPageFilters() {
  const type = ui['source-type'].value;
  if (!available || !['marketplace', 'leaderboard'].includes(type) || pageFiltersLoading) return;
  if (!workspace?.pageId) { pageFiltersPending = true; pageFiltersError = ''; pageFiltersStructureStartedAt = null; renderWebFilters(); return; }
  const sequence = ++pageFiltersSequence;
  pageFiltersLoading = true; pageFiltersPending = false; pageFiltersError = ''; renderWebFilters();
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'panel:filters' });
    if (sequence !== pageFiltersSequence || type !== ui['source-type'].value) return;
    if (!reply?.ok) throw new Error(reply?.error || '无法读取页面筛选，请等待专用页面连接后重试。');
    const filters = reply.pageFilters;
    if (filters?.loading) {
      pageFilters = null;
      if (pageFilterStructureWaiting.has(filters.error)) {
        pageFiltersStructureStartedAt ??= Date.now();
        pageFiltersPending = Date.now() - pageFiltersStructureStartedAt < 45000;
        pageFiltersError = pageFiltersPending ? 'Shopee 筛选列表正在加载，正在等待网页筛选就绪…' : '网页筛选尚未就绪，请等待Shopee加载后点击读取页面筛选重试';
      } else {
        pageFiltersStructureStartedAt = null; pageFiltersPending = true; pageFiltersError = filters.error || '';
      }
      return;
    }
    if (filters?.error) throw new Error(filters.error);
    if (!filters || !filters.current || !filters.options || typeof filters.supported !== 'object' || !filters.supported) throw new Error('当前页面暂不支持读取筛选，请确认专用页面已连接。');
    const supported = Object.fromEntries(['category', 'channel'].map(field => [field, filters.supported[field] === true]));
    const options = Object.fromEntries(['categories', 'channels'].map(field => [field, (Array.isArray(filters.options[field]) ? filters.options[field] : []).filter(option => typeof option?.value === 'string' && typeof option.label === 'string')]));
    if ((supported.category && !options.categories.length) || (supported.channel && !options.channels.length)) throw new Error('网页筛选选项尚未完整加载，请读取页面筛选重试。');
    pageFilters = { ...filters, supported, options }; pageFiltersType = type;
    pageFiltersStructureStartedAt = null;
    if (!pageFilterSelectionEdited) {
      ui['web-filters-enabled'].checked = true;
      ui['start-current'].checked = true;
    }
    if (!webFiltersEdited) webFilterDraft = Object.fromEntries(['category', 'channel'].map(field => [field, supported[field] && typeof filters.current[field] === 'string' ? filters.current[field] : '']));
    if (ui['web-filters-enabled'].checked) webFiltersEdited = true;
    for (const field of ['category', 'channel']) if (!supported[field]) webFilterDraft[field] = '';
  } catch (error) {
    if (sequence === pageFiltersSequence) { pageFilters = null; pageFiltersError = error.message || '读取页面筛选失败，请重试。'; }
  } finally {
    if (sequence === pageFiltersSequence) { pageFiltersLoading = false; render(); }
  }
}
function renderWebFilters() {
  const webpage = ['marketplace', 'leaderboard'].includes(ui['source-type'].value);
  const ready = pageFilters && pageFiltersType === ui['source-type'].value && !pageFiltersLoading && !pageFiltersPending;
  const enabled = ready && ui['web-filters-enabled'].checked;
  const canEdit = editable() && workspace?.preparation?.status !== 'filtering';
  ui['web-filter-fields'].hidden = !webpage;
  ui['web-filters-enabled'].disabled = !canEdit || !ready;
  ui['web-filter-refresh'].disabled = !canEdit || pageFiltersLoading || !workspace?.pageId;
  ui['start-current'].disabled = !canEdit;
  for (const [field, optionKey] of [['category', 'categories'], ['channel', 'channels']]) {
    const group = ui[`web-filter-${field}-options`], options = ready ? pageFilters.options[optionKey] : [];
    const supported = ready && pageFilters.supported[field];
    const signature = JSON.stringify({ options, supported });
    if (group.dataset.options !== signature) {
      group.replaceChildren(...options.map(option => {
        const button = create('button', 'chip-option', option.label);
        button.type = 'button'; button.value = option.value; button.dataset.value = option.value;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => {
          if (!editable() || button.disabled) return;
          chooseWebFilter(field, option.value);
        });
        button.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || button.disabled) return;
          event.preventDefault();
          const enabledButtons = [...group.children].filter(node => !node.disabled);
          const index = enabledButtons.indexOf(button);
          if (index < 0) return;
          const next = enabledButtons[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + enabledButtons.length) % enabledButtons.length];
          chooseWebFilter(field, next.dataset.value);
          next.focus();
        });
        return button;
      }));
      group.dataset.options = signature;
    }
    for (const button of group.children) {
      const selected = button.dataset.value === webFilterDraft[field];
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.disabled = !canEdit || !enabled || !supported;
    }
    group.setAttribute('aria-disabled', String(!canEdit || !enabled || !supported));
  }
  for (const field of ['category', 'channel']) {
    const group = ui[`web-filter-${field}-options`];
    if ([...group.children].some(button => button.tabIndex === 0 && !button.disabled)) continue;
    const first = [...group.children].find(button => !button.disabled);
    if (first) first.tabIndex = 0;
  }
  text(ui['web-filter-category-empty'], ready && !pageFilters.supported.category ? '此页面不支持商品类目筛选' : ready && !pageFilters.options.categories.length ? '没有可用的商品类目' : '');
  text(ui['web-filter-channel-empty'], ready && !pageFilters.supported.channel ? '此页面不支持社交媒体渠道筛选' : ready && !pageFilters.options.channels.length ? '没有可用的社交媒体渠道' : '');
  const categoryEmpty = ui['web-filter-category-empty'].textContent, channelEmpty = ui['web-filter-channel-empty'].textContent;
  ui['web-filter-category-empty'].hidden = !categoryEmpty;
  ui['web-filter-channel-empty'].hidden = !channelEmpty;
  text(ui['web-filter-status'], pageFiltersLoading ? '正在读取专用 Shopee 页的真实筛选选项…' : pageFiltersPending ? pageFiltersError || '等待专用页面加载并连接，随后自动读取筛选。' : pageFiltersError || (ready ? '已读取页面筛选；勾选后选择条件，点击“准备名单”自动应用。此页不支持的条件已禁用。' : '打开专用页面后，点击“读取页面筛选”获取真实选项。'));
}
function chooseWebFilter(field, value) {
  if (!['category', 'channel'].includes(field) || webFilterDraft[field] === value) return;
  webFilterDraft[field] = value;
  webFiltersEdited = true;
  pageFilterSelectionEdited = true;
  sourceDirty = true; sourceEditRevision++; rosterPage = 1;
  resetConfirmation(); render();
}
function changeWebFilterControl(id) {
  if (!editable() || ui[id].disabled) return;
  if (['web-filters-enabled', 'start-current'].includes(id)) pageFilterSelectionEdited = true;
  if (id === 'web-filters-enabled' && ui[id].checked) webFiltersEdited = true;
  sourceDirty = true; sourceEditRevision++; rosterPage = 1; resetConfirmation(); render();
}
function receiveLibrarySelection(value) {
  if (value?.version !== 1 || value.kind !== 'creator-library-selection' || value.site !== 'ID' || typeof value.shopId !== 'string' || !value.shopId
      || !Number.isInteger(value.libraryRevision) || value.libraryRevision < 0 || value.requiresPageVerification !== true || !Array.isArray(value.records)
      || value.records.length < 1 || value.records.length > 200 || value.records.some(record => typeof record?.id !== 'string' || !record.id || record.id.length > 200)) {
    showNotice('达人库选择无效，请在达人库重新选择。', 'error'); return;
  }
  pendingLibrarySelection = { libraryRevision: value.libraryRevision, shopId: value.shopId, recordIds: [...new Set(value.records.map(record => record.id))] };
  librarySelectionRevision++; render();
}
function readLibraryHandoff() {
  try {
    const raw = window.sessionStorage?.getItem('creatorLibrarySelection');
    window.sessionStorage?.removeItem('creatorLibrarySelection');
    if (raw) {
      if (raw.length > 300000) throw new Error('交接内容过大');
      receiveLibrarySelection(JSON.parse(raw));
    }
  } catch { showNotice('达人库选择无法读取或内容过大，请在达人库重新选择。', 'error'); }
}
function saveDashboardDraft() {
  if (messageDraft.some(message => message._image?.pending)) throw new Error('图片正在读取或保存，请完成后再打开达人库。');
  const draft = { version: 1, messages: messageDraft.map(message => ({ type: message.type, content: message.content || '', ...imageReference(message) })),
    fields: Object.fromEntries(dashboardDraftFields.map(id => [id, ui[id].value])),
    currentStep, sourceDirty, needsPreparation, shopId: shop()?.id || null,
    pageSelection: { enabled: ui['web-filters-enabled'].checked, filters: { ...webFilterDraft }, current: ui['start-current'].checked } };
  try {
    const storage = window.sessionStorage;
    if (!storage) throw new Error('storage unavailable');
    storage.setItem('creatorDashboardDraft', JSON.stringify(draft));
    if (draft.shopId) storage.setItem('creatorLibraryContext', JSON.stringify({ site: 'ID', shopId: draft.shopId }));
    else storage.removeItem('creatorLibraryContext');
  } catch { throw new Error('工作台草稿暂存失败，请检查浏览器存储后重试；当前输入已保留。'); }
}
function restoreDashboardDraft() {
  try {
    const storage = window.sessionStorage, raw = storage?.getItem('creatorDashboardDraft');
    storage?.removeItem('creatorDashboardDraft');
    if (!raw) return;
    if (raw.length > 300000) throw new Error('draft too large');
    const draft = JSON.parse(raw);
    if (draft?.version !== 1 || ![1, 2].includes(draft.currentStep) || !Array.isArray(draft.messages) || draft.messages.length < 1 || draft.messages.length > 10
        || draft.messages.some(message => !['text', 'link', 'image'].includes(message?.type) || (message.type !== 'image' && typeof message.content !== 'string'))
        || dashboardDraftFields.some(id => typeof draft.fields?.[id] !== 'string')) throw new Error('invalid draft');
    for (const id of dashboardDraftFields) ui[id].value = draft.fields[id];
    templateSelection = draft.fields['message-template-select'];
    currentStep = draft.currentStep;
    sourceDirty = draft.sourceDirty === true; needsPreparation = draft.needsPreparation === true;
    if (draft.pageSelection && ['category', 'channel'].every(field => typeof draft.pageSelection.filters?.[field] === 'string')) {
      ui['web-filters-enabled'].checked = draft.pageSelection.enabled === true;
      ui['start-current'].checked = draft.pageSelection.current === true;
      webFilterDraft = { category: draft.pageSelection.filters.category, channel: draft.pageSelection.filters.channel }; webFiltersEdited = true;
      pageFilterSelectionEdited = true;
    }
    if (currentStep === 2 && ['marketplace', 'leaderboard'].includes(ui['source-type'].value)) pageFiltersPending = true;
    lastKnownShopId = typeof draft.shopId === 'string' ? draft.shopId : null;
    sourceEditRevision++; restoredDashboardDraft = true;
    setDraftMessages(draft.messages.map(message => ({ type: message.type, content: message.content || '', ...imageReference(message) })));
  } catch { showNotice('工作台草稿无法恢复，请重新填写并核对消息与来源。', 'error'); }
}
function collectionSourceMatches(c) {
  const ordered = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : Array.isArray(value) ? value.map(ordered) : value;
  try {
    const source = { ...(c?.source || { type: 'marketplace', creatorIds: [], nameIncludes: '', nameExcludes: '' }) };
    if (source.webFilters) { source.webFilters = { ...source.webFilters }; delete source.webFilters.search; }
    return JSON.stringify(ordered(source)) === JSON.stringify(ordered(getSource()));
  }
  catch { return false; }
}
function hydrateSource(source) {
  ui['source-type'].value = source?.type || 'marketplace';
  ui['source-ids'].value = (source?.creatorIds || []).join(', ');
  ui['source-affiliate-ids'].value = (source?.affiliateIds || []).join(', ');
  ui['source-includes'].value = source?.nameIncludes || '';
  ui['source-excludes'].value = source?.nameExcludes || '';
  ui['web-filters-enabled'].checked = Boolean(source?.webFilters);
  ui['start-current'].checked = source?.startPosition === 'current';
  pageFilterSelectionEdited = true;
  if (source?.webFilters) { webFilterDraft = { category: source.webFilters.category || '', channel: source.webFilters.channel || '' }; webFiltersEdited = true; }
}
function getMessageSettings() {
  const messages = readDraftMessages();
  const intervalSeconds = Number(ui.interval.value);
  if (!ui.interval.value.trim() || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error('请填写大于 0 的逐人间隔。');
  const taskName = ui['task-name'].value.trim();
  if (taskName.length > 80) throw new Error('任务名称最多 80 字。');
  return { messages, intervalSeconds, ...(taskName ? { taskName } : {}) };
}
function draftChanged() { templateEditRevision++; resetConfirmation(); render(); }
function makeEditorRow(message) {
  const node = create('article', 'message-editor-card');
  const heading = create('div', 'message-editor-heading'), title = create('h3');
  const actions = create('div', 'message-editor-actions');
  const controls = {};
  for (const [role, label] of [['up', '上移'], ['down', '下移'], ['remove', '删除']]) {
    const button = create('button', 'text-button', label); button.type = 'button'; button.dataset.role = role;
    button.addEventListener('click', () => {
      if (!editable()) return;
      const index = messageDraft.findIndex(item => item.id === message.id);
      if (role === 'remove') { if (messageDraft.length === 1) return; messageDraft.splice(index, 1); }
      else { const target = index + (role === 'up' ? -1 : 1); if (target < 0 || target >= messageDraft.length) return; [messageDraft[index], messageDraft[target]] = [messageDraft[target], messageDraft[index]]; }
      draftChanged();
    });
    actions.append(button); controls[role] = button;
  }
  heading.append(title, actions);
  const type = create('select'); type.dataset.role = 'type';
  for (const [value, label] of [['text', '文字消息'], ['link', '商品链接'], ['image', '图片消息']]) { const option = create('option', '', label); option.value = value; type.append(option); }
  const content = create('textarea'); content.id = message.contentId; content.dataset.role = 'content'; content.rows = 4;
  const label = create('label', 'sr-only'); label.htmlFor = content.id;
  const imagePanel = create('div', 'image-editor');
  const fileLabel = create('label', '', '导入图片'), file = create('input', 'image-file');
  file.id = `image-file-${message.id}`; file.type = 'file'; file.accept = 'image/png,image/jpeg,.png,.jpg,.jpeg'; file.dataset.role = 'image-file'; fileLabel.htmlFor = file.id;
  const storedLabel = create('label', '', '复用本机图片'), stored = create('select'), refresh = create('button', 'text-button', '刷新图片列表');
  stored.id = `image-select-${message.id}`; stored.dataset.role = 'image-select'; storedLabel.htmlFor = stored.id;
  refresh.type = 'button'; refresh.dataset.role = 'image-refresh'; refresh.addEventListener('click', () => void loadImageAssets());
  const storedControls = create('div', 'image-picker'), imagePreview = create('div', 'image-editor-preview'), imageStatus = create('p', 'image-status');
  imageStatus.setAttribute('role', 'status'); imageStatus.setAttribute('aria-live', 'polite');
  file.addEventListener('change', () => void importImage(message, file.files?.[0]));
  stored.addEventListener('change', () => void chooseImage(message, stored.value));
  storedControls.append(stored, refresh); imagePanel.append(fileLabel, file, storedLabel, storedControls, imageStatus, imagePreview);
  const foot = create('div', 'field-foot'), variable = create('button', 'text-button', '插入达人姓名'), count = create('span');
  variable.type = 'button'; variable.dataset.role = 'variable';
  variable.addEventListener('click', () => {
    if (!editable() || message.type !== 'text') return;
    const start = content.selectionStart ?? content.value.length, end = content.selectionEnd ?? start;
    const next = content.value.slice(0, start) + '{{name}}' + content.value.slice(end);
    if (next.length > 2400) { showNotice('插入姓名变量后超过 2400 字，请先缩短内容。', 'error'); return; }
    message.content = next; draftChanged(); content.focus();
    content.selectionStart = content.selectionEnd = start + 8;
  });
  type.addEventListener('change', () => {
    if (!editable()) return;
    const state = imageState(message); state.revision++; state.pending = false; state.error = '';
    message.type = type.value;
    if (message.type !== 'image' && typeof message.content !== 'string') message.content = '';
    draftChanged();
    if (message.type === 'image') {
      if (!imageAssetsReady && !imageAssetsLoading) void loadImageAssets();
      if (message.assetId) void loadMessageImage(message);
    }
  });
  for (const event of ['input', 'change']) content.addEventListener(event, () => { if (!editable()) return; message.content = content.value; draftChanged(); });
  foot.append(variable, count); node.append(heading, type, label, content, foot, imagePanel);
  return { node, title, type, content, label, variable, count, foot, imagePanel, file, stored, refresh, imagePreview, imageStatus, ...controls };
}
function renderEditor() {
  reconcile(ui['message-editor'], editorRows, messageDraft, makeEditorRow, (row, message) => {
    const index = messageDraft.indexOf(message);
    const image = message.type === 'image';
    text(row.title, `第 ${index + 1} 条消息`); text(row.label, `第 ${index + 1} 条${image ? '图片' : message.type === 'link' ? '商品链接' : '文字消息'}`);
    row.type.setAttribute('aria-label', `第 ${index + 1} 条消息类型`);
    row.type.value = message.type;
    for (const option of row.type.children) if (option.value === 'image') option.disabled = !imageMessagesAvailable;
    if (row.content.value !== (message.content || '')) row.content.value = message.content || '';
    row.content.maxLength = message.type === 'text' ? 2400 : 2000;
    row.content.placeholder = message.type === 'text' ? '输入消息，可插入 {{name}} 称呼达人' : 'https://shopee.co.id/product/…';
    row.content.disabled = !editable() || image; row.type.disabled = !editable();
    row.content.hidden = row.label.hidden = row.foot.hidden = image;
    row.imagePanel.hidden = !image;
    row.variable.hidden = message.type !== 'text'; row.variable.disabled = !editable();
    row.up.disabled = !editable() || index === 0; row.down.disabled = !editable() || index === messageDraft.length - 1;
    row.remove.disabled = !editable() || messageDraft.length === 1;
    for (const [key, verb] of [['up', '上移'], ['down', '下移'], ['remove', '删除']]) row[key].setAttribute('aria-label', `${verb}第 ${index + 1} 条消息`);
    text(row.count, `${(message.content || '').length} / ${row.content.maxLength}`);
    if (image) {
      row.file.disabled = row.stored.disabled = !editable() || !imageMessagesAvailable;
      row.refresh.disabled = !available || imageAssetsLoading;
      row.stored.replaceChildren();
      const placeholder = create('option', '', imageAssetsLoading ? '正在读取图片列表…' : '选择已存图片'); placeholder.value = ''; row.stored.append(placeholder);
      for (const asset of imageAssets) { const option = create('option', '', formatImage(asset)); option.value = asset.id; row.stored.append(option); }
      if (message.assetId && !imageAssets.some(asset => asset.id === message.assetId)) { const current = create('option', '', message.name || '当前图片'); current.value = message.assetId; row.stored.append(current); }
      row.stored.value = message.assetId || '';
      const state = imageState(message);
      text(row.imageStatus, state.pending ? '图片正在读取或保存，请稍候…' : state.error || imageAssetsError || (message.assetId ? '图片已保存在本机；可选择其他图片替换。' : '每条图片消息只提交一张图片，文字说明请另建一条文字消息。'));
      row.imageStatus.className = `image-status${state.error || imageAssetsError ? ' error' : ''}`;
      row.imagePreview.replaceChildren(); renderImagePreview(row.imagePreview, message);
    }
  });
  ui['message-add'].disabled = !editable() || messageDraft.length >= 10;
  ui['message-reset'].disabled = !editable();
  text(ui['message-sequence-count'], `${messageDraft.length} / 10`);
  ui['image-library-status'].hidden = !messageDraft.some(message => message.type === 'image');
  text(ui['image-library-status'], imageCapacity ? `本机图片 ${imageCapacity.count} / ${imageCapacity.limit} 张；图片库容量最多 4 MiB，满时会拒绝新增并保留原图。` : '图片仅保存在本机；最多 20 张，满时会拒绝新增并保留原图。');
}
function selectedMessageTemplate() { return messageTemplates.find(record => record.id === templateSelection) || null; }
function templateEditable() { return editable() && templatesReady && !templatesLoading && !templateWriting; }
function templateStatus(message, error = false) {
  text(ui['message-template-status'], message);
  ui['message-template-status'].className = `message-template-status${error ? ' error' : ''}`;
}
function renderMessageTemplates() {
  const selected = selectedMessageTemplate();
  ui['message-template-select'].disabled = !editable();
  ui['message-template-name'].disabled = !editable();
  ui['message-template-refresh'].disabled = !available || templateWriting;
  text(ui['message-template-refresh'], templatesLoading ? '正在刷新…' : '刷新模板');
  ui['message-template-apply'].disabled = !templateEditable() || !selected;
  ui['message-template-create'].disabled = !templateEditable();
  ui['message-template-update'].disabled = !templateEditable() || !selected;
  ui['message-template-copy'].disabled = !templateEditable() || !selected;
  ui['message-template-select'].setAttribute('aria-busy', String(templatesLoading));
  const count = templateCapacity?.count ?? messageTemplates.length;
  text(ui['message-template-capacity'], templateCapacity ? `本机 ${count} / ${templateCapacity.limit} 条` : '仅保存在本机');
}
function applyMessageTemplates(reply) {
  const data = reply.messageTemplates;
  if (data?.version !== 1 || !Array.isArray(data.templates)) throw new Error('模板后台尚未更新或返回不完整，请重新加载扩展后刷新模板。');
  messageTemplates = data.templates;
  templateCapacity = data.capacity || null;
  templatesReady = true;
  const options = [create('option', '', messageTemplates.length ? '选择已存模板' : '暂无已存模板')];
  options[0].value = '';
  for (const record of messageTemplates) {
    const option = create('option', '', record.name);
    option.value = record.id;
    options.push(option);
  }
  if (templateSelection && !selectedMessageTemplate()) {
    const missing = create('option', '', '已选模板不在列表，请重新选择');
    missing.value = templateSelection;
    options.push(missing);
  }
  ui['message-template-select'].replaceChildren(...options);
  ui['message-template-select'].value = templateSelection;
}
async function templateRequest(type, payload = {}) {
  if (!available) throw new Error('请从 Chrome 扩展打开工作台，再刷新模板。');
  const reply = await chrome.runtime.sendMessage({ type, ...payload });
  if (reply?.ok !== true) throw new Error(reply?.error || '模板后台未返回有效结果，请刷新模板；若扩展刚刚更新，请重新加载扩展。');
  return reply;
}
async function loadMessageTemplates() {
  if (!available || templateWriting) return;
  const sequence = ++templateListSequence;
  templatesLoading = true;
  templateStatus('正在读取本机模板…');
  renderMessageTemplates();
  try {
    const reply = await templateRequest('panel:template-list');
    if (sequence !== templateListSequence) return;
    applyMessageTemplates(reply);
    templateStatus(messageTemplates.length ? '选择模板后点击“套用”，当前草稿保持不变。' : '尚无模板。填写名称与消息序列后，可存为新模板。');
  } catch (error) {
    if (sequence !== templateListSequence) return;
    templatesReady = false;
    templateStatus(error.message || '无法读取模板，请刷新模板重试。', true);
  } finally {
    if (sequence === templateListSequence) { templatesLoading = false; renderMessageTemplates(); }
  }
}
async function saveMessageTemplate(operation) {
  if (!templateEditable()) return;
  const selected = selectedMessageTemplate();
  if (operation !== 'create' && !selected) return;
  let draft;
  try { if (operation !== 'copy') draft = { name: ui['message-template-name'].value, messages: readDraftMessages() }; }
  catch (error) { templateStatus(error.message, true); return; }
  const payload = operation === 'create' ? { draft } : { templateId: selected.id, expectedRevision: selected.revision, ...(operation === 'update' ? { draft } : {}) };
  const sequence = ++templateWriteSequence;
  const editRevision = templateEditRevision;
  templateWriting = true;
  templateStatus(operation === 'copy' ? '正在复制已存模板…' : '正在保存模板…');
  renderMessageTemplates();
  try {
    const reply = await templateRequest(`panel:template-${operation}`, payload);
    if (sequence !== templateWriteSequence) return;
    if (!reply.savedTemplateId || !reply.messageTemplates?.templates?.some(record => record.id === reply.savedTemplateId)) throw new Error('模板保存结果不完整，请刷新模板核对后重试。');
    applyMessageTemplates(reply);
    if (editRevision === templateEditRevision && editable()) {
      const saved = messageTemplates.find(record => record.id === reply.savedTemplateId);
      templateSelection = saved.id;
      ui['message-template-select'].value = saved.id;
      ui['message-template-name'].value = saved.name;
    }
    templateStatus(`${operation === 'copy' ? '已复制' : '已保存'}模板；当前消息序列保持不变，需要时点击“套用”。`);
  } catch (error) {
    if (sequence === templateWriteSequence) templateStatus(error.message || '保存模板失败，请刷新模板或修改名称后重试。', true);
  } finally {
    if (sequence === templateWriteSequence) { templateWriting = false; renderMessageTemplates(); }
  }
}
function rosterPageEntries(creators = creatorList()) {
  const pages = Math.max(1, Math.ceil(creators.length / PAGE_SIZE));
  rosterPage = Math.max(1, Math.min(rosterPage, pages));
  return { entries: creators.slice((rosterPage - 1) * PAGE_SIZE, rosterPage * PAGE_SIZE), pages };
}
function getConfig() {
  if (selectionSaving) throw new Error('名单选择正在保存，请稍候。');
  if (!targetCountAvailable) throw new Error(reloadHelp);
  if (!connected()) throw new Error('请在专用页面登录后准备名单。');
  if (workspace?.preparation?.status === 'filtering') throw new Error('正在应用网页筛选，请等待名单备齐后再启动。');
  if (needsPreparation || sourceDirty) throw new Error('店铺、来源或筛选条件已变化，请重新准备名单并核对店铺。');
  if (currentStep !== 2) throw new Error('请先核对消息配置，再进入选择达人。');
  const c = collection(), targetCount = getTargetCount();
  if (!c || c.status !== 'ready' || c.target !== targetCount || c.count !== targetCount || c.shortfall !== 0 || !Array.isArray(c.creators) || c.creators.length !== targetCount) throw new Error('请先按目标人数备齐并锁定名单。');
  if (c.binding?.shopId !== shop().id) throw new Error('锁定名单的店铺已变化，请重新准备。');
  if (!collectionSourceMatches(c)) throw new Error('锁定名单的来源或筛选条件已变化，请重新准备。');
  const creators = c.creators.map(({ id, name }) => ({ id, name }));
  return { shop: { id: shop().id, name: shop().name }, creators, ...getMessageSettings(), source: JSON.parse(JSON.stringify(c.source || getSource())), limit: targetCount, targetCount, collectionId: c.id, mode: ui.mode.value };
}
function getTargetCount() {
  if (ui['source-type'].value === 'specified') return getSource().creatorIds.length;
  if (ui['source-type'].value === 'affiliates') return getSource().affiliateIds.length;
  const value = Number(ui.limit.value);
  if (!ui.limit.value.trim() || !Number.isInteger(value) || value < 1 || value > 200) throw new Error('请填写 1—200 的整数作为本次发送人数。');
  return value;
}
function currentFingerprint() {
  try { return JSON.stringify(getConfig()); } catch { return null; }
}
function hydrateTask() {
  const task = state.task;
  if (!taskOpen() || task.id === hydratedTaskId) return;
  hydratedTaskId = task.id;
  templateEditRevision++;
  const config = task.config;
  setDraftMessages(savedMessages(config));
  ui['task-name'].value = config.taskName || '';
  hydrateSource(config.source);
  sourceDirty = false;
  currentStep = 2;
  ui.interval.value = String(config.intervalSeconds);
  ui.limit.value = String(config.limit);
  ui.mode.value = config.mode;
  resetConfirmation();
}
function applyReply(reply, sequence) {
  if (sequence < latestApplied) return;
  latestApplied = sequence;
  if (Object.hasOwn(reply, 'state') || Object.hasOwn(reply, 'workspace')) targetCountAvailable = reply.capabilities?.targetCount === true && reply.capabilities?.messageSequence === true && reply.capabilities?.sourceSelection === true;
  if (Object.hasOwn(reply, 'state') || Object.hasOwn(reply, 'workspace')) imageMessagesAvailable = reply.capabilities?.imageMessages === true;
  if (Object.hasOwn(reply, 'state') || Object.hasOwn(reply, 'workspace')) candidateSelectionAvailable = reply.capabilities?.candidateSelection === true;
  if (Object.hasOwn(reply, 'workspace')) {
    const next = reply.workspace;
    const nextShopId = next?.shop?.id;
    const identityChanged = lastKnownShopId && nextShopId && lastKnownShopId !== nextShopId;
    const c = next?.collection;
    const revision = JSON.stringify({ tabId: next?.tabId, pageId: next?.pageId, documentId: next?.documentId, documentEpoch: next?.documentEpoch, shop: next?.shop, creators: next?.creators, error: next?.error, collection: c ? { id: c.id, status: c.status, target: c.target, creators: c.creators, binding: c.binding, source: c.source, selectionRevision: c.selectionRevision } : null });
    if (workspaceRevision !== null && workspaceRevision !== revision) resetConfirmation();
    if (identityChanged) {
      rosterPage = 1;
      needsPreparation = true;
      showNotice('检测到店铺已切换。请重新准备名单并核对店铺，发送确认已撤销。');
    }
    if (workspace?.collection?.id !== c?.id) {
      rosterPage = 1;
      if (sourceEditRevision === 0 && c?.source) hydrateSource(c.source);
      if (!restoredDashboardDraft && c && collectionSourceMatches(c) && ui['source-type'].value !== 'specified' && ['collecting', 'ready', 'consumed'].includes(c.status) && Number.isInteger(c.target) && c.target >= 1 && c.target <= 200) ui.limit.value = String(c.target);
    }
    workspaceRevision = revision;
    workspace = next;
    restoredDashboardDraft = false;
    if (nextShopId) lastKnownShopId = nextShopId;
  }
  if (reply.state) {
    const revision = JSON.stringify(reply.state.denied || {});
    if (deniedRevision !== null && deniedRevision !== revision) resetConfirmation();
    deniedRevision = revision;
    state = reply.state;
    hydrateTask();
  }
}
async function request(type, payload = {}) {
  if (!available) throw new Error('请从 Chrome 扩展打开工作台');
  const sequence = ++requestSequence;
  const reply = await chrome.runtime.sendMessage({ type, ...payload });
  if (!reply || reply.ok !== true) {
    if (reply && typeof reply === 'object') applyReply(reply, sequence);
    throw new Error(reply?.error || '后台未返回有效结果，请检查扩展连接。');
  }
  applyReply(reply, sequence);
  return reply;
}
async function action(operation) {
  if (busy || !available) return;
  busy = true;
  render();
  try { await operation(); }
  catch (error) { showNotice(error instanceof Error ? error.message : '操作失败，请检查页面连接。', 'error'); }
  finally { busy = false; render(); }
}
function setTag(node, label, mood = '') {
  text(node, label);
  const className = `state-tag${mood ? ` ${mood}` : ''}`;
  if (node.className !== className) node.className = className;
}
function statusMood(status) {
  return ['sent', 'rehearsed'].includes(status) ? 'good' : ['uncertain', 'failed'].includes(status) ? 'bad' : status === 'skipped' ? 'warn' : '';
}
function reconcile(container, rows, entries, makeRow, updateRow) {
  const keys = new Set(entries.map(entry => entry.id));
  for (const [id, row] of rows) if (!keys.has(id)) { row.node.remove(); rows.delete(id); }
  let cursor = container.firstElementChild;
  for (const entry of entries) {
    let row = rows.get(entry.id);
    if (!row) { row = makeRow(entry); rows.set(entry.id, row); }
    updateRow(row, entry);
    if (row.node !== cursor) container.insertBefore(row.node, cursor);
    cursor = row.node.nextElementSibling;
  }
}
function denyCreator(creator, blocked) {
  if (!editable() || !shop()) return;
  const currentShop = { ...shop() };
  void action(async () => {
    resetConfirmation();
    await request('panel:deny', { shopId: currentShop.id, creatorId: creator.id, name: creator.name, blocked });
    showNotice(blocked ? `已将 ${creator.name} 加入本店铺拒绝名单。` : `已解除 ${creator.name} 的拒绝记录，历史防重发记录继续保留。`, 'success');
  });
}
function makeRosterRow(creator) {
  const node = create('tr');
  const checkboxCell = create('td');
  const checkbox = create('input');
  checkbox.type = 'checkbox';
  checkbox.disabled = true;
  checkbox.id = `candidate-${creator.id}`;
  checkbox.addEventListener('change', () => {
    if (checkbox.disabled) { renderRoster(); return; }
    changeSelection('panel:select', { creatorId: creator.id, selected: checkbox.checked });
  });
  checkboxCell.append(checkbox);
  const checkboxLabel = create('label', 'roster-choice');
  checkboxLabel.setAttribute('for', checkbox.id);
  checkboxLabel.setAttribute('aria-hidden', 'true');
  checkboxCell.append(checkboxLabel);
  const identityCell = create('td');
  const name = create('span', 'creator-name');
  const username = create('span', 'creator-username');
  identityCell.append(name, username);
  const stateCell = create('td');
  const tag = create('span', 'state-tag');
  stateCell.append(tag);
  const actionCell = create('td');
  const deny = create('button', 'text-button');
  deny.type = 'button';
  deny.addEventListener('click', () => {
    const current = creatorList().find(item => item.id === creator.id);
    if (current) denyCreator(current, !isDenied(current.id));
  });
  actionCell.append(deny);
  node.append(checkboxCell, identityCell, stateCell, actionCell);
  return { node, checkbox, name, username, tag, deny };
}
function renderRoster() {
  const creators = creatorList();
  const { entries, pages } = rosterPageEntries(creators);
  const taskItems = new Map((state.task?.items || []).map(item => [item.id, item]));
  const history = own(state.history, shop()?.id) || {};
  reconcile(ui['roster-body'], rosterRows, entries, makeRosterRow, (row, creator) => {
    const blocked = isDenied(creator.id);
    const c = selectionView(), included = c?.selectionVersion === 1 ? c.selectedIds.includes(creator.id) : ['ready', 'consumed'].includes(c?.status);
    row.checkbox.checked = included;
    row.checkbox.disabled = !selectionEditable() || (c?.unavailableIds || []).includes(creator.id) || (!included && c.count >= c.target);
    row.checkbox.title = !included && c?.count >= c?.target ? '已选满目标人数，请先取消一人再选择' : included ? '取消本次选择' : '选择此候选';
    row.checkbox.setAttribute('aria-label', `${creator.name}${included ? '，已选' : '，备选'}`);
    row.node.classList.toggle('selected', included);
    text(row.name, creator.name || '未命名达人');
    text(row.username, creator.username ? `@${creator.username.replace(/^@/, '')}` : '');
    let status = c?.selectionVersion === 1 ? included ? '已选' : (c.excludedIds || []).includes(creator.id) ? '已取消' : '备选' : '可建联';
    let mood = '';
    if (blocked) { status = '拒绝名单'; mood = 'warn'; }
    else if (own(history, creator.id)) { status = '已有防重发记录'; mood = 'warn'; }
    else if (creator.chatAvailable === false) { status = '暂无聊天入口'; mood = 'warn'; }
    else if (taskItems.has(creator.id)) { const item = taskItems.get(creator.id); status = statusNames[item.status] || '待检查'; mood = statusMood(item.status); }
    setTag(row.tag, status, mood);
    text(row.deny, blocked ? '解除拒绝' : '加入拒绝');
    row.deny.disabled = !editable() || !connected() || needsPreparation;
  });
  text(ui['roster-count'], creators.length);
  ui['roster-empty'].hidden = creators.length > 0;
  text(ui['roster-range'], creators.length ? `第 ${(rosterPage - 1) * PAGE_SIZE + 1}—${Math.min(rosterPage * PAGE_SIZE, creators.length)} 位 · 共 ${creators.length} 人` : '共 0 人');
  text(ui['roster-page'], `第 ${rosterPage} / ${pages} 页`);
  ui['roster-previous'].disabled = rosterPage <= 1;
  ui['roster-next'].disabled = rosterPage >= pages;
}
function renderPreview() {
  const config = taskOpen() ? state.task.config : null;
  const messages = config ? savedMessages(config) : messageDraft;
  const first = config?.creators?.[0] || (!sourceDirty && collectionSourceMatches(collection()) ? collection()?.creators?.[0] : null);
  const name = first?.name || '达人姓名';
  ui['message-preview-list'].replaceChildren();
  messages.forEach((message, index) => {
    const card = create('div', 'message-card');
    card.append(create('span', 'message-label', `第 ${index + 1} 条 · ${message.type === 'image' ? '图片' : message.type === 'link' ? '商品链接' : '文字'}`));
    if (message.type === 'image') renderImagePreview(card, messageDraft[index]?.type === 'image' ? messageDraft[index] : message);
    else {
      const content = create('p', 'message-text', message.content?.trim() ? message.type === 'text' ? message.content.replace(/\{\{name\}\}/g, () => name) : message.content.trim() : '填写消息内容后在这里预览。');
      if (index < 2) content.id = index === 0 ? 'preview-message' : 'preview-link';
      card.append(content);
    }
    ui['message-preview-list'].append(card);
  });
  text(ui['preview-sequence-count'], `共 ${messages.length} 条消息，按顺序逐条提交`);
  text(ui['preview-note'], sourceDirty ? '来源或筛选条件已变化，请重新准备名单后核对逐人预览。' : messages.some(message => message.type === 'text' && message.content?.includes('{{name}}')) ? `姓名以“${name}”为例，发送时自动替换。` : '内容随消息顺序实时更新。');
}
function makeQueueRow(item) {
  const node = create('li', 'queue-item');
  const name = create('strong');
  const tag = create('span', 'state-tag');
  const reason = create('p', 'item-reason');
  const actions = create('div', 'resolve-actions');
  const confirm = create('button', 'button button-outline');
  const skip = create('button', 'button button-outline', '跳过并保留防重发记录');
  for (const [button, resolution] of [[confirm, 'sent'], [skip, 'skip']]) {
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!row.resolveContext || button.disabled) return;
      const context = { ...row.resolveContext };
      void action(async () => {
        await request('panel:resolve', { ...context, resolution });
        showNotice('已记录当前条的人工核对结果；剩余消息需手动继续本任务。', 'success');
      });
    });
  }
  actions.append(confirm, skip);
  node.append(name, tag, reason, actions);
  const row = { node, name, tag, reason, actions, confirm, skip, resolveContext: null };
  return row;
}
function renderQueue() {
  const task = state.task;
  const items = task?.items || [];
  if (queueTaskId !== (task?.id || null)) { queueTaskId = task?.id || null; queuePage = 1; }
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  queuePage = Math.max(1, Math.min(queuePage, pages));
  const visibleItems = items.slice((queuePage - 1) * PAGE_SIZE, queuePage * PAGE_SIZE);
  const active = items.find(item => ['preparing', 'prepared', 'sending'].includes(item.status));
  const totals = { sent: 0, rehearsed: 0, skipped: 0, failed: 0, uncertain: 0, pending: 0 };
  for (const item of items) if (Object.hasOwn(totals, item.status)) totals[item.status]++;
  const finished = totals.sent + totals.rehearsed + totals.skipped + totals.failed;
  const percent = items.length ? Math.round(finished / items.length * 100) : 0;
  ui['progress-fill'].style.width = `${percent}%`;
  text(ui['queue-status'], statusNames[task?.status] || '尚未开始');
  const mode = task?.config?.mode === 'send' ? '真实发送' : '演练';
  text(ui['queue-context'], task ? `${task.config.shop.name} · ${mode}${active ? ` · 当前：${active.name}${active.messages ? ` · 第 ${active.messageIndex + 1} / ${active.messages.length} 条` : ''}` : task.status === 'running' ? ' · 等待下一位达人' : ''}` : '启动任务后，这里显示当前处理项和核对入口。');
  text(ui['progress-summary'], task ? `已处理 ${finished} / ${items.length} 人 · 已提交 ${totals.sent} · 已演练 ${totals.rehearsed} · 跳过 ${totals.skipped} · 失败 ${totals.failed} · 待核对 ${totals.uncertain}` : '尚无任务');
  text(ui['queue-duration'], task ? `任务总耗时：${formatDuration(taskElapsedMs(task, Date.now()))}` : '');
  ui['queue-duration'].hidden = !task;
  ui['queue-duration-help'].hidden = !task;
  text(ui['queue-reason'], task?.reason || '');
  ui['queue-reason'].hidden = !task?.reason;
  let guidance = '';
  if (totals.uncertain) guidance = '中断时草稿会保留，请先在专用 Shopee 页检查草稿并核对下列提交结果。核对完成前，不能继续或结束本任务。';
  else if (['paused', 'stopped'].includes(task?.status)) guidance = `${totals.failed ? '继续时将跳过失败项，不会自动重试。' : ''}中断时草稿会保留，请先检查专用页草稿与提交结果。继续处理剩余名单，或结束本任务后创建新任务。`;
  else if (['pausing', 'stopping'].includes(task?.status)) guidance = '正在等待当前操作返回结果，请勿关闭专用页面；界面会自动更新。';
  else if (task?.status === 'completed') guidance = '本任务已结束，可调整设置和名单，再启动新任务。';
  text(ui['queue-guidance'], guidance);
  ui['queue-guidance'].hidden = !guidance;
  const actionable = ['paused', 'stopped'].includes(task?.status);
  ui['pause-button'].hidden = task?.status !== 'running';
  ui['stop-button'].hidden = !['running', 'pausing'].includes(task?.status);
  ui['resume-button'].hidden = !actionable;
  ui['finish-button'].hidden = !actionable;
  ui['pause-button'].disabled = !available || busy;
  ui['stop-button'].disabled = !available || busy;
  ui['resume-button'].disabled = !available || busy || totals.uncertain > 0 || hasActiveItem() || !connected() || shop()?.id !== task?.config?.shop?.id;
  ui['finish-button'].disabled = !available || busy || totals.uncertain > 0 || hasActiveItem();
  text(ui['queue-range'], items.length ? `第 ${(queuePage - 1) * PAGE_SIZE + 1}—${Math.min(queuePage * PAGE_SIZE, items.length)} 位 · 共 ${items.length} 人` : '共 0 人');
  text(ui['queue-page'], `第 ${queuePage} / ${pages} 页`);
  ui['queue-previous'].disabled = queuePage <= 1;
  ui['queue-next'].disabled = queuePage >= pages;
  ui['queue-show-uncertain'].hidden = totals.uncertain === 0;
  reconcile(ui['queue-items'], queueRows, visibleItems, makeQueueRow, (row, item) => {
    text(row.name, item.name);
    setTag(row.tag, statusNames[item.status] || '待检查', statusMood(item.status));
    const progress = item.messages && task.config.mode === 'send' ? `已提交 ${item.submittedCount} / ${item.messages.length} 条${item.status === 'uncertain' ? '（当前条结果待核对）' : ''}。` : '';
    const detail = progress + (item.reason || '');
    text(row.reason, detail);
    row.reason.hidden = !detail;
    row.actions.hidden = item.status !== 'uncertain';
    const currentIndex = Number.isInteger(item.messageIndex) ? item.messageIndex + 1 : 1;
    row.resolveContext = item.status === 'uncertain' ? { taskId: task.id, sessionId: task.sessionId, itemId: item.id, ...(Array.isArray(item.messages) || Array.isArray(task.config.messages) ? { messageIndex: currentIndex - 1 } : {}) } : null;
    text(row.confirm, task.config.mode === 'dry-run' ? `确认第 ${currentIndex} 条已演练` : `确认第 ${currentIndex} 条已提交`);
    row.confirm.disabled = !available || busy || !actionable;
    row.skip.disabled = !available || busy || !actionable;
  });
}
function renderDenied() {
  const present = new Set(creatorList().map(creator => creator.id));
  const entries = Object.entries(deniedForShop()).map(([id, record]) => ({ id, name: record?.name || id, present: present.has(id) }));
  text(ui['deny-count'], entries.length);
  ui['deny-empty'].hidden = entries.length > 0;
  reconcile(ui['deny-items'], denyRows, entries, entry => {
    const node = create('li');
    const identity = create('span');
    const name = create('span');
    const hint = create('small');
    identity.append(name, hint);
    const button = create('button', 'text-button', '解除拒绝');
    button.type = 'button';
    button.addEventListener('click', () => {
      const record = own(deniedForShop(), entry.id);
      if (record) denyCreator({ id: entry.id, name: record.name || entry.id }, false);
    });
    node.append(identity, button);
    return { node, name, hint, button };
  }, (row, entry) => {
    text(row.name, entry.name);
    text(row.hint, entry.present ? '当前页面' : '不在当前页面');
    row.button.disabled = !editable() || !connected() || needsPreparation;
  });
}
function renderPreparation() {
  const c = !sourceDirty && collectionSourceMatches(collection()) ? selectionView() : null, status = c?.status;
  const preparation = workspace?.preparation && collectionSourceMatches(workspace.preparation) ? workspace.preparation : null;
  const filtering = workspace?.preparation?.status === 'filtering';
  const locked = filtering || ['collecting', 'ready'].includes(status);
  let target = null;
  try { target = getTargetCount(); } catch { /* Keep invalid inputs visible for correction. */ }
  const names = { collecting: '正在准备', ready: '名单已锁定', consumed: '名单已进入任务', insufficient: '人数不足', cancelled: '已取消准备', invalid: '名单已失效' };
  text(ui['collection-status'], filtering ? '正在应用网页筛选' : names[status] || '尚未准备');
  text(ui['selection-count'], c && !['cancelled', 'invalid'].includes(status) ? `已准备 ${c.count} / ${c.target} 人` : `目标 ${target || '—'} 人`);
  const progress = c && !['cancelled', 'invalid'].includes(status) ? Math.min(100, Math.round(c.count / c.target * 100)) : 0;
  ui['collection-progress'].style.width = `${progress}%`;
  text(ui['collection-reason'], sourceDirty ? '来源或筛选条件已变化，旧名单已失效，请重新准备。' : status === 'collecting' ? `仍缺 ${c.shortfall} 人。准备期间请保持专用 Shopee 页可见，工具会继续加载并筛选。` : status === 'ready' ? `已锁定 ${c.target} 人。修改人数请先取消准备。` : status === 'consumed' ? '这份名单已用于当前任务；下一次发送需重新准备。' : c?.reason || '填写人数后准备名单，备齐才可启动。');
  const choosing = c?.selectionVersion === 1 && !['cancelled', 'invalid'].includes(status);
  ui['selection-tools'].hidden = !choosing || taskOpen();
  ui['refill-selection'].disabled = selectionSaving || !selectionEditable() || !c?.shortfall;
  ui['reset-selection'].disabled = selectionSaving || !selectionEditable();
  ui['extend-candidates'].disabled = selectionSaving || !selectionEditable() || c?.candidateCount >= 200;
  text(ui['refill-selection'], `补足到 ${c?.target || target || '目标'} 人`);
  text(ui['reset-selection'], `恢复默认前 ${c?.target || target || '目标'} 人`);
  text(ui['roster-help'], choosing ? '默认勾选前目标人数，可取消后选择备选。每页显示 10 人，选择跨页保留。' : '按人数自动备齐并锁定，每页显示 10 人。');
  if (choosing) {
    text(ui['selection-count'], `候选 ${c.candidateCount} / ${c.candidateTarget} · 已选 ${c.count} / ${c.target} 人`);
    ui['collection-progress'].style.width = `${Math.min(100, Math.round(c.candidateCount / c.candidateTarget * 100))}%`;
    if (status === 'collecting') text(ui['collection-reason'], `正在准备 ${c.candidateTarget} 名候选，已选 ${c.count} / ${c.target} 人。请保持专用 Shopee 页可见，完成后可调整选择。`);
    if (status === 'ready') text(ui['collection-reason'], `${c.candidateShortfall ? '候选缓冲不足。' : ''}已选 ${c.count} / ${c.target} 人${c.shortfall ? `，还差 ${c.shortfall} 人；可补足或手动勾回已取消人员。` : '；发送前请核对最终名单。'}${c.candidateCount >= 200 ? '候选已达 200 人上限。' : ''}`);
  }
  if (preparation?.reason && ['filtering', 'invalid'].includes(preparation.status)) text(ui['collection-reason'], preparation.reason);
  if (selectionSaving) text(ui['collection-reason'], `选择正在保存（剩余 ${pendingSelections.length} 项），可继续勾选；保存完成前不能启动任务。`);
  if (status === 'insufficient' && c.source?.type === 'specified') text(ui['collection-reason'], `${ui['collection-reason'].textContent} 当前页面未找到 ${c.missing ?? 0} 个指定 ID；观察名单中被排除 ${c.excluded ?? 0} 人（筛选条件或已有记录）。`);
  if (available && !targetCountAvailable) text(ui['collection-reason'], latestApplied ? reloadHelp : '正在连接扩展后台…');
  const webpage = ['marketplace', 'leaderboard'].includes(ui['source-type'].value);
  ui['prepare-list'].disabled = !targetCountAvailable || !editable() || !workspace?.pageId || locked || target === null || (webpage && ui['web-filters-enabled'].checked && (!pageFilters || pageFiltersLoading || pageFiltersPending));
  text(ui['prepare-list'], filtering ? '正在应用筛选…' : c && !locked ? '重新准备名单' : '准备名单');
  ui['cancel-preparation'].hidden = !(filtering || ['collecting', 'ready'].includes(collection()?.status)) || taskOpen();
  ui['cancel-preparation'].disabled = !editable();
  ui.limit.disabled = !editable() || locked;
  ui['source-fields'].disabled = !editable() || filtering;
  const specified = ui['source-type'].value === 'specified';
  const affiliates = ui['source-type'].value === 'affiliates';
  ui['source-ids-field'].hidden = !specified;
  ui['source-affiliate-field'].hidden = !affiliates;
  ui['marketplace-count-field'].hidden = specified || affiliates;
  text(ui['source-help'], ui['source-type'].value === 'leaderboard' ? '选择排行榜后自动打开专用榜单。榜单和周期仍在 Shopee 页面选择，类目与渠道可在此应用；默认从第一页准备，可选择从当前页开始。准备或处理时请勿手动翻页、切换榜单或筛选。' : affiliates ? '填写联盟伙伴ID后打开专用页；逐个核实官方详情与聊天身份，全部准备成功才可启动。请勿手动切换详情，无法核实不会补人。' : '选择来源后打开专用 Shopee 页，可在这里应用网页筛选并准备名单。指定已加载 ID 只筛选达人广场真实挂载行。');
  text(ui['source-affiliate-count'], `去重后 ${[...new Set(ui['source-affiliate-ids'].value.split(/[,，\s]+/).filter(Boolean))].length} 人；通过官方详情逐个核实，按输入顺序准备，最多200人。`);
  text(ui['source-ids-count'], `去重后 ${[...new Set(ui['source-ids'].value.split(/[,，\s]+/).filter(Boolean))].length} 人；最多 200 人。请填写 Shopee 用户 ID，并非联盟伙伴 ID。`);
}
function render() {
  const locked = taskOpen();
  const isSend = ui.mode.value === 'send';
  ui['open-library'].disabled = !available || busy;
  ui['library-selection'].hidden = !pendingLibrarySelection;
  ui['library-selection-apply'].disabled = !pendingLibrarySelection || !editable() || !connected();
  text(ui['library-selection-status'], pendingLibrarySelection ? `达人库已选择 ${pendingLibrarySelection.recordIds.length} 条记录，尚未套用；套用后仍须当前店铺页面重新准备名单。` : '');
  text(ui['connection-state'], !available ? '未连接扩展' : connected() ? '专用页面已连接' : workspace?.error ? '页面需要处理' : '等待专用页面');
  ui['connection-dot'].classList.toggle('connected', available && connected());
  text(ui['shop-name'], shop()?.name || '尚未识别店铺');
  text(ui['connection-detail'], workspace?.error || (needsPreparation ? '账号已变化，请重新准备名单并核对店铺。' : connected() ? '请确认这是本次要使用的店铺。' : '打开专用页面并登录，点击“准备名单”自动识别当前店铺。'));
  ui['open-page'].disabled = !available || busy;
  ui['export-results'].disabled = !available || busy || (!state.task && !Object.keys(state.denied || {}).length);
  ui['export-diagnostics'].disabled = !available || busy;
  ui['settings-fields'].disabled = !editable();
  text(ui['settings-note'], locked ? '本任务设置已固定，结束后可修改' : isSend ? '真实发送，启动前请核对' : '演练模式，不会点击发送');
  text(ui['mode-badge'], isSend ? '真实发送模式' : '演练模式');
  ui['mode-badge'].classList.toggle('send-mode', isSend);
  text(ui['mode-help'], isSend ? `每位达人按顺序提交 ${messageDraft.length} 条消息；全部完成提交后按设定间隔处理下一位，不等待送达或已读回执。“已提交”表示完成发送点击。` : '逐条演练消息顺序，不填草稿、不点击发送，也不产生真实提交记录；间隔需自行设定。');
  ui['consent-label'].hidden = !isSend || locked;
  const validConfig = currentFingerprint() !== null;
  ui['send-consent'].disabled = !editable() || !validConfig;
  text(ui['start-button'], isSend ? '启动真实发送队列' : '启动演练队列');
  ui['start-button'].disabled = !editable() || !validConfig || (isSend && !ui['send-consent'].checked);
  text(ui['launch-help'], locked ? '当前任务结束后才能建立新任务。' : needsPreparation || sourceDirty ? '店铺、来源或筛选条件已变化，请重新准备名单。' : isCollecting() ? '等待名单备齐，期间可返回配置消息。' : collection()?.status !== 'ready' ? '先按目标人数准备名单，再启动任务。' : validConfig ? isSend && !ui['send-consent'].checked ? '核对店铺、名单和消息后勾选发送确认。' : '启动后按锁定名单逐人处理。' : '请核对消息、间隔与准备名单的人数。');
  if (!locked && !sourceDirty && collection()?.selectionVersion === 1 && collection()?.status === 'ready' && collection().shortfall) text(ui['launch-help'], `还差 ${collection().shortfall} 人，必须恰好选择 ${collection().target} 人才能启动。`);
  ui['configuration-step'].hidden = currentStep !== 1;
  ui['audience-step'].hidden = currentStep !== 2;
  ui['step-one-indicator'].setAttribute('aria-current', currentStep === 1 ? 'step' : 'false');
  ui['step-two-indicator'].setAttribute('aria-current', currentStep === 2 ? 'step' : 'false');
  ui['message-next'].disabled = !available || busy;
  text(ui['message-next'], locked ? '查看达人名单' : '下一步：选择达人');
  ui['message-back'].disabled = busy;
  ui['launch-area'].hidden = currentStep !== 2;
  text(ui['consent-copy'], `已核对店铺、锁定名单与全部 ${messageDraft.length} 条消息，同意对每位达人按顺序提交`);
  if (collection()?.selectionVersion === 1) text(ui['consent-copy'], `已核对店铺、最终选中的 ${collection().count} 人与全部 ${messageDraft.length} 条消息，同意按顺序提交`);
  renderEditor();
  renderPreparation();
  renderWebFilters();
  renderRoster();
  renderPreview();
  renderQueue();
  renderDenied();
  renderMessageTemplates();
}

for (const field of [ui.interval, ui.limit, ui.mode, ui['task-name']]) {
  const changed = () => { resetConfirmation(); render(); };
  field.addEventListener('input', changed);
  field.addEventListener('change', changed);
}
ui['dashboard-skip'].addEventListener('click', event => { event.preventDefault(); ui.main.focus(); });
ui['message-next'].addEventListener('click', () => {
  if (!available || busy) return;
  if (taskOpen()) { currentStep = 2; render(); return; }
  try { getMessageSettings(); currentStep = 2; showNotice('消息配置已核对，请选择来源并准备本次达人名单。'); render(); if (!pageFilters) void loadPageFilters(); }
  catch (error) { showNotice(error.message, 'error'); }
});
ui['message-back'].addEventListener('click', () => { if (!busy) { currentStep = 1; render(); } });
ui['message-add'].addEventListener('click', () => {
  if (!editable() || messageDraft.length >= 10) return;
  messageDraft.push({ id: ++nextMessageId, type: 'text', content: '', contentId: `message-content-${nextMessageId}` });
  draftChanged();
});
ui['message-reset'].addEventListener('click', () => {
  if (!editable()) return;
  setDraftMessages([{ type: 'text', content: '' }]); render();
});
for (const id of ['source-type', 'source-ids', 'source-affiliate-ids', 'source-includes', 'source-excludes']) {
  const changed = () => {
    if (!editable() || workspace?.preparation?.status === 'filtering') return;
    sourceDirty = true; sourceEditRevision++; rosterPage = 1;
    if (id === 'source-type') clearPageFilters();
    resetConfirmation(); render();
    if (id === 'source-type' && ['marketplace', 'leaderboard'].includes(ui[id].value)) void action(async () => {
      await request('panel:open', { source: { type: ui['source-type'].value } });
      void loadPageFilters();
    });
  };
  ui[id].addEventListener(id === 'source-type' ? 'change' : 'input', changed);
}
for (const id of ['web-filters-enabled', 'start-current']) ui[id].addEventListener('change', () => changeWebFilterControl(id));
ui['web-filter-refresh'].addEventListener('click', () => {
  if (ui['web-filter-refresh'].disabled) return;
  pageFiltersStructureStartedAt = null;
  void loadPageFilters();
});
ui['message-template-select'].addEventListener('change', () => {
  templateEditRevision++;
  templateSelection = ui['message-template-select'].value;
  ui['message-template-name'].value = selectedMessageTemplate()?.name || '';
  renderMessageTemplates();
});
ui['message-template-name'].addEventListener('input', () => { templateEditRevision++; });
ui['message-template-name'].addEventListener('change', () => { templateEditRevision++; });
ui['message-template-refresh'].addEventListener('click', () => void loadMessageTemplates());
ui['message-template-apply'].addEventListener('click', () => {
  if (!templateEditable()) return;
  const selected = selectedMessageTemplate();
  if (!selected) return;
  setDraftMessages(savedMessages(selected));
  templateStatus('已套用消息顺序与内容，请核对逐条预览；发送确认已撤销。');
  render();
});
for (const operation of ['create', 'update', 'copy']) ui[`message-template-${operation}`].addEventListener('click', () => void saveMessageTemplate(operation));
ui['send-consent'].addEventListener('change', render);
for (const [id, type] of [['refill-selection', 'panel:refill-selection'], ['reset-selection', 'panel:reset-selection'], ['extend-candidates', 'panel:extend-candidates']]) ui[id].addEventListener('click', () => {
  if (!ui[id].disabled) changeSelection(type);
});
for (const [id, step] of [['roster-previous', -1], ['roster-next', 1]]) ui[id].addEventListener('click', () => {
  if (ui[id].disabled) return;
  rosterPage += step;
  renderRoster();
});
for (const [id, step] of [['queue-previous', -1], ['queue-next', 1]]) ui[id].addEventListener('click', () => {
  if (ui[id].disabled) return;
  queuePage += step; renderQueue();
});
ui['queue-show-uncertain'].addEventListener('click', () => {
  const index = (state.task?.items || []).findIndex(item => item.status === 'uncertain');
  if (index < 0) return;
  queuePage = Math.floor(index / PAGE_SIZE) + 1; renderQueue();
});
ui['prepare-list'].addEventListener('click', () => void action(async () => {
  if (!targetCountAvailable) throw new Error(reloadHelp);
  if (!workspace?.pageId) throw new Error('请打开专用页面，等待页面加载并登录后准备名单。');
  if (taskOpen()) throw new Error('请先结束当前任务。');
  resetConfirmation();
  const source = getSource();
  const collectionRevision = sourceEditRevision;
  await request('panel:collect', { targetCount: getTargetCount(), source });
  const c = collection();
  const preparation = workspace?.preparation;
  if (collectionRevision !== sourceEditRevision || (!collectionSourceMatches(c) && !collectionSourceMatches(preparation))) throw new Error('来源或条件已变化，请重新准备名单。');
  if (['filtering', 'invalid'].includes(preparation?.status) && collectionSourceMatches(preparation)) {
    needsPreparation = false; sourceDirty = false;
    showNotice(preparation.reason || '正在专用 Shopee 页应用筛选，核实后自动准备名单。', preparation.status === 'invalid' ? 'error' : '');
    return;
  }
  if (['collecting', 'ready', 'insufficient'].includes(c?.status) && c.binding?.shopId === shop()?.id) { needsPreparation = false; sourceDirty = false; }
  if (c?.status === 'ready') showNotice('名单已备齐并锁定，核对消息后可启动。', 'success');
  else if (c?.status === 'collecting') showNotice('已在后台开始准备名单；备齐后可在工作台查看，也可取消准备。', 'success');
  else showNotice(c?.reason || '名单尚未备齐，请重新准备。', 'error');
}));
ui['cancel-preparation'].addEventListener('click', () => void action(async () => {
  resetConfirmation();
  await request('panel:cancel-collection');
  showNotice('已取消准备。可修改人数后重新准备名单。');
}));
ui['open-page'].addEventListener('click', () => void action(async () => {
  resetConfirmation();
  const type = ui['source-type'].value;
  await request('panel:open', { source: type === 'affiliates' ? getSource() : { type: type === 'leaderboard' ? 'leaderboard' : 'marketplace' } });
  void loadPageFilters();
  showNotice('已打开专用 Shopee 页。登录后可在工作台选择网页筛选，填写人数并点击“准备名单”。');
}));
ui['open-library'].addEventListener('click', () => {
  if (!available || busy) return;
  try {
    saveDashboardDraft();
    window.location.href = 'creator-library.html';
  } catch (error) { showNotice(error.message, 'error'); }
});
ui['library-selection-apply'].addEventListener('click', () => void action(async () => {
  if (taskOpen()) throw new Error('请先结束当前任务，再套用达人库名单。');
  const choice = pendingLibrarySelection;
  if (!choice) throw new Error('请先在达人库选择名单。');
  if (!connected() || choice.shopId !== shop()?.id) throw new Error('达人库所选店铺与当前专用页不符，请重新连接并选择。');
  const selectionRevision = librarySelectionRevision, editRevision = sourceEditRevision, shopId = shop().id;
  const reply = await chrome.runtime.sendMessage({ type: 'panel:library-select', recordIds: choice.recordIds, expectedRevision: choice.libraryRevision, site: 'ID', shopId });
  if (!reply?.ok) throw new Error(reply?.error || '达人库读取失败，请重新选择。');
  const selected = reply.creatorLibrarySelection;
  const valid = () => selectionRevision === librarySelectionRevision && editRevision === sourceEditRevision && !taskOpen() && connected() && shop()?.id === shopId;
  if (!valid() || selected?.site !== 'ID' || selected.shopId !== shopId || selected.libraryRevision !== choice.libraryRevision || selected.requiresPageVerification !== true
      || !Array.isArray(selected.creatorIds) || selected.creatorIds.length < 1 || selected.creatorIds.length > 200 || selected.creatorIds.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))) throw new Error('达人库版本、店铺或选择已变化，请重新选择。');
  if (collection()) await request('panel:cancel-collection');
  if (!valid()) throw new Error('店铺或来源已变化，请重新套用名单。');
  ui['source-type'].value = 'specified'; ui['source-ids'].value = [...new Set(selected.creatorIds)].join(', '); ui['source-affiliate-ids'].value = '';
  clearPageFilters({ resetCheckboxes: true });
  ui['source-includes'].value = ''; ui['source-excludes'].value = '';
  sourceDirty = true; needsPreparation = true; sourceEditRevision++; rosterPage = 1; pendingLibrarySelection = null;
  resetConfirmation(); render(); showNotice('已套用达人库选择并保留消息。请在专用达人广场核对店铺并重新准备；库记录本身不证明可聊天。', 'success');
}));
ui['start-button'].addEventListener('click', () => void action(async () => {
  const config = getConfig();
  if (taskOpen()) throw new Error('请先结束当前任务。');
  if (config.mode === 'send' && !ui['send-consent'].checked) throw new Error('请先核对并勾选本次自动发送确认。');
  const fingerprint = JSON.stringify(config);
  const reply = await request('panel:preview', { config });
  if (fingerprint !== currentFingerprint()) throw new Error('店铺、名单或配置已变化，请重新核对后启动。');
  if (config.mode === 'send' && !ui['send-consent'].checked) throw new Error('发送确认已失效，请重新核对店铺、名单和消息。');
  if (!reply.previewToken || !reply.preview?.sendableCount) throw new Error('没有可处理的达人，请检查名单、拒绝记录和防重发记录。');
  await request('panel:start', { config, previewToken: reply.previewToken, confirmed: config.mode === 'send' && ui['send-consent'].checked });
  resetConfirmation();
  showNotice(config.mode === 'send' ? '真实发送队列已启动，请保持专用页面打开并关注处理结果。' : '演练队列已启动，不会点击发送。', 'success');
}));
for (const [id, type, message] of [
  ['pause-button', 'panel:pause', '已请求暂停，等待当前操作安全结束。'],
  ['stop-button', 'panel:stop', '已请求停止，剩余名单将保留在当前任务中。'],
  ['resume-button', 'panel:resume', '已继续本任务；失败项会跳过，不会自动重试。'],
  ['finish-button', 'panel:finish', '本任务已结束，剩余项记为跳过，历史记录已保留。'],
]) ui[id].addEventListener('click', () => void action(async () => {
  await request(type);
  resetConfirmation();
  showNotice(message, 'success');
}));
function downloadJSON(content, label) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `虾仁-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
ui['export-results'].addEventListener('click', () => {
  if (!available || busy) return;
  downloadJSON({ exportedAt: new Date().toISOString(), task: state.task, denied: state.denied || {} }, '任务与拒绝名单');
  showNotice('已导出本地任务与拒绝名单，演练结果与真实发送结果分别保留。图片只保存引用，不含图片原件，请另行保管原图。', 'success');
});
ui['export-diagnostics'].addEventListener('click', () => void action(async () => {
  const { diagnostics } = await request('panel:export-diagnostics');
  if (!diagnostics) throw new Error(reloadHelp);
  downloadJSON({ ...diagnostics, environment: { browser: globalThis.navigator?.userAgent || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }, '排查日志');
  showNotice('已导出排查日志，包含暂停、恢复和错误记录。', 'success');
}));
async function poll() {
  if (!available || busy || polling) return;
  polling = true;
  try { await request('panel:get'); if (currentStep === 2 && pageFiltersPending && !pageFiltersLoading && workspace?.pageId) void loadPageFilters(); }
  catch (error) { showNotice(error instanceof Error ? error.message : '无法读取后台状态。', 'error'); }
  finally { polling = false; render(); }
}
restoreDashboardDraft();
readLibraryHandoff();
render();
if (available) {
  void poll();
  void loadMessageTemplates();
  const timer = setInterval(() => void poll(), 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll(); });
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
} else {
  showNotice('请从 Chrome 扩展打开工作台', 'error');
  templateStatus('请从 Chrome 扩展打开工作台，再刷新模板。', true);
}
