#!/usr/bin/env node
/**
 * 阶段 42 运行时探针（**真浏览器** + 真鼠标；CDP）：FR-103 的界面部分（AC-105 ⑧ 与 ⑦ 的界面半）
 *
 *   scope <baseUrl> <sid> <shotsDir>
 *     · 令牌抽屉：新建处有权限选择且**默认只读**（读它的显示值）
 *     · **真鼠标新建令牌、不动权限选项** → 记录新建行的 id（供脚本查库断言 = read）
 *     · 列表「状态」列文本 == `有效 · 只读`（新行）与 `有效 · 读写`（既有 write 行）
 *     · **列数仍是 6**（列头顺序不变）
 *     · 亮 / 暗各一张截图
 *
 * 环境变量：AC105_WRITE_ID（脚本预先用接口建的 write 令牌 id，用来验 `有效 · 读写`）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['scope'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage42-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage42';
const WRITE_ID = process.env['AC105_WRITE_ID'] ?? '0';
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

const NAME_INPUT = `document.querySelector('[data-testid="pm-token-name"]')`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac42-'));
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
    // 权限选择控件存在且**默认只读**
    out.scope_select_present = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-scope"]') !== null`);
    // ⚠️ antd 6 的 Select 把选中项渲染在 `.ant-select-content`（不是 antd 5 的 `.ant-select-selection-item`）
    out.scope_default_text = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-scope"] .ant-select-content')?.innerText.trim() ?? null`,
    );
    // 真鼠标展开下拉，读两个档位，再按 Esc 收起（不改变当前选中值）
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-scope"]')`, 600);
    out.scope_options = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')].map((el) => el.innerText.trim()))`,
    );
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
    out.scope_default_after_close = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-scope"] .ant-select-content')?.innerText.trim() ?? null`,
    );
    // 既有 write 令牌的状态列
    out.write_row_state = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-state-${WRITE_ID}"]')?.innerText.trim() ?? null`,
    );
    const rowsBefore = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    out.rows_before = rowsBefore;

    // **真鼠标新建、不动权限选项** ⇒ 期望落到 read（脚本查库确认）
    await cdp.clearInput(NAME_INPUT);
    await cdp.evaluate(`(() => { const el = ${NAME_INPUT}; el.focus(); return true; })()`);
    await cdp.send('Input.insertText', { text: 'AC105 界面默认权限' });
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-create"]')`, 1800);
    out.toast_after_create = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    await cdp.waitFor(
      `document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length === ${String(rowsBefore + 1)}`,
      '列表出现新行',
      20_000,
    );
    // 新行 = 名称匹配的那一行的状态列文本
    out.new_row_state = await cdp.evaluate(`(() => {
      const tr = [...document.querySelectorAll('.pm-tokens tbody tr.ant-table-row')]
        .find((row) => row.innerText.includes('AC105 界面默认权限'));
      if (tr === undefined) return null;
      const tag = tr.querySelector('[data-testid^="pm-token-state-"]');
      return tag === null ? null : tag.innerText.trim();
    })()`);
    out.new_row_testid = await cdp.evaluate(`(() => {
      const tr = [...document.querySelectorAll('.pm-tokens tbody tr.ant-table-row')]
        .find((row) => row.innerText.includes('AC105 界面默认权限'));
      const tag = tr?.querySelector('[data-testid^="pm-token-state-"]');
      return tag === null || tag === undefined ? null : tag.getAttribute('data-testid');
    })()`);
    out.rows_after = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    await cdp.shot('01-token-scope-light');

    // 暗色截图
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','dark'); true`);
    await cdp.send('Page.reload');
    await sleep(2500);
    await openDrawer();
    out.dark_new_row_state = await cdp.evaluate(`(() => {
      const tr = [...document.querySelectorAll('.pm-tokens tbody tr.ant-table-row')]
        .find((row) => row.innerText.includes('AC105 界面默认权限'));
      const tag = tr?.querySelector('[data-testid^="pm-token-state-"]');
      return tag === null || tag === undefined ? null : tag.innerText.trim();
    })()`);
    await cdp.shot('02-token-scope-dark');

    out.ac42_runtime_errors = JSON.stringify(cdp.errors);
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
