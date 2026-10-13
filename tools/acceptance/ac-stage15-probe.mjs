#!/usr/bin/env node
/**
 * 阶段 15 运行时探针：AC-47（顶栏四块顺序 + 无用户信息）/ AC-48（⋯更多 子项顺序与删减）/
 * AC-49（文件夹区新建与层级）/ AC-50（标签胶囊云）。
 *
 * 零安装：Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP。
 * 用法：node tools/ac-stage15-probe.mjs <baseUrl> <sid> <username> <parentFolder> <childFolder> <newFolderName>
 * 输出：每行 `KEY=VALUE`，由 tools/ac-stage15.sh 断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, username, parentFolder, childFolder, newFolderName] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined || username === undefined || parentFolder === undefined || childFolder === undefined || newFolderName === undefined) {
  console.error('用法：node tools/ac-stage15-probe.mjs <baseUrl> <sid> <username> <parentFolder> <childFolder> <newFolderName>');
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
  async waitFor(expression, label, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
  }
  async click(selector) {
    const ok = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return false; el.click(); return true; })()`,
    );
    if (ok !== true) throw new Error(`点不到：${selector}`);
    await sleep(250);
  }
  async type(selector, text) {
    const focused = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`,
    );
    if (focused !== true) throw new Error(`找不到输入框：${selector}`);
    await this.send('Input.insertText', { text });
  }
  /** 把鼠标移到某个元素中心（触发 React onMouseEnter） */
  async hover(selector) {
    const center = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`,
    );
    if (center === null) throw new Error(`悬浮不到（找不到元素）：${selector}`);
    const { x, y } = JSON.parse(center);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(350);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac15-'));
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
      await sleep(700);
    };
    const folders = async () =>
      JSON.parse(
        (await cdp.evaluate(
          `fetch('/api/folders', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j.items.map((f) => ({ id: f.id, name: f.name, parent_id: f.parent_id }))))`,
        )) ?? '[]',
      );

    await navigate();
    await cdp.evaluate('window.localStorage.clear()');
    await navigate();

    // ---------- AC-47 顶栏四块顺序 + 无用户信息 ----------
    const rects = await cdp.evaluate(
      `JSON.stringify(['header-new','header-more','pm-theme-toggle','header-logout'].map((id) => {
        const el = document.querySelector('[data-testid="' + id + '"]');
        if (el === null) return { id, missing: true };
        const r = el.getBoundingClientRect();
        return { id, left: Math.round(r.left), width: Math.round(r.width), visible: el.offsetParent !== null && r.width > 0 };
      }))`,
    );
    const positions = JSON.parse(rects ?? '[]');
    out.ac47_rects = JSON.stringify(positions);
    const lefts = positions.map((p) => p.left);
    out.ac47_order = String(
      positions.every((p) => p.missing !== true) &&
        lefts[0] < lefts[1] &&
        lefts[1] < lefts[2] &&
        lefts[2] < lefts[3],
    );
    out.ac47_all_visible = String(positions.length === 4 && positions.every((p) => p.visible === true));
    const topnav = (await cdp.evaluate(`document.querySelector('[data-testid="pm-topnav"]').innerText`)) ?? '';
    out.ac47_topnav_head = topnav.replace(/\n+/g, ' | ').slice(0, 120);
    out.ac47_no_username = String(!topnav.includes(username));

    // ---------- AC-48 ⋯更多 子项顺序与删减 ----------
    await cdp.click('[data-testid="header-more"]');
    await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
    await sleep(300);
    out.ac48_items = await cdp.evaluate(
      `[...document.querySelectorAll('.ant-dropdown-menu-item')].map((n) => n.innerText.trim()).join('|')`,
    );
    out.ac48_no_folder_entry = String(
      (await cdp.evaluate(
        `![...document.querySelectorAll('.ant-dropdown-menu-item')].some((n) => n.innerText.includes('文件夹') || n.innerText.includes('标签管理'))`,
      )) === true,
    );
    out.ac48_settings_text = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-settings"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    // FR-67（BRIEF v27）：只读的登录信息项已删除，**原位置**改为「修改密码」
    out.ac48_no_account_entry = String(
      (await cdp.evaluate(
        `![...document.querySelectorAll('.ant-dropdown-menu-item')].some((n) => n.innerText.includes('已登录'))`,
      )) === true,
    );
    out.ac48_password_entry = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-menu-password"]'); if (el === null) return 'missing'; const item = el.closest('.ant-dropdown-menu-item'); return JSON.stringify({ text: el.innerText.trim(), disabled: item === null ? null : (item.className.includes('disabled') || item.getAttribute('aria-disabled') === 'true') }); })()`,
    );
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(300);

    // ---------- AC-49 文件夹区新建与层级 ----------
    const before = await folders();
    out.ac49_folders_before = String(before.length);
    out.ac49_create_visible = String(
      (await cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="folder-create"]'); if (!el) return false; const r = el.getBoundingClientRect(); return el.offsetParent !== null && r.width > 0; })()`,
      )) === true,
    );
    await cdp.click('[data-testid="folder-create"]');
    await sleep(800);
    // antd 6 的弹窗内层类名不是 v5 的 -content（抽屉是 -section）：用 `.ant-modal input` 更稳
    await cdp.waitFor(`!!document.querySelector('.ant-modal input')`, '新建文件夹弹窗', 6000);
    out.ac49_modal_input = String((await cdp.evaluate(`!!document.querySelector('.ant-modal input')`)) === true);
    await cdp.type('.ant-modal input', newFolderName);
    await sleep(200);
    await cdp.evaluate(
      `(() => { const norm = (t) => t.replace(/\\s+/g, ''); const btns = [...document.querySelectorAll('.ant-modal-footer button')]; const ok = btns.find((b) => norm(b.innerText) === '创建'); if (ok) { ok.click(); return true; } return false; })()`,
    );
    // antd Modal 关闭后 DOM 仍保留（destroyOnClose 默认 false）→ 用"文件夹数量真的 +1"来等，而不是等弹窗消失
    let after = before;
    for (let i = 0; i < 24 && after.length === before.length; i += 1) {
      await sleep(300);
      after = await folders();
    }
    await sleep(400);
    out.ac49_folders_after = String(after.length);
    out.ac49_added = String(after.length === before.length + 1);
    out.ac49_new_name_visible = String(
      after.some((f) => f.name === newFolderName) &&
        ((await cdp.evaluate(`document.querySelector('[data-testid="pm-sidebar"]').innerText`)) ?? '').includes(newFolderName),
    );

    const parent = after.find((f) => f.name === parentFolder);
    const child = after.find((f) => f.name === childFolder);
    if (parent === undefined || child === undefined) throw new Error('夹具文件夹缺失（父/子）');
    const parentRow = `[data-testid="pm-folder-row-${String(parent.id)}"]`;
    const childRow = `[data-testid="pm-folder-row-${String(child.id)}"]`;
    const childToggle = `[data-testid="pm-folder-toggle-${String(parent.id)}"]`;

    out.ac49_parent_has_toggle = String((await cdp.evaluate(`!!document.querySelector(${JSON.stringify(childToggle)})`)) === true);
    // 折叠 → 子项 offsetParent === null；再展开恢复
    await cdp.click(childToggle);
    await sleep(400);
    out.ac49_child_hidden_when_collapsed = String(
      (await cdp.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(childRow)}); return el !== null && el.offsetParent === null; })()`,
      )) === true,
    );
    await cdp.click(childToggle);
    await sleep(400);
    out.ac49_child_visible_when_expanded = String(
      (await cdp.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(childRow)}); return el !== null && el.offsetParent !== null; })()`,
      )) === true,
    );
    // 层级缩进：子行 left ≥ 父行 +12px
    out.ac49_indent = await cdp.evaluate(
      `(() => { const p = document.querySelector(${JSON.stringify(parentRow)}).getBoundingClientRect(); const c = document.querySelector(${JSON.stringify(childRow)}).getBoundingClientRect(); return String(Math.round(c.left - p.left)); })()`,
    );
    // 条目数（含子文件夹）+ 无彩色徽标
    out.ac49_parent_count = await cdp.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(parentRow)} + ' .pm-folder-count'); return el === null ? 'missing' : el.innerText.trim(); })()`,
    );
    out.ac49_badge_in_sidebar = await cdp.evaluate(
      `document.querySelectorAll('[data-testid="pm-sidebar"] .ant-badge').length`,
    );
    // 悬浮 → 出现 重命名 / 删除；删除 → 二次确认 → 取消后仍在
    await cdp.hover(parentRow);
    out.ac49_hover_actions = String(
      (await cdp.evaluate(
        `!!document.querySelector('[data-testid="pm-folder-rename"]') && !!document.querySelector('[data-testid="pm-folder-delete"]')`,
      )) === true,
    );
    await cdp.click('[data-testid="pm-folder-delete"]');
    await cdp.waitFor(`!!document.querySelector('.ant-popconfirm')`, '删除二次确认');
    out.ac49_delete_confirm = await cdp.evaluate(
      `document.querySelector('.ant-popconfirm').innerText.replace(/\\n+/g, ' | ')`,
    );
    out.ac49_popconfirm_cancel_clicked = String(
      (await cdp.evaluate(
        `(() => { const norm = (t) => t.replace(/\\s+/g, ''); const btns = [...document.querySelectorAll('.ant-popconfirm button')]; const cancel = btns.find((b) => norm(b.innerText) === '取消'); if (cancel) { cancel.click(); return true; } return false; })()`,
      )) === true,
    );
    await sleep(150);
    out.ac49_active_after_cancel = await cdp.evaluate(`(() => { const el = document.querySelector('[data-testid^="pm-folder-row"][class*="pm-folder-row-active"]'); return el === null ? 'none' : el.getAttribute('data-testid'); })()`);
    await sleep(700);
    const afterCancel = await folders();
    out.ac49_total_unchanged_after_cancel = String(afterCancel.length === after.length);

    // ---------- AC-50 标签胶囊云 ----------
    const tagInfo = JSON.parse(
      (await cdp.evaluate(
        `fetch('/api/tags', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify({ total: j.items.length, first: j.items[0] ? j.items[0].name : null }))`,
      )) ?? '{"total":0}',
    );
    out.ac50_tag_total = String(tagInfo.total);
    out.ac50_cloud_exists = String((await cdp.evaluate(`!!document.querySelector('[data-testid="pm-tag-cloud"]')`)) === true);
    out.ac50_chip_count = await cdp.evaluate(`document.querySelectorAll('[data-testid="pm-tag-chip"]').length`);
    out.ac50_all_hash_prefix = String(
      (await cdp.evaluate(
        `[...document.querySelectorAll('[data-testid="pm-tag-chip"]')].every((n) => n.innerText.trim().startsWith('#'))`,
      )) === true,
    );
    out.ac50_badge_count = await cdp.evaluate(
      `document.querySelectorAll('[data-testid="pm-tag-cloud"] .ant-badge, [data-testid="pm-tag-cloud"] .ant-badge-count').length`,
    );
    const cloudMetrics = await cdp.evaluate(
      `JSON.stringify((() => { const c = document.querySelector('[data-testid="pm-tag-cloud"]'); const chips = [...c.querySelectorAll('[data-testid="pm-tag-chip"]')]; return { rows: new Set(chips.map((n) => n.offsetTop)).size, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth }; })())`,
    );
    const cloud = JSON.parse(cloudMetrics ?? '{}');
    out.ac50_cloud_rows = String(cloud.rows);
    out.ac50_no_h_scroll = String(Number(cloud.scrollWidth) <= Number(cloud.clientWidth) + 2);
    // 点一个胶囊 → 列表条数减少；再点恢复
    out.ac50_list_text = (await cdp.evaluate(`(() => { const el = document.querySelector('[data-testid="pm-split-list"]'); return el === null ? 'no-list' : el.innerText.replace(/\\n+/g, ' | ').slice(0, 100); })()`)) ?? '';
    const unfiltered = await cdp.evaluate(`document.querySelectorAll('[data-testid="pm-split-item"]').length`);
    const firstChip = tagInfo.first;
    await cdp.evaluate(
      `(() => { const chips = [...document.querySelectorAll('[data-testid="pm-tag-chip"]')]; const t = chips.find((n) => n.innerText.trim() === ${JSON.stringify('#' + String(tagInfo.first))}); if (t) { t.click(); return true; } return false; })()`,
    );
    await sleep(1000);
    const filtered = await cdp.evaluate(`document.querySelectorAll('[data-testid="pm-split-item"]').length`);
    await cdp.evaluate(
      `(() => { const chips = [...document.querySelectorAll('[data-testid="pm-tag-chip"]')]; const t = chips.find((n) => n.innerText.trim() === ${JSON.stringify('#' + String(tagInfo.first))}); if (t) { t.click(); return true; } return false; })()`,
    );
    await sleep(1000);
    const restored = await cdp.evaluate(`document.querySelectorAll('[data-testid="pm-split-item"]').length`);
    out.ac50_unfiltered = String(unfiltered);
    out.ac50_filtered = String(filtered);
    out.ac50_restored = String(restored);
    out.ac50_filter_works = String(Number(filtered) < Number(unfiltered) && Number(restored) === Number(unfiltered));
    out.ac50_first_tag = String(firstChip);
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
