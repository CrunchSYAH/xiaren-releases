import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { inspectPage } from '../extension/page-snapshot.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSj8AAAAASUVORK5CYII=', 'base64');
const image = { type: 'image', assetId: 'asset-local', sha256: createHash('sha256').update(png).digest('hex'), name: '本地替身.png', mime: 'image/png', size: png.length, width: 1, height: 1 };
const path = '/portal/web-seller-affiliate/kol_marketplace';
const fnv = (source, initial = 2166136261) => {
  let hash = initial;
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return hash >>> 0;
};

// These non-executable strings are generated entirely from local filler and
// FNV arithmetic. They exercise compatibility guards without retaining any
// platform function source, event handler, upload implementation or endpoint.
function localFingerprintString(length, target) {
  const prefix = 'LOCAL SYNTHETIC FIXTURE ONLY '.padEnd(length - 3, ' ');
  const initial = fnv(prefix), beforeLast = Math.imul(target, 899433627) >>> 0;
  for (let first = 0; first < 256; first++) {
    const next = Math.imul(initial ^ first, 16777619);
    for (let second = 0; second <= 65535; second++) {
      const afterSecond = Math.imul(next ^ second, 16777619) >>> 0;
      const last = (afterSecond ^ beforeLast) >>> 0;
      if (last <= 65535) return prefix + String.fromCharCode(first, second, last);
    }
  }
  throw new Error('无法构造本地指纹替身');
}
const uploaderText = localFingerprintString(1241, 0xb230b83e);
const senderText = localFingerprintString(1544, 0xf004a760);
const mediaOwnerText = localFingerprintString(134, 0x4339807d);

function fixture() {
  let clicks = 0, changes = 0;
  const store = { shopId: '10', shopName: '本地店铺' };
  const conversation = { to_id: '20', shop_id: '10' };
  const props = { buyerId: '20', shopId: '10', currentConversation: conversation };
  const mediaProps = { drawerMedias: [], replyCardsList: [] };
  function NativeSenderStandIn() {}
  NativeSenderStandIn.prototype.handleSendMessage = function localSender() {};
  NativeSenderStandIn.prototype.handleSendMessage.toString = () => senderText;
  function NativeUploaderStandIn() {}
  NativeUploaderStandIn.toString = () => uploaderText;
  function NativeMediaOwnerStandIn() {}
  NativeMediaOwnerStandIn.prototype.handleSelectMediaSucceed = function localMediaSuccess() {};
  NativeMediaOwnerStandIn.prototype.handleSelectMediaSucceed.toString = () => mediaOwnerText;
  const mediaOwner = { handleSelectMediaSucceed() {} };
  const ownerFiber = { type: NativeMediaOwnerStandIn, stateNode: mediaOwner };
  const mediaFiber = { memoizedProps: mediaProps, type: NativeSenderStandIn };
  const visible = () => [1];
  const editor = { value: '', getClientRects: visible, __reactFiber$local: { memoizedProps: props, return: mediaFiber } };
  const send = { getClientRects: visible, click() { clicks++; } };
  const uploaderProps = { type: 'image', onSuccess: mediaOwner.handleSelectMediaSucceed };
  const input = { accept: 'image/png,image/jpeg,image/jpg', disabled: false, files: [], getClientRects: visible,
    __reactFiber$local: { memoizedProps: uploaderProps, type: NativeUploaderStandIn, return: ownerFiber },
    dispatchEvent(event) {
      changes++;
      assert.equal(event.type, 'change'); assert.equal(event.bubbles, true);
      // This local preview simulates the observed onSuccess projection only.
      // No remote upload or real platform handler runs in this fixture.
      mediaProps.drawerMedias = [{ type: 'image', file: this.files[0], width: 1, height: 1 }];
      return true;
    },
  };
  const chatButton = { getClientRects: visible, getAttribute: () => null, querySelectorAll: selector => selector === 'use' ? [{ getAttribute: () => '#icon-chat-new' }] : [] };
  const record = { shopeeUserId: '20', affiliateId: '99', username: 'local_creator' };
  const row = { getClientRects: visible, getAttribute: key => key === 'data-row-key' ? '0_99' : null,
    querySelector: selector => selector === '.kol-card-item-name' ? { textContent: '本地达人' } : null,
    querySelectorAll: selector => selector === 'button' ? [chatButton] : [], __reactFiber$local: { memoizedProps: { data: record } } };
  const nodes = { editor, input, send, row, blocked: null };
  class LocalDataTransfer {
    constructor() { this.files = []; this.items = { add: file => { this.files.push(file); } }; }
  }
  class LocalEvent { constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles === true; } }
  const context = { window: { __$unstable_useRootStoreOutside: () => store }, location: { origin: 'https://seller.shopee.co.id', pathname: path }, performance: { timeOrigin: 123 }, File, DataTransfer: LocalDataTransfer, Event: LocalEvent, atob,
    getComputedStyle: () => ({ visibility: 'visible' }), document: {
      querySelectorAll: selector => selector === 'tr.kol-card-item[data-row-key]' ? [nodes.row] : selector === '#sidebar-minichat-list textarea' ? [nodes.editor] : selector === '#sidebar-minichat-list input[type=file]' ? [nodes.input] : selector.includes('captcha') && nodes.blocked ? [nodes.blocked] : [],
      querySelector: selector => selector.includes('plW8rzAMob') ? nodes.send : null,
    } };
  const run = (commit = null, listAction = null, text = '') => {
    context.commit = commit; context.listAction = listAction; context.expectedText = text;
    return vm.runInNewContext(`(${inspectPage.toString()})(expectedText, commit, listAction)`, context);
  };
  const firstRow = run().creators[0];
  const roster = { observed: [firstRow], creator: firstRow };
  const stage = { type: 'stage-image', taskId: 'task-local', messageIndex: 2, shopId: '10', itemId: '20', documentEpoch: 123, token: 'token-one', asset: image, dataUrl: `data:image/png;base64,${png.toString('base64')}`, roster };
  const commit = { shopId: '10', itemId: '20', documentEpoch: 123, marketplacePath: path, roster, image: { token: 'token-one', assetId: image.assetId, sha256: image.sha256 } };
  return { run, stage, commit, context, store, props, conversation, mediaProps, nodes, uploaderProps, mediaOwner, ownerFiber, mediaFiber, NativeSenderStandIn, NativeUploaderStandIn, NativeMediaOwnerStandIn, clicks: () => clicks, changes: () => changes };
}

test('图片兼容指纹使用本地生成的FNV替身，已支持状态不包含原站源码', () => {
  assert.equal(`${uploaderText.length}:${fnv(uploaderText).toString(16)}`, '1241:b230b83e');
  assert.equal(`${senderText.length}:${fnv(senderText).toString(16)}`, '1544:f004a760');
  assert.equal(`${mediaOwnerText.length}:${fnv(mediaOwnerText).toString(16)}`, '134:4339807d');
  assert.ok(uploaderText.startsWith('LOCAL SYNTHETIC FIXTURE ONLY'));
  assert.equal(fixture().run().chat.imageSupported, true);
});

test('stage只设置File并触发本地预览，不点击发送、不填写文字', async () => {
  const f = fixture(), result = f.run(null, f.stage);
  assert.equal(result.listAction.performed, true);
  assert.equal(f.changes(), 1); assert.equal(f.clicks(), 0);
  assert.equal(f.nodes.editor.value, '');
  const file = f.nodes.input.files[0];
  assert.ok(file instanceof File);
  assert.equal(file.name, image.name); assert.equal(file.type, image.mime); assert.equal(file.size, image.size);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  const snapshot = f.run();
  assert.equal(snapshot.chat.mediaCount, 1);
  assert.equal(snapshot.chat.imageDraft.ready, true);
  assert.equal(snapshot.chat.imageDraft.token, f.stage.token);
  assert.equal(snapshot.chat.imageDraft.taskId, f.stage.taskId);
  assert.equal(snapshot.chat.imageDraft.itemId, f.stage.itemId);
  assert.equal(snapshot.chat.imageDraft.messageIndex, f.stage.messageIndex);
});

test('上传回调必须仍绑定已观察的所属组件，任一指针或指纹改变均零事件零点击', () => {
  for (const change of [
    f => { f.mediaOwner.handleSelectMediaSucceed = function replacedOwner() {}; },
    f => { f.uploaderProps.onSuccess = function replacedCallback() {}; },
    f => { f.NativeMediaOwnerStandIn.prototype.handleSelectMediaSucceed.toString = () => mediaOwnerText + ' '; },
    f => { f.ownerFiber.stateNode = null; },
  ]) {
    const f = fixture(); change(f);
    assert.equal(f.run(null, f.stage).listAction.performed, false);
    assert.equal(f.changes(), 0); assert.equal(f.clicks(), 0);
  }
});

test('不兼容的原生上传或发送指纹、文件类型入口均拒绝stage', () => {
  for (const change of [f => { f.NativeUploaderStandIn.toString = () => uploaderText + ' '; }, f => { f.NativeSenderStandIn.prototype.handleSendMessage.toString = () => senderText + ' '; }, f => { f.nodes.input.accept = 'image/*'; }, f => { f.nodes.input.disabled = true; }, f => { delete f.uploaderProps.onSuccess; }]) {
    const f = fixture(); change(f);
    assert.equal(f.run(null, f.stage).listAction.performed, false);
    assert.equal(f.changes(), 0); assert.equal(f.clicks(), 0);
  }
});

test('已有附件、文字草稿或引用卡片时拒绝stage且保留用户内容', () => {
  for (const change of [f => { f.mediaProps.drawerMedias = [{ type: 'image', file: {} }]; }, f => { f.nodes.editor.value = '用户草稿'; }, f => { f.mediaProps.replyCardsList = [{}]; }, f => { f.props.replyToMessage = { id: 'old' }; }]) {
    const f = fixture(); change(f);
    const editor = f.nodes.editor.value, media = f.mediaProps.drawerMedias;
    assert.equal(f.run(null, f.stage).listAction.performed, false);
    assert.equal(f.nodes.editor.value, editor); assert.equal(f.mediaProps.drawerMedias, media);
    assert.equal(f.changes(), 0); assert.equal(f.clicks(), 0);
  }
});

test('stage复核店铺、收件人、文档、路由、名单和平台限制，任一改变都零设置零点击', () => {
  for (const change of [f => { f.store.shopId = '11'; }, f => { f.props.shopId = '11'; f.conversation.shop_id = '11'; }, f => { f.props.shopId = '11'; }, f => { f.props.buyerId = '21'; f.conversation.to_id = '21'; }, f => { f.context.performance.timeOrigin = 124; }, f => { f.context.location.pathname = '/other'; }, f => { f.stage.roster.observed[0].name = '换人'; }, f => { f.nodes.blocked = { getClientRects: () => [1], textContent: 'verification' }; }]) {
    const f = fixture(); change(f);
    assert.equal(f.run(null, f.stage).listAction.performed, false);
    assert.equal(f.changes(), 0); assert.equal(f.clicks(), 0);
  }
});

test('准备后的File必须是精确同一对象，尺寸、大小或MIME变化均不能提交', () => {
  for (const change of [
    f => { f.mediaProps.drawerMedias[0].file = new File([png], image.name, { type: image.mime }); },
    f => { f.mediaProps.drawerMedias[0].width++; }, f => { f.mediaProps.drawerMedias[0].height++; },
    f => { Object.defineProperty(f.mediaProps.drawerMedias[0].file, 'size', { value: image.size + 1 }); },
    f => { Object.defineProperty(f.mediaProps.drawerMedias[0].file, 'type', { value: 'image/jpeg' }); },
    f => { f.mediaProps.drawerMedias.push({ ...f.mediaProps.drawerMedias[0] }); },
  ]) {
    const f = fixture(); assert.equal(f.run(null, f.stage).listAction.performed, true); change(f);
    const result = f.run(f.commit);
    assert.equal(result.chat.imageDraft.ready, false);
    assert.equal(result.commit.clicked, false); assert.equal(f.clicks(), 0);
  }
});

test('准备后编辑器、输入控件、身份、文档或草稿改变，最终提交仍被阻止', () => {
  for (const change of [
    f => { f.nodes.editor = { ...f.nodes.editor }; }, f => { f.nodes.input = { ...f.nodes.input }; },
    f => { f.props.buyerId = '21'; f.conversation.to_id = '21'; }, f => { f.store.shopId = '11'; },
    f => { f.props.shopId = '11'; f.conversation.shop_id = '11'; }, f => { f.props.shopId = '11'; },
    f => { f.mediaOwner.handleSelectMediaSucceed = function replacedOwner() {}; },
    f => { f.uploaderProps.onSuccess = function replacedCallback() {}; },
    f => { f.context.performance.timeOrigin = 124; }, f => { f.nodes.editor.value = '后来输入的草稿'; },
    f => { f.mediaProps.replyCardsList = [{}]; }, f => { f.nodes.send.disabled = true; },
  ]) {
    const f = fixture(); assert.equal(f.run(null, f.stage).listAction.performed, true); change(f);
    assert.equal(f.run(f.commit).commit.clicked, false); assert.equal(f.clicks(), 0);
  }
});

test('授权token、资产ID或摘要不匹配时零点击，不接受其他图片授权', () => {
  for (const patch of [{ token: 'wrong' }, { assetId: 'other' }, { sha256: '0'.repeat(64) }]) {
    const f = fixture(); assert.equal(f.run(null, f.stage).listAction.performed, true);
    assert.equal(f.run({ ...f.commit, image: { ...f.commit.image, ...patch } }).commit.clicked, false);
    assert.equal(f.clicks(), 0);
  }
});

test('正常图片commit只触发一次点击且不把图片当文字提交', () => {
  const f = fixture(); assert.equal(f.run(null, f.stage).listAction.performed, true);
  assert.equal(f.run(f.commit).commit.clicked, true);
  assert.equal(f.clicks(), 1); assert.equal(f.changes(), 1);
  const mixed = fixture(); mixed.run(null, mixed.stage); mixed.nodes.editor.value = '不能混发';
  const textCommit = { ...mixed.commit }; delete textCommit.image;
  assert.equal(mixed.run(textCommit, null, '不能混发').commit.clicked, false);
  assert.equal(mixed.clicks(), 0);
});

test('暂停后可在原图片上换新token，但不重新设置File或覆盖原附件', () => {
  const f = fixture(); f.run(null, f.stage);
  const original = f.nodes.input.files[0];
  const adopted = f.run(null, { ...f.stage, adoptToken: 'token-one', token: 'token-two' });
  assert.equal(adopted.listAction.performed, true);
  assert.equal(f.changes(), 1); assert.equal(f.clicks(), 0);
  assert.equal(f.nodes.input.files[0], original);
  assert.equal(f.run(f.commit).commit.clicked, false);
  assert.equal(f.run({ ...f.commit, image: { ...f.commit.image, token: 'token-two' } }).commit.clicked, true);
  assert.equal(f.clicks(), 1);
});

test('同一图片token重复commit即使点击抛错或附件尚未清空也不能再次点击或adopt', () => {
  for (const throwsAfterClick of [false, true]) {
    const f = fixture(); f.run(null, f.stage);
    if (throwsAfterClick) {
      const click = f.nodes.send.click;
      f.nodes.send.click = () => { click(); throw new Error('local click failure'); };
      assert.throws(() => f.run(f.commit), /local click failure/);
    } else assert.equal(f.run(f.commit).commit.clicked, true);
    assert.equal(f.context.window.__creatorOutreachImageDraft.claimed, true);
    assert.equal(f.run(f.commit).commit.clicked, false);
    assert.equal(f.clicks(), 1);
    assert.equal(f.run(null, { ...f.stage, adoptToken: 'token-one', token: 'token-two' }).listAction.performed, false);
    assert.equal(f.changes(), 1);
  }
});
