export function validatePage(snapshot) {
  if (snapshot?.origin !== 'https://seller.shopee.co.id') throw new Error('只支持印尼 Shopee 卖家页面');
  if (!snapshot.shop?.id || !snapshot.shop?.name) throw new Error('无法核对店铺身份，请先在专用页面登录');
  if (snapshot.blocked) throw new Error('页面出现验证或操作限制，请人工处理后重新准备名单');
  return snapshot;
}

export function validateChat(snapshot, creator, shopId, expectedText) {
  validatePage(snapshot);
  const chat = snapshot.chat;
  if (snapshot.shop.id !== shopId || chat?.shopId !== shopId) throw new Error('店铺已变化，任务已暂停');
  if (chat?.recipientId !== creator.id) throw new Error('聊天收件人不符，任务已暂停');
  if (!chat.editorFound || !chat.sendFound) throw new Error('聊天控件无法识别，请检查页面版本');
  if (chat.mediaCount || chat.replyCount) throw new Error('当前聊天已有附件或回复内容，请人工处理后再继续');
  if (expectedText === undefined && chat.editorText) throw new Error('当前聊天已有草稿，请人工处理后再继续');
  if (expectedText !== undefined && chat.editorText !== expectedText) throw new Error('消息文本与预览不符，已阻止发送');
  if (expectedText !== undefined && !chat.sendReady) throw new Error('发送控件尚不可用，已阻止发送');
  return chat;
}

export function validateImageChat(snapshot, creator, shopId, image, draft = null, empty = false) {
  validatePage(snapshot);
  const chat = snapshot.chat;
  if (snapshot.shop.id !== shopId || chat?.shopId !== shopId || chat?.recipientId !== creator?.id) throw new Error('图片聊天身份已变化，已阻止发送');
  if (!chat.editorFound || !chat.sendFound || !chat.imageSupported) throw new Error('图片上传结构尚未支持或已变化，已阻止操作');
  if (chat.editorText || chat.replyCount) throw new Error('当前聊天已有草稿或回复内容，请人工处理后再继续');
  if (empty) {
    if (chat.mediaCount !== 0) throw new Error('当前聊天已有附件，请人工处理后再继续');
  } else if (!chat.sendReady || chat.mediaCount !== 1 || !draft?.token || draft.assetId !== image.assetId || draft.sha256 !== image.sha256
      || !chat.imageDraft?.ready || chat.imageDraft.token !== draft.token || chat.imageDraft.assetId !== image.assetId || chat.imageDraft.sha256 !== image.sha256) throw new Error('图片预览与本次消息不符或尚未就绪，已阻止发送');
  return chat;
}
