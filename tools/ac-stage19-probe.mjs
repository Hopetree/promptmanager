#!/usr/bin/env node
/**
 * 阶段 19 运行时探针（真鼠标 / 真键盘 / 真实像素测量）：
 *
 *   editor <baseUrl> <sid> <shotsDir>
 *     AC-63 编辑器全屏（v25 修订版）：不进入浏览器全屏（浏览器全屏元素恒为空）；
 *     真鼠标点 `editor-fullscreen` → 内部左栏 `editor-list` 被隐藏（offsetParent === null）、
 *     编辑栏 : 右栏 = 1 : 1（贴真实像素与比值）；按钮与详情面同款（anticon-compress + 「退出全屏」）；
 *     Esc 只退全屏（正文不丢、不返回）；再点进入/再点退出双向切换；详情面 pm-detail-fullscreen 仍在。
 *
 *   copy <lanBase> <sid> <secureBase> <shotsDir>
 *     AC-65 复制在内网 HTTP 下可用：断言非安全上下文 + async clipboard 不存在，
 *     真鼠标点详情面复制与变量面板复制 → 不出现「浏览器拒绝了剪贴板访问」，
 *     并在 127.0.0.1（安全上下文）读回真实剪贴板内容做逐字符校验。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, extra, shotsDir = 'tmp/shots/stage19'] = process.argv.slice(2);
if (mode === undefined || baseUrl === undefined || sid === undefined || extra === undefined) {
  console.error('用法：node tools/ac-stage19-probe.mjs <editor|copy> <baseUrl> <sid> <extra> [shotsDir]');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));
const MSG = `JSON.stringify([...new Set([...document.querySelectorAll('.ant-message')].map((n) => n.innerText.trim()).filter(Boolean))])`;

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
  async center(selector) {
    const value = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${selector}`);
    return JSON.parse(value);
  }
  /** 真鼠标点击（Input.dispatchMouseEvent：mouseMoved → mousePressed → mouseReleased） */
  async realClick(selector, settle = 500) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  /** 真键盘（Input.dispatchKeyEvent） */
  async key(keyName, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await sleep(60);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await sleep(500);
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

const WIDTHS = `JSON.stringify((() => {
  const w = (id) => { const el = document.querySelector('[data-testid="' + id + '"]'); return el === null ? -1 : Math.round(el.getBoundingClientRect().width); };
  const main = w('editor-main'); const side = w('editor-side');
  return { main, side, ratio: side > 0 ? Number((main / side).toFixed(3)) : -1 };
})())`;
const LIST_STATE = `JSON.stringify((() => {
  const el = document.querySelector('[data-testid="editor-list"]');
  return el === null ? { exists: false, offsetParentNull: true } : { exists: true, offsetParentNull: el.offsetParent === null };
})())`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac19-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1280,800', '--user-data-dir=' + userDataDir, '--remote-debugging-port=0', 'about:blank'],
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

    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browser = new Cdp(await openSocket(version.webSocketDebuggerUrl));
    for (const base of mode === 'copy' ? [baseUrl, extra] : [baseUrl]) {
      await browser.send('Browser.grantPermissions', {
        origin: new URL(base).origin,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      });
    }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });
    const navigate = async (ready) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(700);
    };
    const clearMessages = () => cdp.evaluate(`(() => { document.querySelectorAll('.ant-message').forEach((n) => n.remove()); return true; })()`);

    if (mode === 'editor') {
      // ---------- ① 进编辑器，确认当前不在浏览器全屏 ----------
      await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-split-item"]')`, '分栏列表');
      await cdp.realClick('[data-testid="pm-split-item"]', 800);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-edit"]')`, '详情面');
      await cdp.realClick('[data-testid="pm-detail-edit"]', 900);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器');
      await cdp.waitFor(`!!document.querySelector('[data-testid="editor-list"]')`, '编辑器内部左栏');
      out.ac63_fullscreen_element_before = await cdp.evaluate(`String(document.fullscreenElement === null)`);
      out.ac63_list_before = await cdp.evaluate(LIST_STATE);
      out.ac63_widths_before = await cdp.evaluate(WIDTHS);
      out.ac63_button_before = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid="editor-fullscreen"]'); return { text: el.innerText.trim(), icon: el.querySelector('.anticon')?.className ?? '', visible: el.offsetParent !== null, size: getComputedStyle(el).fontSize, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }; })())`,
      );
      await cdp.shot('01-editor-normal');
      // 未保存正文：用于验证 Esc 之后内容不丢
      out.ac63_body_before = await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="editor-user-prompt"]'); const ta = el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'); const text = Array.from({ length: 1200 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(''); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true })); return String(ta.value.length); })()`,
      );

      // ---------- ② 真鼠标点全屏 ----------
      await cdp.realClick('[data-testid="editor-fullscreen"]', 900);
      await cdp.waitFor(`document.querySelector('[data-testid="editor-fullscreen"]').innerText.includes('退出全屏')`, '进入全屏');
      out.ac63_fullscreen_element_after = await cdp.evaluate(`String(document.fullscreenElement === null)`);
      out.ac63_list_in_fullscreen = await cdp.evaluate(LIST_STATE);
      out.ac63_widths_fullscreen = await cdp.evaluate(WIDTHS);
      out.ac63_button_in_fullscreen = await cdp.evaluate(
        `JSON.stringify((() => { const el = document.querySelector('[data-testid="editor-fullscreen"]'); return { text: el.innerText.trim(), icon: el.querySelector('.anticon')?.className ?? '' }; })())`,
      );
      out.ac63_visible_cols_fullscreen = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-editor"] .pm-editor-col')].filter((el) => el.offsetParent !== null).length)`,
      );
      await cdp.shot('02-editor-fullscreen');

      // ---------- ④ Esc 只退全屏：左栏/宽度复原、正文不丢、不返回 ----------
      await cdp.key('Escape', 'Escape', 27);
      await cdp.waitFor(`document.querySelector('[data-testid="editor-fullscreen"]').innerText.includes('全屏展开')`, 'Esc 退出全屏');
      out.ac63_list_after_esc = await cdp.evaluate(LIST_STATE);
      out.ac63_widths_after_esc = await cdp.evaluate(WIDTHS);
      out.ac63_body_after_esc = await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="editor-user-prompt"]'); const ta = el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea'); return String(ta.value.length); })()`,
      );
      out.ac63_still_editor_after_esc = await cdp.evaluate(`String(!!document.querySelector('[data-testid="pm-editor"]'))`);
      out.ac63_returned_to_detail_after_esc = await cdp.evaluate(
        `String(!!document.querySelector('[data-testid="pm-detail-edit"]') && !document.querySelector('[data-testid="pm-editor"]'))`,
      );
      await cdp.shot('03-after-esc');

      // ---------- ⑤ 双向切换 ----------
      await cdp.realClick('[data-testid="editor-fullscreen"]', 800);
      await cdp.waitFor(`document.querySelector('[data-testid="editor-fullscreen"]').innerText.includes('退出全屏')`, '再次进入全屏');
      out.ac63_reenter_ok = 'true';
      await cdp.realClick('[data-testid="editor-fullscreen"]', 800);
      await cdp.waitFor(`document.querySelector('[data-testid="editor-fullscreen"]').innerText.includes('全屏展开')`, '再点退出全屏');
      out.ac63_toggle_exit_ok = 'true';

      // ---------- ⑥ 详情面全屏仍在且可用 ----------
      await cdp.realClick('[data-testid="editor-back"]', 900);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-fullscreen"]')`, '详情面全屏按钮');
      out.ac63_detail_fullscreen_exists = 'true';
      await cdp.realClick('[data-testid="pm-detail-fullscreen"]', 800);
      out.ac63_detail_fullscreen_state = await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="pm-detail"]'); const r = el.getBoundingClientRect(); return JSON.stringify({ cls: el.className.includes('pm-detail-fullscreen'), w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight }); })()`,
      );
      await cdp.shot('04-detail-fullscreen');
      await cdp.realClick('[data-testid="pm-detail-fullscreen"]', 600);
      out.ac19_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ================= AC-65：内网 IP + HTTP 下的复制 =================
      await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
      out.ac65_url = baseUrl;
      out.ac65_is_secure_context = await cdp.evaluate(`String(window.isSecureContext)`);
      out.ac65_clipboard_type = await cdp.evaluate(`String(typeof navigator.clipboard)`);
      out.ac65_write_text_type = await cdp.evaluate(`String(typeof navigator.clipboard?.writeText)`);
      out.ac65_exec_command_type = await cdp.evaluate(`String(typeof document.execCommand)`);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-split-item"]')`, '分栏列表');

      const clickSplitByTitle = async (title) => {
        const selector = await cdp.evaluate(
          `(() => { const el = [...document.querySelectorAll('[data-testid="pm-split-item"]')].find((n) => n.innerText.includes(${JSON.stringify(title)})); if (!el) return null; el.setAttribute('data-probe', '1'); return '[data-probe="1"]'; })()`,
        );
        if (selector === null) throw new Error(`分栏里找不到「${title}」`);
        await cdp.realClick(selector, 900);
        await cdp.evaluate(`document.querySelector('[data-probe="1"]')?.removeAttribute('data-probe')`);
      };
      const readSecureClipboard = async () => {
        await cdp.send('Page.navigate', { url: `${extra}/healthz` });
        await sleep(700);
        const value = await cdp.evaluate(`navigator.clipboard.readText().then((t) => t).catch((e) => 'ERR:' + String(e))`);
        await cdp.send('Page.navigate', { url: `${baseUrl}/` });
        await cdp.waitFor(`!!document.querySelector('[data-testid="pm-search-input"]')`, '回到内网页');
        await sleep(500);
        return value;
      };

      // ① 详情面「复制提示词」（无变量条目）
      await clickSplitByTitle('AC65 无变量');
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-copy"]')`, '详情操作条');
      out.ac65_detail_source = await cdp.evaluate(
        `fetch('/api/prompts?q=' + encodeURIComponent('AC65 无变量'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => String((j.items[0] || {}).user_prompt || ''))`,
      );
      await clearMessages();
      await cdp.realClick('[data-testid="pm-detail-copy"]', 1200);
      out.ac65_detail_message = await cdp.evaluate(MSG);
      await cdp.shot('05-lan-detail-copy');
      out.ac65_detail_clipboard = await readSecureClipboard();

      // ② 变量面板「复制」（渲染结果后）
      await clickSplitByTitle('AC65 有变量');
      await cdp.waitFor(`!!document.querySelector('[data-testid^="var-"]')`, '变量输入框');
      await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid^="var-"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, '张三'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
      );
      await sleep(300);
      await cdp.realClick('[data-testid="render-submit"]', 1800);
      await cdp.waitFor(`!!document.querySelector('[data-testid="copy-user"]')`, '渲染结果复制按钮');
      out.ac65_rendered_text = await cdp.evaluate(
        `String(document.querySelector('[data-testid="copy-user"]')?.closest('.ant-card')?.querySelector('textarea')?.value ?? '')`,
      );
      await clearMessages();
      await cdp.realClick('[data-testid="copy-user"]', 1200);
      out.ac65_varpanel_message = await cdp.evaluate(MSG);
      await cdp.shot('06-lan-varpanel-copy');
      out.ac65_varpanel_clipboard = await readSecureClipboard();
      out.ac19_runtime_errors = JSON.stringify(cdp.errors);
    }
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
