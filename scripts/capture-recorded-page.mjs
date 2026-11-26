// This function runs entirely inside the original browser document. Raw DOM,
// identity values and message text never cross the browser boundary.
export function captureRecordedPage(observe, kind, policy) {
  if (location.origin !== 'https://seller.shopee.co.id' || location.pathname !== '/portal/web-seller-affiliate/kol_marketplace') throw new Error('只采集已核对的达人广场页面');
  const baseline = observe();
  if (!baseline.shop || !baseline.creators.length) throw new Error('店铺或达人页面尚未就绪，未保存快照');
  const rawStore = window.__$unstable_useRootStoreOutside();
  const rows = [...document.querySelectorAll('tr.kol-card-item[data-row-key]')];
  const selected = new Set(rows);
  for (const editor of document.querySelectorAll('#sidebar-minichat-list textarea')) selected.add(editor);
  for (const node of document.querySelectorAll('#sidebar-minichat-list #messagesContainer div')) selected.add(node);
  const rawBindings = [], rawMessages = new Set(), userValues = new Map(), shopValues = new Map(), affiliateValues = new Map(), messageValues = new Map();
  const nameByUser = new Map(baseline.creators.map((row, index) => [String(row.id), `样本达人${String(index + 1).padStart(2, '0')}`]));
  shopValues.set(String(rawStore.shopId), '700');
  baseline.creators.forEach((row, index) => userValues.set(String(row.id), String(201 + index)));
  const rawChain = fiber => {
    const chain = [];
    for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) chain.push(fiber.memoizedProps || {});
    return chain;
  };
  for (const node of selected) {
    const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    if (!key) continue;
    const fiber = node[key];
    let root = fiber;
    for (let depth = 0; root?.return && depth < 500; depth++) root = root.return;
    const primary = rawChain(fiber), alternate = rawChain(fiber?.alternate);
    rawBindings.push({ node, primary, alternate, active: root?.stateNode?.current ? root.stateNode.current === root ? 'primary' : 'alternate' : 'unknown' });
    for (const props of [...primary, ...alternate]) {
      if (props.currentUser?.id != null && !userValues.has(String(props.currentUser.id))) userValues.set(String(props.currentUser.id), String(7000 + userValues.size));
      for (const key of ['message', 'msg']) if (props[key] && typeof props[key] === 'object') rawMessages.add(props[key]);
      for (const key of ['latest_message_id', 'opposite_last_deliver_msg_id']) {
        const value = props.currentConversation?.[key];
        if (value != null && value !== '' && /^[1-9]\d*$/.test(String(value))) messageValues.set(String(value), '');
      }
    }
  }
  for (const message of rawMessages) for (const key of ['id', 'message_id']) if (message[key] != null && /^[1-9]\d*$/.test(String(message[key]))) messageValues.set(String(message[key]), '');
  [...messageValues.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0).forEach((value, index) => messageValues.set(value, String(1001 + index)));
  const mapped = (value, map, base) => {
    if (value === null || value === '' || value === 0 || value === '0' || value === undefined) return value;
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return value < 0 ? -1 : Number.MAX_SAFE_INTEGER + 2;
    if (!/^\d+$/.test(String(value))) return 'opaque-id-001';
    if (!map.has(String(value))) map.set(String(value), String(base + map.size));
    return typeof value === 'number' ? Number(map.get(String(value))) : map.get(String(value));
  };
  const user = value => mapped(value, userValues, 8000), shop = value => mapped(value, shopValues, 700), affiliate = value => mapped(value, affiliateValues, 101), messageId = value => mapped(value, messageValues, 1001);
  const messageText = new Map();
  for (const message of rawMessages) {
    const text = typeof message.content === 'string' ? message.content : message.content?.text;
    if (typeof text === 'string' && text && !messageText.has(text)) messageText.set(text, `脱敏消息 ${messageText.size + 1}`);
  }
  const publicText = new Set(policy.publicText);
  const cleanText = value => {
    if (!value.trim()) return value;
    if (publicText.has(value.trim())) return value;
    if (messageText.has(value)) return messageText.get(value);
    return '样本内容';
  };
  const pick = (value, keys, transform) => {
    const result = {};
    for (const key of keys) if (Object.hasOwn(value, key) && value[key] !== undefined) result[key] = transform(key, value[key]);
    return result;
  };
  const record = value => pick(value, policy.schemas.record, (key, field) => key === 'shopeeUserId' ? user(field) : key === 'affiliateId' ? affiliate(field) : key === 'username' ? field ? `sample_user_${user(value.shopeeUserId)}` : field : field ? nameByUser.get(String(value.shopeeUserId)) || '样本达人' : field);
  const conversation = value => pick(value, policy.schemas.conversation, (key, field) => key === 'to_id' ? user(field) : key === 'shop_id' ? shop(field) : key === 'id' ? mapped(field, new Map(), 900) : messageId(field));
  const message = value => pick(value, policy.schemas.message, (key, field) => {
    if (key === 'content') return typeof field === 'string' ? messageText.get(field) || '' : field && typeof field === 'object' ? pick(field, ['text'], (_, text) => messageText.get(text) || '') : null;
    if (key === 'status') return typeof field === 'number' || typeof field === 'boolean' || field === null ? field : /^(?:failed|error|sending|pending|sent|success|delivered|read|\d+)$/i.test(String(field)) ? String(field) : 'redacted-status';
    return key === 'from_shop_id' ? shop(field) : ['from_id', 'to_id'].includes(key) ? user(field) : messageId(field);
  });
  const project = props => pick(props, policy.schemas.props, (key, value) => {
    if (value == null) return value;
    if (key === 'buyerId') return user(value);
    if (key === 'shopId') return shop(value);
    if (typeof value !== 'object') return null;
    if (key === 'data' || key === 'record') return record(value);
    if (key === 'currentConversation') return conversation(value);
    if (key === 'currentUser') return pick(value, ['id'], (_, field) => user(field));
    return message(value);
  });
  const rowNames = new Map();
  rows.forEach(row => {
    const raw = rawBindings.find(binding => binding.node === row);
    const props = [...(raw?.primary || []), ...(raw?.alternate || [])].find(props => props.data?.shopeeUserId || props.record?.shopeeUserId);
    const data = props?.data?.shopeeUserId ? props.data : props?.record;
    if (!data) return;
    const name = row.querySelector('.kol-card-item-name');
    if (name) rowNames.set(name, nameByUser.get(String(data.shopeeUserId)) || '样本达人');
    const username = row.querySelector('.kol-card-item-username');
    if (username) rowNames.set(username, `sample_user_${user(data.shopeeUserId)}`);
    affiliate(data.affiliateId);
  });
  const header = document.querySelector('#sidebar-minichat-list .lyWL3rDmij');
  if (header) rowNames.set(header, nameByUser.get(String(baseline.chat?.recipientId)) || '样本会话');
  const rowKey = value => {
    const match = /^(\d+)_(\d+)$/.exec(value || '');
    return match ? `${match[1]}_${affiliate(match[2])}` : 'redacted-row';
  };
  const styleValues = [], styleIndex = new Map(), keysByNode = new Map();
  const statistics = { elements: 0, textNodesMasked: 0, activeElementsRemoved: 0, unsupportedElementsReplaced: 0, originalMessageTextsRemoved: messageText.size };
  const drop = new Set(['script', 'style', 'link', 'iframe', 'object', 'embed', 'noscript', 'meta', 'base']);
  const allowed = new Set(policy.tags), attrs = new Set(policy.attributes);
  const build = (node, replacement = null) => {
    if (node.nodeType === 3) {
      statistics.textNodesMasked++;
      if (replacement && (node.nodeValue || '').trim()) {
        const text = replacement.used ? '' : replacement.text; replacement.used = true; return { text };
      }
      return { text: cleanText(node.nodeValue || '') };
    }
    if (node.nodeType !== 1 || drop.has(node.localName)) { if (node.nodeType === 1) statistics.activeElementsRemoved++; return null; }
    let tag = node.localName;
    if (!allowed.has(tag)) { tag = 'div'; statistics.unsupportedElementsReplaced++; }
    const key = `n${statistics.elements++}`; keysByNode.set(node, key);
    const projectedAttrs = {};
    for (const attr of node.attributes) {
      if (!attrs.has(attr.name)) continue;
      let value = attr.value;
      if (attr.name === 'data-row-key') value = rowKey(value);
      else if (attr.name === 'id') value = value.replace(/\d{6,}/g, '000000');
      else if (attr.name === 'type' && tag === 'button') value = 'button';
      const resource = /url\s*\(/i.test(value) && !new RegExp(policy.localPaintPattern, 'i').test(value);
      if (!resource && !/\/\/|https?:|javascript:|data:|bearer\s|(?:sk|pk)_[a-z]|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(value)) projectedAttrs[attr.name] = value;
    }
    if (tag === 'use') {
      const href = node.getAttribute('href') || node.getAttribute('xlink:href');
      if (/^#[a-zA-Z][\w-]*$/.test(href || '')) projectedAttrs.href = href;
    }
    for (const [property, attr] of [['disabled', 'disabled'], ['readOnly', 'readonly'], ['checked', 'checked']]) if (node[property] === true) projectedAttrs[attr] = '';
    const computed = getComputedStyle(node);
    const css = policy.styles.map(property => [property, computed.getPropertyValue(property)]).filter(([, value]) => value && !/url\s*\(|@import|expression\s*\(|https?:/i.test(value)).map(([property, value]) => `${property}:${value}`).join(';');
    if (!styleIndex.has(css)) { styleIndex.set(css, styleValues.length); styleValues.push(css); }
    const ownName = rowNames.has(node) ? { text: rowNames.get(node), used: false } : replacement;
    const children = [...node.childNodes].map(child => build(child, ownName)).filter(Boolean);
    return { key, tag, ns: node.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : 'html', attrs: projectedAttrs, style: styleIndex.get(css), children, ...(tag === 'textarea' && node.value ? { draftPresent: true } : {}) };
  };
  const tree = build(document.body);
  const bindings = rawBindings.filter(binding => keysByNode.has(binding.node)).map(binding => ({ nodeKey: keysByNode.get(binding.node), fiber: { primary: binding.primary.map(project), alternate: binding.alternate.map(project), active: binding.active } }));
  const normalize = snapshot => ({
    shop: snapshot.shop ? { id: String(shop(snapshot.shop.id)), name: String(store.shopName || store.username || '') } : null,
    creators: snapshot.creators.map(creator => ({ id: String(user(creator.id)), name: nameByUser.get(String(creator.id)) || '样本达人', username: creator.username ? `sample_user_${user(creator.id)}` : '', rowKey: rowKey(creator.rowKey), chatAvailable: creator.chatAvailable })),
    blocked: snapshot.blocked,
    chat: snapshot.chat ? { ...pick(snapshot.chat, ['editorFound', 'sendFound', 'sendReady', 'evidenceSupported'], (_, value) => value), shopId: snapshot.chat.shopId ? String(shop(snapshot.chat.shopId)) : null, recipientId: snapshot.chat.recipientId ? String(user(snapshot.chat.recipientId)) : null, headerText: nameByUser.get(String(snapshot.chat.recipientId)) || '样本会话', editorText: snapshot.chat.editorText ? '[脱敏草稿]' : '', latestMessageId: snapshot.chat.latestMessageId === null ? null : String(messageId(snapshot.chat.latestMessageId)), messages: snapshot.chat.messages.map(item => ({ id: String(messageId(item.id)), confirmed: item.confirmed, failed: item.failed })) } : null,
  });
  const store = pick(rawStore, policy.schemas.store, (key, value) => key === 'shopId' ? shop(value) : key === 'isLoggedIn' ? value === true : typeof value === 'string' && value.trim() ? key === 'username' ? 'sample_shop' : '样本店铺' : value == null ? value : '');
  return {
    version: 1, source: { origin: location.origin, path: location.pathname }, capturedAt: new Date().toISOString(), kind,
    viewport: { width: innerWidth, height: innerHeight }, store, styles: styleValues, tree, bindings,
    observed: normalize(baseline), messageChecks: [...messageText.entries()].slice(0, 8).map(([text, replacement]) => ({ text: replacement, observed: normalize(observe(text)) })), statistics,
  };
}
