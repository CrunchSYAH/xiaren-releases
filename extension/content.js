(() => {
  if (globalThis.__creatorOutreachPage && !globalThis.__creatorOutreachPage.stopped) return;
  const pageId = crypto.randomUUID();
  const control = { pageId, stopped: false, prepared: null };
  globalThis.__creatorOutreachPage = control;
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const editorNode = () => document.querySelector('#sidebar-minichat-list textarea');
  const sendNode = () => document.querySelector('#sidebar-minichat-list .pqq6o4R57Y .plW8rzAMob');
  const setText = (editor, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('无法安全填入消息');
    setter.call(editor, value);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  async function call(type, body = {}) {
    if (control.stopped) throw new Error('原页面执行器已停止');
    const response = await chrome.runtime.sendMessage({ type, pageId, visibility: document.visibilityState, online: globalThis.navigator?.onLine, ...body });
    if (control.stopped) throw new Error('原页面执行器已停止');
    if (!response?.ok) throw new Error(response?.error || '页面连接已中断');
    return response;
  }
  const context = command => ({ taskId: command.taskId, sessionId: command.sessionId, itemId: command.itemId, text: command.text, ...(command.messageIndex !== undefined ? { messageIndex: command.messageIndex } : {}) });
  const failure = (error, stage) => ({ stage, error: { name: typeof error?.name === 'string' ? error.name : 'Error', message: typeof error?.message === 'string' ? error.message.slice(0, 500) : '' } });
  const read = async text => (await call('page:snapshot', { text })).snapshot;
  function checkChat(snapshot, command, shopId) {
    const chat = snapshot?.chat;
    if (snapshot?.sourceValid === false || snapshot?.blocked || snapshot?.shop?.id !== shopId || chat?.shopId !== shopId || chat?.recipientId !== command.itemId) throw new Error('聊天身份或页面状态已变化');
    if (!chat.editorFound || !chat.sendFound) throw new Error('聊天控件已变化');
    return chat;
  }
  const ownsImage = (chat, command) => command.message?.type === 'image' && chat.imageDraft?.ready
    && chat.imageDraft.taskId === command.taskId && chat.imageDraft.itemId === command.itemId && chat.imageDraft.messageIndex === command.messageIndex
    && chat.imageDraft.assetId === command.message.assetId && chat.imageDraft.sha256 === command.message.sha256;
  async function prepare(command) {
    control.prepared = null;
    let stage = 'snapshot';
    try {
      let shopId;
      if (command.collectionId) {
        // Background revalidates the bound, mounted roster and opens the exact
        // current row in one MAIN world call. No duplicate pre-open snapshot.
        stage = 'open-chat';
        let opened;
        for (let attempt = 0; attempt < 160; attempt++) {
          opened = await call('page:open-chat', context(command));
          if (!opened.navigating) break;
          await wait(250);
        }
        if (!opened.opened || !opened.shopId) throw new Error('锁定名单或聊天入口已失效');
        shopId = opened.shopId;
      } else {
        const snapshot = await read();
        const creator = snapshot.creators.find(creator => creator.id === command.itemId && creator.chatAvailable);
        if (!creator || !snapshot.shop?.id) throw new Error('达人已不在当前可见名单');
        shopId = snapshot.shop.id;
        stage = 'open-chat';
        const row = [...document.querySelectorAll('tr.kol-card-item[data-row-key]')].find(row => row.getAttribute('data-row-key') === creator.rowKey);
        const button = [...row?.querySelectorAll('button') || []].find(button => [...button.querySelectorAll('use')].some(use => (use.getAttribute('xlink:href') || use.getAttribute('href')) === '#icon-chat-new'));
        if (!button || button.disabled) throw new Error('达人聊天入口不可用');
        button.click();
      }
      let chat;
      stage = 'wait-chat';
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = await read();
        if (current.chat?.recipientId === command.itemId) { chat = checkChat(current, command, shopId); break; }
        if (current.blocked || current.shop?.id !== shopId) throw new Error('店铺或页面状态变化');
        await wait(250);
      }
      if (!chat) throw new Error('等待聊天页面超时');
      stage = 'prepare';
      if (chat.editorText) throw new Error('当前聊天已有草稿');
      if (chat.replyCount || (chat.mediaCount && !ownsImage(chat, command))) throw new Error('当前聊天已有草稿或附件，请人工处理后再继续');
      const editor = editorNode(), send = sendNode();
      if (!editor || !send) throw new Error('聊天控件无法识别');
      control.prepared = { itemId: command.itemId, sessionId: command.sessionId, shopId, editor, send };
      stage = 'result';
      await call('page:prepared', { ...context(command), ok: true });
      return true;
    } catch (error) {
      await call('page:prepared', { ...context(command), ok: false, ...failure(error, stage) });
    }
  }
  async function executeSend(command) {
    const prepared = control.prepared;
    let authorized = false;
    let moreMessages = false;
    let stage = 'snapshot';
    try {
      if (!prepared || prepared.sessionId !== command.sessionId || prepared.itemId !== command.itemId) throw new Error('准备会话已失效');
      let chat;
      // Wait only for the prior local draft/attachment preview to clear.
      // Never clear user content or inspect delivery/history to force progress.
      for (let attempt = 0; attempt < (command.messageIndex > 0 ? 40 : 1); attempt++) {
        chat = checkChat(await read(command.text), command, prepared.shopId);
        if (!chat.editorText && (!chat.mediaCount || ownsImage(chat, command)) && !chat.replyCount) break;
        if (command.messageIndex > 0) await wait(250);
      }
      if (chat.editorText || chat.replyCount || (chat.mediaCount && !ownsImage(chat, command))) throw new Error('等待上一条草稿或附件清空超时');
      if (command.messageIndex > 0) {
        prepared.editor = editorNode(); prepared.send = sendNode();
        if (!prepared.editor || !prepared.send) throw new Error('聊天控件无法识别');
      }
      if (prepared.editor !== editorNode() || prepared.send !== sendNode()) throw new Error('聊天草稿或控件已变化');
      stage = 'fill';
      if (command.message?.type === 'image') {
        if (!chat.imageSupported) throw new Error('图片上传结构尚未支持或已变化，已阻止操作');
        if (command.mode === 'send') {
          const staged = await call('page:image-stage', context(command));
          if (!staged.staged || !staged.token) throw new Error('图片预备失败，请核对页面附件');
          let ready = false;
          for (let attempt = 0; attempt < 40; attempt++) {
            chat = checkChat(await read(''), command, prepared.shopId);
            if (chat.editorText || chat.replyCount) throw new Error('图片预备时出现其他草稿或回复内容');
            if (ownsImage(chat, command) && chat.imageDraft.token === staged.token) { ready = true; break; }
            await wait(250);
          }
          if (!ready) throw new Error('图片本地预览未就绪，已暂停；不会自动提交');
          prepared.editor = editorNode(); prepared.send = sendNode();
          if (!prepared.editor || !prepared.send) throw new Error('聊天控件无法识别');
        }
      } else if (command.mode === 'send') setText(prepared.editor, command.text);
      stage = 'authorize';
      const permit = (await call('page:authorize', context(command))).command;
      if (!permit || permit.type !== 'permit' || permit.sessionId !== command.sessionId || permit.itemId !== command.itemId || permit.mode !== command.mode || permit.messageIndex !== command.messageIndex) return;
      authorized = true;
      if (command.mode === 'dry-run') {
        stage = 'result';
        moreMessages = (await call('page:result', { ...context(command), outcome: 'rehearsed' })).moreMessages === true;
        return moreMessages;
      }
      if (control.stopped) throw new Error('原文档会话已结束');
      // The backend records the submission before replying. No delivery/read
      // receipt or second success report is needed to advance the queue.
      stage = 'commit';
      const result = await call('page:commit', context(command));
      moreMessages = result.committed === true && result.moreMessages === true;
    } catch (error) {
      // Keep drafts on rejection or interruption. An async identity snapshot
      // cannot safely authorize clearing a textarea reused by another chat.
      if (authorized) await call('page:result', { ...context(command), outcome: 'uncertain', ...failure(error, stage) }).catch(() => {});
      else await call('page:error', { ...context(command), ...failure(error, stage) }).catch(() => {});
    } finally {
      if (!moreMessages) control.prepared = null;
    }
    return moreMessages;
  }
  async function tick() {
    if (control.stopped) return;
    try {
      // Continue only while this recipient is ready. Each step still obtains
      // a fresh backend command; pause/cancel and per-recipient nextAt apply.
      // Bound one turn to preparation plus the supported ten-message maximum.
      for (let step = 0; step < 11 && !control.stopped; step++) {
        const { command } = await call('page:poll');
        if (command?.type === 'prepare') {
          if (await prepare(command)) continue;
        } else if (command?.type === 'send') {
          if (await executeSend(command)) continue;
        } else if (command?.type === 'collect') {
          await call('page:collect-step', { collectionId: command.collectionId, token: command.token });
        }
        break;
      }
    } catch (error) {
      // Losing the runtime or storage connection never means repeat a send.
      await call('page:error', failure(error, 'poll')).catch(() => {});
      control.stopped = true;
    }
    if (!control.stopped) setTimeout(tick, 1000);
  }
  addEventListener('pagehide', () => { control.stopped = true; });
  call('page:hello').then(() => { if (!control.stopped) setTimeout(tick, 1000); }).catch(error => {
    void call('page:error', failure(error, 'hello')).catch(() => {});
    control.stopped = true;
  });
})();
