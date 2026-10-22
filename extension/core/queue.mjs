import { normalizeSource } from './audience.mjs';
import { normalizeImageReference } from './image-assets.mjs';

// This reducer owns dispatch intent; the caller must persist its result before acting.
export function initialState() {
  return { version: 1, task: null, history: {}, denied: {} };
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function normalizeText(value, limit) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('消息模板不能为空');
  if (value.length > limit) throw new Error(`消息模板最多 ${limit} 字`);
  const remainder = value.replace(/\{\{name\}\}/g, '');
  if (remainder.includes('{{') || remainder.includes('}}')) throw new Error('模板只支持 {{name}} 变量，请检查未知或未闭合变量');
  return value;
}

function normalizeLink(value) {
  const link = requiredText(value, '产品链接');
  let url;
  try { url = new URL(link); } catch { throw new Error('产品链接必须是完整的 HTTP 或 HTTPS 网址'); }
  if (link.length > 2000 || /\s/.test(link) || !/^https?:\/\//i.test(link) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('产品链接必须是不含空格、换行或凭证的完整网址，最多 2000 字');
  return link;
}

export function normalizeMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error('消息序列须包含1—10条消息');
  return Array.from(value, message => {
    if (!message || !['text', 'link', 'image'].includes(message.type)) throw new Error('消息类型仅支持文字、产品链接或图片');
    if (message.type === 'image') return normalizeImageReference(message);
    return { type: message.type, content: message.type === 'text' ? normalizeText(message.content, 2400) : normalizeLink(message.content) };
  });
}

export function normalizeTaskName(value) {
  if (typeof value !== 'string' || value.trim().length > 80) throw new Error('任务名称须为最多80个字符的文字');
  return value.trim();
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('任务配置无效');
  const shop = { id: requiredText(config.shop?.id, '店铺标识'), name: requiredText(config.shop?.name, '店铺名称') };
  if (!Array.isArray(config.creators) || !config.creators.length) throw new Error('达人名单不能为空');
  if (config.creators.length > 200) throw new Error('达人名单最多 200 人');
  const creators = config.creators.map(creator => ({ id: requiredText(creator?.id, '达人标识'), name: requiredText(creator?.name, '达人名称') }));
  const content = {};
  if (Object.hasOwn(config, 'messages')) {
    if (Object.hasOwn(config, 'template') || Object.hasOwn(config, 'productLink')) throw new Error('消息序列不能与旧话术或产品链接字段混用');
    content.messages = normalizeMessages(config.messages);
  } else {
    content.template = normalizeText(config.template, 2000);
    if (config.productLink !== undefined) content.productLink = normalizeLink(config.productLink);
  }
  if (config.taskName !== undefined) content.taskName = normalizeTaskName(config.taskName);
  if (typeof config.intervalSeconds !== 'number' || !Number.isFinite(config.intervalSeconds) || config.intervalSeconds <= 0) throw new Error('发送间隔必须是正有限数');
  if (!Number.isInteger(config.limit) || config.limit <= 0) throw new Error('单次上限必须是正整数');
  if (!['dry-run', 'send'].includes(config.mode)) throw new Error('任务模式无效');
  const target = {};
  if (config.collectionId !== undefined || config.targetCount !== undefined) {
    if (typeof config.collectionId !== 'string' || !config.collectionId.trim() || !Number.isInteger(config.targetCount) || config.targetCount < 1 || config.targetCount > 200 || config.limit !== config.targetCount || creators.length !== config.targetCount) throw new Error('目标人数与锁定名单不符，不能少发启动');
    target.collectionId = config.collectionId;
    target.targetCount = config.targetCount;
  }
  return { shop, creators, ...content, source: normalizeSource(config.source), intervalSeconds: config.intervalSeconds, limit: config.limit, mode: config.mode, ...target };
}

function own(object, key) {
  return object && Object.hasOwn(object, key) ? object[key] : undefined;
}

function nested(object, shopId, creatorId) {
  return own(own(object, shopId), creatorId);
}

function put(object, key, value) {
  Object.defineProperty(object, key, { value, configurable: true, writable: true, enumerable: true });
}

function putNested(object, shopId, creatorId, value) {
  if (!own(object, shopId)) put(object, shopId, {});
  put(own(object, shopId), creatorId, value);
}

function skipReason(state, shopId, creatorId) {
  if (nested(state.denied, shopId, creatorId)) return '拒绝名单';
  if (nested(state.history, shopId, creatorId)) return '已有发送或不确定记录';
  return null;
}

export function previewTask(state, config) {
  const snapshot = normalizeConfig(config);
  const seen = new Set();
  let sendableCount = 0;
  const items = snapshot.creators.map(creator => {
    let reason = seen.has(creator.id) ? '名单重复' : skipReason(state, snapshot.shop.id, creator.id);
    seen.add(creator.id);
    if (!reason && sendableCount >= snapshot.limit) reason = '超过单次上限';
    if (!reason) sendableCount++;
    if (snapshot.messages) {
      const messages = snapshot.messages.map(message => {
        if (message.type === 'image') return normalizeImageReference(message);
        return message.type === 'text' ? message.content.replace(/\{\{name\}\}/g, () => creator.name) : message.content;
      });
      return { ...creator, text: typeof messages[0] === 'string' ? messages[0] : '', messages, messageTypes: snapshot.messages.map(message => message.type), messageIndex: 0, submittedCount: 0, status: reason ? 'skipped' : 'pending', reason, authorized: false };
    }
    const text = snapshot.template.replace(/\{\{name\}\}/g, () => creator.name);
    if (!text.trim()) throw new Error('渲染后的消息不能为空');
    return { ...creator, text, status: reason ? 'skipped' : 'pending', reason, authorized: false, ...(snapshot.productLink ? { messages: [text, snapshot.productLink], messageIndex: 0, submittedCount: 0 } : {}) };
  });
  if (snapshot.targetCount && sendableCount !== snapshot.targetCount) throw new Error(`锁定名单不再满足目标 ${snapshot.targetCount} 人，请重新准备；不能少发启动`);
  return { items, sendableCount, skippedCount: items.length - sendableCount };
}

function normalizeBinding(binding) {
  if (!Number.isInteger(binding?.tabId) || binding.tabId < 0) throw new Error('标签页绑定无效');
  return { tabId: binding.tabId, pageId: requiredText(binding.pageId, '页面标识') };
}

function matches(task, event) {
  return task && task.sessionId !== null && event.sessionId === task.sessionId && event.tabId === task.binding.tabId && event.pageId === task.binding.pageId && event.shopId === task.config.shop.id;
}

function recordHistory(state, item, status, now) {
  const task = state.task;
  putNested(state.history, task.config.shop.id, item.id, { status, taskId: task.id, sessionId: task.sessionId, updatedAt: now, ...(item.messages ? { submittedCount: item.submittedCount } : {}) });
}

function clearIntent(state, item) {
  if (item.submittedCount > 0) return; // The first message already has a real submission.
  const task = state.task;
  const history = nested(state.history, task.config.shop.id, item.id);
  if (history?.status === 'uncertain' && history.taskId === task.id && history.sessionId === task.sessionId) delete own(state.history, task.config.shop.id)[item.id];
}

function resetPending(item) {
  item.status = 'pending';
  item.authorized = false;
  item.reason = null;
}

function terminalRequest(task) {
  return task.status === 'stopping' ? 'stopped' : task.status === 'pausing' ? 'paused' : null;
}

export function currentText(item) {
  const message = item?.messages ? item.messages[item.messageIndex] : item?.text;
  return message?.type === 'image' ? '' : message;
}

export function currentMessage(item) {
  const message = item?.messages ? item.messages[item.messageIndex] : item?.text;
  if (message?.type === 'image') return normalizeImageReference(message);
  if (typeof message !== 'string') return null;
  const type = item.messageTypes?.[item.messageIndex] === 'link' || (!item.messageTypes && item.messages && item.messageIndex === 1) ? 'link' : 'text';
  return { type, content: message };
}

function sameMessage(item, event) {
  return !item?.messages || event.messageIndex === item.messageIndex;
}

function workCommand(task, item, type) {
  const message = currentMessage(item);
  return { type, taskId: task.id, sessionId: task.sessionId, itemId: item.id, creator: { id: item.id, name: item.name }, text: currentText(item), mode: task.config.mode, ...(item.messages ? { messageIndex: item.messageIndex } : {}), ...(message?.type === 'image' ? { message } : {}) };
}

export function reduceQueue(state, event, { now = Date.now(), uid = () => crypto.randomUUID() } = {}) {
  const next = structuredClone(state);
  const task = next.task;
  let command = null;
  const done = () => ({ state: next, command });
  const touch = () => { task.updatedAt = now; };

  if (event.type === 'deny') {
    const shopId = requiredText(event.shopId, '店铺标识');
    const creatorId = requiredText(event.creatorId, '达人标识');
    if (typeof event.blocked !== 'boolean') throw new Error('拒绝名单状态无效');
    if (event.blocked) putNested(next.denied, shopId, creatorId, { name: typeof event.name === 'string' ? event.name.trim() : '' });
    else if (own(next.denied, shopId)) delete own(next.denied, shopId)[creatorId];
    return done();
  }

  if (event.type === 'start') {
    if (task && task.status !== 'completed') throw new Error('请先完成当前任务，不能同时启动新任务');
    const config = normalizeConfig(event.config);
    const { items, sendableCount } = previewTask(next, config);
    if (!sendableCount) throw new Error('没有可处理的达人');
    next.task = { id: uid(), sessionId: uid(), binding: normalizeBinding(event.binding), config, status: 'running', items, nextAt: now, reason: null, createdAt: now, updatedAt: now };
    return done();
  }
  if (!task) {
    if (event.type === 'resolve') throw new Error('人工核对信息已过期，请刷新当前任务后重试');
    return done();
  }

  if (event.type === 'pause' || event.type === 'stop') {
    if (!['running', 'pausing', 'stopping'].includes(task.status)) return done();
    const stopping = event.type === 'stop' || task.status === 'stopping';
    task.reason = stopping ? '用户停止' : (event.reason || '用户暂停');
    const active = task.items.find(item => ['preparing', 'prepared', 'sending'].includes(item.status));
    if (active?.status === 'sending' && !active.authorized) {
      clearIntent(next, active);
      resetPending(active);
    } else if (active?.status === 'prepared') resetPending(active);
    const waiting = active?.status === 'preparing' || (active?.status === 'sending' && active.authorized);
    task.status = waiting ? (stopping ? 'stopping' : 'pausing') : (stopping ? 'stopped' : 'paused');
    touch();
    return done();
  }

  if (event.type === 'interrupt') {
    if (task.status === 'completed') return done();
    for (const item of task.items) {
      if (item.status === 'sending' && item.authorized) {
        item.status = 'uncertain';
        item.reason = event.reason || '发送过程已中断，请人工核对';
      } else if (['preparing', 'prepared', 'sending'].includes(item.status)) {
        clearIntent(next, item);
        resetPending(item);
      }
    }
    task.status = 'paused';
    task.reason = event.reason || '页面连接中断';
    task.sessionId = null; // Reject every late callback until a new session is created.
    touch();
    return done();
  }

  if (event.type === 'source-document') {
    const item = task.items.find(item => item.id === event.itemId);
    if (task.config.source?.type !== 'affiliates' || task.id !== event.taskId || task.sessionId !== event.sessionId || task.binding.tabId !== event.binding?.tabId
        || !item || item.status !== 'preparing' || task.items.some(row => row.status === 'sending' || row.status === 'prepared') || !['running', 'pausing', 'stopping'].includes(task.status)) throw new Error('受控来源文档导航状态已变化');
    resetPending(item);
    task.binding = normalizeBinding(event.binding); task.sessionId = uid();
    if (task.status === 'pausing') task.status = 'paused';
    if (task.status === 'stopping') task.status = 'stopped';
    touch(); return done();
  }

  if (event.type === 'resume') {
    if (!['paused', 'stopped'].includes(task.status)) throw new Error('只能恢复已暂停或已停止的任务');
    if (task.items.some(item => item.status === 'uncertain')) throw new Error('请先人工核对不确定的发送结果');
    task.binding = normalizeBinding(event.binding);
    task.sessionId = uid();
    for (const item of task.items) if (item.status === 'failed') { item.status = 'skipped'; item.reason ||= '失败项不自动重试'; }
    task.status = task.items.some(item => item.status === 'pending') ? 'running' : 'completed';
    task.reason = null;
    task.nextAt = Math.max(now, task.nextAt);
    touch();
    return done();
  }

  if (event.type === 'resolve') {
    if (event.taskId !== task.id || !Object.hasOwn(event, 'sessionId') || event.sessionId !== task.sessionId || (event.sessionId !== null && typeof event.sessionId !== 'string')) throw new Error('人工核对信息已过期，请刷新当前任务后重试');
    if (task.status === 'running') throw new Error('请先暂停任务再人工核对');
    if (!['sent', 'skip'].includes(event.resolution)) throw new Error('人工核对结论无效');
    const item = task.items.find(item => item.id === event.itemId && item.status === 'uncertain');
    if (!item || (item.messages && (!Number.isInteger(event.messageIndex) || event.messageIndex !== item.messageIndex))) throw new Error('待核对消息已变化，请刷新当前任务后重试');
    if (event.resolution === 'sent') {
      if (item.messages && item.messageIndex < item.messages.length - 1) {
        if (task.config.mode === 'send') item.submittedCount = item.messageIndex + 1;
        item.messageIndex++;
        item.authorized = false;
        item.status = 'pending';
        item.reason = '人工确认当前条已完成，剩余消息待继续';
        if (task.config.mode === 'send') recordHistory(next, item, 'uncertain', now);
        touch();
        return done();
      }
      item.status = task.config.mode === 'dry-run' ? 'rehearsed' : 'sent';
      if (item.messages && task.config.mode === 'send') item.submittedCount = item.messageIndex + 1;
      task.nextAt = now + task.config.intervalSeconds * 1000;
      // Persisted "confirmed" means a confirmed submission, not delivery/read.
      if (task.config.mode === 'send') recordHistory(next, item, 'confirmed', now);
    } else item.status = 'skipped';
    item.reason = event.resolution === 'sent' ? '人工确认已完成' : '人工跳过，保留防重发记录';
    touch();
    return done();
  }

  if (!matches(task, event)) return done();
  if (event.type === 'poll') {
    if (task.status !== 'running' || now < task.nextAt || task.items.some(item => ['preparing', 'sending'].includes(item.status))) return done();
    const prepared = task.items.find(item => item.status === 'prepared');
    if (prepared) {
      prepared.status = 'sending';
      prepared.authorized = false;
      if (task.config.mode === 'send') recordHistory(next, prepared, 'uncertain', now);
      command = workCommand(task, prepared, 'send');
    } else {
      for (const item of task.items) {
        if (item.status !== 'pending') continue;
        const history = nested(next.history, task.config.shop.id, item.id);
        // Only resume the remaining message of this task. Other tasks still
        // treat a partially submitted sequence as contacted and cannot resend it.
        const partial = item.submittedCount > 0 && history?.taskId === task.id && history.status === 'uncertain';
        const reason = partial && !nested(next.denied, task.config.shop.id, item.id) ? null : skipReason(next, task.config.shop.id, item.id);
        if (reason) {
          item.status = 'skipped'; item.reason = reason;
          if (task.config.targetCount) { task.status = 'paused'; task.reason = `目标名单中的达人已不可发送（${reason}），已暂停；不会补人或重试`; touch(); return done(); }
          continue;
        }
        item.status = 'preparing';
        command = workCommand(task, item, 'prepare');
        break;
      }
      if (!command) task.status = 'completed';
    }
    touch();
    return done();
  }

  if (event.type === 'prepared') {
    const item = task.items.find(item => item.id === event.itemId && item.status === 'preparing');
    if (!item || !sameMessage(item, event)) return done();
    const requested = terminalRequest(task);
    if (requested) { resetPending(item); task.status = requested; }
    else if (task.status !== 'running') return done();
    else if (event.ok === true) item.status = 'prepared';
    else { item.status = 'failed'; item.reason = event.reason || '页面准备失败'; task.status = 'paused'; task.reason = item.reason; }
    touch();
    return done();
  }

  if (event.type === 'authorize') {
    const item = task.items.find(item => item.id === event.itemId && item.status === 'sending');
    if (task.status !== 'running' || !item || item.authorized || !sameMessage(item, event)) return done();
    item.authorized = true;
    command = { type: 'permit', taskId: task.id, sessionId: task.sessionId, itemId: item.id, mode: task.config.mode, ...(item.messages ? { messageIndex: item.messageIndex } : {}) };
    touch();
    return done();
  }

  if (event.type === 'result') {
    const item = task.items.find(item => item.id === event.itemId && item.status === 'sending' && item.authorized);
    if (!item || !sameMessage(item, event) || !['running', 'pausing', 'stopping'].includes(task.status)) return done();
    const requested = terminalRequest(task);
    const expectedSuccess = task.config.mode === 'send' ? 'sent' : 'rehearsed';
    const outcome = [expectedSuccess, 'failed', 'uncertain'].includes(event.outcome) ? event.outcome : 'uncertain';
    if (outcome === expectedSuccess && item.messages) {
      if (task.config.mode === 'send') item.submittedCount = item.messageIndex + 1;
      if (item.messageIndex < item.messages.length - 1) {
        item.messageIndex++;
        item.authorized = false;
        item.status = requested ? 'pending' : 'prepared';
        item.reason = task.config.mode === 'send' ? '当前消息已提交，剩余消息待提交' : '当前消息已演练，剩余消息待演练';
        if (task.config.mode === 'send') recordHistory(next, item, 'uncertain', now);
        task.status = requested || 'running';
        task.nextAt = now;
        touch();
        return done();
      }
    }
    item.status = outcome;
    item.reason = event.reason || (outcome === 'uncertain' ? '发送结果不确定，请人工核对' : outcome === 'failed' ? '发送失败' : null);
    if (outcome === 'sent') recordHistory(next, item, 'confirmed', now);
    if (outcome === expectedSuccess) {
      task.nextAt = now + task.config.intervalSeconds * 1000;
      task.status = requested || (task.items.some(item => item.status === 'pending') ? 'running' : 'completed');
      if (!requested) task.reason = null;
    } else {
      task.status = requested || 'paused';
      task.reason = item.reason;
    }
    touch();
  }
  return done();
}
