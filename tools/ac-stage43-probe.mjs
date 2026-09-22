#!/usr/bin/env node
/**
 * 阶段 43 运行时探针（**真浏览器** + 真鼠标；CDP）：FR-105 的界面部分（AC-107 ⑥）
 *
 *   scope <baseUrl> <sid> <shotsDir>
 *     · 有效行：**真鼠标**点「状态」列的权限文本 → 弹菜单（只读 / 读写）→ 点「读写」
 *       ⇒ 该行文本 `有效 · 只读` → `有效 · 读写`，**不刷新页面**（页内哨兵变量仍在、location 未变）
 *     · 再点一次选回「只读」⇒ 文本变回 `有效 · 只读`
 *     · **已撤销行没有改权限入口**（点它不弹菜单、也没有 data-scope-editable）
 *     · **列头仍是 6 列**；抽屉**无横向滚动**（scrollWidth <= clientWidth）
 *     · 亮 / 暗截图
 *
 * 环境变量：AC107_READ_ID（有效只读令牌 id）/ AC107_WRITE_ID（有效读写令牌 id）/ AC107_REVOKED_ID（已撤销令牌 id）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['scope'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage43-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage43';
const READ_ID = process.env['AC107_READ_ID'] ?? '0';
const WRITE_ID = process.env['AC107_WRITE_ID'] ?? '0';
const REVOKED_ID = process.env['AC107_REVOKED_ID'] ?? '0';
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
  /** 软等待：超时不抛，返回是否等到（探针要"无论如何都把观测值打出来"，便于定位）。 */
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

/** 状态列里那一行的权限文本（按 data-testid 精确定位）。 */
const stateText = (id) => `document.querySelector('[data-testid="pm-token-state-${id}"]')?.innerText.trim() ?? null`;
/**
 * 该行权限文本是否等于期望值。
 * ⚠️ 必须给 `??` 加括号：`a ?? b === c` 会解析成 `a ?? (b === c)`（返回字符串而不是布尔），
 * 早期版本漏了括号 ⇒ 等待永远返回 false，探针会多点一次（重复 PATCH）。
 */
const stateIs = (id, text) => `(${stateText(id)}) === '${text}'`;
/** 展开的 Dropdown 菜单项（antd 把浮层挂在 body 上）。 */
const menuItems = `[...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')]`;
const menuItem = (label) => `${menuItems}.find((el) => el.innerText.trim() === '${label}')`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac43-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1440,900', '--user-data-dir=' + userDataDir, '--remote-debugging-port=0', 'about:blank'],
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });

    const openDrawer = async () => {
      await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面');
      await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
        900,
      );
      await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
      await sleep(400);
    };

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(400);
    await openDrawer();

    // 列头（必须仍是 6 列且顺序不变）
    out.heads = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim()))`,
    );
    // 抽屉不得出现横向滚动
    out.drawer_scroll = await cdp.evaluate(`(() => {
      const body = document.querySelector('.pm-tokens .ant-drawer-body');
      const table = document.querySelector('.pm-tokens .ant-table-content') ?? document.querySelector('.pm-tokens .ant-table-container');
      const overflow = (el) => (el === null ? 0 : el.scrollWidth - el.clientWidth);
      return JSON.stringify({ body: overflow(body), table: overflow(table) });
    })()`);

    // 改权限前的三行文本
    out.before_read_row = await cdp.evaluate(stateText(READ_ID));
    out.write_row_state = await cdp.evaluate(stateText(WRITE_ID));
    out.revoked_row_state = await cdp.evaluate(stateText(REVOKED_ID));
    // 有效行的入口特征：可点击标记 + 手型 + title 提示
    out.read_row_editable = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.getAttribute('data-scope-editable') ?? null`,
    );
    out.read_row_cursor = await cdp.evaluate(
      `getComputedStyle(document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')).cursor`,
    );
    out.read_row_title = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.getAttribute('title') ?? null`,
    );
    out.revoked_row_editable = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-state-${REVOKED_ID}"]')?.getAttribute('data-scope-editable') ?? null`,
    );

    // 页内哨兵：页面若被刷新，这个变量就没了（= 断言"不刷新页面"）
    await cdp.evaluate(`window.__pm43_mark = 'kept'; window.__pm43_url = location.href; true`);
    /**
     * 记录**浏览器真的发出了哪几个 PATCH**（含状态码）——这是"界面改权限"的关键证据：
     * 只断言"该行文本变了"还不够，必须证明它来自一次真请求（而不是纯前端假象）。
     */
    await cdp.evaluate(`(() => {
      window.__pm43_calls = [];
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        const method = (args[1] && args[1].method) || 'GET';
        if (method === 'PATCH' && String(url).includes('/api/tokens/')) window.__pm43_calls.push({ url: String(url), method, status: response.status });
        return response;
      };
      return true;
    })()`);

    /** 真鼠标：点该行权限文本 → 点菜单里的一项；等该行文本变成期望值（等不到就再真点一次）。 */
    const changeScopeByMouse = async (label, expectText, toastKey) => {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 800);
        await cdp.realClickOf(menuItem(label), 400);
        if (attempt === 1 && toastKey !== undefined) {
          // 提示只存在几秒 ⇒ 与"等该行文本"并行地尽快抓（取**最新**那条，容器里可能还留着上一条）
          out[toastKey] = null;
          for (let i = 0; i < 20 && out[toastKey] === null; i += 1) {
            out[toastKey] = await cdp.evaluate(
              `document.querySelector('.ant-message')?.innerText.trim().split('\\n').pop() ?? null`,
            );
            if (out[toastKey] === null) await sleep(100);
          }
        }
        if (await cdp.waitForSoft(stateIs(READ_ID, expectText), 8_000)) return attempt;
      }
      return 0;
    };

    // ① 真鼠标点有效行的权限文本 → 菜单弹出（读两项）
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 700);
    out.menu_items = await cdp.evaluate(`JSON.stringify(${menuItems}.map((el) => el.innerText.trim()))`);
    out.menu_open_selected = await cdp.evaluate(
      `JSON.stringify(${menuItems}.filter((el) => el.className.includes('ant-dropdown-menu-item-selected')).map((el) => el.innerText.trim()))`,
    );
    await cdp.shot('01-scope-menu-light');
    // 关掉这次为"读菜单"而打开的浮层（点空白处），避免影响下一步的真实点击
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);

    // ② 点「读写」→ 该行文本立即变成 有效 · 读写（且页面没有被刷新）
    out.up_attempts = await changeScopeByMouse('读写', '有效 · 读写', 'toast_up');
    out.after_read_row = await cdp.evaluate(stateText(READ_ID));
    out.all_state_rows = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-token-state-"]')].map((el) => el.innerText.trim()))`,
    );
    out.after_read_row_html = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')?.outerHTML ?? null`,
    );
    out.page_mark_alive = await cdp.evaluate(`window.__pm43_mark === 'kept'`);
    out.page_url_unchanged = await cdp.evaluate(`window.__pm43_url === location.href`);
    out.navigation_entries = await cdp.evaluate(`performance.getEntriesByType('navigation').length`);
    await cdp.shot('02-scope-changed-light');

    // ③ 再点一次选回「只读」→ 文本变回 有效 · 只读
    out.down_attempts = await changeScopeByMouse('只读', '有效 · 只读', 'toast_down');
    out.restored_read_row = await cdp.evaluate(stateText(READ_ID));
    out.page_mark_alive_after_restore = await cdp.evaluate(`window.__pm43_mark === 'kept'`);
    out.browser_patch_calls = await cdp.evaluate(`JSON.stringify(window.__pm43_calls)`);

    // ④ 已撤销行：点它不弹菜单（没有改权限入口）
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${REVOKED_ID}"]')`, 800);
    out.revoked_menu_after_click = await cdp.evaluate(`JSON.stringify(${menuItems}.map((el) => el.innerText.trim()))`);

    // 暗色截图（菜单打开状态）
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','dark'); true`);
    await cdp.send('Page.reload');
    await sleep(2500);
    await openDrawer();
    out.dark_read_row = await cdp.evaluate(stateText(READ_ID));
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-state-${READ_ID}"]')`, 700);
    out.dark_menu_items = await cdp.evaluate(`JSON.stringify(${menuItems}.map((el) => el.innerText.trim()))`);
    await cdp.shot('03-scope-menu-dark');

    out.ac43_runtime_errors = JSON.stringify(cdp.errors);
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
