#!/usr/bin/env node
/**
 * 阶段 44 运行时探针（**真浏览器 + 真实视口**；CDP）：FR-106 的移动端可用性（AC-108 ①②③④⑤）
 *
 *   mobile  <baseUrl> <sid> <shotsDir>   —— 390×844（手机）
 *     · 量表格 `scrollWidth / clientWidth`（**确有溢出**）
 *     · 把可滚动容器的 `scrollLeft` 设成 9999 → **读回实际值**（必须 > 0 ⇒ 真的能滚）
 *     · 滚到最右：量「操作」列（`.ant-table-cell-fix-*` 无、按最后一列单元格）右边缘 ≤ 抽屉右边缘
 *     · 滚回 0：量「名称」列左边缘 ≥ 抽屉左边缘
 *     · 量名称输入框 `getBoundingClientRect().width`（≥ 120）
 *     · 真鼠标点「创建 token」（表单在上面，创建后会多一行，顺带证明控件可用）
 *     · Alert 文案里 `**` 出现次数 = 0；`document.documentElement.scrollWidth === 390`
 *     · 亮色截图
 *
 *   desktop <baseUrl> <sid> <shotsDir>   —— 1600×900（桌面，**不得回归**）
 *     · 抽屉宽 == 640；表格 `scrollWidth === clientWidth`（无横滚）
 *     · 列头仍 6 列同序；**真鼠标点状态列改权限**（只读 → 读写 → 改回），并读回 DOM 文本
 *     · 亮色截图
 *
 * 环境变量：AC108_READ_ID（一把有效只读令牌 id，桌面档用来验"点状态列改权限仍可用"）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['mobile', 'desktop'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage44-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? `tmp/shots/stage44/${mode}`;
const READ_ID = process.env['AC108_READ_ID'] ?? '0';
/** 手机：390×844（与 host_manger 实测同款）；桌面：1600×900 */
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
  async clearInput(jsExpr) {
    await this.evaluate(`(() => { const el = ${jsExpr}; el.focus(); el.select(); return true; })()`);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await sleep(200);
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

/** 表格的**可滚动容器**：给了 `scroll.x` 后 antd 渲染的 `.ant-table-content`（回退到 container）。 */
const SCROLLER = `(document.querySelector('.pm-tokens .ant-table-content') ?? document.querySelector('.pm-tokens .ant-table-container'))`;
const NAME_INPUT = `document.querySelector('[data-testid="pm-token-name"]')`;
const menuItems = `[...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')]`;

/**
 * 量一次表格的几何：容器与抽屉的 `scrollWidth/clientWidth` + 首列左边缘 + 末列右边缘。
 * ⚠️ 括号必须给足：`a ?? b === c` 会解析成 `a ?? (b === c)`（阶段 43 踩过这个坑）。
 */
const GEO = `(() => {
  const drawer = document.querySelector('.pm-tokens .ant-drawer-content-wrapper') ?? document.querySelector('.pm-tokens .ant-drawer-content');
  const body = document.querySelector('.pm-tokens .ant-drawer-body');
  const scroller = ${SCROLLER};
  const d = drawer.getBoundingClientRect();
  // 首行单元格：不用 :first-child（antd 的行不是父元素第一个子节点，匹配不到）⇒ 取首行的全部 td
  const row = document.querySelector('.pm-tokens tbody tr.ant-table-row');
  const cells = row === null ? [] : [...row.querySelectorAll('td')];
  const first = cells[0]?.getBoundingClientRect() ?? null;
  const last = cells[cells.length - 1]?.getBoundingClientRect() ?? null;
  return JSON.stringify({
    innerWidth: window.innerWidth,
    drawerWidth: Math.round(d.width),
    drawerLeft: Math.round(d.left),
    drawerRight: Math.round(d.right),
    bodyWidth: Math.round(body.getBoundingClientRect().width),
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    overflow: scroller.scrollWidth - scroller.clientWidth,
    canScroll: getComputedStyle(scroller).overflowX,
    scrollLeft: Math.round(scroller.scrollLeft),
    firstLeft: first === null ? null : Math.round(first.left),
    firstRight: first === null ? null : Math.round(first.right),
    lastLeft: last === null ? null : Math.round(last.left),
    lastRight: last === null ? null : Math.round(last.right),
    docScrollWidth: document.documentElement.scrollWidth,
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac44-'));
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

    const openDrawer = async () => {
      /**
       * 就绪判据用 `pm-brand-mark`（顶栏 Logo，两种视口都在）——
       * ⚠️ `pm-brand-text` 是**桌面专属**（`AppHeader` 里 `{!isMobile && …}`）⇒ 手机档等它会永远超时。
       */
      await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-mark"]') !== null`, '主界面');
      await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
        900,
      );
      await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
      await sleep(500);
    };

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(500);
    await openDrawer();

    out.viewport = `${String(VIEWPORT.width)}x${String(VIEWPORT.height)}`;
    out.innerWidth = await cdp.evaluate(`window.innerWidth`);
    // 列头（两种视口都必须仍是 6 列且顺序不变）
    out.heads = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim()))`,
    );
    out.rows = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    out.alert_text_has_stars = await cdp.evaluate(
      `(document.querySelector('.pm-tokens .ant-alert-description')?.innerText ?? '').includes('**')`,
    );
    out.alert_description = await cdp.evaluate(
      `document.querySelector('.pm-tokens .ant-alert-description')?.innerText.trim() ?? null`,
    );
    out.doc_scroll_width = await cdp.evaluate(`document.documentElement.scrollWidth`);

    // --- 表单几何（两种视口都量：移动端要 ≥120px，桌面要仍是 inline 一行） ---
    out.name_input_width = await cdp.evaluate(
      `(() => { const el = ${NAME_INPUT}; return el === null ? null : Math.round(el.getBoundingClientRect().width); })()`,
    );
    out.scope_select_in_view = await cdp.evaluate(
      `(document.querySelector('[data-testid="pm-token-scope"]')?.getBoundingClientRect().right ?? 1e9) <= window.innerWidth`,
    );
    out.create_button_in_view = await cdp.evaluate(
      `(document.querySelector('[data-testid="pm-token-create"]')?.getBoundingClientRect().right ?? 1e9) <= window.innerWidth`,
    );
    out.form_layout = await cdp.evaluate(
      `document.querySelector('.pm-tokens form')?.className.includes('ant-form-vertical') === true ? 'vertical' : 'inline'`,
    );

    if (mode === 'mobile') {
      // ---- AC-108 ①：溢出 + 能滚 + 两端列可达 ----
      out.geo_before = await cdp.evaluate(GEO);
      // 把滚动位置设成很大的值，读回**实际**值
      out.scroll_applied = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 9999; return s.scrollLeft; })()`);
      out.scroll_max = await cdp.evaluate(`(() => { const s = ${SCROLLER}; return s.scrollWidth - s.clientWidth; })()`);
      out.geo_right = await cdp.evaluate(GEO);
      await cdp.shot('01-mobile-scrolled-right');
      // 滚回最左
      out.scroll_back = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 0; return s.scrollLeft; })()`);
      out.geo_left = await cdp.evaluate(GEO);
      await cdp.shot('02-mobile-scrolled-left');

      // ---- ② 表单可用：真鼠标新建一行（不动权限选项） ----
      const rowsBefore = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
      out.rows_before_create = rowsBefore;
      await cdp.clearInput(NAME_INPUT);
      await cdp.evaluate(`(() => { const el = ${NAME_INPUT}; el.focus(); return true; })()`);
      await cdp.send('Input.insertText', { text: 'AC108 手机建' });
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-create"]')`, 1800);
      out.created = await cdp.waitForSoft(
        `document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length === ${String(rowsBefore + 1)}`,
        15_000,
      );
      out.rows_after_create = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
      await cdp.shot('03-mobile-after-create');
    } else {
      // ---- AC-108 ⑤：桌面不回归 ----
      out.geo_desktop = await cdp.evaluate(GEO);
      out.scroll_applied_desktop = await cdp.evaluate(`(() => { const s = ${SCROLLER}; s.scrollLeft = 9999; return s.scrollLeft; })()`);
      out.scope_text_before = await cdp.evaluate(
        `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
      );
      out.column_widths = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('.pm-tokens thead th')].map((th) => Math.round(th.getBoundingClientRect().width)))`,
      );
      // 真鼠标点状态列 → 选「读写」→ 读回
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 700);
      out.menu_items = await cdp.evaluate(`JSON.stringify(${menuItems}.map((el) => el.innerText.trim()))`);
      await cdp.realClickOf(
        `${menuItems}.find((el) => el.innerText.trim() === '读写')`,
        400,
      );
      await cdp.waitForSoft(
        `(document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null) === '有效 · 读写'`,
        8_000,
      );
      out.scope_text_after = await cdp.evaluate(
        `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
      );
      await cdp.shot('01-desktop-scope-write');
      // 改回只读
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 700);
      await cdp.realClickOf(`${menuItems}.find((el) => el.innerText.trim() === '只读')`, 400);
      await cdp.waitForSoft(
        `(document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null) === '有效 · 只读'`,
        8_000,
      );
      out.scope_text_restored = await cdp.evaluate(
        `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.innerText.trim() ?? null`,
      );
      out.geo_desktop_after = await cdp.evaluate(GEO);
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
