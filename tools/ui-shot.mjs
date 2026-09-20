#!/usr/bin/env node
/**
 * 零安装截图器：用 Node 24 内置的 `WebSocket` 直连 `chrome-headless-shell` 的 CDP，
 * 完成「设置设备尺寸 → 设置亮/暗媒体 → 注入会话 cookie → 打开页面 → 交互 → 截图 / dump DOM」。
 *
 * 不装 puppeteer/playwright（BRIEF §6.8 的零安装口径）；也不给服务端加"截图专用"后门：
 * 会话 cookie 由 `tools/ui-shots.sh` 通过真实的 `POST /api/login` 取得后再传进来。
 *
 * 用法：node tools/ui-shot.mjs <plan.json>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const planPath = process.argv[2];
if (planPath === undefined) {
  console.error('用法：node tools/ui-shot.mjs <plan.json>');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultChrome() {
  const candidates = [
    '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
    '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  ];
  return candidates.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

/** 极简 CDP 客户端：一个 WebSocket + 自增 id 的请求/响应配对。 */
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
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails !== undefined) {
      throw new Error(`页面内求值失败：${result.exceptionDetails.text ?? ''} ${expression}`);
    }
    return result.result?.value;
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

async function waitFor(cdp, { selector, text, timeoutMs = 8000 }) {
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
    if (Date.now() > deadline) {
      throw new Error(`等待超时：${selector === undefined ? `text=${text}` : `selector=${selector}`}`);
    }
    await sleep(120);
  }
}

/** 找到真正可输入的元素（antd 的 Input.Search 外层可能是 wrapper）。 */
function inputSelectorScript(selector) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) return null;
    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return node;
    return node.querySelector('input, textarea');
  })()`;
}

async function runAction(cdp, action) {
  if (action.type === 'eval') {
    await cdp.evaluate(action.expression);
    return;
  }
  if (action.type === 'view') {
    // 切换卡片 / 表格 / 列表视图（v17 唯一主界面的 Segmented）
    const switched = await cdp.evaluate(
      `(() => {
        const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')];
        const target = items.find((n) => n.innerText.includes(${JSON.stringify(action.label)}));
        if (target) { target.click(); return true; }
        return false;
      })()`,
    );
    if (switched !== true) throw new Error(`切不到视图：${action.label}`);
    return;
  }
  if (action.type === 'menu') {
    // 顶栏「⋯更多」→ 点某个菜单项（v17：管理动作都在这里）
    const opened = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="header-more"]'); if (el === null) return false; el.click(); return true; })()`,
    );
    if (opened !== true) throw new Error('找不到顶栏「⋯更多」');
    await waitFor(cdp, { selector: '.ant-dropdown-menu' });
    const clicked = await cdp.evaluate(
      `(() => {
        const items = [...document.querySelectorAll('.ant-dropdown-menu-item')];
        const target = items.find((n) => n.innerText.includes(${JSON.stringify(action.label)}));
        if (target) { target.click(); return true; }
        return false;
      })()`,
    );
    if (clicked !== true) throw new Error(`⋯更多 菜单里找不到：${action.label}`);
    return;
  }
  if (action.type === 'click') {
    const clicked = await cdp.evaluate(
      `(() => { const node = document.querySelector(${JSON.stringify(action.selector)}); if (node === null) return false; node.click(); return true; })()`,
    );
    if (clicked !== true) throw new Error(`点击失败，找不到元素：${action.selector}`);
    return;
  }
  if (action.type === 'type') {
    const found = await cdp.evaluate(`(() => { const node = ${inputSelectorScript(action.selector)}; if (node === null) return false; node.focus(); return true; })()`);
    if (found !== true) throw new Error(`输入失败，找不到输入框：${action.selector}`);
    await cdp.send('Input.insertText', { text: action.text });
    const value = await cdp.evaluate(`(() => { const node = ${inputSelectorScript(action.selector)}; return node === null ? null : node.value; })()`);
    if (typeof value !== 'string' || !value.includes(action.text)) {
      // 兜底：逐字符 keyDown/char/keyUp（部分版本对 insertText 不触发 React onChange）
      for (const char of action.text) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp' });
      }
    }
    return;
  }
  if (action.type === 'enter') {
    const keys = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...keys, text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keys });
    return;
  }
  if (action.type === 'hover') {
    const center = await cdp.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(action.selector)}); if (el === null) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`,
    );
    if (center === null) throw new Error(`悬浮失败，找不到元素：${action.selector}`);
    const { x, y } = JSON.parse(center);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    return;
  }
  if (action.type === 'file') {
    // 给 <input type=file> 装一个真实文件（导入界面 FR-11b 的证据要用真文件走真解析）
    await cdp.send('DOM.enable');
    const document_ = await cdp.send('DOM.getDocument', { depth: -1 });
    const found = await cdp.send('DOM.querySelector', { nodeId: document_.root.nodeId, selector: action.selector });
    if (!found.nodeId) throw new Error(`找不到文件输入框：${action.selector}`);
    await cdp.send('DOM.setFileInputFiles', { files: action.files, nodeId: found.nodeId });
    return;
  }
  if (action.type === 'probe') {
    const value = await cdp.evaluate(action.expression);
    console.log(`PROBE ${action.name} ${JSON.stringify(value)}`);
    return;
  }
  if (action.type === 'wait') {
    await waitFor(cdp, action);
    return;
  }
  if (action.type === 'sleep') {
    await sleep(action.ms);
    return;
  }
  throw new Error(`未知动作：${action.type}`);
}

async function main() {
  const chrome = plan.chrome ?? defaultChrome();
  if (chrome === undefined) throw new Error('找不到 chrome-headless-shell（用 plan.chrome 指定）');

  const outDir = plan.outDir;
  const dumpsDir = plan.dumpsDir;
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dumpsDir, { recursive: true });

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-chrome-'));
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
    for (let i = 0; i < 100 && devtoolsPort === null; i += 1) {
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

    for (const shot of plan.shots) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: 1,
        mobile: shot.width < 600,
      });
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: shot.dark === true ? 'dark' : 'light' }],
      });

      if (shot.auth === true && plan.cookie !== undefined) {
        await cdp.send('Network.setCookie', {
          name: plan.cookie.name,
          value: plan.cookie.value,
          domain: plan.cookie.domain,
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        });
      } else {
        await cdp.send('Network.clearBrowserCookies');
      }

      const url = `${plan.baseUrl}${shot.path ?? '/'}`;
      // 主题（FR-44）等"挂载时读 localStorage"的偏好：先加载一次拿同源，写入 localStorage 后再导航
      if (shot.storage !== undefined) {
        await cdp.send('Page.navigate', { url });
        await sleep(500);
        const script = Object.entries(shot.storage)
          .map(([key, value]) =>
            value === null
              ? `localStorage.removeItem(${JSON.stringify(key)})`
              : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))})`,
          )
          .join('; ');
        await cdp.evaluate(`(() => { ${script}; return true; })()`);
      }
      await cdp.send('Page.navigate', { url });
      if (shot.waitFor !== undefined) await waitFor(cdp, { selector: shot.waitFor, timeoutMs: shot.timeoutMs ?? 10_000 });
      else if (shot.waitText !== undefined) await waitFor(cdp, { text: shot.waitText, timeoutMs: shot.timeoutMs ?? 10_000 });
      for (const action of shot.actions ?? []) await runAction(cdp, action);
      if (shot.dump !== undefined) {
        const html = await cdp.evaluate('document.documentElement.outerHTML');
        const dumpPath = path.join(dumpsDir, `${shot.dump}.html`);
        writeFileSync(dumpPath, html ?? '');
        const classes = new Set(String(html ?? '').match(/ant-[a-z-]+/g) ?? []);
        console.log(`ANT_CLASSES ${shot.dump} ${classes.size} (dom=${dumpPath})`);
      }
      await sleep(shot.settleMs ?? 250);

      const captured = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(outDir, `${shot.name}.png`);
      const buffer = Buffer.from(captured.data, 'base64');
      writeFileSync(file, buffer);
      console.log(`SHOT ${shot.name} ${shot.width}x${shot.height} dark=${shot.dark === true ? 'true' : 'false'} -> ${file} (${buffer.length} bytes)`);
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
  console.error(`FAIL ui-shot: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
