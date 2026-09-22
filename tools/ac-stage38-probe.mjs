#!/usr/bin/env node
/**
 * 阶段 38 运行时探针（**内网 IP 非安全上下文** + 真鼠标；CDP）：FR-99 / AC-101
 *
 *   columns <lanBaseUrl> <sid> <shotsDir>
 *     ① 列头**按顺序恰好 6 列**（名称/Token/状态/使用/最近使用/操作）；折叠残留（箭头 / expand·details·lastused testid）全 0
 *     ② 名称：单元格文本 == 前 20 字符 + 省略号；**单元格 title == 完整名称**
 *     ③ Token：单元格文本 == 前 5 + `...` + 后 4（与期望明文逐字对照）；**页面里不出现完整明文**
 *     ④ 使用：有效行「复制」真鼠标点击 → Ctrl+V 真粘贴读回 == 明文；已撤销行 `—`
 *     ⑤ 操作：有效行只有「撤销」；已撤销行只有「删除」；真鼠标删除 → 二次确认 → 行消失
 *     ⑥ 最近使用：`YYYY/MM/DD HH:mm` 形态（从未使用 `—`）
 *     ⑦ 抽屉 ≤640、表格 scrollWidth <= clientWidth；亮 / 暗各一张截图
 *     ⑧ 创建区可用 + 提示不变 + 无明文弹窗；关抽屉后页面无完整明文
 *
 * 环境变量：AC101_EXPECT_TOKEN（有效行明文）、AC101_LONG_NAME（>20 字符的名称）、AC101_REVOKED_ID
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['columns'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage38-probe.mjs <${MODES.join('|')}> <lanBaseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage38';
const EXPECT = process.env['AC101_EXPECT_TOKEN'] ?? '';
const LONG_NAME = process.env['AC101_LONG_NAME'] ?? '';
const REVOKED_ID = process.env['AC101_REVOKED_ID'] ?? '0';
const SERVER_LOG = process.env['AC101_SERVER_LOG'] ?? '';
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac38-'));
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
      await cdp.waitFor(
        `document.querySelector('[data-testid^="pm-token-copy-"]')?.getAttribute('data-prefetched') === '1'`,
        '明文预取完成',
        20_000,
      );
    };
    const measure = () =>
      cdp.evaluate(`JSON.stringify((() => {
        const drawer = document.querySelector('.pm-tokens .ant-drawer-content-wrapper');
        const body = document.querySelector('.pm-tokens .ant-drawer-body');
        const content = document.querySelector('.pm-tokens .ant-table-content');
        return {
          drawerWidth: Math.round(drawer?.getBoundingClientRect().width ?? 0),
          bodyClient: body?.clientWidth ?? 0, bodyScroll: body?.scrollWidth ?? 0,
          tableClient: content?.clientWidth ?? 0, tableScroll: content?.scrollWidth ?? 0,
          heads: [...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim()),
          bodyText: document.body.innerText,
          expandIcons: document.querySelectorAll('.pm-tokens .ant-table-row-expand-icon').length,
          expandTestids: document.querySelectorAll('[data-testid^="pm-token-expand-"]').length,
          detailsTestids: document.querySelectorAll('[data-testid^="pm-token-details-"]').length,
          lastusedTestids: document.querySelectorAll('[data-testid^="pm-token-lastused-"]').length,
        };
      })())`);

    const revealCount = () => {
      if (SERVER_LOG === '') return -1;
      try {
        return readFileSync(SERVER_LOG, 'utf8').split('token revealed').length - 1;
      } catch {
        return -1;
      }
    };

    // ── 亮色 ────────────────────────────────────────────────────────────
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面');
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(500);
    await openDrawer();
    out.origin = await cdp.evaluate(`location.origin`);
    out.is_secure_context = await cdp.evaluate(`window.isSecureContext`);
    out.clipboard_type = await cdp.evaluate(`typeof navigator.clipboard`);

    const m1 = JSON.parse(await measure());
    out.drawer_width = m1.drawerWidth;
    out.table_client = m1.tableClient;
    out.table_scroll = m1.tableScroll;
    out.table_no_hscroll = m1.tableScroll <= m1.tableClient;
    out.heads = JSON.stringify(m1.heads);
    out.expand_icons = m1.expandIcons;
    out.expand_testids = m1.expandTestids;
    out.details_testids = m1.detailsTestids;
    out.lastused_testids = m1.lastusedTestids;
    // ③ 页面文本里不得出现**完整明文**（掩码里的 `pm_` 前缀是允许的，与用户示例一致）
    out.full_plaintext_in_page = EXPECT !== '' && m1.bodyText.includes(EXPECT);

    // ── ② 名称截断 + title ──────────────────────────────────────────────
    out.long_name_expected = `${[...LONG_NAME].slice(0, 20).join('')}…`;
    out.name_cell = await cdp.evaluate(`JSON.stringify((() => {
      const cells = [...document.querySelectorAll('.pm-tokens tbody tr.ant-table-row td:first-child')];
      const cell = cells.find((c) => (c.getAttribute('title') ?? '') === ${JSON.stringify(LONG_NAME)});
      if (cell === undefined) return null;
      return { text: cell.innerText.trim(), title: cell.getAttribute('title'), scrollW: cell.scrollWidth, clientW: cell.clientWidth };
    })())`);
    out.name_truncated_matches = (() => {
      if (out.name_cell === null || out.name_cell === undefined) return false;
      return JSON.parse(out.name_cell).text === out.long_name_expected;
    })();
    out.name_title_is_full = (() => {
      if (out.name_cell === null || out.name_cell === undefined) return false;
      return JSON.parse(out.name_cell).title === LONG_NAME;
    })();

    // ── ③ Token 掩码 ───────────────────────────────────────────────────
    const expectedMask = EXPECT.length >= 11 ? `${EXPECT.slice(0, 5)}...${EXPECT.slice(-4)}` : '…';
    out.expected_mask = expectedMask;
    out.masks = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-token-mask-"]')].map((el) => el.innerText.trim()))`,
    );
    out.mask_matches_expected = JSON.parse(out.masks).includes(expectedMask);

    // ── ④ 使用列：复制（真鼠标 + 真粘贴）+ 已撤销行 — ────────────────────
    out.revoked_use_cell = await cdp.evaluate(
      `(() => { const tr = document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]')?.closest('tr'); return tr ? tr.querySelectorAll('td')[3].innerText.trim() : null; })()`,
    );
    await cdp.shot('01-columns-light');
    const revealBefore = revealCount();
    out.reveal_count_before_click = revealBefore;
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-copy-"]')`, 700);
    out.toast_after_copy = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    await sleep(400);
    out.reveal_count_after_click = revealCount();
    const pasted = await cdp.pasteInto(NAME_INPUT);
    out.pasted_masked = mask(String(pasted ?? ''));
    out.expected_masked = mask(EXPECT);
    out.clipboard_equals_plaintext = String(pasted ?? '') === EXPECT && EXPECT !== '';
    await cdp.clearInput(NAME_INPUT);

    // ── ⑤ 操作列 ───────────────────────────────────────────────────────
    /**
     * ⚠️ 必须**按状态行分区**统计：有效行与已撤销行**都**带 `ant-table-row` 类，
     * 直接按行类统计会把已撤销行的「删除」算进来（首版断言就是这么写错的）。
     */
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
    out.valid_rows = op.validRows;
    out.revoked_rows = op.revokedRows;
    out.valid_row_revoke_buttons = op.validRevoke;
    out.valid_row_delete_buttons = op.validDelete;
    out.revoked_row_revoke_buttons = op.revokedRevoke;
    out.revoked_row_delete_buttons = op.revokedDelete;
    out.revoked_row_has_delete = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]') !== null`);
    out.revoked_row_has_revoke = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-revoke-${REVOKED_ID}"]') !== null`);
    out.revoked_row_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${REVOKED_ID}"]') !== null`);

    // ── ⑥ 最近使用形态 ─────────────────────────────────────────────────
    out.last_used_cells = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('.pm-tokens tbody tr.ant-table-row')].map((tr) => tr.querySelectorAll('td')[4].innerText.trim()))`,
    );
    // 用 RegExp 字符串构造：避免正则字面量里的 `/` 提前结束字面量（首版就踩了这个语法错）
    const timeShape = new RegExp('^\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}$');
    out.last_used_format_ok = JSON.parse(out.last_used_cells).some((text) => timeShape.test(text));
    out.last_used_never_shows_dash = JSON.parse(out.last_used_cells).includes('—');

    // ── ⑤ 真鼠标删除（行消失） ──────────────────────────────────────────
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

    // ── ⑧ 创建区（真鼠标）+ 无明文弹窗 ──────────────────────────────────
    const rowsBeforeCreate = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    await cdp.clearInput(NAME_INPUT);
    await cdp.evaluate(`(() => { const el = ${NAME_INPUT}; el.focus(); return true; })()`);
    await cdp.send('Input.insertText', { text: 'AC101 新建夹具' });
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-create"]')`, 1600);
    out.toast_after_create = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    out.modal_count_after_create = await cdp.evaluate(`document.querySelectorAll('.ant-modal-root .ant-modal').length`);
    await cdp.waitFor(
      `document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length === ${String(rowsBeforeCreate + 1)}`,
      '列表刷新出现新行',
    );
    out.rows_before_create = rowsBeforeCreate;
    out.rows_after_create = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);

    // ── 暗色截图 ───────────────────────────────────────────────────────
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','dark'); true`);
    await cdp.send('Page.reload');
    await sleep(2500);
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面（暗色）');
    await openDrawer();
    const m2 = JSON.parse(await measure());
    out.dark_drawer_width = m2.drawerWidth;
    out.dark_table_no_hscroll = m2.tableScroll <= m2.tableClient;
    out.dark_heads = JSON.stringify(m2.heads);
    await cdp.shot('02-columns-dark');

    // ── ⑧ 关抽屉后无完整明文 ────────────────────────────────────────────
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body') === null`, '抽屉已卸载', 8000);
    await sleep(400);
    out.after_close_has_full_plaintext = await cdp.evaluate(
      `document.body.innerText.includes(${JSON.stringify(EXPECT)})`,
    );
    out.storage_leak = await cdp.evaluate(
      `JSON.stringify((() => {
         const scan = (store) => { let hit = 0; for (let i = 0; i < store.length; i += 1) { const k = store.key(i); const v = store.getItem(k) ?? ''; if (v.includes('pm_') && k !== 'pm-theme') hit += 1; } return hit; };
         return { local: scan(window.localStorage), session: scan(window.sessionStorage), url: location.href.includes('pm_') ? 1 : 0 };
       })())`,
    );
    out.ac38_runtime_errors = JSON.stringify(cdp.errors);
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
