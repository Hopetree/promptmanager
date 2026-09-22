#!/usr/bin/env node
/**
 * 登录页纵向溢出探针（FR-108 / AC-110 ①②③）
 *
 *   measure <baseUrl> <shotsDir> [label]
 *     · 390×844 与 1600×900 两个视口，各自：
 *       - 等**页面稳定**（字体就位 + 连续两帧几何一致）再量，避免量到中间态
 *       - 量 #pm-login 的 getBoundingClientRect()（height/top/left/width）
 *       - 量 documentElement.scrollHeight / innerHeight / 差
 *       - 量标题、用户名输入、口令输入、登录按钮的 x / width（用于"视觉不变 ±2px"）
 *       - 截图 <label>-390.png / <label>-1600.png
 *
 * 输出 `key=value` 行（供 shell 断言）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, baseUrl, shotsDir = 'tmp/shots/stage46', label = 'shot'] = process.argv.slice(2);
if (mode !== 'measure' || baseUrl === undefined) {
  console.error('用法：node tools/ac-stage46-probe.mjs measure <baseUrl> [shotsDir] [label]');
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
  async waitFor(expression, labelText, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${labelText}`);
      await sleep(120);
    }
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

/** 登录页几何（等稳定后调用）。 */
const GEO = `(() => {
  const de = document.documentElement;
  const r = (el) => { if (el === null) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), width: Math.round(b.width), top: Math.round(b.top), height: Math.round(b.height) }; };
  const root = document.querySelector('[data-testid="pm-login"]');
  // 元素按**真实 DOM 结构**取（登录页是 antd Flex + Typography.Title + Form + Input + Button）
  const title = root === null ? null : root.querySelector('h1');
  const inputs = root === null ? [] : [...root.querySelectorAll('input')];
  const userInput = inputs.find((el) => el.type === 'text') ?? null;
  const passInput = inputs.find((el) => el.type === 'password') ?? null;
  const submit = root === null ? null : root.querySelector('button[type="submit"]');
  return JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    loginTop: r(root)?.top ?? null,
    loginHeight: r(root)?.height ?? null,
    loginWidth: r(root)?.width ?? null,
    docScrollHeight: de.scrollHeight,
    docClientHeight: de.clientHeight,
    overflowY: de.scrollHeight - window.innerHeight,
    title: r(title),
    userInput: r(userInput),
    passInput: r(passInput),
    submit: r(submit),
    bodyScrollHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    rootStyle: (() => { const s = getComputedStyle(root); return { minHeight: s.minHeight, height: s.height, padding: s.padding, display: s.display, alignItems: s.alignItems, justifyContent: s.justifyContent, boxSizing: s.boxSizing }; })(),
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac46-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1600,900', '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=0', 'about:blank'],
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
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const cdp = new Cdp(await openSocket(page.webSocketDebuggerUrl));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    for (const vp of [{ w: 390, h: 844 }, { w: 1600, h: 900 }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 768,
      });
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      // 等登录页出现
      await cdp.waitFor(`document.querySelector('[data-testid="pm-login"]') !== null`, '#pm-login 出现');
      /**
       * ⚠️ 等**页面稳定**：字体/布局就位前 getBoundingClientRect 会量到中间态。
       * 判据 = 连续三次采样的（loginHeight + docScrollHeight）完全一致。
       */
      await cdp.evaluate(`(() => { window.__pm46 = []; return true; })()`);
      await cdp.waitFor(
        `(() => {
          const de = document.documentElement;
          const root = document.querySelector('[data-testid="pm-login"]');
          const sig = String(root === null ? -1 : Math.round(root.getBoundingClientRect().height)) + '/' + String(de.scrollHeight);
          window.__pm46.push(sig);
          if (window.__pm46.length > 3) window.__pm46.shift();
          return window.__pm46.length === 3 && window.__pm46.every((s) => s === sig);
        })()`,
        '登录页几何连续三次采样一致（页面已稳定）',
        15_000,
      );
      await cdp.evaluate(`document.fonts !== undefined && document.fonts.ready`);
      await sleep(300);
      const key = String(vp.w);
      out[`geo_${key}`] = await cdp.evaluate(GEO);
      await cdp.shot(`${label}-${key}`);
    }
    out.runtime_errors = JSON.stringify(cdp.errors);
  } finally {
    for (const [k, v] of Object.entries(out)) console.log(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

await main();
