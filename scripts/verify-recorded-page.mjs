import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalTestFiles } from './build-local-test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proxy = 'http://localhost:3456';
async function api(endpoint, body) {
  const response = await fetch(`${proxy}/${endpoint}`, body === undefined ? {} : { method: 'POST', body, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('本地重放浏览器检查失败；请检查本地服务及 CDP 连接');
  return data;
}
const files = await createLocalTestFiles();
const source = files.get('page-snapshot.mjs').replace('export function inspectPage', 'function inspectPage');
// 拼接顺序即求值顺序：被依赖的模块必须排在前面。
// import 可能是单行也可能是多行，按“到 from '...' 为止”整段去掉，否则多行
// import 会留下 `} from '...';` 让拼接结果语法错误。模块清单必须直接写在
// 这一行的引擎声明里：tests/recorded.test.mjs 只截取 `const engine = …;` 单行来校验。
const engine = ['core/message-rules.mjs', 'core/history-window.mjs', 'core/queue.mjs', 'core/page-guards.mjs', 'core/collection.mjs', 'core/backend.mjs'].map(name => files.get(name).replace(/^import\s[\s\S]*?from\s+'[^']+';?[ \t]*\r?\n/gm, '').replace(/^export (?=(?:function|const) )/gm, '')).join('\n');
let target;
try {
  target = (await api('new', 'http://127.0.0.1:4177/tests/fixtures/recorded/marketplace.html')).targetId;
  const code = `(async()=>{${source}\n${engine}
    const fail = message => { throw new Error(message); };
    if (!window.__recordedReady) fail('真实样本未就绪');
    const differences = [];
    function compare(actual,expected,key){
      if(Array.isArray(expected)){if(!Array.isArray(actual)||actual.length!==expected.length){differences.push(key+'.length');return}expected.forEach((value,index)=>compare(actual[index],value,key+'.'+index));return}
      if(expected&&typeof expected==='object'){for(const[field,value]of Object.entries(expected))compare(actual?.[field],value,key+'.'+field);return}
      if(actual!==expected)differences.push(key);
    }
    const cases=[];
    for(const entry of __recordedReplay.manifest.cases){
      await __recordedReplay.loadCase(entry.name);
      const sample=__recordedReplay.sample,start=differences.length;
      compare(inspectPage(),sample.observed,entry.name);
      for(const message of sample.messageChecks)compare(inspectPage(message.text),message.observed,entry.name+'.message');
      cases.push({name:entry.name,elements:sample.statistics.elements,bindings:sample.bindings.length,matched:differences.length===start,chat:!!sample.observed.chat,emptyWatermark:sample.observed.chat?.latestMessageId===null});
    }
    const mode=document.getElementById('recorded-mode'),fault=document.getElementById('recorded-fault');
    const fill=text=>{const editor=document.querySelector('#sidebar-minichat-list textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,text);editor.dispatchEvent(new Event('input',{bubbles:true}));};
    await __recordedReplay.loadCase('chat-01');
    const rows=[...document.querySelectorAll('tr.kol-card-item[data-row-key]')];
    const chatButton=row=>[...row.querySelectorAll('button')].find(button=>[...button.querySelectorAll('use')].some(use=>(use.getAttribute('href')||use.getAttribute('xlink:href'))==='#icon-chat-new'));
    chatButton(rows[1]).click();chatButton(rows[0]).click();
    await new Promise(resolve=>setTimeout(resolve,450));
    const rapidSwitchCancelled=__recordedReplay.sample.kind==='chat-01'&&inspectPage().chat.recipientId==='201';
    await __recordedReplay.loadCase('chat-01');
    const initial=inspectPage();fill('local recorded test');
    const commit=()=>{const page=inspectPage('local recorded test');return inspectPage('local recorded test',{shopId:'700',itemId:initial.chat.recipientId,documentEpoch:page.documentEpoch});};
    const recordedBlocks=commit().commit.clicked===false;
    mode.value='success';mode.dispatchEvent(new Event('change',{bubbles:true}));fill('local recorded test');const success=commit().commit.clicked===true;const receipt=inspectPage('local recorded test').chat.messages.some(message=>message.confirmed);
    const blocked={};for(const value of ['recipient','controls','captcha']){fault.value=value;fault.dispatchEvent(new Event('change',{bubbles:true}));fill('local recorded test');blocked[value]=commit().commit.clicked===false;}
    fault.value='none';mode.value='uncertain';mode.dispatchEvent(new Event('change',{bubbles:true}));fill('local recorded test');commit();const pending=inspectPage('local recorded test').chat.messages.find(message=>!message.confirmed&&!message.failed);
    mode.value='failed';mode.dispatchEvent(new Event('change',{bubbles:true}));fill('local recorded test');commit();const failed=inspectPage('local recorded test').chat.messages.some(message=>message.failed);
    fault.value='none';mode.value='success';await __recordedReplay.loadCase('chat-01');
    const contentClicks=Number(document.getElementById('recorded-clicks').value);
    let local={},session={};
    const api={runtime:{id:'recorded-check',getURL:path=>'chrome-extension://recorded-check/'+path},storage:{local:{get:async()=>structuredClone(local),set:async values=>{local={...local,...structuredClone(values)}}},session:{get:async()=>structuredClone(session),set:async values=>{session={...session,...structuredClone(values)}}}},tabs:{create:async()=>({id:99}),get:async()=>({id:99,url:location.href})},scripting:{executeScript:async()=>[]}};
    const backend=createBackend(api,{readSnapshot:async(tab,text,documentId,commit)=>inspectPage(text,commit)});
    const panel={id:'recorded-check',url:api.runtime.getURL('dashboard.html')};
    const sender={id:'recorded-check',documentId:'recorded-document',frameId:0,tab:{id:99},url:location.href};
    const call=(type,payload={})=>backend.handle({type,...payload},panel);
    await call('panel:open');
    window.chrome={runtime:{sendMessage:async message=>{try{return{ok:true,...await backend.handle(message,sender)}}catch(error){return{ok:false,error:error.message}}}}};
    ${files.get('content.js')}
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    for(let n=0;n<50;n++){if((await call('panel:get')).workspace?.pageId)break;await delay(100)}
    const base=inspectPage(),config={shop:base.shop,creators:[base.creators[0]],template:'local recorded {{name}}',intervalSeconds:0.01,limit:1,mode:'dry-run'};
    const run=async config=>{const preview=await call('panel:preview',{config});await call('panel:start',{config,previewToken:preview.previewToken,confirmed:config.mode==='send'});for(let n=0;n<100;n++){const result=await call('panel:get');if(['completed','paused','stopped'].includes(result.state.task.status))return result.state.task;await delay(100)}return(await call('panel:get')).state.task};
    const dry=await run(config);let sent=null;if(dry.status==='completed')sent=await run({...config,mode:'send'});
    globalThis.__creatorOutreachPage.stopped=true;
    const contentFlow={dry:dry.status,dryItem:dry.items[0].status,send:sent?.status||'not-run',sendItem:sent?.items[0].status||'not-run',clicks:Number(document.getElementById('recorded-clicks').value)-contentClicks};
    const result={cases,differences,rapidSwitchCancelled,recordedEmptyBlocks:recordedBlocks,synthetic:{success,receipt,blocked,pending:!!pending,failed},contentFlow,limits:__recordedReplay.manifest.missingEvidence};
    result.passed=!differences.length&&rapidSwitchCancelled&&recordedBlocks&&success&&receipt&&Object.values(blocked).every(Boolean)&&!!pending&&failed&&contentFlow.dryItem==='rehearsed'&&contentFlow.sendItem==='sent'&&contentFlow.clicks===1;
    return result;
  })()`;
  const result = (await api(`eval?target=${target}`, code)).value;
  await writeFile(path.join(root, 'artifacts', 'recorded-verification.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result?.passed) process.exitCode = 1;
} finally {
  if (target) await api(`close?target=${target}`).catch(() => {});
}
