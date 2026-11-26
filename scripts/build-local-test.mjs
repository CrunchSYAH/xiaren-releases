import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realOrigin = 'https://seller.shopee.co.id';
const localOrigin = 'http://127.0.0.1:4177';
const UPDATE_HOSTS = ['https://api.github.com/*', 'https://github.com/*', 'https://objects.githubusercontent.com/*', 'https://release-assets.githubusercontent.com/*'];
export const localTestDirectory = path.join(root, 'artifacts', 'extension-local-test');
// 后台与工作台 import 的 core 模块必须全部列出：漏一个，本地测试版会在
// 运行时才因为模块缺失而失败，语法检查抓不到。
const names = ['manifest.json', 'background.mjs', 'content.js', 'dashboard.html', 'dashboard.mjs', 'dashboard.css', 'page-snapshot.mjs', 'core/backend.mjs', 'core/page-guards.mjs', 'core/queue.mjs', 'core/collection.mjs', 'core/message-rules.mjs', 'core/history-window.mjs'];

// Generated separately: no localhost permissions or runtime test switches are
// added to the production extension. Chrome APIs remain the real Chrome APIs.
export async function createLocalTestFiles() {
  const files = new Map(await Promise.all(names.map(async name => [name, await readFile(path.join(root, 'extension', name), 'utf8')])));
  const manifest = JSON.parse(files.get('manifest.json'));
  // The seller origin plus the read-only GitHub release endpoints used by the
  // opt-in updater; the local test build never inherits either.
  assert.deepEqual(manifest.host_permissions, [`${realOrigin}/*`, ...UPDATE_HOSTS], '正式版权限已变化，需重新审阅本地生成规则');
  manifest.name = '虾仁 · 仅本地测试版';
  manifest.description = '只连接本机脱敏重放页的 Chrome 插件测试版，不具有真实 Shopee 网站权限。';
  manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.action.default_title = '打开本地测试插件工作台';
  files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const marketplace = `${realOrigin}/portal/web-seller-affiliate/kol_marketplace`;
  assert.ok(files.get('core/backend.mjs').includes(marketplace), '专用页面入口已变化，停止生成');
  files.set('core/backend.mjs', files.get('core/backend.mjs').replace(marketplace, `${localOrigin}/tests/fixtures/recorded/marketplace.html`));
  for (const name of ['core/backend.mjs', 'core/page-guards.mjs', 'page-snapshot.mjs']) {
    assert.ok(files.get(name).includes(realOrigin), `${name} 的来源校验已变化，停止生成`);
    files.set(name, files.get(name).replaceAll(realOrigin, localOrigin).replaceAll('印尼卖家站', '本地模拟店铺').replaceAll('印尼 Shopee 卖家页面', '本地模拟页面'));
  }
  for (const name of ['dashboard.html', 'dashboard.mjs']) files.set(name, files.get(name).replaceAll('真实发送', '本地模拟发送').replaceAll('专用 Shopee 页', '本地模拟页').replaceAll('专用 Shopee 页面', '本地模拟页面'));
  const html = files.get('dashboard.html');
  assert.ok(html.includes('<main id="main" tabindex="-1">'), '工作台结构已变化，停止生成');
  files.set('dashboard.html', html.replace('<main id="main" tabindex="-1">', '<main id="main" tabindex="-1"><p class="notice" role="note" style="border:2px solid #e8492d">仅本机测试 · 页面来自真实结构脱敏重放，身份均已替换；交互与回执由本地模拟。请使用左侧“打开本地模拟页”；仅前三位达人有聊天样本。</p>').replace('<title>虾仁 · 印尼达人建联</title>', '<title>虾仁 · 本地测试插件</title>'));
  for (const [name, text] of files) assert.ok(!text.includes(realOrigin), `${name} 残留真实站点地址，停止生成`);
  return files;
}

export async function buildLocalTest() {
  const files = await createLocalTestFiles();
  for (const [name, text] of files) {
    const file = path.join(localTestDirectory, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, 'utf8');
  }
  return { directory: localTestDirectory, count: files.size };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildLocalTest();
  process.stdout.write(`已生成本地测试插件（${result.count} 个文件）：${result.directory}\n只允许访问本机，正式 extension/ 未修改。\n`);
}
