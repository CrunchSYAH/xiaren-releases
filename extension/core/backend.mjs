import { initialState, previewTask, reduceQueue, currentText, currentMessage } from './queue.mjs';
import { validatePage, validateChat, validateImageChat } from './page-guards.mjs';
import { inspectPage } from '../page-snapshot.mjs';
import { inspectFilters } from '../page-filters-page.mjs';
import { createCollection, updateCollection, invalidateCollection, rosterSignature, selectCandidate, refillSelection, resetSelection, extendCandidates } from './collection.mjs';
import { normalizeSource } from './audience.mjs';
import { LEADERBOARD_PATH, claimLeaderboardPage, leaderboardRoster } from './leaderboard.mjs';
import { AFFILIATE_PATH, affiliateRoster } from './affiliate-source.mjs';
import { affiliateDetailUrl } from './affiliate-resolver.mjs';
import { affiliateResolverPage } from '../affiliate-resolver-page.mjs';
import { createCreatorLibraryHandler, isCreatorLibraryMessage } from './creator-library-handler.mjs';
import { readTaskHistory, archiveTask, listTaskHistory, getTaskHistoryDetail, exportTaskHistory } from './task-history.mjs';
import { readMessageTemplates, listMessageTemplates, createMessageTemplate, updateMessageTemplate, copyMessageTemplate } from './message-templates.mjs';
import { readImageAssets, listImageAssets, addImageAsset, getImageAsset, imageReference, normalizeImageReference } from './image-assets.mjs';

const MARKETPLACE = 'https://seller.shopee.co.id/portal/web-seller-affiliate/kol_marketplace';
const MARKETPLACE_PATH = new URL(MARKETPLACE).pathname;
const ACTIVE = new Set(['running', 'pausing', 'stopping']);
const LOG_LIMIT = 3000, LOG_BYTES = 1024 * 1024;
const HISTORY_READS = new Set(['panel:history-list', 'panel:history-detail', 'panel:history-export']);
const TEMPLATE_EVENTS = new Set(['panel:template-list', 'panel:template-create', 'panel:template-update', 'panel:template-copy']);
const IMAGE_EVENTS = new Set(['panel:image-list', 'panel:image-add', 'panel:image-get']);
const SELECTION_EVENTS = new Set(['panel:select', 'panel:refill-selection', 'panel:reset-selection', 'panel:extend-candidates']);
const PANEL_EVENTS = new Set([...SELECTION_EVENTS, 'panel:open', 'panel:collect', 'panel:cancel-collection', 'panel:preview', 'panel:start', 'panel:pause', 'panel:stop', 'panel:resume', 'panel:resolve', 'panel:finish', 'panel:deny']);
const LOG_EVENTS = new Set([...PANEL_EVENTS, 'backend:ready', 'task:state', 'item:state', 'workspace:state', 'page:hello', 'page:error', 'page:prepared', 'page:result', 'page:timeout', 'tab:updated', 'tab:removed', 'operation:error', 'storage:error', 'diagnostics:storage-error']);
const STATUSES = new Set(['running', 'pausing', 'paused', 'stopping', 'stopped', 'completed', 'pending', 'preparing', 'prepared', 'sending', 'sent', 'rehearsed', 'skipped', 'failed', 'uncertain', 'collecting', 'ready', 'consumed', 'cancelled', 'invalid', 'insufficient']);
const STAGES = new Set(['hello', 'poll', 'collect', 'prepare', 'snapshot', 'open-chat', 'wait-chat', 'fill', 'authorize', 'commit', 'result']);
// Only fixed application/Chrome errors may enter diagnostics. Never persist
// arbitrary exception messages, stacks, URLs, message bodies or page payloads.
const SAFE_REASONS = new Set([
  '用户暂停', '用户停止', '用户结束本任务，未处理项已跳过', '用户结束本任务', '用户取消准备，名单已失效', '用户暂停或停止准备，名单已失效',
  '原页面执行器已停止', '页面连接已中断', '无法安全填入消息', '聊天身份或页面状态已变化', '聊天控件已变化', '达人已不在当前可见名单',
  '锁定名单或聊天入口已失效', '达人聊天入口不可用', '店铺或页面状态变化', '等待聊天页面超时', '当前聊天已有草稿', '聊天控件无法识别',
  '准备会话已失效', '聊天草稿或控件已变化', '原文档会话已结束', '只支持印尼 Shopee 卖家页面', '无法核对店铺身份，请先在专用页面登录',
  '页面出现验证或操作限制，请人工处理后重新准备名单', '店铺已变化，任务已暂停', '聊天收件人不符，任务已暂停', '聊天控件无法识别，请检查页面版本',
  '当前聊天已有草稿，请人工处理后再继续', '消息文本与预览不符，已阻止发送', '发送控件尚不可用，已阻止发送',
  '专用页面文档尚未绑定，请等待页面连接后准备名单', '无法读取原专用文档，请刷新连接', '原页面文档已变化，请重新连接并核对',
  '店铺账号已变化，请重新核对；旧任务不会在新店铺继续', '专用页面已离开达人列表，名单已失效', '专用页面已离开印尼卖家站',
  '专用页面响应超时，名单准备已失效，请重新准备', '页面响应超时，已暂停；请核对当前结果后恢复', '原专用页面已关闭或无法连接',
  '专用页面已重新加载，名单已失效', '专用页面已重新加载，请核对后恢复', '页面执行中断，请核对当前项后恢复', '聊天准备失败，请检查页面及现有草稿',
  '该达人已加入拒绝名单，已阻止发送', '发送前已暂停，请核对本次草稿与结果；不会自动重发', '最终核对时页面身份、草稿或控件已变化',
  '已提交发送，不核对平台接受、送达或已读', '未确认本次发送提交，请人工核对；不会自动重发', '页面处理失败，已暂停；恢复时跳过该项',
  '专用页面地址已变化，原目标名单已失效', '专用页面地址已变化，请结束原任务并重新准备名单', '专用页面正在导航或刷新，名单已失效',
  '专用页面正在导航或刷新，请核对后恢复', '专用页面无法连接', '专用标签页已关闭，请核对当前项后恢复',
  '店铺、文档或页面会话已变化，请重新准备名单', '列表已替换、重排或入口已变化，请重新准备名单', '锁定名单的历史或拒绝记录已变化，请重新准备名单',
  '目标名单已备齐并锁定', '人工确认已完成', '人工跳过，保留防重发记录', '本地存储保存失败，已阻止后续操作；请关闭专用页面后重新加载扩展',
  '浏览器或扩展已重新启动，请重新创建专用页面并核对任务', '本地存储配额不足', '原页面文档或框架已不存在',
  '话术已提交，产品链接待提交', '话术已演练，产品链接待演练', '等待上一条消息输入框清空超时',
  '当前消息已提交，剩余消息待提交', '当前消息已演练，剩余消息待演练', '人工确认当前条已完成，剩余消息待继续',
  '人工核对信息已过期，请刷新当前任务后重试', '待核对消息已变化，请刷新当前任务后重试',
  '当前聊天已有附件或回复内容，请人工处理后再继续', '当前聊天已有草稿或附件，请人工处理后再继续',
  '等待上一条草稿或附件清空超时', '图片预备失败，请核对页面附件', '图片本地预览未就绪，已暂停；不会自动提交',
  '图片预备时出现其他草稿或回复内容', '图片预备时页面或附件控件已变化，已暂停', '图片预备会话已变化，请重新核对',
  '图片聊天身份已变化，已阻止发送', '图片上传结构尚未支持或已变化，已阻止操作', '当前聊天已有草稿或回复内容，请人工处理后再继续',
  '当前聊天已有附件，请人工处理后再继续', '图片预览与本次消息不符或尚未就绪，已阻止发送',
  '图片资产缺失或与原消息不符，请重新选择并核对图片', '本地图片读取失败，已阻止图片准备或发送',
  '排行榜分页结构无法可靠识别，请重新准备名单', '榜单、周期、分类、渠道或分页条件已变化，请重新准备名单',
  '排行榜翻页超时，请重新准备名单', '排行榜加载超时，请重新准备名单', '排行榜出现非受控翻页，请重新准备名单',
  '排行榜原页名单已替换或重排，请重新准备名单', '排行榜页序不符，请重新准备名单', '排行榜翻页核对失败，请重新准备名单',
  '联盟伙伴详情身份无法核实，请重新准备名单', '联盟伙伴详情加载超时，请重新准备名单',
  '联盟伙伴详情与目标身份、店铺或文档不符，请重新准备名单', '联盟伙伴身份映射或资料已变化，请重新准备名单',
  '联盟伙伴核对顺序已变化，请重新准备名单', '联盟伙伴映射冲突或收件人重复，不能启动',
  '指定联盟伙伴被筛选、历史或拒绝记录排除，不能补人启动', '目标人数与指定联盟伙伴不符，请重新准备名单',
  '详情导航前存在草稿或身份已变化，已阻止切页', '联盟伙伴详情导航失败，请重新准备名单',
  '联盟伙伴受控导航目标或时效已变化，请重新准备名单',
  '联盟伙伴详情加载中，请等待店铺与身份核对',
]);
function logReason(value) {
  if (typeof value !== 'string' || !value) return null;
  if (SAFE_REASONS.has(value)) return value;
  if (/^(?:加载名单达到检查上限|当前页面加载结构无法可靠识别|页面已无更多达人|页面加载停滞，未取得更多达人|名单准备超时)：目标 \d{1,3} 人，可用 \d{1,3} 人，仍缺 \d{1,3} 人；不能启动$/.test(value)) return value;
  if (/^目标名单中的达人已不可发送（(?:拒绝名单|已有发送或不确定记录)），已暂停；不会补人或重试$/.test(value)) return value;
  if (/Extension context invalidated/i.test(value)) return 'Extension context invalidated.';
  if (/Receiving end does not exist|Could not establish connection/i.test(value)) return 'Could not establish connection. Receiving end does not exist.';
  if (/message (?:port|channel) closed|asynchronous response.*channel closed/i.test(value)) return 'The message channel closed before a response was received.';
  if (/No tab with id/i.test(value)) return 'No tab with id: [省略编号]';
  if (/No (?:frame|document) with id|Frame with ID.*removed/i.test(value)) return '原页面文档或框架已不存在';
  if (/quota|QUOTA_BYTES/i.test(value)) return '本地存储配额不足';
  return '未收录的错误详情已省略';
}
function logError(value) {
  return { name: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'DOMException'].includes(value?.name) ? value.name : 'Error', message: logReason(value?.message || value) };
}
function logContext(value = {}) {
  value ||= {};
  const result = {};
  for (const key of ['taskCreatedAt', 'itemIndex', 'messageIndex', 'submittedCount', 'nextAt', 'sinceLastSeenMs', 'actionAgeMs', 'collectionCount', 'collectionTarget']) if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
  for (const key of ['taskStatus', 'itemStatus', 'collectionStatus']) if (STATUSES.has(value[key])) result[key] = value[key];
  for (const key of ['authorized', 'pageBound', 'documentBound', 'online', 'claimed', 'committed', 'urlChanged']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (['visible', 'hidden', 'prerender'].includes(value.visibility)) result.visibility = value.visibility;
  if (['loading', 'complete'].includes(value.loadStatus)) result.loadStatus = value.loadStatus;
  return result;
}
function cleanLogEvent(value) {
  if (!value || !LOG_EVENTS.has(value.event) || !Number.isFinite(value.at)) return null;
  const result = { at: value.at, event: value.event, context: logContext(value.context) };
  for (const key of ['from', 'to']) if (STATUSES.has(value[key])) result[key] = value[key];
  if (STAGES.has(value.stage)) result.stage = value.stage;
  if (value.reason) result.reason = logReason(value.reason);
  if (value.error) result.error = logError(value.error);
  if (PANEL_EVENTS.has(value.source) || ['panel:get', 'page:poll', 'page:snapshot', 'page:authorize', 'page:commit', 'page:collect-step', 'page:open-chat', 'page:result', 'page:prepared', 'page:hello', 'page:error', 'tab:updated', 'tab:removed'].includes(value.source)) result.source = value.source;
  return result;
}

export function createBackend(api, { now = () => Date.now(), uid = () => crypto.randomUUID(), readSnapshot, readPageFilters } = {}) {
  const library = createCreatorLibraryHandler(api, { now, uid });
  let state, workspace, browserSessionId, loaded = false, faulted = false, preview = null;
  let reconnectAt = 0, reconnectFailed = false;
  let serial = Promise.resolve();
  let diagnostics = { version: 1, dropped: 0, events: [] }, logSize = 0, logDirty = false, logWriteFailed = false, retryLogAt = 0;
  let logWriting = false, logRevision = 0;
  let observed = null, pageEnvironment = {};
  const snapshot = readSnapshot || (async (tabId, text = '', documentId, commit = null, listAction = null) => {
    if (!documentId) throw new Error('专用页面文档尚未绑定，请等待页面连接后准备名单');
    const results = await api.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, world: 'MAIN', func: inspectPage, args: [text, commit, listAction] });
    if (!results?.[0]?.result || results[0].documentId !== documentId) throw new Error('无法读取原专用文档，请刷新连接');
    return results[0].result;
  });
  const pageFilters = readPageFilters || (async (tabId, expected, requested = null) => {
    const results = await api.scripting.executeScript({ target: { tabId, documentIds: [expected.documentId] }, world: 'MAIN', func: inspectFilters, args: [expected, requested] });
    if (!results?.[0]?.result || results[0].documentId !== expected.documentId) throw new Error('无法读取原专用文档，请刷新连接');
    return results[0].result;
  });
  const payload = () => ({ state: structuredClone(state), workspace: structuredClone(workspace), capabilities: { targetCount: true, dualMessage: true, messageSequence: true, sourceSelection: true, imageMessages: true, candidateSelection: true } });
  const enqueue = (action, source, isolated = false) => {
    const result = serial.then(async () => {
      try { return await action(); }
      catch (error) { if (loaded && !isolated) record('operation:error', { source, error }); throw error; }
      finally { if (!isolated) flushDiagnostics(); }
    });
    serial = result.catch(() => {});
    return result;
  };
  const eventSize = entry => JSON.stringify(entry).length * 3; // Conservative UTF-8 bound, including CJK.
  function trimLogs() {
    while (diagnostics.events.length > LOG_LIMIT || logSize > LOG_BYTES) {
      logSize -= eventSize(diagnostics.events.shift()); diagnostics.dropped++;
    }
  }
  function diagnosticContext(itemId) {
    const task = state?.task, items = task?.items || [];
    const index = itemId ? items.findIndex(item => item.id === itemId) : items.findIndex(item => ['preparing', 'prepared', 'sending', 'uncertain', 'failed'].includes(item.status));
    const item = items[index], c = workspace?.collection;
    return logContext({ taskCreatedAt: task?.createdAt, taskStatus: task?.status, itemIndex: index >= 0 ? index + 1 : undefined, itemStatus: item?.status, authorized: item?.authorized, messageIndex: item?.messageIndex, submittedCount: item?.submittedCount,
      nextAt: task?.nextAt, sinceLastSeenMs: workspace?.lastSeen === undefined ? undefined : Math.max(0, now() - workspace.lastSeen), actionAgeMs: task ? Math.max(0, now() - task.updatedAt) : undefined,
      pageBound: !!workspace?.pageId, documentBound: !!workspace?.documentId, collectionStatus: c?.status, collectionCount: c?.count, collectionTarget: c?.target, ...pageEnvironment });
  }
  function record(event, details = {}) {
    const entry = cleanLogEvent({ at: now(), event, ...details, context: { ...diagnosticContext(), ...details.context } });
    if (!entry) return;
    diagnostics.events.push(entry); logSize += eventSize(entry); trimLogs(); logDirty = true; logRevision++;
  }
  function flushDiagnostics() {
    if (!loaded || !logDirty || logWriting || now() < retryLogAt) return;
    // Never hold a permit, submission reply or the business serial queue while
    // waiting for diagnostic storage. One writer keeps snapshots in order.
    logWriting = true;
    const revision = logRevision, snapshot = structuredClone(diagnostics);
    Promise.resolve().then(() => api.storage.local.set({ creatorDiagnostics: snapshot })).then(() => {
      logDirty = logRevision !== revision; logWriteFailed = false; retryLogAt = 0;
    }).catch(error => {
      if (!logWriteFailed) record('diagnostics:storage-error', { error });
      logWriteFailed = true; retryLogAt = now() + 5000;
    }).finally(() => { logWriting = false; if (logDirty && !logWriteFailed) flushDiagnostics(); });
  }
  function observation() {
    const task = state?.task, c = workspace?.collection;
    return { task: task ? { createdAt: task.createdAt, status: task.status, reason: task.reason } : null,
      items: (task?.items || []).map(item => ({ status: item.status, authorized: item.authorized, reason: item.reason, messageIndex: item.messageIndex, submittedCount: item.submittedCount })),
      workspace: { pageBound: !!workspace?.pageId, documentBound: !!workspace?.documentId, error: workspace?.error, collectionStatus: c?.status, collectionCount: c?.count, collectionReason: c?.reason } };
  }
  function observeChanges() {
    const next = observation(), previous = observed;
    observed = next;
    if (!previous) return;
    if (JSON.stringify(previous.task) !== JSON.stringify(next.task)) record('task:state', { from: previous.task?.status, to: next.task?.status, reason: next.task?.reason });
    next.items.forEach((item, index) => {
      const before = previous.task?.createdAt === next.task?.createdAt ? previous.items[index] : null;
      if (JSON.stringify(before) !== JSON.stringify(item) && (before || item.status !== 'pending')) record('item:state', { from: before?.status, to: item.status, reason: item.reason, context: { itemIndex: index + 1, itemStatus: item.status, authorized: item.authorized, messageIndex: item.messageIndex, submittedCount: item.submittedCount } });
    });
    if (JSON.stringify(previous.workspace) !== JSON.stringify(next.workspace)) record('workspace:state', { reason: next.workspace.error || next.workspace.collectionReason });
  }
  function exportDiagnostics() {
    const task = state?.task, c = workspace?.collection;
    const version = api.runtime.getManifest?.()?.version;
    return { diagnostics: { version: 1, exportedAt: now(), extensionVersion: typeof version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(version) ? version : null,
      limit: LOG_LIMIT, maxBytes: LOG_BYTES, dropped: diagnostics.dropped, persistence: { healthy: !logWriteFailed, unsaved: logDirty },
      summary: { storageFaulted: faulted, task: task ? { createdAt: task.createdAt, updatedAt: task.updatedAt, status: task.status, reason: logReason(task.reason), mode: task.config.mode, intervalSeconds: task.config.intervalSeconds, targetCount: task.config.targetCount || task.config.limit, counts: task.items.reduce((counts, item) => { if (STATUSES.has(item.status)) counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {}) } : null,
        workspace: { ...diagnosticContext(), error: logReason(workspace?.error), collectionReason: logReason(c?.reason), claimed: workspace?.receipt?.claimed === true, committed: workspace?.receipt?.committed === true } },
      events: structuredClone(diagnostics.events) } };
  }
  async function initialize() {
    if (loaded) return;
    const saved = await api.storage.local.get(['creatorQueue', 'creatorWorkspace', 'creatorDiagnostics']);
    if (saved.creatorQueue && saved.creatorQueue.version !== 1) throw new Error('本地记录版本不兼容，请先导出备份');
    state = saved.creatorQueue || initialState();
    workspace = saved.creatorWorkspace || null;
    if (saved.creatorDiagnostics?.version === 1) {
      diagnostics.events = (Array.isArray(saved.creatorDiagnostics.events) ? saved.creatorDiagnostics.events : []).map(cleanLogEvent).filter(Boolean);
      diagnostics.dropped = Number.isSafeInteger(saved.creatorDiagnostics.dropped) && saved.creatorDiagnostics.dropped >= 0 ? saved.creatorDiagnostics.dropped : 0;
      logSize = diagnostics.events.reduce((size, entry) => size + eventSize(entry), 0); trimLogs();
    }
    const session = await api.storage.session.get('creatorBrowserSession');
    browserSessionId = session.creatorBrowserSession || uid();
    if (!session.creatorBrowserSession) await api.storage.session.set({ creatorBrowserSession: browserSessionId });
    loaded = true;
    observed = observation(); record('backend:ready');
    if (workspace && workspace.browserSessionId !== browserSessionId) {
      await interrupt('浏览器或扩展已重新启动，请重新创建专用页面并核对任务');
      await save(state, null);
    }
  }
  async function save(nextState = state, nextWorkspace = workspace) {
    try {
      await api.storage.local.set({ creatorQueue: nextState, creatorWorkspace: nextWorkspace });
      state = nextState;
      workspace = nextWorkspace;
      observeChanges();
    } catch (error) {
      faulted = true;
      record('storage:error', { error });
      throw new Error('本地存储保存失败，已阻止后续操作；请关闭专用页面后重新加载扩展');
    }
  }
  async function apply(event) {
    const result = reduceQueue(state, event, { now: now(), uid });
    await save(result.state);
    return result.command;
  }
  function requirePanel(sender) {
    if (sender?.id !== api.runtime.id || sender.url !== api.runtime.getURL('dashboard.html')) throw new Error('只允许扩展工作台操作任务');
  }
  async function imageAssets(message, sender) {
    requirePanel(sender);
    let saved;
    try { saved = await api.storage.local.get(['creatorImageAssets']); }
    catch { throw new Error('本地图片读取失败，请检查存储后重试；原图片已保留'); }
    const store = await readImageAssets(saved.creatorImageAssets);
    if (message.type === 'panel:image-list') return { imageAssets: await listImageAssets(store) };
    if (message.type === 'panel:image-get') {
      const imageAsset = await getImageAsset(store, message.assetId);
      if (!imageAsset) throw new Error('图片资产不存在，请重新选择图片');
      return { imageAsset };
    }
    const result = await addImageAsset(store, message.draft, { id: uid(), now: now() });
    if (!result.reused) {
      try { await api.storage.local.set({ creatorImageAssets: result.store }); }
      catch { throw new Error('本地图片保存失败或容量不足，请精简图片后重试；原图片已保留'); }
    }
    return { imageAssets: await listImageAssets(result.store), imageAsset: await getImageAsset(result.store, result.assetId), assetId: result.assetId, reused: result.reused };
  }
  async function loadImage(reference) {
    const expected = normalizeImageReference(reference);
    let saved;
    try { saved = await api.storage.local.get(['creatorImageAssets']); }
    catch { throw new Error('本地图片读取失败，已阻止图片准备或发送'); }
    const asset = await getImageAsset(saved.creatorImageAssets, expected.assetId);
    if (!asset || JSON.stringify(imageReference(asset)) !== JSON.stringify(expected)) throw new Error('图片资产缺失或与原消息不符，请重新选择并核对图片');
    return asset;
  }
  async function checkImages(messages) {
    for (const message of messages || []) if (message?.type === 'image') await loadImage(message);
  }
  async function messageTemplates(message, sender) {
    requirePanel(sender);
    let saved;
    try { saved = await api.storage.local.get(['creatorMessageTemplates']); }
    catch { throw new Error('消息模板读取失败，请检查本地存储后刷新重试；原数据已保留'); }
    const store = readMessageTemplates(saved.creatorMessageTemplates);
    if (message.type === 'panel:template-list') return { messageTemplates: listMessageTemplates(store) };
    let next, savedTemplateId;
    if (message.type === 'panel:template-create') {
      savedTemplateId = uid();
      next = createMessageTemplate(store, message.draft, { id: savedTemplateId, now: now() });
    } else if (message.type === 'panel:template-update') {
      savedTemplateId = message.templateId;
      next = updateMessageTemplate(store, message, { now: now() });
    } else {
      savedTemplateId = uid();
      next = copyMessageTemplate(store, message, { id: savedTemplateId, now: now() });
    }
    await checkImages(next.templates.find(record => record.id === savedTemplateId)?.messages);
    try { await api.storage.local.set({ creatorMessageTemplates: next }); }
    catch { throw new Error('消息模板保存失败，请检查本地存储后重试；原数据已保留'); }
    return { messageTemplates: listMessageTemplates(next), savedTemplateId };
  }
  async function readHistory(message, sender) {
    if (sender?.id !== api.runtime.id || !['dashboard.html', 'history.html'].some(path => sender.url === api.runtime.getURL(path))) throw new Error('只允许扩展工作台或任务历史页读取任务记录');
    const saved = await api.storage.local.get(['creatorTaskHistory', 'creatorQueue']);
    if (!loaded && saved.creatorQueue && saved.creatorQueue.version !== 1) throw new Error('本地记录版本不兼容，请先导出备份');
    const history = readTaskHistory(saved.creatorTaskHistory);
    const current = loaded ? state.task : saved.creatorQueue?.task || null;
    if (message.type === 'panel:history-list') return { taskHistory: listTaskHistory(history, current, message.filters) };
    if (message.type === 'panel:history-detail' || message.taskId !== undefined) {
      if (typeof message.taskId !== 'string' || !message.taskId.trim()) throw new Error('请选择要查看的任务记录');
      const record = getTaskHistoryDetail(history, current, message.taskId);
      if (!record) throw new Error('任务记录不存在，请刷新任务历史');
      return message.type === 'panel:history-detail' ? { taskRecord: record } : { taskHistoryExport: { version: 1, exportedAt: now(), tasks: [record] } };
    }
    return { taskHistoryExport: exportTaskHistory(history, current, message.filters, now()) };
  }
  async function archiveCompletedTask() {
    if (!state.task) return;
    let saved;
    try { saved = await api.storage.local.get(['creatorTaskHistory']); }
    catch { throw new Error('任务历史读取失败，已保留原任务，请检查本地存储后重试'); }
    const history = archiveTask(readTaskHistory(saved.creatorTaskHistory), state.task);
    try { await api.storage.local.set({ creatorTaskHistory: history }); }
    catch { throw new Error('任务历史保存失败，已保留原任务，请检查本地存储后重试'); }
  }
  function requirePage(sender, allowNewDocument = false) {
    if (sender.frameId !== 0) throw new Error('仅允许顶层专用页面');
    if (sender.id !== api.runtime.id || !workspace || sender.tab?.id !== workspace.tabId) throw new Error('此标签页不是工具创建的专用页面');
    let url;
    try { url = new URL(sender.url); } catch { throw new Error('专用页面地址无效'); }
    if (url.origin !== 'https://seller.shopee.co.id') throw new Error('专用页面已离开印尼卖家站');
    if (typeof sender.documentId !== 'string' || !sender.documentId) throw new Error('无法核对原页面文档，请升级 Chrome 后重新连接');
    if (!allowNewDocument && sender.documentId !== workspace.documentId) throw new Error('专用页面文档已变化，请重新连接');
  }
  const rosterBinding = shopId => ({ browserSessionId, tabId: workspace.tabId, documentId: workspace.documentId, documentEpoch: workspace.documentEpoch, pageId: workspace.pageId, shopId });
  const sourcePath = source => source?.type === 'leaderboard' ? LEADERBOARD_PATH : source?.type === 'affiliates' ? AFFILIATE_PATH : MARKETPLACE_PATH;
  const sourceUrl = source => source?.type === 'affiliates' ? affiliateDetailUrl(source.affiliateIds[0]) : `https://seller.shopee.co.id${sourcePath(source)}`;
  const taskRoster = (c, creator) => ({ ...(c.source?.type === 'leaderboard' ? leaderboardRoster(c, creator) : c.source?.type === 'affiliates' ? affiliateRoster(c, creator) : { observed: c.observed, creator }), ...(c.filterContext ? { filterContext: c.filterContext } : {}) });
  function filterBinding() {
    if (!workspace?.pageId || !workspace.documentId || !workspace.documentEpoch || !workspace.shop?.id) throw new Error('请连接专用页面并核对店铺后读取筛选');
    return { ...rosterBinding(workspace.shop.id), path: workspace.path };
  }
  function validateFilters(filters, requested = null) {
    if (filters?.error) throw new Error(filters.error);
    if (!filters || filters.path !== workspace.path || filters.documentEpoch !== workspace.documentEpoch || !filters.current || !filters.supported) throw new Error('页面筛选结构无法核实，请重新连接专用页面');
    if (requested) for (const key of ['category', 'channel']) {
      if (!filters.supported[key] && requested[key] !== '') throw new Error('当前页面不支持所选筛选条件，请重新读取网页筛选');
      if (filters.supported[key] && !filters.options?.[key === 'category' ? 'categories' : 'channels']?.some(option => option.value === requested[key])) throw new Error('所选筛选条件已不可用，请重新读取网页筛选');
    }
    return filters;
  }
  const filtersWaiting = filters => filters?.loading === true && filters.path === workspace?.path && filters.documentEpoch === workspace?.documentEpoch
    && ['无法核对原页筛选及列表状态', '无法核对排行榜筛选及列表状态'].includes(filters.error);
  async function startCollection(targetCount, source, current) {
    if (current.path !== sourcePath(source)) throw new Error('名单来源与专用页面不符，请打开对应来源页面');
    if (source.type === 'leaderboard' && source.startPosition !== 'current' && current.list?.pagination?.page !== 1) throw new Error('请先在排行榜回到第一页，或选择从当前位置准备');
    if (source.type === 'affiliates' && current.affiliateEvidence?.affiliate?.affiliateId !== source.affiliateIds[0]) throw new Error('请先打开指定联盟伙伴的第一位官方详情，再准备名单');
    const c = createCollection(targetCount, rosterBinding(current.shop.id), uid(), now(), source);
    workspace = { ...workspace, preparation: null, collection: updateCollection(c, current, state, rosterBinding(current.shop.id), now()) };
    await save();
      // Collection runs against the recorded tab in the background; do not
      // steal focus from the dashboard while preparing a roster.
  }
  async function advancePreparation() {
    const pending = workspace?.preparation;
    if (pending?.status !== 'filtering') return;
    try {
      if (Object.hasOwn(pending.source?.webFilters || {}, 'search')) throw new Error('工作台名称搜索已移除，请重新准备名单');
      if (state.task && state.task.status !== 'completed') throw new Error('请先结束当前任务，再准备目标名单');
      if (now() - pending.startedAt >= 45000) throw new Error('网页筛选准备超时，请重新准备');
      const bound = filterBinding();
      if (Object.keys(pending.binding).some(key => pending.binding[key] !== bound[key])) throw new Error('店铺、文档或页面会话已变化，请重新准备名单');
      const observedFilters = await pageFilters(workspace.tabId, bound);
      if (now() - pending.startedAt >= 45000) throw new Error('网页筛选准备超时，请重新准备');
      if (filtersWaiting(observedFilters)) return;
      const before = validateFilters(observedFilters, pending.source.webFilters);
      if (before.loading) return;
      const unchanged = before.matched === true && ['category', 'channel'].every(key => before.current[key] === pending.source.webFilters[key]);
      // Save the possible position reset before any page action. A worker exit
      // after a click must not silently treat the new top row as the old position.
      if (!unchanged && !pending.changed) {
        workspace.preparation = { ...pending, changed: true };
        await save();
        await api.tabs.update(workspace.tabId, { active: true });
      }
      if (now() - pending.startedAt >= 45000) throw new Error('网页筛选准备超时，请重新准备');
      const filters = unchanged ? before : validateFilters(await pageFilters(workspace.tabId, bound, pending.source.webFilters), pending.source.webFilters);
      if (now() - pending.startedAt >= 45000) throw new Error('网页筛选准备超时，请重新准备');
      if (filters.performed) workspace.preparation = { ...pending, changed: true };
      const matched = filters.matched === true && ['category', 'channel'].every(key => filters.current[key] === pending.source.webFilters[key]);
      if (filters.performed || filters.loading || !matched) { await save(); return; }
      if (workspace.preparation.changed && pending.source.startPosition === 'current') throw new Error('筛选已应用，页面位置已重置；请在专用页定位后再次准备');
      const current = await read();
      if (now() - pending.startedAt >= 45000) throw new Error('网页筛选准备超时，请重新准备');
      if (current.shop.id !== bound.shopId || current.path !== bound.path || current.documentEpoch !== bound.documentEpoch) throw new Error('店铺、文档或页面会话已变化，请重新准备名单');
      if (current.list?.loading) return;
      if (!filters.filterContext || filters.filterContext !== current.list?.filterContext) throw new Error('页面筛选条件尚未稳定，请重新准备名单');
      await startCollection(pending.targetCount, pending.source, current);
    } catch (error) {
      if (faulted) throw error;
      workspace = { ...workspace, preparation: { ...workspace.preparation, status: 'invalid', reason: error.message } };
      await save();
    }
  }
  function navigationValid(nav = workspace?.navigation) {
    const c = workspace?.collection;
    return !!nav && now() - nav.startedAt < 45000 && c?.id === nav.collectionId && ['collecting', 'consumed'].includes(c.status)
      && c.source?.type === 'affiliates' && c.affiliateState?.expectedAffiliateId === nav.affiliateId
      && (!nav.taskId || state.task?.id === nav.taskId && state.task.sessionId === nav.sessionId && state.task.items.some(item => item.id === nav.itemId && item.status === 'preparing') && ['running', 'pausing', 'stopping'].includes(state.task.status));
  }
  async function navigateAffiliate(affiliateId, current, item = null) {
    const c = workspace.collection;
    if (workspace.navigation || c.pagePending || c.affiliateState?.expectedAffiliateId) return false;
    const checked = await snapshot(workspace.tabId, '', workspace.documentId, null, { type: 'check-navigation', path: AFFILIATE_PATH, shopId: current.shop.id, documentEpoch: workspace.documentEpoch,
      roster: affiliateRoster(c, c.observed.find(row => row.affiliateId === c.affiliateState.currentAffiliateId)) });
    if (checked.listAction?.performed !== true) throw new Error('详情导航前存在草稿或身份已变化，已阻止切页');
    const task = item ? state.task : null;
    const navigation = { url: affiliateDetailUrl(affiliateId), affiliateId, collectionId: c.id, oldDocumentId: workspace.documentId, startedAt: now(),
      ...(task ? { taskId: task.id, sessionId: task.sessionId, itemId: item.id } : {}) };
    await save(state, { ...workspace, navigation, collection: { ...c, pagePending: true, action: null, affiliateState: { ...c.affiliateState, expectedAffiliateId: affiliateId, transitionAt: now() } } });
    try {
      await api.scripting.executeScript({ target: { tabId: workspace.tabId, documentIds: [workspace.documentId] }, func: () => { if (globalThis.__creatorOutreachPage) globalThis.__creatorOutreachPage.stopped = true; } });
      await api.tabs.update(workspace.tabId, { url: navigation.url });
    } catch {
      invalidateRoster('联盟伙伴详情导航失败，请重新准备名单', true); await interrupt('联盟伙伴详情导航失败，请重新准备名单');
      await save(state, { ...workspace, navigation: null }); return false;
    }
    return true;
  }
  async function turnLeaderboard(target, current) {
    const c = workspace.collection, paging = c?.pagination;
    if (!paging || paging.expectedPage !== null || c.pagePending) return false;
    const next = paging.currentPage + Math.sign(target - paging.currentPage);
    const roster = { observed: paging.pages.find(entry => entry.page === paging.currentPage)?.rows, page: paging.currentPage, context: paging.context };
    workspace = { ...workspace, collection: claimLeaderboardPage(c, next, now()) };
    await save(); // Persist the only authorized replacement before clicking a pager.
    const result = await snapshot(workspace.tabId, '', workspace.documentId, null, { type: 'turn-page', shopId: current.shop.id, documentEpoch: workspace.documentEpoch, path: LEADERBOARD_PATH, targetPage: next, roster });
    if (result.listAction?.performed !== true) {
      invalidateRoster('排行榜翻页核对失败，请重新准备名单', true);
      await interrupt('排行榜翻页核对失败，请重新准备名单'); await save();
      return false;
    }
    return true;
  }
  function invalidateRoster(reason, includeConsumed = false) {
    if (workspace?.preparation?.status === 'filtering') workspace = { ...workspace, preparation: { ...workspace.preparation, status: 'invalid', reason } };
    if (workspace?.collection && (includeConsumed || ['collecting', 'ready'].includes(workspace.collection.status))) {
      workspace = { ...workspace, collection: invalidateCollection(workspace.collection, reason) };
      preview = null;
    }
  }
  async function interrupt(reason) {
    preview = null;
    invalidateRoster(reason);
    if (state.task && state.task.status !== 'completed') await apply({ type: 'interrupt', reason });
  }
  async function read(text = '', bindDocument = false, allowPendingAffiliateShop = false) {
    if (!workspace) throw new Error('请先打开专用达人页面');
    let page;
    try {
      page = await snapshot(workspace.tabId, text, workspace.documentId);
      if (!Number.isFinite(page.documentEpoch) || page.documentEpoch <= 0 || (!bindDocument && page.documentEpoch !== workspace.documentEpoch)) throw new Error('原页面文档已变化，请重新连接并核对');
      // Bind the document even when its asynchronously loaded shop is not ready.
      if (bindDocument) {
        workspace = { ...workspace, documentEpoch: page.documentEpoch };
        if (workspace.bindingAffiliateNavigation && workspace.collection) workspace.collection = { ...workspace.collection, binding: rosterBinding(workspace.collection.binding.shopId) };
      }
      // Only an authorized, pinned detail navigation can wait for missing shop
      // metadata. Never substitute the previous shop as current evidence.
      const evidence = page.affiliateEvidence;
      if (allowPendingAffiliateShop && page.shop == null && page.origin === 'https://seller.shopee.co.id' && page.path === AFFILIATE_PATH
          && !page.blocked && evidence?.blocked === false && evidence.origin === page.origin && evidence.path === page.path && evidence.documentEpoch === page.documentEpoch
          && (evidence.reason === 'shop-unavailable' && !evidence.shop || evidence.shop?.id === workspace.collection.binding.shopId && (evidence.status === 'verified' || evidence.reason === 'profile-unverified'))) {
        workspace = { ...workspace, shop: null, creators: [] };
        return { ...page, sourceValid: false };
      }
      validatePage(page);
    } catch (error) { record('operation:error', { source: 'page:snapshot', stage: 'snapshot', error }); invalidateRoster(error.message, true); await save(); throw error; }
    if (state.task && ACTIVE.has(state.task.status) && page.shop.id !== state.task.config.shop.id) {
      await interrupt('店铺账号已变化，请重新核对；旧任务不会在新店铺继续');
    }
    if (workspace.shop?.id !== page.shop.id) preview = null;
    workspace = { ...workspace, documentEpoch: page.documentEpoch, path: page.path, shop: page.shop, creators: (page.creators || []).slice(0, 200), error: null };
    const c = workspace.collection;
    if (c && ['collecting', 'ready', 'consumed'].includes(c.status)) {
      // Our own sends change history after start; mounting/binding must still match.
      const checked = page.path !== sourcePath(c.source) ? invalidateCollection(c, '专用页面已离开达人列表，名单已失效') : updateCollection(c.status === 'consumed' ? { ...c, status: 'ready' } : c, page, c.status === 'consumed' ? { history: {}, denied: {} } : state, rosterBinding(page.shop.id), now());
      workspace.collection = c.status === 'consumed' && checked.status === 'ready' ? { ...checked, status: 'consumed' } : checked;
      page.sourceValid = ['collecting', 'ready', 'consumed'].includes(workspace.collection.status) && !workspace.collection.pagePending;
      if (workspace.collection.status === 'invalid') {
        preview = null;
        if (state.task?.config.collectionId === c.id && ACTIVE.has(state.task.status)) await interrupt(workspace.collection.reason);
      }
      if (c.selectionRevision !== checked.selectionRevision) preview = null;
      if (c.selectionRevision !== checked.selectionRevision || c.status !== workspace.collection.status || c.observed.length !== workspace.collection.observed.length || JSON.stringify(c.pagination) !== JSON.stringify(checked.pagination) || JSON.stringify(c.affiliateState) !== JSON.stringify(checked.affiliateState) || c.pagePending !== checked.pagePending) await save();
    }
    return page;
  }
  async function completeAffiliateNavigation(bindDocument = false) {
    const nav = workspace.navigation;
    if (!navigationValid(nav)) throw new Error('联盟伙伴受控导航目标或时效已变化，请重新准备名单');
    const current = await read('', bindDocument, true);
    // MAIN execution and persistence may have consumed the remaining deadline.
    if (now() - nav.startedAt >= 45000) throw new Error('联盟伙伴受控导航目标或时效已变化，请重新准备名单');
    if (workspace.collection.status === 'invalid') throw new Error(workspace.collection.reason);
    if (!current.shop || workspace.collection.pagePending) {
      workspace.error = '联盟伙伴详情加载中，请等待店铺与身份核对';
      await save();
      return false;
    }
    // Rotate the task session once the new document's full identity is ready.
    // Pause/stop during the wait remains pausing/stopping until this boundary.
    if (nav.taskId) await apply({ type: 'source-document', taskId: nav.taskId, sessionId: nav.sessionId, itemId: nav.itemId, binding: { tabId: workspace.tabId, pageId: workspace.pageId } });
    workspace = { ...workspace, navigation: null, bindingAffiliateNavigation: false };
    await save();
    return true;
  }
  function signature(config) {
    return JSON.stringify({ shop: config.shop, creators: config.creators.map(({ id, name }) => ({ id, name })), template: config.template, productLink: config.productLink, messages: config.messages, taskName: config.taskName, source: normalizeSource(config.source), intervalSeconds: config.intervalSeconds, limit: config.limit, mode: config.mode, collectionId: config.collectionId, targetCount: config.targetCount });
  }
  function checkConfig(config, page) {
    if (!config || config.shop?.id !== page.shop.id) throw new Error('店铺身份已变化，请重新准备名单并核对店铺');
    if (!Array.isArray(config.creators)) throw new Error('请先选择达人');
    if (config.collectionId !== undefined || config.targetCount !== undefined) {
      const c = workspace.collection;
      if (!c || c.id !== config.collectionId || c.status !== 'ready') throw new Error('目标名单尚未备齐或准备已失效，请重新准备');
      if (c.pagePending) throw new Error('来源页面尚未就绪，请等待核对完成');
      if (JSON.stringify(normalizeSource(config.source)) !== JSON.stringify(normalizeSource(c.source))) throw new Error('达人来源或筛选条件已变化，请重新准备名单');
      if (config.targetCount !== c.target || config.limit !== c.target || c.creators.length !== c.target || config.creators.length !== c.target || JSON.stringify(config.creators.map(({ id, name }) => ({ id, name }))) !== JSON.stringify(c.creators.map(({ id, name }) => ({ id, name })))) throw new Error('目标人数或锁定名单已变化，请核对选择并补足人数');
    } else {
      if (page.path !== MARKETPLACE_PATH) throw new Error('此来源必须先准备并锁定完整名单');
      if (JSON.stringify(normalizeSource(config.source)) !== JSON.stringify(normalizeSource())) throw new Error('自定义达人来源或筛选须先准备并锁定名单');
      if (['collecting', 'ready'].includes(workspace.collection?.status)) throw new Error('正在准备或已锁定目标名单，请取消准备后再使用手选名单');
    }
    for (const creator of config.creators) {
      const current = (['leaderboard', 'affiliates'].includes(workspace.collection?.source?.type) && config.collectionId ? workspace.collection.creators : page.creators)?.find(row => row.id === creator.id && row.name === creator.name);
      if (!current || !current.chatAvailable) throw new Error('名单与当前可见页面不符，或聊天入口不可用；请重新准备名单');
    }
  }
  async function inject() {
    if (!workspace) return;
    const tab = await api.tabs.get(workspace.tabId);
    if (new URL(tab.url).origin !== 'https://seller.shopee.co.id') throw new Error('专用页面已离开印尼卖家站');
    if (!workspace.pageId) {
      // A filter/navigation can clear our binding while reusing the document.
      // Retire its old controller before injection so its guard cannot skip hello.
      reconnectAt = now() + 5000;
      await api.scripting.executeScript({ target: { tabId: workspace.tabId }, func: () => { if (globalThis.__creatorOutreachPage) globalThis.__creatorOutreachPage.stopped = true; }, args: [] });
    }
    if (new URL(tab.url).pathname === AFFILIATE_PATH) await api.scripting.executeScript({ target: { tabId: workspace.tabId }, world: 'MAIN', func: affiliateResolverPage, args: [null, 'install'] });
    if ([MARKETPLACE_PATH, LEADERBOARD_PATH].includes(new URL(tab.url).pathname)) await api.scripting.executeScript({ target: { tabId: workspace.tabId }, world: 'MAIN', func: inspectFilters, args: [{}] });
    await api.scripting.executeScript({ target: { tabId: workspace.tabId }, files: ['content.js'] });
  }
  async function expire() {
    if (workspace?.preparation?.status === 'filtering' && now() - workspace.preparation.startedAt >= 45000) {
      invalidateRoster('网页筛选准备超时，请重新准备'); await save();
    }
    if (workspace?.navigation && !navigationValid()) {
      const reason = '联盟伙伴受控导航目标或时效已变化，请重新准备名单';
      invalidateRoster(reason, true); await interrupt(reason);
      await save(state, { ...workspace, navigation: null, bindingAffiliateNavigation: false });
    }
    if (workspace?.collection?.status === 'collecting' && now() - workspace.lastSeen > 45_000) {
      invalidateRoster('专用页面响应超时，名单准备已失效，请重新准备'); await save();
    }
    if (!state.task || !ACTIVE.has(state.task.status)) return;
    const age = now() - (workspace?.lastSeen || 0);
    const actionAge = now() - state.task.updatedAt;
    if (age > 45_000 || (state.task.items.some(item => ['preparing', 'sending'].includes(item.status)) && actionAge > 45_000)) {
      record('page:timeout');
      await interrupt('页面响应超时，已暂停；请核对当前结果后恢复');
    }
  }
  async function panel(message) {
    if (workspace?.preparation?.status === 'filtering' && ['panel:preview', 'panel:start', 'panel:resume'].includes(message.type)) throw new Error('网页筛选正在准备，请等待核对完成或取消准备');
    if (workspace?.navigation && ['panel:preview', 'panel:start', 'panel:resume'].includes(message.type)) throw new Error('联盟伙伴详情加载中，请等待店铺与身份核对');
    if (message.type === 'panel:get') {
      await expire();
      if (workspace && !workspace.pageId && !reconnectFailed && now() >= reconnectAt) {
        try {
          const tab = await api.tabs.get(workspace.tabId);
          if (tab.status === 'complete') await inject();
        } catch (error) {
          record('operation:error', { source: 'panel:get', error });
          reconnectFailed = true;
          workspace = { ...workspace, error: `专用页面连接失败：${error.message}；请点击“打开专用 Shopee 页”重试` };
          await save();
        }
      }
      return payload();
    }
    if (message.type === 'panel:open') {
      reconnectFailed = false;
      const requestedSource = normalizeSource(message.source), requestedPath = sourcePath(requestedSource), requestedUrl = sourceUrl(requestedSource);
      if (workspace) {
        let tab;
        try { tab = await api.tabs.get(workspace.tabId); } catch { await interrupt('原专用页面已关闭或无法连接'); }
        if (tab) {
          if (message.source && (new URL(tab.url).pathname !== requestedPath || requestedSource.type === 'affiliates' && tab.url !== requestedUrl)) {
            if (state.task && state.task.status !== 'completed') throw new Error('请先结束当前任务，再切换专用来源页面');
            await api.scripting.executeScript({ target: { tabId: workspace.tabId }, func: () => { if (globalThis.__creatorOutreachPage) globalThis.__creatorOutreachPage.stopped = true; } });
            invalidateRoster('专用页面地址已变化，原目标名单已失效', true);
            await save(state, { ...workspace, pageId: null, documentId: null, documentEpoch: null, shop: null, creators: [] });
            await api.tabs.update(workspace.tabId, { url: requestedUrl, active: false });
            return payload();
          }
          await inject(); return payload();
        }
      }
      const tab = await api.tabs.create({ url: requestedUrl, active: false });
      preview = null;
      await save(state, { browserSessionId, tabId: tab.id, pageId: null, shop: null, creators: [], lastSeen: now(), error: '页面加载中，请在登录后准备名单' });
      // onUpdated injects after a newly created tab finishes loading.
      return payload();
    }
    if (message.type === 'panel:filters') {
      if (!workspace) throw new Error('请先打开专用达人页面');
      if (!workspace.pageId || !workspace.documentId || !workspace.shop) return { ...payload(), pageFilters: { loading: true, error: workspace.error || '等待专用页面连接并登录' } };
      const current = await read();
      if (![MARKETPLACE_PATH, LEADERBOARD_PATH].includes(current.path)) throw new Error('当前来源没有网页筛选');
      const observedFilters = await pageFilters(workspace.tabId, filterBinding());
      return { ...payload(), pageFilters: filtersWaiting(observedFilters) ? observedFilters : validateFilters(observedFilters) };
    }
    if (SELECTION_EVENTS.has(message.type)) {
      if (state.task && state.task.status !== 'completed') throw new Error('名单已进入任务，不能修改选择');
      if (workspace?.preparation?.status === 'filtering' || !workspace?.pageId) throw new Error('来源页面尚未就绪，请重新准备名单');
      const current = await read(), c = workspace.collection;
      if (!c || c.id !== message.collectionId || c.selectionVersion !== 1 || c.status !== 'ready' || c.pagePending) throw new Error('候选名单已变化或尚未备齐，请重新准备');
      if (!Number.isInteger(message.expectedRevision) || message.expectedRevision !== c.selectionRevision) throw new Error('名单选择版本已变化，请刷新后重新操作');
      let next;
      if (message.type === 'panel:select') next = selectCandidate(c, message.creatorId, message.selected);
      if (message.type === 'panel:refill-selection') next = refillSelection(c);
      if (message.type === 'panel:reset-selection') next = resetSelection(c);
      if (message.type === 'panel:extend-candidates') {
        next = updateCollection(extendCandidates(c, now()), current, state, rosterBinding(current.shop.id), now());
        if (next.candidateCount === c.candidateCount && current.list?.hasMore !== true) throw new Error('当前来源已无更多候选，请手动勾回已取消人员');
      }
      preview = null;
      await save(state, { ...workspace, collection: next });
      return payload();
    }
    if (message.type === 'panel:collect') {
      if (state.task && state.task.status !== 'completed') throw new Error('请先结束当前任务，再准备目标名单');
      if (workspace?.preparation?.status === 'filtering') throw new Error('网页筛选正在准备，请等待核对完成或取消准备');
      if (!workspace?.pageId) throw new Error('请打开专用达人页面，等待页面连接并登录后准备名单');
      const source = normalizeSource(message.source);
      if (Object.hasOwn(source.webFilters || {}, 'search')) throw new Error('工作台名称搜索已移除，请重新准备名单');
      const page = await read();
      if (page.path !== sourcePath(source)) throw new Error('名单来源与专用页面不符，请打开对应来源页面');
      preview = null;
      if (source.webFilters) {
        createCollection(message.targetCount, rosterBinding(page.shop.id), 'validation', now(), source);
        const observedFilters = await pageFilters(workspace.tabId, filterBinding());
        if (!filtersWaiting(observedFilters)) validateFilters(observedFilters, source.webFilters);
        invalidateRoster('网页筛选准备已替换原名单', true);
        workspace = { ...workspace, preparation: { id: uid(), status: 'filtering', targetCount: message.targetCount, source, binding: filterBinding(), startedAt: now(), changed: false, reason: '正在应用并核对 Shopee 网页筛选' } };
        await save();
        await advancePreparation();
      } else {
        await startCollection(message.targetCount, source, page);
      }
      return payload();
    }
    if (message.type === 'panel:cancel-collection') {
      if (state.task && state.task.status !== 'completed') throw new Error('名单已进入任务，请通过任务暂停或结束操作');
      if (workspace?.preparation?.status === 'filtering') workspace.preparation = { ...workspace.preparation, status: 'cancelled', reason: '用户取消准备，名单已失效' };
      if (workspace?.collection) workspace.collection = { ...workspace.collection, status: 'cancelled', action: null, reason: '用户取消准备，名单已失效' };
      preview = null; await save(); return payload();
    }
    if (message.type === 'panel:preview' || message.type === 'panel:start') {
      if (!workspace?.pageId) throw new Error('专用页面尚未连接，请重新打开专用页面');
      const page = await read();
      checkConfig(message.config, page);
      if (message.type === 'panel:preview') {
        if (state.task && state.task.status !== 'completed') throw new Error('请先结束当前任务，再建立新任务');
        const result = previewTask(state, message.config);
        await checkImages(message.config.messages);
        preview = { token: uid(), signature: signature(message.config), pageId: workspace.pageId, shopId: page.shop.id };
        await save();
        return { ...payload(), preview: result, previewToken: preview.token };
      }
      if (!preview || preview.token !== message.previewToken || preview.signature !== signature(message.config) || preview.pageId !== workspace.pageId || preview.shopId !== page.shop.id) throw new Error('配置或页面已变化，请重新预览后启动');
      if (message.config.mode === 'send' && message.confirmed !== true) throw new Error('请先确认本次真实发送的店铺、名单与逐人消息');
      await checkImages(message.config.messages);
      const started = reduceQueue(state, { type: 'start', config: message.config, binding: { tabId: workspace.tabId, pageId: workspace.pageId } }, { now: now(), uid }).state;
      await archiveCompletedTask();
      await save(started, message.config.collectionId ? { ...workspace, collection: { ...workspace.collection, status: 'consumed', action: null } } : workspace);
      preview = null;
      return payload();
    }
    if (message.type === 'panel:pause' || message.type === 'panel:stop') {
      if (workspace?.preparation?.status === 'filtering') {
        workspace.preparation = { ...workspace.preparation, status: 'cancelled', reason: '用户暂停或停止准备，名单已失效' };
        preview = null; await save(); return payload();
      }
      if (workspace?.collection?.status === 'collecting') {
        workspace.collection = { ...workspace.collection, status: 'cancelled', action: null, reason: '用户暂停或停止准备，名单已失效' };
        preview = null; await save(); return payload();
      }
      await apply({ type: message.type.slice(6) }); return payload();
    }
    if (message.type === 'panel:resume') {
      if (!workspace?.pageId) throw new Error('请先连接专用页面');
      const page = await read();
      if (state.task?.config.shop.id !== page.shop.id) throw new Error('当前店铺与旧任务不符，不能恢复；请切回原店铺或结束旧任务');
      if (state.task?.config.collectionId && (workspace.collection?.status !== 'consumed' || workspace.collection.id !== state.task.config.collectionId)) throw new Error('原目标名单已失效，请结束当前任务并重新准备');
      await apply({ type: 'resume', binding: { tabId: workspace.tabId, pageId: workspace.pageId } });
      return payload();
    }
    if (message.type === 'panel:resolve') {
      await apply({ type: 'resolve', taskId: message.taskId, sessionId: message.sessionId, itemId: message.itemId, messageIndex: message.messageIndex, resolution: message.resolution }); return payload();
    }
    if (message.type === 'panel:finish') {
      if (!state.task || !['paused', 'stopped'].includes(state.task.status) || state.task.items.some(item => ['preparing', 'prepared', 'sending', 'uncertain'].includes(item.status))) throw new Error('请先暂停并核对当前项，再结束本任务');
      const finished = structuredClone(state);
      for (const item of finished.task.items) if (['pending', 'failed'].includes(item.status)) { item.status = 'skipped'; item.reason ||= '用户结束本任务'; }
      finished.task.status = 'completed'; finished.task.reason = '用户结束本任务，未处理项已跳过'; finished.task.updatedAt = now();
      await save(finished); preview = null; return payload();
    }
    if (message.type === 'panel:deny') {
      if (!workspace?.shop || message.shopId !== workspace.shop.id) throw new Error('拒绝名单店铺不符，请核对当前店铺并重新准备名单');
      await apply({ type: 'deny', shopId: message.shopId, creatorId: message.creatorId, name: message.name, blocked: message.blocked });
      if (workspace.collection?.status === 'ready') {
        if (workspace.collection.selectionVersion === 1) await read();
        else if (workspace.collection.creators.some(row => row.id === message.creatorId)) { invalidateRoster('锁定名单的拒绝记录已变化，请重新准备'); await save(); }
      }
      preview = null; return payload();
    }
    throw new Error('不支持此工作台操作');
  }
  async function page(message, sender) {
    if (message.type === 'page:hello') {
      if (typeof message.pageId !== 'string' || !message.pageId || message.pageId.length > 100) throw new Error('页面会话无效');
      pageEnvironment = logContext({ visibility: message.visibility, online: message.online });
      record('page:hello');
      const nav = workspace.navigation;
      const authorizedNavigation = navigationValid(nav) && sender.url === nav.url && sender.documentId !== nav.oldDocumentId
        && (!nav.documentId || nav.documentId === sender.documentId && nav.pageId === message.pageId);
      if (nav && !authorizedNavigation) {
        invalidateRoster('联盟伙伴受控导航目标或时效已变化，请重新准备名单', true);
        await interrupt('联盟伙伴受控导航目标或时效已变化，请重新准备名单');
      }
      if (!authorizedNavigation && workspace.pageId && (workspace.pageId !== message.pageId || workspace.documentId !== sender.documentId)) { invalidateRoster('专用页面已重新加载，名单已失效', true); await interrupt('专用页面已重新加载，请核对后恢复'); }
      const bindDocument = !authorizedNavigation || !nav.documentId;
      workspace = { ...workspace, pageId: message.pageId, documentId: sender.documentId, documentEpoch: bindDocument ? null : workspace.documentEpoch, lastSeen: now() };
      if (authorizedNavigation) {
        workspace.navigation = { ...nav, documentId: sender.documentId, pageId: message.pageId };
        workspace.bindingAffiliateNavigation = true;
      }
      reconnectAt = 0; reconnectFailed = false;
      if (authorizedNavigation) {
        try { await completeAffiliateNavigation(bindDocument); }
        catch (error) {
          workspace.error = error.message; invalidateRoster(error.message, true); await interrupt(error.message);
          await save(state, { ...workspace, navigation: null, bindingAffiliateNavigation: false });
        }
        return payload();
      }
      try { await read('', true); } catch (error) { workspace.error = error.message; await interrupt(error.message); }
      workspace = { ...workspace, navigation: null, bindingAffiliateNavigation: false };
      await save();
      return payload();
    }
    if (message.pageId !== workspace.pageId) return { command: null };
    pageEnvironment = { ...pageEnvironment, ...logContext({ visibility: message.visibility, online: message.online }) };
    await expire();
    workspace = { ...workspace, lastSeen: now() };
    if (workspace.preparation?.status === 'filtering') {
      if (message.type === 'page:poll') await advancePreparation();
      return { command: null, preparing: true };
    }
    if (workspace.navigation) {
      const nav = workspace.navigation;
      if (!nav.documentId) return { command: null, navigating: true };
      try {
        if (sender.url !== nav.url) throw new Error('联盟伙伴受控导航目标或时效已变化，请重新准备名单');
        if (!await completeAffiliateNavigation()) return { command: null, navigating: true };
      } catch (error) {
        workspace.error = error.message; invalidateRoster(error.message, true); await interrupt(error.message);
        await save(state, { ...workspace, navigation: null, bindingAffiliateNavigation: false });
        return { command: null };
      }
    }
    if (message.type === 'page:snapshot') return { snapshot: await read(message.text || '') };
    if (message.type === 'page:collect-step') {
      const c = workspace.collection;
      if (c?.status !== 'collecting' || c.id !== message.collectionId || !c.action || c.action.token !== message.token) return { performed: false };
      const current = await read();
      const checked = workspace.collection;
      if (checked.status !== 'collecting' || checked.action?.signature !== rosterSignature(current.creators)) return { performed: false };
      if (checked.source?.type === 'leaderboard') return { performed: await turnLeaderboard(checked.pagination.currentPage + 1, current) };
      if (checked.source?.type === 'affiliates') return { performed: await navigateAffiliate(checked.source.affiliateIds[checked.affiliateState.observations.length], current) };
      const signature = checked.action.signature;
      workspace.collection = { ...checked, action: null };
      await save(); // Claim before scrolling; no long promise occupies serial.
      const result = await snapshot(workspace.tabId, '', workspace.documentId, null, { type: 'load-more', shopId: current.shop.id, documentEpoch: workspace.documentEpoch, signature });
      return { performed: result.listAction?.performed === true };
    }
    if (message.type === 'page:error') {
      record('page:error', { stage: message.stage, error: message.error, context: diagnosticContext(message.itemId) });
      const reason = logReason(message.error?.message);
      await interrupt(reason && reason !== '未收录的错误详情已省略' ? reason : '页面执行中断，请核对当前项后恢复');
      await save(); return { command: null };
    }
    let current;
    const expectedText = currentText(state.task?.items.find(item => item.id === message.itemId)) || '';
    try { current = await read(['page:authorize', 'page:commit', 'page:result'].includes(message.type) ? expectedText : message.text || ''); }
    catch (error) { await interrupt(error.message); workspace.error = error.message; await save(); return { command: null }; }
    const task = state.task;
    const context = { tabId: sender.tab.id, pageId: message.pageId, shopId: current.shop.id, sessionId: message.sessionId ?? task?.sessionId, messageIndex: message.messageIndex };
    if (message.type === 'page:poll') {
      const c = workspace.collection;
      if (c?.status === 'collecting') {
        if (current.list?.loading || c.pagePending) { await save(); return { command: null }; }
        const token = uid();
        workspace.collection = { ...c, action: { token, signature: rosterSignature(current.creators) } };
        await save();
        return { command: { type: 'collect', collectionId: c.id, token } };
      }
      const command = await apply({ type: 'poll', ...context });
      return { command: command && task?.config.collectionId ? { ...command, collectionId: task.config.collectionId } : command, shopId: current.shop.id };
    }
    if (!task || message.sessionId !== task.sessionId || message.taskId !== task.id) return message.type === 'page:open-chat' ? { opened: false } : { command: null };
    const activeMessage = task.items.find(item => item.id === message.itemId);
    if (activeMessage?.messages && message.messageIndex !== activeMessage.messageIndex) return message.type === 'page:commit' ? { committed: false } : { command: null };
    const image = currentMessage(activeMessage)?.type === 'image' ? currentMessage(activeMessage) : null;
    if (message.type === 'page:image-stage') {
      if (!image || task.status !== 'running' || task.config.mode !== 'send' || activeMessage.status !== 'sending' || activeMessage.authorized) return { staged: false };
      const prior = workspace.imageDraft;
      if (prior?.taskId === task.id && prior.sessionId === task.sessionId && prior.itemId === activeMessage.id && prior.messageIndex === activeMessage.messageIndex) return { staged: false };
      try {
        const asset = await loadImage(image);
        const adopt = prior?.taskId === task.id && prior.itemId === activeMessage.id && prior.messageIndex === activeMessage.messageIndex
          && prior.assetId === image.assetId && prior.sha256 === image.sha256 && current.chat?.imageDraft?.token === prior.token && current.chat.imageDraft.ready;
        validateImageChat(current, activeMessage, task.config.shop.id, image, adopt ? prior : null, !adopt);
        const token = uid(), c = task.config.collectionId ? workspace.collection : null;
        const imageDraft = { taskId: task.id, sessionId: task.sessionId, itemId: activeMessage.id, messageIndex: activeMessage.messageIndex, assetId: image.assetId, sha256: image.sha256, token };
        await save(state, { ...workspace, imageDraft });
        const staged = await snapshot(workspace.tabId, '', workspace.documentId, null, { type: 'stage-image', shopId: task.config.shop.id, itemId: activeMessage.id, documentEpoch: workspace.documentEpoch,
          token, taskId: task.id, messageIndex: activeMessage.messageIndex, asset: image, dataUrl: asset.dataUrl, ...(adopt ? { adoptToken: prior.token } : {}), ...(c ? { path: sourcePath(c.source), roster: taskRoster(c, c.creators.find(row => row.id === activeMessage.id)) } : {}) });
        if (staged.listAction?.performed !== true) throw new Error('图片预备时页面或附件控件已变化，已暂停');
        return { staged: true, token };
      } catch (error) { await interrupt(error.message); await save(); return { staged: false }; }
    }
    if (message.type === 'page:open-chat') {
      const item = task.items.find(row => row.id === message.itemId && row.status === 'preparing');
      const c = workspace.collection;
      const locked = c?.creators.find(row => row.id === item?.id);
      if (task.status === 'running' && item && c?.status === 'consumed' && c.source?.type === 'affiliates' && locked) {
        if (c.pagePending) return { navigating: true, opened: false };
        if (c.affiliateState.currentAffiliateId !== locked.affiliateId) return { navigating: await navigateAffiliate(locked.affiliateId, current, item), opened: false };
      }
      if (task.status === 'running' && item && c?.status === 'consumed' && c.source?.type === 'leaderboard' && locked) {
        if (c.pagePending) return { navigating: true, opened: false };
        if (c.pagination.currentPage !== locked.page) return { navigating: await turnLeaderboard(locked.page, current), opened: false };
      }
      const creator = current.creators.find(row => row.id === item?.id && row.name === item.name && row.chatAvailable);
      if (task.status !== 'running' || !task.config.collectionId || workspace.collection?.status !== 'consumed' || !creator) return { opened: false };
      const result = await snapshot(workspace.tabId, '', workspace.documentId, null, { type: 'open-chat', shopId: task.config.shop.id, documentEpoch: workspace.documentEpoch, creator, path: sourcePath(c.source), roster: taskRoster(c, locked) });
      return { opened: result.listAction?.performed === true, shopId: current.shop.id };
    }
    if (message.type === 'page:prepared') {
      const item = task.items.find(item => item.id === message.itemId);
      const detail = logReason(message.error?.message);
      let ok = message.ok === true, reason = detail && detail !== '未收录的错误详情已省略' ? detail : '聊天准备失败，请检查页面及现有草稿';
      if (ok) {
        try {
          const prior = workspace.imageDraft;
          if (image && current.chat?.mediaCount && prior?.taskId === task.id && prior.itemId === item.id && prior.messageIndex === item.messageIndex) validateImageChat(current, item, task.config.shop.id, image, prior);
          else validateChat(current, item, task.config.shop.id);
        } catch (error) { ok = false; reason = error.message; }
      }
      if (!ok) record('page:prepared', { stage: message.stage || 'prepare', error: message.error || { message: reason }, context: diagnosticContext(message.itemId) });
      await apply({ type: 'prepared', ...context, itemId: message.itemId, ok, reason });
      return { command: null };
    }
    if (message.type === 'page:authorize') {
      const item = task.items.find(item => item.id === message.itemId);
      if (task.status !== 'running' || item?.status !== 'sending' || item.authorized) return { command: null };
      const denied = Object.hasOwn(state.denied, task.config.shop.id) && Object.hasOwn(state.denied[task.config.shop.id], message.itemId);
      if (denied) { await interrupt('该达人已加入拒绝名单，已阻止发送'); return { command: null }; }
      try {
        if (image) {
          await loadImage(image);
          const draft = workspace.imageDraft;
          if (task.config.mode === 'send' && (draft?.taskId !== task.id || draft.sessionId !== task.sessionId || draft.itemId !== item.id || draft.messageIndex !== item.messageIndex)) throw new Error('图片预备会话已变化，请重新核对');
          validateImageChat(current, item, task.config.shop.id, image, task.config.mode === 'send' ? draft : null, task.config.mode === 'dry-run');
        } else validateChat(current, item, task.config.shop.id, task.config.mode === 'send' ? currentText(item) : undefined);
      }
      catch (error) { record('operation:error', { source: 'page:authorize', stage: 'authorize', error, context: diagnosticContext(message.itemId) }); await interrupt(error.message); return { command: null }; }
      // Keep the persisted key for existing records. It now tracks only the
      // single-use submission, not a delivery/read receipt.
      workspace = { ...workspace, receipt: { taskId: task.id, sessionId: task.sessionId, itemId: item.id, messageIndex: item.messageIndex, documentId: workspace.documentId, documentEpoch: workspace.documentEpoch, claimed: false, committed: false,
        ...(image ? { image: { assetId: image.assetId, sha256: image.sha256, token: workspace.imageDraft?.token } } : {}) } };
      return { command: await apply({ type: 'authorize', ...context, itemId: message.itemId }) };
    }
    if (message.type === 'page:commit') {
      const item = task.items.find(item => item.id === message.itemId);
      const receipt = workspace.receipt;
      if (['pausing', 'stopping'].includes(task.status) && item?.status === 'sending' && item.authorized && !receipt?.claimed) {
        await apply({ type: 'result', ...context, itemId: item.id, outcome: 'uncertain', reason: '发送前已暂停，请核对本次草稿与结果；不会自动重发' });
        return { committed: false };
      }
      if (task.status !== 'running' || task.config.mode !== 'send' || item?.status !== 'sending' || !item.authorized || receipt?.taskId !== task.id || receipt.sessionId !== task.sessionId || receipt.itemId !== item.id || receipt.messageIndex !== item.messageIndex || receipt.documentId !== sender.documentId || receipt.documentEpoch !== workspace.documentEpoch || receipt.claimed) return { committed: false };
      const denied = state.denied[task.config.shop.id] && Object.hasOwn(state.denied[task.config.shop.id], item.id);
      try {
        if (denied) throw new Error('该达人已加入拒绝名单，已阻止发送');
        if (image) {
          await loadImage(image);
          validateImageChat(current, item, task.config.shop.id, image, receipt.image);
        } else validateChat(current, item, task.config.shop.id, currentText(item));
        const c = task.config.collectionId ? workspace.collection : null;
        const roster = c ? taskRoster(c, c.creators.find(row => row.id === item.id)) : null;
        // A crash or lost response after claiming can never issue a second click.
        await save(state, { ...workspace, receipt: { ...receipt, claimed: true } });
        const committed = await snapshot(workspace.tabId, currentText(item), receipt.documentId, { shopId: task.config.shop.id, itemId: item.id, documentEpoch: receipt.documentEpoch, ...(image ? { image: receipt.image } : {}), ...(task.config.collectionId ? { marketplacePath: sourcePath(c.source), roster } : {}) });
        if (committed?.commit?.clicked !== true) throw new Error('最终核对时页面身份、草稿或控件已变化');
        workspace = { ...workspace, receipt: { ...workspace.receipt, committed: true } };
        await apply({ type: 'result', ...context, itemId: item.id, outcome: 'sent', reason: '已提交发送，不核对平台接受、送达或已读' });
        return { committed: true, moreMessages: state.task.items.find(row => row.id === item.id)?.status === 'prepared' };
      } catch (error) {
        record('operation:error', { source: 'page:commit', stage: 'commit', error, context: diagnosticContext(message.itemId) });
        await interrupt(error.message); await save();
        return { committed: false };
      }
    }
    if (message.type === 'page:result') {
      let outcome = message.outcome;
      if (message.error) record('page:result', { stage: message.stage, error: message.error, context: diagnosticContext(message.itemId) });
      // Real success is recorded only by the controlled MAIN click above.
      // Old or forged page reports cannot independently advance a send.
      if (task.config.mode === 'send') outcome = 'uncertain';
      await apply({ type: 'result', ...context, itemId: message.itemId, outcome, reason: outcome === 'uncertain' ? '未确认本次发送提交，请人工核对；不会自动重发' : outcome === 'failed' ? '页面处理失败，已暂停；恢复时跳过该项' : null });
      return { command: null, moreMessages: state.task.items.find(row => row.id === message.itemId)?.status === 'prepared' };
    }
    throw new Error('不支持此页面操作');
  }
  return {
    handle: (message, sender) => isCreatorLibraryMessage(message) ? library.handle(message, sender) : enqueue(async () => {
      if (HISTORY_READS.has(message?.type)) return readHistory(message, sender);
      if (TEMPLATE_EVENTS.has(message?.type)) return messageTemplates(message, sender);
      if (IMAGE_EVENTS.has(message?.type)) return imageAssets(message, sender);
      if (message?.type?.startsWith('panel:')) requirePanel(sender);
      await initialize();
      if (message?.type === 'panel:export-diagnostics') return exportDiagnostics();
      if (faulted) throw new Error('本地存储保存失败，已阻止操作；请关闭专用页面后重新加载扩展');
      if (message?.type?.startsWith('panel:')) { if (PANEL_EVENTS.has(message.type)) record(message.type); return panel(message); }
      if (message?.type?.startsWith('page:')) {
        // A new hello may bind the newly navigated document; every other message
        // must originate in the document that was bound at hello/prepare time.
        requirePage(sender, message.type === 'page:hello');
        return page(message, sender);
      }
      throw new Error('消息类型无效');
    }, message?.type, HISTORY_READS.has(message?.type) || TEMPLATE_EVENTS.has(message?.type) || IMAGE_EVENTS.has(message?.type)),
    onUpdated: (tabId, change) => enqueue(async () => {
      await initialize();
      if (workspace?.tabId !== tabId || faulted) return;
      if (workspace.navigation && navigationValid() && (!workspace.navigation.documentId || change.status !== 'loading') && (typeof change.url !== 'string' || change.url === workspace.navigation.url)) {
        if (change.status === 'loading') await save(state, { ...workspace, pageId: null, documentId: null, documentEpoch: null });
        if (change.status === 'complete') {
          try { await inject(); }
          catch { invalidateRoster('联盟伙伴详情导航失败，请重新准备名单', true); await interrupt('联盟伙伴详情导航失败，请重新准备名单'); await save(state, { ...workspace, navigation: null }); }
        }
        return;
      }
      if (workspace.navigation) {
        invalidateRoster('联盟伙伴受控导航目标或时效已变化，请重新准备名单', true);
        await interrupt('联盟伙伴受控导航目标或时效已变化，请重新准备名单'); await save(state, { ...workspace, navigation: null });
      }
      if (change.status || typeof change.url === 'string') record('tab:updated', { context: { loadStatus: change.status, urlChanged: typeof change.url === 'string' } });
      if (typeof change.url === 'string' && (workspace.preparation?.status === 'filtering' || ['collecting', 'ready', 'consumed'].includes(workspace.collection?.status))) {
        invalidateRoster('专用页面地址已变化，原目标名单已失效', true);
        if (state.task?.config.collectionId) await interrupt('专用页面地址已变化，请结束原任务并重新准备名单');
        await save();
      }
      if (change.status === 'loading') {
        reconnectAt = 0; reconnectFailed = false;
        invalidateRoster('专用页面正在导航或刷新，名单已失效', true);
        await interrupt('专用页面正在导航或刷新，请核对后恢复');
        await save(state, { ...workspace, pageId: null, documentId: null, documentEpoch: null });
      }
      if (change.status === 'complete') {
        try { await inject(); }
        catch (error) {
          record('operation:error', { source: 'tab:updated', error });
          reconnectFailed = true;
          await interrupt('专用页面无法连接');
          workspace = { ...workspace, error: `专用页面连接失败：${error.message}；请点击“打开专用 Shopee 页”重试` };
          await save();
        }
      }
    }, 'tab:updated'),
    onRemoved: tabId => enqueue(async () => {
      await initialize();
      if (workspace?.tabId !== tabId || faulted) return;
      record('tab:removed');
      await interrupt('专用标签页已关闭，请核对当前项后恢复');
      await save(state, null);
    }, 'tab:removed'),
  };
}
