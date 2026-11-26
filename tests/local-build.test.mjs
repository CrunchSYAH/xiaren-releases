import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const builder = await import('../scripts/build-local-test.mjs').catch(() => null);
const source = file => readFile(new URL(`../extension/${file}`, import.meta.url), 'utf8');

test('生成本机专用测试插件，不能声明真实店铺或全站权限', async () => {
  assert.equal(typeof builder?.createLocalTestFiles, 'function', '尚未实现本地测试版生成器');
  const files = await builder.createLocalTestFiles();
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
  assert.match(manifest.name, /本地测试/);
  assert.equal(files.size, 11);
  for (const [name, text] of files) {
    assert.equal(text.includes('https://seller.shopee.co.id'), false, `${name} 残留真实站点地址`);
    if (/\.(mjs|js)$/.test(name)) assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  }
});

test('测试版保留原队列、执行器及 Chrome 后台入口，不使用模拟 Chrome API', async () => {
  assert.ok(builder, '尚未实现本地测试版生成器');
  const files = await builder.createLocalTestFiles();
  for (const file of ['core/queue.mjs', 'core/collection.mjs', 'content.js', 'background.mjs', 'dashboard.css']) assert.equal(files.get(file), await source(file), file);
  assert.ok(files.get('core/backend.mjs').includes('http://127.0.0.1:4177/tests/fixtures/recorded/marketplace.html'), '本地入口应使用真实记录页');
  assert.match(files.get('core/backend.mjs'), /documentIds/);
  assert.match(files.get('dashboard.html'), /仅本机测试/);
  assert.match(files.get('dashboard.mjs'), /本地模拟发送/);
  const manifest = JSON.parse(await source('manifest.json'));
  assert.deepEqual(manifest.host_permissions, ['https://seller.shopee.co.id/*']);
});

test('生成的页面核对只接受本地端口，并保留原版真实站点边界', async () => {
  assert.ok(builder, '尚未实现本地测试版生成器');
  const files = await builder.createLocalTestFiles();
  const guards = await import(`data:text/javascript;base64,${Buffer.from(files.get('core/page-guards.mjs')).toString('base64')}`);
  const page = { origin: 'http://127.0.0.1:4177', shop: { id: '700', name: '虚构店铺' }, blocked: false };
  assert.equal(guards.validatePage(page), page);
  for (const origin of ['https://seller.shopee.co.id', 'http://127.0.0.1:4178', 'https://example.com']) assert.throws(() => guards.validatePage({ ...page, origin }));
  assert.match(await source('core/page-guards.mjs'), /https:\/\/seller\.shopee\.co\.id/);
});

test('生成包包含所有相对导入，避免后台因漏打模块而无法加载', async () => {
  const files = await builder.createLocalTestFiles();
  for (const [name, text] of files) {
    if (!/\.(mjs|js)$/.test(name)) continue;
    for (const match of text.matchAll(/\bimport\s[^;\n]*?from\s*['"](\.[^'"]+)['"]/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      assert.ok(files.has(dependency), `${name} 缺少依赖 ${dependency}`);
    }
  }
});
