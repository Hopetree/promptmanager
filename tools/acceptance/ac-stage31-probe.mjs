#!/usr/bin/env node
/**
 * 阶段 31 运行时探针（**真鼠标**：Input.dispatchMouseEvent 的 moved/pressed/released；零 JS .click()；
 * 真实像素一律走 getBoundingClientRect / getComputedStyle）：
 *
 *   tags-ui <baseUrl> <sid> <shotsDir>
 *     AC-87 ① 表格「标签」列里相邻 <Tag> 的水平间隙 = left - (prev.left + prev.width)，逐个贴出
 *     AC-87 ② 与**卡片视图**同一 prompt 的标签间隙对比（两处数值都贴）
 *     AC-87 ③ 该单元格 scrollWidth ≤ clientWidth + 2，且列宽未被撑破（贴表头列宽）
 *     AC-87 ④ 单标签 / 无标签两条夹具的单元格证据
 *     AC-87 ⑤ 截图：表格视图多标签行（亮色）
 *
 *   retention-ui <baseUrl> <sid> <shotsDir>
 *     AC-88 ⑧ 版本面板里**可见**的「最多保留最近 10 个版本」文案（贴 DOM 文本 + rect 证明可见）
 *     AC-88 ⑤ 回滚按钮仍在（回归） + 截图
 *
 * 标签单元格定位：优先 `[data-testid="pm-table-tag-cell"]`（本阶段加的），
 * 找不到时按**表头列序**回退 —— 这样同一个探针可以在改动前后各跑一次，给出真实的"改前/改后"像素对照。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['tags-ui', 'retention-ui'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage31-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage31';
/** 三标签夹具的 prompt id（由 ac-stage31.sh 建完夹具后用环境变量传入；卡片视图靠它定位） */
const MULTI_ID = process.env.AC31_MULTI_ID ?? '0';
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

/** 表格里某个 title 对应的行（按行内文本找，避免依赖 id）。 */
const rowByTitle = (title) =>
  `[...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].find((tr) => !tr.classList.contains('ant-table-measure-row') && tr.innerText.includes(${JSON.stringify(title)}))`;

/** 「标签」列的列序（含 rowSelection 列，所以用表头文本反查 cellIndex）。 */
const TAG_COL_INDEX = `(() => { const ths = [...document.querySelectorAll('[data-testid="pm-view-table"] thead th')]; return ths.findIndex((th) => th.innerText.trim() === '标签'); })()`;

/**
 * 量一个容器里所有 `.ant-tag` 的相邻水平间隙。
 * 间隙口径与 AC 一致：`left - (prev.left + prev.width)`；**只在同一行内计算**（标签容器是 `wrap` 的，
 * 跨行的"间隙"没有意义 —— 首版探针按数组顺序算，跨行那一对量出了负数，属于口径错误，已修正）。
 */
const gapsOf = (containerExpr, tagSelector = '.ant-tag') =>
  `JSON.stringify((() => {
     const box = ${containerExpr};
     if (box === null) return null;
     const tags = [...box.querySelectorAll(${JSON.stringify(tagSelector)})];
     const rects = tags.map((el) => { const r = el.getBoundingClientRect(); return { text: el.innerText.trim(), left: r.left, top: r.top, width: r.width, right: r.right }; });
     const lines = [];
     for (const rect of rects) {
       const line = lines.find((l) => Math.abs(l.top - rect.top) <= 1);
       if (line === undefined) lines.push({ top: rect.top, rects: [rect] });
       else line.rects.push(rect);
     }
     const gaps = [];
     for (const line of lines) {
       for (let i = 1; i < line.rects.length; i += 1) gaps.push(Math.round((line.rects[i].left - line.rects[i - 1].right) * 100) / 100);
     }
     const br = box.getBoundingClientRect();
     const cs = getComputedStyle(box);
     return {
       tagCount: tags.length,
       texts: rects.map((r) => r.text),
       rects: rects.map((r) => ({ left: Math.round(r.left * 100) / 100, width: Math.round(r.width * 100) / 100 })),
       gaps,
       gapCount: gaps.length,
       lineCount: lines.length,
       wrapped: lines.length > 1,
       perLine: lines.map((l) => l.rects.length),
       containerRect: { left: Math.round(br.left), right: Math.round(br.right), width: Math.round(br.width), height: Math.round(br.height) },
       scrollWidth: box.scrollWidth,
       clientWidth: box.clientWidth,
       display: cs.display,
       flexWrap: cs.flexWrap,
       columnGap: cs.columnGap,
     };
   })())`;

const cellExpr = (title) => `(() => {
  const tr = ${rowByTitle(title)};
  if (tr === undefined) return null;
  const direct = tr.querySelector('[data-testid="pm-table-tag-cell"]');
  if (direct !== null) return direct;
  const index = ${TAG_COL_INDEX};
  if (index < 0) return null;
  return tr.children[index] ?? null;
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac31-'));
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
    await prefs({ 'pm-theme': 'light', 'pm-pin-favorites': '0', 'pm-use-sort': 'custom', 'pm-view-mode': 'table' });

    const splitByTitle = (title) =>
      `[...document.querySelectorAll('[data-testid="pm-split-item"]')].find((el) => el.innerText.includes(${JSON.stringify(title)}))`;
    const openDetailByTitle = async (title) => {
      await cdp.waitFor(`${splitByTitle(title)} !== undefined`, `分栏条目「${title}」`);
      await cdp.realClickOf(splitByTitle(title), 1000);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail"]')`, '详情面');
      await sleep(600);
    };

    if (mode === 'tags-ui') {
      // ---------- AC-87 ① / ③：表格视图多标签行 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await cdp.waitFor(`${rowByTitle('AC31 三标签夹具')} !== undefined`, '三标签行');
      await sleep(700);

      out.ac87_tag_col_index = await cdp.evaluate(`String(${TAG_COL_INDEX})`);
      out.ac87_table_multi = await cdp.evaluate(gapsOf(cellExpr('AC31 三标签夹具')));
      out.ac87_table_many = await cdp.evaluate(gapsOf(cellExpr('AC31 多标签夹具')));
      // ③ 列宽：表头「标签」列宽度（与配置的 width:128 对照）
      out.ac87_tag_header_rect = await cdp.evaluate(
        `JSON.stringify((() => { const ths = [...document.querySelectorAll('[data-testid="pm-view-table"] thead th')]; const th = ths.find((el) => el.innerText.trim() === '标签'); if (th === undefined) return null; const r = th.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(r.right), inlineStyle: th.style.width, colWidth: th.colSpan === 0 ? null : null }; })())`,
      );
      // ③ 行高对照：无标签行 / 单标签行 / 多标签行的 tr 高度（证明空标签容器不占位、不撑高）
      out.ac87_row_heights = await cdp.evaluate(
        `JSON.stringify((() => {
           const pick = (title) => { const tr = [...document.querySelectorAll('[data-testid="pm-view-table"] tbody tr')].find((el) => !el.classList.contains('ant-table-measure-row') && el.innerText.includes(title)); return tr === undefined ? null : Math.round(tr.getBoundingClientRect().height); };
           return { none: pick('AC31 无标签夹具'), single: pick('AC31 单标签夹具'), multi: pick('AC31 三标签夹具'), many: pick('AC31 多标签夹具') };
         })())`,
      );
      out.ac87_doc_overflow = await cdp.evaluate(
        `JSON.stringify({ docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth })`,
      );
      await cdp.shot('01-table-tags-light');

      // ---------- AC-87 ④：单标签 / 无标签不受影响 ----------
      out.ac87_table_single = await cdp.evaluate(gapsOf(cellExpr('AC31 单标签夹具')));
      out.ac87_table_none = await cdp.evaluate(gapsOf(cellExpr('AC31 无标签夹具')));

      // ---------- AC-87 ②：卡片视图同一 prompt 的标签间隙 ----------
      await prefs({ 'pm-view-mode': 'card' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-card"]')`);
      await cdp.waitFor(`document.querySelector('[data-testid="pm-card-footer-${MULTI_ID}"]') !== null`, '三标签卡片');
      await sleep(700);
      const cardOf = `(() => { const footer = document.querySelector('[data-testid="pm-card-footer-${MULTI_ID}"]'); return footer === null ? null : footer.closest('[data-testid="pm-use-card"]'); })()`;
      out.ac87_card_multi = await cdp.evaluate(gapsOf(cardOf));
      await cdp.shot('02-card-tags-light');

      // ---------- AC-87 ⑤：暗色截图（多标签行） ----------
      await prefs({ 'pm-theme': 'dark', 'pm-view-mode': 'table' });
      await navigate(`!!document.querySelector('[data-testid="pm-view-table"]')`);
      await cdp.waitFor(`${rowByTitle('AC31 三标签夹具')} !== undefined`, '暗色三标签行');
      await sleep(600);
      await cdp.shot('03-table-tags-dark');
      out.ac27_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ---------- AC-88 ⑧：版本面板的保留策略文案 ----------
      await prefs({ 'pm-view-mode': 'split' });
      await navigate(`!!document.querySelector('[data-testid="pm-split-list"]')`);
      await openDetailByTitle('AC31 版本夹具');
      await cdp.waitFor(`document.querySelector('[data-testid="pm-version-retention-note"]') !== null`, '保留策略文案');
      await sleep(400);
      out.ac88_note_text = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-version-retention-note"]'); if (el === null) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { text: el.innerText.trim(), visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', width: Math.round(r.width), height: Math.round(r.height), color: cs.color, fontSize: cs.fontSize }; })())`,
      );
      // 回归：版本列表 / 回滚入口 / 视图切换仍在 —— 默认视图是「对比版本」（无回滚按钮），
      // 所以先用**真鼠标**点 Segmented 的「表格」，再数回滚入口。
      out.ac88_version_regression_compare = await cdp.evaluate(
        `JSON.stringify({ viewSwitcher: document.querySelector('[data-testid="pm-version-views"]') !== null, noteVisible: document.querySelector('[data-testid="pm-version-retention-note"]') !== null })`,
      );
      await cdp.shot('04-version-retention-note-light');
      const tableSegment = `[...document.querySelectorAll('[data-testid="pm-version-views"] .ant-segmented-item')].find((el) => el.innerText.trim() === '表格')`;
      await cdp.realClickOf(tableSegment, 700);
      await cdp.waitFor(`document.querySelectorAll('[data-testid^="rollback-"]').length > 0`, '版本表格回滚入口');
      out.ac88_version_regression = await cdp.evaluate(
        `JSON.stringify({ rollbackButtons: document.querySelectorAll('[data-testid^="rollback-"]').length, viewSwitcher: document.querySelector('[data-testid="pm-version-views"]') !== null, versionRows: document.querySelectorAll('[data-testid^="rollback-"]').length, noteStillVisible: document.querySelector('[data-testid="pm-version-retention-note"]') !== null })`,
      );
      await cdp.shot('05-version-table-light');
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
