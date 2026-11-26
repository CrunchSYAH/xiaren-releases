import test from 'node:test';
import assert from 'node:assert/strict';

// The background entry stays thin on purpose: it only wires Chrome events into
// createBackend. These checks cover the toolbar workbench rule, which is the one
// piece of background logic that has no backend unit test.
function chromeStub({ contexts, tabs, withGetContexts = true }) {
  const created = [], activated = [], focused = [];
  let click = null;
  const chrome = {
    runtime: {
      id: 'demo',
      getURL: path => `chrome-extension://demo/${path}`,
      onMessage: { addListener: () => {} },
      ...(withGetContexts ? { getContexts: async ({ contextTypes }) => { assert.deepEqual(contextTypes, ['TAB']); return contexts; } } : {}),
    },
    storage: { local: { setAccessLevel: async () => {} } },
    action: { onClicked: { addListener: listener => { click = listener; } } },
    tabs: {
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      create: async options => { created.push(options); return { id: 99 }; },
      update: async (id, props) => { activated.push({ id, ...props }); return { id, windowId: 3 }; },
      query: async () => tabs,
    },
    windows: { update: async (id, props) => { focused.push({ id, ...props }); } },
  };
  return { chrome, created, activated, focused, click: () => click };
}

async function boot(stub) {
  globalThis.chrome = stub.chrome;
  // A fresh query string re-evaluates the entry module against the new stub.
  const url = new URL('../extension/background.mjs', import.meta.url);
  url.search = `?case=${Math.random()}`;
  await import(url.href);
  assert.equal(typeof stub.click(), 'function');
  await stub.click()();
}

test('工具栏复用已打开的工作台标签页，不再叠加新标签', async () => {
  const stub = chromeStub({ contexts: [{ tabId: 5, documentUrl: 'chrome-extension://demo/dashboard.html#main' }, { tabId: 6, documentUrl: 'chrome-extension://demo/history.html' }], tabs: [] });
  await boot(stub);
  assert.deepEqual(stub.activated, [{ id: 5, active: true }]);
  assert.deepEqual(stub.focused, [{ id: 3, focused: true }]);
  assert.deepEqual(stub.created, []);
});

test('旧版 Chrome 没有 getContexts 时改用标签页查询，找不到才新建工作台', async () => {
  const legacy = chromeStub({ tabs: [{ id: 8, url: 'chrome-extension://demo/dashboard.html' }], withGetContexts: false });
  await boot(legacy);
  assert.deepEqual(legacy.activated, [{ id: 8, active: true }]);
  assert.deepEqual(legacy.created, []);
  const fresh = chromeStub({ tabs: [{ id: 9, url: 'chrome-extension://demo/dashboard.html?x=1' }], withGetContexts: false });
  await boot(fresh);
  assert.deepEqual(fresh.created, [{ url: 'chrome-extension://demo/dashboard.html' }]);
  assert.deepEqual(fresh.activated, []);
});
