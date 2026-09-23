#!/usr/bin/env node
/**
 * 阶段 47 运行时探针（真浏览器 + 真实视口；CDP）
 *
 *   versions <baseUrl> <sid> <shotsDir>
 *     · 打开一个**已有 3 个版本**的 prompt 详情 → 版本历史默认落在「对比版本」
 *     · 读 diff 头部的 `--- vN` / `+++ vM`（证明默认是"上一版 ↔ 最新"）
 *     · 读两个下拉的当前值
 *     · 手动把 from 改成更早的版本 → diff 头部随之变化（AC-111 ③）
 *     · 切「表格 / 详情」视图正常（AC-111 ④）
 *
 *   tokens <baseUrl> <sid> <shotsDir>
 *     · PC 1600×900：抽屉宽、表格 scrollWidth/clientWidth、7 列表头文本与逐列宽度、创建时间 vs 最近使用文本
 *     · 移动 390×844：**等抽屉滑入动画结束（连续两次采样位置相同）** 后量 7 列宽度、首列表头、
 *       scrollLeft 0→max、两端列可见性
 *     · 真鼠标点「状态」列改权限并读回（AC-112 ⑤）
 *     · 两档各一张截图
 *
 * 环境变量：AC112_READ_ID（有效只读令牌 id，用于改权限）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['versions', 'tokens'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage47-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? `tmp/shots/stage47/${mode}`;
const READ_ID = process.env['AC112_READ_ID'] ?? '0';
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
  async waitForSoft(expression, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return true;
      if (Date.now() > deadline) return false;
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

/** 版本面板：diff 头部 + 两个下拉当前值 + 视图。 */
const VERSIONS_GEO = `(() => {
  // 版本面板锚点：编辑器里有 pm-panel-versions 这个锚点；详情页里没有（详情页直接内联 VersionPanel）
  // ⇒ 退化为整个 pm-detail。⚠️ 注释里不要写反引号（会截断外层模板串，阶段 45 踩过）。
  const anchor = document.querySelector('[data-testid="pm-panel-versions"]');
  const panel = anchor ?? document.querySelector('[data-testid="pm-detail"]') ?? document.body;
  const pre = panel.querySelector('pre');
  const txt = pre === null ? '' : pre.innerText;
  const from = /---\\s*v(\\d+)/.exec(txt);
  const to = /\\+\\+\\+\\s*v(\\d+)/.exec(txt);
  const selects = [...panel.querySelectorAll('.ant-select')];
  const selText = selects.map((s) => (s.querySelector('.ant-select-content') ?? s).innerText.trim());
  const tabs = [...panel.querySelectorAll('.ant-radio-button-wrapper, .ant-segmented-item')].map((el) => el.innerText.trim());
  return JSON.stringify({
    diffHead: pre === null ? null : txt.split('\\n').slice(0, 2).join('\\n'),
    fromVersion: from === null ? null : Number(from[1]),
    toVersion: to === null ? null : Number(to[1]),
    selectValues: selText,
    tabs,
    diffText: txt.slice(0, 200),
    errText: (panel.querySelector('.ant-alert-error')?.innerText ?? null),
  });
})()`;

/** 版本面板选择器：编辑器用锚点，详情页退化为 `pm-detail`。 */
const PANEL_SEL = `:is([data-testid="pm-panel-versions"], [data-testid="pm-detail"])`;
/**
 * 对比行的两个下拉：**按"文本为 对比 的那个 Flex 行"**定位，再取行内的两个 .ant-select
 * （比按宽度筛更稳 —— 详情页里还有别的 110px 宽 Select）。
 */
const COMPARE_ROW = `[...document.querySelectorAll('${PANEL_SEL} .ant-flex')].find((f) => (f.innerText || '').startsWith('对比'))`;
const COMPARE_SELECTS = `[...((${COMPARE_ROW})?.querySelectorAll('.ant-select') ?? [])]`;

const SCROLLER = `(document.querySelector('.pm-tokens .ant-table-content') ?? document.querySelector('.pm-tokens .ant-table-container'))`;
const menuItems = `[...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')]`;

const TOKENS_GEO = `(() => {
  const drawer = document.querySelector('.pm-tokens .ant-drawer-content-wrapper') ?? document.querySelector('.pm-tokens .ant-drawer-content');
  const scroller = ${SCROLLER};
  const d = drawer.getBoundingClientRect();
  const heads = [...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim());
  const row = document.querySelector('.pm-tokens tbody tr.ant-table-row');
  const cells = row === null ? [] : [...row.querySelectorAll('td')];
  const rects = cells.map((td) => { const r = td.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; });
  return JSON.stringify({
    innerWidth: window.innerWidth,
    drawerWidth: Math.round(d.width),
    drawerLeft: Math.round(d.left),
    drawerRight: Math.round(d.right),
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    scrollLeft: Math.round(scroller.scrollLeft),
    heads,
    rects,
    widths: rects.map((r) => r.width),
    createdText: cells[4]?.innerText.trim() ?? null,
    lastUsedText: cells[5]?.innerText.trim() ?? null,
    stateText: document.querySelector('[data-testid^="pm-token-state-"]')?.innerText.trim() ?? null,
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const isMobile = mode === 'tokens' && process.env['AC112_VIEWPORT'] === 'mobile';
  const VIEWPORT = isMobile ? { width: 390, height: 844 } : { width: 1600, height: 900 };
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac47-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', `--window-size=${String(VIEWPORT.width)},${String(VIEWPORT.height)}`,
      '--user-data-dir=' + userDataDir, '--remote-debugging-port=0', 'about:blank'],
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: isMobile,
    });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-mark"]') !== null`, '主界面');

    if (mode === 'versions') {
      // 点开**三版本**那条 prompt（按标题定位 —— 列表里还有单版本夹具，取第一条会选错）
      // 桌面默认 split 视图 ⇒ 列表项是 `pm-split-item`
      await cdp.waitFor(`document.querySelector('[data-testid="pm-split-item"]') !== null`, 'prompt 列表（split）');
      const target = process.env['AC111_TITLE'] ?? 'AC111 三版本';
      await cdp.realClickOf(
        `[...document.querySelectorAll('[data-testid="pm-split-item"]')].find((el) => (el.innerText || '').includes(${JSON.stringify(target)}))`,
        1500,
      );
      // 详情页里版本面板内联在 `pm-detail` 中：等到出现 diff 的 <pre>（默认对比视图）为止
      await cdp.waitFor(
        `(document.querySelector('[data-testid="pm-panel-versions"]') !== null) || (document.querySelector('[data-testid="pm-detail"] pre') !== null)`,
        '版本面板 / diff 出现',
      );
      await sleep(900);
      out.geo_default = await cdp.evaluate(VERSIONS_GEO);
      await cdp.shot('01-versions-default');

      // AC-111 ③：手动把 from 改成更早的版本 —— 打开对比行的 **第一个** 下拉（from）
      out.compare_select_count = await cdp.evaluate(`${COMPARE_SELECTS}.length`);
      await cdp.realClickOf(`${COMPARE_SELECTS}[0]`, 700);
      out.from_options = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')].map((el) => el.innerText.trim()))`,
      );
      // 选最小的那个（选项升序 ⇒ 第一项 = v1）
      await cdp.realClickOf(
        `document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')[0]`,
        900,
      );
      // 下拉改完需要点「查看 diff」才会重算（既有交互：onChange 只 setFrom，重算在按钮上）
      const panelBtn = `[...document.querySelectorAll('${PANEL_SEL} button')]`;
      out.has_view_diff_button = await cdp.evaluate(`${panelBtn}.some((b) => b.innerText.includes('查看 diff'))`);
      await cdp.realClickOf(`${panelBtn}.find((b) => b.innerText.includes('查看 diff'))`, 1500);
      out.geo_manual = await cdp.evaluate(VERSIONS_GEO);
      await cdp.shot('02-versions-manual');

      // AC-111 ④：切「表格」「详情」视图
      await cdp.realClickOf(
        `[...document.querySelectorAll('${PANEL_SEL} .ant-radio-button-wrapper, ${PANEL_SEL} .ant-segmented-item')].find((el) => el.innerText.trim() === '表格')`,
        800,
      );
      out.table_rows = await cdp.evaluate(
        `document.querySelectorAll('${PANEL_SEL} .ant-table-row').length`,
      );
      await cdp.realClickOf(
        `[...document.querySelectorAll('${PANEL_SEL} .ant-radio-button-wrapper, ${PANEL_SEL} .ant-segmented-item')].find((el) => el.innerText.trim() === '详情')`,
        800,
      );
      out.detail_visible = await cdp.evaluate(
        `(document.querySelector('${PANEL_SEL}')?.innerText ?? '').length > 0`,
      );
      out.runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // 打开令牌抽屉
      await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
        900,
      );
      await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
      /**
       * ⚠️ **等抽屉滑入动画结束**：判据 = 左边缘**连续两次采样相同**（AC-112 ④ 明示要求）。
       * 桌面抽屉靠右停靠（left = 视口宽 − 抽屉宽），移动端占满视口 ⇒ 不能写死 == 0。
       */
      await cdp.waitFor(
        `(() => {
          const d = document.querySelector('.pm-tokens .ant-drawer-content-wrapper');
          if (d === null) return false;
          const left = Math.round(d.getBoundingClientRect().left);
          const same = window.__pm47_left === left;
          window.__pm47_left = left;
          return same;
        })()`,
        '抽屉滑入动画结束（左边缘连续两次采样相同）',
        15_000,
      );
      await sleep(300);
      out.settled_left = await cdp.evaluate(
        `Math.round(document.querySelector('.pm-tokens .ant-drawer-content-wrapper').getBoundingClientRect().left)`,
      );
      out.geo_left = await cdp.evaluate(TOKENS_GEO);
      out.doc_scroll_width = await cdp.evaluate(`document.documentElement.scrollWidth`);
      await cdp.shot(isMobile ? '01-tokens-mobile-left' : '01-tokens-pc');

      if (isMobile) {
        out.scroll_applied = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 9999; return s.scrollLeft; })()`);
        out.geo_right = await cdp.evaluate(TOKENS_GEO);
        await cdp.shot('02-tokens-mobile-right');
        out.scroll_back = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 0; return s.scrollLeft; })()`);
      } else {
        // AC-112 ⑤：真鼠标点状态列改权限并读回
        out.scope_before = await cdp.evaluate(
          `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
        );
        const pick = async (label, expect) => {
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 800);
            await cdp.realClickOf(`${menuItems}.find((el) => el.innerText.trim() === '${label}')`, 400);
            if (await cdp.waitForSoft(
              `(document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null) === '${expect}'`,
              8_000,
            )) return attempt;
          }
          return 0;
        };
        out.up_attempts = await pick('读写', '有效 · 读写');
        out.scope_after = await cdp.evaluate(
          `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
        );
        await cdp.shot('02-tokens-pc-scope-write');
        out.down_attempts = await pick('只读', '有效 · 只读');
        out.scope_restored = await cdp.evaluate(
          `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
        );
      }
      out.runtime_errors = JSON.stringify(cdp.errors);
    }
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
