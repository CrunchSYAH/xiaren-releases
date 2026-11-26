import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMessageTemplates, readMessageTemplates, listMessageTemplates, createMessageTemplate, updateMessageTemplate, copyMessageTemplate } from '../extension/core/message-templates.mjs';

const draft = (extra = {}) => ({ name: '合作邀请', template: 'Halo {{name}}!\n一起合作。', productLink: 'https://shopee.co.id/product/1/2', ...extra });
const create = (store, id = 'one', extra = {}, now = 1000) => createMessageTemplate(store, draft(extra), { id, now });

test('缺少旧键视为空且返回独立副本，记录仅保存约定字段并按更新时间排序', () => {
  assert.deepEqual(readMessageTemplates(undefined), { version: 1, templates: [] });
  assert.notEqual(emptyMessageTemplates().templates, emptyMessageTemplates().templates);
  const original = emptyMessageTemplates();
  const store = create(original, 'b', { name: '  合作邀请  ', productLink: ' https://example.com/product ', mode: 'send', targetCount: 100 });
  assert.deepEqual(original, emptyMessageTemplates());
  assert.deepEqual(store.templates[0], { id: 'b', name: '合作邀请', template: 'Halo {{name}}!\n一起合作。', productLink: 'https://example.com/product', revision: 1, createdAt: 1000, updatedAt: 1000 });
  const two = create(store, 'a', { name: '第二份' });
  const listed = listMessageTemplates(two);
  assert.deepEqual(listed.templates.map(item => item.id), ['a', 'b']);
  assert.deepEqual(listed.capacity, { count: 2, limit: 50, maxBytes: 524288, bytes: new TextEncoder().encode(JSON.stringify(two)).byteLength });
  const copied = readMessageTemplates(two);
  copied.templates[0].name = '改副本';
  listed.templates[0].template = '改列表';
  assert.equal(two.templates[0].name, '合作邀请');
  assert.equal(two.templates[1].template, 'Halo {{name}}!\n一起合作。');
});

test('名称、话术和链接边界与队列规则一致，不改变原话术', () => {
  const empty = emptyMessageTemplates();
  for (const name of ['', '  ', 'a'.repeat(51), 'bad\nname', 'bad\u0000name', 'bad\u007fname', '\nname', 'name\t']) assert.throws(() => create(empty, 'one', { name }), /名称/);
  for (const template of ['', ' \n ', 'a'.repeat(2001), '{{unknown}}', '{{name', 'name}}']) assert.throws(() => create(empty, 'one', { template }), /话术|变量/);
  for (const productLink of ['', '  ', 'javascript:alert(1)', 'ftp://example.com', 'https://', 'https://user:pass@example.com', 'https://user@example.com', 'https://example.com/a\nb', 'https://example.com/a b', `https://example.com/${'a'.repeat(2000)}`]) assert.throws(() => create(empty, 'one', { productLink }), /链接|网址/);
  const body = '  Halo {{name}}!\n请联系。  ';
  const store = create(empty, 'one', { name: 'a'.repeat(50), template: body, productLink: ' HTTP://example.com/a?b=c#d ' });
  assert.equal(store.templates[0].template, body);
  assert.equal(store.templates[0].productLink, 'HTTP://example.com/a?b=c#d');
  assert.deepEqual(empty, emptyMessageTemplates());
});

test('重名按去空白及小写比较，ID不能复用且特殊ID不会改变对象原型', () => {
  const store = create(emptyMessageTemplates(), '__proto__', { name: ' Name ' });
  for (const name of ['name', ' NAME ']) assert.throws(() => create(store, 'two', { name }), /重名|已存在|名称/);
  assert.throws(() => create(store, '__proto__', { name: '另一份' }), /标识|ID|已存在/);
  for (const id of ['', ' ']) assert.throws(() => create(store, id, { name: '另一份' }), /标识|ID/);
  assert.equal(Object.getPrototypeOf(store), Object.prototype);
  assert.equal(readMessageTemplates(JSON.parse(JSON.stringify(store))).templates[0].id, '__proto__');
});

test('更新校验版本并递增，保留ID及创建时间，不持有外部草稿引用', () => {
  const store = create(emptyMessageTemplates());
  const changed = draft({ name: '更新邀请', template: '新的 {{name}} 内容' });
  const next = updateMessageTemplate(store, { templateId: 'one', expectedRevision: 1, draft: changed }, { now: 2000 });
  assert.deepEqual(next.templates[0], { id: 'one', name: '更新邀请', template: '新的 {{name}} 内容', productLink: changed.productLink, revision: 2, createdAt: 1000, updatedAt: 2000 });
  changed.name = '外部变化';
  assert.equal(next.templates[0].name, '更新邀请');
  assert.equal(store.templates[0].revision, 1);
  for (const expectedRevision of [undefined, 0, 2, 1.5]) assert.throws(() => updateMessageTemplate(store, { templateId: 'one', expectedRevision, draft: draft() }, { now: 2000 }), /版本|刷新/);
  assert.throws(() => updateMessageTemplate(store, { templateId: 'missing', expectedRevision: 1, draft: draft() }, { now: 2000 }), /不存在|刷新/);
  const max = structuredClone(store); max.templates[0].revision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => updateMessageTemplate(max, { templateId: 'one', expectedRevision: Number.MAX_SAFE_INTEGER, draft: draft() }, { now: 2000 }), /版本|上限/);
});

test('复制采用已保存内容，自动去重命名、截断长名并校验源版本', () => {
  const source = create(emptyMessageTemplates(), 'one', { name: 'x'.repeat(50) });
  const first = copyMessageTemplate(source, { templateId: 'one', expectedRevision: 1 }, { id: 'two', now: 2000 });
  const copy = first.templates.find(item => item.id === 'two');
  assert.equal(copy.name, `${'x'.repeat(45)} · 副本`);
  assert.equal(copy.template, source.templates[0].template);
  assert.equal(copy.productLink, source.templates[0].productLink);
  assert.equal(copy.revision, 1);
  assert.equal(copy.createdAt, 2000);
  const second = copyMessageTemplate(first, { templateId: 'one', expectedRevision: 1 }, { id: 'three', now: 3000 });
  assert.equal(second.templates.find(item => item.id === 'three').name, `${'x'.repeat(44)} · 副本2`);
  const named = copyMessageTemplate(second, { templateId: 'one', expectedRevision: 1, name: ' 自定副本 ' }, { id: 'four', now: 4000 });
  assert.equal(named.templates.find(item => item.id === 'four').name, '自定副本');
  assert.throws(() => copyMessageTemplate(source, { templateId: 'one', expectedRevision: 2 }, { id: 'five', now: 2000 }), /版本|刷新/);
  assert.throws(() => copyMessageTemplate(first, { templateId: 'one', expectedRevision: 1, name: copy.name }, { id: 'five', now: 2000 }), /重名|已存在|名称/);
  assert.throws(() => copyMessageTemplate(source, { templateId: 'one', expectedRevision: 1 }, { id: 'one', now: 2000 }), /标识|ID|已存在/);
  assert.equal(source.templates.length, 1);
});

test('坏格式、重复记录、非法版本与时间均报错并保留原值', () => {
  const good = create(emptyMessageTemplates());
  const invalid = [null, [], { version: 99, templates: [] }, { version: 1, templates: null }, { version: 1, templates: [good.templates[0], good.templates[0]] },
    { version: 1, templates: [{ ...good.templates[0], id: 'two' }, { ...good.templates[0], name: ' 合作邀请 ' }] }];
  for (const extra of [{ revision: 0 }, { revision: Infinity }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { createdAt: -1 }, { updatedAt: NaN }, { template: '{{bad}}' }, { productLink: 'https://user@example.com' }]) invalid.push({ version: 1, templates: [{ ...good.templates[0], ...extra }] });
  for (const value of invalid) {
    const before = structuredClone(value);
    assert.throws(() => readMessageTemplates(value), /模板.*损坏|版本.*不兼容|格式/);
    assert.deepEqual(value, before);
  }
  for (const now of [-1, NaN, Infinity, undefined]) assert.throws(() => createMessageTemplate(good, draft({ name: 'another' }), { id: 'two', now }), /时间/);
  assert.equal(create(emptyMessageTemplates(), 'zero', {}, 0).templates[0].createdAt, 0);
});

test('达到50条拒绝新增与复制，容量内仍能更新且不会删除旧模板', () => {
  let store = emptyMessageTemplates();
  for (let index = 0; index < 50; index++) store = create(store, `id-${index}`, { name: `模板${index}` });
  const before = structuredClone(store);
  assert.throws(() => create(store, 'extra', { name: '更多' }), /50|上限|容量/);
  assert.throws(() => copyMessageTemplate(store, { templateId: 'id-0', expectedRevision: 1 }, { id: 'extra', now: 2000 }), /50|上限|容量/);
  const updated = updateMessageTemplate(store, { templateId: 'id-0', expectedRevision: 1, draft: draft({ name: '允许更新' }) }, { now: 2000 });
  assert.equal(updated.templates.length, 50);
  assert.equal(updated.templates[0].revision, 2);
  assert.deepEqual(store, before);
});

test('JSON容量按UTF-8字节限制512KiB，超限保留所有原模板且允许缩小内容', () => {
  let store = emptyMessageTemplates(), exceeded = false;
  const large = { template: '界'.repeat(2000), productLink: `https://example.com/${'界'.repeat(1900)}` };
  for (let index = 0; index < 50; index++) {
    const before = structuredClone(store);
    try { store = create(store, `id-${index}`, { ...large, name: `模板${index}` }); }
    catch (error) { assert.match(error.message, /容量|上限/); assert.deepEqual(store, before); exceeded = true; break; }
  }
  assert.equal(exceeded, true);
  assert.ok(store.templates.length < 50);
  const listed = listMessageTemplates(store);
  assert.ok(listed.capacity.bytes <= 524288);
  const shrunk = updateMessageTemplate(store, { templateId: 'id-0', expectedRevision: 1, draft: draft({ name: '小模板' }) }, { now: 2000 });
  assert.equal(shrunk.templates.length, store.templates.length);
  assert.ok(listMessageTemplates(shrunk).capacity.bytes < listed.capacity.bytes);
});

test('空操作参数返回中文校验错误，512KiB临界值可存而多一字节拒绝', () => {
  const store = create(emptyMessageTemplates());
  assert.throws(() => createMessageTemplate(store, draft({ name: 'new' }), null), /ID|标识|时间/);
  assert.throws(() => updateMessageTemplate(store, null, { now: 2000 }), /不存在|刷新|参数/);
  assert.throws(() => copyMessageTemplate(store, null, { id: 'two', now: 2000 }), /不存在|刷新|参数/);
  const base = create(emptyMessageTemplates());
  const size = new TextEncoder().encode(JSON.stringify(base)).byteLength;
  const exactId = 'x'.repeat(524288 - size + base.templates[0].id.length);
  const exact = create(emptyMessageTemplates(), exactId);
  assert.equal(listMessageTemplates(exact).capacity.bytes, 524288);
  assert.throws(() => create(emptyMessageTemplates(), exactId + 'x'), /容量|上限/);
  assert.equal(create(emptyMessageTemplates(), 'edge', { template: 'a'.repeat(2000), productLink: `https://example.com/${'a'.repeat(1980)}` }).templates[0].template.length, 2000);
});
