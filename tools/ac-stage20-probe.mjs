#!/usr/bin/env node
/**
 * 阶段 20 运行时探针（真鼠标 / 真键盘 / 真实像素 / 内网 IP）：
 *
 *   detail <baseUrl> <sid> <shotsDir>
 *     AC-66：详情面正文区不再有「当前字段 + 👁 预览」头部（无 Select / 无 eye 说明标签），
 *            页签 / 预览·源码 / 显示纯文本 / 全屏展开 仍在；量「页签行底部 → 正文区顶部」间距；
 *            编辑器页仍有 3 选项下拉且切换后预览内容变化。
 *
 *   password <baseUrl> <sid> <shotsDir>
 *     AC-67：⋯更多 菜单逐项（无「已登录」）→ 真鼠标开弹窗 → 前端校验（不一致 / <8 字）不发请求 →
 *            正例真交互改密码 → 成功提示 + 弹窗关闭；负例（当前密码错）→ 明确错误提示。
 *            会话与限流的 HTTP 断言由 tools/ac-stage20.sh 用 curl 完成（同一临时实例）。
 *
 * 用法：node tools/ac-stage20-probe.mjs <detail|password> <baseUrl> <sid> [shotsDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, shotsDir = 'docs/shots/stage20'] = process.argv.slice(2);
if (mode === undefined || baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage20-probe.mjs <detail|password> <baseUrl> <sid> [shotsDir]');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((c) => existsSync(c));
const OLD = JSON.stringify(process.env['AC_OLD_PW'] ?? '');
const NEW = JSON.stringify(process.env['AC_NEW_PW'] ?? '');
const MSG = `JSON.stringify([...new Set([...document.querySelectorAll('.ant-message')].map((n) => n.innerText.trim()).filter(Boolean))])`;
// 「页签行底部 → **正文区（内容）顶部**」的间距：正文区 = 预览框 / 源码框（不是包裹层，否则量到的是头部本身）
const GAP = `JSON.stringify((() => {
  const fields = document.querySelector('[data-testid="pm-detail-fields"]');
  const body = document.querySelector('[data-testid="pm-detail-body"]');
  if (fields === null || body === null) return { gap: -1 };
  const content = body.querySelector('[data-testid="markdown-preview"]') ?? body.querySelector('[data-testid="pm-detail-text"]') ?? body.firstElementChild;
  if (content === null) return { gap: -1 };
  const f = fields.getBoundingClientRect(); const c = content.getBoundingClientRect();
  return { fieldsBottom: Math.round(f.bottom), contentTop: Math.round(c.top), gap: Math.round(c.top - f.bottom) };
})())`;

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    this.passwordRequests = 0;
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.text ?? 'exception');
      if (message.method === 'Network.requestWillBeSent' && String(message.params?.request?.url ?? '').includes('/api/password')) {
        this.passwordRequests += 1;
      }
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
  async realClick(selector, settle = 450) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  /** 真鼠标点「文本恰好/包含 text」的元素（取最短匹配） */
  async realClickText(scope, text, settle = 450) {
    const selector = await this.evaluate(
      `(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(`${scope} *`)})].filter((el) => (el.innerText || '').trim().includes(${JSON.stringify(text)})); const el = nodes.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]; if (!el) return null; el.setAttribute('data-probe-target', '1'); return '[data-probe-target="1"]'; })()`,
    );
    if (selector === null) throw new Error(`找不到文本为「${text}」的可点元素（scope=${scope}）`);
    await this.realClick(selector, settle);
    await this.evaluate(`document.querySelector('[data-probe-target="1"]')?.removeAttribute('data-probe-target')`);
  }
  async typeInto(selector, text) {
    await this.realClick(selector, 150);
    await this.send('Input.insertText', { text });
    await sleep(150);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac20-'));
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
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-search-input"]')`, '页面就绪');
    await sleep(700);

    if (mode === 'detail') {
      // ---------- AC-66 ----------
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-split-item"]')`, '分栏列表');
      await cdp.realClick('[data-testid="pm-split-item"]', 900);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail"]')`, '详情面');
      await cdp.waitFor(`(document.querySelector('[data-testid="markdown-preview"]')?.innerText ?? '').length > 0`, '预览渲染');
      await sleep(400);
      out.ac66_detail_text_has_currentfield = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-detail"]').innerText.includes('当前字段'))`,
      );
      out.ac66_detail_select_count = await cdp.evaluate(
        // 范围限定在**正文区**：详情面里版本面板自带的两个 Select 不算（它们是 FR-56 的对比选择器）
        `String(document.querySelectorAll('[data-testid="pm-detail-body"] .ant-select').length)`,
      );
      out.ac66_body_eye_count = await cdp.evaluate(
        `String(document.querySelectorAll('[data-testid="pm-detail-body"] .anticon-eye, [data-testid="pm-detail-body"] [class*="anticon-eye"]').length)`,
      );
      out.ac66_body_text = await cdp.evaluate(
        `String((document.querySelector('[data-testid="pm-detail-body"]')?.innerText ?? '').trim().slice(0, 40))`,
      );
      out.ac66_fields_present = await cdp.evaluate(
        `JSON.stringify({ tabs: ['用户提示词','系统提示词','备注'].every((t) => document.querySelector('[data-testid="pm-detail-fields"]').innerText.includes(t)), segments: document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented').length, plain: !!document.querySelector('[data-testid="pm-detail-plain"]'), fullscreen: !!document.querySelector('[data-testid="pm-detail-fullscreen"]') })`,
      );
      out.ac66_gap = await cdp.evaluate(GAP);
      await cdp.shot('01-detail-no-header');

      // 编辑器页不受影响：3 选项下拉 + 切换后预览变化
      await cdp.realClick('[data-testid="pm-detail-edit"]', 1000);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器');
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-panel-markdown"] .ant-select')`, '编辑器预览头部');
      out.ac66_editor_options = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-panel-markdown"] .ant-select-selection-item')].map((n) => n.innerText.trim()))`,
      );
      // 注意：分栏视图的详情面在编辑态仍然挂载（覆盖式浮层，阶段 18/19 的设计），
      // 它的预览也带 markdown-preview testid → 必须**限定在编辑器右栏**里取样。
      const SCOPE = '[data-testid="pm-panel-markdown"] [data-testid="markdown-preview"]';
      const before = await cdp.evaluate(`String(document.querySelector(${JSON.stringify(SCOPE)})?.innerText ?? '')`);
      await cdp.realClick('[data-testid="pm-panel-markdown"] .ant-select', 500);
      await cdp.waitFor(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')`, '字段下拉');
      out.ac66_editor_option_count = await cdp.evaluate(
        `String(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').length)`,
      );
      out.ac66_editor_dropdown_items = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map((n) => n.innerText.trim()))`,
      );
      await cdp.realClickText('.ant-select-dropdown', '系统提示词', 800);
      // 预览是「300ms 防抖 + 服务端渲染」：给足时间再采样，避免把"还没渲染完"误判成"没变化"
      await sleep(1800);
      out.ac66_editor_select_after = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-panel-markdown"] .ant-select')].map((n) => n.innerText.trim()).join(' | '))`,
      );
      out.ac66_editor_preview_before = before.slice(0, 30);
      out.ac66_editor_preview_after = await cdp.evaluate(
        `String((document.querySelector(${JSON.stringify(SCOPE)})?.innerText ?? '').slice(0, 30))`,
      );
      out.ac66_editor_switched = String(
        (await cdp.evaluate(`String(document.querySelector(${JSON.stringify(SCOPE)})?.innerText ?? '')`)) !== before,
      );
      await cdp.shot('02-editor-still-3-options');
      out.ac20_runtime_errors = JSON.stringify(cdp.errors);
    } else {
      // ---------- AC-67 ----------
      await cdp.waitFor(`!!document.querySelector('[data-testid="header-more"]')`, '⋯更多');
      await cdp.realClick('[data-testid="header-more"]', 500);
      await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
      out.ac67_menu_items = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('.ant-dropdown-menu .ant-dropdown-menu-item')].map((n) => n.innerText.trim()))`,
      );
      out.ac67_menu_text = await cdp.evaluate(`String(document.querySelector('.ant-dropdown-menu').innerText)`);
      await cdp.shot('03-more-menu');
      await cdp.realClickText('.ant-dropdown-menu', '修改密码', 900);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-password-modal"]')`, '修改密码弹窗');
      out.ac67_modal_inputs = await cdp.evaluate(
        `String(document.querySelectorAll('[data-testid="pm-password-modal"] input[type="password"]').length)`,
      );
      out.ac67_modal_autocomplete = await cdp.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-testid="pm-password-modal"] input')].map((n) => n.getAttribute('autocomplete')))`,
      );
      await cdp.shot('04-password-modal-empty');

      // ④ 前端校验：两次新密码不一致 → 不发起请求
      const beforeCount = cdp.passwordRequests;
      await cdp.typeInto('[data-testid="pm-old-password"]', 'whatever-current');
      await cdp.typeInto('[data-testid="pm-new-password"]', 'new-password-abc');
      await cdp.typeInto('[data-testid="pm-confirm-password"]', 'new-password-xyz');
      await cdp.realClickText('.ant-modal-footer', '确认修改', 900);
      out.ac67_mismatch_requests = String(cdp.passwordRequests - beforeCount);
      out.ac67_mismatch_error = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-password-modal"] .ant-form-item-explain-error')].map((n) => n.innerText.trim()).join(' | '))`,
      );
      await cdp.shot('05-password-modal-mismatch');

      // ④ 前端校验：<8 个字符 → 拒绝并说明规则
      await cdp.evaluate(
        `(() => { const set = (sel, v) => { const el = document.querySelector(sel); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('[data-testid="pm-new-password"]', 'short7!'); set('[data-testid="pm-confirm-password"]', 'short7!'); return true; })()`,
      );
      const beforeShort = cdp.passwordRequests;
      await cdp.realClickText('.ant-modal-footer', '确认修改', 900);
      out.ac67_short_requests = String(cdp.passwordRequests - beforeShort);
      out.ac67_short_error = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-password-modal"] .ant-form-item-explain-error')].map((n) => n.innerText.trim()).join(' | '))`,
      );
      await cdp.shot('06-password-modal-short');

      // ⑤ 正例（真交互）：清空后填「正确当前密码 + 合规新密码」
      await cdp.evaluate(
        `(() => { const set = (sel, v) => { const el = document.querySelector(sel); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('[data-testid="pm-old-password"]', ${OLD}); set('[data-testid="pm-new-password"]', ${NEW}); set('[data-testid="pm-confirm-password"]', ${NEW}); return true; })()`,
      );
      await sleep(400);
      out.ac67_positive_requests_before = String(cdp.passwordRequests);
      await cdp.realClickText('.ant-modal-footer', '确认修改', 1600);
      out.ac67_positive_requests_after = String(cdp.passwordRequests);
      out.ac67_positive_message = await cdp.evaluate(MSG);
      out.ac67_modal_closed = await cdp.evaluate(`String(document.querySelector('[data-testid="pm-password-modal"]') === null)`);
      await cdp.shot('07-password-changed');

      // 负例：当前密码错（此时当前密码已是新口令，用旧口令提交 → 明确错误提示，不是 401/踢回登录页）
      await cdp.realClick('[data-testid="header-more"]', 500);
      await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
      await cdp.realClickText('.ant-dropdown-menu', '修改密码', 900);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-password-modal"]')`, '修改密码弹窗');
      await cdp.evaluate(
        `(() => { const set = (sel, v) => { const el = document.querySelector(sel); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('[data-testid="pm-old-password"]', ${OLD}); set('[data-testid="pm-new-password"]', 'another-new-password'); set('[data-testid="pm-confirm-password"]', 'another-new-password'); return true; })()`,
      );
      await sleep(300);
      await cdp.realClickText('.ant-modal-footer', '确认修改', 1500);
      out.ac67_wrong_old_error = await cdp.evaluate(
        `String([...document.querySelectorAll('[data-testid="pm-password-modal"] .ant-form-item-explain-error')].map((n) => n.innerText.trim()).join(' | '))`,
      );
      out.ac67_still_logged_in = await cdp.evaluate(
        `fetch('/api/me', { credentials: 'same-origin' }).then((r) => String(r.status))`,
      );
      await cdp.shot('08-password-wrong-old');

      // ⑧ 关于页维护区文案
      await cdp.evaluate(`document.querySelector('.pm-password-modal .ant-modal-close')?.click()`);
      await sleep(500);
      await cdp.realClick('[data-testid="header-more"]', 500);
      await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
      await cdp.realClickText('.ant-dropdown-menu', '关于', 900);
      await cdp.waitFor(`!!document.querySelector('[data-testid="pm-about"]')`, '关于面板');
      await cdp.realClickText('[data-testid="pm-about"]', '维护', 700);
      await sleep(400);
      out.ac67_about_mentions_password = await cdp.evaluate(
        `String(document.querySelector('[data-testid="pm-about"]').innerText.includes('修改密码'))`,
      );
      await cdp.shot('09-about-maintain');
      out.ac20_runtime_errors = JSON.stringify(cdp.errors);
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
