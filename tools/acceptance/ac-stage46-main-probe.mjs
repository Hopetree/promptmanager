#!/usr/bin/env node
/**
 * 阶段 46 / AC-110 ④ 主界面冒烟探针（真浏览器）：
 *   登录后主界面在 390×844 与 1600×900 下
 *     · 无纵向溢出（documentElement.scrollHeight <= innerHeight）
 *     · 无横向滚动（documentElement.scrollWidth <= innerWidth）
 *     · 有真实内容（prompt 列表行 > 0）—— 证明不是"空白页所以不溢出"
 *
 * 输出 main_390= / main_1600= / main_runtime_errors= 三行 JSON，供 shell jq 断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage46-main-probe.mjs <baseUrl> <sid> [shotsDir]');
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
  async waitFor(expression, label, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
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

/** 主界面几何。`pm-brand-mark` 两种视口都在（品牌文字是桌面专属）。 */
const GEO = `(() => {
  const de = document.documentElement;
  return JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollHeight: de.scrollHeight,
    docScrollWidth: de.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
    // 真实内容判据：列表卡片/表格行数（避免"空白页也不溢出"的假绿）
    promptRows: document.querySelectorAll('.ant-table-row, [data-testid^="pm-card-"], [data-testid^="pm-item-"]').length,
    hasHeader: document.querySelector('[data-testid="pm-brand-mark"]') !== null,
  });
})()`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac46m-'));
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
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });

    for (const vp of [{ w: 390, h: 844 }, { w: 1600, h: 900 }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 768,
      });
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(`document.querySelector('[data-testid="pm-brand-mark"]') !== null`, '主界面（已登录）');
      // 等页面稳定：几何连续三次采样一致
      await cdp.evaluate(`(() => { window.__pm46m = []; return true; })()`);
      await cdp.waitFor(
        `(() => {
          const de = document.documentElement;
          const sig = de.scrollHeight + '/' + de.scrollWidth;
          window.__pm46m.push(sig);
          if (window.__pm46m.length > 3) window.__pm46m.shift();
          return window.__pm46m.length === 3 && window.__pm46m.every((s) => s === sig);
        })()`,
        '主界面几何稳定',
        15_000,
      );
      await sleep(300);
      out[`main_${String(vp.w)}`] = await cdp.evaluate(GEO);
    }
    out.main_runtime_errors = JSON.stringify(cdp.errors);
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
