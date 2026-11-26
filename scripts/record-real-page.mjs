import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRecordedPage } from './capture-recorded-page.mjs';
import { inspectPage } from '../extension/page-snapshot.mjs';
import { validateRecordedSample } from './recorded-format.mjs';
import * as policy from '../tests/fixtures/recorded/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'tests/fixtures/recorded');
const proxy = 'http://localhost:3456';
async function request(endpoint, body) {
  const response = await fetch(`${proxy}/${endpoint}`, body === undefined ? {} : { method: 'POST', body, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error('浏览器采集失败，请检查页面连接与登录状态');
  return result;
}
const target = process.argv[2];
if (!/^[A-F0-9]{20,64}$/.test(target || '')) throw new Error('需要工具自行新建的达人页面 targetId；不会自动操作已有标签页');
const kind = process.argv[3] || 'list';
if (!/^(list|chat-0[1-3])$/.test(kind)) throw new Error('样本名称不在允许列表');
const body = `(${captureRecordedPage.toString()})(${inspectPage.toString()},${JSON.stringify(kind)},${JSON.stringify(policy)})`;
const result = await request(`eval?target=${target}`, body);
const sample = validateRecordedSample(result.value);
await mkdir(directory, { recursive: true });
const content = `${JSON.stringify(sample)}\n`;
const filename = `${kind}.json`;
// Captures are versioned rather than overwriting an earlier sample silently.
try { await readFile(path.join(directory, filename)); throw new Error('样本已存在，请先归档旧样本再重新采集'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(path.join(directory, filename), content, 'utf8');
process.stdout.write(`${JSON.stringify({ file: filename, sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), capturedAt: sample.capturedAt, creators: sample.observed.creators.length, chat: !!sample.observed.chat, messages: sample.messageChecks.length, stats: sample.statistics })}\n`);
