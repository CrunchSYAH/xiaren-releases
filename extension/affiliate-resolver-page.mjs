// Self-contained, synchronous MAIN-world function. Never reads chat history,
// returns credentials, calls APIs, submits messages, or modifies business state.
export function affiliateResolverPage(expected = null, action = 'inspect') {
  const id = value => typeof value === 'string' && /^[1-9]\d{0,39}$/.test(value) ? value
    : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const fiberOf = node => {
    const key = Object.keys(node || {}).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? node[key] : null, root = fiber;
    while (root?.return) root = root.return;
    if (root?.stateNode?.current && root.stateNode.current !== root) fiber = fiber?.alternate || null;
    return fiber;
  };
  const propsAlong = (node, predicate, depth = 24) => {
    let fiber = fiberOf(node);
    for (let index = 0; fiber && index < depth; index++, fiber = fiber.return) if (fiber.memoizedProps && predicate(fiber.memoizedProps)) return fiber.memoizedProps;
    return null;
  };
  const draftOf = editor => {
    const mediaProps = propsAlong(editor, p => Array.isArray(p.drawerMedias));
    const replyProps = propsAlong(editor, p => Array.isArray(p.replyCardsList));
    const conversationProps = propsAlong(editor, p => !!p.currentConversation);
    return { draftEmpty: editor.value === '', mediaCount: mediaProps?.drawerMedias?.length ?? null,
      replyCount: replyProps ? replyProps.replyCardsList.length + (conversationProps?.replyToMessage ? 1 : 0) : null };
  };
  const result = { origin: location.origin, path: location.pathname, documentEpoch: performance.timeOrigin, shop: null,
    status: 'blocked', reason: 'unsupported-page', affiliate: null, chat: null, blocked: false };
  if (!['inspect', 'open-chat', 'install'].includes(action)) return result;
  if (action === 'install') {
    // Shared final-click code can call this synchronously in its own boundary;
    // navigation discards the installation and therefore requires reinjection.
    Object.defineProperty(window, '__creatorAffiliateResolverPage', { value: affiliateResolverPage, configurable: true });
    result.installed = true;
  }
  if (result.origin !== 'https://seller.shopee.co.id' || result.path !== '/portal/web-seller-affiliate/kol_marketplace/detail') return result;
  result.blocked = [...document.querySelectorAll('[class*=captcha],iframe[src*=captcha],[role=alert]')].some(node => visible(node)
    && /captcha|verification|verifikasi|too many|terlalu banyak|限制|验证/i.test(node.textContent || node.getAttribute('src') || node.className));
  let store;
  try { store = typeof window.__$unstable_useRootStoreOutside === 'function' ? window.__$unstable_useRootStoreOutside() : null; } catch { /* Unknown shop blocks resolution. */ }
  const shopId = id(store?.shopId);
  if (shopId && store.isLoggedIn !== false) result.shop = { id: shopId };
  const params = new URL(location.href).searchParams;
  const affiliateIds = params.getAll('affiliate_id');
  const affiliateId = affiliateIds.length === 1 ? id(affiliateIds[0]) : null;
  const cards = [...document.querySelectorAll('[class*=UserInfo---userinfo-card]')].filter(visible);
  const props = cards.length === 1 ? propsAlong(cards[0], p => !!p.detail?.profile && p.detailLoading === false, 8) : null;
  const profile = props?.detail?.profile;
  const shopeeUserId = id(profile?.shopeeUserId);
  result.reason = result.blocked ? 'page-blocked' : !result.shop ? 'shop-unavailable' : !affiliateId ? 'invalid-affiliate-query' : 'profile-unverified';
  const buttons = cards.length === 1 ? [...cards[0].querySelectorAll('button')].filter(button => visible(button)
    && [...button.querySelectorAll('use')].some(use => (use.getAttribute('xlink:href') || use.getAttribute('href')) === '#icon-chat-new')) : [];
  const button = buttons.length === 1 ? buttons[0] : null;
  const name = typeof profile?.displayName === 'string' && profile.displayName.trim() ? profile.displayName.trim() : profile?.username;
  if (!result.blocked && result.shop && affiliateId && affiliateId === id(profile?.affiliateId) && shopeeUserId
    && shopeeUserId === id(props?.shopeeUserId) && shopId === id(props?.shopId) && typeof name === 'string' && name.trim()
    && typeof profile.username === 'string' && profile.username.trim()) {
    result.affiliate = { affiliateId, shopeeUserId, name: name.trim().slice(0, 120), username: profile.username.trim().slice(0, 120),
      chatAvailable: !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' };
    result.status = 'verified'; result.reason = null;
  }
  const mountedEditors = [...document.querySelectorAll('#sidebar-minichat-list textarea')];
  const editors = mountedEditors.filter(visible);
  const editor = editors.length === 1 ? editors[0] : null;
  if (editor) {
    const identity = propsAlong(editor, p => id(p.buyerId) && id(p.shopId));
    const conversationProps = propsAlong(editor, p => !!p.currentConversation);
    const conversation = conversationProps?.currentConversation;
    const recipientId = id(identity?.buyerId), chatShopId = id(identity?.shopId);
    const agrees = !!recipientId && recipientId === id(conversation?.to_id) && !!chatShopId && chatShopId === id(conversation?.shop_id);
    result.chat = { recipientId: agrees ? recipientId : null, shopId: agrees ? chatShopId : null,
      editorFound: !editor.disabled && !editor.readOnly, ...draftOf(editor) };
  }
  const locked = expected && typeof expected.affiliateId === 'string' && typeof expected.shopeeUserId === 'string' && typeof expected.shopId === 'string'
    && id(expected.affiliateId) === affiliateId && id(expected.shopeeUserId) === shopeeUserId && id(expected.shopId) === result.shop?.id
    && typeof expected.documentEpoch === 'number' && Number.isFinite(expected.documentEpoch) && expected.documentEpoch > 0 && expected.documentEpoch === result.documentEpoch;
  if (expected && (!locked || result.status !== 'verified')) { result.status = 'blocked'; result.reason = 'locked-identity-changed'; }
  if (action === 'open-chat') {
    result.action = { performed: false };
    const draftSafe = editors.length <= 1 && mountedEditors.every(node => {
      const draft = draftOf(node);
      return draft.draftEmpty && draft.mediaCount === 0 && draft.replyCount === 0;
    });
    if (locked && result.status === 'verified' && result.affiliate.chatAvailable && draftSafe) { button.click(); result.action.performed = true; }
  }
  return result;
}
