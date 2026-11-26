import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createZip } from '../scripts/zip-utils.mjs';
import {
  parseVersion, compareVersions, selectRelease, releaseAssetName, parseChecksum, verifyArchive,
  readArchive, planInstall, validateManifest, downloadAsset, fetchLatestRelease, resolveLatestRelease, releaseFromTag, sha256Hex, pathSegments, UpdaterError,
} from '../extension/updater.mjs';

const repository = 'CrunchSYAH/xiaren-releases';
const current = {
  manifest_version: 3,
  name: '虾仁 · 印尼达人建联',
  version: '0.1.2',
  key: 'BASE64-KEY',
  permissions: ['storage', 'scripting'],
  host_permissions: ['https://seller.shopee.co.id/*', 'https://api.github.com/*', 'https://github.com/*', 'https://objects.githubusercontent.com/*', 'https://release-assets.githubusercontent.com/*'],
};
const nextManifest = overrides => ({ ...current, version: '0.1.3', ...overrides });

function release(version = '0.1.3', overrides = {}) {
  const tag = `v${version}`, name = releaseAssetName(version);
  const base = `https://github.com/${repository}/releases/download/${tag}/`;
  return {
    tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    assets: [
      { name, size: 2048, browser_download_url: base + name },
      { name: `${name}.sha256`, size: 80, browser_download_url: base + `${name}.sha256` },
    ],
    ...overrides,
  };
}

async function zipOf(entries) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiaren-updater-'));
  try {
    const archive = path.join(directory, 'package.zip');
    await createZip(archive, entries);
    return new Uint8Array(await readFile(archive));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const requiredEntries = (manifest = nextManifest()) => [
  ['extension/manifest.json', JSON.stringify(manifest)],
  ['extension/background.mjs', 'export {};'],
  ['extension/dashboard.html', '<!doctype html>'],
  ['extension/dashboard.mjs', 'export {};'],
  ['extension/update.html', '<!doctype html>'],
  ['extension/updater.mjs', 'export {};'],
  ['extension/release-config.mjs', `export const releaseRepository = '${repository}';`],
  ['update.cmd', '@echo off'], ['update.ps1', '# updater'], ['release.json', '{}'], ['README.txt', 'readme'],
];

test('版本号解析与比较拒绝非三段数字', () => {
  assert.deepEqual(parseVersion(' 1.2.3 '), [1, 2, 3]);
  for (const value of ['1.2', 'v1.2.3', '1.2.3-beta', '', null, 12]) assert.equal(parseVersion(value), null);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.1.2', '0.1.2'), 0);
  assert.equal(compareVersions('1.0.0', '2.0.1'), -1);
  assert.throws(() => compareVersions('x', '1.0.0'), UpdaterError);
});

test('安装包路径按段拆分，供目录句柄逐级下钻，拒绝空段与上行', () => {
  assert.deepEqual(pathSegments('core/backend.mjs'), ['core', 'backend.mjs']);
  assert.deepEqual(pathSegments('icons/shrimp-16.png'), ['icons', 'shrimp-16.png']);
  assert.deepEqual(pathSegments('manifest.json'), ['manifest.json']);
  assert.throws(() => pathSegments('core//x.mjs'), UpdaterError);
  assert.throws(() => pathSegments('../x.mjs'), UpdaterError);
  assert.throws(() => pathSegments('core/../x.mjs'), UpdaterError);
  assert.throws(() => pathSegments(''), UpdaterError);
});

test('只接受正式发布与仓库自身的两个下载地址，同版本视为已最新', () => {
  const selected = selectRelease(release(), '0.1.2', repository);
  assert.equal(selected.version, '0.1.3'); assert.equal(selected.upToDate, false);
  assert.equal(selected.name, 'xiaren-chrome-v0.1.3.zip');
  assert.ok(selected.zipUrl.endsWith('/v0.1.3/xiaren-chrome-v0.1.3.zip'));
  assert.equal(selectRelease(release('0.1.2'), '0.1.2', repository).upToDate, true);
  assert.equal(selectRelease(release('0.1.1'), '0.1.2', repository).upToDate, true);
  assert.throws(() => selectRelease(release('0.1.3', { draft: true }), '0.1.2', repository), /正式/);
  assert.throws(() => selectRelease(release('0.1.3', { prerelease: true }), '0.1.2', repository), /正式/);
  assert.throws(() => selectRelease({ ...release(), tag_name: 'latest' }, '0.1.2', repository), /版本号/);
  const foreign = release();
  foreign.assets[0].browser_download_url = 'https://evil.example.com/xiaren-chrome-v0.1.3.zip';
  assert.throws(() => selectRelease(foreign, '0.1.2', repository), /安装包或校验/);
  const missing = release();
  missing.assets = missing.assets.slice(0, 1);
  assert.throws(() => selectRelease(missing, '0.1.2', repository), /安装包或校验/);
});

test('校验文件必须匹配安装包名称，哈希不符时不写入任何内容', async () => {
  const bytes = new TextEncoder().encode('package');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(parseChecksum(`${digest}  xiaren-chrome-v0.1.3.zip`, 'xiaren-chrome-v0.1.3.zip'), digest);
  assert.throws(() => parseChecksum('not-a-digest  file.zip', 'file.zip'), /校验文件格式/);
  assert.throws(() => parseChecksum(`${digest}  other.zip`, 'file.zip'), /不匹配/);
  assert.equal(await sha256Hex(bytes), digest);
  await verifyArchive(bytes, `${digest}  xiaren-chrome-v0.1.3.zip`, 'xiaren-chrome-v0.1.3.zip');
  await assert.rejects(verifyArchive(bytes, `${'0'.repeat(64)}  xiaren-chrome-v0.1.3.zip`, 'xiaren-chrome-v0.1.3.zip'), /校验失败/);
});

test('解压只读取 deflate 条目，拒绝路径穿越与损坏目录', async () => {
  const archive = await zipOf(requiredEntries());
  const files = await readArchive(archive);
  assert.equal(files.size, requiredEntries().length);
  assert.equal(new TextDecoder().decode(files.get('extension/background.mjs')), 'export {};');
  await assert.rejects(readArchive(archive.subarray(0, 40)), /有效的 ZIP/);
  const traversal = await zipOf([...requiredEntries(), ['extension/../escape.txt', 'x']]);
  await assert.rejects(readArchive(traversal), /不安全路径/);
});

test('安装计划只取 extension 目录，并核对身份、权限与版本', async () => {
  const files = await readArchive(await zipOf([...requiredEntries(), ['extension/icons/shrimp-16.png', 'png']]));
  const plan = planInstall(files, current);
  assert.equal(plan.version, '0.1.3');
  assert.ok(plan.files.has('manifest.json'));
  assert.ok(plan.files.has('icons/shrimp-16.png'));
  assert.equal(plan.files.has('update.cmd'), false);
  assert.equal(plan.files.has('release.json'), false);
  assert.throws(() => planInstall(new Map(), current), /为空/);
  assert.throws(() => validateManifest(nextManifest({ permissions: ['storage', 'scripting', 'downloads'] }), current), /未审阅的扩展权限/);
  assert.throws(() => validateManifest(nextManifest({ host_permissions: ['<all_urls>'] }), current), /未审阅的站点权限/);
  assert.throws(() => validateManifest(nextManifest({ content_scripts: [] }), current), /不允许的清单字段/);
  assert.throws(() => validateManifest(nextManifest({ name: '其他扩展' }), current), /名称/);
  assert.throws(() => validateManifest({ ...current, version: '0.1.2' }, current), /不高于/);
  assert.throws(() => validateManifest(nextManifest({ key: 'OTHER' }), current), /密钥/);
});

test('安装包缺失关键文件或包含未知路径时整体拒绝', async () => {
  const incomplete = await readArchive(await zipOf(requiredEntries().filter(([name]) => name !== 'extension/dashboard.mjs')));
  assert.throws(() => planInstall(incomplete, current), /缺少 dashboard\.mjs/);
  const unknownType = await readArchive(await zipOf([...requiredEntries(), ['extension/evil.exe', 'x']]));
  assert.throws(() => planInstall(unknownType, current), /未知文件类型/);
  const outside = await readArchive(await zipOf([...requiredEntries(), ['other/app.mjs', 'x']]));
  assert.throws(() => planInstall(outside, current), /未知路径/);
});

test('下载只允许发布仓库域名，并拒绝空内容与超限内容', async () => {
  const ok = async () => new Response(new Uint8Array(16), { status: 200 });
  await assert.rejects(downloadAsset('https://evil.example.com/a.zip', 1024, ok), /不属于发布仓库/);
  assert.equal((await downloadAsset('https://github.com/x/y/releases/download/v1/a.zip', 1024, ok)).length, 16);
  await assert.rejects(downloadAsset('https://github.com/x.zip', 1024, async () => new Response(new Uint8Array(0), { status: 200 })), /为空/);
  await assert.rejects(downloadAsset('https://github.com/x.zip', 8, ok), /超出大小上限/);
  await assert.rejects(downloadAsset('https://github.com/x.zip', 1024, async () => new Response('no', { status: 404 })), /HTTP 404/);
  await assert.rejects(fetchLatestRelease(async () => new Response('no', { status: 500 })), /HTTP 500/);
  const body = JSON.stringify(release());
  assert.equal((await fetchLatestRelease(async () => new Response(body, { status: 200 }))).tag_name, 'v0.1.3');
});

test('从 0.1.2 升级到新增的更新域名允许，减少权限或未审阅域名仍拒绝', async () => {
  const legacy = { ...current, host_permissions: ['https://seller.shopee.co.id/*'] };
  const files = await readArchive(await zipOf(requiredEntries()));
  const plan = planInstall(files, legacy);
  assert.equal(plan.version, '0.1.3');
  assert.deepEqual(plan.manifest.host_permissions, current.host_permissions);
  assert.throws(() => validateManifest(nextManifest({ host_permissions: ['https://seller.shopee.co.id/*'] }), current), /移除了当前已授予的站点权限/);
  assert.throws(() => validateManifest(nextManifest({ permissions: ['storage'] }), current), /移除了当前已授予的扩展权限/);
  assert.throws(() => validateManifest(nextManifest({ host_permissions: [...current.host_permissions, 'https://evil.example.com/*'] }), current), /未审阅的站点权限/);
});

test('Windows 压缩工具写入的反斜杠条目名可解压为同一路径', async () => {
  const archive = await zipOf(requiredEntries());
  const u16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  const copy = archive.slice();
  let end = -1;
  for (let offset = copy.length - 22; offset >= 0; offset--) if (u32(copy, offset) === 0x06054b50) { end = offset; break; }
  const total = u16(copy, end + 10);
  const ranges = [];
  let cursor = u32(copy, end + 16);
  for (let index = 0; index < total; index++) {
    const nameLength = u16(copy, cursor + 28), extraLength = u16(copy, cursor + 30), commentLength = u16(copy, cursor + 32);
    const localOffset = u32(copy, cursor + 42);
    ranges.push([cursor + 46, nameLength], [localOffset + 30, u16(copy, localOffset + 26)]);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  for (const [start, length] of ranges) for (let index = start; index < start + length; index++) if (copy[index] === 0x2f) copy[index] = 0x5c;
  const files = await readArchive(copy);
  assert.equal(files.size, requiredEntries().length);
  assert.equal(new TextDecoder().decode(files.get('extension/background.mjs')), 'export {};');
  const escaped = await zipOf([...requiredEntries(), ['extension/../escape.txt', 'x']]);
  await assert.rejects(readArchive(escaped), /不安全路径/);
});

test('用发布页跳转解析版本，不依赖 api.github.com 配额', async () => {
  const page = url => async () => ({ ok: true, status: 200, url, body: { cancel: async () => {} } });
  const found = await resolveLatestRelease('0.1.3', page('https://github.com/CrunchSYAH/xiaren-releases/releases/tag/v0.1.4'));
  assert.equal(found.version, '0.1.4');
  assert.equal(found.upToDate, false);
  assert.equal(found.zipUrl, 'https://github.com/CrunchSYAH/xiaren-releases/releases/download/v0.1.4/xiaren-chrome-v0.1.4.zip');
  assert.equal(found.checksumUrl, 'https://github.com/CrunchSYAH/xiaren-releases/releases/download/v0.1.4/xiaren-chrome-v0.1.4.zip.sha256');
  assert.equal((await resolveLatestRelease('0.1.4', page('https://github.com/CrunchSYAH/xiaren-releases/releases/tag/v0.1.4'))).upToDate, true);
  await assert.rejects(resolveLatestRelease('0.1.3', page('https://github.com/CrunchSYAH/xiaren-releases/releases')), /识别最新版本号/);
  await assert.rejects(resolveLatestRelease('0.1.3', async () => ({ ok: false, status: 403, url: '', body: null })), /HTTP 403/);
  assert.equal(releaseFromTag('v1.2.3', '0.1.3').version, '1.2.3');
  assert.throws(() => releaseFromTag('latest', '0.1.3'), /版本号/);
});

test('接口失败时带出状态与响应摘要，便于区分限流和网络拦截', async () => {
  await assert.rejects(
    fetchLatestRelease(async () => new Response('{"message":"API rate limit exceeded for 1.2.3.4."}', { status: 403 })),
    /HTTP 403：.*rate limit exceeded/);
  await assert.rejects(
    fetchLatestRelease(async () => new Response('', { status: 403 })),
    /HTTP 403）/);
});
