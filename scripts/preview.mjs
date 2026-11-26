import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
export function createPreviewServer() { return http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/tests/fixtures/local-test.html' : pathname}`);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !['extension', 'tests'].includes(relative.split(path.sep)[0]) || !types[path.extname(file)]) { response.writeHead(403).end(); return; }
    if (path.extname(file) === '.json' && !relative.startsWith(path.join('tests', 'fixtures', 'recorded') + path.sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    const marketplace = relative === path.join('tests', 'fixtures', 'marketplace.html');
    const scripts = marketplace && url.searchParams.get('harness') === '1' ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
    const csp = `default-src 'none'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src data:; connect-src ${marketplace ? "'none'" : "'self'"}; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    response.writeHead(200, { 'content-type': types[path.extname(file)], 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }).end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404).end('Not found'); }
}); }

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const server = createPreviewServer();
  server.on('error', error => {
    process.stderr.write(error.code === 'EADDRINUSE' ? '4177 端口已被占用；请关闭占用该端口的程序后重试。\n' : `本地服务启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
  server.listen(4177, '127.0.0.1', () => process.stdout.write('本地插件测试指引 http://127.0.0.1:4177/ （真实结构脱敏重放，发送由本地模拟）\n'));
}
