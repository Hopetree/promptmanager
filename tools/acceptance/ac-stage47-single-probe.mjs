#!/usr/bin/env node
/**
 * 阶段 47 / AC-111 ② 单版本探针：只有 1 个版本的 prompt，默认必须是 **v1 ↔ v1**（不报错、不空白）。
 *
 *   single <baseUrl> <sid> [shotsDir]
 *     打开"只有一个版本"的 prompt 详情（按标题定位列表项）→ 读 diff 头部与下拉值 + 错误提示
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (mode !== 'single' || baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage47-single-probe.mjs single <baseUrl> <sid> [shotsDir] [title]');
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage47';
const TITLE = rest[1] ?? 'AC111 单版本';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.text ?? 'exception');
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined) reject(new Error(message.error.message ?? 'CDP 错误'));
        else resolve(message.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30_000);
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails !== undefined) throw new Error(`求值失败：${result.exceptionDetails.text ?? ''}`);
    return result.result?.value;
  }
  async waitFor(expression, label, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
  }
  async centerOf(jsExpr) {
    const value = await this.evaluate(
      `(() => { const el = (${jsExpr}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${jsExpr}`);
    return JSON.parse(value);
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
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(result.data, 'base64'));
  }
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return socket;
}

const GEO = `(() => {
  const panel = document.querySelector('[data-testid="pm-panel-versions"]') ?? document.querySelector('[data-testid="pm-detail"]') ?? document.body;
  const pre = panel.querySelector('pre');
  const txt = pre === null ? '' : pre.innerText;
  const from = /---\\s*v(\\d+)/.exec(txt);
  const to = /\\+\\+\\+\\s*v(\\d+)/.exec(txt);
  const sel = [...panel.querySelectorAll(':is(.ant-flex) .ant-select')].map((s) => (s.querySelector('.ant-select-content') ?? s).innerText.trim());
  return JSON.stringify({
    diffHead: pre === null ? null : txt.split('\\n').slice(0, 3).join(' | '),
    fromVersion: from === null ? null : Number(from[1]),
    toVersion: to === null ? null : Number(to[1]),
    compareSelects: sel.filter((v) => /^v\\d+$/.test(v)),
    hasError: panel.querySelector('.ant-alert-error') !== null,
    errorText: panel.querySelector('.ant-alert-error')?.innerText ?? null,
    emptyState: (panel.innerText || '').includes('还没有版本'),
    panelTextLen: (panel.innerText || '').length,
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac47s-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1600,900', '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=0', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const out = {};
  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 100 && port === null; i += 1) {
      try {
        port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      } catch {
        await sleep(100);
      }
    }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-mark"]') !== null`, '主界面');
    // 用搜索框缩小到那条 prompt，再点它（标题唯一）
    await cdp.waitFor(`document.querySelector('[data-testid="pm-split-item"]') !== null`, 'prompt 列表');
    await cdp.realClickOf(
      `[...document.querySelectorAll('[data-testid="pm-split-item"]')].find((el) => (el.innerText || '').includes(${JSON.stringify(TITLE)}))`,
      1500,
    );
    await cdp.waitFor(
      `(document.querySelector('[data-testid="pm-panel-versions"]') !== null) || (document.querySelector('[data-testid="pm-detail"] pre') !== null)`,
      '版本面板 / diff 出现',
    );
    await sleep(900);
    out.geo_single = await cdp.evaluate(GEO);
    await cdp.shot('03-versions-single');
    out.runtime_errors = JSON.stringify(cdp.errors);
  } finally {
    for (const [k, v] of Object.entries(out)) console.log(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
