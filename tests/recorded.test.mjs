import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, runInNewContext } from 'node:vm';

const module = await import('../tests/fixtures/recorded/runtime.mjs').catch(() => null);

test('浏览器重放检查拼接的后台引擎可作为普通脚本执行', async () => {
  const { createLocalTestFiles } = await import('../scripts/build-local-test.mjs');
  const files = await createLocalTestFiles();
  const verifier = await readFile(new URL('../scripts/verify-recorded-page.mjs', import.meta.url), 'utf8');
  const declaration = verifier.match(/^const engine = .+;$/m)?.[0];
  assert.ok(declaration, '找不到浏览器重放引擎的拼接入口');
  const engine = runInNewContext(`${declaration}\nengine`, { files });
  const snapshot = files.get('page-snapshot.mjs').replace('export function inspectPage', 'function inspectPage');
  assert.doesNotThrow(() => new Script(`${snapshot}\n${engine}`));
});

test('按采集的层级重建属性链，不把不同层的属性拼成自造组件', () => {
  assert.equal(typeof module?.buildFiberProjection, 'function', '尚未实现记录状态的机械恢复');
  const record = { primary: [{}, { buyerId: '201', shopId: '700' }, {}, { currentConversation: { to_id: '201', shop_id: '700', latest_message_id: '' } }], alternate: [], active: 'primary' };
  const fiber = module.buildFiberProjection(record);
  assert.deepEqual(fiber.memoizedProps, {});
  assert.equal(fiber.return.memoizedProps.buyerId, '201');
  assert.deepEqual(fiber.return.return.memoizedProps, {});
  assert.equal(fiber.return.return.return.memoizedProps.currentConversation.latest_message_id, '');
  fiber.return.memoizedProps.buyerId = '999';
  assert.equal(record.primary[1].buyerId, '201');
});

test('实际记录样本保持完整性、空回执状态与证据缺口，不用手写页代替', async () => {
  const { validateRecordedSample } = await import('../scripts/recorded-format.mjs');
  const manifest = JSON.parse(await readFile(new URL('./fixtures/recorded/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.sourceKind, 'real-rendered-dom-and-whitelisted-runtime');
  assert.equal(manifest.cases.length, 4);
  for (const entry of manifest.cases) {
    const content = await readFile(new URL(`./fixtures/recorded/${entry.file}`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256);
    const sample = validateRecordedSample(JSON.parse(content));
    assert.ok(sample.statistics.elements > 1000);
    assert.equal(sample.observed.creators.length, entry.creators);
    if (entry.recipientId) {
      assert.equal(sample.observed.chat.recipientId, entry.recipientId);
      assert.equal(sample.observed.chat.latestMessageId, null);
      assert.ok(sample.bindings.some(binding => binding.fiber.primary.some(props => props.currentConversation?.latest_message_id === '')));
    }
  }
  assert.ok(manifest.missingEvidence.includes('真实成功/失败回执'));
});

test('恢复实际记录的主/备用分支，保持当前分支语义', () => {
  assert.ok(module, '尚未实现记录状态的机械恢复');
  const fiber = module.buildFiberProjection({ primary: [{ buyerId: '201' }, {}], alternate: [{ buyerId: '202' }, {}], active: 'alternate' });
  assert.equal(fiber.memoizedProps.buyerId, '201');
  assert.equal(fiber.alternate.memoizedProps.buyerId, '202');
  assert.equal(fiber.return.stateNode.current, fiber.alternate.return);
});

test('记录验证器拒绝活动标签、外部资源、事件和未列入白名单的运行状态', async () => {
  const validator = await import('../scripts/recorded-format.mjs').catch(() => null);
  assert.equal(typeof validator?.validateRecordedSample, 'function', '尚未实现脱敏记录校验');
  const sample = { version: 1, source: { origin: 'https://seller.shopee.co.id', path: '/portal/web-seller-affiliate/kol_marketplace' }, capturedAt: '2026-10-16T00:00:00.000Z', kind: 'list', viewport: { width: 1440, height: 900 }, store: { shopId: 700, shopName: '样本店铺' }, styles: ['display: block'], tree: { key: 'n0', tag: 'div', ns: 'html', attrs: {}, style: 0, children: [{ text: '样本内容' }] }, bindings: [], observed: { shop: { id: '700', name: '样本店铺' }, creators: [], chat: null }, messageChecks: [], statistics: { elements: 1, textNodesMasked: 1 } };
  assert.equal(validator.validateRecordedSample(sample), sample);
  sample.tree.attrs.fill = 'url(#icon-样本_1)';
  assert.equal(validator.validateRecordedSample(sample), sample);
  for (const mutation of [s => { s.tree.tag = 'script'; }, s => { s.tree.attrs.onclick = 'send()'; }, s => { s.tree.attrs.src = 'https://example.com/avatar'; }, s => { s.tree.attrs.fill = 'url(//example.invalid/private-path)'; }, s => { s.store.token = 'private'; }, s => { s.store.shopName = 'Actual Account'; }, s => { s.styles[0] = 'background: url(https://example.com/a)'; }]) {
    const modified = structuredClone(sample); mutation(modified); assert.throws(() => validator.validateRecordedSample(modified));
  }
});
