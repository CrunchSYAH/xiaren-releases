import { releaseRepository } from './release-config.mjs';
import { selectRelease, fetchLatestRelease, downloadAsset, verifyArchive, readArchive, planInstall, releaseAssetName, safeName, UpdaterError } from './updater.mjs';

const runtimeVersion = globalThis.chrome?.runtime?.getManifest?.().version || '预览';
const versionLabel = document.getElementById('extension-version');
if (versionLabel) versionLabel.textContent = `当前版本 ${runtimeVersion}`;
const currentManifest = globalThis.chrome?.runtime?.getManifest?.() || { version: '0.0.0' };

const ui = {
  status: document.getElementById('update-status'),
  check: document.getElementById('check-update'),
  install: document.getElementById('install-update'),
  link: document.getElementById('latest-release'),
  unavailable: document.getElementById('release-unavailable'),
  detail: document.getElementById('update-detail'),
  manual: document.getElementById('manual-update'),
};
const configured = safeName(releaseRepository);
if (ui.link && configured) {
  ui.link.href = `https://github.com/${releaseRepository}/releases/latest`;
  ui.link.hidden = false;
  if (ui.unavailable) ui.unavailable.hidden = true;
}

const setStatus = (message, kind = '') => {
  if (!ui.status) return;
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
};
const setDetail = message => { if (ui.detail) ui.detail.textContent = message || ''; };
const busy = value => { for (const button of [ui.check, ui.install]) if (button) button.disabled = value; };

let latest = null, running = false;

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xiaren-updater', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地目录记录'));
  });
}
async function readHandle() {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const request = db.transaction('handles', 'readonly').objectStore('handles').get('extension');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}
async function saveHandle(handle) {
  const db = await database();
  await new Promise((resolve, reject) => {
    const request = db.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'extension');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function forgetHandle() {
  try {
    const db = await database();
    await new Promise(resolve => {
      const request = db.transaction('handles', 'readwrite').objectStore('handles').delete('extension');
      request.onsuccess = () => resolve(); request.onerror = () => resolve();
    });
  } catch { /* A missing record only means the folder will be chosen again. */ }
}

const permission = handle => typeof handle?.queryPermission !== 'function' ? 'prompt' : handle.queryPermission({ mode: 'readwrite' });
async function ensurePermission(handle) {
  if (await permission(handle) === 'granted') return true;
  if (typeof handle?.requestPermission !== 'function') return false;
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

async function chooseDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') throw new UpdaterError('当前 Chrome 不支持在扩展内替换文件，请使用下方的手动更新方式');
  const handle = await window.showDirectoryPicker({ id: 'xiaren-extension', mode: 'readwrite', startIn: 'documents' });
  if (!handle) throw new UpdaterError('未选择扩展文件夹');
  await saveHandle(handle);
  return handle;
}

async function readFolderFile(dir, name) {
  try { return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()); }
  catch { return null; }
}

async function readTaskState() {
  try {
    const saved = await chrome.storage.local.get(['creatorQueue']);
    return saved?.creatorQueue?.task?.status || null;
  } catch { return null; }
}

async function check() {
  if (!configured) { setStatus('发布仓库尚未配置，请联系发布者获取正式安装包。', 'error'); return; }
  busy(true);
  setStatus('正在读取 GitHub 最新版本…');
  setDetail('');
  try {
    const release = await fetchLatestRelease();
    latest = selectRelease(release, currentManifest.version);
    if (latest.upToDate) {
      setStatus(`已是最新版本 ${currentManifest.version}。`, 'success');
      if (ui.install) ui.install.hidden = true;
      return;
    }
    setStatus(`发现新版本 ${latest.version}，可一键更新（当前 ${currentManifest.version}）。`);
    setDetail(latest.size ? `安装包 ${(latest.size / 1024 / 1024).toFixed(1)} MB，更新时会校验 SHA256。` : '更新时会校验 SHA256。');
    if (ui.install) { ui.install.hidden = false; ui.install.textContent = `自动更新到 ${latest.version}`; }
    if (ui.link) { ui.link.textContent = '查看更新说明'; ui.link.href = latest.notes || ui.link.href; ui.link.hidden = false; }
  } catch (error) {
    setStatus(error instanceof UpdaterError ? error.message : '无法连接 GitHub 读取版本信息，请检查网络后重试。', 'error');
  } finally { busy(false); }
}

async function install() {
  if (running) return;
  running = true; busy(true);
  try {
    if (!latest || latest.upToDate) throw new UpdaterError('请先检查更新');
    const active = await readTaskState();
    if (['running', 'pausing', 'stopping'].includes(active)) throw new UpdaterError('还有任务正在运行，请先在各店铺结束任务再更新');
    setStatus('正在准备扩展文件夹…');
    let dir = await readHandle();
    if (dir && !await ensurePermission(dir)) dir = null;
    if (!dir) dir = await chooseDirectory();
    if (!await ensurePermission(dir)) throw new UpdaterError('未获得文件夹写入权限，更新已取消');
    const existingManifest = await readFolderFile(dir, 'manifest.json');
    if (!existingManifest) {
      await forgetHandle();
      throw new UpdaterError('所选文件夹里没有 manifest.json，请选择虾仁 extension 文件夹');
    }
    let folderManifest = null;
    try { folderManifest = JSON.parse(new TextDecoder().decode(existingManifest)); } catch { /* Reported below. */ }
    if (folderManifest?.name !== currentManifest.name) {
      await forgetHandle();
      throw new UpdaterError('所选文件夹不是虾仁的安装目录，请重新选择 extension 文件夹');
    }
    setStatus('正在下载安装包…');
    const [archive, checksumText] = await Promise.all([
      downloadAsset(latest.zipUrl, 20 * 1024 * 1024),
      downloadAsset(latest.checksumUrl, 4096).then(bytes => new TextDecoder().decode(bytes)),
    ]);
    setStatus('正在校验安装包…');
    await verifyArchive(archive, checksumText, latest.name);
    setStatus('正在解压…');
    const { files, version } = planInstall(await readArchive(archive), currentManifest);
    setStatus('正在备份当前文件…');
    const backup = new Map();
    for (const name of files.keys()) {
      const bytes = await readFolderFile(dir, name);
      if (bytes) backup.set(name, bytes);
    }
    setStatus(`正在写入 ${files.size} 个文件…`);
    const written = [];
    try {
      for (const [name, bytes] of files) {
        const handle = await dir.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(bytes);
        await stream.close();
        written.push(name);
      }
    } catch (error) {
      setStatus('写入失败，正在恢复原文件…', 'error');
      for (const [name, bytes] of backup) {
        try {
          const handle = await dir.getFileHandle(name, { create: true });
          const stream = await handle.createWritable();
          await stream.write(bytes); await stream.close();
        } catch { /* Keep restoring the remaining files. */ }
      }
      for (const name of written) if (!backup.has(name)) { try { await dir.removeEntry(name); } catch { /* Best effort. */ } }
      throw new UpdaterError(`写入失败，已尝试恢复原文件：${error?.message || '未知错误'}`);
    }
    setStatus(`已更新到 ${version}，正在重新加载扩展…`, 'success');
    setDetail('重新加载后本次更新页会自动关闭，请回到工作台核对版本号。');
    await new Promise(resolve => setTimeout(resolve, 600));
    chrome.runtime.reload();
  } catch (error) {
    setStatus(error instanceof UpdaterError ? error.message : (error?.name === 'AbortError' ? '已取消选择文件夹' : `更新失败：${error?.message || '未知错误'}`), 'error');
  } finally {
    running = false; busy(false);
  }
}

ui.check?.addEventListener('click', () => void check());
ui.install?.addEventListener('click', () => void install());
if (configured) void check();
