#!/usr/bin/env node
/**
 * 阶段 32 运行时探针（**真鼠标**：Input.dispatchMouseEvent 的 moved/pressed/released；零 JS .click()；
 * 输入用 CDP `Input.insertText`（真实 input 事件），并在提交前回读 DOM value 自证输入生效）：
 *
 *   login <baseUrl> [shotsDir]
 *     AC-90 ① 用户名输入框 `value === ''`（未登录态打开登录页）
 *     AC-90 ② 运行时 DOM（innerHTML + innerText）里默认账号名出现次数 = 0
 *     AC-90 ③ 保留项：品牌图（pm-brand-art-login，96×96）/ PromptManager / 用户名 / 口令 / 登录按钮；
 *              四条噪音文案在页面文本里出现次数 = 0
 *     AC-90 ④ 真鼠标填用户名 + 口令 → 登录成功进主界面；错误口令 → 有可读错误提示；
 *              亮/暗截图 + 移动端（390×844）不横向溢出
 *
 * 本探针**只 dump 事实、不做断言**（断言在 tools/ac-stage32.sh）——
 * 这样同一个探针可以在"改前/改后"各跑一次，给出真实的 DOM 对照。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['login'];
const [mode, baseUrl, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined) {
  console.error(`用法：node tools/ac-stage32-probe.mjs <${MODES.join('|')}> <baseUrl> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage32';
const USER = process.env.AC32_USER ?? 'admin';
const PW = process.env.AC32_PW ?? '';
/** 默认账号名（探针自己用来"搜 DOM"的needle；不是产品里的值） */
const NEEDLE = process.env.AC32_NEEDLE ?? 'admin';
/** FR-88 ② 要删干净的四条噪音 */
const NOISE = ['SELF-HOSTED', '数据只在本机', '网页不提供注册', '未认证一律'];

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
  async centerOf(jsExpr) {
    const value = await this.evaluate(
      `(() => { const el = (${jsExpr}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${jsExpr}`);
    return JSON.parse(value);
  }
  async clickPoint(point, settle = 400) {
    const { x, y } = point;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }
  async realClickOf(jsExpr, settle = 400) {
    await this.clickPoint(await this.centerOf(jsExpr), settle);
  }
  /** 真鼠标点进输入框 → 用 CDP 插入文本（触发真实 input 事件）→ 回读 value 自证 */
  async typeInto(jsExpr, text) {
    await this.realClickOf(jsExpr, 250);
    await this.send('Input.insertText', { text });
    await sleep(250);
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

const LOGIN = `document.querySelector('[data-testid="pm-login"]')`;
const USER_INPUT = `document.querySelector('[data-testid="pm-login"] input[autocomplete="username"]')`;
const PW_INPUT = `document.querySelector('[data-testid="pm-login"] input[autocomplete="current-password"]')`;
const SUBMIT = `document.querySelector('[data-testid="pm-login"] button[type="submit"]')`;
const BRAND = `document.querySelector('[data-testid="pm-brand-art-login"]')`;

/** 页面文本/HTML 里 needle 出现次数（大小写不敏感）+ 四条噪音各自次数 */
const scan = (needle, noise) =>
  `JSON.stringify((() => {
     const root = ${LOGIN} ?? document.body;
     const html = root.innerHTML;
     const text = root.innerText;
     const count = (hay, n) => hay.toLowerCase().split(n.toLowerCase()).length - 1;
     const noiseHits = {};
     for (const n of ${JSON.stringify(noise)}) noiseHits[n] = count(text, n) + count(html, n);
     return {
       needleInHtml: count(html, ${JSON.stringify(needle)}),
       needleInText: count(text, ${JSON.stringify(needle)}),
       noiseHits,
       textSample: text.split('\\n').map((s) => s.trim()).filter((s) => s !== '').join(' | '),
     };
   })())`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac32-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1600,900', '--user-data-dir=' + userDataDir, '--remote-debugging-port=0', 'about:blank'],
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

    const prefs = (values) =>
      cdp.evaluate(Object.entries(values).map(([k, v]) => `window.localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('') + 'true');
    const openLogin = async () => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor(`${LOGIN} !== null`, '登录页');
      await sleep(700);
    };

    // ---------- 未登录态打开登录页（亮色）----------
    await openLogin();
    await prefs({ 'pm-theme': 'light', 'pm-view-mode': 'split' });
    await openLogin();

    out.ac90_username_value = await cdp.evaluate(
      `JSON.stringify((() => { const el = ${USER_INPUT}; return el === null ? null : { value: el.value, placeholder: el.placeholder, autocomplete: el.getAttribute('autocomplete'), type: el.type }; })())`,
    );
    out.ac90_password_value = await cdp.evaluate(
      `JSON.stringify((() => { const el = ${PW_INPUT}; return el === null ? null : { value: el.value, placeholder: el.placeholder, autocomplete: el.getAttribute('autocomplete') }; })())`,
    );
    out.ac90_scan = await cdp.evaluate(scan(NEEDLE, NOISE));
    out.ac90_keep = await cdp.evaluate(
      `JSON.stringify((() => {
         const brand = ${BRAND};
         const r = brand === null ? null : brand.getBoundingClientRect();
         return {
           brandArt: brand !== null,
           brandArtSize: r === null ? null : { w: Math.round(r.width), h: Math.round(r.height), src: brand.getAttribute('src') },
           title: document.querySelector('[data-testid="pm-login"]')?.innerText.includes('PromptManager') ?? false,
           usernameInput: ${USER_INPUT} !== null,
           passwordInput: ${PW_INPUT} !== null,
           submitButton: ${SUBMIT} !== null,
           submitText: ${SUBMIT} === null ? null : ${SUBMIT}.innerText.trim(),
         };
       })())`,
    );
    out.ac90_login_light_overflow = await cdp.evaluate(
      `JSON.stringify({ docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth })`,
    );
    await cdp.shot('01-login-light');

    // ---------- ④ 错误口令 → 可读错误提示 ----------
    out.ac90_wrong_typed_user = await cdp.typeInto(USER_INPUT, USER);
    out.ac90_wrong_typed_pw = await cdp.typeInto(PW_INPUT, `${PW}-definitely-wrong`);
    await cdp.realClickOf(SUBMIT, 1200);
    await cdp.waitFor(`document.querySelector('[data-testid="pm-login"] .ant-alert-error') !== null`, '错误提示');
    out.ac90_wrong_password = await cdp.evaluate(
      `JSON.stringify((() => { const el = document.querySelector('[data-testid="pm-login"] .ant-alert-error'); const r = el.getBoundingClientRect(); return { alertText: el.innerText.trim(), visible: r.width > 0 && r.height > 0, stillOnLogin: ${LOGIN} !== null }; })())`,
    );
    await cdp.shot('02-login-error-light');

    // ---------- ④ 移动端（390×844）不横向溢出 ----------
    await openLogin();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(900);
    out.ac90_mobile_overflow = await cdp.evaluate(
      `JSON.stringify({ docScrollWidth: document.documentElement.scrollWidth, docClientWidth: document.documentElement.clientWidth, loginWidth: Math.round(${LOGIN}.getBoundingClientRect().width), viewport: window.innerWidth })`,
    );
    out.ac90_mobile_username_value = await cdp.evaluate(`JSON.stringify(${USER_INPUT} === null ? null : ${USER_INPUT}.value)`);
    await cdp.shot('03-login-mobile');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(600);

    // ---------- ④ 暗色截图 ----------
    await prefs({ 'pm-theme': 'dark' });
    await openLogin();
    out.ac90_dark_scan = await cdp.evaluate(scan(NEEDLE, NOISE));
    out.ac90_dark_bg = await cdp.evaluate(`JSON.stringify(getComputedStyle(${LOGIN}).backgroundColor)`);
    await cdp.shot('04-login-dark');

    // ---------- ④ 正确口令 → 真鼠标登录 → 进主界面 ----------
    await prefs({ 'pm-theme': 'light' });
    await openLogin();
    out.ac90_login_typed_user = await cdp.typeInto(USER_INPUT, USER);
    out.ac90_login_typed_pw = await cdp.typeInto(PW_INPUT, PW);
    await cdp.realClickOf(SUBMIT, 1500);
    await cdp.waitFor(`document.querySelector('[data-testid="pm-login"]') === null`, '登录成功（登录页消失）', 20_000);
    await sleep(900);
    out.ac90_after_login = await cdp.evaluate(
      `JSON.stringify({
         loginGone: document.querySelector('[data-testid="pm-login"]') === null,
         headerBrand: document.querySelector('[data-testid="pm-brand-text"]')?.innerText.trim() ?? null,
         splitList: document.querySelector('[data-testid="pm-split-list"]') !== null,
         cardOrTable: document.querySelector('[data-testid="pm-view-table"]') !== null || document.querySelector('[data-testid="pm-view-card"]') !== null || document.querySelector('[data-testid="pm-split-list"]') !== null,
       })`,
    );
    await cdp.shot('05-after-login-light');
    out.ac32_runtime_errors = JSON.stringify(cdp.errors);
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
