#!/usr/bin/env node
/**
 * 阶段 36 运行时探针（**必须在内网 IP 的非安全上下文下跑**；CDP 真鼠标 + 真粘贴）：
 *
 *   tokens <lanBaseUrl> <sid> <shotsDir>
 *     AC-97 ① 断言 `isSecureContext === false` 且 `typeof navigator.clipboard === 'undefined'`
 *     AC-97 ② 真鼠标点「复制」→ 用 CDP `Input.dispatchKeyEvent` 发 **Ctrl+V** 粘贴到抽屉里的输入框
 *              → 读回 value 与期望明文比对（**只输出布尔与脱敏串，不打印明文**）
 *     AC-97 ③ 点「复制」前后由 ac-stage36.sh 统计服务端 reveal 次数（探针只负责点）
 *     AC-97 ④ 「显示」入口存在：明文可见且 `user-select` 可选中
 *     AC-97 ⑤ `localStorage`/`sessionStorage`/URL 搜不到 `pm_`；关抽屉后页面文本搜不到明文
 *     AC-98 ① 已撤销行有「删除」、有效行**没有**；真鼠标删除 → 二次确认 → 行消失
 *     AC-99 ①② 真鼠标创建 → **不再出现明文 Modal** → 有可读提示 → 新行点「复制」能拿到明文
 *
 * 环境变量：AC36_EXPECT_TOKEN（token A 的明文，用于比对）、AC36_REVOKED_ID（已撤销行 id）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['tokens'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage36-probe.mjs <${MODES.join('|')}> <lanBaseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage36';
const EXPECT = process.env['AC36_EXPECT_TOKEN'] ?? '';
const REVOKED_ID = process.env['AC36_REVOKED_ID'] ?? '0';
/** 服务端日志路径：用来数 `token revealed` 行数（AC-97 ③ 同步性证据）。 */
const SERVER_LOG = process.env['AC36_SERVER_LOG'] ?? '';
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
  /**
   * **真实清空**输入框：`el.value=''` 只改 DOM，React 受控输入会在下次渲染时把值还原
   * （首版就踩了这个：粘贴进输入框的明文残留、还会污染随后创建 token 的名字）⇒
   * 改成 focus + select + Delete 键，走真实输入管线。
   */
  async clearInput(jsExpr) {
    await this.evaluate(`(() => { const el = ${jsExpr}; el.focus(); el.select(); return true; })()`);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await sleep(200);
  }
  /** 真粘贴：先真实清空 → 聚焦 → Ctrl+V（macOS 用 Meta+V）→ 读 value */
  async pasteInto(jsExpr) {
    await this.clearInput(jsExpr);
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
const rowOf = (id) => `document.querySelector('[data-testid="pm-token-copy-${id}"]')?.closest('tr') ?? document.querySelector('[data-testid="pm-token-delete-${id}"]')?.closest('tr')`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac36-'));
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

    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-text"]') !== null`, '主界面');
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await sleep(600);

    // ---------- AC-97 ① 环境断言（非安全上下文）----------
    out.origin = await cdp.evaluate(`location.origin`);
    out.is_secure_context = await cdp.evaluate(`window.isSecureContext`);
    out.clipboard_type = await cdp.evaluate(`typeof navigator.clipboard`);
    out.exec_command_type = await cdp.evaluate(`typeof document.execCommand`);
    out.is_loopback = await cdp.evaluate(`['127.0.0.1','localhost'].some((h) => location.hostname === h)`);

    // ---------- 打开令牌抽屉（真鼠标）----------
    await cdp.realClickOf(`document.querySelector('[data-testid="header-more"]')`, 600);
    await cdp.realClickOf(
      `[...document.querySelectorAll('.ant-dropdown-menu-item')].find((el) => el.innerText.includes('API 令牌'))`,
      900,
    );
    await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body table tbody tr') !== null`, '令牌表');
    // AC-97 ③：预取应在**抽屉打开时**完成（探针只等，不点）
    await cdp.waitFor(
      `document.querySelector('[data-testid^="pm-token-copy-"]')?.closest('[data-prefetched]')?.getAttribute('data-prefetched') === '1'`,
      '明文预取完成',
      20_000,
    );
    out.prefetched_ready = true;

    // ---------- AC-97 ② 真鼠标「复制」→ 真粘贴读回 ----------
    const revealCount = () => {
      if (SERVER_LOG === '') return -1;
      try {
        return readFileSync(SERVER_LOG, 'utf8').split('token revealed').length - 1;
      } catch {
        return -1;
      }
    };
    out.reveal_count_after_open = revealCount();
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-copy-"]')`, 700);
    await sleep(500);
    out.reveal_count_after_copy_click = revealCount();
    out.toast_after_copy = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    const pasted = await cdp.pasteInto(NAME_INPUT);
    out.pasted_masked = mask(String(pasted ?? ''));
    out.expected_masked = mask(EXPECT);
    out.clipboard_equals_plaintext = String(pasted ?? '') === EXPECT && EXPECT !== '';
    out.pasted_is_plaintext = String(pasted ?? '').startsWith('pm_');
    await cdp.clearInput(NAME_INPUT); // 立刻清掉，避免明文残留在表单里（也会污染下面的创建步骤）

    out.name_input_after_clear = mask(await cdp.evaluate(`${NAME_INPUT}?.value ?? ''`));

    // ---------- AC-97 ④ 「显示」入口（可选中）----------
    await cdp.realClickOf(`document.querySelector('[data-testid^="pm-token-show-"]')`, 600);
    out.show_text_equals_plaintext = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid^="pm-token-plaintext-"]'); if (el === null) return false; return el.innerText.trim() === ${JSON.stringify(EXPECT)}; })()`,
    );
    out.show_user_select = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid^="pm-token-plaintext-"]'); if (el === null) return null; return getComputedStyle(el).userSelect; })()`,
    );
    out.show_masked = mask(await cdp.evaluate(`document.querySelector('[data-testid^="pm-token-plaintext-"]')?.innerText.trim() ?? ''`));
    await cdp.shot('01-token-copy-lan-nonsecure');

    // ---------- AC-97 ⑤ 明文不落持久存储 ----------
    out.storage_leak = await cdp.evaluate(
      `JSON.stringify((() => {
         const scan = (store) => { let hit = 0; for (let i = 0; i < store.length; i += 1) { const k = store.key(i); const v = store.getItem(k) ?? ''; if (k.includes('pm_') || v.includes('pm_')) hit += 1; } return hit; };
         return { local: scan(window.localStorage), session: scan(window.sessionStorage), url: location.href.includes('pm_') ? 1 : 0 };
       })())`,
    );

    // ---------- AC-99 创建流程（真鼠标，无明文弹窗）----------
    const beforeRows = await cdp.evaluate(`document.querySelectorAll('.pm-tokens .ant-drawer-body table tbody tr').length`);
    out.rows_before_create = beforeRows;
    await cdp.clearInput(NAME_INPUT);
    await cdp.evaluate(`(() => { const el = ${NAME_INPUT}; el.focus(); return true; })()`);
    await cdp.send('Input.insertText', { text: 'AC36 新建夹具' });
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-create"]')`, 1500);
    out.modal_count_after_create = await cdp.evaluate(`document.querySelectorAll('.pm-tokens .ant-modal, body > .ant-modal-root .ant-modal').length`);
    out.modal_has_plaintext = await cdp.evaluate(
      `(() => { const modal = document.querySelector('.ant-modal-root .ant-modal'); if (modal === null) return false; return modal.innerText.includes('pm_'); })()`,
    );
    out.toast_after_create = await cdp.evaluate(`document.querySelector('.ant-message')?.innerText.trim() ?? null`);
    await cdp.waitFor(
      `document.querySelectorAll('.pm-tokens .ant-drawer-body table tbody tr').length === ${String(beforeRows + 1)}`,
      '列表刷新出现新行',
    );
    // 新行的「复制」也要能拿到明文（与「显示」里预取到的明文一致）
    const newCopy = `[...document.querySelectorAll('[data-testid^="pm-token-copy-"]')].pop()`;
    const newShow = `[...document.querySelectorAll('[data-testid^="pm-token-show-"]')].pop()`;
    await cdp.waitFor(
      `(${newCopy})?.closest('[data-prefetched]')?.getAttribute('data-prefetched') === '1'`,
      '新行明文预取完成',
      20_000,
    );
    await cdp.realClickOf(newCopy, 700);
    const pastedNew = await cdp.pasteInto(NAME_INPUT);
    await cdp.clearInput(NAME_INPUT);
    await cdp.realClickOf(newShow, 600);
    const shownNew = await cdp.evaluate(
      `(() => { const els = [...document.querySelectorAll('[data-testid^="pm-token-plaintext-"]')]; return els.length === 0 ? null : els[els.length - 1].innerText.trim(); })()`,
    );
    out.new_token_clipboard_equals_shown = String(pastedNew ?? '') === String(shownNew ?? '') && String(pastedNew ?? '').startsWith('pm_');
    out.new_token_masked = mask(String(pastedNew ?? ''));
    out.rows_after_create = await cdp.evaluate(`document.querySelectorAll('.pm-tokens .ant-drawer-body table tbody tr').length`);
    await cdp.shot('02-token-created-no-modal');

    // ---------- AC-98 撤销态可删除 / 有效态没有删除 ----------
    out.revoked_row_has_delete = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]') !== null`);
    out.revoked_row_has_copy = await cdp.evaluate(`document.querySelector('[data-testid="pm-token-copy-${REVOKED_ID}"]') !== null`);
    out.valid_rows_without_delete = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-testid^="pm-token-copy-"]')].map((el) => el.closest('tr').querySelector('[data-testid^="pm-token-delete-"]') === null))`,
    );
    await cdp.realClickOf(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]')`, 700);
    out.delete_confirm_text = await cdp.evaluate(
      `[...document.querySelectorAll('.ant-popconfirm')].map((el) => el.innerText.replace(/\\n/g, ' ')).join(' | ')`,
    );
    await cdp.realClickOf(
      `[...document.querySelectorAll('.ant-popconfirm .ant-btn-primary')].find((el) => el.innerText.includes('永久删除'))`,
      1200,
    );
    await cdp.waitFor(`document.querySelector('[data-testid="pm-token-delete-${REVOKED_ID}"]') === null`, '已撤销行消失');
    out.rows_after_delete = await cdp.evaluate(`document.querySelectorAll('.pm-tokens .ant-drawer-body table tbody tr').length`);

    // ---------- AC-97 ⑤ 关抽屉后页面无明文 ----------
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.waitFor(`document.querySelector('.pm-tokens .ant-drawer-body') === null`, '抽屉已卸载', 8000);
    await sleep(400);
    out.after_close_plaintext_nodes = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-token-plaintext-"]').length`);
    out.after_close_body_has_pm = await cdp.evaluate(`document.body.innerText.includes('pm_')`);
    await cdp.shot('03-token-drawer-closed');
    out.ac36_runtime_errors = JSON.stringify(cdp.errors);
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
