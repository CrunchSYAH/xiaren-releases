import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';

const source = await readFile(new URL('../scripts/preview.mjs', import.meta.url), 'utf8');

test('本地服务提供脱敏重放与样本，仅允许本机资源，不暴露工作区其他文件', async t => {
  assert.match(source, /export function createPreviewServer/, '需要可验证的本地服务入口');
  const { createPreviewServer } = await import('../scripts/preview.mjs');
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const request = pathname => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    }); req.on('error', reject);
  });
  const guide = await request('/');
  assert.equal(guide.status, 200); assert.match(guide.text, /extension-local-test/);
  const page = await request('/tests/fixtures/marketplace.html');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-eval/);
  assert.doesNotMatch(page.text, /<(?:script|img|iframe)[^>]+(?:src|href)=["']https?:/);
  const recorded = await request('/tests/fixtures/recorded/marketplace.html');
  assert.equal(recorded.status, 200);
  assert.match(recorded.text, /真实页面脱敏重放/);
  assert.match(recorded.headers['content-security-policy'], /connect-src 'self'/);
  assert.doesNotMatch(recorded.headers['content-security-policy'], /unsafe-eval|https?:/);
  const manifest = await request('/tests/fixtures/recorded/manifest.json');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /application\/json/);
  assert.equal(JSON.parse(manifest.text).sourceKind, 'real-rendered-dom-and-whitelisted-runtime');
  assert.equal((await request('/tests/fixtures/recorded/chat-01.json')).status, 200);
  assert.equal((await request('/extension/manifest.json')).status, 403);
  assert.equal((await request('/tests/fixtures/other.json')).status, 403);
  assert.equal((await request('/tests/fixtures/recorded/../other.json')).status, 403);
  assert.equal((await request('/README.md')).status, 403);
  assert.equal((await request('/tests/%2e%2e%2f%2e%2e%2fREADME.md')).status, 403);
  assert.equal((await request('/%E0%A4%A')).status, 404);
});
