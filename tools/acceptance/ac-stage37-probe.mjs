#!/usr/bin/env node
/**
 * 阶段 37 运行时探针（**内网 IP 非安全上下文** + 真鼠标；CDP）：
 *
 *   layout <lanBaseUrl> <sid> <shotsDir>
 *     AC-100 ① 抽屉宽度 ≤640、表格 `scrollWidth <= clientWidth`（无横向滚动）、名称列完整显示（不截断）
 *     AC-100 ② 折叠态列头**按顺序**恰好 `名称 / 状态 / 创建时间 / 使用`
 *     AC-100 ③ 可查看行有「复制」+「显示」；真鼠标「复制」→ Ctrl+V 真粘贴读回 == 明文；
 *              点「显示」→ 该行展开且明文可见、可选中
 *     AC-100 ④ 展开区含 最近使用 + 操作；有效行有「撤销」无「删除」；已撤销行有「删除」无「撤销」；
 *              真鼠标点「删除」→ 二次确认 → 行消失
 *     AC-100 ⑤ 真鼠标点**已撤销行**的行展开箭头（该行没有「显示」）⇒「删除」可达
 *     AC-100 ⑥ 再点一次收起 → 展开区消失
 *     AC-100 ⑦ 创建区可用且提示不变；关抽屉后页面无明文
 *     AC-100 ⑧ 亮 / 暗各一张截图
 *
 * 环境变量：AC100_EXPECT_TOKEN（token A 明文）、AC100_REVOKED_ID（已撤销行 id）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['layout'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage37-probe.mjs <${MODES.join('|')}> <lanBaseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage37';
const EXPECT = process.env['AC100_EXPECT_TOKEN'] ?? '';
const REVOKED_ID = process.env['AC100_REVOKED_ID'] ?? '0';
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
  /** 真实清空（走输入管线；`el.value=''` 会被 React 受控输入还原）。 */
  async clearInput(jsExpr) {
    await this.evaluate(`(() => { const el = ${jsExpr}; el.focus(); el.select(); return true; })()`);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await sleep(200);
  }
  /** 真粘贴：清空 → 聚焦 → Ctrl+V（macOS 用 Meta+V）→ 读 value */
  async pasteInto(jsExpr) {
    await this.clearInput(jsExpr);
    await this.evaluate(`(() => { const el = ${jsExpr}; el.focus(); return true; })()`);
    const modifier = process.platform === 'darwin' ? 4 : 2; // 2=Ctrl, 4=Meta
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
const rowOf = (id) => `document.querySelector('[data-testid="pm-token-copy-${id}"]')?.closest('tr') ?? document.querySelector('[data-testid="pm-token-expand-${id}"]')?.closest('tr')`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac37-'));
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
        `document.querySelector('[data-testid^="pm-token-copy-"]')?.closest('[data-prefetched]')?.getAttribute('data-prefetched') === '1'`,
        '明文预取完成',
        20_000,
      );
    };
    const closeDrawer = async () => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body') === null`, '抽屉已卸载', 8000);
    };
    const measure = () =>
      cdp.evaluate(`JSON.stringify((() => {
        const drawer = document.querySelector('.pm-tokens .ant-drawer-content-wrapper');
        const content = document.querySelector('.pm-tokens .ant-table-content') ?? document.querySelector('.pm-tokens .ant-table-body');
        const body = document.querySelector('.pm-tokens .ant-drawer-body');
        const heads = [...document.querySelectorAll('.pm-tokens thead th')].map((th) => th.innerText.trim());
        const names = [...document.querySelectorAll('.pm-tokens tbody tr')].map((tr) => {
          const cell = tr.querySelector('td:nth-child(2)');
          const span = cell?.querySelector('[data-testid^="pm-token-name-"]');
          return { text: span?.innerText.trim() ?? '', cellClient: cell?.clientWidth ?? 0, cellScroll: cell?.scrollWidth ?? 0, clamped: span ? span.scrollWidth > span.clientWidth + 1 : null };
        });
        return {
          drawerWidth: Math.round(drawer?.getBoundingClientRect().width ?? 0),
          bodyClient: body?.clientWidth ?? 0, bodyScroll: body?.scrollWidth ?? 0,
          tableClient: content?.clientWidth ?? 0, tableScroll: content?.scrollWidth ?? 0,
          heads, names, rows: document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length,
        };
      })())`);

    // ---------- 亮色：结构 / 宽度 / 列头 ----------
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
    out.body_client = m1.bodyClient;
    out.body_scroll = m1.bodyScroll;
    out.table_no_hscroll = m1.tableScroll <= m1.tableClient;
    out.heads = JSON.stringify(m1.heads);
    out.name_cells = JSON.stringify(m1.names);
    out.names_not_clamped = m1.names.every((n) => n.clamped === false);
    out.rows = m1.rows;
    await cdp.shot('01-drawer-folded-light');

    // ---------- AC-100 ③ 真鼠标「复制」→ 真粘贴读回 ----------
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-copy-"]')`, 700);
    out.toast_after_copy = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    const pasted = await cdp.pasteInto(NAME_INPUT);
    out.pasted_masked = mask(String(pasted ?? ''));
    out.expected_masked = mask(EXPECT);
    out.clipboard_equals_plaintext = String(pasted ?? '') === EXPECT && EXPECT !== '';
    await cdp.clearInput(NAME_INPUT);

    // ---------- AC-100 ③ 点「显示」= 展开该行（明文可见 + 可选中）----------
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-show-"]')`, 700);
    out.expand_after_show = await cdp.evaluate(
      `document.querySelectorAll('[data-testid^="pm-token-details-"]').length`,
    );
    out.plaintext_equals_expected = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid^="pm-token-plaintext-"]'); return el === null ? false : el.innerText.trim() === ${JSON.stringify(EXPECT)}; })()`,
    );
    out.plaintext_user_select = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid^="pm-token-plaintext-"]'); return el === null ? null : getComputedStyle(el).userSelect; })()`,
    );
    // ---------- AC-100 ④ 展开区内容 ----------
    out.details_lastused_text = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid^="pm-token-lastused-"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    out.details_has_operation_no = await cdp.evaluate(
      `document.querySelectorAll('[data-testid^="pm-token-revoke-"], [data-testid^="pm-token-delete-"]').length`,
    );
    out.valid_row_has_revoke = await cdp.evaluate(`document.querySelector('[data-testid^="pm-token-revoke-"]') !== null`);
    out.valid_row_has_delete = await cdp.evaluate(`document.querySelector('[data-testid^="pm-token-delete-"]') !== null`);
    await cdp.shot('02-drawer-expanded-light');

    // ---------- AC-100 ⑥ 收起 ----------
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-show-"]')`, 700);
    out.details_after_collapse = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-token-details-"]').length`);
    out.expanded_row_visible_after_collapse = await cdp.evaluate(
      `[...document.querySelectorAll('.pm-tokens tr.ant-table-expanded-row')].some((tr) => tr.getBoundingClientRect().height > 0)`,
    );
    out.plaintext_nodes_after_collapse = await cdp.evaluate(
      `document.querySelectorAll('[data-testid^="pm-token-plaintext-"]').length`,
    );

    // ---------- AC-100 ⑤ 已撤销行：没有「显示」，靠行展开箭头到达「删除」 ----------
    out.revoked_row_has_show = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-show-${REVOKED_ID}"]') !== null`);
    out.revoked_row_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${REVOKED_ID}"]') !== null`);
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-expand-${REVOKED_ID}"]')`, 800);
    out.revoked_details_open = await cdp.evaluate(
      `document.querySelector('[data-testid="pm-token-details-${REVOKED_ID}"]') !== null`,
    );
    out.revoked_row_has_delete = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]') !== null`);
    out.revoked_row_has_revoke = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-revoke-${REVOKED_ID}"]') !== null`);
    out.revoked_lastused_text = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-token-lastused-${REVOKED_ID}"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    await cdp.shot('03-revoked-row-expanded-light');

    // ---------- AC-100 ④ 真鼠标删除 ----------
    const rowsBeforeDelete = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]')`, 700);
    out.delete_confirm_text = await cdp.evaluate(
      `[...document.querySelectorAll('.ant-popconfirm')].map((el) => el.innerText.replace(/\\n/g, ' ')).join(' | ')`,
    );
    await cdp.realClickOf(
      `[...document.querySelectorAll('.ant-popconfirm .ant-btn-primary')].find((el) => el.innerText.includes('永久删除'))`,
      1400,
    );
    await cdp.waitFor(`document.querySelector('[data-testid="pm-token-expand-${REVOKED_ID}"]') === null`, '已撤销行消失');
    out.rows_before_delete = rowsBeforeDelete;
    out.rows_after_delete = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);

    // ---------- AC-100 ⑦ 创建区可用 + 提示不变 ----------
    const rowsBeforeCreate = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);
    await cdp.clearInput(NAME_INPUT);
    await cdp.evaluate(`(() => { const el = ${NAME_INPUT}; el.focus(); return true; })()`);
    await cdp.send('Input.insertText', { text: 'AC100 新建夹具' });
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-create"]')`, 1600);
    out.toast_after_create = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    out.modal_count_after_create = await cdp.evaluate(`document.querySelectorAll('.ant-modal-root .ant-modal').length`);
    await cdp.waitFor(
      `document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length === ${String(rowsBeforeCreate + 1)}`,
      '列表刷新出现新行',
    );
    out.rows_before_create = rowsBeforeCreate;
    out.rows_after_create = await cdp.evaluate(`document.querySelectorAll('.pm-tokens tbody tr.ant-table-row').length`);

    // ---------- 暗色截图 ----------
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','dark'); true`);
    await cdp.send('Page.reload');
    await sleep(2500);
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面（暗色）');
    await openDrawer();
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-show-"]')`, 700);
    const m2 = JSON.parse(await measure());
    out.dark_drawer_width = m2.drawerWidth;
    out.dark_table_no_hscroll = m2.tableScroll <= m2.tableClient;
    await cdp.shot('04-drawer-expanded-dark');

    // ---------- AC-100 ⑦ 关抽屉后无明文 ----------
    await closeDrawer();
    await sleep(400);
    out.after_close_plaintext_nodes = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-token-plaintext-"]').length`);
    out.after_close_body_has_pm = await cdp.evaluate(`document.body.innerText.includes('pm_')`);
    out.storage_leak = await cdp.evaluate(
      `JSON.stringify((() => {
         const scan = (store) => { let hit = 0; for (let i = 0; i < store.length; i += 1) { const k = store.key(i); const v = store.getItem(k) ?? ''; if (v.includes('pm_') && k !== 'pm-theme') hit += 1; } return hit; };
         return { local: scan(window.localStorage), session: scan(window.sessionStorage), url: location.href.includes('pm_') ? 1 : 0 };
       })())`,
    );
    out.ac37_runtime_errors = JSON.stringify(cdp.errors);
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
