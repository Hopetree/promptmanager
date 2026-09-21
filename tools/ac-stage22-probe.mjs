#!/usr/bin/env node
/**
 * 阶段 22 运行时探针：
 *
 *   split <baseUrl> <sid> <shotsDir>
 *     AC-71：中栏条目文本（只含标题+备注、不含元信息/正文片段）、备注区两行高度、空备注条目等高、
 *            中栏/右栏真实像素（改前 366px 基线由 tools/ac-stage22.sh 传入做比值）、单击切换右栏、无横向滚动、
 *            卡片/表格视图特征对照。
 *
 *   drag <baseUrl> <sid> <shotsDir>
 *     AC-70：卡片视图真鼠标拖拽（mousePressed → 多次 mouseMoved → mouseReleased）→ DOM 顺序变化、
 *            未被拖动条目 left/width/top/height 差 ≤1px、行高不变、无横向溢出；
 *            刷新后顺序保持且排序下拉显示「自定义」；文件夹树同层级拖拽 + 刷新保持。
 *
 * 用法：node tools/ac-stage22-probe.mjs <split|drag> <baseUrl> <sid> [shotsDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, shotsDir = 'tmp/shots/stage22'] = process.argv.slice(2);
if ((mode !== 'split' && mode !== 'drag') || baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage22-probe.mjs <split|drag> <baseUrl> <sid> [shotsDir]');
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
    this.promptOrderRequests = 0;
    this.folderOrderRequests = 0;
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
        if (url.includes('/api/prompts/order')) this.promptOrderRequests += 1;
        if (url.includes('/api/folders/order')) this.folderOrderRequests += 1;
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
  async realClick(selector, settle = 450) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  /** 真鼠标拖拽：按住手柄 → 多次 mouseMoved（>5px 激活 PointerSensor）→ 松开 */
  async dragMouse(from, to, steps = 12) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(120);
    for (let i = 1; i <= steps; i += 1) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(45);
    }
    await sleep(200);
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

const idsOf = (prefix) =>
  `JSON.stringify([...document.querySelectorAll('[data-testid^="${prefix}"]')].map((el) => Number(el.getAttribute('data-testid').split('-').pop())))`;
// 卡片的 data-testid 全都叫 pm-use-card → 用**每张卡里的手柄 id** 当 key（唯一）
const boxesOf = () =>
  `JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-testid="pm-use-card"]')].map((el) => { const handle = el.querySelector('[data-testid^="pm-drag-card-"]'); const key = handle === null ? el.innerText.slice(0, 8) : handle.getAttribute('data-testid'); const r = el.getBoundingClientRect(); return [key, { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }]; })))`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac22-'));
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
    const navigate = async (ready) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(800);
    };
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await sleep(800);
    await cdp.evaluate(`window.localStorage.setItem('pm-view-mode', 'split'); window.localStorage.setItem('pm-theme', 'light');`);

    if (mode === 'split') {
      // ---------- AC-71 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await sleep(900);
      out.ac71_widths = await cdp.evaluate(
        `JSON.stringify((() => { const list = document.querySelector('[data-testid="pm-split-list"]'); const detail = document.querySelector('[data-testid="pm-detail"]'); return { list: Math.round(list.getBoundingClientRect().width), detail: detail ? Math.round(detail.getBoundingClientRect().width) : null, viewport: window.innerWidth }; })())`,
      );
      out.ac71_item_texts = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-split-item"]')].map((el) => el.innerText))`,
      );
      out.ac71_meta_hits = await cdp.evaluate(
        `(() => { const text = [...document.querySelectorAll('[data-testid="pm-split-item"]')].map((el) => el.innerText).join('\\n'); const p = document.querySelector('[data-testid="pm-split-item"]'); const title = p.querySelector('.ant-typography').innerText; return JSON.stringify({ vVersion: (text.match(/v\\d+/g) ?? []).length, quYong: (text.match(/取用/g) ?? []).length, gengXin: (text.match(/更新于/g) ?? []).length, folderName: (text.match(/未归类|工作|运维/g) ?? []).length, vars: (text.match(/变量/g) ?? []).length, bodyLeak: text.includes('正文') && !text.includes('备注') }); })()`,
      );
      out.ac71_notes_box = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-split-item"] .pm-split-notes'); const cs = getComputedStyle(el); return { height: Math.round(el.getBoundingClientRect().height), lineHeight: cs.lineHeight, clamp: cs.webkitLineClamp, minHeight: cs.minHeight, fontSize: cs.fontSize }; })())`,
      );
      out.ac71_equal_heights = await cdp.evaluate(
        `JSON.stringify((() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')]; const withNotes = items.find((el) => (el.querySelector('.pm-split-notes')?.innerText ?? '').trim() !== ''); const withoutNotes = items.find((el) => (el.querySelector('.pm-split-notes')?.innerText ?? '').trim() === ''); return { withNotes: withNotes ? Math.round(withNotes.getBoundingClientRect().height) : null, withoutNotes: withoutNotes ? Math.round(withoutNotes.getBoundingClientRect().height) : null, withNotesText: withNotes ? withNotes.innerText.split('\\n')[0] : null, withoutNotesText: withoutNotes ? withoutNotes.innerText.split('\\n')[0] : null }; })())`,
      );
      out.ac71_scroll = await cdp.evaluate(
        `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })`,
      );
      await cdp.shot('01-split-item-light');

      // 单击第 2 条 → 右栏标题随之变化
      const secondTitle = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-split-item"]')][1].innerText.split('\\n')[0])`,
      );
      await cdp.realClick('[data-testid="pm-split-item"]:nth-of-type(2)', 700).catch(async () => {
        await cdp.evaluate(`(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')]; items[1].click(); return true; })()`);
        await sleep(700);
      });
      out.ac71_click_switch = await cdp.evaluate(
        `JSON.stringify({ clicked: ${JSON.stringify(secondTitle)}, detailTitle: String(document.querySelector('[data-testid="pm-detail-title"]')?.innerText ?? '') })`,
      );

      // 卡片 / 表格视图特征对照（本项只改分栏中栏）
      await cdp.evaluate(`(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; items.find((n) => n.innerText.includes('卡片')).click(); return true; })()`);
      await sleep(900);
      out.ac71_card_features = await cdp.evaluate(
        `JSON.stringify((() => { const card = document.querySelector('[data-testid="pm-use-card"]'); const text = card === null ? '' : card.innerText; return { exists: card !== null, hasMeta: /取用/.test(text), hasExcerpt: text.includes('正文'), height: card === null ? null : Math.round(card.getBoundingClientRect().height) }; })())`,
      );
      await cdp.shot('02-card-view-unchanged-light');
      await cdp.evaluate(`(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; items.find((n) => n.innerText.includes('表格')).click(); return true; })()`);
      await sleep(900);
      out.ac71_table_features = await cdp.evaluate(
        `JSON.stringify((() => { const table = document.querySelector('[data-testid="pm-view-table"]'); const text = table === null ? '' : table.innerText; return { exists: table !== null, hasVersion: /v\\d+/.test(text), rows: document.querySelectorAll('[data-testid="pm-view-table"] tbody tr').length }; })())`,
      );
      await cdp.shot('03-table-view-unchanged-light');
      out.ac22_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ---------- AC-70：卡片视图拖拽 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
      await cdp.evaluate(`(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; items.find((n) => n.innerText.includes('卡片')).click(); return true; })()`);
      await cdp.waitFor(`document.querySelectorAll('[data-testid="pm-use-card"]').length >= 4`, '卡片列表');
      await sleep(800);

      out.ac70_handle = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid^="pm-drag-card-"]'); const r = el.getBoundingClientRect(); return { testid: el.getAttribute('data-testid'), w: Math.round(r.width), h: Math.round(r.height), cursor: getComputedStyle(el).cursor, visible: el.offsetParent !== null }; })())`,
      );
      out.ac70_order_before = await cdp.evaluate(idsOf('pm-drag-card-'));
      out.ac70_boxes_before = await cdp.evaluate(boxesOf());
      out.ac70_line_heights_before = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-use-card"]')].map((el) => getComputedStyle(el.querySelector('.ant-typography')).fontSize))`,
      );
      await cdp.shot('04-card-before-drag-light');

      // 真鼠标：把第 1 张卡片拖到第 3 张卡片的位置
      const handle = await cdp.center('[data-testid^="pm-drag-card-"]');
      const target = await cdp.evaluate(
        `(() => { const cards = [...document.querySelectorAll('[data-testid="pm-use-card"]')]; const el = cards[2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.shot('05-card-dragging-light').catch(() => {});
      await cdp.dragMouse({ x: handle.x, y: handle.y }, JSON.parse(target));
      await cdp.shot('06-card-after-drag-light');
      out.ac70_order_after = await cdp.evaluate(idsOf('pm-drag-card-'));
      out.ac70_line_heights_after = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-use-card"]')].map((el) => getComputedStyle(el.querySelector('.ant-typography')).fontSize))`,
      );
      out.ac70_boxes_after = await cdp.evaluate(boxesOf());
      out.ac70_sort_label = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-use-sort"]')?.innerText ?? '')`,
      );
      out.ac70_pin_favorites = await cdp.evaluate(
        `String([...document.querySelectorAll('.ant-switch')][0]?.getAttribute('aria-checked') ?? '')`,
      );
      out.ac70_drag_scroll = await cdp.evaluate(
        `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })`,
      );

      // 刷新 → 顺序保持 + 排序档显示「自定义」
      await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
      await cdp.evaluate(`(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; items.find((n) => n.innerText.includes('卡片')).click(); return true; })()`);
      await sleep(1200);
      out.ac70_order_after_reload = await cdp.evaluate(idsOf('pm-drag-card-'));
      out.ac70_sort_label_after_reload = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-use-sort"]')?.innerText ?? '')`,
      );
      out.ac70_stored_sort = await cdp.evaluate(`String(window.localStorage.getItem('pm-use-sort') ?? '')`);

      // ---------- 文件夹树同层级拖拽 ----------
      await cdp.waitFor(`document.querySelectorAll('[data-testid^="pm-drag-folder-"]').length >= 3`, '文件夹手柄');
      out.ac70_folder_order_before = await cdp.evaluate(idsOf('pm-drag-folder-'));
      out.ac70_folder_handles = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-drag-folder-"]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-testid'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }))`,
      );
      const folderHandle = await cdp.center('[data-testid^="pm-drag-folder-"]');
      const folderTarget = await cdp.evaluate(
        `(() => { const rows = [...document.querySelectorAll('[data-testid^="pm-folder-row-"]')]; const el = rows[2]; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
      );
      await cdp.dragMouse({ x: folderHandle.x, y: folderHandle.y }, JSON.parse(folderTarget), 10);
      await sleep(900);
      out.ac70_folder_order_after = await cdp.evaluate(idsOf('pm-drag-folder-'));
      out.ac70_folder_order_requests = String(cdp.folderOrderRequests);
      out.ac70_prompt_order_requests = String(cdp.promptOrderRequests);
      await cdp.shot('07-folder-after-drag-light');
      await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
      await sleep(1200);
      out.ac70_folder_order_after_reload = await cdp.evaluate(idsOf('pm-drag-folder-'));
      out.ac22_runtime_errors = JSON.stringify(cdp.errors);
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
