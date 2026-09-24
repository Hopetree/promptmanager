/**
 * 阶段 51 / AC-116 记账探针（真浏览器 + 真鼠标）：按**阶段**驱动界面并把 `/api/` 请求清单打到 stdout，
 * 由 tools/ac-stage51.sh 在每步之间**查库**数 usage_events —— 四条分支逐条实测（D-51 ⑤）。
 *
 * 用法：node tools/ac-stage51-probe.mjs <baseUrl> <sid> <phase>
 *   phase = open-vars   点开「含变量」那条（记 1 条 view，不计入）
 *         | open-plain  点开「无变量」那条（记 1 条 view，不计入）
 *         | copy-plain  点开「无变量」那条后点「复制提示词」（**弹窗阶段：应零请求**）
 *         | vars-dialog 点「复制提示词」**只打开弹窗**（应零请求、不记账）
 *         | copy-vars   点开「含变量」那条后点「复制提示词」→「复制结果」（应只 +1：render）
 * 夹具标题：AC116 无变量 / AC116 含变量（与 ac-stage51.sh 创建的一致）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const [baseUrl, sid, phase] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
class Cdp {
  constructor(s){this.socket=s;this.nextId=1;this.pending=new Map();this.reqs=[];
    s.addEventListener('message',(e)=>{let m;try{m=JSON.parse(typeof e.data==='string'?e.data:'')}catch{return}
      if(m.method==='Network.requestWillBeSent'){const u=m.params?.request?.url??'';const me=m.params?.request?.method??'';
        if(u.includes('/api/'))this.reqs.push(me+' '+u.replace(baseUrl,''));}
      if(typeof m.id==='number'&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);
        m.error!==undefined?p.reject(new Error(m.error.message)):p.resolve(m.result);}});}
  send(method,params={}){const id=this.nextId++;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});
    this.socket.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout '+method));}},30000);});}
  async ev(x){const r=await this.send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.text??'eval');return r.result?.value;}
  async waitFor(x,l,t=15000){const d=Date.now()+t;for(;;){if(await this.ev(x)===true)return;if(Date.now()>d)throw new Error('超时 '+l);await sleep(120);}}
  async center(x){const v=await this.ev(`(()=>{const el=(${x});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
    if(v===null)throw new Error('找不到 '+x);return JSON.parse(v);}
  async click(x,s=600){const {x:cx,y:cy}=await this.center(x);
    await this.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:cx,y:cy,button:'none',buttons:0});await sleep(120);
    await this.send('Input.dispatchMouseEvent',{type:'mousePressed',x:cx,y:cy,button:'left',buttons:1,clickCount:1});await sleep(60);
    await this.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:cx,y:cy,button:'left',buttons:0,clickCount:1});await sleep(s);}
}
const dir=mkdtempSync(path.join(tmpdir(),'pm-ac49c-'));
const child=spawn(CHROME,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars',
  '--force-color-profile=srgb','--window-size=1600,900','--user-data-dir='+dir,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','ignore']});
try{
  let port=null;
  for(let i=0;i<100&&port===null;i++){try{port=Number(readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
  const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  const cdp=new Cdp(ws);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Network.setCookie',{name:'pm_sid',value:sid,domain:new URL(baseUrl).hostname,path:'/',httpOnly:true,sameSite:'Lax'});
  await cdp.send('Page.navigate',{url:`${baseUrl}/`});
  await cdp.waitFor(`document.querySelector('[data-testid="pm-split-item"]')!==null`,'列表');
  await sleep(700);
  cdp.reqs.length=0;
  const item = (t) => `[...document.querySelectorAll('[data-testid="pm-split-item"]')].find(el=>el.innerText.includes('${t}'))`;
  if(phase==='open-vars'){ await cdp.click(item('AC116 含变量'),1200); }
  if(phase==='open-plain'){ await cdp.click(item('AC116 无变量'),1200); }
  /** 只点「复制提示词」把填值弹窗打开（含变量）—— 这一步**不该**有任何记账请求 */
  if(phase==='vars-dialog'){
    await cdp.click(item('AC116 含变量'),1200);
    cdp.reqs.length=0;                     // 只统计"点复制"之后的请求
    await cdp.click(`document.querySelector('[data-testid="pm-detail-copy"]')`,1200);
  }
  if(phase==='copy-vars'){
    await cdp.click(item('AC116 含变量'),1200);
    console.log('AFTER_OPEN_REQS:'); console.log(cdp.reqs.join('\n')||'(none)');
    cdp.reqs.length=0;
    await cdp.click(`document.querySelector('[data-testid="pm-detail-copy"]')`,900);
    const hasDlg = await cdp.ev(`document.querySelector('.ant-modal')!==null`);
    if(hasDlg) await cdp.click(`[...document.querySelectorAll('.ant-modal button')].find(b=>b.innerText.includes('复制结果'))`,1500);
  }
  if(phase==='copy-detail-btn'){ await cdp.click(`document.querySelector('[data-testid="pm-detail-copy"]')`,900);
    const hasDlg = await cdp.ev(`document.querySelector('.ant-modal')!==null`);
    if(hasDlg) await cdp.click(`[...document.querySelectorAll('.ant-modal button')].find(b=>b.innerText.includes('复制结果'))`,1500); }
  if(phase==='copy-plain'){
    /**
     * 无变量：先点开该条（选中它），再点「复制提示词」（不弹对话框、走本地剪贴板 + 新的 copy 端点）。
     * ⚠️ 只统计"点复制"之后的请求 —— 点开那一步的 GET 是 view 留痕，不属于"复制"这一步。
     */
    await cdp.click(item('AC116 无变量'),1200);
    cdp.reqs.length=0;
    await cdp.click(`document.querySelector('[data-testid="pm-detail-copy"]')`,1500);
  }
  console.log('REQS:'); console.log(cdp.reqs.join('\n')||'(none)');
}finally{try{child.kill('SIGKILL')}catch{}rmSync(dir,{recursive:true,force:true});}
