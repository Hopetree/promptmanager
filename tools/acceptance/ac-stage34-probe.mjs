#!/usr/bin/env node
/**
 * 阶段 34 运行时探针（真浏览器 + CDP `Emulation.setDeviceMetricsOverride`；真鼠标点击；
 * 所有宽度用 `getBoundingClientRect()`，不看截图猜）：
 *
 *   mobile <baseUrl> <sid> <shotsDir>
 *     AC-92 ① 390×844：`.pm-split-list` 宽度 == 358、right == 374（改前是 276 / 292）
 *     AC-92 ② 与卡片/表格视图对照（三者都应 358 / right 374）
 *     AC-92 ③ `document.documentElement.scrollWidth == 390`（无横向溢出）
 *     AC-92 ④ 1600×900 桌面不回归：中栏宽度、中栏/366 基线比值、右栏仍在
 *     AC-92 ⑤ 移动端行为：`.pm-split-detail` 不存在、点条目开详情抽屉、拖拽手柄与收藏星标在
 *     AC-92 ⑤ 截图：390 亮 / 390 暗
 *     AC-94 ① 移动端档位顺序 = 卡片/表格/分栏；② 桌面 = 分栏/表格/卡片
 *     AC-94 ③ 默认档位按断点（清 localStorage 后：移动 card / 桌面 split）
 *     AC-94 ④ 不覆盖已有偏好（预置 table → 两端都 table）
 *     AC-94 ⑤ 移动端三档都可切（真鼠标）+ 无 JS 异常 + scrollWidth 390
 *
 * 只 dump 事实、不做断言（断言在 tools/ac-stage34.sh）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['mobile'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage34-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage34';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));

const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const DESKTOP = { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false };

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

/** 视图容器（分栏中栏 / 卡片 / 表格）与文档溢出的统一量法 */
const RECTS = `JSON.stringify((() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (el === null) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(r.right) }; };
  const detail = document.querySelector('[data-testid="pm-detail"]');
  const detailRect = detail === null ? null : detail.getBoundingClientRect();
  return {
    splitCard: rect('.pm-split-list'),
    splitInner: rect('[data-testid="pm-split-list"]'),
    splitContainer: rect('[data-testid="pm-view-split"]'),
    card: rect('[data-testid="pm-view-card"]'),
    table: rect('[data-testid="pm-view-table"]'),
    detailPresent: detail !== null,
    detailWidth: detailRect === null ? null : Math.round(detailRect.width),
    detailVisible: detailRect === null ? false : detailRect.width > 0 && detailRect.height > 0,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    viewport: window.innerWidth,
  };
})())`;

/** 当前落在哪一档 + 档位开关里的文本顺序 + localStorage 值 */
const VIEWSTATE = `JSON.stringify((() => {
  const seg = document.querySelector('[data-testid="pm-use-viewmode"]');
  const items = seg === null ? [] : [...seg.querySelectorAll('.ant-segmented-item')].map((el) => el.innerText.trim());
  const checked = seg === null ? null : (seg.querySelector('.ant-segmented-item-selected')?.innerText.trim() ?? null);
  const present = ['split', 'table', 'card'].filter((v) => document.querySelector('[data-testid="pm-view-' + v + '"]') !== null);
  let stored = null; try { stored = window.localStorage.getItem('pm-view-mode'); } catch { /* ignore */ }
  return { items, checked, present, stored, segCount: items.length, hasList: document.querySelector('[data-testid="pm-view-list"]') !== null };
})())`;

const SPLIT_ITEM = `document.querySelector('[data-testid="pm-split-item"]')`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac34-'));
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
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });

    const prefs = (values) =>
      cdp.evaluate(Object.entries(values).map(([k, v]) => (v === null ? `window.localStorage.removeItem(${JSON.stringify(k)});` : `window.localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)).join('') + 'true');
    /** 先把视口定好再导航 —— 默认档位在 mount 时按 innerWidth 决定 */
    const open = async (metrics, ready) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', metrics);
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(900);
    };
    const waitSplit = `document.querySelector('[data-testid="pm-split-list"]') !== null`;
    const waitAnyView = `['split','table','card'].some((v) => document.querySelector('[data-testid="pm-view-' + v + '"]') !== null)`;

    // ============ 移动端 390×844 ============
    await cdp.send('Emulation.setDeviceMetricsOverride', MOBILE);
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await sleep(900);
    await prefs({ 'pm-theme': 'light', 'pm-view-mode': 'split', 'pm-pin-favorites': '0' });
    await open(MOBILE, waitSplit);

    out.ac92_mobile_rects = await cdp.evaluate(RECTS);
    out.ac94_mobile_order = await cdp.evaluate(VIEWSTATE);
    out.ac92_mobile_behaviour = await cdp.evaluate(
      `JSON.stringify({
         detailInDom: document.querySelector('[data-testid="pm-split-detail"]') !== null,
         items: document.querySelectorAll('[data-testid="pm-split-item"]').length,
         dragHandle: document.querySelector('[data-testid^="pm-drag-card"], [data-testid^="pm-drag-split"], .pm-drag-handle') !== null,
         favStar: document.querySelector('[data-testid^="pm-fav-split"], [data-testid^="pm-fav-card"], [data-testid^="pm-fav-"]') !== null,
       })`,
    );
    await cdp.shot('01-split-mobile-light');

    // 点条目 → 详情抽屉（移动端单栏降级）
    await cdp.realClickOf(SPLIT_ITEM, 1200);
    out.ac92_mobile_drawer = await cdp.evaluate(
      `JSON.stringify({
         drawerOpen: document.querySelector('.ant-drawer-open') !== null,
         drawerTitle: document.querySelector('.ant-drawer-open .ant-drawer-title')?.innerText.trim() ?? null,
         drawerText: document.querySelector('.ant-drawer-open')?.innerText.replace(/\\n/g, ' | ') ?? null,
         detailInDom: document.querySelector('[data-testid="pm-detail"]') !== null,
         itemTitle: document.querySelector('[data-testid="pm-split-item"]')?.innerText.split('\\n')[0] ?? null,
       })`,
    );
    // 关掉抽屉（Esc），避免影响后续测量
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(700);

    // ============ AC-94 ③ 默认档位（移动端）：清 localStorage 后重载 ============
    await prefs({ 'pm-view-mode': null });
    await open(MOBILE, waitAnyView);
    out.ac94_mobile_default = await cdp.evaluate(VIEWSTATE);

    // ============ AC-94 ⑤ 移动端三档都可切（真鼠标）============
    const clickMode = async (label) => {
      const expr = `[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find((el) => el.innerText.trim() === ${JSON.stringify(label)})`;
      await cdp.realClickOf(expr, 800);
    };
    await clickMode('表格');
    out.ac94_mobile_after_table = await cdp.evaluate(VIEWSTATE);
    out.ac92_mobile_table_rects = await cdp.evaluate(RECTS);
    await clickMode('卡片');
    out.ac94_mobile_after_card = await cdp.evaluate(VIEWSTATE);
    out.ac92_mobile_card_rects = await cdp.evaluate(RECTS);
    await clickMode('分栏');
    out.ac94_mobile_after_split = await cdp.evaluate(VIEWSTATE);
    out.ac92_mobile_split_after_switch = await cdp.evaluate(RECTS);

    // ============ AC-94 ④ 不覆盖已有偏好（移动端预置 table）============
    await prefs({ 'pm-view-mode': 'table' });
    await open(MOBILE, waitAnyView);
    out.ac94_mobile_pref_table = await cdp.evaluate(VIEWSTATE);

    // ============ AC-92 ⑤ 暗色截图（390）============
    await prefs({ 'pm-theme': 'dark', 'pm-view-mode': 'split' });
    await open(MOBILE, waitSplit);
    out.ac92_mobile_dark_rects = await cdp.evaluate(RECTS);
    await cdp.shot('02-split-mobile-dark');

    // ============ 桌面 1600×900 ============
    await prefs({ 'pm-theme': 'light' });
    await prefs({ 'pm-view-mode': null });
    await open(DESKTOP, waitSplit);
    out.ac94_desktop_order = await cdp.evaluate(VIEWSTATE);
    out.ac92_desktop_rects = await cdp.evaluate(RECTS);
    out.ac94_desktop_default = await cdp.evaluate(VIEWSTATE);
    await cdp.shot('03-split-desktop-light');

    await prefs({ 'pm-view-mode': 'table' });
    await open(DESKTOP, waitAnyView);
    out.ac94_desktop_pref_table = await cdp.evaluate(VIEWSTATE);

    out.ac34_runtime_errors = JSON.stringify(cdp.errors);
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
