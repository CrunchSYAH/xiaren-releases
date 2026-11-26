import { restoreRecordedDOM } from './runtime.mjs';

const $ = id => document.getElementById(id);
const manifest = await (await fetch('./manifest.json')).json();
const samples = new Map();
for (const entry of manifest.cases) {
  const content = await (await fetch(`./${entry.file}`)).text();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== entry.sha256) throw new Error('样本完整性校验失败，未恢复页面');
  samples.set(entry.name, JSON.parse(content));
  const option = document.createElement('option'); option.value = entry.name; option.textContent = entry.name === 'list' ? '实采：列表页（12 位达人）' : `实采：样本达人 ${entry.name.slice(-2)} 的聊天`;
  $('recorded-case').append(option);
}
let current, batch = 0, sequence = 5000, clickCount = 0;
let pendingTimer = null;
const clone = value => structuredClone(value);
function walkProps(action) {
  for (const binding of current.bindings) {
    const node = window.__recordedNodes.get(binding.nodeKey);
    for (let branch of [node?.__reactFiber$recorded, node?.__reactFiber$recorded?.alternate]) for (; branch; branch = branch.return) action(branch.memoizedProps);
  }
}
function status(message) { $('recorded-status').textContent = message; }
function syntheticState() {
  const mode = $('recorded-mode').value, fault = $('recorded-fault').value;
  walkProps(props => {
    if (props.currentConversation) {
      if (mode !== 'recorded' && !/^[0-9]+$/.test(String(props.currentConversation.latest_message_id))) props.currentConversation.latest_message_id = String(sequence);
      if (batch) props.currentConversation.shop_id = String(700 + batch);
      if (fault === 'recipient') props.currentConversation.to_id = '9999';
    }
    if (Object.hasOwn(props, 'shopId') && batch) props.shopId = 700 + batch;
    if (Object.hasOwn(props, 'buyerId') && fault === 'recipient') props.buyerId = '9999';
  });
  if (batch) window.__$unstable_useRootStoreOutside = () => ({ ...clone(current.store), shopId: 700 + batch, shopName: `样本店铺（模拟批次 ${batch}）` });
  const send = document.querySelector('#sidebar-minichat-list .pqq6o4R57Y .plW8rzAMob');
  if (send && fault === 'controls') send.style.setProperty('display', 'none', 'important');
  $('recorded-verification').hidden = fault !== 'captcha';
}
async function loadCase(name, { delayed = false } = {}) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  const apply = () => {
    pendingTimer = null;
    current = clone(samples.get(name));
    $('recorded-case').value = name;
    window.__recordedNodes = restoreRecordedDOM(current, $('recorded-root'));
    syntheticState();
    bindInteractions();
    const entry = manifest.cases.find(entry => entry.name === name);
    $('recorded-provenance').textContent = `采集：${new Date(entry.capturedAt).toLocaleString()}；当前${$('recorded-mode').value === 'recorded' && !batch && $('recorded-fault').value === 'none' ? '保留实采状态' : '含明确标记的派生状态'}。`;
    status(name === 'list' ? '已恢复真实列表结构；可离线打开样本达人 01—03。' : '已恢复实采聊天；空回执依据保持为空，未改成零。');
    window.__recordedReady = true;
  };
  if (delayed) pendingTimer = setTimeout(apply, 350); else apply();
}
function bindInteractions() {
  for (const row of document.querySelectorAll('tr.kol-card-item[data-row-key]')) {
    let fiber = row.__reactFiber$recorded, id = null;
    if (fiber?.return) { let root = fiber; while (root.return) root = root.return; if (root.stateNode?.current && root.stateNode.current !== root) fiber = fiber.alternate; }
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) if (fiber.memoizedProps?.data?.shopeeUserId || fiber.memoizedProps?.record?.shopeeUserId) { id = String((fiber.memoizedProps.data || fiber.memoizedProps.record).shopeeUserId); break; }
    const button = [...row.querySelectorAll('button')].find(button => [...button.querySelectorAll('use')].some(use => (use.getAttribute('href') || use.getAttribute('xlink:href')) === '#icon-chat-new'));
    button?.addEventListener('click', () => {
      const target = manifest.cases.find(entry => entry.recipientId === id);
      if (target && current.kind === target.name) {
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = null;
        status('已打开该实采聊天，取消其他延迟切换并保留现有控件。');
      }
      else if (target) void loadCase(target.name, { delayed: true });
      else status('该达人没有采集聊天样本，不能据此验证。请选择样本达人 01—03。');
    });
  }
  const editor = document.querySelector('#sidebar-minichat-list textarea');
  const send = document.querySelector('#sidebar-minichat-list .pqq6o4R57Y .plW8rzAMob');
  send?.addEventListener('click', () => {
    if ($('recorded-mode').value === 'recorded') { status('原样状态不产生虚构回执；此点击没有真实网络发送。'); return; }
    if (!editor?.value) return;
    clickCount++; $('recorded-clicks').value = String(clickCount);
    const toId = current.observed.chat.recipientId, shopId = String(700 + batch), text = editor.value, id = String(++sequence), mode = $('recorded-mode').value;
    const node = document.createElement('div'); node.style.cssText = 'padding:12px;margin:10px;background:#e3f3ec;color:#20333e'; node.textContent = `${text}（离线模拟）`;
    node.__reactFiber$recorded = { memoizedProps: { message: { id, to_id: toId, from_shop_id: shopId, content: { text }, status: mode === 'success' ? 'sent' : mode === 'failed' ? 'failed' : 'pending' } } };
    document.querySelector('#sidebar-minichat-list #messagesContainer')?.append(node);
    walkProps(props => { if (props.currentConversation) { props.currentConversation.latest_message_id = id; if (mode === 'success') props.currentConversation.opposite_last_deliver_msg_id = id; } });
    editor.value = ''; editor.dispatchEvent(new Event('input', { bubbles: true }));
    status(`第 ${clickCount} 次离线模拟点击；回执由测试替身生成，不是实采成功证据。`);
  });
}
$('recorded-case').addEventListener('change', () => void loadCase($('recorded-case').value));
for (const id of ['recorded-mode', 'recorded-fault']) $(id).addEventListener('change', () => void loadCase($('recorded-case').value));
$('recorded-batch').addEventListener('click', () => { batch++; clickCount = 0; $('recorded-clicks').value = '0'; void loadCase('list'); });
window.__recordedReplay = { manifest, loadCase, get sample() { return clone(current); }, get simulated() { return $('recorded-mode').value !== 'recorded' || batch > 0 || $('recorded-fault').value !== 'none'; } };
await loadCase('list');
