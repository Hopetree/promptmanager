#!/usr/bin/env node
/**
 * 阶段 48 颜色探针：量令牌「状态」列三类标签的 getComputedStyle(backgroundColor/color)。
 *   colors <baseUrl> <sid> <shotsDir> [theme]
 * 环境变量 AC113_READ_ID / AC113_WRITE_ID / AC113_REVOKED_ID 指定三类行的 id（便于精确取）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (mode !== 'colors' || baseUrl === undefined || sid === undefined) {
  console.error('用法：node ac48-colors-probe.mjs colors <baseUrl> <sid> [shotsDir] [light|dark]');
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage48';
const THEME = rest[1] ?? 'light';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));

class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.errors = [];
    socket.addEventListener('message', (event) => {
      let m; try { m = JSON.parse(typeof event.data === 'string' ? event.data : ''); } catch { return; }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params?.exceptionDetails?.text ?? 'exception');
      if (typeof m.id === 'number' && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error !== undefined) reject(new Error(m.error.message ?? 'CDP')); else resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时：' + method)); } }, 30_000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails !== undefined) throw new Error('求值失败：' + (r.exceptionDetails.text ?? ''));
    return r.result?.value;
  }
  async waitFor(expr, label, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) { if ((await this.evaluate(expr)) === true) return; if (Date.now() > deadline) throw new Error('等待超时：' + label); await sleep(120); }
  }
  async waitForSoft(expr, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) { if ((await this.evaluate(expr)) === true) return true; if (Date.now() > deadline) return false; await sleep(120); }
  }
  async centerOf(jsExpr) {
    const v = await this.evaluate(`(() => { const el = (${jsExpr}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    if (v === null) throw new Error('找不到元素：' + jsExpr);
    return JSON.parse(v);
  }
  async realClickOf(jsExpr, settle = 500) {
    const { x, y } = await this.centerOf(jsExpr);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(r.data, 'base64'));
  }
}
async function openSocket(url) {
  const s = new WebSocket(url);
  await new Promise((res, rej) => { s.addEventListener('open', res, { once: true }); s.addEventListener('error', rej, { once: true }); });
  return s;
}

const SCROLLER = `(document.querySelector('.pm-tokens .ant-table-content') ?? document.querySelector('.pm-tokens .ant-table-container'))`;

/** 三类行的后台色/文字色。按 data-testid 精确取（AC113_*_ID），并同时给"全表扫描"的直方图。 */
const COLORS = `(() => {
  const style = (el) => { if (el === null) return null; const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, border: s.borderColor }; };
  const byId = (id) => document.querySelector('[data-testid="pm-token-state-' + id + '"]');
  const scan = [...document.querySelectorAll('[data-testid^="pm-token-state-"]')].map((el) => ({
    id: el.getAttribute('data-testid').replace('pm-token-state-', ''),
    text: el.innerText.trim(),
    ...style(el),
  }));
  return JSON.stringify({
    read: style(byId(window.__ac113_read)),
    write: style(byId(window.__ac113_write)),
    revoked: style(byId(window.__ac113_revoked)),
    scan,
    heads: [...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim()),
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac48-'));
  const child = spawn(CHROME, ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars',
    '--force-color-profile=srgb','--window-size=1600,900','--user-data-dir='+userDataDir,'--remote-debugging-port=0','about:blank'],
    { stdio: ['ignore','ignore','ignore'] });
  const out = {};
  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 100 && port === null; i += 1) { try { port = Number(readFileSync(portFile,'utf8').split('\n')[0]); } catch { await sleep(100); } }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','${THEME}'); true`);
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-mark"]') !== null`, '主界面');
    await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
    await cdp.realClickOf(`[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`, 900);
    await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
    await cdp.waitFor(`(() => { const d = document.querySelector('.pm-tokens .ant-drawer-content-wrapper'); if (d === null) return false; const left = Math.round(d.getBoundingClientRect().left); const same = window.__c48 === left; window.__c48 = left; return same; })()`, '抽屉动画结束', 15_000);
    await sleep(300);
    await cdp.evaluate(`window.__ac113_read='${process.env['AC113_READ_ID'] ?? ''}'; window.__ac113_write='${process.env['AC113_WRITE_ID'] ?? ''}'; window.__ac113_revoked='${process.env['AC113_REVOKED_ID'] ?? ''}'; true`);
    out.theme = THEME;
    out.colors = await cdp.evaluate(COLORS);

    // AC-113 ⑤：真鼠标点「有效」状态 → 弹菜单（只读/读写）→ 选另一项 → 文本与背景色都跟着变
    const RID = process.env['AC113_READ_ID'] ?? '';
    const menuItems = `[...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')]`;
    const stateOf = (id) => `(() => { const el = document.querySelector('[data-testid="pm-token-state-${id}"]'); if (el === null) return null; const s = getComputedStyle(el); return { text: el.innerText.trim(), bg: s.backgroundColor, color: s.color }; })()`;
    if (RID !== '') {
      await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 0; return true; })()`);
      await sleep(300);
      out.before = await cdp.evaluate(stateOf(RID));
      const pick = async (label, expect) => {
        for (let a = 1; a <= 2; a += 1) {
          await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${RID}"]')`, 800);
          await cdp.realClickOf(`${menuItems}.find((el) => el.innerText.trim() === '${label}')`, 500);
          if (await cdp.waitForSoft(`(document.querySelector('[data-testid="pm-token-state-${RID}"]')?.innerText.trim() ?? null) === '${expect}'`, 8_000)) return a;
        }
        return 0;
      };
      out.menu_items = await (async () => {
        await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${RID}"]')`, 700);
        const items = await cdp.evaluate(`JSON.stringify(${menuItems}.map((el) => el.innerText.trim()))`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(400);
        return items;
      })();
      out.up_attempts = await pick('读写', '有效 · 读写');
      out.after_write = await cdp.evaluate(stateOf(RID));
      await cdp.shot(`${THEME === 'dark' ? '04' : '03'}-tokens-${THEME}-flipped`);
      out.down_attempts = await pick('只读', '有效 · 只读');
      out.after_read = await cdp.evaluate(stateOf(RID));
    }
    await cdp.shot(`${THEME === 'dark' ? '02' : '01'}-tokens-${THEME}`);
    out.runtime_errors = JSON.stringify(cdp.errors);
  } finally {
    for (const [k, v] of Object.entries(out)) console.log(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    try { child.kill('SIGKILL'); } catch {}
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
await main();
