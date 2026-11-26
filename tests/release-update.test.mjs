import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../scripts/zip-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const powershellProbe = spawnSync(powershell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
});
const powershellAvailable = powershellProbe.status === 0 && Number(powershellProbe.stdout.trim()) >= 5;
const repository = 'CrunchSYAH/xiaren-releases';
const currentVersion = '0.1.2';
const nextVersion = '0.1.3';
const extensionKey = 'BASE64-ENCODED-EXTENSION-KEY-FIXTURE';
const rootFiles = ['update.ps1', 'update.cmd', 'release.json', 'README.txt'];
const packageRootFiles = [...rootFiles].sort();

function runPowerShell(scriptPath, args = [], input = '', extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // pwsh's inherited module path can hide Windows PowerShell 5.1 inbox modules.
  delete env.PSModulePath;
  return spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    cwd: path.dirname(scriptPath),
    encoding: 'utf8',
    env,
    input,
    timeout: 30_000,
  });
}

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiaren-release-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function walkFiles(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(directory, child));
    else files.push(child);
  }
  return files;
}

async function snapshotInstall(installRoot) {
  const targets = new Map();
  for (const relative of rootFiles) {
    const bytes = await readFile(path.join(installRoot, relative));
    targets.set(relative, createHash('sha256').update(bytes).digest('hex'));
  }
  const extensionPath = path.join(installRoot, 'extension');
  for (const relative of await walkFiles(extensionPath)) {
    const bytes = await readFile(path.join(extensionPath, relative));
    targets.set(path.posix.join('extension', relative), createHash('sha256').update(bytes).digest('hex'));
  }
  return targets;
}

function assertFailure(result, expectedMessage) {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, `Expected failure "${expectedMessage}", got exit ${result.status}:\n${output}`);
  assert.ok(output.includes(expectedMessage), `Expected exact error "${expectedMessage}" in:\n${output}`);
}

async function createPackage(directory, {
  version = nextVersion,
  repositoryName = repository,
  manifestChanges = {},
  releaseChanges = {},
  extraEntries = [],
} = {}) {
  const extension = {
    manifest_version: 3,
    name: '虾仁 · 印尼达人建联',
    version,
    key: extensionKey,
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://seller.shopee.co.id/*', 'https://api.github.com/*', 'https://github.com/*', 'https://objects.githubusercontent.com/*', 'https://release-assets.githubusercontent.com/*'],
    ...manifestChanges,
  };
  const entries = [
    ['extension/manifest.json', JSON.stringify(extension)],
    ['extension/background.mjs', 'export {};'],
    ['extension/dashboard.html', '<!doctype html>'],
    ['extension/dashboard.mjs', 'export {};'],
    ['extension/update.html', '<!doctype html>'],
    ['extension/updater.mjs', 'export {};'],
    ['extension/release-config.mjs', `export const releaseRepository = '${repositoryName}';`],
    ['update.cmd', '@echo off\nrem new updater launcher'],
    ['update.ps1', '# new updater script'],
    ['release.json', JSON.stringify({ repository: repositoryName, version, ...releaseChanges })],
    ['README.txt', 'Updated release fixture'],
    ...extraEntries,
  ];
  const archivePath = path.join(directory, 'package.zip');
  await createZip(archivePath, entries);
  const bytes = await readFile(archivePath);
  const checksumPath = `${archivePath}.sha256`;
  await writeFile(checksumPath, `${createHash('sha256').update(bytes).digest('hex')}  package.zip\n`);
  return { archivePath, checksumPath };
}

async function createInstallation(directory) {
  const installRoot = path.join(directory, 'install');
  const extensionPath = path.join(installRoot, 'extension');
  await mkdir(extensionPath, { recursive: true });
  await writeFile(path.join(installRoot, 'release.json'), JSON.stringify({ repository }));
  await writeFile(path.join(installRoot, 'update.ps1'), 'original updater script\n');
  await writeFile(path.join(installRoot, 'update.cmd'), '@echo off\nrem original updater launcher\n');
  await writeFile(path.join(installRoot, 'README.txt'), 'Original installation instructions\n');
  await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: '虾仁 · 印尼达人建联',
    version: currentVersion,
    key: extensionKey,
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://seller.shopee.co.id/*', 'https://api.github.com/*', 'https://github.com/*', 'https://objects.githubusercontent.com/*', 'https://release-assets.githubusercontent.com/*'],
  }));
  await writeFile(path.join(extensionPath, 'background.mjs'), 'original background\n');
  await writeFile(path.join(extensionPath, 'sentinel.txt'), 'original installation\n');
  await writeFile(path.join(installRoot, 'update.ps1'), await readFile(path.join(root, 'distribution/update.ps1')));
  return { installRoot, extensionPath, updaterPath: path.join(installRoot, 'update.ps1') };
}

async function runOfflineUpdate(install, bundle, wrapperPath) {
  return runPowerShell(wrapperPath || install.updaterPath,
    wrapperPath ? [install.updaterPath, bundle.archivePath, bundle.checksumPath] : [bundle.archivePath, bundle.checksumPath],
    'UPDATE\r\n',
    wrapperPath ? { XIAREN_TEST_UPDATER: install.updaterPath } : {});
}

test('更新入口指向固定公开仓库并只显示扩展版本，不包含访问凭证或本机路径', async () => {
  const config = await readFile(path.join(root, 'extension/release-config.mjs'), 'utf8');
  assert.match(config, /releaseRepository\s*=\s*['"]CrunchSYAH\/xiaren-releases['"]/);
  assert.doesNotMatch(config, /(?:token|password|secret|gh[pousr]_[A-Za-z0-9_]+)/i);

  const updateSource = await readFile(path.join(root, 'extension/update.mjs'), 'utf8');
  assert.match(updateSource, /getManifest\?\.\(\)\.version/);
  assert.match(updateSource, /https:\/\/github\.com\/\$\{releaseRepository\}\/releases\/latest/);
  assert.doesNotMatch(updateSource, /(?:https?:\/\/[^'"\s]*token|[A-Za-z]:\\Users\\)/i);
  const html = await readFile(path.join(root, 'extension/update.html'), 'utf8');
  assert.match(html, /id="extension-version"/);
  assert.match(html, /latest-release/);
  assert.match(await readFile(path.join(root, 'extension/dashboard.html'), 'utf8'), /href="update\.html"/);

  const packageScript = await readFile(path.join(root, 'scripts/package-release.mjs'), 'utf8');
  assert.match(packageScript, /svg/);
});

test('PowerShell 5.1 更新器拒绝坏校验和同版本或旧版本，且安装五项完全不变', {
  skip: !powershellAvailable && 'Windows PowerShell 5.1 is unavailable',
}, async () => {
  await withTempDirectory(async directory => {
    for (const version of [currentVersion, '0.1.1']) {
      const scenario = path.join(directory, version);
      await mkdir(scenario);
      const install = await createInstallation(scenario);
      const before = await snapshotInstall(install.installRoot);
      const bundle = await createPackage(scenario, { version });
      const result = await runOfflineUpdate(install, bundle);
      assertFailure(result, 'Refusing to install the same or an older version.');
      assert.deepEqual(await snapshotInstall(install.installRoot), before);
      assert.deepEqual(await readdir(path.join(install.installRoot, 'backups')).catch(() => []), []);
    }

    const scenario = path.join(directory, 'bad-checksum');
    await mkdir(scenario);
    const install = await createInstallation(scenario);
    const before = await snapshotInstall(install.installRoot);
    const bundle = await createPackage(scenario);
    await writeFile(bundle.checksumPath, `${'0'.repeat(64)}  package.zip\n`);
    assertFailure(await runOfflineUpdate(install, bundle), 'Checksum mismatch. Installation was not changed.');
    assert.deepEqual(await snapshotInstall(install.installRoot), before);

    const missingChecksumDirectory = path.join(directory, 'missing-checksum');
    await mkdir(missingChecksumDirectory);
    const missingChecksum = await createPackage(missingChecksumDirectory);
    assertFailure(
      await runPowerShell(install.updaterPath, [missingChecksum.archivePath], 'UPDATE\r\n'),
      'A SHA256 checksum file is required.',
    );
    assert.deepEqual(await snapshotInstall(install.installRoot), before);
  });
});

test('拒绝 ZIP 路径穿越、仓库身份不符和所有新增扩展权限入口，均不改安装文件', {
  skip: !powershellAvailable && 'Windows PowerShell 5.1 is unavailable',
}, async () => {
  const invalidPackages = [
    {
      label: 'zip traversal',
      options: { extraEntries: [['extension/../../escaped.txt', 'must not escape']] },
      message: 'Unsafe package path.',
    },
    {
      label: 'repository mismatch',
      options: { repositoryName: 'attacker/other-repo' },
      message: 'Package identity mismatch.',
    },
    {
      label: 'optional_permissions',
      options: { manifestChanges: { optional_permissions: ['downloads'] } },
      message: 'Unexpected manifest field: optional_permissions',
    },
    {
      label: 'optional_host_permissions',
      options: { manifestChanges: { optional_host_permissions: ['<all_urls>'] } },
      message: 'Unexpected manifest field: optional_host_permissions',
    },
    {
      label: 'content_scripts',
      options: { manifestChanges: { content_scripts: [{ matches: ['<all_urls>'], js: ['injected.js'] }] } },
      message: 'Unexpected manifest field: content_scripts',
    },
    {
      label: 'externally_connectable',
      options: { manifestChanges: { externally_connectable: { matches: ['<all_urls>'] } } },
      message: 'Unexpected manifest field: externally_connectable',
    },
    {
      label: 'update_url',
      options: { manifestChanges: { update_url: 'https://example.invalid/updates.xml' } },
      message: 'Unexpected manifest field: update_url',
    },
    {
      label: 'extension key changed',
      options: { manifestChanges: { key: 'DIFFERENT-EXTENSION-KEY' } },
      message: 'Extension key must not change.',
    },
    {
      label: 'unexpected required permission',
      options: { manifestChanges: { permissions: ['storage', 'scripting', 'downloads'] } },
      message: 'Unexpected extension identity or permissions.',
    },
  ];

  await withTempDirectory(async directory => {
    for (const scenario of invalidPackages) {
      const fixture = path.join(directory, scenario.label);
      await mkdir(fixture);
      const install = await createInstallation(fixture);
      const before = await snapshotInstall(install.installRoot);
      const bundle = await createPackage(fixture, scenario.options);
      assertFailure(await runOfflineUpdate(install, bundle), scenario.message);
      assert.deepEqual(await snapshotInstall(install.installRoot), before, scenario.label);
      assert.deepEqual(await readdir(path.join(install.installRoot, 'backups')).catch(() => []), [], scenario.label);
      assert.equal(await readFile(path.join(directory, 'escaped.txt')).then(() => true, () => false), false);
    }
  });
});

test('成功事务备份 extension 与四个根文件，并将新版写回固定安装路径', {
  skip: !powershellAvailable && 'Windows PowerShell 5.1 is unavailable',
}, async () => {
  await withTempDirectory(async directory => {
    const install = await createInstallation(directory);
    const bundle = await createPackage(directory);
    const before = await snapshotInstall(install.installRoot);
    const result = await runOfflineUpdate(install, bundle);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    assert.equal(JSON.parse(await readFile(path.join(install.extensionPath, 'manifest.json'), 'utf8')).version, nextVersion);
    assert.equal(await readFile(path.join(install.extensionPath, 'background.mjs'), 'utf8'), 'export {};');
    assert.equal(await readFile(path.join(install.installRoot, 'update.ps1'), 'utf8'), '# new updater script');
    assert.equal(await readFile(path.join(install.installRoot, 'update.cmd'), 'utf8'), '@echo off\nrem new updater launcher');
    assert.deepEqual(JSON.parse(await readFile(path.join(install.installRoot, 'release.json'), 'utf8')), {
      repository,
      version: nextVersion,
    });
    assert.equal(await readFile(path.join(install.installRoot, 'README.txt'), 'utf8'), 'Updated release fixture');

    const backups = await readdir(path.join(install.installRoot, 'backups'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^v0\.1\.2-/);
    const backupPath = path.join(install.installRoot, 'backups', backups[0]);
    assert.equal(JSON.parse(await readFile(path.join(backupPath, 'extension/manifest.json'), 'utf8')).version, currentVersion);
    assert.equal(await readFile(path.join(backupPath, 'extension/sentinel.txt'), 'utf8'), 'original installation\n');
    assert.equal(await readFile(path.join(backupPath, 'update.ps1'), 'utf8'), await readFile(path.join(root, 'distribution/update.ps1'), 'utf8'));
    assert.equal(await readFile(path.join(backupPath, 'update.cmd'), 'utf8'), '@echo off\nrem original updater launcher\n');
    assert.equal(await readFile(path.join(backupPath, 'README.txt'), 'utf8'), 'Original installation instructions\n');
    assert.equal(JSON.parse(await readFile(path.join(backupPath, 'release.json'), 'utf8')).repository, repository);
    const backupContents = await readdir(backupPath);
    assert.deepEqual(new Set(backupContents), new Set(['extension', ...packageRootFiles]));
    assert.match(result.stdout, /Reload Xiaren in chrome:\/\/extensions in EVERY Chrome profile/);
  });
});

test('确认离线更新哈希与发布 SHA256 一致，并在替换 Move-Item 失败后回滚', {
  skip: !powershellAvailable && 'Windows PowerShell 5.1 is unavailable',
}, async () => {
  await withTempDirectory(async directory => {
    const install = await createInstallation(directory);
    const before = await snapshotInstall(install.installRoot);
    const bundle = await createPackage(directory);
    const expectedDigest = createHash('sha256').update(await readFile(bundle.archivePath)).digest('hex');
    const checksumBytes = Buffer.from(`${expectedDigest}  package.zip\n`, 'ascii');
    await writeFile(bundle.checksumPath, checksumBytes);
    const wrapperPath = path.join(directory, 'inject-move-failure.ps1');
    await writeFile(wrapperPath, [
      'function Move-Item {',
      '  [CmdletBinding()]',
      '  param([string]$LiteralPath, [string]$Destination)',
      '  Write-Output ("move:" + $LiteralPath + " -> " + $Destination)',
      '  if ($LiteralPath -like "*\\stage\\README.txt" -and $Destination -eq (Join-Path (Split-Path $env:XIAREN_TEST_UPDATER) "README.txt")) {',
      '    throw "Injected Move-Item failure for README.txt"',
      '  }',
      '  Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination',
      '}',
      '& $env:XIAREN_TEST_UPDATER $args[1] $args[2]',
      'if ($null -eq $LASTEXITCODE) { exit 0 }',
      'exit $LASTEXITCODE',
    ].join('\r\n'));
    const result = await runOfflineUpdate(install, bundle, wrapperPath);
    assertFailure(result, 'Injected Move-Item failure for README.txt');
    assert.deepEqual(await snapshotInstall(install.installRoot), before);
    const backups = await readdir(path.join(install.installRoot, 'backups'));
    assert.equal(backups.length, 1);
    assert.deepEqual(await readdir(path.join(install.installRoot, 'backups', backups[0])), []);
  });
});

test('README 安装与新 extension 移除同时失败时继续恢复其他文件并保留人工恢复材料', {
  skip: !powershellAvailable && 'Windows PowerShell 5.1 is unavailable',
}, async () => {
  await withTempDirectory(async directory => {
    const install = await createInstallation(directory);
    const bundle = await createPackage(directory);
    const wrapperPath = path.join(directory, 'inject-recovery-failure.ps1');
    await writeFile(wrapperPath, [
      'function Move-Item {',
      '  [CmdletBinding()]',
      '  param([string]$LiteralPath, [string]$Destination)',
      '  if ($LiteralPath -like "*\\stage\\README.txt" -and $Destination -eq (Join-Path (Split-Path $env:XIAREN_TEST_UPDATER) "README.txt")) {',
      '    throw "Injected install failure for README.txt"',
      '  }',
      '  if ($LiteralPath -eq (Join-Path (Split-Path $env:XIAREN_TEST_UPDATER) "extension") -and $Destination -like "*\\failed-extension") {',
      '    throw "Injected recovery failure for extension"',
      '  }',
      '  Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination',
      '}',
      '& $env:XIAREN_TEST_UPDATER $args[1] $args[2]',
      'if ($null -eq $LASTEXITCODE) { exit 0 }',
      'exit $LASTEXITCODE',
    ].join('\r\n'));

    const result = await runOfflineUpdate(install, bundle, wrapperPath);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Recovery incomplete.'), `Expected recovery warning in stderr:\n${result.stderr}`);
    assert.ok(result.stderr.includes(path.join(install.installRoot, 'backups')), 'stderr should identify the backup location');

    assert.equal(await readFile(path.join(install.installRoot, 'update.cmd'), 'utf8'), '@echo off\nrem original updater launcher\n');
    assert.deepEqual(JSON.parse(await readFile(path.join(install.installRoot, 'release.json'), 'utf8')), { repository });
    assert.equal(await readFile(path.join(install.installRoot, 'update.ps1'), 'utf8'), await readFile(path.join(root, 'distribution/update.ps1'), 'utf8'));
    assert.equal(await readFile(path.join(install.installRoot, 'README.txt'), 'utf8'), 'Original installation instructions\n');

    assert.equal(JSON.parse(await readFile(path.join(install.extensionPath, 'manifest.json'), 'utf8')).version, nextVersion);
    assert.equal(await readFile(path.join(install.extensionPath, 'background.mjs'), 'utf8'), 'export {};');
    const backups = await readdir(path.join(install.installRoot, 'backups'));
    assert.equal(backups.length, 1);
    const backupPath = path.join(install.installRoot, 'backups', backups[0]);
    assert.ok(result.stderr.includes(backupPath), 'stderr should identify the exact retained backup directory');
    assert.deepEqual(await readdir(backupPath), ['extension']);
    assert.equal(JSON.parse(await readFile(path.join(backupPath, 'extension/manifest.json'), 'utf8')).version, currentVersion);
    assert.equal(await readFile(path.join(backupPath, 'extension/sentinel.txt'), 'utf8'), 'original installation\n');
  });
});
