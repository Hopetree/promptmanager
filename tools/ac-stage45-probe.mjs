#!/usr/bin/env node
/**
 * 阶段 45 运行时探针（**真浏览器 + 真实视口**；CDP）：FR-107「移动端令牌表不丢列」（AC-109 ①②③④⑤）
 *
 *   mobile  <baseUrl> <sid> <shotsDir>   —— 390×844
 *     · **先等抽屉滑入动画结束**（`drawer.getBoundingClientRect().left === 0`，再给 300ms 稳定期）—— AC-109 ① 明示要求
 *     · 逐列量首行 td 的 `getBoundingClientRect()`：6 个宽度、`thead th` 文本数组
 *     · 初始（最左）：名称列 left/right；滚到最右：操作列 right
 *     · 首行名称单元格文本（与 API 的 name 比对，AC-109 ③）
 *     · `document.documentElement.scrollWidth`
 *     · 截图：最左 + 最右
 *
 *   desktop <baseUrl> <sid> <shotsDir>   —— 1600×900（不得回归）
 *     · 抽屉 640、表格 scrollWidth === clientWidth、6 列宽度全 > 0、名称列完整（无省略号）
 *     · 真鼠标点状态列改权限（只读 → 读写 → 改回）
 *     · 截图
 *
 * 环境变量：AC109_READ_ID（有效只读令牌 id）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['mobile', 'desktop'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage45-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? `tmp/shots/stage45/${mode}`;
const READ_ID = process.env['AC109_READ_ID'] ?? '0';
const VIEWPORT = mode === 'mobile' ? { width: 390, height: 844 } : { width: 1600, height: 900 };
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

const SCROLLER = `(document.querySelector('.pm-tokens .ant-table-content') ?? document.querySelector('.pm-tokens .ant-table-container'))`;
const menuItems = `[...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')]`;

/**
 * 逐列几何：6 个 td 的 left/right/width + 表头文本 + 首行名称单元格文本。
 * ⚠️ `??` 必须加括号（`a ?? b === c` 会解析成 `a ?? (b === c)`，阶段 43 踩过）。
 */
const COLUMNS_GEO = `(() => {
  const drawer = document.querySelector('.pm-tokens .ant-drawer-content-wrapper') ?? document.querySelector('.pm-tokens .ant-drawer-content');
  const scroller = ${SCROLLER};
  const d = drawer.getBoundingClientRect();
  const heads = [...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim());
  const row = document.querySelector('.pm-tokens tbody tr.ant-table-row');
  const cells = row === null ? [] : [...row.querySelectorAll('td')];
  const rects = cells.map((td) => {
    const r = td.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  });
  const nameCell = cells[0];
  return JSON.stringify({
    innerWidth: window.innerWidth,
    drawerLeft: Math.round(d.left),
    drawerRight: Math.round(d.right),
    drawerWidth: Math.round(d.width),
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    scrollLeft: Math.round(scroller.scrollLeft),
    heads,
    rects,
    widths: rects.map((r) => r.width),
    nameText: nameCell === undefined ? null : nameCell.innerText.trim(),
    nameTextFull: nameCell === undefined ? null : (nameCell.querySelector('span')?.getAttribute('title') ?? nameCell.innerText.trim()),
    docScrollWidth: document.documentElement.scrollWidth,
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac45-'));
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
    if (port === null || Number.isNaN(port)) throw new Error('chrome 未写出 DevToolsActivePort');
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: mode === 'mobile',
    });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });

    /** 打开抽屉，并**等到滑入动画结束**（AC-109 ① 的硬要求）。 */
    const openDrawer = async () => {
      // `pm-brand-mark` 两种视口都在（`pm-brand-text` 是桌面专属，阶段 44 踩过）
      await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-mark"]') !== null`, '主界面');
      await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
        900,
      );
      await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
      /**
       * ⚠️ **必须等动画结束**：抽屉滑入期间 `getBoundingClientRect()` 量到的是中间态
       * （阶段 44 的验收就被这一点坑过）。
       * 判据不能写死"左边缘 == 0"：**桌面抽屉靠右停靠（left = 视口宽 − 640）**，只有移动端才占满视口。
       * 正确判据 = 抽屉**宽度已到位**且**左边缘不再变化**（连续两帧相同）—— 两种视口都成立。
       */
      await cdp.waitFor(
        `(() => {
          const d = document.querySelector('.pm-tokens .ant-drawer-content-wrapper');
          if (d === null) return false;
          const left = Math.round(d.getBoundingClientRect().left);
          const same = window.__pm45_left === left;
          window.__pm45_left = left;
          return same;
        })()`,
        '抽屉滑入动画结束（左边缘连续两帧相同）',
        15_000,
      );
      await sleep(300); // 再给一段稳定期，避开 transform 的最后一帧
    };

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(500);
    await openDrawer();

    out.viewport = `${String(VIEWPORT.width)}x${String(VIEWPORT.height)}`;
    out.drawer_animation_settled_left = await cdp.evaluate(
      `Math.round(document.querySelector('.pm-tokens .ant-drawer-content-wrapper').getBoundingClientRect().left)`,
    );
    out.doc_scroll_width = await cdp.evaluate(`document.documentElement.scrollWidth`);
    out.rows = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    out.alert_text_has_stars = await cdp.evaluate(
      `(document.querySelector('.pm-tokens .ant-alert-description')?.innerText ?? '').includes('**')`,
    );

    // ---- 初始（最左）逐列几何 ----
    out.geo_left = await cdp.evaluate(COLUMNS_GEO);
    if (mode === 'mobile') await cdp.shot('01-mobile-left');

    if (mode === 'mobile') {
      // ---- 滚到最右 ----
      out.scroll_applied = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 9999; return s.scrollLeft; })()`);
      out.geo_right = await cdp.evaluate(COLUMNS_GEO);
      await cdp.shot('02-mobile-right');
      // 滚回最左（截图/量值都取最左态）
      out.scroll_back = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 0; return s.scrollLeft; })()`);
      out.geo_left_again = await cdp.evaluate(COLUMNS_GEO);
    } else {
      out.scope_text_before = await cdp.evaluate(
        `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
      );
      // 真鼠标点状态列 → 读写 → 读回 → 改回只读
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
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 700);
      out.menu_items = await cdp.evaluate(`JSON.stringify(${menuItems}.map((el) => el.innerText.trim()))`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
      out.up_attempts = await pick('读写', '有效 · 读写');
      out.scope_text_after = await cdp.evaluate(
        `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
      );
      await cdp.shot('01-desktop-scope-write');
      out.down_attempts = await pick('只读', '有效 · 只读');
      out.scope_text_restored = await cdp.evaluate(
        `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
      );
      out.geo_after_scope_change = await cdp.evaluate(COLUMNS_GEO);
    }

    out.runtime_errors = JSON.stringify(cdp.errors);
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
