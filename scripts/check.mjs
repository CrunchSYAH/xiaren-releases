import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(mjs|js)$/.test(file)) files.push(file);
  }
}
await walk('extension'); await walk('scripts'); await walk('tests/fixtures/recorded');
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}
let fixtureScripts = 0;
for (const name of await readdir(path.join(root, 'tests/fixtures'))) {
  if (!name.endsWith('.html')) continue;
  const html = await readFile(path.join(root, 'tests/fixtures', name), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!match[1].trim()) continue;
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: match[1], encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    fixtureScripts++;
  }
}
const { createLocalTestFiles } = await import('./build-local-test.mjs');
const localFiles = await createLocalTestFiles();
for (const [file, source] of localFiles) if (/\.(mjs|js)$/.test(file)) {
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, `本地测试版 ${file}: ${result.stderr}`);
}
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
// The seller site is the only page this tool touches. The four GitHub origins
// exist solely for the opt-in self-updater and are read-only GET endpoints.
assert.deepEqual(manifest.host_permissions, [
  'https://seller.shopee.co.id/*',
  'https://api.github.com/*',
  'https://github.com/*',
  'https://objects.githubusercontent.com/*',
  'https://release-assets.githubusercontent.com/*',
]);
assert.equal(manifest.externally_connectable, undefined);
assert.equal(manifest.content_scripts, undefined, '只对自建标签页按需注入');
const updaterFiles = new Set(['extension/updater.mjs', 'extension/update.mjs']);
// path.join 在 Windows 上产出反斜杠，直接和上面的正斜杠键比较会永远不相等：
// 那会让“只有更新器可以访问网络”的豁免和白名单校验被整段跳过。
const extensionFiles = await Promise.all(files.filter(file => file.startsWith('extension')).map(async file => ({
  file, key: file.replaceAll('\\', '/'), source: await readFile(path.join(root, file), 'utf8'),
})));
for (const { key, source } of extensionFiles) {
  if (updaterFiles.has(key)) {
    assert.doesNotMatch(source, /\bXMLHttpRequest\b|\bWebSocket\b/, `${key}: 更新器只允许 fetch`);
    continue;
  }
  // 匹配 fetch / fetchImpl / window.fetch 等一切调用写法，避免只用别名就绕过检查。
  assert.ok(!/\b(?:fetch\w*|XMLHttpRequest|WebSocket)\s*\(/.test(source), `${key}: 除更新器外，扩展不应向外部服务传输数据`);
}
const updaterSources = extensionFiles.filter(entry => updaterFiles.has(entry.key)).map(entry => entry.source).join('\n');
assert.ok(updaterSources.includes('fetchImpl('), '未找到更新器源码，白名单校验会失去意义');
// 只校验真正会被请求的地址：权限白名单常量里必然出现卖家站点与四个 GitHub 域，
// 它们不是网络调用目标，把整行常量排除后再扫 https:// 才不会误报。
const accessSources = extensionFiles.filter(entry => updaterFiles.has(entry.key))
  .map(entry => entry.source.replace(/^.*KNOWN_(?:HOST_)?PERMISSIONS.*$/gm, '')).join('\n');
for (const match of accessSources.matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)) {
  assert.ok(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(match[1]), `更新器不应访问 ${match[1]}`);
}
// 消息条数与字数上限只能来自 extension/core/message-rules.mjs。
// 一旦这些文件里重新出现字面量，就是又回到了“前后端各写一份”的漂移老路。
for (const key of ['extension/dashboard.mjs', 'extension/core/queue.mjs', 'extension/core/message-templates.mjs']) {
  const source = extensionFiles.find(entry => entry.key === key)?.source ?? '';
  assert.doesNotMatch(source, /\b(?:2400|2000)\b/, `${key}: 消息上限必须从 core/message-rules.mjs 读取，不要写死数字`);
}
process.stdout.write(`语法检查 ${files.length} 个文件、${fixtureScripts} 段夹具脚本与本地测试版通过；Manifest 权限及外部请求检查通过。\n`);
