#!/usr/bin/env node
/**
 * 阶段 13 运行时探针：AC-41（无管理页 + 顶栏精简）/ AC-42（主题图标三态）/ AC-43（新建未保存不入库）。
 *
 * 零安装：Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP（与 ac-stage11/12-probe 同一套路）。
 * 用法：node tools/ac-stage13-probe.mjs <baseUrl> <sid>
 * 输出：每行 `KEY=VALUE`，由 tools/ac-stage13.sh 断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage13-probe.mjs <baseUrl> <sid>');
  process.exit(2);
}

const MANAGE_TEXTS = ['使用统计', 'API 令牌', '导入', '导出'];
const DRAFT_TITLE = '阶段13 草稿保存用例';

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
  async key(key, code, virtualKeyCode, modifiers = 0) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac13-'));
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

    const navigate = async () => {
      await cdp.send('Page.navigate', { url: `${baseUrl}/` });
      await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-search-input"]\')', '主界面出现');
      await sleep(400);
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
    const total = async () =>
      cdp.evaluate(
        `fetch('/api/prompts?limit=1', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => String(j.total))`,
      );
    const colorScheme = async () => cdp.evaluate('document.documentElement.style.colorScheme');
    const themeTitle = async () =>
      cdp.evaluate(`(() => { const el = document.querySelector('[data-testid="pm-theme-toggle"]'); return el === null ? null : el.getAttribute('title'); })()`);
    const switchView = async (label) => {
      await cdp.evaluate(
        `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const target = items.find((n) => n.innerText.indexOf(${JSON.stringify(label)}) >= 0); if (target) target.click(); return target !== undefined; })()`,
      );
      await sleep(500);
    };

    // 干净起点：清 localStorage（含主题记忆与旧模式键）后重载
    await navigate();
    await cdp.evaluate('window.localStorage.clear()');
    await navigate();

    // ---------- AC-41 无管理页 + 顶栏精简 ----------
    out.ac41_mode_use_absent = String(
      (await cdp.evaluate(`!document.querySelector('[data-testid="pm-mode-use"]')`)) === true,
    );
    out.ac41_mode_manage_absent = String(
      (await cdp.evaluate(`!document.querySelector('[data-testid="pm-mode-manage"]')`)) === true,
    );
    const topnav = (await text('pm-topnav')) ?? '';
    out.ac41_topnav_head = topnav.replace(/\n+/g, ' | ').slice(0, 160);
    out.ac41_topnav_has_new = String(topnav.includes('新建'));
    out.ac41_topnav_has_more = String(topnav.includes('更多') || topnav.includes('⋯'));
    out.ac41_theme_button = String(
      (await cdp.evaluate(`!!document.querySelector('[data-testid="pm-theme-toggle"]')`)) === true,
    );
    for (const [key, token] of [
      ['usage', '使用统计'],
      ['token', 'API 令牌'],
      ['import', '导入'],
      ['export', '导出'],
    ]) {
      out[`ac41_topnav_absent_${key}`] = String(!topnav.includes(token));
    }

    await switchView('表格');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-table"]\')', '表格视图');
    out.ac41_table_delete_count = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-delete-"]').length`);
    out.ac41_table_edit_count = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-edit-"]').length`);

    await switchView('卡片');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-card"]\')', '卡片视图');
    out.ac41_card_delete_count = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-delete-"]').length`);

    // ---------- AC-42 主题图标三态 ----------
    out.ac42_initial_scheme = (await colorScheme()) ?? '';
    out.ac42_initial_title = (await themeTitle()) ?? '';
    await clickTestId('pm-theme-toggle');
    await sleep(300);
    out.ac42_click1_scheme = (await colorScheme()) ?? '';
    out.ac42_click1_title = (await themeTitle()) ?? '';
    await clickTestId('pm-theme-toggle');
    await sleep(300);
    out.ac42_click2_scheme = (await colorScheme()) ?? '';
    out.ac42_click2_title = (await themeTitle()) ?? '';
    await clickTestId('pm-theme-toggle');
    await sleep(300);
    out.ac42_click3_scheme = (await colorScheme()) ?? '';
    out.ac42_click3_title = (await themeTitle()) ?? '';
    // 记忆：切到「亮」后刷新，应仍是 light
    await clickTestId('pm-theme-toggle');
    await sleep(300);
    out.ac42_before_reload_scheme = (await colorScheme()) ?? '';
    await navigate();
    out.ac42_after_reload_scheme = (await colorScheme()) ?? '';
    out.ac42_after_reload_title = (await themeTitle()) ?? '';

    // ---------- AC-43 新建未保存不得入库 ----------
    const t0 = await total();
    await clickTestId('header-new');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-editor"]\')', '新建编辑器出现');
    out.ac43_draft_badge = String(
      (await cdp.evaluate(`!!document.querySelector('[data-testid="editor-draft-badge"]')`)) === true,
    );
    await sleep(2000); // AC-43 ② 明确要求等 2 秒
    const t1 = await total();
    out.ac43_total_before = t0;
    out.ac43_total_after_new = t1;
    out.ac43_unchanged_after_new = String(t0 === t1);

    await cdp.type('[data-testid="editor-title"]', DRAFT_TITLE);
    await sleep(400);
    const t2 = await total();
    out.ac43_total_after_typing = t2;
    out.ac43_unchanged_after_typing = String(t0 === t2);

    await cdp.key('Escape', 'Escape', 27);
    await sleep(600);
    const t3 = await total();
    out.ac43_total_after_esc = t3;
    out.ac43_unchanged_after_esc = String(t0 === t3);
    out.ac43_editor_closed_by_esc = String(
      (await cdp.evaluate(`!document.querySelector('[data-testid="pm-editor"]')`)) === true,
    );

    // 重新新建并真的保存 → total +1，且标题等于输入值
    await clickTestId('header-new');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-editor"]\')', '第二次新建编辑器出现');
    await cdp.type('[data-testid="editor-title"]', DRAFT_TITLE);
    await sleep(300);
    await clickTestId('editor-save');
    await sleep(1200);
    const t4 = await total();
    out.ac43_total_after_save = t4;
    out.ac43_saved_delta = String(Number(t4) - Number(t0));
    out.ac43_saved_title = await cdp.evaluate(
      `fetch('/api/prompts?q=' + encodeURIComponent(${JSON.stringify(DRAFT_TITLE)}) + '&limit=50', { credentials: 'same-origin' })
         .then((r) => r.json())
         .then((j) => (j.items.some((p) => p.title === ${JSON.stringify(DRAFT_TITLE)}) ? ${JSON.stringify(DRAFT_TITLE)} : 'not-found'))`,
    );
    out.ac43_no_junk = await cdp.evaluate(
      `fetch('/api/prompts?q=' + encodeURIComponent('未命名 prompt') + '&limit=50', { credentials: 'same-origin' })
         .then((r) => r.json()).then((j) => String(j.total))`,
    );
  } finally {
    for (const [key, value] of Object.entries(out)) {
      console.log(`${key}=${String(value)}`);
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
