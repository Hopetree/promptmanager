#!/usr/bin/env node
/**
 * 阶段 11 运行时探针（v17 修订）：AC-33 / AC-33b / AC-33c / AC-35 / AC-36（+ AC-21 回归）。
 * ⚠️ AC-34（使用/管理分离、模式记忆）自 BRIEF v17 起**作废**，本节已移除。
 *
 * 零安装：Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP；
 * 剪贴板：连**浏览器级** target 发 `Browser.grantPermissions`（页面级会话不保证接受该命令），
 * 然后用页面会话跑交互、用 `navigator.clipboard.readText()` 读回真实剪贴板内容。
 *
 * 用法：node tools/ac-stage11-probe.mjs <baseUrl> <sid> <plainPromptId> <varsPromptId>
 * 输出：每行 `KEY=VALUE`，由 tools/ac-stage11.sh 断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, plainIdRaw, varsIdRaw] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined || plainIdRaw === undefined || varsIdRaw === undefined) {
  console.error('用法：node tools/ac-stage11-probe.mjs <baseUrl> <sid> <plainPromptId> <varsPromptId>');
  process.exit(2);
}
const plainId = Number(plainIdRaw);
const varsId = Number(varsIdRaw);

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
    if (result.exceptionDetails !== undefined) {
      throw new Error(`页面内求值失败：${result.exceptionDetails.text ?? ''}`);
    }
    return result.result?.value;
  }
  async waitFor(expression, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
  }
  async type(selector, text) {
    const focused = await cdp.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`,
    );
    if (focused !== true) throw new Error(`找不到输入框：${selector}`);
    await this.send('Input.insertText', { text });
  }
  async key(key, code, virtualKeyCode, modifiers = 0, text) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
      ...(text === undefined ? {} : { text }),
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
    });
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac11-'));
  const child = spawn(
    CHROME,
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

    // 浏览器级会话：只用来授权剪贴板
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browserSocket = await openSocket(version.webSocketDebuggerUrl);
    const browser = new Cdp(browserSocket);
    const origin = new URL(baseUrl).origin;
    await browser.send('Browser.grantPermissions', {
      origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const socket = await openSocket(page.webSocketDebuggerUrl);
    const cdp = new Cdp(socket);
    globalThis.cdp = cdp;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.setCookie', {
      name: 'pm_sid',
      value: sid,
      domain: new URL(baseUrl).hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    // v17 起没有「使用 / 管理」双模式；v19 起默认落「分栏」。
    // 本阶段用例都在**卡片视图**（一键复制按钮 / 双击卡片开详情），所以 navigate 后统一切到卡片。
    const navigate = async (hash = '') => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/${hash}` });
      await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-search-input"]\')', '主界面出现');
      await cdp.evaluate(
        `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const t = items.find((n) => n.innerText.includes('卡片')); if (t) { t.click(); return true; } return false; })()`,
      );
      await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-card"]\')', '卡片视图');
      await sleep(300);
    };
    const clickTestId = async (testid) => {
      const ok = await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]'); if (!el) return false; el.click(); return true; })()`,
      );
      if (ok !== true) throw new Error(`点不到 [data-testid=${testid}]`);
    };
    const text = async (testid) =>
      cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]'); return el === null ? null : el.innerText; })()`,
      );

    // ---------- AC-33 一键复制（无变量条目） ----------
    await navigate();
    const usageBefore = await cdp.evaluate(
      `fetch('/api/usage/summary?days=7', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.by_channel.session)`,
    );
    await clickTestId(`pm-copy-${String(plainId)}`);
    await sleep(700);
    out.clipboardPlain = await cdp.evaluate('navigator.clipboard.readText()');
    out.toastAfterCopy = String(
      (await cdp.evaluate(`(document.body.innerText || '').includes('已复制')`)) === true,
    );
    // usage 先在"复制之后、任何验证性 GET 之前"读（验证用的 GET 详情本身也会记一次取用）
    const usageAfter = await cdp.evaluate(
      `fetch('/api/usage/summary?days=7', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.by_channel.session)`,
    );
    out.usageSessionDelta = String(Number(usageAfter) - Number(usageBefore));
    // 剪贴板内容 vs 服务端的 user_prompt：逐字符比对（AC-33 的核心判据；readText 是 Promise，要 then 出来比）
    out.plainMatchesApi = await cdp.evaluate(
      `fetch('/api/prompts/${String(plainId)}', { credentials: 'same-origin' })
         .then((r) => r.json())
         .then((j) => navigator.clipboard.readText().then((t) => (j.user_prompt === t) ? 'true' : 'false'))`,
    );

    // ---------- AC-33b 填变量对话框 + 自动记忆（v15：未填变量原样保留 {{name}}） ----------
    await clickTestId(`pm-copy-${String(varsId)}`);
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-vars-dialog"]\')', '填变量对话框');
    out.varsDialog = 'true';
    // 「填一个、留一个」：只填「姓名」，「项目」保持未填
    out.varsMissingHintBefore = await text('pm-vars-missing');
    const previewBefore = await text('pm-vars-preview');
    await cdp.type('[data-testid="pm-var-input-姓名"]', '张三');
    await sleep(400);
    const previewAfter = await text('pm-vars-preview');
    out.varsPreviewBefore = previewBefore;
    out.varsPreviewAfter = previewAfter;
    out.varsMissingHintAfter = await text('pm-vars-missing');
    out.varsPreviewChanged = String(previewBefore !== previewAfter);
    // v15 的核心断言：未填的 {{项目}} 必须原样保留，已填的 姓名 必须被替换
    out.varsPreviewExact = String(previewAfter === '你好 张三，项目 {{项目}}。');
    out.varsPreviewKeepsPlaceholder = String(previewAfter !== null && previewAfter.includes('{{项目}}'));
    out.varsPreviewReplacedFilled = String(previewAfter !== null && previewAfter.includes('张三') && !previewAfter.includes('{{姓名}}'));
    await clickTestId('pm-vars-confirm');
    await sleep(700);
    out.clipboardVars = await cdp.evaluate('navigator.clipboard.readText()');
    out.varsClipboardMatchesPreview = String(out.clipboardVars === previewAfter);
    out.varsClipboardKeepsPlaceholder = String(
      typeof out.clipboardVars === 'string' && out.clipboardVars.includes('{{项目}}'),
    );
    // 再打开一次：输入框应预填上次的值（localStorage 记忆）；未填的那个仍为空
    await cdp.waitFor(
      `!document.querySelector('[data-testid="pm-vars-dialog"]')`,
      '对话框已关闭（等待关闭后再开）',
    );
    await clickTestId(`pm-copy-${String(varsId)}`);
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-vars-dialog"]\')', '再次打开填变量对话框');
    await sleep(300);
    out.varsRemembered = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-var-input-姓名"]'); return el === null ? 'missing' : el.value; })()`,
    );
    out.varsUnfilledStaysEmpty = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-var-input-项目"]'); return el === null ? 'missing' : el.value; })()`,
    );
    out.varsRememberedPreview = await text('pm-vars-preview');
    await cdp.key('Escape', 'Escape', 27);
    await sleep(300);

    // ---------- AC-36 快捷：/ 聚焦、双击开详情、Esc 关 ----------
    await cdp.key('/', 'Slash', 191, 0, '/');
    await sleep(200);
    out.slashFocusesSearch = String(
      (await cdp.evaluate(
        `(() => { const el = document.activeElement; return el !== null && el.getAttribute('data-testid') === 'pm-search-input'; })()`,
      )) === true,
    );
    await cdp.evaluate(
      `(() => { const card = document.querySelector('[data-testid="pm-use-card"]'); if (!card) return false; card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`,
    );
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-detail"]\')', '双击打开详情');
    out.detailOpenedByDblClick = 'true';
    out.detailActions = String((await cdp.evaluate(`!!document.querySelector('[data-testid="pm-detail-actions"]')`)) === true);
    out.detailActionsCopyPrimary = await cdp.evaluate(
      `(() => {
        const bar = document.querySelector('[data-testid="pm-detail-actions"]');
        if (!bar) return 'missing';
        const buttons = [...bar.querySelectorAll('button')];
        return buttons.map((b) => b.innerText.trim()).join(' | ');
      })()`,
    );
    out.detailActionsHasVersions = String(
      (await cdp.evaluate(`!!document.querySelector('[data-testid="pm-detail-version-jump"]')`)) === true,
    );
    out.detailActionsHasDelete = String(
      (await cdp.evaluate(`!!document.querySelector('[data-testid="pm-detail-delete"]')`)) === true,
    );
    await cdp.key('Escape', 'Escape', 27);
    await cdp.waitFor(`!document.querySelector('[data-testid="pm-detail"]')`, 'Esc 关闭详情');
    out.detailClosedByEsc = 'true';

    // ---------- AC-35 移动端：默认使用视图 + 复制按钮 ≥44×44 ----------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate();
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-card"]\')', '移动端主界面');
    out.mobileDefaultUse = 'true';
    out.mobileCopyRect = await cdp.evaluate(
      `(() => {
        const el = document.querySelector('[data-testid="pm-copy-${String(plainId)}"]');
        if (!el) return 'missing';
        const r = el.getBoundingClientRect();
        return JSON.stringify({ visible: el.offsetParent !== null, w: Math.round(r.width), h: Math.round(r.height) });
      })()`,
    );
    out.mobileOverflow = String(
      (await cdp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) === true,
    );

    // ---------- AC-21 回归（使用视图的 ant-* 类名数） ----------
    out.antClasses = await cdp.evaluate(
      `(() => { const s = new Set(); document.querySelectorAll('*').forEach((el) => { const c = el.getAttribute('class'); if (!c) return; c.split(/\\s+/).forEach((t) => { if (t.startsWith('ant-')) s.add(t); }); }); return s.size; })()`,
    );

    for (const [key, value] of Object.entries(out)) console.log(`${key}=${String(value)}`);
    browserSocket.close();
    socket.close();
  } finally {
    child.kill('SIGKILL');
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }
}

main().catch((error) => {
  console.error(`FAIL ac-stage11-probe: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
