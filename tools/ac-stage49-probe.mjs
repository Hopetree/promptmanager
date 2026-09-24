/**
 * 阶段 49 / AC-114 记账探针（真浏览器 + 真鼠标）：按**阶段**驱动界面，请求清单打到 stdout，
 * 由 tools/ac-stage49.sh 在**每步之间查库**数 usage_events —— 这样"改前多记的那一次"有据可查。
 *
 * 用法：node tools/ac-stage49-probe.mjs <baseUrl> <sid> <phase>
 *   phase = open-vars   点开「含变量」那条（应记 1 条）
 *         | copy-vars   点开后点「复制提示词」→ 填值 → 「复制结果」（**复制这一步应只 +1**：只剩 render）
 *         | open-plain  点开「无变量」那条（应记 1 条）
 *         | copy-plain  点开「无变量」那条后点「复制提示词」（**复制这一步应 +0**：零请求）
 *         | flip-theme  预留
 * 变量夹具标题：AC114 含变量 / AC114 无变量（与 ac-stage49.sh 里创建的一致）。
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
  if(phase==='open-vars'){ await cdp.click(item('AC114 含变量'),1200); }
  if(phase==='open-plain'){ await cdp.click(item('AC114 无变量'),1200); }
  if(phase==='copy-vars'){
    await cdp.click(item('AC114 含变量'),1200);
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
    // 无变量：选中后点「复制提示词」（不弹对话框）
    await cdp.click(`document.querySelector('[data-testid="pm-detail-copy"]')`,1200);
  }
  console.log('REQS:'); console.log(cdp.reqs.join('\n')||'(none)');
}finally{try{child.kill('SIGKILL')}catch{}rmSync(dir,{recursive:true,force:true});}
