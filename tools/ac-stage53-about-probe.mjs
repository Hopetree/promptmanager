/**
 * 阶段 53 / FR-117（R-9）/ AC-118 A①–④：「关于」页「访问地址」的真浏览器实测。
 *
 * 用法：node tools/ac-stage53-about-probe.mjs <baseUrl> <sid>
 *
 * 输出：
 *   LOCATION_ORIGIN:<浏览器实际的 origin>
 *   ABOUT_ADDRESS:<「访问地址」那一行显示的文本>
 *   COPIED:<点击复制按钮后真正进入剪贴板的文本>
 *   ABOUT_OTHERS:<关于弹窗其它关键信息的 JSON（版本/状态/数据文件/备份方式/使用区条数/维护区命令数）>
 *   REQS:<打开关于弹窗期间发生的 /api 与 /healthz 请求清单>   ← 证明「不新增网络请求」
 *   OVERFLOW:<页面级横向溢出量 scrollWidth-clientWidth>
 *
 * 复制内容的取法：页面脚本运行前挂钩 `navigator.clipboard.writeText` 与 `document.execCommand('copy')`
 * （antd Typography 的 copyable 走的就是这两条），把进入剪贴板的文本记进 `window.__copied`。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

class Cdp {
  constructor(s) {
    this.socket = s; this.nextId = 1; this.pending = new Map(); this.reqs = [];
    s.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params?.request?.url ?? '';
        const me = m.params?.request?.method ?? '';
        // 只记「数据请求」（/api/* 与 /healthz）。品牌图 /promptmanager-48.png、css、js 是**既有静态资源**，
        // 与「有没有为拿地址新增网络请求」无关，混进来会让判据失真。
        if (u.startsWith(baseUrl) && (u.replace(baseUrl, '').startsWith('/api/') || u.replace(baseUrl, '').startsWith('/healthz'))) {
          this.reqs.push(`${me} ${u.replace(baseUrl, '') || '/'}`);
        }
      }
      if (typeof m.id === 'number' && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error !== undefined ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval');
    return r.result?.value;
  }
  async waitFor(x, l, t = 20000) {
    const d = Date.now() + t;
    for (;;) { if (await this.ev(x) === true) return; if (Date.now() > d) throw new Error('超时 ' + l); await sleep(120); }
  }
  /** 真鼠标三连（AC 规范：绝不用 JS .click()） */
  async click(x, s = 700) {
    const v = await this.ev(`(()=>{const el=(${x});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
    if (v === null) throw new Error('找不到 ' + x);
    const { x: cx, y: cy } = JSON.parse(v);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 }); await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 }); await sleep(s);
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'pm-s53-about-'));
const child = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--force-color-profile=srgb', '--ignore-certificate-errors', '--window-size=1600,900',
  '--user-data-dir=' + dir, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
try {
  let port = null;
  for (let i = 0; i < 100 && port === null; i++) {
    try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  // 挂钩两条剪贴板路径（antd copyable 用的就是它们），记录真正写入的文本
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__copied = [];
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const w = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (t) => { window.__copied.push(String(t)); return w(t); };
    }
    const origExec = document.execCommand && document.execCommand.bind(document);
    document.execCommand = function (cmd, ...rest) {
      if (cmd === 'copy') window.__copied.push(String(document.getSelection ? document.getSelection() : ''));
      return origExec ? origExec(cmd, ...rest) : false;
    };
  ` });
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-topnav"]')!==null`, '主界面');
  await sleep(700);

  console.log('LOCATION_ORIGIN:' + (await cdp.ev('window.location.origin')));
  console.log('LOCATION_PROTO:' + (await cdp.ev('window.location.protocol')));
  console.log('LOCATION_HOST:' + (await cdp.ev('window.location.host')));

  // 只统计"打开关于弹窗"这一步的请求 —— 用来证明没有为拿地址新增网络请求
  cdp.reqs.length = 0;
  // ⋯更多 → 关于（真鼠标两步）
  await cdp.click(`document.querySelector('[data-testid="pm-topnav"] button[aria-haspopup="menu"], .ant-dropdown-trigger')`, 500);
  await cdp.waitFor(`document.querySelector('[data-testid="pm-settings"]')!==null`, '⋯更多菜单');
  await cdp.click(`document.querySelector('[data-testid="pm-settings"]')`, 1400);
  await cdp.waitFor(`document.querySelector('[data-testid="pm-about"]')!==null`, '关于弹窗');
  await sleep(900);

  // 「访问地址」那一行：antd 6 的 bordered Descriptions 是 label / content 两格，
  // 取**内容格**（.ant-descriptions-item-content），不要连 label 一起取（否则值里会带"访问地址\t"）。
  const addr = await cdp.ev(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="pm-about"] .ant-descriptions-row')];
    const row = rows.find(r => (r.innerText||'').includes('访问地址'));
    if (!row) return null;
    const content = row.querySelector('.ant-descriptions-item-content');
    return (content ? content.innerText : row.innerText).replace(/\\n/g, ' ').trim();
  })()`);
  console.log('ABOUT_ADDRESS:' + (addr === null ? '(未找到访问地址行)' : addr));

  // 维护分区默认折叠 ⇒ 先用**真鼠标**展开，才能核"其它信息不变"（里面的 5 条命令）
  const maintOpen = await cdp.ev(`(() => {
    const p = [...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')]
      .find(x => (x.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'));
    return p !== undefined && p.classList.contains('ant-collapse-item-active');
  })()`);
  if (maintOpen !== true) {
    await cdp.click(`[...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')]
      .find(x => (x.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'))
      .querySelector('.ant-collapse-header')`, 700);
  }

  // 点复制（antd copyable 的图标按钮），然后读真正进剪贴板的内容
  const copySel = `(() => {
    const rows = [...document.querySelectorAll('[data-testid="pm-about"] .ant-descriptions-row')];
    const row = rows.find(r => (r.innerText||'').includes('访问地址'));
    const btn = row && row.querySelector('.ant-typography-copy');
    return btn ? true : null;
  })()`;
  const hasCopy = await cdp.ev(copySel);
  if (hasCopy === true) {
    await cdp.click(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="pm-about"] .ant-descriptions-row')];
      const row = rows.find(r => (r.innerText||'').includes('访问地址'));
      return row.querySelector('.ant-typography-copy');
    })()`, 900);
    // 过滤空串：execCommand 路径记录的是"当前选区"，antd 实际走 clipboard 写入路径；
    // 空选区不是"复制到的内容"，留着只会干扰判读。
    console.log('COPIED:' + (await cdp.ev('JSON.stringify((window.__copied||[]).filter(t => t !== "" && t !== "undefined"))')));
  } else {
    console.log('COPIED:[]  (未找到复制按钮)');
  }

  const others = await cdp.ev(`(() => {
    const root = document.querySelector('[data-testid="pm-about"]');
    const rows = [...root.querySelectorAll('.ant-descriptions-row')].map(r => (r.innerText||'').replace(/\\n/g,' = ').trim());
    const panels = [...root.querySelectorAll('.ant-collapse-item')].map(p => (p.querySelector('.ant-collapse-header')?.innerText||'').trim());
    const usagePanel = [...root.querySelectorAll('.ant-collapse-item')].find(p => (p.querySelector('.ant-collapse-header')?.innerText||'').includes('使用'));
    const maintPanel = [...root.querySelectorAll('.ant-collapse-item')].find(p => (p.querySelector('.ant-collapse-header')?.innerText||'').includes('维护'));
    return JSON.stringify({
      rows, panels,
      usageLines: usagePanel ? usagePanel.querySelectorAll('.ant-list-item').length : 0,
      maintCommands: maintPanel ? [...maintPanel.querySelectorAll('.ant-typography-copy')].map(e => (e.innerText||'').trim().slice(0,26)) : [],
      hasBrandArt: root.querySelector('[data-testid="pm-brand-art-about"]') !== null,
      statusTag: (root.querySelector('.ant-tag')?.innerText||'').trim(),
      versionText: (root.querySelector('.pm-about-status')?.innerText||'').replace(/\\n/g,' ').trim(),
    });
  })()`);
  console.log('ABOUT_OTHERS:' + others);
  console.log('REQS:' + JSON.stringify(cdp.reqs));
  console.log('OVERFLOW:' + (await cdp.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth')));
} finally {
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
}
