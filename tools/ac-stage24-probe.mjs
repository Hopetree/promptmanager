#!/usr/bin/env node
/**
 * 阶段 24 / FR-75 运行时探针（真鼠标：Input.dispatchMouseEvent 的 moved/pressed/released）：
 *
 *   card <baseUrl> <sid> <shotsDir>
 *     AC-75 ② hover 第 1 张卡片 → 手柄存在（≥24×24）
 *     AC-75 ③ 真鼠标**从手柄**把第 1 张拖到第 3 张位置 → DOM 顺序变化 + 恰好 1 次 PATCH + 刷新后保持
 *     AC-75 ⑤ 跨目录（默认「全部」视图）拖拽也生效 —— 不存在"顺序不变 + 无请求 + 无提示"的情形
 *     AC-75 ⑥ 拖**卡片本体** → 顺序变化；单击仍选中、双击仍打开详情
 *     AC-75 ⑦ 未动项像素差 ≤1px / 行高不变 / scrollWidth ≤ clientWidth+2
 *
 *   folder <baseUrl> <sid> <folderId> <shotsDir>
 *     AC-75 ④ 具体目录视图内拖拽 2 条 → 只在这 2 条原先占据的槽位间交换（全量 sort_order 对照由 harness 读库）
 *
 *   other <baseUrl> <sid> <shotsDir>
 *     AC-75 ⑨ 分栏档与表格档拖拽仍正常
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!['card', 'folder', 'other'].includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage24-probe.mjs <card|folder|other> <baseUrl> <sid> [...]');
  process.exit(2);
}
const shotsDir = mode === 'folder' ? (rest[1] ?? 'docs/shots/stage24') : (rest[0] ?? 'docs/shots/stage24');
const folderId = mode === 'folder' ? Number(rest[0]) : null;
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
    this.orderRequests = 0;
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.text ?? 'exception');
      if (message.method === 'Network.requestWillBeSent') {
        const url = String(message.params?.request?.url ?? '');
        if (url.includes('/api/prompts/order')) this.orderRequests += 1;
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
  async center(selector) {
    const value = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${selector}`);
    return JSON.parse(value);
  }
  async hover(selector) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(300);
  }
  async realClick(selector, settle = 500) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(150);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  async doubleClick(selector, settle = 900) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    for (const clickCount of [1, 2]) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount });
      await sleep(40);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount });
      await sleep(60);
    }
    await sleep(settle);
  }
  async dragMouse(from, to, steps = 12) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
    await sleep(150);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(150);
    for (let i = 1; i <= steps; i += 1) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(45);
    }
    await sleep(180);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(600);
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

const cardIds = `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-card-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`;
const cardBoxes = `JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-testid="pm-use-card"]')].map((el) => { const handle = el.querySelector('[data-testid^="pm-drag-card-"]'); const key = handle === null ? el.innerText.slice(0, 8) : handle.getAttribute('data-testid'); const r = el.getBoundingClientRect(); return [key, { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }]; })))`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac24-'));
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });
    const prefs = (values) =>
      cdp.evaluate(Object.entries(values).map(([k, v]) => `window.localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('') + 'true');
    const navigate = async (ready) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(900);
    };
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await sleep(900);
    await prefs({ 'pm-theme': 'light', 'pm-pin-favorites': '0', 'pm-use-sort': 'custom', 'pm-view-mode': 'card' });

    if (mode === 'card') {
      // ---------- AC-75 ②③⑤⑥⑦：默认「全部」视图（不带 folder_id） ----------
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      await cdp.waitFor(`document.querySelectorAll('[data-testid="pm-use-card"]').length >= 4`, '卡片列表');
      await sleep(700);
      await cdp.hover('[data-testid="pm-use-card"]');
      out.ac75_handle = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid^="pm-drag-card-"]'); if (el === null) return null; const r = el.getBoundingClientRect(); return { testid: el.getAttribute('data-testid'), w: Math.round(r.width), h: Math.round(r.height), cursor: getComputedStyle(el).cursor, title: el.getAttribute('title'), visible: el.offsetParent !== null }; })())`,
      );
      out.ac75_order_before = await cdp.evaluate(cardIds);
      out.ac75_boxes_before = await cdp.evaluate(cardBoxes);
      out.ac75_heights_before = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-use-card"]')].map((el) => Math.round(el.getBoundingClientRect().height)))`,
      );
      await cdp.shot('01-all-view-before-drag-light');

      const ids = JSON.parse(out.ac75_order_before);
      out.ac75_requests_before = String(cdp.orderRequests);
      const handle = await cdp.center(`[data-testid="pm-drag-card-${String(ids[0])}"]`);
      const target = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-use-card"]')][2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse(handle, JSON.parse(target));
      out.ac75_order_after = await cdp.evaluate(cardIds);
      out.ac75_requests_after = String(cdp.orderRequests);
      out.ac75_messages = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('.ant-message-notice-content')].map((el) => el.innerText.trim()))`,
      );
      out.ac75_boxes_after = await cdp.evaluate(cardBoxes);
      out.ac75_scroll = await cdp.evaluate(
        `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })`,
      );
      await cdp.shot('02-all-view-after-drag-light');
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      await sleep(900);
      out.ac75_order_after_reload = await cdp.evaluate(cardIds);

      // ---------- AC-75 ⑥：卡片本体可拖 + 单击选中 + 双击开详情 ----------
      const bodyIds = JSON.parse(await cdp.evaluate(cardIds));
      out.ac75_body_before = JSON.stringify(bodyIds);
      // 本体：卡片**左下角空白区**（避开手柄/星标/按钮/文本）
      const bodyFrom = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-use-card"]')][0]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + 12, y: r.bottom - 26 }); })()`,
      );
      const bodyTarget = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-use-card"]')][2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      const requestsBeforeBody = cdp.orderRequests;
      await cdp.dragMouse(JSON.parse(bodyFrom), JSON.parse(bodyTarget));
      out.ac75_body_after = await cdp.evaluate(cardIds);
      out.ac75_body_requests = String(cdp.orderRequests - requestsBeforeBody);
      await cdp.shot('03-body-drag-light');

      // 单击：选中（activeIndex → 卡片边框）+ 双击：打开详情
      const clickIds = JSON.parse(await cdp.evaluate(cardIds));
      await cdp.realClick(`[data-testid="pm-use-card"]`, 500);
      out.ac75_single_click = await cdp.evaluate(
        `JSON.stringify({ selectedBorder: getComputedStyle(document.querySelector('[data-testid="pm-use-card"]')).borderColor })`,
      );
      await cdp.doubleClick(`[data-testid="pm-use-card"]`, 1200);
      out.ac75_double_click = await cdp.evaluate(
        `JSON.stringify({ detailOpen: document.querySelector('[data-testid="pm-detail"]') !== null, title: String(document.querySelector('[data-testid="pm-detail-title"]')?.innerText ?? '') })`,
      );
      await cdp.shot('04-double-click-detail-light');
      out.ac75_click_ids_unchanged = String(JSON.stringify(clickIds) === out.ac75_body_after);
      out.ac23_runtime_errors = JSON.stringify(cdp.errors);
    } else if (mode === 'folder') {
      // ---------- AC-75 ④：具体目录视图内拖拽（槽位保持） ----------
      await navigate(`!!document.querySelector('[data-testid="pm-folder-row-${String(folderId)}"]')`);
      // 「全部」视图的第一张（拖前）——用于断言目录内拖拽没有把这组条目顶到全局最前
      out.ac75_all_first_before = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-use-card"]')?.innerText.split('\\n')[0] ?? '')`,
      );
      await cdp.realClick(`[data-testid="pm-folder-row-${String(folderId)}"]`, 1200);
      await cdp.waitFor(`document.querySelectorAll('[data-testid="pm-use-card"]').length >= 2`, '目录内卡片');
      await sleep(700);
      out.ac75_folder_order_before = await cdp.evaluate(cardIds);
      const folderIds = JSON.parse(out.ac75_folder_order_before);
      out.ac75_folder_requests_before = String(cdp.orderRequests);
      const handle = await cdp.center(`[data-testid="pm-drag-card-${String(folderIds[0])}"]`);
      const target = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-use-card"]')][1]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.bottom - 10 }); })()`,
      );
      await cdp.dragMouse(handle, JSON.parse(target));
      out.ac75_folder_order_after = await cdp.evaluate(cardIds);
      out.ac75_folder_requests_after = String(cdp.orderRequests);
      await cdp.shot('05-folder-view-slot-swap-light');
      // 回「全部」视图：这 2 条不得跑到最前
      await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
      await cdp.evaluate(`(() => { const items = [...document.querySelectorAll('[data-testid^="pm-folder-row-"]')]; return true; })()`);
      await sleep(300);
      await cdp.evaluate(
        `(() => { const rows = [...document.querySelectorAll('[data-testid^="pm-folder-row-"]')]; const target = rows.find((n) => n.getAttribute('class')?.includes('pm-folder-row-active')); if (target) target.click(); return true; })()`,
      );
      await sleep(1400);
      out.ac75_all_order_after = await cdp.evaluate(cardIds);
      out.ac75_first_card_title = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-use-card"]')?.innerText.split('\\n')[0] ?? '')`,
      );
      await cdp.shot('06-back-to-all-view-light');
      out.ac23_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ---------- AC-75 ⑨：分栏档与表格档拖拽仍正常 ----------
      await prefs({ 'pm-view-mode': 'split' });
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await sleep(700);
      const splitIds = JSON.parse(await cdp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-split-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`));
      out.ac75_split_before = JSON.stringify(splitIds);
      const splitFrom = await cdp.center(`[data-testid="pm-drag-split-${String(splitIds[0])}"]`);
      const splitTo = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-split-item"]')][2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse(splitFrom, JSON.parse(splitTo));
      out.ac75_split_after = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-split-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`,
      );
      await cdp.shot('07-split-drag-light');

      await prefs({ 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await sleep(900);
      const rowsOf = `[...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row'))`;
      const tableIds = JSON.parse(await cdp.evaluate(`JSON.stringify(${rowsOf}.map((tr) => Number(tr.getAttribute('data-row-key'))))`));
      out.ac75_table_before = JSON.stringify(tableIds);
      const tableFrom = await cdp.center(`[data-testid="pm-drag-row-${String(tableIds[0])}"]`);
      const tableTo = await cdp.evaluate(
        `(() => { const tr = document.querySelector('[data-testid="pm-view-table"] tbody tr[data-row-key="${String(tableIds[2])}"]'); const r = tr.getBoundingClientRect(); return JSON.stringify({ x: r.left + 60, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse(tableFrom, JSON.parse(tableTo));
      out.ac75_table_after = await cdp.evaluate(`JSON.stringify(${rowsOf}.map((tr) => Number(tr.getAttribute('data-row-key'))))`);
      await cdp.shot('08-table-drag-light');
      out.ac23_runtime_errors = JSON.stringify(cdp.errors);
    }
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
