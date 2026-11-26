import { mkdir, writeFile } from 'node:fs/promises';

const proxy = 'http://localhost:3456';
async function api(endpoint, body) {
  const response = await fetch(`${proxy}/${endpoint}`, body === undefined ? {} : { method: 'POST', body, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const result = await response.json();
  if (!response.ok || result.error || result.exceptionDetails) throw new Error('工作台浏览器检查失败，请检查本机服务及 CDP 连接');
  return result;
}
let target;
try {
  target = (await api('new', 'http://127.0.0.1:4177/tests/fixtures/workbench.html')).targetId;
  const result = (await api(`eval?target=${target}`, `(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async check=>{for(let n=0;n<100;n++){if(check())return;await wait(100)}throw new Error('等待本地工作台超时')};
    const $=id=>document.getElementById(id);
    await until(()=>window.__fixtureBackend&&$('open-page'));
    $('open-page').click();
    await until(()=>!$('refresh-list').disabled);
    const original=chrome.runtime.sendMessage;
    // Extra names exist only in this temporary UI test. The backend and the
    // actual iframe retain their three original creators; no synthetic ID sends.
    chrome.runtime.sendMessage=async message=>{
      const reply=await original(message);
      if(reply.workspace?.creators?.length){
        reply.workspace.creators=[...reply.workspace.creators,...Array.from({length:20},(_,i)=>({id:String(9000+i),name:'分页演示'+(i+4),chatAvailable:true}))];
      }
      return reply;
    };
    $('refresh-list').click();await until(()=>$('roster-count').textContent==='23');
    const counts=[$('roster-body').children.length];
    const input=(id,value)=>{const node=$(id);Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))};
    const check=node=>{node.checked=true;node.dispatchEvent(new Event('change',{bubbles:true}))};
    check($('select-all'));$('roster-next').click();counts.push($('roster-body').children.length);
    check($('roster-body').querySelector('input[type=checkbox]'));
    $('roster-next').click();counts.push($('roster-body').children.length);
    const lastPage=$('roster-next').disabled;
    $('roster-previous').click();$('roster-previous').click();
    const retained=$('select-all').checked&&$('selection-count').textContent==='已选 11 人';
    $('clear-selection').click();check($('roster-body').querySelector('input[type=checkbox]'));
    input('template','Halo {{name}}, UI test');input('interval','1');input('limit','1');
    const live=$('preview-message').textContent==='Halo Ayu 示例达人, UI test';
    const controlsRemoved=!$('preview-button')&&!$('preview-person')&&!$('preview-status');
    const directStart=!$('start-button').disabled;
    $('start-button').click();await until(()=>$('queue-status').textContent==='已结束'||$('queue-status').textContent==='已暂停');
    const queueComplete=$('queue-status').textContent==='已结束'&&$('progress-summary').textContent.includes('已演练 1');
    const zeroClicks=window.__fixtureFrame.contentWindow.document.getElementById('click-count').textContent==='0';
    return {counts,lastPage,retained,live,controlsRemoved,directStart,queueComplete,zeroClicks,passed:counts.join(',')==='10,10,3'&&lastPage&&retained&&live&&controlsRemoved&&directStart&&queueComplete&&zeroClicks};
  })()`)).value;
  if (!result || typeof result.passed !== 'boolean') throw new Error('工作台检查未返回完整结果');
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/dashboard-verification.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  if (target) await api(`close?target=${target}`).catch(() => {});
}
