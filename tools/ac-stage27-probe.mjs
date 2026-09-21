#!/usr/bin/env node
/**
 * 阶段 27 运行时探针（**真鼠标**：Input.dispatchMouseEvent 的 moved/pressed/released；零 JS .click()）：
 *
 *   vars-size <baseUrl> <sid> <shotsDir>
 *     AC-82 ① 确认弹窗 = 复制**含变量** prompt 时的 `VarsDialog`（pm-vars-dialog + 标题）
 *     AC-82 ② 量 getBoundingClientRect() 的宽/高（改前 / 改后各跑一次，比 +≥15%）
 *     AC-82 ③ 弹窗内 scrollWidth ≤ clientWidth+2、变量输入区可见
 *     AC-82 ④ 分栏 / 表格 / 卡片三档触发时尺寸一致（同一组件）
 *     AC-82 ⑤ 截图
 *
 *   bulk <baseUrl> <sid> <shotsDir>
 *     AC-78 ① 首列复选框 + 表头全选；② 勾 3 条 → 工具条「已选择 3 项」+ 四个动作；③ 取消 → 清空
 *     AC-78 ④ 批量收藏 2 条 → favorite=true + 反馈 + 恰好 1 个 POST /api/prompts/bulk
 *     AC-78 ⑤ 批量移动 2 条 → folder_id 变化 + 侧栏计数同步（恰好 1 个请求）
 *     AC-78 ⑥ 批量删除 2 条 → 二次确认（含条数与「不可恢复」）→ 取消不删 → 确认删 2、total −2
 *     AC-78 ⑦ 表头全选 → 当页全部选中；⑧ 行内操作 / 行拖拽手柄 / 分页仍在
 *
 *   detail-meta <baseUrl> <sid> <shotsDir>
 *     AC-79 ① 元信息行位置（notes 之下、fields 之上）+ 含文件夹名与全部标签
 *     AC-79 ② 改文件夹（含选「未归类」）→ 落库 + 左栏计数同步 + 反馈
 *     AC-79 ③④ 加标签 / 点 ✕ 删标签 → 落库 tags 增减
 *     AC-79 ⑤ 卡片 / 表格 / 编辑器显示一致；⑥ 字号 < 标题、次级色、窄屏无横向溢出
 *
 *   detail-tabs <baseUrl> <sid> <shotsDir>
 *     AC-80 ① 页签恰好 2 个且文本 = 用户提示词 / 系统提示词；② 无「备注」页签；③ 切换后 Markdown 渲染生效；④ 编辑器备注框仍在
 *
 *   detail-vars <baseUrl> <sid> <shotsDir>
 *     AC-81 ① 详情右栏无「变量填值」区块；② 「预览 / 源码」「版本历史」仍在；③ 编辑器变量面板仍在；④ 复制含变量 prompt 仍弹 VarsDialog
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['vars-size', 'bulk', 'detail-meta', 'detail-tabs', 'detail-vars'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage27-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'docs/shots/stage27';
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
    this.bulkRequests = 0;
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
        if (url.includes('/api/prompts/bulk')) this.bulkRequests += 1;
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
  /** 元素（由 JS 表达式给出）→ 视口中心坐标（先 scrollIntoView） */
  async centerOf(jsExpr) {
    const value = await this.evaluate(
      `(() => { const el = (${jsExpr}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${jsExpr}`);
    return JSON.parse(value);
  }
  async center(selector) {
    return this.centerOf(`document.querySelector(${JSON.stringify(selector)})`);
  }
  async hover(selector) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(300);
  }
  async clickPoint(point, settle = 500) {
    const { x, y } = point;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(140);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  async realClick(selector, settle = 500) {
    await this.clickPoint(await this.center(selector), settle);
  }
  async realClickOf(jsExpr, settle = 500) {
    await this.clickPoint(await this.centerOf(jsExpr), settle);
  }
  async dragMouse(from, to, steps = 12) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
    await sleep(150);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(150);
    for (let i = 1; i <= steps; i += 1) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        button: 'left',
        buttons: 1,
      });
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

const splitByTitle = (title) =>
  `[...document.querySelectorAll('[data-testid="pm-split-item"]')].find((el) => el.innerText.includes(${JSON.stringify(title)}))`;
const rowByKey = (id) => `document.querySelector('[data-testid="pm-view-table"] tbody tr[data-row-key="${String(id)}"]')`;
const rowCheckbox = (id) => `document.querySelector('${`[data-testid="pm-view-table"] tbody tr[data-row-key="${String(id)}"] .ant-table-selection-column .ant-checkbox-wrapper`}')`;
const headerCheckbox = `document.querySelector('[data-testid="pm-view-table"] thead .ant-table-selection-column .ant-checkbox-wrapper')`;
const TABLE_ROWS = `[...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row'))`;

/** 表格行 key 顺序 */
const tableIds = `JSON.stringify(${TABLE_ROWS}.map((tr) => Number(tr.getAttribute('data-row-key'))))`;
/** 勾选态的行 id */
const checkedIds = `JSON.stringify(${TABLE_ROWS}.filter((tr) => tr.querySelector('.ant-table-selection-column .ant-checkbox-input')?.checked === true).map((tr) => Number(tr.getAttribute('data-row-key'))))`;
/** 后端读数（真实落库证据） */
const fetchJson = (url) =>
  `fetch(${JSON.stringify(url)}, { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j))`;
const fetchPrompt = (id) => fetchJson(`/api/prompts/${String(id)}`);
const messages = `JSON.stringify([...document.querySelectorAll('.ant-message-notice')].map((el) => el.innerText.trim()))`;
/** 侧栏文件夹行文本（含计数徽标；用于断言「计数同步」） */
const sidebarCounts = `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-folder-row-"]')].map((el) => el.innerText.replace(/\\n/g, ' ')))`;
const bulkRequests = (cdp) => String(cdp.bulkRequests);

/** 选 3 条 / 取消 / 表头全选等用的辅助：真鼠标点某一行的复选框 */
async function clickRowCheckbox(cdp, id) {
  await cdp.realClickOf(rowCheckbox(id), 350);
}

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac27-'));
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
    await prefs({ 'pm-theme': 'light', 'pm-pin-favorites': '0', 'pm-use-sort': 'custom', 'pm-view-mode': 'split' });

    const openDetailByTitle = async (title) => {
      await cdp.waitFor(`${splitByTitle(title)} !== undefined`, `分栏条目「${title}」`);
      await cdp.realClickOf(splitByTitle(title), 1000);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail"]')`, '详情面');
      await sleep(500);
    };
    const openVarsDialogFromSplit = async () => {
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-copy"]')`, '复制按钮');
      await cdp.realClick('[data-testid="pm-detail-copy"]', 1200);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-vars-dialog"]')`, 'VarsDialog');
      await sleep(500);
    };
    const varsModal = `document.querySelector('[data-testid="pm-vars-dialog"]').closest('.ant-modal')`;
    const measureVars = `JSON.stringify((() => { const modal = ${varsModal}; const body = document.querySelector('[data-testid="pm-vars-dialog"]'); const r = modal.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, inputs: document.querySelectorAll('[data-testid^="pm-var-input-"]').length, inputsVisible: [...document.querySelectorAll('[data-testid^="pm-var-input-"]')].every((el) => el.offsetParent !== null) }; })())`;

    if (mode === 'vars-size') {
      // ---------- AC-82：确认 + 尺寸（改前/改后各跑一次） ----------
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC27 变量夹具');
      await openVarsDialogFromSplit();
      out.ac82_dialog = await cdp.evaluate(
        `JSON.stringify({ dialogPresent: !!document.querySelector('[data-testid="pm-vars-dialog"]'), title: String(document.querySelector('.ant-modal-title')?.innerText ?? ''), trigger: '复制含变量 prompt（pm-detail-copy）' })`,
      );
      out.ac82_split = await cdp.evaluate(measureVars);
      await cdp.shot('01-vars-dialog-split-light');

      // ④ 表格档触发（同一组件，尺寸必须一致）
      await cdp.realClick('.ant-modal-close', 600);
      await prefs({ 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await cdp.waitFor(`!!document.querySelector('[data-testid^="pm-copy-"]')`, '表格复制按钮');
      await cdp.realClickOf(`[...document.querySelectorAll('[data-testid^="pm-copy-"]')].find((el) => (el.closest('tr')?.innerText ?? '').includes('AC27 变量夹具'))`, 1200);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-vars-dialog"]')`, 'VarsDialog（表格档）');
      await sleep(500);
      out.ac82_table = await cdp.evaluate(measureVars);
      await cdp.realClick('.ant-modal-close', 600);

      // ④ 卡片档触发
      await prefs({ 'pm-view-mode': 'card' });
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      await cdp.waitFor(`!!document.querySelector('[data-testid^="pm-copy-"]')`, '卡片复制按钮');
      await cdp.realClickOf(`[...document.querySelectorAll('[data-testid^="pm-copy-"]')].find((el) => (el.closest('[data-testid="pm-use-card"]')?.innerText ?? '').includes('AC27 变量夹具'))`, 1200);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-vars-dialog"]')`, 'VarsDialog（卡片档）');
      await sleep(500);
      out.ac82_card = await cdp.evaluate(measureVars);
      await cdp.shot('02-vars-dialog-card-light');
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
    } else if (mode === 'bulk') {
      // ---------- AC-78：表格批量操作 ----------
      await prefs({ 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await cdp.waitFor(`${TABLE_ROWS}.length >= 6`, '表格 ≥6 行');
      await sleep(700);

      out.ac78_table_ids = await cdp.evaluate(tableIds);
      out.ac78_has_selection_column = await cdp.evaluate(
        `String(!!document.querySelector('[data-testid="pm-view-table"] thead .ant-table-selection-column') && ${TABLE_ROWS}.every((tr) => !!tr.querySelector('.ant-table-selection-column .ant-checkbox-input')))`,
      );
      out.ac78_header_checkbox = await cdp.evaluate(`String(!!${headerCheckbox})`);
      out.ac78_toolbar_before = await cdp.evaluate(`String(document.querySelector('[data-testid="pm-bulk-toolbar"]') !== null)`);
      await cdp.shot('01-table-no-selection-light');

      const ids = JSON.parse(out.ac78_table_ids);
      // ② 勾 3 条
      for (const id of ids.slice(0, 3)) await clickRowCheckbox(cdp, id);
      out.ac78_checked_3 = await cdp.evaluate(checkedIds);
      out.ac78_toolbar = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-bulk-toolbar"]'); return el === null ? null : { text: el.innerText.replace(/\\n/g, ' | '), count: String(document.querySelector('[data-testid="pm-bulk-count"]')?.innerText ?? ''), favorite: !!document.querySelector('[data-testid="pm-bulk-favorite"]'), move: !!document.querySelector('[data-testid="pm-bulk-move"]'), del: !!document.querySelector('[data-testid="pm-bulk-delete"]'), cancel: !!document.querySelector('[data-testid="pm-bulk-cancel"]') }; })())`,
      );
      await cdp.shot('02-table-selected-3-light');

      // ③ 取消 → 清空
      await cdp.realClick('[data-testid="pm-bulk-cancel"]', 600);
      out.ac78_after_cancel = await cdp.evaluate(
        `JSON.stringify({ checked: ${checkedIds}, toolbar: document.querySelector('[data-testid="pm-bulk-toolbar"]') !== null })`,
      );

      // ④ 批量收藏 2 条 → 恰好 1 个请求
      await clickRowCheckbox(cdp, ids[0]);
      await clickRowCheckbox(cdp, ids[1]);
      const favBefore = cdp.bulkRequests;
      await cdp.realClick('[data-testid="pm-bulk-favorite"]', 1400);
      out.ac78_favorite_requests = String(cdp.bulkRequests - favBefore);
      out.ac78_favorite_p1 = await cdp.evaluate(fetchPrompt(ids[0]));
      out.ac78_favorite_p2 = await cdp.evaluate(fetchPrompt(ids[1]));
      out.ac78_favorite_messages = await cdp.evaluate(messages);
      out.ac78_after_favorite_checked = await cdp.evaluate(checkedIds);
      await cdp.shot('03-table-after-bulk-favorite-light');

      // ⑤ 批量移动 2 条到目标目录
      out.ac78_folder_target = String(
        JSON.parse(await cdp.evaluate(fetchJson('/api/folders'))).items.find((f) => f.name === 'AC27 目标目录').id,
      );
      const moveIds = ids.slice(2, 4);
      await clickRowCheckbox(cdp, moveIds[0]);
      await clickRowCheckbox(cdp, moveIds[1]);
      const folderBefore = await cdp.evaluate(fetchPrompt(moveIds[0]));
      out.ac78_sidebar_counts_before = await cdp.evaluate(sidebarCounts);
      await cdp.realClick('[data-testid="pm-bulk-move"]', 800);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-bulk-move-modal"]')`, '批量移动弹窗');
      out.ac78_move_modal_text = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-bulk-move-modal"]')?.innerText.replace(/\\n/g, ' | ') ?? '')`,
      );
      await cdp.realClickOf(
        `[...document.querySelectorAll('[data-testid="pm-bulk-move-folder"]')][0]`,
        500,
      );
      await cdp.waitFor(`!!document.querySelector('.ant-select-tree-node-content-wrapper')`, '文件夹下拉');
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-select-tree-node-content-wrapper')].find((el) => el.innerText.includes('AC27 目标目录'))`,
        700,
      );
      const moveReqBefore = cdp.bulkRequests;
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-modal-footer button')].find((el) => el.innerText.replace(/\\s/g, '').includes('确定'))`,
        1600,
      );
      out.ac78_move_requests = String(cdp.bulkRequests - moveReqBefore);
      out.ac78_move_p1 = await cdp.evaluate(fetchPrompt(moveIds[0]));
      out.ac78_move_p2 = await cdp.evaluate(fetchPrompt(moveIds[1]));
      out.ac78_move_folder_before = folderBefore;
      out.ac78_sidebar_counts = await cdp.evaluate(sidebarCounts);
      await cdp.shot('04-table-after-bulk-move-light');

      // ⑥ 批量删除 2 条 → 二次确认
      const delIds = ids.slice(4, 6);
      const totalBefore = Number(JSON.parse(await cdp.evaluate(fetchJson('/api/prompts?limit=200'))).total);
      await clickRowCheckbox(cdp, delIds[0]);
      await clickRowCheckbox(cdp, delIds[1]);
      await cdp.realClick('[data-testid="pm-bulk-delete"]', 800);
      await cdp.waitFor(`!!document.querySelector('.ant-modal-confirm')`, '批量删除确认弹窗');
      out.ac78_delete_confirm_text = await cdp.evaluate(
        `String(document.querySelector('.ant-modal-confirm')?.innerText.replace(/\\n/g, ' | ') ?? '')`,
      );
      await cdp.shot('05-table-bulk-delete-confirm-light');
      // 先取消
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-modal-confirm button')].find((el) => el.innerText.replace(/\\s/g, '').includes('取消'))`,
        1200,
      );
      const totalAfterCancel = Number(JSON.parse(await cdp.evaluate(fetchJson('/api/prompts?limit=200'))).total);
      out.ac78_total_before = String(totalBefore);
      out.ac78_total_after_cancel = String(totalAfterCancel);
      // 再确认
      await cdp.realClick('[data-testid="pm-bulk-delete"]', 800);
      await cdp.waitFor(`!!document.querySelector('.ant-modal-confirm')`, '批量删除确认弹窗（二次）');
      // 阶段 29 补：批量**删除**也要量"一次操作 1 个请求"（此前只量了收藏/移动）
      const delRequestsBefore = cdp.bulkRequests;
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-modal-confirm button')].find((el) => el.innerText.replace(/\\s/g, '').includes('删除'))`,
        1800,
      );
      out.ac78_delete_requests = String(cdp.bulkRequests - delRequestsBefore);
      const totalAfterConfirm = Number(JSON.parse(await cdp.evaluate(fetchJson('/api/prompts?limit=200'))).total);
      out.ac78_total_after_confirm = String(totalAfterConfirm);
      out.ac78_deleted_404 = await cdp.evaluate(
        `fetch('/api/prompts/${String(delIds[0])}', { credentials: 'same-origin' }).then((r) => String(r.status))`,
      );
      await cdp.shot('06-table-after-bulk-delete-light');

      // ⑦ 表头全选
      await cdp.realClickOf(headerCheckbox, 700);
      out.ac78_select_all = await cdp.evaluate(
        `JSON.stringify((() => { const rows = ${TABLE_ROWS}.map((tr) => Number(tr.getAttribute('data-row-key'))); const checked = ${TABLE_ROWS}.filter((tr) => tr.querySelector('.ant-table-selection-column .ant-checkbox-input')?.checked === true).map((tr) => Number(tr.getAttribute('data-row-key'))); return { rows, checked, all: rows.length > 0 && rows.length === checked.length }; })())`,
      );
      out.ac78_select_all_text = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-bulk-count"]')?.innerText ?? '')`,
      );
      await cdp.shot('07-table-select-all-light');

      // ⑧ 回归：行内操作 / 行拖拽手柄 / 分页仍在
      out.ac78_regression = await cdp.evaluate(
        `JSON.stringify({ edit: document.querySelectorAll('[data-testid^="pm-edit-"]').length, del: document.querySelectorAll('[data-testid^="pm-delete-"]').length, copy: document.querySelectorAll('[data-testid^="pm-copy-"]').length, dragRow: document.querySelectorAll('[data-testid^="pm-drag-row-"]').length, pagination: !!document.querySelector('.ant-pagination'), sort: !!document.querySelector('[data-testid="pm-use-sort"]'), search: !!document.querySelector('[data-testid="pm-search-input"]') })`,
      );
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
    } else if (mode === 'detail-meta') {
      // ---------- AC-79：分栏详情页的 文件夹 + 标签 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC27 变量夹具');
      out.ac79_meta = await cdp.evaluate(
        `JSON.stringify((() => { const notes = document.querySelector('[data-testid="pm-detail-notes"]'); const meta = document.querySelector('[data-testid="pm-detail-meta"]'); const fields = document.querySelector('[data-testid="pm-detail-fields"]'); if (meta === null) return null; const n = notes === null ? null : notes.getBoundingClientRect(); const m = meta.getBoundingClientRect(); const f = fields.getBoundingClientRect(); return { text: meta.innerText.replace(/\\n/g, ' | '), tags: [...meta.querySelectorAll('[data-testid="pm-detail-tag"]')].map((el) => el.innerText.trim()), folderSelect: !!meta.querySelector('.ant-select'), addTag: !!document.querySelector('[data-testid="pm-detail-tag-add"]'), afterNotes: n === null ? null : m.top >= n.bottom - 1, beforeFields: m.bottom <= f.top + 1, metaTop: Math.round(m.top), notesBottom: n === null ? null : Math.round(n.bottom), fieldsTop: Math.round(f.top) }; })())`,
      );
      out.ac79_style = await cdp.evaluate(
        `JSON.stringify((() => { const meta = document.querySelector('[data-testid="pm-detail-meta"]'); const title = document.querySelector('[data-testid="pm-detail-title"]'); const cs = getComputedStyle(meta); return { metaFontSize: cs.fontSize, titleFontSize: getComputedStyle(title).fontSize, metaColor: cs.color, titleColor: getComputedStyle(title).color, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }; })())`,
      );
      await cdp.shot('01-detail-meta-light');

      // ② 改文件夹：选「AC27 目标目录」→ 再选「未归类」
      const folderId = Number(
        JSON.parse(await cdp.evaluate(fetchJson('/api/folders'))).items.find((f) => f.name === 'AC27 目标目录').id,
      );
      out.ac79_folder_target = String(folderId);
      out.ac79_sidebar_counts_before = await cdp.evaluate(sidebarCounts);
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-detail-folder"]')`, 500);
      await cdp.waitFor(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')`, '文件夹树下拉');
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-select-tree-node-content-wrapper')].find((el) => el.innerText.includes('AC27 目标目录'))`,
        1400,
      );
      out.ac79_folder_after_move = await cdp.evaluate(
        `fetch('/api/prompts?q=' + encodeURIComponent('AC27 变量夹具'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j.items[0]))`,
      );
      out.ac79_move_messages = await cdp.evaluate(messages);
      out.ac79_sidebar_counts = await cdp.evaluate(sidebarCounts);
      await cdp.shot('02-detail-meta-folder-changed-light');

      // 再选「未归类」
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-detail-folder"]')`, 500);
      await cdp.waitFor(`!!document.querySelector('.ant-select-tree-node-content-wrapper')`, '文件夹树下拉（未归类）');
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-select-tree-node-content-wrapper')].find((el) => el.innerText.trim() === '未归类')`,
        1400,
      );
      out.ac79_folder_after_unfiled = await cdp.evaluate(
        `fetch('/api/prompts?q=' + encodeURIComponent('AC27 变量夹具'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify({ folder_id: j.items[0].folder_id }))`,
      );

      // ③ 加标签（选已有标签 AC27乙）
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-detail-tag-add"]')`, 500);
      await cdp.waitFor(`!!document.querySelector('.ant-select-item-option')`, '标签下拉');
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-select-item-option')].find((el) => el.innerText.includes('AC27乙'))`,
        1400,
      );
      out.ac79_tags_after_add = await cdp.evaluate(
        `fetch('/api/prompts?q=' + encodeURIComponent('AC27 变量夹具'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify({ tags: j.items[0].tags }))`,
      );
      await cdp.shot('03-detail-meta-tag-added-light');

      // ④ 删标签：点第一个标签的 ✕
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-detail-tag-remove"]')`, 1400);
      out.ac79_tags_after_remove = await cdp.evaluate(
        `fetch('/api/prompts?q=' + encodeURIComponent('AC27 变量夹具'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify({ tags: j.items[0].tags }))`,
      );
      await cdp.shot('04-detail-meta-tag-removed-light');

      // ⑤ 一致性：表格 / 卡片 / 编辑器
      await prefs({ 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      out.ac79_table_row = await cdp.evaluate(
        `String(${TABLE_ROWS}.find((tr) => tr.innerText.includes('AC27 变量夹具'))?.innerText.replace(/\\n/g, ' | ') ?? '')`,
      );
      await prefs({ 'pm-view-mode': 'card' });
      await navigate(`!!document.querySelector('[data-testid="pm-use-card"]')`);
      out.ac79_card_text = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-use-card"]')].find((el) => el.innerText.includes('AC27 变量夹具'))?.innerText.replace(/\\n/g, ' | ') ?? '')`,
      );
      await prefs({ 'pm-view-mode': 'split' });
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC27 变量夹具');
      await cdp.realClick('[data-testid="pm-detail-edit"]', 1400);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器');
      out.ac79_editor_tags = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-editor"] .ant-select-selection-item')].map((el) => el.innerText.trim()))`,
      );
      out.ac79_editor_notes = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-editor"] textarea')].map((el) => el.value).find((v) => v.includes('AC27')) ?? '')`,
      );
      await cdp.shot('05-detail-meta-editor-consistency-light');

      // ⑥ 窄屏（<1200px）无横向溢出 —— 回详情面量
      await cdp.realClick('[data-testid="editor-back"]', 1200);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-meta"]')`, '回到详情元信息行');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      out.ac79_narrow_scroll = await cdp.evaluate(
        `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, metaPresent: !!document.querySelector('[data-testid="pm-detail-meta"]') })`,
      );
      await cdp.shot('06-detail-meta-narrow-light');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
    } else if (mode === 'detail-tabs') {
      // ---------- AC-80：字段页签恰好两个 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC27 无变量');
      out.ac80_tabs = await cdp.evaluate(
        // 只取**字段页签**那一个 Segmented（pm-detail-fields 里还有「预览 / 源码」第二个 Segmented）
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented')[0].querySelectorAll('.ant-segmented-item')].map((el) => el.innerText.trim()))`,
      );
      out.ac80_notes_tab_count = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented')[0].querySelectorAll('.ant-segmented-item')].filter((el) => el.innerText.includes('备注')).length)`,
      );
      // ③ 两个页签切换后 Markdown 渲染仍生效
      await cdp.waitFor(`(document.querySelector('[data-testid="markdown-preview"]')?.innerText ?? '').length > 0`, '预览渲染');
      out.ac80_user_render = await cdp.evaluate(`String((document.querySelector('[data-testid="markdown-preview"]')?.innerText ?? '').slice(0, 40))`);
      await cdp.realClickOf(
        `[...document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented-item')].find((el) => el.innerText.includes('系统提示词'))`,
        1200,
      );
      await cdp.waitFor(`(document.querySelector('[data-testid="markdown-preview"]')?.innerText ?? '').length > 0`, '系统提示词预览');
      out.ac80_system_render = await cdp.evaluate(`String((document.querySelector('[data-testid="markdown-preview"]')?.innerText ?? '').slice(0, 40))`);
      await cdp.shot('01-detail-tabs-two-light');
      // ④ 编辑器的备注输入框仍在
      await cdp.realClick('[data-testid="pm-detail-edit"]', 1400);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器');
      out.ac80_editor_notes = await cdp.evaluate(
        `JSON.stringify((() => { const item = [...document.querySelectorAll('[data-testid="pm-editor"] .ant-form-item')].find((el) => el.innerText.includes('备注')); return { present: item !== undefined, textarea: item?.querySelector('textarea') !== undefined && item?.querySelector('textarea') !== null }; })())`,
      );
      await cdp.shot('02-editor-notes-still-there-light');
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ---------- AC-81：详情页不再有「变量填值」区块 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC27 变量夹具');
      out.ac81_detail = await cdp.evaluate(
        `JSON.stringify((() => { const d = document.querySelector('[data-testid="pm-detail"]'); const t = d.innerText; return { hasVariableBlock: t.includes('变量填值'), variablePanel: !!d.querySelector('[data-testid="pm-panel-variables"]'), markdownPreview: !!d.querySelector('[data-testid="markdown-preview"]'), previewToggle: t.includes('预览') && t.includes('源码'), versionHistory: t.includes('版本历史'), text: t.replace(/\\n/g, ' | ').slice(0, 200) }; })())`,
      );
      await cdp.shot('01-detail-no-variable-block-light');
      // ③ 编辑器变量面板仍在
      await cdp.realClick('[data-testid="pm-detail-edit"]', 1400);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器');
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-panel-variables"]')`, '编辑器变量面板');
      out.ac81_editor_panel = await cdp.evaluate(
        `JSON.stringify({ panel: !!document.querySelector('[data-testid="pm-panel-variables"]'), text: String(document.querySelector('[data-testid="pm-panel-variables"]')?.innerText.replace(/\\n/g, ' | ') ?? '').slice(0, 80) })`,
      );
      await cdp.shot('02-editor-variable-panel-light');
      // ④ 复制含变量 prompt 仍弹 VarsDialog（编辑器右栏的变量面板「复制」入口不测，这里回分栏走复制按钮）
      await cdp.realClick('[data-testid="editor-back"]', 1200);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-copy"]')`, '回到详情');
      await cdp.realClick('[data-testid="pm-detail-copy"]', 1400);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-vars-dialog"]')`, 'VarsDialog');
      out.ac81_vars_dialog = await cdp.evaluate(
        `JSON.stringify({ present: !!document.querySelector('[data-testid="pm-vars-dialog"]'), title: String(document.querySelector('.ant-modal-title')?.innerText ?? ''), preview: !!document.querySelector('[data-testid="pm-vars-preview"]') })`,
      );
      await cdp.shot('03-copy-still-opens-vars-dialog-light');
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
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
