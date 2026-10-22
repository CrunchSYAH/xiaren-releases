import { createBackend } from './core/backend.mjs';

const backend = createBackend(chrome);
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
chrome.action.onClicked.addListener(() => { chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  backend.handle(message, sender).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => { backend.onUpdated(tabId, change).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => { backend.onRemoved(tabId).catch(() => {}); });
