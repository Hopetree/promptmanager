#!/usr/bin/env node
/**
 * 阶段 77 验收专用探针（零安装 CDP；刻意不装 playwright/puppeteer）。
 *
 * 为什么不直接用 `tools/ui-shot.mjs`：本阶段要验的是「变量弹窗里的多行输入」——
 *   - 变量输入控件必须是 `<textarea>`（旧 dist 是单行 `<input>`）；
 *   - 3 行值经 `Input.insertText` 输入后，实时预览 `pm-vars-preview` 的行数/缩进/空行/无 \r；
 *   - 点「复制结果」后读**真实剪贴板**并与预览、API 渲染逐行对账（局域网非安全上下文时
 *     `navigator.clipboard` 不存在，应用走 `execCommand('copy')` 兜底，所以主页面必须走 LAN IP，
 *     读回则换到同源的 127.0.0.1 安全上下文页面里做 —— 见 AGENTS.md §8 与 docs/traps.md）；
 *   - 双端布局断言 + 截图。
 * 这些步骤串成固定流程比通用动作表更可控，因此写成专用探针；CDP 连接/等待/真鼠标事件
 * 复用 `tools/ui-shot.mjs` 的实现思路（mouseMoved → mousePressed → mouseReleased，绝不用 JS `.click()`）。
 *
 * 用法：node tools/acceptance/ac-stage77-probe.mjs <plan.json>
 * 输出：`PROBE <name> <json>` 与 `SHOT <name> <json>` 行，由 ac-stage77.sh 解析断言。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveChrome } from './lib/chrome.mjs';

const planPath = process.argv[2];
if (planPath === undefined) {
  console.error('用法：node tools/acceptance/ac-stage77-probe.mjs <plan.json>');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 极简 CDP 客户端（与 tools/ui-shot.mjs 同构，保持零安装路线）。 */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined) reject(new Error(`${message.error.message ?? 'CDP 错误'}（${JSON.stringify(message.error)}）`));
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(`页面内求值失败：${result.exceptionDetails.text ?? ''} ${expression}`);
    }
    return result.result?.value;
  }

  async evaluateSafe(expression) {
    try {
      return { ok: true, value: await this.evaluate(expression) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* 还没起来 */
    }
    if (Date.now() > deadline) throw new Error(`等待 ${url} 超时`);
    await sleep(100);
  }
}

async function waitFor(cdp, { selector, text, timeoutMs = 12_000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (selector !== undefined) {
      const found = await cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (found === true) return;
    } else if (text !== undefined) {
      const found = await cdp.evaluate(`document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`);
      if (found === true) return;
    } else {
      return;
    }
    if (Date.now() > deadline) throw new Error(`等待超时：${selector === undefined ? `text=${text}` : `selector=${selector}`}`);
    await sleep(120);
  }
}

/** 真鼠标点击（AGENTS §8：mouseMoved → mousePressed → mouseReleased）。 */
async function mouseClick(cdp, selector) {
  const center = await cdp.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      return true;
    })()`,
  );
  if (center !== true) throw new Error(`点击失败，找不到元素：${selector}`);
  await sleep(120);
  const rect = await cdp.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`,
  );
  if (rect === null) throw new Error(`点击失败，元素不可见：${selector}`);
  const { x, y } = JSON.parse(rect);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/** 真鼠标点击「innerText 含某段文字」的元素（列表项标题不唯一，只能按文本定位）。 */
async function mouseClickByText(cdp, selector, text) {
  const found = await cdp.evaluate(
    `(() => {
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = items.find((n) => n.innerText.includes(${JSON.stringify(text)}));
      if (el === undefined) return null;
      el.scrollIntoView({ block: 'center' });
      return true;
    })()`,
  );
  if (found !== true) throw new Error(`点击失败，找不到包含「${text}」的元素：${selector}`);
  await sleep(150);
  const rect = await cdp.evaluate(
    `(() => {
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = items.find((n) => n.innerText.includes(${JSON.stringify(text)}));
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`,
  );
  if (rect === null) throw new Error(`点击失败，元素不可见：${selector} / ${text}`);
  const { x, y } = JSON.parse(rect);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/** 聚焦控件（真鼠标点一下，满足"点变量输入框"的验收口径）。 */
async function focusByClick(cdp, selector) {
  await mouseClick(cdp, selector);
  const active = await cdp.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return document.activeElement === el; })()`,
  );
  if (active !== true) throw new Error(`点击后焦点不在目标控件：${selector}`);
}

async function insertText(cdp, selector, text) {
  await cdp.send('Input.insertText', { text });
  await sleep(200);
  const value = await cdp.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? null : el.value; })()`,
  );
  if (value === text) return value;
  // 兜底：insertText 没整体生效时逐字符插入（换行用真实 Enter 键）。
  await cdp.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el !== null) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`,
  );
  for (const char of text) {
    if (char === '\n') {
      const keys = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...keys, text: '\r' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keys });
    } else {
      await cdp.send('Input.insertText', { text: char });
    }
  }
  await sleep(200);
  return cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el === null ? null : el.value; })()`);
}

/**
 * 模拟粘贴（不经过键盘）：原生 value setter + `InputEvent('input', {inputType:'insertFromPaste'})`。
 * 为什么 CRLF 用例必须走这条路：`Input.insertText` 传 "a\r\nb" 时 Chrome 会把 \r 和 \n 各算一次换行
 * （实测得到 "a\n\nb"），且 `<textarea>` 的 value sanitization 本来就会把 CRLF 归一为 LF ——
 * 键盘路线测不到「值里的 CRLF 被归一并无 \r 残留」这条契约。Lead m00172 明确允许 Runtime.evaluate 赋值。
 */
async function pasteText(cdp, selector, text) {
  const value = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return null;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor === undefined || descriptor.set === undefined) return null;
    descriptor.set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: ${JSON.stringify(text)} }));
    return el.value;
  })()`);
  await sleep(400);
  return value;
}

async function selectAll(cdp) {
  const keys = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...keys });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keys });
  await sleep(80);
}

/** 读取剪贴板：先试当前页（LAN，非安全上下文通常没有 navigator.clipboard），
 *  再在同一个 chrome 进程里导航到 127.0.0.1（安全上下文）读回 —— 共享同一系统剪贴板。 */
async function readClipboard(cdp, secureBaseUrl) {
  const secureOrigin = new URL(secureBaseUrl).origin;
  const beforeRaw = await cdp.evaluateSafe(`(() => ({ secure: window.isSecureContext, hasApi: typeof navigator.clipboard !== 'undefined' }))()`);
  // evaluateSafe 返回 {ok, value} 包装；这里解包，否则断言读到的是 None（第二轮自测踩过）。
  const before = beforeRaw.ok ? beforeRaw.value : { secure: null, hasApi: null, error: beforeRaw.error };
  let text = null;
  let source = 'none';
  let error = null;

  const direct = await cdp.evaluateSafe(`(async () => {
    if (typeof navigator.clipboard === 'undefined') return { api: false, text: null };
    const t = await navigator.clipboard.readText();
    return { api: true, text: t };
  })()`);
  if (direct.ok && direct.value?.api === true) {
    text = direct.value.text;
    source = 'lan-navigator';
  } else if (!direct.ok) {
    error = direct.error;
  }

  if (text === null) {
    try {
      await cdp.send('Page.bringToFront');
    } catch {
      /* headless shell 可能不支持，不影响后续读取 */
    }
    let granted = null;
    try {
      await cdp.send('Browser.grantPermissions', {
        origin: secureOrigin,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      });
      granted = 'ok';
    } catch (grantError) {
      granted = grantError instanceof Error ? grantError.message : String(grantError);
    }
    await cdp.send('Page.navigate', { url: `${secureBaseUrl}/` });
    await sleep(1500);
    try {
      await cdp.send('Page.bringToFront');
    } catch {
      /* 同上 */
    }
    const secure = await cdp.evaluateSafe(`(async () => {
      if (typeof navigator.clipboard === 'undefined') return { api: false, text: null };
      const t = await navigator.clipboard.readText();
      return { api: true, text: t };
    })()`);
    if (secure.ok && secure.value?.api === true) {
      text = secure.value.text;
      source = 'secure-navigator';
    } else {
      error = secure.ok ? 'navigator.clipboard 读不到（api=false）' : secure.error;
    }
    // 对照实验：证明「安全上下文读回路径」本身保留末尾换行 —— 这样应用侧少了末尾换行才能归因于
    // execCommand + DOM 选区复制的浏览器行为，而不是我们读回的方式。
    const roundtripRaw = await cdp.evaluateSafe(`(async () => {
      if (typeof navigator.clipboard === 'undefined') return { api: false };
      const probe = '\\nROUNDTRIP\\n';
      await navigator.clipboard.writeText(probe);
      const back = await navigator.clipboard.readText();
      return { api: true, probe, back, preserved: back === probe };
    })()`);
    const roundtrip = roundtripRaw.ok ? roundtripRaw.value : { api: false, error: roundtripRaw.error };
    return { source, text, error, before, granted, secureUrl: secureBaseUrl, roundtrip };
  }

  return { source, text, error, before, granted: null, secureUrl: null };
}

async function shotProbe(cdp, expression) {
  return cdp.evaluate(expression);
}

const LAYOUT_EXPR = `(() => {
  const input = document.querySelector('[data-testid="pm-var-input-code"]');
  const preview = document.querySelector('[data-testid="pm-vars-preview"]');
  const dialog = document.querySelector('[data-testid="pm-vars-dialog"]');
  const modal = document.querySelector('.ant-modal');
  const modalWrap = document.querySelector('.ant-modal-wrap');
  const rect = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left * 100) / 100,
      top: Math.round(r.top * 100) / 100,
      right: Math.round(r.right * 100) / 100,
      bottom: Math.round(r.bottom * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
    };
  };
  const previewText = preview === null ? null : preview.textContent;
  const inputValue = input === null ? null : input.value;
  return {
    inputTag: input === null ? null : input.tagName,
    inputValue,
    inputNoCR: inputValue === null ? null : !inputValue.includes('\\r'),
    previewText,
    previewLines: previewText === null ? null : previewText.split('\\n'),
    previewLineCount: previewText === null ? null : previewText.split('\\n').length,
    previewHasCR: previewText === null ? null : previewText.includes('\\r'),
    previewWhiteSpace: preview === null ? null : getComputedStyle(preview).whiteSpace,
    previewOverflowY: preview === null ? null : getComputedStyle(preview).overflowY,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
      isSecureContext: window.isSecureContext,
    },
    documentElement: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    bodyScrollWidth: document.body === null ? null : document.body.scrollWidth,
    modalBody: (() => {
      const body = document.querySelector('.ant-modal-body');
      if (body === null) return null;
      const style = getComputedStyle(body);
      return {
        overflowY: style.overflowY,
        maxHeight: style.maxHeight,
        minHeight: style.minHeight,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
        scrollable: (style.overflowY === 'auto' || style.overflowY === 'scroll') && body.scrollHeight > body.clientHeight,
      };
    })(),
    modalRect: rect(modal),
    modalWrapRect: rect(modalWrap),
    dialogRect: rect(dialog),
    pageHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    modalInViewport: (() => {
      if (modal === null) return null;
      const r = modal.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
    })(),
  };
})()`;

async function main() {
  const chrome = plan.chrome ?? resolveChrome();
  if (chrome === undefined) throw new Error('找不到 chrome-headless-shell（用 plan.chrome 指定）');
  const outDir = plan.outDir;
  mkdirSync(outDir, { recursive: true });
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-s77-chrome-'));
  const child = spawn(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--window-size=1280,800',
      '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let devtoolsPort = null;
    for (let i = 0; i < 120 && devtoolsPort === null; i += 1) {
      try {
        devtoolsPort = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      } catch {
        await sleep(100);
      }
    }
    if (devtoolsPort === null || Number.isNaN(devtoolsPort)) throw new Error('chrome 未写出 DevToolsActivePort');

    const list = await waitForJson(`http://127.0.0.1:${devtoolsPort}/json/list`, 15_000);
    const page = (Array.isArray(list) ? list : []).find((target) => target.type === 'page');
    if (page === undefined) throw new Error('没有可用的 page target');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const value = plan.value;
    const inputSelector = '[data-testid="pm-var-input-code"]';

    for (const shot of plan.shots) {
      try {
      const isMobile = shot.width < 768;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: shot.dpr ?? 1,
        mobile: isMobile,
      });
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await cdp.send('Network.setCookie', {
        name: plan.cookie.name,
        value: plan.cookie.value,
        url: `${plan.lanBase}/`,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      });

      // 先拿同源写 localStorage，把视图档位固定住：桌面 split / 移动 card（默认档位，显式写防兜底差异）。
      await cdp.send('Page.navigate', { url: `${plan.lanBase}/` });
      await sleep(600);
      await cdp.evaluate(
        `(() => { localStorage.setItem('pm-view-mode', ${JSON.stringify(isMobile ? 'card' : 'split')}); return true; })()`,
      );
      await cdp.send('Page.navigate', { url: `${plan.lanBase}/` });
      await waitFor(cdp, { selector: '[data-testid="pm-search-input"]', timeoutMs: 20_000 });
      await sleep(500);

      if (isMobile) {
        await waitFor(cdp, { selector: `[data-testid="pm-copy-${plan.p1.id}"]`, timeoutMs: 15_000 });
        await mouseClick(cdp, `[data-testid="pm-copy-${plan.p1.id}"]`);
      } else {
        await waitFor(cdp, { selector: '[data-testid="pm-split-item"]', timeoutMs: 15_000 });
        await mouseClickByText(cdp, '[data-testid="pm-split-item"]', plan.p1.title);
        await waitFor(cdp, { selector: '[data-testid="pm-detail-copy"]', timeoutMs: 15_000 });
        await mouseClick(cdp, '[data-testid="pm-detail-copy"]');
      }

      await waitFor(cdp, { selector: '[data-testid="pm-vars-dialog"]', timeoutMs: 15_000 });
      await waitFor(cdp, { selector: inputSelector, timeoutMs: 15_000 });
      await sleep(400);

      const opened = await shotProbe(cdp, LAYOUT_EXPR);
      console.log(`PROBE ${shot.name}_opened ${JSON.stringify(opened)}`);

      await focusByClick(cdp, inputSelector);
      const typedValue = await insertText(cdp, inputSelector, value);
      await sleep(500);
      const multiline = await shotProbe(cdp, LAYOUT_EXPR);
      console.log(
        `PROBE ${shot.name}_multiline ${JSON.stringify({ typedValue, ...multiline })}`,
      );

      const captured = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(outDir, `${shot.name}.png`);
      const buffer = Buffer.from(captured.data, 'base64');
      writeFileSync(file, buffer);
      console.log(`SHOT ${shot.name} ${JSON.stringify({ path: file, bytes: buffer.length, width: shot.width, height: shot.height, dpr: shot.dpr })}`);

      if (shot.clipboard === true) {
        await mouseClick(cdp, '[data-testid="pm-vars-confirm"]');
        await sleep(1500);
        const afterConfirm = await cdp.evaluateSafe(
          `(() => ({ dialogOpen: document.querySelector('[data-testid="pm-vars-dialog"]') !== null, hasFocus: document.hasFocus() }))()`,
        );
        console.log(`PROBE ${shot.name}_after_confirm ${JSON.stringify(afterConfirm)}`);

        // CRLF 粘贴：同一 prompt 重开弹窗，选中全部后输入含 \r\n / 单独 \r 的值，断言预览无 \r。
        await waitFor(cdp, { selector: '[data-testid="pm-detail-copy"]', timeoutMs: 15_000 });
        await mouseClick(cdp, '[data-testid="pm-detail-copy"]');
        await waitFor(cdp, { selector: '[data-testid="pm-vars-dialog"]', timeoutMs: 15_000 });
        await waitFor(cdp, { selector: inputSelector, timeoutMs: 15_000 });
        await sleep(400);
        await focusByClick(cdp, inputSelector);
        await selectAll(cdp);
        const crlfPasted = await pasteText(cdp, inputSelector, plan.crlfValue);
        await sleep(600);
        const crlf = await shotProbe(cdp, LAYOUT_EXPR);
        console.log(
          `PROBE ${shot.name}_crlf ${JSON.stringify({ pasteSimulated: true, pastedValue: plan.crlfValue, textareaValue: crlfPasted, ...crlf })}`,
        );

        const clipboard = await readClipboard(cdp, plan.secureBase);
        console.log(`PROBE ${shot.name}_clipboard ${JSON.stringify(clipboard)}`);
      }
      } catch (error) {
        // 失败现场取证：页面状态 + 截图（tmp/stage77 下），保证失败不是黑盒。
        const message = error instanceof Error ? error.message : String(error);
        const diag = await cdp.evaluateSafe(`(() => {
          const notifications = [...document.querySelectorAll('.ant-notification-notice, .ant-message-notice')].map((n) => n.innerText);
          return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            dialogCount: document.querySelectorAll('[data-testid="pm-vars-dialog"]').length,
            detailCopyCount: document.querySelectorAll('[data-testid="pm-detail-copy"]').length,
            bodyText: document.body === null ? null : document.body.innerText.slice(0, 600),
            notifications,
          };
        })()`);
        console.log(`PROBE ${shot.name}_failure ${JSON.stringify({ message, diag })}`);
        try {
          const captured = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const file = path.join(outDir, `${shot.name}-failure.png`);
          writeFileSync(file, Buffer.from(captured.data, 'base64'));
          console.log(`SHOT ${shot.name}-failure ${JSON.stringify({ path: file })}`);
        } catch {
          /* 截图失败不掩盖原始错误 */
        }
        throw error;
      }
    }

    socket.close();
  } finally {
    child.kill('SIGKILL');
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响结果 */
    }
  }
}

main().catch((error) => {
  console.error(`FAIL ac-stage77-probe: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
