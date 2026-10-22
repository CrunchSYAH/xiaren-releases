import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { releaseRepository } from '../extension/release-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository)) throw new Error('Configure a verified release repository first.');
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== packageInfo.version) throw new Error('Version mismatch.');
const version = manifest.version;
const folder = path.join(root, 'artifacts', `release-v${version}-${Date.now()}`);
await mkdir(path.join(folder, 'extension'), { recursive: true });
async function copyExtension(relative = '') {
  for (const entry of await readdir(path.join(root, 'extension', relative), { withFileTypes: true })) {
    const target = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in release packages.');
    if (entry.isDirectory()) {
      await mkdir(path.join(folder, 'extension', target));
      await copyExtension(target);
    } else {
      if (!/\.(?:mjs|js|html|css|json|png|svg|txt)$/.test(entry.name)) throw new Error(`Unexpected release file: ${target}`);
      await writeFile(path.join(folder, 'extension', target), await readFile(path.join(root, 'extension', target)), { flag: 'wx' });
    }
  }
}
await copyExtension();
for (const name of ['update.cmd', 'update.ps1']) {
  await writeFile(path.join(folder, name), await readFile(path.join(root, 'distribution', name)), { flag: 'wx' });
}
await writeFile(path.join(folder, 'release.json'), JSON.stringify({ repository: releaseRepository, version }, null, 2), { flag: 'wx' });
await writeFile(path.join(folder, 'README.txt'), '\ufeff' + [
  `虾仁 v${version}`,
  '首次安装：完整解压到固定目录，Chrome 开发者模式加载其中的 extension 文件夹。',
  '更新：所有 profile 的任务结束后，在原安装目录双击 update.cmd，输入 UPDATE。',
  '脚本下载最新正式版、校验 SHA256，保留旧版在 backups 文件夹。',
  '随后在每个 profile 的 chrome://extensions 中点击虾仁的“重新加载”。',
  '保持安装目录不变，不卸载扩展；本地数据由各 profile 独立保存。',
  '真实 Shopee 发送、发图及双 profile 实机运行仍未验收。',
  `发布地址：https://github.com/${releaseRepository}/releases/latest`,
].join('\r\n'), { flag: 'wx' });
const zip = path.join(path.dirname(folder), `xiaren-chrome-v${version}.zip`);
const ps = "$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $env:XIAREN_STAGE '*') -DestinationPath $env:XIAREN_ZIP -CompressionLevel Optimal";
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
  env: { ...process.env, XIAREN_STAGE: folder, XIAREN_ZIP: zip }, encoding: 'utf8',
});
if (result.status !== 0) throw new Error(result.stderr || 'Packaging failed; existing packages are never overwritten.');
const digest = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(`${zip}.sha256`, `${digest}  ${path.basename(zip)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ version, folder, zip, sha256: digest }, null, 2));
