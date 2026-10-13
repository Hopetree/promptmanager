/**
 * 阶段 52 / AC-117 ⑥b：断言卡片底部的分隔符与元信息**永远不会**进入复制内容（FR-116 ⑥）。
 *
 * 用法：node tools/ac-stage52-copy-probe.mjs <baseUrl> <sid>
 *
 * 做法：真浏览器 + **真鼠标**点「复制」（不用 JS .click()）；因为 CDP 读系统剪贴板不可靠，
 * 改在页面脚本运行前挂钩 `document.execCommand('copy')` 与 `navigator.clipboard.writeText`
 * —— 这两条正是 `web/src/clipboard.ts` 覆盖的两条路径 —— 把进入剪贴板的文本记进 `window.__copied`。
 *
 * 输出：COPY_TARGET_ID / COPIED（JSON 数组）/ FOOTER_LINE（卡片底部那一行的实际文本）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [baseUrl, sid] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const dir = mkdtempSync(path.join(tmpdir(), 'pm-sep-'));
const child = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1600,900','--user-data-dir='+dir,'--remote-debugging-port=0','about:blank'], {stdio:['ignore','ignore','ignore']});
const send = (ws, id, method, params) => new Promise((res,rej)=>{ const h=(e)=>{ let m; try{m=JSON.parse(e.data)}catch{return} if(m.id===id){ ws.removeEventListener('message',h); m.error?rej(new Error(m.error.message)):res(m.result);} }; ws.addEventListener('message',h); ws.send(JSON.stringify({id,method,params})); });
try{
  let port=null;
  for(let i=0;i<100&&port===null;i++){try{port=Number(readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{await sleep(100)}}
  const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});
  let nid=1;
  const S=(m,p={})=>send(ws,nid++,m,p);
  const ev=async(x)=>(await S('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.value;
  await S('Page.enable'); await S('Runtime.enable');
  // 在页面脚本跑之前挂钩：记录所有进入剪贴板的文本（覆盖 execCommand 与 navigator.clipboard 两条路径）
  await S('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__copied=[];
    const orig=document.execCommand&&document.execCommand.bind(document);
    document.execCommand=function(cmd,...rest){ if(cmd==='copy'){ window.__copied.push(document.getSelection?String(document.getSelection()):''); } return orig?orig(cmd,...rest):false; };
    if(navigator.clipboard&&navigator.clipboard.writeText){ const w=navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText=async(t)=>{ window.__copied.push(String(t)); return w(t); }; }
  `});
  await S('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await S('Network.setCookie',{name:'pm_sid',value:sid,domain:new URL(baseUrl).hostname,path:'/',httpOnly:true,sameSite:'Lax'});
  await S('Page.navigate',{url:`${baseUrl}/`});
  for(let i=0;i<120;i++){ if(await ev(`document.querySelector('[data-testid="pm-use-viewmode"]')!==null`))break; await sleep(150);} await sleep(700);
  const click=async(x,s=900)=>{const v=await ev(`(()=>{const el=(${x});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);if(!v)throw new Error('no '+x);const {x:cx,y:cy}=JSON.parse(v);
    await S('Input.dispatchMouseEvent',{type:'mouseMoved',x:cx,y:cy,button:'none',buttons:0});await sleep(100);
    await S('Input.dispatchMouseEvent',{type:'mousePressed',x:cx,y:cy,button:'left',buttons:1,clickCount:1});await sleep(50);
    await S('Input.dispatchMouseEvent',{type:'mouseReleased',x:cx,y:cy,button:'left',buttons:0,clickCount:1});await sleep(s);};
  await click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>el.innerText.trim()==='卡片')`,1200);
  for(let i=0;i<120;i++){ if(await ev(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`))break; await sleep(150);} 
  // 找无变量那张（按钮文案「复制」而不是「填值后复制」）
  const id = await ev(`(()=>{const b=[...document.querySelectorAll('[data-testid^="pm-copy-"]')].find(x=>x.innerText.trim()==='复制'); return b===null?null:b.getAttribute('data-testid').replace('pm-copy-','');})()`);
  console.log('COPY_TARGET_ID:'+id);
  await click(`document.querySelector('[data-testid="pm-copy-${id}"]')`,1200);
  const copied = await ev(`JSON.stringify(window.__copied)`);
  console.log('COPIED:'+copied);
  const line = await ev(`(()=>{const f=document.querySelector('[data-testid="pm-card-footer-${id}"]'); return f===null?'':(f.innerText||'').replace(/\\n/g,' ');})()`);
  console.log('FOOTER_LINE:'+line);
} finally { try{child.kill('SIGKILL')}catch{} rmSync(dir,{recursive:true,force:true}); }
