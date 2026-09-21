#!/usr/bin/env node
/**
 * 阶段 29 运行时探针（**真鼠标**：Input.dispatchMouseEvent 的 moved/pressed/released；零 JS .click()）：
 *
 *   bulk-ui <baseUrl> <sid> <shotsDir>
 *     AC-84 ① 部分选中 → 表头复选框 `ant-checkbox-indeterminate`（或 input aria-checked="mixed"）；
 *              点表头 → 全选 = `ant-checkbox-checked` 且无 indeterminate；再点 → 两者皆无
 *     AC-84 ② 表头复选框与行内复选框 getBoundingClientRect() 宽高差 ≤1px
 *     AC-84 ③ 批量工具条底部 → 表头行顶部 ≥6px
 *     AC-84 ⑤ 截图三态：未选 / 部分选 / 全选
 *
 *   meta-ui <baseUrl> <sid> <shotsDir>
 *     AC-85 ① 备注行底部→元信息行顶部 ≥12px 且 ≤ 元信息行底部→字段页签行顶部
 *     AC-85 ② 长内容（长文件夹名 + 5 标签）：元信息行 scrollWidth ≤ clientWidth+2，
 *              「+ 添加标签」right ≤ 面板 right + 1
 *     AC-85 ③ 详情 chip 与左栏同名 chip 的 backgroundColor / border / borderRadius 一致
 *     AC-85 ⑤ 截图：常规 / 长内容 / 亮暗
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['bulk-ui', 'meta-ui'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage29-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'docs/shots/stage29';
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
  async clickPoint(point, settle = 400) {
    const { x, y } = point;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  async realClickOf(jsExpr, settle = 400) {
    await this.clickPoint(await this.centerOf(jsExpr), settle);
  }
  /** 真鼠标移到元素上（不点击）—— 用于量 hover 态的 computed style */
  async hoverOf(jsExpr) {
    const { x, y } = await this.centerOf(jsExpr);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(400);
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

const TABLE = `document.querySelector('[data-testid="pm-view-table"]')`;
const HEADER_BOX = `document.querySelector('[data-testid="pm-view-table"] thead .ant-table-selection-column .ant-checkbox')`;
const HEADER_INPUT = `document.querySelector('[data-testid="pm-view-table"] thead .ant-table-selection-column input[type="checkbox"]')`;
const HEADER_WRAP = `document.querySelector('[data-testid="pm-view-table"] thead .ant-table-selection-column .ant-checkbox-wrapper')`;
const HEADER_ROW = `document.querySelector('[data-testid="pm-view-table"] thead tr')`;
const ROW_BOX = (id) =>
  `document.querySelector('[data-testid="pm-view-table"] tbody tr[data-row-key="${String(id)}"] .ant-table-selection-column .ant-checkbox')`;
const ROW_WRAP = (id) =>
  `document.querySelector('[data-testid="pm-view-table"] tbody tr[data-row-key="${String(id)}"] .ant-table-selection-column .ant-checkbox-wrapper')`;
const TABLE_ROWS = `[...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].filter((tr) => !tr.classList.contains('ant-table-measure-row'))`;
const tableIds = `JSON.stringify(${TABLE_ROWS}.map((tr) => Number(tr.getAttribute('data-row-key'))))`;

const stateOf = (boxExpr) =>
  `JSON.stringify((() => { const box = ${boxExpr}; const input = box === null ? null : box.querySelector('input[type="checkbox"]'); return box === null ? null : { classes: box.className, indeterminateClass: box.classList.contains('ant-checkbox-indeterminate'), checkedClass: box.classList.contains('ant-checkbox-checked'), ariaChecked: input === null ? null : input.getAttribute('aria-checked'), inputChecked: input === null ? null : input.checked }; })())`;
const rectOf = (expr) =>
  `JSON.stringify((() => { const el = ${expr}; if (el === null) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; })())`;
const styleOf = (expr) =>
  `JSON.stringify((() => { const el = ${expr}; if (el === null) return null; const cs = getComputedStyle(el); return { backgroundColor: cs.backgroundColor, border: cs.border, borderTopWidth: cs.borderTopWidth, borderTopStyle: cs.borderTopStyle, borderTopColor: cs.borderTopColor, borderRadius: cs.borderRadius, color: cs.color, height: cs.height, fontSize: cs.fontSize }; })())`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac29-'));
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

    const splitByTitle = (title) =>
      `[...document.querySelectorAll('[data-testid="pm-split-item"]')].find((el) => el.innerText.includes(${JSON.stringify(title)}))`;
    const openDetailByTitle = async (title) => {
      await cdp.waitFor(`${splitByTitle(title)} !== undefined`, `分栏条目「${title}」`);
      await cdp.realClickOf(splitByTitle(title), 1000);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail"]')`, '详情面');
      await sleep(500);
    };

    if (mode === 'bulk-ui') {
      // ---------- AC-84：表头复选框三态 + 尺寸一致 + 工具条间距 ----------
      await prefs({ 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await cdp.waitFor(`${TABLE_ROWS}.length >= 6`, '表格 ≥6 行');
      await sleep(700);
      const ids = JSON.parse(await cdp.evaluate(tableIds));

      // ⑤ 未选态截图 + 状态
      out.ac84_state_none = await cdp.evaluate(stateOf(HEADER_BOX));
      await cdp.shot('01-bulk-none-light');

      // ① 部分选中（真鼠标勾 3 行）
      for (const id of ids.slice(0, 3)) await cdp.realClickOf(ROW_WRAP(id), 300);
      out.ac84_state_partial = await cdp.evaluate(stateOf(HEADER_BOX));
      // ①（对抗性补强）：半选态是**视觉覆写** —— 只验 class 挡不住"被 antd 运行时 CSS-in-JS 盖回去"，
      //    因此再量 computed style：半选外框的底色/边框必须与**已勾选行**一致（= 同一主色填充），
      //    且 ::after 是白色 8×2 横杠（而不是 antd 默认的"小主色方块"）。
      out.ac84_partial_style = await cdp.evaluate(
        `JSON.stringify((() => {
           const box = ${HEADER_BOX}; if (box === null) return null;
           const cs = getComputedStyle(box); const after = getComputedStyle(box, '::after');
           return { backgroundColor: cs.backgroundColor, borderTopColor: cs.borderTopColor, afterWidth: after.width, afterHeight: after.height, afterBackground: after.backgroundColor, afterOpacity: after.opacity };
         })())`,
      );
      out.ac84_checked_row_style = await cdp.evaluate(
        `JSON.stringify((() => { const box = ${ROW_BOX(ids[0])}; if (box === null) return null; const cs = getComputedStyle(box); return { backgroundColor: cs.backgroundColor, borderTopColor: cs.borderTopColor }; })())`,
      );
      out.ac84_page_row_count = await cdp.evaluate(`String(${TABLE_ROWS}.length)`);
      await cdp.shot('02-bulk-partial-light');

      // ①（对抗性自审第 2 轮补）：**hover 态** —— antd 给半选态单独注入了 hover（亮色下白底），
      //    若不覆盖，鼠标悬浮时就是"白底 + 白杠" ⇒ 又看不出半选（AC-84 ① 只验静态会漏掉）。
      //    真鼠标移到表头复选框上再量：底色/边框必须仍是主色（不是白），横杠仍是白色。
      await cdp.hoverOf(HEADER_WRAP);
      out.ac84_partial_hover_style = await cdp.evaluate(
        `JSON.stringify((() => { const box = ${HEADER_BOX}; if (box === null) return null; const cs = getComputedStyle(box); const after = getComputedStyle(box, '::after'); return { backgroundColor: cs.backgroundColor, borderTopColor: cs.borderTopColor, afterBackground: after.backgroundColor }; })())`,
      );
      await cdp.shot('02c-bulk-partial-hover-light');
      // 鼠标移开，避免影响后续测量
      await cdp.hoverOf(`document.querySelector('[data-testid="pm-search-input"]')`);

      // ② 尺寸一致：表头 vs 行内
      out.ac84_header_box_rect = await cdp.evaluate(rectOf(HEADER_BOX));
      out.ac84_row_box_rect = await cdp.evaluate(rectOf(ROW_BOX(ids[0])));
      out.ac84_header_wrap_rect = await cdp.evaluate(rectOf(HEADER_WRAP));
      out.ac84_row_wrap_rect = await cdp.evaluate(rectOf(ROW_WRAP(ids[0])));

      // ③ 工具条底部 → 表头行顶部
      out.ac84_toolbar_rect = await cdp.evaluate(rectOf(`document.querySelector('[data-testid="pm-bulk-toolbar"]')`));
      out.ac84_header_row_rect = await cdp.evaluate(rectOf(HEADER_ROW));

      // ① 全选（真鼠标点表头）
      await cdp.realClickOf(HEADER_WRAP, 600);
      out.ac84_state_all = await cdp.evaluate(stateOf(HEADER_BOX));
      out.ac84_checked_after_all = await cdp.evaluate(
        `JSON.stringify(${TABLE_ROWS}.filter((tr) => tr.querySelector('.ant-table-selection-column input[type="checkbox"]')?.checked === true).length)`,
      );
      await cdp.shot('03-bulk-all-light');

      // ① 再点 → 未选（两者皆无）
      await cdp.realClickOf(HEADER_WRAP, 600);
      out.ac84_state_none_again = await cdp.evaluate(stateOf(HEADER_BOX));
      out.ac84_checked_after_none = await cdp.evaluate(
        `JSON.stringify(${TABLE_ROWS}.filter((tr) => tr.querySelector('.ant-table-selection-column input[type="checkbox"]')?.checked === true).length)`,
      );
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ---------- AC-85：元信息行层级间距 / 长内容健壮性 / chip 样式统一 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);

      // ① 层级间距（常规夹具，有备注）
      await openDetailByTitle('AC29 常规夹具');
      out.ac85_spacing = await cdp.evaluate(
        `JSON.stringify((() => { const notes = document.querySelector('[data-testid="pm-detail-notes"]'); const meta = document.querySelector('[data-testid="pm-detail-meta"]'); const fields = document.querySelector('[data-testid="pm-detail-fields"]'); if (meta === null || fields === null) return null; const n = notes === null ? null : notes.getBoundingClientRect(); const m = meta.getBoundingClientRect(); const f = fields.getBoundingClientRect(); return { notesBottom: n === null ? null : Math.round(n.bottom), metaTop: Math.round(m.top), metaBottom: Math.round(m.bottom), fieldsTop: Math.round(f.top), notesToMeta: n === null ? null : Math.round(m.top - n.bottom), metaToFields: Math.round(f.top - m.bottom) }; })())`,
      );
      out.ac85_meta_regular = await cdp.evaluate(
        `JSON.stringify((() => { const meta = document.querySelector('[data-testid="pm-detail-meta"]'); const panel = document.querySelector('[data-testid="pm-detail"]'); const add = document.querySelector('[data-testid="pm-detail-tag-add"]'); const mr = meta.getBoundingClientRect(); const pr = panel.getBoundingClientRect(); const ar = add === null ? null : add.getBoundingClientRect(); return { scrollWidth: meta.scrollWidth, clientWidth: meta.clientWidth, addRight: ar === null ? null : Math.round(ar.right), panelRight: Math.round(pr.right), tags: [...meta.querySelectorAll('[data-testid="pm-detail-tag"]')].map((el) => el.innerText.trim()), text: meta.innerText.replace(/\\n/g, ' | ') }; })())`,
      );
      await cdp.shot('01-meta-regular-light');

      // ③ chip 样式统一：详情 chip vs 左栏同名 chip（取同一标签名）
      out.ac85_chip_style = await cdp.evaluate(
        `JSON.stringify((() => {
           const detail = document.querySelector('[data-testid="pm-detail-tag"]');
           if (detail === null) return null;
           const name = detail.innerText.replace('✕', '').trim();
           const side = [...document.querySelectorAll('[data-testid="pm-tag-chip"]')].find((el) => el.innerText.trim() === name);
           const pick = (el) => { const cs = getComputedStyle(el); return { backgroundColor: cs.backgroundColor, border: cs.border, borderTopWidth: cs.borderTopWidth, borderTopStyle: cs.borderTopStyle, borderTopColor: cs.borderTopColor, borderRadius: cs.borderRadius, color: cs.color, height: cs.height }; };
           return { name, detail: pick(detail), sidebar: side === undefined ? null : pick(side) };
         })())`,
      );

      // ② 长内容健壮性（长文件夹名 ≥20 字 + 5 标签）
      await openDetailByTitle('AC29 长内容夹具');
      out.ac85_meta_long = await cdp.evaluate(
        `JSON.stringify((() => { const meta = document.querySelector('[data-testid="pm-detail-meta"]'); const panel = document.querySelector('[data-testid="pm-detail"]'); const add = document.querySelector('[data-testid="pm-detail-tag-add"]'); const folder = document.querySelector('[data-testid="pm-detail-folder"]'); const mr = meta.getBoundingClientRect(); const pr = panel.getBoundingClientRect(); const ar = add === null ? null : add.getBoundingClientRect(); return { scrollWidth: meta.scrollWidth, clientWidth: meta.clientWidth, metaRight: Math.round(mr.right), addRight: ar === null ? null : Math.round(ar.right), panelRight: Math.round(pr.right), folderText: folder === null ? '' : folder.innerText, tagCount: meta.querySelectorAll('[data-testid="pm-detail-tag"]').length, docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth }; })())`,
      );
      await cdp.shot('02-meta-long-light');

      // ② 补充证据：窄面板（1100px 视口）下同样不溢出（AC-79 ⑥ 只测了窄屏，本阶段补"窄屏 + 长内容"）
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      out.ac85_meta_long_narrow = await cdp.evaluate(
        `JSON.stringify((() => { const meta = document.querySelector('[data-testid="pm-detail-meta"]'); const panel = document.querySelector('[data-testid="pm-detail"]'); const add = document.querySelector('[data-testid="pm-detail-tag-add"]'); const mr = meta.getBoundingClientRect(); const pr = panel.getBoundingClientRect(); const ar = add === null ? null : add.getBoundingClientRect(); return { scrollWidth: meta.scrollWidth, clientWidth: meta.clientWidth, metaRight: Math.round(mr.right), addRight: ar === null ? null : Math.round(ar.right), panelRight: Math.round(pr.right), docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth }; })())`,
      );
      await cdp.shot('02b-meta-long-narrow-light');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(600);

      // ⑤ 暗色截图（长内容 + 常规）
      await prefs({ 'pm-theme': 'dark' });
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC29 长内容夹具');
      await cdp.shot('03-meta-long-dark');
      await openDetailByTitle('AC29 常规夹具');
      await cdp.shot('04-meta-regular-dark');
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
