/**
 * 阶段 52 / AC-117 ⑧：卡片视图截图（**有目录**与**无目录**各一张），落 `tmp/shots/stage52/`（不入库）。
 *
 * 用法：node tools/ac-stage52-shots.mjs <baseUrl> <sid> <outDir>
 *
 * 刻意做法：
 *  - 真鼠标切到卡片视图（不用 JS .click()）；
 *  - 先按标题**过滤**到目标卡片，让它在视口里放大可辨（截图要能看出「·」与间距）；
 *  - 用 `Page.captureScreenshot` 的 clip 只截那一张卡片（尺寸小、看得清）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, outDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
mkdirSync(outDir, { recursive: true });

class Cdp {
  constructor(s) {
    this.socket = s; this.nextId = 1; this.pending = new Map();
    s.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
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
  async click(x, s = 700) {
    const v = await this.ev(`(()=>{const el=(${x});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
    if (v === null) throw new Error('找不到 ' + x);
    const { x: cx, y: cy } = JSON.parse(v);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 }); await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 }); await sleep(s);
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'pm-ac52-shot-'));
const child = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--force-color-profile=srgb', '--window-size=1600,900', '--user-data-dir=' + dir, '--remote-debugging-port=0', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });
try {
  let port = null;
  for (let i = 0; i < 100 && port === null; i++) {
    try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  // 2x 缩放让「·」与 6px 间距在图上可辨
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-use-viewmode"]')!==null`, '使用视图');
  await sleep(900);

  /** 按标题过滤——留下目标那一张，卡片会被放大到整个宽度，细节才拍得清 */
  const filterTo = async (title) => {
    const input = `document.querySelector('[data-testid="pm-search-input"]')`;
    await cdp.click(input, 300);
    await cdp.ev(`(()=>{const el=${input};el.focus();el.select&&el.select();return true})()`);
    // 真键盘输入（不用 JS 赋值，避免 React 受控组件不同步）
    await cdp.send('Input.insertText', { text: title });
    await sleep(1500);
  };

  await cdp.click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>el.innerText.trim()==='卡片')`, 1200);
  await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`, '卡片视图');

  const shots = [
    { title: 'AC117 有目录', file: 'card-with-folder.png', note: '有目录（子目录「AI 协作与验收」⇒ 只显示名字，不带父级「工作」）' },
    { title: 'AC117 无目录', file: 'card-no-folder.png', note: '无目录（folder_id=NULL ⇒ 显示「未分组」）' },
  ];
  for (const shot of shots) {
    await filterTo(shot.title);
    await cdp.waitFor(`[...document.querySelectorAll('[data-testid^="pm-card-footer-"]')].length > 0`, `过滤出「${shot.title}」`);
    await sleep(500);
    const rectRaw = await cdp.ev(`(() => {
      const card = document.querySelector('[data-testid^="pm-card-footer-"]').closest('[data-testid="pm-use-card"]');
      const r = card.getBoundingClientRect();
      return JSON.stringify({ x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 });
    })()`);
    const rect = JSON.parse(rectRaw);
    const out = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 2 } });
    const file = path.join(outDir, shot.file);
    writeFileSync(file, Buffer.from(out.data, 'base64'));
    const shown = await cdp.ev(`(() => { const f = document.querySelector('[data-testid^="pm-card-footer-"]'); return (f.innerText||'').replace(/\\n/g,' · '); })()`);
    console.log(`SHOT ${shot.file} | ${shot.note}`);
    console.log(`     页面该行文本：${shown}`);
  }
} finally {
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
}
