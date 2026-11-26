import test from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../extension/core/creator-library.mjs';

const draft = (extra = {}) => ({ name: '示例达人', identityType: 'shopee_user_id', identityValue: '123', site: 'ID', shopId: '10', source: { kind: 'manual', label: '线下整理' }, tags: ['合作'], note: '', ...extra });
const add = (store, value = draft(), id = 'r1') => library.createCreatorLibraryRecord(store, value, { id, now: 1000, expectedRevision: store?.revision ?? 0 });

test('缺失键为空库，新增只保存白名单且外部核实声明不能升级身份', () => {
  assert.deepEqual(library.readCreatorLibrary(undefined), { version: 1, revision: 0, records: [] });
  const store = add(undefined, draft({ verification: { status: 'page_verified' }, shopeeUserId: '999', secret: 'discard' }));
  assert.equal(store.revision, 1);
  assert.equal(store.records[0].verification.status, 'unverified');
  assert.equal(store.records[0].shopeeUserId, '123');
  assert.equal(store.records[0].secret, undefined);
  assert.equal(store.records[0].revision, 1);
  assert.deepEqual(library.readCreatorLibrary(store), store);
});

test('身份类型隔离，未知和伙伴身份不伪装用户ID，去重含店铺和站点', () => {
  let store = add(undefined);
  assert.throws(() => add(store, draft(), 'duplicate'), /已存在/);
  store = add(store, draft({ identityType: 'affiliate_id' }), 'r2');
  store = add(store, draft({ identityType: 'unknown', identityValue: '@example' }), 'r3');
  store = add(store, draft({ shopId: '11' }), 'r4');
  assert.equal(store.records.length, 4);
  assert.equal(store.records[1].shopeeUserId, null);
  assert.equal(store.records[2].shopeeUserId, null);
  for (const extra of [{ identityType: 'guess' }, { identityValue: 123 }, { identityValue: '0' }, { identityValue: '1e3' }, { site: 'SG' }, { tags: ['x'.repeat(31)] }, { name: '\u0000' }, { note: 'x'.repeat(1001) }]) assert.throws(() => add(undefined, draft(extra)), /身份|ID|站点|标签|姓名|备注/);
});

test('批量导入全有或全无，保留来源，不覆盖重复的标签备注，也不信任导入核实', () => {
  const original = add(undefined);
  const result = library.importCreatorLibraryRecords(original, [draft({ note: '不能覆盖' }), draft({ identityValue: '456', source: { kind: 'leaderboard', label: 'Top Sales' }, verification: { status: 'page_verified' } }), draft({ identityValue: '456' })], { now: 2000, expectedRevision: 1, uid: () => 'r2' });
  assert.equal(result.added, 1); assert.equal(result.skipped, 2);
  assert.equal(result.store.records[0].note, '');
  assert.equal(result.store.records[1].source.kind, 'leaderboard');
  assert.equal(result.store.records[1].verification.status, 'unverified');
  assert.throws(() => library.importCreatorLibraryRecords(original, [draft({ identityValue: '456' }), draft({ identityValue: 'bad' })], { now: 2000, expectedRevision: 1, uid: () => 'r2' }), /身份|ID/);
  assert.equal(original.records.length, 1);
  assert.equal(library.importCreatorLibraryRecords(original, [draft()], { now: 2000, expectedRevision: 1 }).store.revision, 1);
});

test('全库版本冲突拒绝覆盖，更新标签备注保留身份，身份变化撤销已核实映射', () => {
  const store = add(undefined);
  assert.throws(() => library.updateCreatorLibraryRecord(store, { recordId: 'r1', expectedRevision: 0, draft: draft() }, { now: 2000 }), /版本|刷新/);
  const verified = library.verifyCreatorLibraryRecord(store, { recordId: 'r1', expectedRevision: 1, evidence: { site: 'ID', shopId: '10', identityType: 'shopee_user_id', identityValue: '123', shopeeUserId: '123' } }, { now: 1500 });
  const edited = library.updateCreatorLibraryRecord(verified, { recordId: 'r1', expectedRevision: 2, draft: draft({ tags: [' 新 ', '新'], note: '继续沟通' }) }, { now: 2000 });
  assert.deepEqual(edited.records[0].tags, ['新']);
  assert.equal(edited.records[0].verification.status, 'page_verified');
  const changed = library.updateCreatorLibraryRecord(edited, { recordId: 'r1', expectedRevision: 3, draft: draft({ identityType: 'affiliate_id', identityValue: '7' }) }, { now: 3000 });
  assert.equal(changed.records[0].shopeeUserId, null);
  assert.equal(changed.records[0].verification.status, 'unverified');
  assert.equal(changed.records[0].createdAt, 1000);
  assert.throws(() => library.verifyCreatorLibraryRecord(store, { recordId: 'r1', expectedRevision: 1, evidence: { site: 'ID', shopId: '11', identityType: 'shopee_user_id', identityValue: '123', shopeeUserId: '123' } }, { now: 1500 }), /核实|店铺/);
});

test('筛选覆盖关键词标签身份店铺核实；返回数据与输入无共享引用', () => {
  let store = add(undefined, draft({ name: '<img onerror=1>', note: '下次跟进', tags: ['美妆'] }));
  store = add(store, draft({ identityType: 'affiliate_id', identityValue: '456', shopId: '11' }), 'r2');
  const result = library.listCreatorLibrary(store, { query: '跟进', tag: '美妆', shopId: '10', identityType: 'shopee_user_id', verification: 'unverified' });
  assert.equal(result.records.length, 1);
  result.records[0].tags.push('不会泄漏');
  assert.deepEqual(store.records[0].tags, ['美妆']);
  assert.equal(library.listCreatorLibrary(store, { shopId: '11' }).records[0].id, 'r2');
  assert.throws(() => library.listCreatorLibrary(store, { verification: 'sendable' }), /核实/);
});

test('选择保持点选顺序、同店铺且必须存在真实用户ID；只交接不授权发送', () => {
  let store = add(undefined);
  store = add(store, draft({ identityValue: '456' }), 'r2');
  store = add(store, draft({ identityType: 'affiliate_id', identityValue: '789' }), 'r3');
  const selection = library.selectCreatorLibrary(store, { recordIds: ['r2', 'r1', 'r2'], expectedRevision: 3, site: 'ID', shopId: '10' });
  assert.deepEqual(selection.creatorIds, ['456', '123']);
  assert.deepEqual(selection.records.map(record => record.id), ['r2', 'r1']);
  assert.equal(selection.requiresPageVerification, true);
  assert.equal(selection.kind, 'creator-library-selection');
  assert.equal(selection.mode, undefined); assert.equal(selection.collectionId, undefined);
  assert.throws(() => library.selectCreatorLibrary(store, { recordIds: ['r3'], expectedRevision: 3, site: 'ID', shopId: '10' }), /用户 ID|映射/);
  assert.throws(() => library.selectCreatorLibrary(store, { recordIds: ['r1'], expectedRevision: 3, site: 'ID', shopId: '11' }), /店铺/);
  assert.throws(() => library.selectCreatorLibrary(store, { recordIds: [], expectedRevision: 3, site: 'ID', shopId: '10' }), /1—200/);
  assert.throws(() => library.selectCreatorLibrary(store, { recordIds: ['missing'], expectedRevision: 3, site: 'ID', shopId: '10' }), /不存在/);
  assert.throws(() => library.selectCreatorLibrary(store, { recordIds: ['r1'], expectedRevision: 2, site: 'ID', shopId: '10' }), /版本/);
});

test('伙伴映射仅可信页面核实纯入口可写，且不能与原Shopee用户身份矛盾', () => {
  const store = add(undefined, draft({ identityType: 'affiliate_id', identityValue: '700' }));
  const verified = library.verifyCreatorLibraryRecord(store, { recordId: 'r1', expectedRevision: 1, evidence: { site: 'ID', shopId: '10', identityType: 'affiliate_id', identityValue: '700', shopeeUserId: '900' } }, { now: 2000 });
  assert.equal(verified.records[0].shopeeUserId, '900');
  assert.equal(library.selectCreatorLibrary(verified, { recordIds: ['r1'], expectedRevision: 2, site: 'ID', shopId: '10' }).creatorIds[0], '900');
  assert.throws(() => library.verifyCreatorLibraryRecord(add(undefined), { recordId: 'r1', expectedRevision: 1, evidence: { site: 'ID', shopId: '10', identityType: 'shopee_user_id', identityValue: '123', shopeeUserId: '900' } }, { now: 2000 }), /矛盾|不符/);
});

test('损坏、重复、超限和未知版本均拒绝且不改原数据', () => {
  const good = add(undefined);
  for (const bad of [null, { version: 99, revision: 0, records: [] }, { ...good, revision: -1 }, { ...good, records: [good.records[0], good.records[0]] }, { ...good, records: [{ ...good.records[0], shopeeUserId: '999' }] }, { ...good, records: [{ ...good.records[0], verification: { status: 'page_verified', checkedAt: null } }] }]) {
    const before = structuredClone(bad);
    assert.throws(() => library.readCreatorLibrary(bad), /损坏|版本/);
    assert.deepEqual(bad, before);
  }
  const rows = Array.from({ length: 2001 }, (_, i) => draft({ identityValue: String(i + 1) }));
  assert.throws(() => library.importCreatorLibraryRecords(undefined, rows, { now: 1, expectedRevision: 0, uid: () => crypto.randomUUID() }), /2000|容量/);
  const tooLarge = Array.from({ length: 1900 }, (_, i) => draft({ identityValue: String(i + 1), note: '中'.repeat(1000) }));
  assert.throws(() => library.importCreatorLibraryRecords(undefined, tooLarge, { now: 1, expectedRevision: 0, uid: () => crypto.randomUUID() }), /容量|2MiB/);
});

test('JSON和CSV导入导出保留逗号换行引号和来源，表格公式不执行，导出核实不被重新信任', () => {
  const store = add(undefined, draft({ name: '=危险公式', note: '含,逗号\n和"引号"', tags: ['美妆', '合作'], source: { kind: 'leaderboard', label: 'Top Sales' } }));
  for (const format of ['json', 'csv']) {
    const report = library.exportCreatorLibrary(store, { format });
    const rows = library.parseCreatorLibraryImport(report.content, format);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].note, store.records[0].note);
    assert.equal(rows[0].source.label, 'Top Sales');
    const imported = library.importCreatorLibraryRecords(undefined, rows, { now: 2000, expectedRevision: 0, uid: () => 'r2' });
    assert.equal(imported.store.records[0].verification.status, 'unverified');
    if (format === 'csv') assert.match(report.content, /'=危险公式/);
  }
  assert.throws(() => library.parseCreatorLibraryImport('identityType,identityValue\n"unfinished', 'csv'), /CSV/);
  assert.throws(() => library.parseCreatorLibraryImport('{bad', 'json'), /JSON/);
  assert.throws(() => library.parseCreatorLibraryImport('{}', 'json'), /格式|数组/);
  assert.throws(() => library.parseCreatorLibraryImport('x'.repeat(4 * 1024 * 1024 + 1), 'json'), /4MiB/);
});

test('CSV保护公式、超长数字和原有单引号，同时能无损导回', () => {
  for (const value of ['+SUM(1,2)', '-1+2', '@cmd', ' =SUM(1,2)', "'原始单引号", "''双单引号", '123456789012345678901234567890']) {
    const store = add(undefined, draft({ name: value, note: value, identityValue: '123456789012345678901234567890', tags: ['含,逗号', '甲，乙'] }));
    const report = library.exportCreatorLibrary(store, { format: 'csv' });
    const [row] = library.parseCreatorLibraryImport(report.content, 'csv');
    assert.equal(row.name, value.trim()); assert.equal(row.note, value.trim());
    assert.equal(row.identityValue, store.records[0].identityValue);
    assert.deepEqual(row.tags, store.records[0].tags);
  }
});
