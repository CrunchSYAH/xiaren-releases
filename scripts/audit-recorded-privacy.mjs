import { readFile } from 'node:fs/promises';
import { inspectPage } from '../extension/page-snapshot.mjs';

const target = process.argv[2];
if (!/^[A-F0-9]{20,64}$/.test(target || '')) throw new Error('需要本次工具新建的来源页面 targetId');
for (const name of ['list', 'chat-01', 'chat-02', 'chat-03']) {
  const sample = JSON.parse(await readFile(new URL(`../tests/fixtures/recorded/${name}.json`, import.meta.url), 'utf8'));
  const code = `(()=>{const observe=(${inspectPage.toString()});
    const actual=observe(),store=window.__$unstable_useRootStoreOutside();
    const identities=[store.shopId,store.shopName,store.username,...actual.creators.flatMap(row=>[row.id,row.name,row.username,row.rowKey?.split('_').at(-1)])].filter(value=>value!=null&&String(value).trim().length>=4).map(String);
    const sample=${JSON.stringify(sample)};
    let matches=0;const scan=value=>{if(typeof value==='string'){if(identities.some(identity=>value===identity||(identity.length>=8&&value.includes(identity))))matches++;return}if(value&&typeof value==='object')for(const child of Object.values(value))scan(child)};
    scan(sample.tree);scan(sample.store);scan(sample.bindings);scan(sample.observed);scan(sample.messageChecks);
    return {checkedIdentities:identities.length,matchedPrivateValues:matches};})()`;
  const response = await fetch(`http://localhost:3456/eval?target=${target}`, { method: 'POST', body: code, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const result = await response.json();
  if (!response.ok || result.error || !result.value) throw new Error('隐私复核无法完成；未输出任何来源身份');
  process.stdout.write(`${name}: 核对 ${result.value.checkedIdentities} 个来源身份值，残留 ${result.value.matchedPrivateValues} 处\n`);
  if (result.value.matchedPrivateValues) process.exitCode = 1;
}
