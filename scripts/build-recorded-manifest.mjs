import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRecordedSample } from './recorded-format.mjs';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/recorded');
const cases = [];
for (const name of ['list', 'chat-01', 'chat-02', 'chat-03']) {
  const file = `${name}.json`, content = await readFile(path.join(directory, file), 'utf8');
  const sample = validateRecordedSample(JSON.parse(content));
  cases.push({ name, file, sha256: createHash('sha256').update(content).digest('hex'), capturedAt: sample.capturedAt, creators: sample.observed.creators.length, recipientId: sample.observed.chat?.recipientId || null, messageSamples: sample.messageChecks.length, emptyWatermark: sample.observed.chat ? sample.observed.chat.latestMessageId === null : null });
}
const manifest = { version: 1, sourceKind: 'real-rendered-dom-and-whitelisted-runtime', cases, missingEvidence: ['历史消息样本', '真实成功/失败回执', '网络发送过程', '平台验证和风控行为'], redactions: ['账号与达人身份', '聊天文本及草稿', '资源与跳转地址', '原站脚本和事件', '头像及远程字体'], replay: '真实结构与白名单属性链机械恢复；交互和发送由离线测试替身提供' };
await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`已校验 ${cases.length} 份真实脱敏样本；未采到的回执明确列为缺口。\n`);
