#!/usr/bin/env node
/**
 * 阶段 14 运行时探针：AC-44（分栏视图存在且为默认）/ AC-45（档位顺序与「列表」档删除）/
 * AC-46（分栏右栏复用详情面能力）。
 *
 * 零安装：Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP。
 * 用法：node tools/ac-stage14-probe.mjs <baseUrl> <sid> <varsPromptTitle>
 * 输出：每行 `KEY=VALUE`，由 tools/ac-stage14.sh 断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, varsTitle] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined || varsTitle === undefined) {
  console.error('用法：node tools/ac-stage14-probe.mjs <baseUrl> <sid> <varsPromptTitle>');
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
    /** CDP 事件（用于 AC-45 ⑤ 收集控制台报错） */
    this.events = [];
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
      } else if (message.method !== undefined) {
        this.events.push(message);
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
  /** 控制台报错（Runtime.exceptionThrown / console.error / Log error） */
  errorCount() {
    const logs = this.events.filter(
      (m) =>
        m.method === 'Runtime.exceptionThrown' ||
        (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') ||
        (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error'),
    );
    return logs.length;
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac14-'));
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
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const browserSocket = await openSocket(version.webSocketDebuggerUrl);
    const browser = new Cdp(browserSocket);
    await browser.send('Browser.grantPermissions', {
      origin: new URL(baseUrl).origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    const socket = await openSocket(page.webSocketDebuggerUrl);
    const cdp = new Cdp(socket);
    globalThis.cdp = cdp;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
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
      await sleep(600);
    };
    const clickTestId = async (testid) => {
      const ok = await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]'); if (!el) return false; el.click(); return true; })()`,
      );
      if (ok !== true) throw new Error(`点不到 [data-testid=${testid}]`);
      await sleep(300);
    };
    const viewMode = async (label) => {
      const ok = await cdp.evaluate(
        `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const t = items.find((n) => n.innerText.includes(${JSON.stringify(label)})); if (t) { t.click(); return true; } return false; })()`,
      );
      if (ok !== true) throw new Error(`切不到视图：${label}`);
      await sleep(600);
    };
    const selectedViewLabel = async () =>
      cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="pm-use-viewmode"] .ant-segmented-item-selected'); return el === null ? null : el.innerText.trim(); })()`,
      );
    const itemTitles = async () =>
      cdp.evaluate(
        `[...document.querySelectorAll('[data-testid="pm-split-item"]')].map((el) => (el.innerText.split('\\n')[0] || '').trim())`,
      );

    // 干净起点：清 localStorage（含旧 pm-view-mode）后重载
    await navigate();
    await cdp.evaluate('window.localStorage.clear()');
    await navigate();

    // ---------- AC-44 分栏视图存在且为默认 ----------
    out.ac44_split_exists = String((await cdp.evaluate(`!!document.querySelector('[data-testid="pm-view-split"]')`)) === true);
    const rects = await cdp.evaluate(
      `JSON.stringify((() => {
        const l = document.querySelector('[data-testid="pm-split-list"]');
        const d = document.querySelector('[data-testid="pm-detail"]');
        const r = (el) => { if (el === null) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) }; };
        return { list: r(l), detail: r(d) };
      })())`,
    );
    const split = JSON.parse(rects ?? '{}');
    out.ac44_list_rect = JSON.stringify(split.list);
    out.ac44_detail_rect = JSON.stringify(split.detail);
    out.ac44_both_visible = String(
      split.list !== null &&
        split.detail !== null &&
        split.list.width > 0 &&
        split.list.height > 0 &&
        split.detail.width > 0 &&
        split.detail.height > 0,
    );
    out.ac44_not_overlap = String(split.list !== null && split.detail !== null && split.list.right <= split.detail.left + 4);

    out.ac44_item_count = await cdp.evaluate(`document.querySelectorAll('[data-testid="pm-split-item"]').length`);
    out.ac44_selected_count = await cdp.evaluate(
      `document.querySelectorAll('[data-testid="pm-split-item"][data-selected="true"]').length`,
    );

    const beforeTitle = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-detail-title"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    const titles = await itemTitles();
    out.ac44_first_title = titles[0] ?? '';
    out.ac44_second_title = titles[1] ?? '';
    out.ac44_initial_detail_title = beforeTitle ?? '';
    // 点第 2 个条目 → 右栏标题随之改变
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')]; if (items[1]) { items[1].click(); return true; } return false; })()`,
    );
    await sleep(900);
    const afterTitle = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-detail-title"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    out.ac44_after_click_detail_title = afterTitle ?? '';
    out.ac44_detail_title_switched = String(afterTitle === out.ac44_second_title && afterTitle !== beforeTitle);

    // 切表格 → 切回分栏：结构恢复
    await viewMode('表格');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-table"]\')', '表格视图');
    await viewMode('分栏');
    out.ac44_split_restored = String(
      (await cdp.evaluate(
        `!!document.querySelector('[data-testid="pm-split-list"]') && !!document.querySelector('[data-testid="pm-detail"]')`,
      )) === true,
    );

    // ---------- AC-45 档位顺序与「列表」档删除 ----------
    out.ac45_labels = await cdp.evaluate(
      `[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].map((n) => n.innerText.trim()).join('|')`,
    );
    out.ac45_no_list_view = String((await cdp.evaluate(`!document.querySelector('[data-testid="pm-view-list"]')`)) === true);

    // 默认（清 localStorage 后）落在分栏，且记忆键为 split
    await cdp.evaluate('window.localStorage.clear()');
    await navigate();
    out.ac45_default_label = (await selectedViewLabel()) ?? '';
    out.ac45_default_storage = (await cdp.evaluate(`window.localStorage.getItem('pm-view-mode')`)) ?? '';

    // 切表格 → 刷新 → 仍是表格（记忆）
    await viewMode('表格');
    await navigate();
    out.ac45_after_reload_label = (await selectedViewLabel()) ?? '';

    // 旧值 list → 回退分栏、无报错、页面不空白
    cdp.events.length = 0;
    await cdp.evaluate(`window.localStorage.setItem('pm-view-mode', 'list')`);
    await navigate();
    out.ac45_legacy_label = (await selectedViewLabel()) ?? '';
    out.ac45_legacy_split = String(
      (await cdp.evaluate(`!!document.querySelector('[data-testid="pm-view-split"]')`)) === true,
    );
    out.ac45_legacy_console_errors = String(cdp.errorCount());
    out.ac45_legacy_body_len = await cdp.evaluate(`(document.body.innerText || '').length`);

    // ---------- AC-46 分栏右栏复用详情面能力 ----------
    // 选中带 ≥2 变量的夹具条目
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')]; const t = items.find((n) => n.innerText.includes(${JSON.stringify(varsTitle)})); if (t) { t.click(); return true; } return false; })()`,
    );
    await sleep(900);
    out.ac46_selected_title = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-detail-title"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    const buttonState = await cdp.evaluate(
      `JSON.stringify(['pm-detail-copy','pm-detail-version-jump','pm-detail-delete','pm-detail-edit','pm-detail-fullscreen'].map((id) => {
        const el = document.querySelector('[data-testid="' + id + '"]');
        return { id, exists: el !== null, disabled: el === null ? true : (el.disabled === true || el.getAttribute('aria-disabled') === 'true') };
      }))`,
    );
    out.ac46_buttons = buttonState;
    const buttons = JSON.parse(buttonState ?? '[]');
    out.ac46_all_buttons_clickable = String(buttons.length === 5 && buttons.every((b) => b.exists && !b.disabled));

    // 只填一个变量 → 预览保留另一个 {{name}} → 复制结果与预览逐字符一致
    await clickTestId('pm-detail-copy');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-vars-dialog"]\')', '填变量对话框');
    await sleep(300);
    await cdp.type('[data-testid="pm-var-input-姓名"]', '张三');
    await sleep(400);
    const preview = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-vars-preview"]'); return el === null ? null : el.innerText; })()`,
    );
    out.ac46_preview = preview ?? '';
    out.ac46_preview_keeps_placeholder = String(preview !== null && preview.includes('{{项目}}') && preview.includes('张三'));
    await clickTestId('pm-vars-confirm');
    await sleep(800);
    const clipboard = await cdp.evaluate('navigator.clipboard.readText()');
    out.ac46_clipboard = clipboard ?? '';
    out.ac46_clipboard_matches_preview = String(clipboard === preview);

    // 删除 → 二次确认；取消后条目仍在（total 不变）
    const totalBefore = await cdp.evaluate(
      `fetch('/api/prompts?limit=1', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => String(j.total))`,
    );
    await clickTestId('pm-detail-delete');
    await cdp.waitFor(`!!document.querySelector('.ant-popconfirm')`, '删除二次确认');
    out.ac46_delete_confirm = await cdp.evaluate(`document.querySelector('.ant-popconfirm').innerText.replace(/\\n+/g, ' | ')`);
    await cdp.evaluate(
      `(() => { const norm = (t) => t.replace(/\\s+/g, ''); const buttons = [...document.querySelectorAll('.ant-popconfirm button')]; const cancel = buttons.find((b) => norm(b.innerText) === '取消'); if (cancel) { cancel.click(); return true; } return false; })()`,
    );
    await sleep(700);
    const totalAfter = await cdp.evaluate(
      `fetch('/api/prompts?limit=1', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => String(j.total))`,
    );
    out.ac46_total_before = totalBefore;
    out.ac46_total_after = totalAfter;
    out.ac46_total_unchanged = String(totalBefore === totalAfter);
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
