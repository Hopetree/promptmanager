#!/usr/bin/env node
/**
 * 阶段 17 运行时探针：AC-59（品牌图形全站统一：同一枚图标，只换尺寸）。
 *
 * 覆盖：顶栏 mark 26×26（矢量）、三处装饰位尺寸（登录页 96 / 空态 72 / 关于页 48）与 `aria-hidden`、
 * 「空态有数据时不出现」、**真鼠标**点三处装饰位无任何动作、**真鼠标**点 logo 仍回主页。
 *
 * 用法：node tools/ac-stage17-probe.mjs <baseUrl> <sid>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage17-probe.mjs <baseUrl> <sid>');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((candidate) => existsSync(candidate));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
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
    if (result.exceptionDetails !== undefined) {
      throw new Error(`页面内求值失败：${result.exceptionDetails.text ?? ''}`);
    }
    return result.result?.value;
  }
  async waitFor(expression, label, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
  }
  async center(selector) {
    const value = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${selector}`);
    return JSON.parse(value);
  }
  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  }
  async mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  /** 真鼠标点击（不依赖 JS .click()） */
  async realClick(selector, settle = 400) {
    const { x, y } = await this.center(selector);
    await this.mouseMove(x, y);
    await sleep(150);
    await this.mouseClick(x, y);
    await sleep(settle);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac17-'));
  const child = spawn(
    CHROME,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--window-size=1280,800',
      '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=0',
      'about:blank',
    ],
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
    const socket = await openSocket(page.webSocketDebuggerUrl);
    const cdp = new Cdp(socket);
    globalThis.cdp = cdp;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    const origin = new URL(baseUrl).origin;
    const setSession = async () => {
      await cdp.send('Network.setCookie', {
        name: 'pm_sid',
        value: sid,
        domain: new URL(baseUrl).hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      });
    };
    const navigate = async (ready) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(700);
    };
    const artInfo = async (testid) =>
      cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]'); if (el === null) return 'missing'; const r = el.getBoundingClientRect(); return JSON.stringify({ src: el.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height), hidden: el.getAttribute('aria-hidden'), pointer: getComputedStyle(el).pointerEvents, cursor: getComputedStyle(el).cursor }); })()`,
      );

    // ---------- ① 登录页：96 装饰位，真鼠标点击无动作 ----------
    await cdp.send('Network.clearBrowserCookies');
    await navigate(`!!document.querySelector('[data-testid="pm-login"]')`);
    out.ac59_login_art = await artInfo('pm-brand-art-login');
    const loginArt = out.ac59_login_art === 'missing' ? {} : JSON.parse(out.ac59_login_art);
    out.ac59_login_art_ok = String(loginArt.src === '/promptmanager-96.png' && loginArt.w === 96 && loginArt.h === 96 && loginArt.hidden === 'true');
    const beforeLoginClick = await cdp.evaluate(`document.querySelector('[data-testid="pm-login"]') !== null`);
    await cdp.realClick('[data-testid="pm-brand-art-login"]');
    const afterLoginClick = await cdp.evaluate(`document.querySelector('[data-testid="pm-login"]') !== null`);
    out.ac59_login_art_no_action = String(beforeLoginClick === true && afterLoginClick === true);

    // ---------- ② 空态：72 装饰位（库为空时）----------
    await setSession();
    await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-brand-art-empty"]')`, '空态品牌图形');
    out.ac59_empty_art = await artInfo('pm-brand-art-empty');
    const emptyArt = JSON.parse(out.ac59_empty_art);
    out.ac59_empty_art_ok = String(emptyArt.src === '/promptmanager-72.png' && emptyArt.w === 72 && emptyArt.h === 72 && emptyArt.hidden === 'true');
    // 比较必须用**同一个字段集合**（上一版探针自己多加了字段导致假红）
    const emptyState = async () =>
      cdp.evaluate(
        `JSON.stringify({ url: location.href, dialogs: document.querySelectorAll('.ant-modal').length, stillEmpty: !!document.querySelector('[data-testid="pm-brand-art-empty"]') })`,
      );
    const beforeEmptyClick = await emptyState();
    await cdp.realClick('[data-testid="pm-brand-art-empty"]');
    const afterEmptyClick = await emptyState();
    out.ac59_empty_art_before = beforeEmptyClick;
    out.ac59_empty_art_after = afterEmptyClick;
    out.ac59_empty_art_no_action = String(beforeEmptyClick === afterEmptyClick);
    // 装饰位不得是"看起来可点"的（cursor 不能是 pointer）
    out.ac59_art_cursors = await cdp.evaluate(
      `JSON.stringify(['pm-brand-art-login','pm-brand-art-empty','pm-brand-art-about'].map((id) => { const el = document.querySelector('[data-testid="' + id + '"]'); return el === null ? [id, 'missing'] : [id, getComputedStyle(el).cursor]; }))`,
    );

    // ---------- ③ 「有数据时不出现」：造一条 prompt ----------
    await cdp.evaluate(
      `fetch('/api/prompts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'AC59 夹具', user_prompt: '你好 {{姓名}}。' }) }).then((r) => r.status)`,
    );
    await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
    await sleep(600);
    out.ac59_empty_art_absent_with_data = String(
      (await cdp.evaluate(`!document.querySelector('[data-testid="pm-brand-art-empty"]')`)) === true,
    );

    // ---------- ④ 顶栏 mark：26×26 矢量 + 真鼠标点 logo 回主页 ----------
    out.ac59_brand_mark = await artInfo('pm-brand-mark');
    const mark = JSON.parse(out.ac59_brand_mark);
    out.ac59_mark_ok = String(mark.src === '/promptmanager-icon.svg' && mark.w === 26 && mark.h === 26);
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const t = items.find((n) => n.innerText.includes('表格')); if (t) t.click(); return true; })()`,
    );
    await sleep(800);
    out.ac59_before_home = await cdp.evaluate(
      `JSON.stringify({ table: !!document.querySelector('[data-testid="pm-view-table"]'), stored: window.localStorage.getItem('pm-view-mode') })`,
    );
    await cdp.realClick('[aria-label="回到首页"]', 900);
    out.ac59_after_home = await cdp.evaluate(
      `JSON.stringify({ split: !!document.querySelector('[data-testid="pm-view-split"]'), stored: window.localStorage.getItem('pm-view-mode') })`,
    );
    const afterHome = JSON.parse(out.ac59_after_home);
    out.ac59_logo_home_ok = String(afterHome.split === true && afterHome.stored === 'split');

    // ---------- ⑤ 关于页：48 装饰位，真鼠标点击无动作 ----------
    await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="header-more"]'); if (el) el.click(); return true; })()`,
    );
    await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('.ant-dropdown-menu-item')]; const t = items.find((n) => n.innerText.includes('关于')); if (t) t.click(); return true; })()`,
    );
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-about"]')`, '关于面板');
    await sleep(500);
    out.ac59_about_art = await artInfo('pm-brand-art-about');
    const aboutArt = JSON.parse(out.ac59_about_art);
    out.ac59_about_art_ok = String(aboutArt.src === '/promptmanager-48.png' && aboutArt.w === 48 && aboutArt.h === 48 && aboutArt.hidden === 'true');
    const beforeAboutClick = await cdp.evaluate(`document.querySelector('[data-testid="pm-about"]') !== null`);
    await cdp.realClick('[data-testid="pm-brand-art-about"]');
    const afterAboutClick = await cdp.evaluate(`document.querySelector('[data-testid="pm-about"]') !== null`);
    out.ac59_about_art_no_action = String(beforeAboutClick === true && afterAboutClick === true);

    // ---------- ⑥ 页面引用图单张 ≤250KB（运行时实际加载的资源）----------
    out.ac59_asset_sizes = await cdp.evaluate(
      `Promise.all(['/favicon.svg','/favicon.ico','/apple-touch-icon.png','/icon-192.png','/icon-512.png','/promptmanager-96.png','/promptmanager-72.png','/promptmanager-48.png','/promptmanager-icon.svg'].map((u) => fetch(u).then((r) => r.arrayBuffer()).then((b) => [u, b.byteLength])))
        .then((rows) => JSON.stringify(rows))`,
    );
    const sizes = JSON.parse(out.ac59_asset_sizes);
    out.ac59_asset_max = String(Math.max(...sizes.map((row) => row[1])));
    out.ac59_asset_all_ok = String(sizes.every((row) => row[1] > 0 && row[1] <= 250 * 1024));
    out.ac59_origin = origin;
  } finally {
    for (const [key, value] of Object.entries(out)) {
      console.log(`${key}=${String(value)}`);
    }
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
