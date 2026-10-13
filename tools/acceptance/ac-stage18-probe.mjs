#!/usr/bin/env node
/**
 * 阶段 18 运行时探针（v25 修订后只剩**仍然有效**的部分）：
 *   AC-61 ④ —— 六处懒加载（编辑器 / Markdown 预览 / 版本 diff / 导入导出 / 使用统计 / 令牌）逐一点开自证 + 截图。
 *
 * 说明：本探针原来还覆盖 AC-62 的「浏览器全屏 + 隐藏外壳」形态，该形态已被 **FR-63 / AC-63 撤销**
 * （阶段 19 改为"应用内全屏：只隐藏编辑器内部左栏 + 左右 1:1"），相关断言已移到
 * `tools/ac-stage19-probe.mjs`（`editor` 模式）；这里不再断言任何全屏形态。
 *
 * 用法：node tools/ac-stage18-probe.mjs <baseUrl> <sid> <shotsDir>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, shotsDir = 'tmp/shots/stage18'] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage18-probe.mjs <baseUrl> <sid> [shotsDir]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
].find((candidate) => existsSync(candidate));

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
      if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(message.params?.exceptionDetails?.text ?? 'exception');
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
    if (result.exceptionDetails !== undefined) throw new Error(`页面内求值失败：${result.exceptionDetails.text ?? ''}`);
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
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${selector}`);
    return JSON.parse(value);
  }
  async realClick(selector, settle = 500) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  /** 真鼠标点击"文本包含 text"的元素（用于没有 testid 的按钮 / 菜单项） */
  async realClickText(scope, text, settle = 500) {
    const selector = await this.evaluate(
      `(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(`${scope} *`)})].filter((el) => (el.innerText || '').includes(${JSON.stringify(text)})); const el = nodes.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]; if (!el) return null; el.setAttribute('data-probe-target', '1'); return '[data-probe-target="1"]'; })()`,
    );
    if (selector === null) throw new Error(`找不到文本为「${text}」的可点元素（scope=${scope}）`);
    await this.realClick(selector, settle);
    await this.evaluate(`document.querySelector('[data-probe-target="1"]')?.removeAttribute('data-probe-target')`);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac18-'));
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
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-split-item"]')`, '首屏分栏列表');
    await sleep(600);
    out.ac18_boot_split_items = await cdp.evaluate(`String(document.querySelectorAll('[data-testid="pm-split-item"]').length)`);
    await cdp.shot('01-split-first-paint');

    // ---------- AC-61 ④：六处懒加载逐一点开自证 ----------
    // ① 编辑器 + ② Markdown 预览 + ③ 版本 diff（都从详情面「去编辑」进入）
    await cdp.realClick('[data-testid="pm-split-item"]', 800);
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-edit"]')`, '详情面');
    await cdp.realClick('[data-testid="pm-detail-edit"]', 1000);
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器（懒加载块）');
    out.ac61_lazy_editor = 'true';
    await cdp.waitFor(`!!document.querySelector('[data-testid="markdown-preview"], [data-testid="pm-panel-markdown"] .ant-empty')`, 'Markdown 预览懒加载');
    out.ac61_lazy_markdown = await cdp.evaluate(
      `String(!!document.querySelector('[data-testid="pm-panel-markdown"]') && !document.querySelector('[data-testid="pm-panel-markdown"]').innerText.includes('正在加载'))`,
    );
    await cdp.shot('07-lazy-markdown-preview');
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-version-views"]')`, '版本面板懒加载');
    await cdp.realClickText('[data-testid="pm-panel-versions"]', '查看 diff', 900);
    await cdp.waitFor(`(document.querySelector('[data-testid="diff-view"]')?.innerText ?? '').length > 0`, '版本 diff 懒加载');
    out.ac61_lazy_diff = await cdp.evaluate(
      `String((document.querySelector('[data-testid="diff-view"]')?.innerText ?? '').replace(/\\s/g, '').length > 0)`,
    );
    await cdp.shot('08-lazy-version-diff');
    await cdp.realClick('[data-testid="editor-back"]', 800);

    // ④ 导入 / 导出
    await cdp.realClick('[data-testid="header-more"]', 600);
    await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
    await cdp.realClickText('.ant-dropdown-menu', '导入 / 导出', 900);
    await cdp.waitFor(`!!document.querySelector('.pm-import-export')`, '导入导出弹窗');
    out.ac61_lazy_import = await cdp.evaluate(
      `String(!!document.querySelector('.pm-import-export [data-testid="export-button"]') && document.querySelector('.pm-import-export').innerText.includes('点击或拖拽 JSON 文件到此处'))`,
    );
    await cdp.shot('09-lazy-import-export');
    await cdp.evaluate(`document.querySelector('.pm-import-export .ant-modal-close')?.click()`);
    await sleep(500);

    // ⑤ 使用统计
    await cdp.realClick('[data-testid="header-more"]', 600);
    await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
    await cdp.realClickText('.ant-dropdown-menu', '使用统计', 1000);
    await cdp.waitFor(`!!document.querySelector('.pm-usage')`, '使用统计抽屉');
    out.ac61_lazy_usage = 'true';
    await cdp.shot('10-lazy-usage');
    await cdp.evaluate(`document.querySelector('.pm-usage .ant-drawer-close')?.click()`);
    await sleep(600);

    // ⑥ API 令牌
    await cdp.realClick('[data-testid="header-more"]', 600);
    await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
    await cdp.realClickText('.ant-dropdown-menu', 'API 令牌', 1000);
    await cdp.waitFor(`!!document.querySelector('.pm-tokens')`, '令牌抽屉');
    out.ac61_lazy_token = 'true';
    await cdp.shot('11-lazy-token');
    await cdp.evaluate(`document.querySelector('.pm-tokens .ant-drawer-close')?.click()`);
    await sleep(400);

    out.ac18_runtime_errors = JSON.stringify(cdp.errors);
  } finally {
    for (const [key, value] of Object.entries(out)) {
      console.log(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
