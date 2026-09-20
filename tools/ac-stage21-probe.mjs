#!/usr/bin/env node
/**
 * 阶段 21 运行时探针（真鼠标 / CDP 网络层计数 / computedStyle / 真实像素 / 三态截图 × 亮暗）：
 *
 *   notes <baseUrl> <sid> <shotsDir>
 *     AC-68：编辑器 Markdown 预览字段下拉恰好 ['用户提示词','系统提示词']；
 *            详情面切到「备注」→ 正文区原样纯文本（含 # 标题 / **粗体** / [链接](http://x)）、
 *            DOM 里 h1/h2/h3/strong/ul/ol/a/code 计数 0、且**未发出** POST /api/render/markdown（网络层计数）；
 *            切回「用户提示词」→ Markdown 渲染恢复正常。
 *     AC-69：pm-detail-notes 的 innerText == notes 原文；computedStyle（fontSize ≤14 / 行高 ≥1.5 / 颜色与标题不同）；
 *            标题行底 → 备注行顶 真实像素 ≤10px；位置夹在标题行与 pm-detail-fields 之间；
 *            空备注不渲染；长备注（≥200 字）最多 2 行 + title 含全文；亮/暗三态截图。
 *
 * 用法：node tools/ac-stage21-probe.mjs notes <baseUrl> <sid> [shotsDir]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, sid, shotsDir = 'docs/shots/stage21'] = process.argv.slice(2);
if (mode !== 'notes' || baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage21-probe.mjs notes <baseUrl> <sid> [shotsDir]');
  process.exit(2);
}
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
    this.markdownRequests = [];
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.text ?? 'exception');
      if (message.method === 'Network.requestWillBeSent') {
        const url = String(message.params?.request?.url ?? '');
        if (url.includes('/api/render/markdown')) this.markdownRequests.push(url);
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
  async realClick(selector, settle = 500) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  /** 真鼠标点「文本包含 text」的分栏条目（取标题匹配） */
  async clickSplitByTitle(title, settle = 900) {
    const selector = await this.evaluate(
      `(() => { const el = [...document.querySelectorAll('[data-testid="pm-split-item"]')].find((n) => n.innerText.includes(${JSON.stringify(title)})); if (!el) return null; el.setAttribute('data-probe', '1'); return '[data-probe="1"]'; })()`,
    );
    if (selector === null) throw new Error(`分栏里找不到「${title}」`);
    await this.realClick(selector, settle);
    await this.evaluate(`document.querySelector('[data-probe="1"]')?.removeAttribute('data-probe')`);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac21-'));
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
    const setTheme = async (theme) => {
      await cdp.evaluate(`window.localStorage.setItem('pm-theme', ${JSON.stringify(theme)}); window.localStorage.setItem('pm-view-mode', 'split');`);
    };
    const navigate = async (ready) => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(ready, '页面就绪');
      await sleep(700);
    };

    // localStorage 在 about:blank 上不可用（opaque origin）→ 先落到真实页面再写主题
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await sleep(800);
    await setTheme('light');
    await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-split-item"]')`, '分栏列表');

    // ---------- AC-69 ①③：有备注的条目 ----------
    await cdp.clickSplitByTitle('AC21 有备注');
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-notes"]')`, '备注行');
    await sleep(500);
    // 多行文本一律用 JSON 编码输出（grep/cut 的键值行不能带换行）
    out.ac69_notes_text = await cdp.evaluate(`JSON.stringify(document.querySelector('[data-testid="pm-detail-notes"]').innerText)`);
    out.ac69_source_notes = await cdp.evaluate(
      `fetch('/api/prompts?q=' + encodeURIComponent('AC21 有备注'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(String((j.items[0] || {}).notes || '')))`,
    );
    out.ac69_style = await cdp.evaluate(
      `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-detail-notes"]'); const cs = getComputedStyle(el); const title = document.querySelector('[data-testid="pm-detail-title"]'); return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color, titleColor: getComputedStyle(title).color, titleFontSize: getComputedStyle(title).fontSize, clamp: cs.webkitLineClamp ?? cs.getPropertyValue('-webkit-line-clamp'), overflow: cs.overflow, display: cs.display, titleAttr: el.getAttribute('title') }; })())`,
    );
    out.ac69_geometry = await cdp.evaluate(
      `JSON.stringify((() => { const notes = document.querySelector('[data-testid="pm-detail-notes"]'); const title = document.querySelector('[data-testid="pm-detail-title"]'); const fields = document.querySelector('[data-testid="pm-detail-fields"]'); const n = notes.getBoundingClientRect(); const t = title.getBoundingClientRect(); const f = fields.getBoundingClientRect(); return { titleBottom: Math.round(t.bottom), notesTop: Math.round(n.top), gap: Math.round(n.top - t.bottom), notesTopRaw: n.top, fieldsTop: f.top, between: n.top >= t.bottom - 1 && n.top <= f.top + 1 }; })())`,
    );
    await cdp.shot('01-notes-light');

    // ---------- AC-68 ②③：备注页签 = 纯文本 + 无 /api/render/markdown 请求 ----------
    const beforeMarkdown = cdp.markdownRequests.length;
    await cdp.realClick('[data-testid="pm-detail-body"]', 200); // 确保焦点不在别处
    await cdp.evaluate(
      `(() => { const tabs = [...document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented-item')]; const target = tabs.find((n) => n.innerText.includes('备注')); if (!target) return false; target.click(); return true; })()`,
    );
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-body"] [data-testid="pm-detail-text"]')`, '备注纯文本区');
    await sleep(1200);
    out.ac68_notes_requests = String(cdp.markdownRequests.length - beforeMarkdown);
    out.ac68_body_text = await cdp.evaluate(
      `String(document.querySelector('[data-testid="pm-detail-body"]').innerText)`,
    );
    out.ac68_rendered_tags = await cdp.evaluate(
      `String(document.querySelectorAll('[data-testid="pm-detail-body"] h1, [data-testid="pm-detail-body"] h2, [data-testid="pm-detail-body"] h3, [data-testid="pm-detail-body"] strong, [data-testid="pm-detail-body"] ul, [data-testid="pm-detail-body"] ol, [data-testid="pm-detail-body"] a, [data-testid="pm-detail-body"] code').length)`,
    );
    out.ac68_body_has_markdown_chars = await cdp.evaluate(
      `JSON.stringify({ heading: document.querySelector('[data-testid="pm-detail-body"]').innerText.includes('# 标题'), bold: document.querySelector('[data-testid="pm-detail-body"]').innerText.includes('**粗体**'), list: document.querySelector('[data-testid="pm-detail-body"]').innerText.includes('- 列表'), link: document.querySelector('[data-testid="pm-detail-body"]').innerText.includes('[链接](http://x)') })`,
    );
    await cdp.shot('02-notes-plain-text-light');

    // ---------- AC-68 ④：切回用户提示词 → Markdown 渲染恢复正常 ----------
    const beforeBack = cdp.markdownRequests.length;
    await cdp.evaluate(
      `(() => { const tabs = [...document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented-item')]; const target = tabs.find((n) => n.innerText.includes('用户提示词')); if (!target) return false; target.click(); return true; })()`,
    );
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-body"] [data-testid="markdown-preview"]')`, 'Markdown 预览回归');
    await cdp.waitFor(`(document.querySelector('[data-testid="pm-detail-body"] [data-testid="markdown-preview"]')?.innerText ?? '').length > 0`, '预览有内容');
    await sleep(900);
    out.ac68_back_requests = String(cdp.markdownRequests.length - beforeBack);
    out.ac68_back_rendered_tags = await cdp.evaluate(
      `String(document.querySelectorAll('[data-testid="pm-detail-body"] h1, [data-testid="pm-detail-body"] h2, [data-testid="pm-detail-body"] h3, [data-testid="pm-detail-body"] strong, [data-testid="pm-detail-body"] ul, [data-testid="pm-detail-body"] ol, [data-testid="pm-detail-body"] a, [data-testid="pm-detail-body"] code').length)`,
    );

    // ---------- AC-68 ①：编辑器页字段下拉恰好两项 ----------
    await cdp.realClick('[data-testid="pm-detail-edit"]', 1000);
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-editor"]')`, '编辑器');
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-panel-markdown"] .ant-select')`, '编辑器预览头部');
    await sleep(500);
    await cdp.realClick('[data-testid="pm-panel-markdown"] .ant-select', 500);
    await cdp.waitFor(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')`, '字段下拉');
    out.ac68_editor_options = await cdp.evaluate(
      `JSON.stringify([...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map((n) => n.innerText.trim()))`,
    );
    await cdp.shot('03-editor-fields-2-options-light');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
    await cdp.realClick('[data-testid="editor-back"]', 900);

    // ---------- AC-69 ④：空备注不渲染 ----------
    await cdp.clickSplitByTitle('AC21 无备注');
    await sleep(1200);
    out.ac69_empty_state = await cdp.evaluate(
      `JSON.stringify({ exists: !!document.querySelector('[data-testid="pm-detail-notes"]'), detailPresent: !!document.querySelector('[data-testid="pm-detail"]') })`,
    );
    await cdp.shot('04-notes-empty-light');

    // ---------- AC-69 ⑤：长备注（≥200 字）最多 2 行 + title 全文 ----------
    await cdp.clickSplitByTitle('AC21 长备注');
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-notes"]')`, '长备注行');
    await sleep(600);
    out.ac69_long = await cdp.evaluate(
      `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-detail-notes"]'); const cs = getComputedStyle(el); const lh = Number.parseFloat(cs.lineHeight); const lines = Math.round(el.clientHeight / lh); return { clientHeight: el.clientHeight, lineHeight: cs.lineHeight, lines, clamp: cs.webkitLineClamp ?? cs.getPropertyValue('-webkit-line-clamp'), scrollHeight: el.scrollHeight, titleLength: (el.getAttribute('title') ?? '').length, textLength: el.innerText.length, overflow: cs.overflow }; })())`,
    );
    await cdp.shot('05-notes-long-light');

    // ---------- 暗色三态 ----------
    await setTheme('dark');
    await navigate(`!!document.querySelector('[data-testid="pm-search-input"]')`);
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-split-item"]')`, '分栏列表（暗色）');
    await cdp.clickSplitByTitle('AC21 有备注');
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-notes"]')`, '暗色备注行');
    await sleep(600);
    out.ac69_dark = await cdp.evaluate(
      `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-detail-notes"]'); const cs = getComputedStyle(el); const title = document.querySelector('[data-testid="pm-detail-title"]'); return { theme: document.documentElement.dataset.pmTheme, color: cs.color, titleColor: getComputedStyle(title).color, fontSize: cs.fontSize }; })())`,
    );
    await cdp.shot('06-notes-dark');
    await cdp.clickSplitByTitle('AC21 无备注');
    await sleep(1000);
    await cdp.shot('07-notes-empty-dark');
    await cdp.clickSplitByTitle('AC21 长备注');
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-detail-notes"]')`, '暗色长备注行');
    await sleep(600);
    await cdp.shot('08-notes-long-dark');

    out.ac21_runtime_errors = JSON.stringify(cdp.errors);
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
