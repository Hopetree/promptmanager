/**
 * 阶段 56 / FR-124 / AC-120：关于页重做的真浏览器实测（串行、单上下文、用完即关）。
 *
 * 用法：node tools/ac-stage56-about-probe.mjs <baseUrl> <sid> <form:pc|mobile> <outDir>
 *
 * 覆盖 AC-120：①定位文案 ②版本与 /healthz 一致 ③关键词 ③b 访问地址在身份区且随协议
 * ③c 无「检查更新」入口/无出网请求 ④五项齐全 ⑤href≥4 且带 target/rel ⑥仓库规范形式
 * ⑦镜像名与 CI 一致、无历史版本号 ⑧许可证 MIT ⑨维护区命令核对 ⑭移动端折叠/可滚 ⑮PC 无横向溢出
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, form, outDir] = process.argv.slice(2);
const isMobile = form === 'mobile';
const W = isMobile ? 440 : 1440;
const H = isMobile ? 956 : 900;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

function resources() {
  try {
    const o = execFileSync('bash', ['-c', "free -m | awk 'NR==2{print $7}'; uptime | sed 's/.*load average: //' | cut -d, -f1"], { encoding: 'utf8' }).trim().split('\n');
    return { availableMB: Number(o[0]), load1: Number(o[1]) };
  } catch { return { availableMB: -1, load1: -1 }; }
}
const check = (id, data) => console.log(`CHECK|${id}|${JSON.stringify({ ...data, _res: resources() })}`);

class Cdp {
  constructor(s) {
    this.socket = s; this.n = 1; this.p = new Map(); this.outbound = [];
    s.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params?.request?.url ?? '';
        // 记录一切**非同源**请求（AC-120 ③c：不得有任何出网请求）
        if (!u.startsWith(baseUrl) && !u.startsWith('data:') && !u.startsWith('blob:')) this.outbound.push(u);
      }
      if (typeof m.id !== 'number' || !this.p.has(m.id)) return;
      const q = this.p.get(m.id); this.p.delete(m.id);
      m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = this.n++;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error('timeout ' + method)); } }, 25000);
    });
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split('\n')[0]);
    return r.result?.value;
  }
  async waitFor(e, l, t = 20000) {
    const d = Date.now() + t;
    for (;;) { if (await this.ev(e) === true) return; if (Date.now() > d) throw new Error('超时 ' + l); await sleep(150); }
  }
  async click(expr, wait = 900) {
    await this.ev(`(()=>{const el=(${expr});el.scrollIntoView({block:'center',inline:'center'});return true})()`).catch(() => {});
    await sleep(150);
    const b = await this.ev(`(()=>{const el=(${expr});if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
    if (b === null) throw new Error('点不到 ' + String(expr).slice(0, 70));
    const { x, y } = JSON.parse(b);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }); await sleep(90);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(wait);
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(outDir, `${form}-${name}.png`), Buffer.from(r.data, 'base64'));
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'pm-s56-'));
const child = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--force-color-profile=srgb', `--window-size=${W},${H}`, '--user-data-dir=' + dir, '--remote-debugging-port=0', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

let cdp = null;
try {
  let port = null;
  for (let i = 0; i < 120 && port === null; i++) {
    try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: isMobile });
  if (isMobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: baseUrl + '/' });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-topnav"]')!==null`, '主界面');
  await sleep(1800);

  // 打开「⋯更多 → 关于」（懒加载，给足时间）
  await cdp.click(`document.querySelector('[data-testid="header-more"]')`, 700);
  await cdp.waitFor(`document.querySelector('.ant-dropdown-menu')!==null`, '⋯更多');
  await cdp.click(`[...document.querySelectorAll('.ant-dropdown-menu-item')].find(el=>(el.innerText||'').includes('关于'))`, 2600);
  await cdp.waitFor(`document.querySelector('[data-testid="pm-about"]')!==null`, '关于弹窗');
  await sleep(1800);

  // ---- ③c 记录打开过程是否产生出网请求 ----
  const outbound = cdp.outbound.filter((u) => !u.startsWith('chrome-extension://'));

  const dump = await cdp.ev(`(() => {
    const root = document.querySelector('[data-testid="pm-about"]');
    const q = (s) => root.querySelector(s);
    const txt = (e) => (e === null ? null : (e.innerText || '').replace(/\\s+/g, ' ').trim());
    const links = [...root.querySelectorAll('a[href]')].map(a => ({
      text: (a.innerText || '').trim(), href: a.getAttribute('href'),
      target: a.getAttribute('target'), rel: a.getAttribute('rel'),
      outer: a.outerHTML.replace(/\\s+/g, ' ').slice(0, 180),
    }));
    const de = document.documentElement;
    const wrap = [...document.querySelectorAll('.ant-modal-wrap')].find(e => { const r = e.getBoundingClientRect(); return r.width > 1; });
    const modal = wrap === undefined ? null : wrap.querySelector('.ant-modal');
    return JSON.stringify({
      positioning: txt(q('[data-testid="pm-about-positioning"]')),
      versionLine: txt(q('.pm-about-status')),
      address: txt(q('[data-testid="pm-about-address"]')),
      keywords: [...q('[data-testid="pm-about-keywords"]').querySelectorAll('.ant-tag')].map(e => (e.innerText || '').trim()),
      linksZoneText: txt(q('[data-testid="pm-about-links"]')),
      links,
      hrefCount: links.length,
      allHaveTarget: links.every(a => a.target === '_blank'),
      allHaveNoopener: links.every(a => (a.rel || '').includes('noopener')),
      hasServiceZone: /\\n服务\\n/.test(root.innerText) || root.innerText.includes('数据文件') || root.innerText.includes('备份方式'),
      hasUpdateCheck: /检查更新|检查新版本|查看更新|有新版本|update/i.test(root.innerText),
      fullText: root.innerText.replace(/\\n/g, ' ⏎ '),
      pageOverflowX: de.scrollWidth - de.clientWidth,
      modalH: modal === null ? null : Math.round(modal.getBoundingClientRect().height),
      wrapScrollH: wrap === undefined ? null : wrap.scrollHeight,
      wrapClientH: wrap === undefined ? null : wrap.clientHeight,
      wrapCanScroll: wrap === undefined ? null : wrap.scrollHeight > wrap.clientHeight,
      usageOpen: root.innerText.includes('点右上角「新建」写一条'),
    });
  })()`);
  const d = JSON.parse(dump);
  check('about', { ...d, outboundCount: outbound.length, outbound: outbound.slice(0, 5) });
  await cdp.shot('about-initial');

  // ---- 移动端：折叠态可展开（AC-120 ⑭）----
  if (isMobile) {
    const header = `(()=>{const it=[...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')].find(x=>(x.querySelector('.ant-collapse-header')?.innerText||'').includes('使用'));return it===undefined?null:it})()`;
    const beforeOpen = await cdp.ev(`${header} !== null && ${header}.classList.contains('ant-collapse-item-active')`);
    if (beforeOpen !== true) {
      await cdp.click(`${header}.querySelector('.ant-collapse-header')`, 1000);
    }
    const afterOpen = await cdp.ev(`(()=>{const it=${header};return it===null?null:{active:it.classList.contains('ant-collapse-item-active'), lines:it.querySelectorAll('.ant-list-item').length}})()`);
    const scrollAfter = await cdp.ev(`(()=>{const w=[...document.querySelectorAll('.ant-modal-wrap')].find(e=>{const r=e.getBoundingClientRect();return r.width>1});if(w===undefined)return null;w.scrollTop=99999;const m=w.querySelector('.ant-modal');return JSON.stringify({canScroll:w.scrollHeight>w.clientHeight,scrollTop:w.scrollTop,modalBottom:m===null?null:Math.round(m.getBoundingClientRect().bottom),innerH:window.innerHeight})})()`);
    check('mobile-collapse', { initiallyOpen: beforeOpen, afterExpand: afterOpen, wrapScroll: JSON.parse(scrollAfter ?? 'null') });
    await sleep(500);
    await cdp.shot('about-expanded');
    // 维护区也展开一下，确认可展开
    const mHdr = `(()=>{const it=[...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')].find(x=>(x.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'));return it===null?null:it.querySelector('.ant-collapse-header')})()`;
    await cdp.click(mHdr, 1000);
    const maint = await cdp.ev(`(()=>{const it=[...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')].find(x=>(x.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'));return it===null?null:{active:it.classList.contains('ant-collapse-item-active'),cmds:[...it.querySelectorAll('.pm-about-pre')].map(e=>(e.innerText||'').trim()).slice(0,6)}})()`);
    check('mobile-maintain', maint);
    await sleep(500);
    await cdp.shot('about-maintain');
  } else {
    // PC：维护区展开取命令清单
    const mHdr = `(()=>{const it=[...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')].find(x=>(x.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'));return it===null?null:it.querySelector('.ant-collapse-header')})()`;
    await cdp.click(mHdr, 1000);
    const maint = await cdp.ev(`(()=>{const it=[...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')].find(x=>(x.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'));return it===null?null:{active:it.classList.contains('ant-collapse-item-active'),cmds:[...it.querySelectorAll('.pm-about-pre')].map(e=>(e.innerText||'').trim())}})()`);
    check('pc-maintain', maint);
    const scrollP = await cdp.ev(`(()=>{const w=[...document.querySelectorAll('.ant-modal-wrap')].find(e=>{const r=e.getBoundingClientRect();return r.width>1});return w===null?null:{canScroll:w.scrollHeight>w.clientHeight,scrollH:w.scrollHeight,clientH:w.clientHeight}})()`);
    check('pc-scroll', scrollP);
    await sleep(400);
    await cdp.shot('about-maintain');
  }

  console.log('DONE');
} catch (err) {
  console.log(`FATAL|${String(err && err.message ? err.message : err)}`);
  process.exitCode = 1;
} finally {
  try { if (cdp !== null) await cdp.send('Browser.close'); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
  console.log(`CLOSED|${form}`);
}
