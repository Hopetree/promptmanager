#!/usr/bin/env node
/**
 * 设计稿截图器（阶段 10A 专用，零安装）：
 * 用 Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP，对**本地 file:// 设计稿**截图 ——
 * 支持 1280×800 / 390×844、prefers-color-scheme 亮暗模拟、hash 视图切换。
 *
 * 为什么不复用 tools/ui-shot.mjs：那个是给"已起服务的应用"用的（要注入登录 cookie、要 walk 应用交互）；
 * 设计稿是静态文件，不需要服务、也不该占用 8767（8767 现在是已部署生产实例）。
 *
 * 用法：node docs/design/tools/design-shots.mjs <plan.json>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const planPath = process.argv[2];
if (planPath === undefined) {
  console.error('用法：node docs/design/tools/design-shots.mjs <plan.json>');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
];

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

async function main() {
  const chrome = plan.chrome ?? CHROME_CANDIDATES.find((c) => existsSync(c));
  if (chrome === undefined) throw new Error('找不到 chrome-headless-shell');
  mkdirSync(plan.outDir, { recursive: true });

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-design-chrome-'));
  const child = spawn(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--allow-file-access-from-files',
      '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

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

    const list = await waitForJson(`http://127.0.0.1:${port}/json/list`, 15_000);
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    if (page === undefined) throw new Error('没有可用的 page target');

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

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
      await cdp.send('Page.navigate', { url: shot.url });
      // 等 readyState 完成 + 目标元素出现（最多 10s）
      const deadline = Date.now() + 10_000;
      for (;;) {
        const ready = await cdp.evaluate(
          `document.readyState === 'complete' && ${shot.waitFor === undefined ? 'true' : `!!document.querySelector(${JSON.stringify(shot.waitFor)})`}`,
        );
        if (ready === true) break;
        if (Date.now() > deadline) throw new Error(`等待页面就绪超时：${shot.name}`);
        await sleep(120);
      }
      await sleep(shot.settleMs ?? 250);
      const captured = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(plan.outDir, `${shot.name}.png`);
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
      /* 清理失败不影响结果 */
    }
  }
}

main().catch((error) => {
  console.error(`FAIL design-shots: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
