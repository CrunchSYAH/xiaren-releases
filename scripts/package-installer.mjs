// Builds the hand-distributed one-click installer. The official release archive
// keeps its original shape, because an already installed 0.1.3 rejects unknown
// root entries; the installer only needs to exist next to the extension folder.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releaseRepository } from '../extension/release-config.mjs';
import { createZip } from './zip-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== packageInfo.version) throw new Error('manifest 与 package.json 版本不一致。');
const version = manifest.version;
const staging = path.join(root, 'artifacts', `installer-v${version}-${Date.now()}`);
const entries = [];

async function collect(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const target = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await collect(target);
    else if (!/\.(?:mjs|js|html|css|json|png|svg|txt)$/.test(entry.name)) throw new Error(`安装包不接受该文件类型：${target}`);
    else entries.push([target, await readFile(path.join(root, target))]);
  }
}

await mkdir(path.join(staging, 'extension'), { recursive: true });
await collect('extension');
for (const name of ['install.cmd', 'install.ps1', 'update.cmd', 'update.ps1']) {
  entries.push([name, await readFile(path.join(root, 'distribution', name))]);
}
entries.push(['release.json', Buffer.from(JSON.stringify({ repository: releaseRepository, version }, null, 2))]);
entries.push(['README.txt', Buffer.from('\ufeff' + [
  `虾仁 v${version} · 一键安装包`,
  '',
  '更新（已安装过的机器）：先在所有店铺结束任务、关闭工作台页面，然后双击本目录的 install.cmd。',
  '脚本会自动找到 Chrome/Edge 里已加载的虾仁目录，备份旧版并替换，最后提示你去 chrome://extensions 点“重新加载”。',
  '',
  '首次安装：双击 install.cmd，脚本会把扩展装到 %LOCALAPPDATA%\\Xiaren 并告诉你下一步怎么加载。',
  '',
  '注意：不要卸载扩展、不要更换安装文件夹，否则扩展 ID 会变化，原有的发送记录、任务历史和模板会读不到。',
  '旧版会保留在同一目录的 backups 文件夹，出问题可以直接换回去。',
  '',
  '以后更新不必再收压缩包：工作台 →“检查更新”→“自动更新”。',
  `发布地址：https://github.com/${releaseRepository}/releases/latest`,
].join('\r\n'), 'utf8')]);

const zip = path.join(root, 'artifacts', `xiaren-installer-v${version}.zip`);
await createZip(zip, entries);
const digest = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(`${zip}.sha256`, `${digest}  ${path.basename(zip)}\n`, { flag: 'wx' });
await rm(staging, { recursive: true, force: true });
console.log(JSON.stringify({ version, zip, files: entries.length, sha256: digest }, null, 2));
