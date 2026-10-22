// Serialized into the Shopee MAIN world. Reads only the observed filter/form
// contract; changing a field and applying its form are separate synchronous steps.
export function inspectFilters(expected = {}, requested = null) {
  window.__creatorOutreachFilters = inspectFilters;
  const result = { path: location.pathname, documentEpoch: performance.timeOrigin, supported: { category: false, channel: false }, current: { category: '', channel: '' }, options: { categories: [], channels: [] }, loading: true, matched: false, performed: false, filterContext: null, error: null };
  const fail = error => ({ ...result, matched: false, error });
  const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const propsAlong = (node, predicate) => {
    const key = Object.keys(node || {}).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? node[key] : null, root = fiber;
    while (root?.return) root = root.return;
    if (root?.stateNode?.current && root.stateNode.current !== root) fiber = fiber?.alternate || null;
    for (let index = 0; fiber && index < 30; index++, fiber = fiber.return) if (fiber.memoizedProps && predicate(fiber.memoizedProps)) return fiber.memoizedProps;
    return null;
  };
  const chipProps = node => propsAlong(node, props => Array.isArray(props.items) && typeof props.onChange === 'function' && (typeof props.activeKey === 'string' || Number.isSafeInteger(props.activeKey)));
  const optionsOf = props => {
    if (!props || props.items.length < 1 || props.items.length > 100) return null;
    const options = props.items.map(item => item && (typeof item.value === 'string' || Number.isSafeInteger(item.value)) && typeof item.label === 'string' && item.label.trim() && String(item.value).length <= 100 ? { value: String(item.value), label: item.label.trim().slice(0, 100) } : null);
    return options.every(Boolean) && new Set(options.map(item => item.value)).size === options.length ? options : null;
  };
  const canonical = (value, depth = 0) => {
    if (depth > 6) throw new Error('unknown filter value');
    if (value === undefined) return null;
    if (value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 2400 || typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value) && value.length <= 100) return value.map(item => canonical(item, depth + 1));
    if (value && Object.prototype.toString.call(value) === '[object Object]' && Object.keys(value).length <= 100) {
      const clean = {};
      for (const key of Object.keys(value).sort()) if (value[key] !== undefined) clean[key] = canonical(value[key], depth + 1);
      return clean;
    }
    throw new Error('unknown filter value');
  };
  const marketplace = location.pathname === '/portal/web-seller-affiliate/kol_marketplace';
  const leaderboard = location.pathname === '/portal/web-seller-affiliate/affiliate_leaderboard';
  if (location.origin !== 'https://seller.shopee.co.id' || !marketplace && !leaderboard) return fail('当前页面不支持筛选');
  let shopId = null;
  try {
    const store = typeof window.__$unstable_useRootStoreOutside === 'function' ? window.__$unstable_useRootStoreOutside() : null;
    if (store?.isLoggedIn !== false && /^(?!0$)\d+$/.test(String(store?.shopId || ''))) shopId = String(store.shopId);
  } catch { /* Unknown shop cannot authorize a change. */ }
  if (requested !== null && (!shopId || expected?.shopId !== shopId || expected?.path !== location.pathname || expected?.documentEpoch !== performance.timeOrigin)) return fail('页面或店铺已变化，请重新连接');
  if ([...document.querySelectorAll('[class*=captcha],iframe[src*=captcha],[role=alert]')].some(node => visible(node) && /captcha|verification|verifikasi|too many|terlalu banyak|限制|验证/i.test(node.textContent || node.getAttribute('src') || node.className))) return fail('页面需要验证或已受限');
  const categoryRoot = document.querySelector('.categorySelectorChip');
  const category = chipProps(categoryRoot?.querySelector('.eds-react-chip') || document.querySelector('.categorySelectorChip .eds-react-chip'));
  const channelRoot = leaderboard ? document.querySelector('[class*=AffiliateLeaderboard---filterWrapper]')?.lastElementChild : document.querySelector('[class*=KOLFiltersGroup---socialMediaSelect]');
  const channel = chipProps(channelRoot?.querySelector('.eds-react-chip') || (marketplace ? document.querySelector('[class*=KOLFiltersGroup---socialMediaSelect] .eds-react-chip') : null));
  const categories = optionsOf(category), channels = optionsOf(channel);
  result.supported = { category: !!categories, channel: !!channels };
  result.options = { categories: categories || [], channels: channels || [] };
  result.current = { category: categories ? String(category.activeKey) : '', channel: channels ? String(channel.activeKey) : '' };
  if (categories && !categories.some(item => item.value === result.current.category) || channels && !channels.some(item => item.value === result.current.channel)) return fail('当前筛选值不在原页选项中');
  let list = null, form = null, applied = null, settled = false, searchPending = false;
  try {
    if (marketplace) {
      form = propsAlong(document.querySelector('form'), props => props.name === 'filter_search' && typeof props.form?.getFieldsValue === 'function');
      list = propsAlong(document.querySelector('.kol-card-layout-global') || document.querySelector('[class*=KOLCards---kol-card-empty]'), props => Array.isArray(props.list) && typeof props.hasMore === 'boolean' && typeof props.loading === 'boolean');
      if (!form || !list || !list.trackingData?.filterOptions || !Number.isInteger(list.sortByKey) || !categories || !channels) return fail('无法核对原页筛选及列表状态');
      applied = canonical(list.trackingData.filterOptions);
      const values = canonical(form.form.getFieldsValue());
      // Read-only evidence retains the exact legacy lock shape. No search
      // handler is read or called, and manual search changes require Apply.
      const input = document.querySelector('input[placeholder="Search by affiliate name"]');
      const search = input ? input.value : values.affiliateName ?? '';
      const appliedSearch = applied.user_name == null ? '' : applied.user_name;
      if (typeof search !== 'string' || typeof appliedSearch !== 'string') return fail('无法核对原页名称筛选状态');
      searchPending = search !== appliedSearch;
      result.loading = list.loading;
      const actual = { category: applied.category == null || applied.category === '' ? '0' : String(applied.category), channel: applied.social_media == null || applied.social_media === '' || applied.social_media === 0 ? '1000000' : String(applied.social_media) };
      settled = !list.loading && !searchPending && Object.keys(actual).every(key => actual[key] === result.current[key]);
      result.filterContext = JSON.stringify({ source: 'marketplace', current: { ...result.current, search }, fields: values, applied, sort: list.sortByKey });
    } else {
      const tabs = propsAlong(document.querySelector('[class*=AffiliateLeaderboard---tabs]'), props => typeof props.activeKey === 'string');
      const dates = propsAlong(document.querySelector('[class*=AffiliateLeaderboard---datePeriod]'), props => Array.isArray(props.dateRange) && typeof props.checkedPanelType === 'string');
      const spin = propsAlong(document.querySelector('[class*=affiliate-spin]'), props => typeof props.spinning === 'boolean');
      const range = dates?.dateRange.map(date => Date.prototype.getTime.call(date?._d));
      if (!tabs || !['1', '2', '3'].includes(tabs.activeKey) || !channels || !spin || !dates || !['week', 'month'].includes(dates.checkedPanelType) || range?.length !== 2 || !range.every(Number.isFinite) || (!categories && (tabs.activeKey !== '3' || categoryRoot))) return fail('无法核对排行榜筛选及列表状态');
      result.loading = spin.spinning;
      settled = !result.loading;
      result.filterContext = JSON.stringify({ source: 'leaderboard', current: { ...result.current, search: '' }, tab: tabs.activeKey, period: dates.checkedPanelType, range });
    }
  } catch { return fail('原页筛选结构变化，无法核对'); }
  result.matched = settled;
  if (requested === null) return result;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(key => !['category', 'channel'].includes(key)) || ['category', 'channel'].some(key => typeof requested[key] !== 'string' || requested[key].length > 100)) return fail('筛选参数无效');
  for (const key of ['category', 'channel']) {
    if (!result.supported[key] && requested[key] !== '') return fail('当前榜单不支持分类筛选');
    const options = key === 'category' ? categories : channels;
    if (options && !options.some(item => item.value === requested[key])) return fail('所选筛选项在原页不可用');
  }
  const differs = ['category', 'channel'].find(key => requested[key] !== result.current[key]);
  result.matched = settled && !differs;
  if (result.matched || result.loading) return result;
  if (searchPending) return fail('原页名称搜索尚未应用，请在 Shopee 页面手动应用或清空后再准备');
  const draftSafe = [...document.querySelectorAll('#sidebar-minichat-list textarea')].every(node => {
    const media = propsAlong(node, props => Array.isArray(props.drawerMedias));
    const replies = propsAlong(node, props => Array.isArray(props.replyCardsList));
    const conversation = propsAlong(node, props => !!props.currentConversation);
    return node.value === '' && media?.drawerMedias.length === 0 && replies?.replyCardsList.length === 0 && !conversation?.replyToMessage;
  });
  if (!draftSafe) return fail('Shopee 聊天中存在草稿或附件，请先处理');
  try {
    if (differs === 'category') category.onChange(category.items.find(item => String(item.value) === requested.category).value);
    else if (differs === 'channel') channel.onChange(channel.items.find(item => String(item.value) === requested.channel).value);
    else if (marketplace) {
      const buttons = [...document.querySelectorAll('form button')].filter(button => button.textContent.trim() === 'Apply' && visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
      if (buttons.length !== 1) return fail('无法核对原页应用筛选按钮');
      buttons[0].click();
    } else return fail('筛选尚未稳定');
    result.performed = true;
    result.matched = false;
  } catch { return fail('原页筛选操作未正常返回，请重新核对'); }
  return result;
}
