// Runs synchronously in the Shopee MAIN world. A persisted single-use claim is
// required before the backend supplies commit; identity checks and click share
// this execution boundary. Only whitelisted evidence leaves the page.
export function inspectPage(expectedText = '', commit = null, listAction = null) {
  const id = value => (typeof value === 'string' && /^\d+$/.test(value) && value !== '0') || (Number.isSafeInteger(value) && value > 0) ? String(value) : null;
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
    for (let index = 0; fiber && index < depth; index++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && predicate(props)) return props;
    }
    return null;
  };
  const componentAlong = (node, predicate) => {
    let fiber = fiberOf(node);
    for (let index = 0; fiber && index < 24; index++, fiber = fiber.return) if (predicate(fiber)) return fiber;
    return null;
  };
  const codeSignature = source => {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `${source.length}:${(hash >>> 0).toString(16)}`;
  };
  let shop = null;
  try {
    const store = typeof window.__$unstable_useRootStoreOutside === 'function' ? window.__$unstable_useRootStoreOutside() : null;
    const shopId = id(store?.shopId);
    const name = store?.shopName || store?.username;
    if (shopId && typeof name === 'string' && name.trim() && store.isLoggedIn !== false) shop = { id: shopId, name: name.trim().slice(0, 120) };
  } catch { /* Missing or changed store means unknown identity, never a guess. */ }
  const leaderboard = location.pathname === '/portal/web-seller-affiliate/affiliate_leaderboard';
  const affiliateDetail = location.pathname === '/portal/web-seller-affiliate/kol_marketplace/detail';
  const creators = [], rowNodes = new Map();
  const renderedRows = [...document.querySelectorAll(leaderboard ? 'tr[class*=AffiliateLeaderboard-List---viewDetailRow][data-row-key]' : 'tr.kol-card-item[data-row-key]')];
  for (const row of renderedRows) {
    if (!visible(row) || creators.length >= 5000) continue;
    const props = propsAlong(row, props => leaderboard ? !!props.record?.affiliateUserId : !!(props.data?.shopeeUserId || props.record?.shopeeUserId), 6);
    const record = props?.data?.shopeeUserId ? props.data : props?.record;
    const creatorId = id(leaderboard ? record?.affiliateUserId : record?.shopeeUserId), affiliateId = id(record?.affiliateId);
    const rowKey = row.getAttribute('data-row-key');
    const name = row.querySelector(leaderboard ? '[class*=AffiliateLeaderboard-List---name--]' : '.kol-card-item-name')?.textContent?.trim();
    if (!creatorId || !affiliateId || (leaderboard ? rowKey !== affiliateId || name !== record.displayName?.trim() : !/^\d+_\d+$/.test(rowKey || '') || rowKey.split('_').at(-1) !== affiliateId) || !name) continue;
    const chatButton = leaderboard ? [...row.querySelectorAll('a')].find(link => link.textContent.trim() === 'Chat' && !link.getAttribute('href'))
      : [...row.querySelectorAll('button')].find(button => [...button.querySelectorAll('use')].some(use => (use.getAttribute('xlink:href') || use.getAttribute('href')) === '#icon-chat-new'));
    creators.push({ id: creatorId, name: name.slice(0, 120), username: String(record.username || '').slice(0, 120), rowKey, chatAvailable: visible(chatButton) && !chatButton.disabled && chatButton.getAttribute('aria-disabled') !== 'true' });
    if (!rowNodes.has(creatorId)) rowNodes.set(creatorId, { row, chatButton });
  }
  // Read only observed component flags. Never call loadMore/fetchMore or use
  // cached component records as recipients: every recipient comes from a row.
  const layout = document.querySelector('.kol-card-layout-global');
  const listProps = propsAlong(layout, props => Array.isArray(props.list) && typeof props.hasMore === 'boolean' && typeof props.loading === 'boolean');
  const list = { supported: !!listProps, hasMore: listProps?.hasMore ?? null, loading: listProps?.loading ?? false, renderedCount: renderedRows.length, truncated: renderedRows.length > 5000,
    signature: JSON.stringify(creators.map(({ id, name, rowKey, chatAvailable }) => [id, name, rowKey, chatAvailable])) };
  if (leaderboard) {
    const tabs = propsAlong(document.querySelector('[class*=AffiliateLeaderboard---tabs]'), p => typeof p.activeKey === 'string');
    const category = propsAlong(document.querySelector('.categorySelectorChip'), p => typeof p.value === 'string' && /^\d+$/.test(p.value) && typeof p.onChange === 'function');
    const channel = propsAlong(document.querySelector('[class*=AffiliateLeaderboard---filterWrapper]')?.lastElementChild, p => Number.isInteger(p.value) && Array.isArray(p.channels));
    const dates = propsAlong(document.querySelector('[class*=AffiliateLeaderboard---datePeriod]'), p => Array.isArray(p.dateRange) && typeof p.checkedPanelType === 'string');
    const paging = propsAlong(document.querySelector('.aff-pagination'), p => Number.isInteger(p.current) && Number.isInteger(p.total) && Number.isInteger(p.pageSize));
    const table = propsAlong(document.querySelector('.eds-react-table'), p => Array.isArray(p.dataSource) && Number.isInteger(p.pageNum));
    const spin = propsAlong(document.querySelector('[class*=affiliate-spin]'), p => typeof p.spinning === 'boolean');
    let range = null;
    try { range = dates?.dateRange.map(date => Date.prototype.getTime.call(date?._d)); } catch { /* Unknown date contract is unsupported. */ }
    const contextSupported = !!tabs && ['1', '2', '3'].includes(tabs.activeKey) && (!!category || (tabs.activeKey === '3' && !document.querySelector('.categorySelectorChip')))
      && !!channel && !!dates && ['week', 'month'].includes(dates.checkedPanelType) && range?.length === 2 && range.every(Number.isFinite)
      && !!paging && paging.pageSize === 20 && paging.current >= 1 && paging.total >= 0 && paging.total <= 200;
    const supported = contextSupported && !!spin && !!table && table.pageNum === paging.current && table.pageSize === paging.pageSize && table.total === paging.total
      && table.dataSource.length === renderedRows.length && creators.length === renderedRows.length
      && table.dataSource.every((record, index) => id(record?.affiliateId) === creators[index]?.rowKey && id(record?.affiliateUserId) === creators[index]?.id);
    const context = contextSupported ? JSON.stringify({ tab: tabs.activeKey, category: category?.value ?? null, channel: channel.value, period: dates.checkedPanelType, range, pageSize: paging.pageSize, total: paging.total }) : null;
    Object.assign(list, { supported, loading: spin?.spinning ?? true, hasMore: paging ? paging.current * paging.pageSize < paging.total : null,
      pagination: { page: paging?.current ?? null, pageSize: paging?.pageSize ?? null, total: paging?.total ?? null, context } });
  }
  // A viewport anchor is evidence only when a hit-test proves that some part of
  // this mounted row is visible. Rows above the viewport remain in the roster.
  list.startId = null;
  if (typeof document.elementFromPoint === 'function' && Number.isFinite(window.innerHeight) && Number.isFinite(window.innerWidth)) {
    for (const creator of creators) {
      const row = rowNodes.get(creator.id)?.row, rect = row?.getBoundingClientRect?.();
      if (!rect || typeof row.contains !== 'function') continue;
      const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
      const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
      if (!(bottom > top && right > left)) continue;
      const x = (left + right) / 2;
      if ([top + Math.min(1, (bottom - top) / 2), (top + bottom) / 2, bottom - Math.min(1, (bottom - top) / 2)].some(y => row.contains(document.elementFromPoint(x, y)))) { list.startId = creator.id; break; }
    }
  }
  list.filterContext = null;
  try {
    const filters = typeof window.__creatorOutreachFilters === 'function' ? window.__creatorOutreachFilters() : null;
    if (filters && !filters.error && filters.path === location.pathname && filters.documentEpoch === performance.timeOrigin && typeof filters.filterContext === 'string') list.filterContext = filters.filterContext;
  } catch { /* A missing or changed filter reader cannot match a locked filter. */ }
  let affiliateEvidence = null;
  if (affiliateDetail) {
    try { if (typeof window.__creatorAffiliateResolverPage === 'function') affiliateEvidence = window.__creatorAffiliateResolverPage(); } catch { /* Missing or changed resolver blocks this source. */ }
    creators.length = 0;
    if (affiliateEvidence?.status === 'verified' && affiliateEvidence.shop?.id === shop?.id) {
      const record = affiliateEvidence.affiliate;
      creators.push({ id: record.shopeeUserId, name: record.name, username: record.username, rowKey: record.affiliateId, affiliateId: record.affiliateId, chatAvailable: record.chatAvailable });
    }
    Object.assign(list, { supported: creators.length === 1, loading: affiliateEvidence?.reason === 'profile-unverified', hasMore: false, renderedCount: creators.length });
  }
  const editor = [...document.querySelectorAll('#sidebar-minichat-list textarea')].find(visible);
  let chat = null, activeSend = null, imageInput = null, mediaProps = null, imageContract = false;
  if (editor) {
    const identity = propsAlong(editor, props => id(props.buyerId) && id(props.shopId));
    const conversationProps = propsAlong(editor, props => !!props.currentConversation);
    const conversation = conversationProps?.currentConversation;
    const mediaComponent = componentAlong(editor, fiber => Array.isArray(fiber.memoizedProps?.drawerMedias) && typeof fiber.type?.prototype?.handleSendMessage === 'function');
    mediaProps = mediaComponent?.memoizedProps;
    imageInput = [...document.querySelectorAll('#sidebar-minichat-list input[type=file]')].find(input => input.accept === 'image/png,image/jpeg,image/jpg' && !input.disabled);
    const uploader = imageInput && componentAlong(imageInput, fiber => fiber.memoizedProps?.type === 'image' && typeof fiber.memoizedProps?.onSuccess === 'function' && typeof fiber.type === 'function');
    const mediaOwner = imageInput && componentAlong(imageInput, fiber => typeof fiber.type?.prototype?.handleSelectMediaSucceed === 'function' && !!fiber.stateNode);
    // Only the observed local-preview contract may prepare images. These are
    // compatibility fingerprints, not executable copies of site source.
    imageContract = !!uploader && !!mediaOwner && !!mediaComponent && codeSignature(uploader.type.toString()) === '1241:b230b83e'
      && uploader.memoizedProps.onSuccess === mediaOwner.stateNode.handleSelectMediaSucceed
      && codeSignature(mediaOwner.type.prototype.handleSelectMediaSucceed.toString()) === '134:4339807d'
      && codeSignature(mediaComponent.type.prototype.handleSendMessage.toString()) === '1544:f004a760';
    const recipientId = id(identity?.buyerId), shopId = id(identity?.shopId);
    const conversationMatches = !!recipientId && recipientId === id(conversation?.to_id) && !!shopId && shopId === id(conversation?.shop_id);
    const send = document.querySelector('#sidebar-minichat-list .pqq6o4R57Y .plW8rzAMob');
    activeSend = send;
    const header = document.querySelector('#sidebar-minichat-list .lyWL3rDmij');
    chat = {
      shopId: conversationMatches ? shopId : null,
      recipientId: conversationMatches ? recipientId : null,
      headerText: header?.textContent?.trim()?.slice(0, 120) || '',
      editorFound: visible(editor) && !editor.disabled && !editor.readOnly,
      sendFound: visible(send),
      sendReady: visible(send) && !send.disabled && send.getAttribute?.('aria-disabled') !== 'true',
      editorText: editor.value,
      mediaCount: mediaProps?.drawerMedias?.length ?? null,
      replyCount: (mediaProps?.replyCardsList?.length || 0) + (conversationProps?.replyToMessage ? 1 : 0),
      imageSupported: imageContract && !imageInput.disabled,
    };
    const staged = window.__creatorOutreachImageDraft;
    if (staged) {
      const media = mediaProps?.drawerMedias?.[0];
      chat.imageDraft = { token: staged.token, assetId: staged.assetId, sha256: staged.sha256, taskId: staged.taskId, itemId: staged.itemId, messageIndex: staged.messageIndex,
        ready: imageContract && !staged.claimed && staged.editor === editor && staged.input === imageInput && staged.documentEpoch === performance.timeOrigin
          && staged.shopId === shopId && staged.itemId === recipientId && mediaProps.drawerMedias.length === 1 && media?.type === 'image'
          && media.file === staged.file && media.width === staged.width && media.height === staged.height
          && media.file.size === staged.size && media.file.type === staged.mime };
    }
  }
  const blocked = [...document.querySelectorAll('[class*=captcha],iframe[src*=captcha],[role=alert]')].some(node => visible(node) && (/captcha|verification|verifikasi|too many|terlalu banyak|限制|验证/i.test(node.textContent || node.getAttribute('src') || node.className)));
  const result = { origin: location.origin, path: location.pathname, documentEpoch: performance.timeOrigin, shop, creators, chat, blocked, list, ...(affiliateDetail ? { affiliateEvidence } : {}) };
  const sameRow = (actual, expected) => !!actual && !!expected && actual.id === expected.id && actual.name === expected.name && actual.rowKey === expected.rowKey && actual.chatAvailable === expected.chatAvailable;
  const safePage = roster => leaderboard && list.supported && !list.loading && roster?.page === list.pagination.page && roster?.context === list.pagination.context
    && Array.isArray(roster.observed) && roster.observed.length === creators.length && roster.observed.every((row, index) => sameRow(creators[index], row));
  const safeRoster = (roster, itemId) => {
    const anchor = roster?.observed, target = roster?.creator;
    if (roster?.filterContext !== undefined && roster.filterContext !== null && (typeof roster.filterContext !== 'string' || roster.filterContext !== list.filterContext)) return false;
    if (affiliateDetail) {
      try {
        const expected = roster?.affiliate;
        if (!expected || target?.id !== itemId || expected.shopeeUserId !== itemId || expected.affiliateId !== target.affiliateId || expected.shopId !== shop?.id || expected.documentEpoch !== result.documentEpoch || typeof window.__creatorAffiliateResolverPage !== 'function') return false;
        const checked = window.__creatorAffiliateResolverPage(expected);
        return checked.status === 'verified' && checked.affiliate?.chatAvailable === true && checked.affiliate.name === target.name && checked.affiliate.affiliateId === expected.affiliateId
          && checked.affiliate.shopeeUserId === itemId && checked.chat?.recipientId === itemId && checked.chat.shopId === expected.shopId && checked.chat.editorFound;
      } catch { return false; }
    }
    if (leaderboard && !safePage(roster)) return false;
    return Array.isArray(anchor) && anchor.length > 0 && anchor.length <= creators.length && anchor.every((row, index) => sameRow(creators[index], row))
      && target?.id === itemId && target.chatAvailable === true && anchor.some(row => sameRow(row, target)) && creators.some(row => sameRow(row, target));
  };
  if (listAction) {
    result.listAction = { performed: false };
    const bound = result.origin === 'https://seller.shopee.co.id' && (leaderboard || affiliateDetail ? listAction.path === result.path : result.path === '/portal/web-seller-affiliate/kol_marketplace') && !blocked && shop?.id === listAction.shopId && result.documentEpoch === listAction.documentEpoch;
    if (bound && listAction.type === 'load-more' && list.supported && list.hasMore && !list.loading && list.signature === listAction.signature) {
      const loader = document.querySelector('.kol-loading-more');
      if (visible(loader)) { loader.scrollIntoView({ block: 'end', behavior: 'instant' }); result.listAction.performed = true; }
    }
    if (bound && listAction.type === 'turn-page' && safePage(listAction.roster) && Math.abs(listAction.targetPage - list.pagination.page) === 1) {
      const direction = listAction.targetPage > list.pagination.page ? 'next' : 'prev';
      const button = document.querySelector(`.aff-pagination .eds-react-pagination-pager__button-${direction}`);
      if (visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') { button.click(); result.listAction.performed = true; }
    }
    const leaderboardDraftSafe = !(leaderboard || affiliateDetail) || [...document.querySelectorAll('#sidebar-minichat-list textarea')].every(node => {
      const media = propsAlong(node, p => Array.isArray(p.drawerMedias));
      const reply = propsAlong(node, p => Array.isArray(p.replyCardsList));
      const conversation = propsAlong(node, p => !!p.currentConversation);
      return node.value === '' && media?.drawerMedias.length === 0 && reply?.replyCardsList.length === 0 && !conversation?.replyToMessage;
    });
    if (bound && listAction.type === 'check-navigation' && affiliateDetail && leaderboardDraftSafe && affiliateEvidence?.status === 'verified') {
      try {
        const expected = listAction.roster?.affiliate, creator = listAction.roster?.creator;
        result.listAction.performed = !!expected && creator?.id === expected.shopeeUserId && creator.name === affiliateEvidence.affiliate.name
          && window.__creatorAffiliateResolverPage(expected).status === 'verified';
      } catch { /* Unknown profile cannot authorize navigation. */ }
    }
    if (bound && listAction.type === 'open-chat' && affiliateDetail && leaderboardDraftSafe) {
      const expected = listAction.roster?.affiliate, target = listAction.roster?.creator;
      if (expected && expected.shopeeUserId === target?.id && target?.id === listAction.creator?.id && target.name === affiliateEvidence?.affiliate?.name) {
        try { result.listAction.performed = window.__creatorAffiliateResolverPage(expected, 'open-chat').action?.performed === true; } catch { /* No retry for a throwing chat action. */ }
      }
    }
    if (bound && listAction.type === 'open-chat' && !affiliateDetail && (!leaderboard || safeRoster(listAction.roster, listAction.creator?.id)) && leaderboardDraftSafe) {
      const expected = listAction.creator;
      const current = creators.find(row => row.id === expected?.id && row.name === expected.name && row.rowKey === expected.rowKey && row.chatAvailable);
      const button = current && rowNodes.get(current.id)?.chatButton;
      if (button && !button.disabled) { button.click(); result.listAction.performed = true; }
    }
    if (bound && listAction.type === 'stage-image' && imageContract && chat?.editorFound && chat.sendFound && chat.shopId === listAction.shopId && chat.recipientId === listAction.itemId
        && !chat.editorText && !chat.replyCount && (leaderboard || affiliateDetail ? !!listAction.roster && safeRoster(listAction.roster, listAction.itemId) : !listAction.roster || safeRoster(listAction.roster, listAction.itemId))) {
      const asset = listAction.asset, prior = window.__creatorOutreachImageDraft;
      const adopt = !!listAction.adoptToken && chat.imageDraft?.ready && prior?.token === listAction.adoptToken && prior.assetId === asset?.assetId && prior.sha256 === asset?.sha256;
      if (adopt || chat.mediaCount === 0) {
        try {
          let file = adopt ? prior.file : null;
          if (!file) {
            const prefix = `data:${asset.mime};base64,`;
            if (!['image/png', 'image/jpeg'].includes(asset.mime) || !listAction.dataUrl?.startsWith(prefix) || asset.size < 1 || asset.size >= 2 * 1024 * 1024) throw new Error('invalid image');
            const bytes = Uint8Array.from(atob(listAction.dataUrl.slice(prefix.length)), char => char.charCodeAt(0));
            if (bytes.length !== asset.size) throw new Error('invalid image');
            file = new File([bytes], asset.name, { type: asset.mime });
          }
          window.__creatorOutreachImageDraft = { ...asset, file, editor, input: imageInput, token: listAction.token, taskId: listAction.taskId, messageIndex: listAction.messageIndex, itemId: listAction.itemId, shopId: listAction.shopId, documentEpoch: performance.timeOrigin };
          if (!adopt) {
            const transfer = new DataTransfer(); transfer.items.add(file);
            imageInput.files = transfer.files;
            imageInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
          result.listAction.performed = true;
        } catch { result.listAction.performed = false; }
      }
    }
  }
  if (commit) {
    result.commit = { clicked: false };
    // A target roster may gain appended rows, but its original prefix and the
    // recipient's mounted chat entry must still match at the instant of click.
    const rosterSafe = leaderboard || affiliateDetail ? safeRoster(commit.roster, commit.itemId) : (!commit.marketplacePath && !commit.roster) || safeRoster(commit.roster, commit.itemId);
    const draftSafe = commit.image ? chat?.imageSupported && chat.imageDraft?.ready && chat.imageDraft.token === commit.image.token
      && chat.imageDraft.assetId === commit.image.assetId && chat.imageDraft.sha256 === commit.image.sha256 && !chat.editorText && !chat.replyCount
      : expectedText && chat?.editorText === expectedText && !chat.mediaCount && !chat.replyCount;
    if (result.origin === 'https://seller.shopee.co.id' && (!commit.marketplacePath || commit.marketplacePath === result.path) && rosterSafe && !blocked && commit.documentEpoch === result.documentEpoch && shop?.id === commit.shopId && chat?.shopId === commit.shopId && chat?.recipientId === commit.itemId && chat.editorFound && chat.sendReady && draftSafe) {
      // No await or extension round-trip may be inserted between this check and click.
      if (commit.image) window.__creatorOutreachImageDraft.claimed = true;
      activeSend.click();
      result.commit.clicked = true;
    }
  }
  return result;
}
