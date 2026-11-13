import { createBackend } from './core/backend.mjs';

const backend = createBackend(chrome);
const dashboardUrl = chrome.runtime.getURL('dashboard.html');
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
// The toolbar keeps a single workbench: focus the one already open instead of
// stacking tabs, which would poll the same background and compete for previews.
async function dashboardTab() {
  // The fragment is dropped so a "跳到任务设置" anchor still counts as the same
  // workbench tab.
  const samePage = value => typeof value === 'string' && value.split('#')[0] === dashboardUrl;
  try {
    // getContexts lists this extension's own tabs without the "tabs" permission.
    if (typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
      return contexts.find(item => Number.isInteger(item.tabId) && samePage(item.documentUrl))?.tabId ?? null;
    }
    const tabs = await chrome.tabs.query({});
    return tabs.find(tab => samePage(tab.url))?.id ?? null;
  } catch { return null; }
}
async function openDashboard() {
  const tabId = await dashboardTab();
  if (Number.isInteger(tabId)) {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (chrome.windows?.update && Number.isInteger(tab?.windowId)) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return;
    } catch { /* The remembered tab is gone; open a new workbench instead. */ }
  }
  await chrome.tabs.create({ url: dashboardUrl });
}
chrome.action.onClicked.addListener(() => openDashboard().catch(() => {}));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  backend.handle(message, sender).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => { backend.onUpdated(tabId, change).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => { backend.onRemoved(tabId).catch(() => {}); });
