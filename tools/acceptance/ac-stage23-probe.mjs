#!/usr/bin/env node
/**
 * 阶段 23 运行时探针（真鼠标：Input.dispatchMouseEvent 的 moved/pressed/released）：
 *
 *   folder <baseUrl> <sid> <A> <B> <C> <shotsDir>
 *     AC-72 ⑤：侧栏文件夹 A 的计数徽标文本 vs 点击 A 后中栏条目数（逐字对账）；
 *     AC-72 ⑨：在 A 的视图里把 B 的条目拖到 C 的条目位置 → 顺序不变 + 未发出 PATCH（网络计数 0）。
 *
 *   table <baseUrl> <sid> <shotsDir>
 *     AC-74 ①：行内拖拽手柄存在（热区 ≥24×24）+ 表头/列宽/行高（改前对照由 harness 传入）；
 *     AC-74 ②：真鼠标把第 1 行拖到第 3 行 → DOM 顺序变化 + 排序档「自定义」+ 刷新后保持；
 *     AC-74 ③：拖后 500ms 内表格容器不出现 loading 骨架/空白（逐帧采样）+ 未动行像素差 ≤1px；
 *     AC-74 ④：一次拖拽只发 1 次 PATCH /api/prompts/order。
 *
 *   card <baseUrl> <sid> <shotsDir>
 *     AC-73：同一网格行内 无标签/1 标签/3 标签 三张卡片的等高、末行贴底距离、标签区高度、列数、无横向溢出。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!['folder', 'table', 'card'].includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage23-probe.mjs <folder|table|card> <baseUrl> <sid> [...]');
  process.exit(2);
}
const shotsDir = mode === 'folder' ? (rest[3] ?? 'tmp/shots/stage23') : (rest[0] ?? 'tmp/shots/stage23');
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
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
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
    await sleep(500);
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

// antd 会额外渲染一个隐藏的 measure row（高度 0、无 data-row-key）→ 一律排除
const tableRows = `[...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row'))`;
const tableIds = `JSON.stringify(${tableRows}.map((tr) => Number(tr.getAttribute('data-row-key'))))`;
const tableRowBoxes = `JSON.stringify(Object.fromEntries(${tableRows}.map((tr) => { const r = tr.getBoundingClientRect(); return [tr.getAttribute('data-row-key'), { top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width) }]; })))`;
const tableMetrics = `JSON.stringify((() => {
  const table = document.querySelector('[data-testid="pm-view-table"] table');
  const heads = [...document.querySelectorAll('[data-testid="pm-view-table"] thead th')].map((th) => ({ text: th.innerText.trim(), width: Math.round(th.getBoundingClientRect().width) }));
  const rows = [...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row'));
  const cols = [...document.querySelectorAll('[data-testid="pm-view-table"] colgroup col')].map((col) => Math.round(col.getBoundingClientRect().width));
  return { tableWidth: table === null ? null : Math.round(table.getBoundingClientRect().width), heads, cols, rowCount: rows.length,
    rowHeight: rows.length === 0 ? null : Math.round(rows[0].getBoundingClientRect().height),
    headerHeight: (() => { const th = document.querySelector('[data-testid="pm-view-table"] thead th'); return th === null ? null : Math.round(th.getBoundingClientRect().height); })() };
})())`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac23-'));
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
    const setPrefs = (prefs) =>
      cdp.evaluate(
        Object.entries(prefs)
          .map(([key, value]) => `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
          .join('') + 'true',
      );
    const navigate = async (ready) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(900);
    };
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await sleep(900);
    await setPrefs({ 'pm-theme': 'light', 'pm-pin-favorites': '0', 'pm-use-sort': 'updated' });

    if (mode === 'folder') {
      const [aId, bId, cId] = rest.slice(0, 3).map(Number);
      await navigate(`!!document.querySelector('[data-testid="pm-folder-row-${String(aId)}"]')`);
      out.ac72_badge = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-folder-row-${String(aId)}"] .pm-folder-count')?.innerText ?? '')`,
      );
      await cdp.realClick(`[data-testid="pm-folder-row-${String(aId)}"]`, 1200);
      out.ac72_list_count = await cdp.evaluate(
        `String(document.querySelectorAll('[data-testid="pm-split-item"]').length)`,
      );
      out.ac72_list_total = await cdp.evaluate(`String(document.querySelector('.pm-list-total')?.innerText ?? '')`);
      out.ac72_selected = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-folder-row-${String(aId)}"]')?.getAttribute('class') ?? '')`,
      );
      await cdp.shot('01-folder-inclusive-light');

      // AC-72 ⑨（**v31 / D-30 修订**）：把 B 的条目拖到 C 的条目位置（跨 folder_id）—— 旧 D-29 要求"忽略"，
      // 现已作废：inclusive 视图下拖拽**总是生效**（这正是用户报的"卡片拖动根本不生效"的根因）
      await navigate(`!!document.querySelector('[data-testid="pm-folder-row-${String(aId)}"]')`);
      await cdp.realClick(`[data-testid="pm-folder-row-${String(aId)}"]`, 1200);
      const orderBefore = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-split-item"]')].map((el) => el.innerText.split('\\n')[0]))`,
      );
      out.ac72_order_before = orderBefore;
      out.ac72_order_requests_before = String(cdp.orderRequests);
      const source = await cdp.center(`[data-testid="pm-drag-split-${String(bId)}"]`);
      const target = await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="pm-split-item"]:has([data-testid="pm-drag-split-${String(cId)}"])') ?? [...document.querySelectorAll('[data-testid="pm-split-item"]')].find((n) => n.querySelector('[data-testid="pm-drag-split-${String(cId)}"]') !== null); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse(source, JSON.parse(target));
      await sleep(600);
      out.ac72_order_after = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-split-item"]')].map((el) => el.innerText.split('\\n')[0]))`,
      );
      out.ac72_order_requests_after = String(cdp.orderRequests);
      await cdp.shot('02-folder-cross-folder-drag-applied-light');
      out.ac23_runtime_errors = JSON.stringify(cdp.errors);
    } else if (mode === 'table') {
      await setPrefs({ 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await cdp.waitFor(`[...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row')).length >= 3`, '表格行');
      await sleep(600);
      out.ac74_metrics_before = await cdp.evaluate(tableMetrics);
      await cdp.hover('[data-testid="pm-view-table"] tbody tr');
      out.ac74_handle = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid^="pm-drag-row-"]'); if (el === null) return null; const r = el.getBoundingClientRect(); return { testid: el.getAttribute('data-testid'), w: Math.round(r.width), h: Math.round(r.height), cursor: getComputedStyle(el).cursor, visible: el.offsetParent !== null }; })())`,
      );
      out.ac74_order_before = await cdp.evaluate(tableIds);
      out.ac74_boxes_before = await cdp.evaluate(tableRowBoxes);
      await cdp.shot('03-table-before-drag-light');

      const ids = JSON.parse(out.ac74_order_before);
      const source = await cdp.center(`[data-testid="pm-drag-row-${String(ids[0])}"]`);
      const target = await cdp.evaluate(
        `(() => { const tr = document.querySelector('[data-testid="pm-view-table"] tbody tr[data-row-key="${String(ids[2])}"]'); const r = tr.getBoundingClientRect(); return JSON.stringify({ x: r.left + 60, y: r.top + r.height / 2 }); })()`,
      );
      out.ac74_requests_before = String(cdp.orderRequests);
      await cdp.dragMouse(source, JSON.parse(target));
      out.ac74_order_after = await cdp.evaluate(tableIds);
      out.ac74_requests_after = String(cdp.orderRequests);
      // AC-74 ③：拖后 500ms 内逐帧采样（不得出现 loading 骨架 / 空白）
      const samples = [];
      for (let i = 0; i < 10; i += 1) {
        samples.push(
          await cdp.evaluate(
            `JSON.stringify({ t: ${String(i * 50)}, rows: [...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row')).length, skeleton: [...document.querySelectorAll('.ant-skeleton, .ant-spin-spinning, [data-testid="pm-loading"]')].filter((el) => el.offsetParent !== null).length, skeletonInfo: [...document.querySelectorAll('.ant-skeleton, .ant-spin-spinning, [data-testid="pm-loading"]')].map((el) => el.tagName + '.' + String(el.className).slice(0, 40)).slice(0, 3), loadingText: /正在读取/.test(document.querySelector('[data-testid="pm-view-table"]')?.innerText ?? '') })`,
          ),
        );
        await sleep(50);
      }
      out.ac74_samples = JSON.stringify(samples);
      out.ac74_boxes_after = await cdp.evaluate(tableRowBoxes);
      out.ac74_sort_label = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-use-sort"]')?.innerText ?? '')`,
      );
      await cdp.shot('04-table-after-drag-light');

      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await sleep(900);
      out.ac74_order_after_reload = await cdp.evaluate(tableIds);
      out.ac74_sort_label_after_reload = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-use-sort"]')?.innerText ?? '')`,
      );
      // AC-74 ⑥：卡片档与分栏档拖拽仍正常
      await setPrefs({ 'pm-view-mode': 'card' });
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      await sleep(600);
      const cardIds = JSON.parse(await cdp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-card-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`));
      const cardSource = await cdp.center(`[data-testid="pm-drag-card-${String(cardIds[0])}"]`);
      const cardTarget = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-use-card"]')][2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse(cardSource, JSON.parse(cardTarget));
      out.ac74_card_order_after = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-card-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`,
      );
      out.ac74_card_order_before = JSON.stringify(cardIds);
      await setPrefs({ 'pm-view-mode': 'split' });
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await sleep(700);
      const splitIds = JSON.parse(await cdp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-split-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`));
      const splitSource = await cdp.center(`[data-testid="pm-drag-split-${String(splitIds[0])}"]`);
      const splitTarget = await cdp.evaluate(
        `(() => { const el = [...document.querySelectorAll('[data-testid="pm-split-item"]')][2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse(splitSource, JSON.parse(splitTarget));
      out.ac74_split_order_before = JSON.stringify(splitIds);
      out.ac74_split_order_after = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-split-"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`,
      );
      out.ac23_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      await setPrefs({ 'pm-view-mode': 'card' });
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      await cdp.waitFor(`document.querySelectorAll('[data-testid="pm-use-card"]').length >= 3`, '卡片');
      await sleep(700);
      const measure = `JSON.stringify((() => {
        const cards = [...document.querySelectorAll('[data-testid="pm-use-card"]')];
        const rows = cards.map((card) => {
          const flex = card.querySelector('.ant-card-body').firstElementChild;
          const footer = card.querySelector('[data-testid^="pm-card-footer-"]');
          const cb = card.getBoundingClientRect(); const fb = footer.getBoundingClientRect();
          const tagRow = [...flex.children].find((el) => el.querySelector('.ant-tag') !== null);
          // 只数"空的 Flex 占位"（Paragraph 之类的非 Flex 元素不算）
          const emptyFlex = [...flex.children].filter((el) => el.classList.contains('ant-flex') && el.children.length === 0);
          return { title: card.innerText.split('\\n')[0], cardH: Math.round(cb.height), cardBottom: Math.round(cb.bottom),
            footerBottom: Math.round(fb.bottom), gap: Math.round(cb.bottom - fb.bottom),
            tagsH: tagRow ? Math.round(tagRow.getBoundingClientRect().height) : 0, emptyFlex: emptyFlex.length };
        });
        const grid = document.querySelector('.pm-use-grid');
        return { cards: rows, cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null,
          scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
      })())`;
      out.ac73_light = await cdp.evaluate(measure);
      await cdp.shot('05-card-footer-light');
      await setPrefs({ 'pm-theme': 'dark' });
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      await sleep(700);
      out.ac73_dark = await cdp.evaluate(measure);
      await cdp.shot('06-card-footer-dark');
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
