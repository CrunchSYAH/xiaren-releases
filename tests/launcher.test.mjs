import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const file = new URL('../启动本地测试.cmd', import.meta.url);

test('Windows 启动入口使用 ASCII 与 CRLF，避免 CMD 错拆中文命令', async () => {
  const bytes = await readFile(file);
  assert.ok(bytes.every(byte => byte < 128), 'CMD 启动入口应使用 ASCII，中文提示保留在 Node 和网页中');
  const source = bytes.toString('ascii');
  assert.equal(/(^|[^\r])\n/.test(source), false, 'CMD 文件必须使用 CRLF 换行');
});

test('通过真实 CMD 从其他目录运行启动入口，--check 可完成生成后退出', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `call "${fileURLToPath(file)}" --check`], {
    cwd: os.tmpdir(), input: '\r\n', encoding: 'utf8', timeout: 15000, windowsHide: true, windowsVerbatimArguments: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /extension-local-test/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /not recognized|不是内部或外部命令/);
  assert.doesNotMatch(result.stdout, /本地插件测试指引/, '--check 不能启动常驻服务');
});
