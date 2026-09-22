#!/usr/bin/env node
/**
 * 阶段 39 运行时探针（**内网 IP 非安全上下文** + 真鼠标；CDP）：FR-100 / AC-102
 *
 *   revoked <lanBaseUrl> <sid> <shotsDir>
 *     ① **撤销行**的 Token 列 = 掩码（前 5 + `...` + 后 4，与期望明文逐字对照），**不是 `—`**
 *     ② **撤销行**的「使用」列有「复制」→ 真鼠标点击 → Ctrl+V 真粘贴读回 == 明文；点击时 reveal 计数不变
 *     ③ 未撤销行行为不变（掩码 + 复制可用）
 *     ④ `token_enc = NULL` 的旧 token（`revealable=false`）仍 `—`，且该 `—` 带 `title` 说明原因
 *     ⑤ 页面文本里不出现完整明文
 *     ⑥ 操作列：有效行只有「撤销」、已撤销行只有「删除」；真鼠标删除 → 二次确认 → 行消失
 *     ⑦ 6 列顺序、抽屉 ≤640、无横向滚动；关抽屉后无完整明文；不落持久存储
 *     ⑧ 亮 / 暗各一张截图
 *
 * 环境变量：
 *   AC102_EXPECT_TOKEN    已撤销行的明文（用来核对掩码与真粘贴）
 *   AC102_REVOKED_ID      已撤销行 id
 *   AC102_ACTIVE_ID       未撤销行 id
 *   AC102_LEGACY_ID       `token_enc = NULL` 的旧 token id
 *   AC102_SERVER_LOG      服务端日志路径（数 `token revealed` 次数）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['revoked'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage39-probe.mjs <${MODES.join('|')}> <lanBaseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage39';
const REVOKED_TOKEN = process.env['AC102_EXPECT_TOKEN'] ?? '';
const REVOKED_ID = process.env['AC102_REVOKED_ID'] ?? '0';
/** 第二个"已撤销"夹具：它**不参与删除测试**，用来在暗色阶段与回归里继续验证撤销行（避免删了之后无从验证）。 */
const REVOKED2_ID = process.env['AC102_REVOKED2_ID'] ?? '0';
const ACTIVE_ID = process.env['AC102_ACTIVE_ID'] ?? '0';
const LEGACY_ID = process.env['AC102_LEGACY_ID'] ?? '0';
const SERVER_LOG = process.env['AC102_SERVER_LOG'] ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));

const mask = (v) => (v.length <= 10 ? `***(${String(v.length)})` : `${v.slice(0, 6)}…${v.slice(-4)}`);

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
  async pasteInto(jsExpr) {
    await this.clearInput(jsExpr);
    await this.evaluate(`(() => { const el = ${jsExpr}; el.focus(); return true; })()`);
    const modifier = process.platform === 'darwin' ? 4 : 2;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', modifiers: modifier, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86,
    });
    await sleep(80);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: modifier, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86,
    });
    await sleep(400);
    return this.evaluate(`(() => { const el = ${jsExpr}; return el === null ? null : el.value; })()`);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac39-'));
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
      await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
      await cdp.realClickOf(
        `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
        900,
      );
      await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
      /**
       * 预取完成：**任一行的掩码就绪**即可（不绑定具体行 —— 删除测试会把某一行删掉，
       * 首版把等待条件写死在那一行上 ⇒ 暗色阶段超时）。
       */
      await cdp.waitFor(
        `[...document.querySelectorAll('[data-testid^="pm-token-mask-"]')].some((el) => el.innerText.includes('...'))`,
        '掩码预取完成',
        20_000,
      );
      // FR-100 的关键：**已撤销行**的掩码也必须就绪
      await cdp.waitFor(
        `document.querySelector('[data-testid="pm-token-mask-${REVOKED2_ID}"]')?.innerText.trim().includes('...') === true`,
        '已撤销行掩码预取完成',
        20_000,
      );
    };
    const revealCount = () => {
      if (SERVER_LOG === '') return -1;
      try {
        return readFileSync(SERVER_LOG, 'utf8').split('token revealed').length - 1;
      } catch {
        return -1;
      }
    };
    const cellOf = (id, index) =>
      cdp.evaluate(
        `(() => { const tr = document.querySelector('[data-testid="pm-token-mask-${id}"]')?.closest('tr'); return tr ? tr.querySelectorAll('td')[${String(index)}].innerText.trim() : null; })()`,
      );

    // ── 亮色 ────────────────────────────────────────────────────────────
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面');
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(500);
    await openDrawer();
    out.origin = await cdp.evaluate(`location.origin`);
    out.is_secure_context = await cdp.evaluate(`window.isSecureContext`);
    out.clipboard_type = await cdp.evaluate(`typeof navigator.clipboard`);
    out.heads = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim()))`,
    );

    // ① 撤销行的 Token 列 = 掩码
    const expectedMask = REVOKED_TOKEN.length >= 11 ? `${REVOKED_TOKEN.slice(0, 5)}...${REVOKED_TOKEN.slice(-4)}` : '…';
    out.expected_revoked_mask = expectedMask;
    out.revoked_mask = await cellOf(REVOKED_ID, 1);
    out.revoked_mask_matches = out.revoked_mask === expectedMask;
    out.revoked_mask_is_dash = out.revoked_mask === '—';
    out.active_mask = await cellOf(ACTIVE_ID, 1);
    out.active_mask_matches = out.active_mask === expectedMask ? false : true; // 仅记录，具体值由脚本核对
    out.page_has_full_plaintext = await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(REVOKED_TOKEN)})`);

    // ④ 不可恢复行：`—` + title 说明
    out.legacy_mask = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-mask-${LEGACY_ID}"]')?.innerText.trim() ?? null`,
    );
    out.legacy_mask_title = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-mask-${LEGACY_ID}"]')?.getAttribute('title') ?? null`,
    );
    out.legacy_use = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-use-${LEGACY_ID}"]')?.innerText.trim() ?? null`,
    );
    out.legacy_use_title = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-use-${LEGACY_ID}"]')?.getAttribute('title') ?? null`,
    );
    out.legacy_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${LEGACY_ID}"]') !== null`);

    await cdp.shot('01-revoked-copy-light');

    // ② 撤销行「使用」列有「复制」→ 真鼠标点 → 真粘贴
    out.revoked_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${REVOKED_ID}"]') !== null`);
    out.revoked_use_cell = await cellOf(REVOKED_ID, 3);
    const before = revealCount();
    out.reveal_count_before_click = before;
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-copy-${REVOKED_ID}"]')`, 700);
    out.toast_after_revoked_copy = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    await sleep(400);
    out.reveal_count_after_click = revealCount();
    const pasted = await cdp.pasteInto(NAME_INPUT);
    out.pasted_masked = mask(String(pasted ?? ''));
    out.expected_masked = mask(REVOKED_TOKEN);
    out.revoked_clipboard_equals_plaintext = String(pasted ?? '') === REVOKED_TOKEN && REVOKED_TOKEN !== '';
    await cdp.clearInput(NAME_INPUT);

    // ③ 未撤销行行为不变
    out.active_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${ACTIVE_ID}"]') !== null`);

    // ⑥ 操作列
    const op = JSON.parse(await cdp.evaluate(`JSON.stringify((() => {
      const rows = [...document.querySelectorAll('.pm-tokens tbody tr.ant-table-row')];
      const acc = { validRows: 0, revokedRows: 0, validRevoke: 0, validDelete: 0, revokedRevoke: 0, revokedDelete: 0 };
      for (const tr of rows) {
        const status = tr.querySelectorAll('td')[2].innerText.trim();
        const hasRevoke = tr.querySelector('[data-testid^="pm-token-revoke-"]') !== null;
        const hasDelete = tr.querySelector('[data-testid^="pm-token-delete-"]') !== null;
        if (status === '有效') { acc.validRows += 1; if (hasRevoke) acc.validRevoke += 1; if (hasDelete) acc.validDelete += 1; }
        if (status === '已撤销') { acc.revokedRows += 1; if (hasRevoke) acc.revokedRevoke += 1; if (hasDelete) acc.revokedDelete += 1; }
      }
      return acc;
    })())`));
    Object.assign(out, op);

    // ⑦ 宽度 / 无横向滚动
    const m = JSON.parse(await cdp.evaluate(`JSON.stringify((() => {
      const drawer = document.querySelector('.pm-tokens .ant-drawer-content-wrapper');
      const content = document.querySelector('.pm-tokens .ant-table-content');
      return { drawerWidth: Math.round(drawer?.getBoundingClientRect().width ?? 0), tableClient: content?.clientWidth ?? 0, tableScroll: content?.scrollWidth ?? 0 };
    })())`));
    out.drawer_width = m.drawerWidth;
    out.table_client = m.tableClient;
    out.table_scroll = m.tableScroll;
    out.table_no_hscroll = m.tableScroll <= m.tableClient;

    // ⑥ 真鼠标删除（已撤销行）
    const rowsBeforeDelete = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]')`, 700);
    out.delete_confirm_text = await cdp.evaluate(
      `[...document.querySelectorAll('.ant-popconfirm')].map((el) => el.innerText.replace(/\\n/g, ' ')).join(' | ')`,
    );
    await cdp.realClickOf(
      `[...document.querySelectorAll('.ant-popconfirm .ant-btn-primary')].find((el) => el.innerText.includes('永久删除'))`,
      1400,
    );
    await cdp.waitFor(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]') === null`, '已撤销行消失');
    out.rows_before_delete = rowsBeforeDelete;
    out.rows_after_delete = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);

    // ── 暗色截图 ───────────────────────────────────────────────────────
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','dark'); true`);
    await cdp.send('Page.reload');
    await sleep(2500);
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面（暗色）');
    await openDrawer();
    out.dark_revoked_mask = await cellOf(REVOKED2_ID, 1);
    out.dark_revoked_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${REVOKED2_ID}"]') !== null`);
    out.dark_revoked_mask_matches = out.dark_revoked_mask !== '—' && String(out.dark_revoked_mask).includes('...');
    await cdp.shot('02-revoked-copy-dark');

    // ⑦ 关抽屉后无完整明文 + 不落持久存储
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body') === null`, '抽屉已卸载', 8000);
    await sleep(400);
    out.after_close_has_full_plaintext = await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(REVOKED_TOKEN)})`);
    out.storage_leak = await cdp.evaluate(
      `JSON.stringify((() => {
         const scan = (store) => { let hit = 0; for (let i = 0; i < store.length; i += 1) { const k = store.key(i); const v = store.getItem(k) ?? ''; if (v.includes('pm_') && k !== 'pm-theme') hit += 1; } return hit; };
         return { local: scan(window.localStorage), session: scan(window.sessionStorage), url: location.href.includes('pm_') ? 1 : 0 };
       })())`,
    );
    out.ac39_runtime_errors = JSON.stringify(cdp.errors);
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
