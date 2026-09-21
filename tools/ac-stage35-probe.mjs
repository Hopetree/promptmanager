#!/usr/bin/env node
/**
 * 阶段 35 运行时探针（真鼠标 + 真实剪贴板；CDP）：
 *
 *   tokens <baseUrl> <sid> <shotsDir>
 *     AC-96 ⑥：打开「API 令牌」抽屉 → 对**可查看**那条真鼠标点「复制」→ 读回剪贴板，
 *               与 `AC35_EXPECT_TOKEN` 逐字比对（**只输出布尔与脱敏串，绝不打印明文**）；
 *               并断言**旧令牌**那条显示"不可查看"提示；截图一张。
 *
 * 需要的环境变量：
 *   AC35_EXPECT_TOKEN  期望复制到的明文（由 ac-stage35.sh 用会话 cookie 调 reveal 拿到后传入）
 *   AC35_LEGACY_ID     旧令牌（token_enc 已被置 NULL）的行 id，用于断言"不可查看"提示
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['tokens'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage35-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage35';
const EXPECT = process.env['AC35_EXPECT_TOKEN'] ?? '';
const LEGACY_ID = process.env['AC35_LEGACY_ID'] ?? '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));

/** 只输出脱敏串（前后各 4 字符），明文绝不进日志。 */
const mask = (value) => (value.length <= 10 ? `${value.slice(0, 2)}…(${String(value.length)}字符)` : `${value.slice(0, 6)}…${value.slice(-4)}`);

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

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac35-'));
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
    // 剪贴板权限（headless 下 readText 需要显式授权）
    await cdp.send('Browser.grantPermissions', {
      origin: baseUrl,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面');
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(700);

    // 真鼠标：⋯更多 → API 令牌
    await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
    await cdp.realClickOf(
      `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
      900,
    );
    await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
    await sleep(400);

    // 可查看那条：点「复制」（真鼠标）
    const copyBtn = `document.querySelector('[data-testid^="pm-token-copy-"]')`;
    out.copy_button_present = await cdp.evaluate(`(${copyBtn}) !== null`);
    await cdp.realClickOf(copyBtn, 900);
    out.clipboard = await cdp.evaluate(`navigator.clipboard.readText().then((t) => t).catch((e) => 'ERR:' + String(e))`);
    out.clipboard_masked = mask(String(out.clipboard));
    out.expected_masked = mask(EXPECT);
    out.clipboard_matches_expected = String(out.clipboard) === EXPECT && EXPECT !== '';

    // 旧令牌那条：应显示"不可查看"提示（而不是复制按钮）
    out.legacy_hint_present = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-unrevealable-${LEGACY_ID}"]') !== null`,
    );
    out.legacy_hint_text = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-unrevealable-${LEGACY_ID}"]')?.innerText.trim() ?? null`,
    );
    out.rows = await cdp.evaluate(`document.querySelectorAll('.pm-tokens .ant-drawer-body table tbody tr').length`);
    out.success_toast = await cdp.evaluate(
      `document.querySelector('.ant-message')?.innerText.trim() ?? null`,
    );
    await cdp.shot('01-token-drawer-copy');
    out.ac35_runtime_errors = JSON.stringify(cdp.errors);
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
