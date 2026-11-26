import assert from 'node:assert/strict';
import { tags, attributes, schemas, publicText, localPaintPattern } from '../tests/fixtures/recorded/policy.mjs';

const cleanText = (value, label = '记录') => {
  assert.equal(typeof value, 'string');
  assert.ok(!/https?:|javascript:|data:|bearer\s|(?:sk|pk)_[a-z]|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(value), `${label}包含未脱敏文本或地址`);
};
function keys(value, allowed, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} 无效`);
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label} 含非白名单字段 ${key}`);
}
function projected(value, schema) {
  keys(value, schemas[schema], schema);
  for (const [key, field] of Object.entries(value)) {
    if (field === null || typeof field === 'boolean' || typeof field === 'number') continue;
    if (typeof field === 'string') {
      cleanText(field);
      if (['shopName', 'displayName'].includes(key)) assert.ok(!field.trim() || /^样本(?:店铺|达人)/.test(field));
      else if (key === 'username') assert.ok(!field || /^sample_(?:shop|user_\d+)$/.test(field));
      else if (key === 'text' || key === 'content') assert.ok(!field || /^脱敏消息 \d+$/.test(field));
      else if (key === 'status') assert.match(field, /^(?:failed|error|sending|pending|sent|success|delivered|read|redacted-status|\d+)$/i);
      else assert.ok(!field || /^(?:\d+|opaque-id-\d+)$/.test(field));
      continue;
    }
    const nested = { data: 'record', record: 'record', currentConversation: 'conversation', currentUser: 'user', message: 'message', msg: 'message', content: 'content' }[key];
    assert.ok(nested, `非白名单对象 ${key}`); projected(field, nested);
  }
}

export function validateRecordedSample(sample) {
  keys(sample, ['version', 'source', 'capturedAt', 'kind', 'viewport', 'store', 'styles', 'tree', 'bindings', 'observed', 'messageChecks', 'statistics'], '样本');
  assert.equal(sample?.version, 1);
  assert.equal(sample.source?.origin, 'https://seller.shopee.co.id');
  keys(sample.source, ['origin', 'path'], '来源');
  assert.equal(sample.source.path, '/portal/web-seller-affiliate/kol_marketplace');
  assert.ok(Number.isFinite(Date.parse(sample.capturedAt)));
  assert.ok(sample.styles.length < 30000 && sample.bindings.length < 10000);
  for (const style of sample.styles) { cleanText(style); assert.ok(!/url\s*\(|@import|expression\s*\(/i.test(style)); }
  const found = new Set();
  function visit(node) {
    if (Object.hasOwn(node, 'text')) {
      keys(node, ['text'], '文本节点'); cleanText(node.text);
      assert.ok(!node.text.trim() || publicText.includes(node.text.trim()) || /^(?:样本(?:内容|达人\d*|会话)|sample_user_\d+|脱敏消息 \d+)$/.test(node.text), '非脱敏文本'); return;
    }
    keys(node, ['key', 'tag', 'ns', 'attrs', 'style', 'children', 'draftPresent'], '节点');
    assert.ok(tags.includes(node.tag), `禁止标签 ${node.tag}`);
    assert.ok(/^n\d+$/.test(node.key) && !found.has(node.key)); found.add(node.key);
    assert.ok(Number.isInteger(node.style) && node.style >= 0 && node.style < sample.styles.length);
    for (const [key, value] of Object.entries(node.attrs)) {
      assert.ok(attributes.includes(key) || key === 'href', `禁止属性 ${key}`);
      cleanText(value, `属性 ${key} `);
      assert.ok(!value.includes('//'), '属性包含外部资源地址');
      if (/url\s*\(/i.test(value)) assert.match(value, new RegExp(localPaintPattern, 'i'), '属性只能引用本地片段');
      if (key === 'href') assert.match(value, /^#[a-zA-Z][\w-]*$/);
    }
    for (const child of node.children) visit(child);
  }
  visit(sample.tree); projected(sample.store, 'store');
  for (const binding of sample.bindings) {
    assert.ok(found.has(binding.nodeKey), '状态绑定未找到原始节点');
    assert.ok(['primary', 'alternate', 'unknown'].includes(binding.fiber.active));
    for (const chain of [binding.fiber.primary, binding.fiber.alternate]) {
      assert.ok(chain.length <= 64);
      for (const props of chain) projected(props, 'props');
    }
  }
  const observation = value => {
    keys(value, ['shop', 'creators', 'blocked', 'chat'], '页面观察');
    const identifier = id => assert.ok(id === null || (typeof id === 'string' && /^\d+$/.test(id)), '非脱敏身份');
    if (value.shop) { keys(value.shop, ['id', 'name'], '店铺观察'); identifier(value.shop.id); assert.match(value.shop.name, /^(?:样本店铺.*|sample_shop)$/); }
    for (const creator of value.creators) {
      keys(creator, ['id', 'name', 'username', 'rowKey', 'chatAvailable'], '达人观察');
      identifier(creator.id); assert.match(creator.name, /^样本达人\d*$/); assert.match(creator.username, /^(?:sample_user_\d+)?$/); assert.match(creator.rowKey, /^\d+_\d+$|^redacted-row$/);
    }
    if (value.chat) {
      keys(value.chat, ['editorFound', 'sendFound', 'sendReady', 'evidenceSupported', 'shopId', 'recipientId', 'headerText', 'editorText', 'latestMessageId', 'messages'], '聊天观察');
      identifier(value.chat.shopId); identifier(value.chat.recipientId); identifier(value.chat.latestMessageId);
      assert.match(value.chat.headerText, /^样本(?:达人\d*|会话)$/); assert.ok(['', '[脱敏草稿]'].includes(value.chat.editorText));
      for (const message of value.chat.messages) { keys(message, ['id', 'confirmed', 'failed'], '消息观察'); identifier(message.id); }
    }
  };
  observation(sample.observed);
  for (const check of sample.messageChecks) { keys(check, ['text', 'observed'], '消息对照'); assert.match(check.text, /^脱敏消息 \d+$/); observation(check.observed); }
  return sample;
}
