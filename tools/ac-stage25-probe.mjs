#!/usr/bin/env node
/**
 * 阶段 25 / FR-76 运行时探针（AC-76）：
 *   桌面 1600×900：品牌区文字精确 = PromptM（≠ PromptManager）；图标 mark 存在且 26×26；document.title 仍是 PromptManager；
 *                  点 logo 回主页（AC-51）；顶栏按钮 left 坐标升序（AC-47）；无横向溢出；截图。
 *   移动 390×844：品牌文字**不渲染**（只有图标）；无横向溢出；截图。
 *
 * 用法：node tools/ac-stage25-probe.mjs <baseUrl> <sid> [shotsDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, shotsDir = 'tmp/shots/stage25'] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage25-probe.mjs <baseUrl> <sid> [shotsDir]');
  process.exit(2);
}
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
  async realClick(selector, settle = 600) {
    const value = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${selector}`);
    const { x, y } = JSON.parse(value);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
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

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac25-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1600,900', '--user-data-dir=' + userDataDir, '--remote-debugging-port=0', 'about:blank'],
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
    if (port === null || Number.isNaN(port)) throw new Error('chrome 未写出 DevToolsActivePort');
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });

    const load = async (width, height, ready) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(900);
    };

    // ---------- 桌面 ----------
    await load(1600, 900, `!!document.querySelector('[data-testid="pm-brand-mark"]')`);
    out.ac76_brand_text = await cdp.evaluate(
      `String(document.querySelector('[data-testid="pm-brand-text"]')?.innerText ?? '')`,
    );
    out.ac76_brand_absent_fullname = await cdp.evaluate(
      `String(document.querySelector('[data-testid="pm-topnav"]')?.innerText.includes('PromptManager') ?? false)`,
    );
    out.ac76_document_title = await cdp.evaluate(`String(document.title)`);
    out.ac76_mark = await cdp.evaluate(
      `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-brand-mark"]'); if (el === null) return null; const r = el.getBoundingClientRect(); return { src: el.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height), naturalW: el.naturalWidth, naturalH: el.naturalHeight }; })())`,
    );
    out.ac76_button_lefts = await cdp.evaluate(
      // AC-47：顶栏四个操作按钮（新建 / 更多 / 主题 / 登出）的 left 必须严格升序
      `JSON.stringify(['header-new', 'header-more', 'pm-theme-toggle', 'header-logout'].map((id) => { const el = document.querySelector('[data-testid="' + id + '"]'); return { testid: id, left: el === null ? null : Math.round(el.getBoundingClientRect().left) }; }))`,
    );
    out.ac76_scroll = await cdp.evaluate(
      `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })`,
    );
    await cdp.shot('01-desktop-brand-light');

    // AC-51：点 logo 回主页（先切到表格视图 + 翻页/进详情，再点 logo 断言回主页）
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; items.find((n) => n.innerText.includes('表格')).click(); return true; })()`,
    );
    await sleep(800);
    await cdp.realClick('[data-testid="pm-brand-mark"]', 900);
    out.ac76_after_logo_click = await cdp.evaluate(
      `JSON.stringify({ view: document.querySelector('[data-testid="pm-view-card"]') !== null ? 'card' : document.querySelector('[data-testid="pm-view-table"]') !== null ? 'table' : 'split', search: String(document.querySelector('[data-testid="pm-search-input"]')?.value ?? '') })`,
    );
    await cdp.shot('02-desktop-after-logo-click-light');

    // ---------- 移动 ----------
    await load(390, 844, `!!document.querySelector('[data-testid="pm-brand-mark"]')`);
    out.ac76_mobile_brand_text = await cdp.evaluate(
      `JSON.stringify({ brandTextExists: document.querySelector('[data-testid="pm-brand-text"]') !== null, markExists: document.querySelector('[data-testid="pm-brand-mark"]') !== null, headerText: String(document.querySelector('[data-testid="pm-topnav"]')?.innerText ?? '').replace(/\\n/g, ' | ') })`,
    );
    out.ac76_mobile_scroll = await cdp.evaluate(
      `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })`,
    );
    await cdp.shot('03-mobile-brand-light');
    out.ac25_runtime_errors = JSON.stringify(cdp.errors);
  } finally {
    for (const [key, value] of Object.entries(out)) console.log(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
