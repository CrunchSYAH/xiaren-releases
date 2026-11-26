import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const probe = spawnSync(powershell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
const available = probe.status === 0 && Number(probe.stdout.trim()) >= 5;
const skip = !available && 'Windows PowerShell 5.1 is unavailable';
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const name = manifest.name;
const nextVersion = `${manifest.version.split('.').slice(0, 2).join('.')}.${Number(manifest.version.split('.')[2]) + 1}`;

async function withTemp(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiaren-install-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

async function writeManifest(directory, version, extra = {}) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name, version,
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://seller.shopee.co.id/*'],
    ...extra,
  }), 'utf8');
}

async function buildPackage(directory) {
  const pkg = path.join(directory, 'pkg');
  const extension = path.join(pkg, 'extension');
  await writeManifest(extension, nextVersion);
  for (const file of ['background.mjs', 'dashboard.html', 'dashboard.mjs', 'update.html', 'updater.mjs', 'release-config.mjs']) {
    await writeFile(path.join(extension, file), `// ${file} ${nextVersion}\n`, 'utf8');
  }
  for (const file of ['install.cmd', 'install.ps1', 'update.cmd', 'update.ps1']) {
    await writeFile(path.join(pkg, file), await readFile(path.join(root, 'distribution', file)));
  }
  await writeFile(path.join(pkg, 'release.json'), JSON.stringify({ repository: 'CrunchSYAH/xiaren-releases', version: nextVersion }), 'utf8');
  await writeFile(path.join(pkg, 'README.txt'), 'installer fixture', 'utf8');
  return path.join(pkg, 'install.ps1');
}

async function linkProfile(localAppData, extensionPath) {
  const profile = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default');
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'Preferences'), JSON.stringify({
    extensions: { settings: {
      'abcdefghijklmnopabcdefghijklmnop': { location: 4, path: extensionPath, manifest: { name, version: manifest.version } },
      'ponmlkjihgfedcbaponmlkjihgfedcba': { location: 4, path: path.join(localAppData, 'other-extension'), manifest: { name: '其他扩展', version: '9.9.9' } },
      'storeextensionidentifier000000': { location: 1, path: 'C:\\unused', manifest: { name } },
    } },
  }), 'utf8');
}

function runInstaller(scriptPath, localAppData, args = ['-Yes'], input = '') {
  const env = { ...process.env, LOCALAPPDATA: localAppData };
  return spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    encoding: 'utf8', env, input, timeout: 120_000,
  });
}

test('一键安装：从浏览器配置找到已解压的虾仁，备份旧版后替换且不碰其他目录', { skip }, async () => {
  await withTemp(async directory => {
    const script = await buildPackage(directory);
    const localAppData = path.join(directory, 'local');
    const target = path.join(directory, 'install', 'extension');
    await writeManifest(target, manifest.version);
    await writeFile(path.join(target, 'sentinel.txt'), '旧版遗留文件\n', 'utf8');
    await writeFile(path.join(directory, 'install', 'update.cmd'), '@echo off\n', 'utf8');
    await linkProfile(localAppData, target);

    const result = runInstaller(script, localAppData);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const installed = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
    assert.equal(installed.version, nextVersion);
    assert.equal(await readFile(path.join(target, 'updater.mjs'), 'utf8'), `// updater.mjs ${nextVersion}\n`);
    assert.deepEqual(await readdir(target).then(files => files.includes('sentinel.txt')), false);

    const backups = await readdir(path.join(directory, 'install', 'backups'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], new RegExp(`^extension-v${manifest.version.replaceAll('.', '\\.')}-`));
    const backup = path.join(directory, 'install', 'backups', backups[0]);
    assert.equal(JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8')).version, manifest.version);
    assert.equal(await readFile(path.join(backup, 'sentinel.txt'), 'utf8'), '旧版遗留文件\n');

    // 根目录脚本同步，安装记录可复用；其他扩展目录未被创建或修改。
    for (const file of ['install.cmd', 'install.ps1', 'update.cmd', 'release.json']) {
      assert.ok((await readdir(path.join(directory, 'install'))).includes(file), file);
    }
    const marker = JSON.parse(await readFile(path.join(localAppData, 'Xiaren', 'install.json'), 'utf8'));
    assert.deepEqual(marker.paths, [target]);
    assert.equal(marker.version, nextVersion);
    assert.equal(await readdir(path.join(localAppData, 'other-extension')).then(() => true, () => false), false);
  });
});

test('一键安装：没有已安装记录时装到固定目录并提示加载路径', { skip }, async () => {
  await withTemp(async directory => {
    const script = await buildPackage(directory);
    const localAppData = path.join(directory, 'local');
    const result = runInstaller(script, localAppData);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const installed = path.join(localAppData, 'Xiaren');
    const files = await readdir(installed);
    assert.ok(files.includes('extension'));
    assert.ok(files.includes('install.cmd'));
    assert.equal(JSON.parse(await readFile(path.join(installed, 'extension', 'manifest.json'), 'utf8')).version, nextVersion);
    const marker = JSON.parse(await readFile(path.join(installed, 'install.json'), 'utf8'));
    assert.deepEqual(marker.paths, [path.join(installed, 'extension')]);
  });
});

test('一键安装：拒绝确认时不动任何文件', { skip }, async () => {
  await withTemp(async directory => {
    const script = await buildPackage(directory);
    const localAppData = path.join(directory, 'local');
    const target = path.join(directory, 'install', 'extension');
    await writeManifest(target, manifest.version);
    await writeFile(path.join(target, 'sentinel.txt'), 'keep\n', 'utf8');
    await linkProfile(localAppData, target);

    const result = runInstaller(script, localAppData, [], 'n\n');
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')).version, manifest.version);
    assert.equal(await readFile(path.join(target, 'sentinel.txt'), 'utf8'), 'keep\n');
    assert.equal(await readdir(path.join(directory, 'install', 'backups')).then(() => true, () => false), false);
  });
});

test('一键安装：记录只在 Secure Preferences 且 manifest 为空时也能定位（真实 Chrome 情形）', { skip }, async () => {
  await withTemp(async directory => {
    const script = await buildPackage(directory);
    const localAppData = path.join(directory, 'local');
    const target = path.join(directory, 'install', 'extension');
    await writeManifest(target, manifest.version);
    const profile = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Profile 1');
    await mkdir(profile, { recursive: true });
    await writeFile(path.join(profile, 'Preferences'), JSON.stringify({ extensions: { settings: {} } }), 'utf8');
    await writeFile(path.join(profile, 'Secure Preferences'), JSON.stringify({
      extensions: { settings: {
        'abcdefghijklmnopabcdefghijklmnop': { location: 4, path: target, manifest: {} },
      } },
    }), 'utf8');

    const result = runInstaller(script, localAppData);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')).version, nextVersion);
    const backups = await readdir(path.join(directory, 'install', 'backups'));
    assert.equal(backups.length, 1);
  });
});
