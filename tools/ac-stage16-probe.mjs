#!/usr/bin/env node
/**
 * 阶段 16 运行时探针：AC-51（logo 回主页）/ AC-52（关于页）/ AC-53（删「拿来就用」）/
 * AC-54（非空文件夹删除不得静默失败，**真鼠标**）/ AC-55（编辑页返回详情）/ AC-56（右栏顺序）/
 * AC-57（收藏显性化，**真鼠标**）/ AC-58（主题跟随系统图标）。
 *
 * ⚠️ AC-54 / AC-57 一律用 `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased）走真实命中测试，
 * 不用 JS `.click()` —— 阶段 15 验收暴露过"JS 点击绕过命中测试"的方法漏洞。
 *
 * 用法：node tools/ac-stage16-probe.mjs <baseUrl> <sid> <username> <parentFolder> <childFolder> <emptyFolder> <tagName> <fixtureTitle>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, username, parentFolder, childFolder, emptyFolder, tagName, fixtureTitle] = process.argv.slice(2);
if (process.argv.length < 10) {
  console.error(
    '用法：node tools/ac-stage16-probe.mjs <baseUrl> <sid> <username> <parentFolder> <childFolder> <emptyFolder> <tagName> <fixtureTitle>',
  );
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
  async center(selector) {
    const value = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`,
    );
    if (value === null) throw new Error(`找不到元素：${selector}`);
    return JSON.parse(value);
  }
  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  }
  async mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  /** 真鼠标点击（先移动到元素中心） */
  async realClick(selector, settle = 350) {
    const { x, y } = await this.center(selector);
    await this.mouseMove(x, y);
    await sleep(150);
    await this.mouseClick(x, y);
    await sleep(settle);
  }
  /** 先悬浮某行让"悬浮才出现"的元素渲染，再真鼠标点击目标 */
  async realClickAfterHover(hoverSelector, targetSelector, settle = 400) {
    const hover = await this.center(hoverSelector);
    await this.mouseMove(hover.x, hover.y);
    await sleep(350);
    const { x, y } = await this.center(targetSelector);
    await this.mouseMove(x, y);
    await sleep(200);
    await this.mouseClick(x, y);
    await sleep(settle);
  }
  /** JS 点击（仅用于非"可点性"验证的菜单/分段控件） */
  async click(selector) {
    const ok = await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return false; el.click(); return true; })()`,
    );
    if (ok !== true) throw new Error(`点不到：${selector}`);
    await sleep(250);
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac16-'));
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
    const setViewport = async (width, height, mobile) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await sleep(400);
    };
    await setViewport(1280, 800, false);
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
    const viewMode = async (label) => {
      await cdp.evaluate(
        `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const t = items.find((n) => n.innerText.includes(${JSON.stringify(label)})); if (t) { t.click(); return true; } return false; })()`,
      );
      await sleep(700);
    };
    const folders = async () =>
      JSON.parse(
        (await cdp.evaluate(
          `fetch('/api/folders', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => JSON.stringify(j.items.map((f) => ({ id: f.id, name: f.name }))))`,
        )) ?? '[]',
      );
    const promptByTitle = async (title) =>
      cdp.evaluate(
        `fetch('/api/prompts?q=' + encodeURIComponent(${JSON.stringify(title)}) + '&limit=50', { credentials: 'same-origin' })
           .then((r) => r.json())
           .then((j) => { const p = j.items.find((x) => x.title === ${JSON.stringify(title)}); return p === undefined ? null : JSON.stringify({ id: p.id, favorite: p.favorite, title: p.title }); })`,
      );

    await navigate();
    await cdp.evaluate('window.localStorage.clear()');
    await navigate();

    // ---------- AC-51 Logo 更名与回主页 ----------
    const topnav = (await cdp.evaluate(`document.querySelector('[data-testid="pm-topnav"]').innerText`)) ?? '';
    // FR-76 / D-31（v32）修订：顶栏是唯一空间受限处 ⇒ 品牌文字为简称 **PromptM**（其余四处保持全名）
    out.ac51_has_brand = String(topnav.includes('PromptM'));
    out.ac51_no_lowercase = String(!topnav.includes('promptmanager'));
    out.ac51_logo = await cdp.evaluate(
      `(() => { const el = document.querySelector('[aria-label="回到首页"]'); if (el === null) return 'missing'; const s = getComputedStyle(el); return JSON.stringify({ cursor: s.cursor, role: el.getAttribute('role'), tag: el.tagName }); })()`,
    );
    const logoInfo = JSON.parse(out.ac51_logo === 'missing' ? '{}' : out.ac51_logo);
    out.ac51_logo_ok = String(logoInfo.cursor === 'pointer' && (logoInfo.role === 'button' || logoInfo.tag === 'A'));

    // 制造"非主页"状态：切表格 + 搜索 zzz + 选一个标签
    await viewMode('表格');
    await cdp.evaluate(
      `(() => { const input = document.querySelector('[data-testid="pm-search-input"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'zzz'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    );
    await sleep(1200);
    await cdp.click('[data-testid="pm-tag-chip"]');
    await sleep(1000);
    out.ac51_before_home = await cdp.evaluate(
      `JSON.stringify({ table: !!document.querySelector('[data-testid="pm-view-table"]'), q: document.querySelector('[data-testid="pm-search-input"]').value, tagSelected: document.querySelectorAll('[data-testid="pm-tag-chip"][data-selected="true"]').length })`,
    );
    await cdp.realClick('[aria-label="回到首页"]', 900);
    out.ac51_after_home = await cdp.evaluate(
      `JSON.stringify({ split: !!document.querySelector('[data-testid="pm-view-split"]'), stored: window.localStorage.getItem('pm-view-mode'), q: document.querySelector('[data-testid="pm-search-input"]').value, tagSelected: document.querySelectorAll('[data-testid="pm-tag-chip"][data-selected="true"]').length, items: document.querySelectorAll('[data-testid="pm-split-item"]').length })`,
    );
    const afterHome = JSON.parse(out.ac51_after_home);
    out.ac51_home_ok = String(
      afterHome.split === true && afterHome.stored === 'split' && afterHome.q === '' && afterHome.tagSelected === 0 && afterHome.items > 0,
    );

    // ---------- AC-53 删除「拿来就用」装饰块 ----------
    out.ac53_no_decor = String(
      (await cdp.evaluate(
        `![...document.querySelectorAll('h1,h2,h3,h4,h5,div,span')].some((n) => (n.innerText || '').trim() === '拿来就用')`,
      )) === true,
    );
    const gap = await cdp.evaluate(
      `(() => { const bar = document.querySelector('[data-testid="pm-topnav"]').getBoundingClientRect(); const search = document.querySelector('[data-testid="pm-search-input"]').getBoundingClientRect(); return String(Math.round(search.top - bar.bottom)); })()`,
    );
    out.ac53_gap_after = gap;
    out.ac53_gap_before = '53'; // 顶栏下 16px 内容内边距 + 「拿来就用」标题块实测 37px（H3 25 + 下边距 12）
    out.ac53_gap_ok = String(Number(gap) <= Number(out.ac53_gap_before) - 30);

    // ---------- AC-52 关于页重构 ----------
    await cdp.click('[data-testid="header-more"]');
    await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单');
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('.ant-dropdown-menu-item')]; const t = items.find((n) => n.innerText.includes('关于')); if (t) { t.click(); return true; } return false; })()`,
    );
    await cdp.waitFor(`!!document.querySelector('[data-testid="pm-about"]')`, '关于面板');
    await sleep(600);
    const aboutText = (await cdp.evaluate(`document.querySelector('[data-testid="pm-about"]').innerText`)) ?? '';
    out.ac52_text_len = String(aboutText.length);
    out.ac52_no_internal = String(!aboutText.includes('BRIEF') && !aboutText.includes('AC-') && !aboutText.includes('阶段'));
    out.ac52_labels = await cdp.evaluate(
      `(() => { const labels = [...document.querySelectorAll('[data-testid="pm-about"] .ant-descriptions-item-label')].map((n) => n.innerText.trim()); const dup = labels.filter((v, i) => labels.indexOf(v) !== i); return JSON.stringify({ count: labels.length, labels, dup }); })()`,
    );
    const labelsInfo = JSON.parse(out.ac52_labels);
    out.ac52_no_duplicate = String(labelsInfo.dup.length === 0);
    out.ac52_sections = await cdp.evaluate(`document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-header').length`);
    out.ac52_sections_ok = String(Number(out.ac52_sections) >= 3);
    out.ac52_first_section = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-about"] .ant-collapse-header'); return el === null ? '' : el.innerText.trim(); })()`,
    );
    // 窄屏不横向滚动
    await setViewport(390, 844, true);
    await sleep(500);
    out.ac52_narrow_overflow = String(
      (await cdp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')) === true,
    );
    await setViewport(1280, 800, false);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(400);
    await navigate();

    // ---------- AC-54 非空文件夹删除（真鼠标全链路） ----------
    const folderList = await folders();
    const parent = folderList.find((f) => f.name === parentFolder);
    const empty = folderList.find((f) => f.name === emptyFolder);
    if (parent === undefined || empty === undefined) throw new Error('夹具文件夹缺失');
    const parentRow = `[data-testid="pm-folder-row-${String(parent.id)}"]`;
    const emptyRow = `[data-testid="pm-folder-row-${String(empty.id)}"]`;
    const before54 = folderList.length;
    out.ac54_folders_before = String(before54);

    await cdp.realClickAfterHover(parentRow, '[data-testid="pm-folder-delete"]');
    await cdp.waitFor(`!!document.querySelector('.ant-popconfirm')`, '删除弹窗');
    out.ac54_popup_text = (await cdp.evaluate(`document.querySelector('.ant-popconfirm').innerText.replace(/\\n+/g, ' | ')`)) ?? '';
    // 鼠标移到弹窗上：弹窗必须还在、触发按钮仍被钉住、确定按钮可命中
    const okCenter = await cdp.center('.ant-popconfirm .ant-btn-primary');
    await cdp.mouseMove(okCenter.x, okCenter.y);
    await sleep(400);
    out.ac54_popup_alive = String(
      (await cdp.evaluate(
        `(() => { const p = document.querySelector('.ant-popconfirm'); if (!p) return false; const r = p.getBoundingClientRect(); return p.offsetParent !== null && r.width > 0 && r.height > 0; })()`,
      )) === true,
    );
    out.ac54_delete_icon_pinned = String(
      (await cdp.evaluate(`!!document.querySelector('[data-testid="pm-folder-delete"]')`)) === true,
    );
    out.ac54_ok_hit = await cdp.evaluate(
      `(() => { const btn = document.querySelector('.ant-popconfirm .ant-btn-primary'); if (!btn) return 'no-button'; const r = btn.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); if (el === null) return 'obscured:null'; return (el === btn || btn.contains(el)) ? 'button' : 'obscured:' + el.tagName + '.' + String(el.className || ''); })()`,
    );
    out.ac54_popup_in_viewport = await cdp.evaluate(
      `(() => { const p = document.querySelector('.ant-popconfirm'); if (!p) return false; const r = p.getBoundingClientRect(); return r.top >= -1 && r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; })()`,
    );
    // 真鼠标点「删除」→ 必须出现可见错误反馈，且数量不变
    await cdp.mouseClick(okCenter.x, okCenter.y);
    await sleep(900);
    const messageText = (await cdp.evaluate(`(() => { const el = document.querySelector('.ant-message'); return el === null ? '' : el.innerText.replace(/\\n+/g, ' | '); })()`)) ?? '';
    out.ac54_error_message = messageText;
    out.ac54_has_feedback = String(messageText.includes('没能删除') || messageText.includes('不能删除') || messageText.includes('先清空'));
    const afterFail = await folders();
    out.ac54_folders_after_fail = String(afterFail.length);
    out.ac54_folders_unchanged = String(afterFail.length === before54);
    // 空文件夹：真鼠标删除必须成功（-1）
    await cdp.realClickAfterHover(emptyRow, '[data-testid="pm-folder-delete"]');
    await cdp.waitFor(`!!document.querySelector('.ant-popconfirm')`, '空文件夹删除弹窗');
    const okCenter2 = await cdp.center('.ant-popconfirm .ant-btn-primary');
    await cdp.mouseMove(okCenter2.x, okCenter2.y);
    await sleep(300);
    await cdp.mouseClick(okCenter2.x, okCenter2.y);
    await sleep(1200);
    const afterOk = await folders();
    out.ac54_folders_after_empty_delete = String(afterOk.length);
    out.ac54_empty_delete_ok = String(afterOk.length === before54 - 1);

    // 窄屏 + 侧栏滚动下弹层仍可点（FR-54 第 4 条自查）
    await setViewport(1024, 800, false);
    await sleep(500);
    await cdp.realClick('button[aria-label="筛选"]', 700);
    await cdp.waitFor(`!!document.querySelector('.ant-drawer')`, '筛选抽屉');
    const drawerRow = `[data-testid="pm-folder-row-${String(parent.id)}"]`;
    await cdp.realClickAfterHover(drawerRow, '[data-testid="pm-folder-delete"]');
    await cdp.waitFor(`!!document.querySelector('.ant-popconfirm')`, '窄屏删除弹窗');
    const okCenter3 = await cdp.center('.ant-popconfirm .ant-btn-primary');
    await cdp.mouseMove(okCenter3.x, okCenter3.y);
    await sleep(400);
    out.ac54_narrow_popup_alive = String(
      (await cdp.evaluate(
        `(() => { const p = document.querySelector('.ant-popconfirm'); if (!p) return false; const r = p.getBoundingClientRect(); return p.offsetParent !== null && r.width > 0 && r.height > 0; })()`,
      )) === true,
    );
    out.ac54_narrow_ok_hit = await cdp.evaluate(
      `(() => { const btn = document.querySelector('.ant-popconfirm .ant-btn-primary'); if (!btn) return 'no-button'; const r = btn.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); if (el === null) return 'obscured:null'; return (el === btn || btn.contains(el)) ? 'button' : 'obscured:' + el.tagName; })()`,
    );
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await setViewport(1280, 800, false);
    await navigate();

    // ---------- AC-55 / AC-56 编辑页 ----------
    const fixture = JSON.parse((await promptByTitle(fixtureTitle)) ?? 'null');
    if (fixture === null) throw new Error('夹具 prompt 缺失');
    const fixtureId = fixture.id;
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('[data-testid="pm-split-item"]')]; const t = items.find((n) => n.innerText.includes(${JSON.stringify(fixtureTitle)})); if (t) { t.click(); return true; } return false; })()`,
    );
    await sleep(900);
    out.ac55_detail_title_before = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-detail-title"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    await cdp.realClick('[data-testid="pm-detail-edit"]', 1000);
    out.ac55_editor_open = String((await cdp.evaluate(`!!document.querySelector('[data-testid="pm-editor"]')`)) === true);
    out.ac55_back_text = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="editor-back"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    out.ac55_has_back = String(typeof out.ac55_back_text === 'string' && out.ac55_back_text.includes('返回'));
    // 右栏顺序（AC-56）
    out.ac56_tops = await cdp.evaluate(
      `JSON.stringify((() => { const top = (id) => { const el = document.querySelector('[data-testid="' + id + '"]'); return el === null ? -1 : Math.round(el.getBoundingClientRect().top); }; return { markdown: top('pm-panel-markdown'), variables: top('pm-panel-variables'), versions: top('pm-panel-versions') }; })())`,
    );
    const tops = JSON.parse(out.ac56_tops);
    out.ac56_order_ok = String(tops.markdown >= 0 && tops.markdown < tops.variables && tops.variables < tops.versions);
    // 真鼠标点「返回详情」→ pm-detail 重现且标题为该条目
    await cdp.realClick('[data-testid="editor-back"]', 1000);
    out.ac55_detail_after_back = await cdp.evaluate(
      `(() => { const el = document.querySelector('[data-testid="pm-detail-title"]'); return el === null ? null : el.innerText.trim(); })()`,
    );
    out.ac55_back_ok = String(out.ac55_detail_after_back === fixtureTitle);

    // ---------- AC-57 收藏显性化（真鼠标点表格星标） ----------
    const starScript = (testid) =>
      `(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (el === null) return 'missing'; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return JSON.stringify({ tag: el.tagName, role: el.getAttribute('role'), cursor: s.cursor, label: el.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), visible: el.offsetParent !== null && r.width > 0 }); })()`;
    const checkStar = (testid) => starScript(testid);
    // 分栏 + 详情（当前就在分栏，右栏是详情）
    out.ac57_split_star = await cdp.evaluate(checkStar(`pm-fav-split-${String(fixtureId)}`));
    out.ac57_detail_star = await cdp.evaluate(checkStar(`pm-fav-detail-${String(fixtureId)}`));
    await viewMode('卡片');
    out.ac57_card_star = await cdp.evaluate(checkStar(`pm-fav-card-${String(fixtureId)}`));
    await viewMode('表格');
    out.ac57_table_star = await cdp.evaluate(checkStar(`pm-fav-table-${String(fixtureId)}`));
    const starOk = (raw) => {
      try {
        const info = JSON.parse(raw);
        return (
          (info.tag === 'BUTTON' || info.role === 'button') &&
          info.cursor === 'pointer' &&
          typeof info.label === 'string' &&
          (info.label.includes('收藏')) &&
          info.w >= 24 &&
          info.h >= 24 &&
          info.visible === true
        );
      } catch {
        return false;
      }
    };
    out.ac57_all_stars_ok = String(
      [out.ac57_split_star, out.ac57_card_star, out.ac57_table_star, out.ac57_detail_star].every(starOk),
    );
    // 真鼠标点表格星标 → favorite 翻转 → 再点恢复 → 刷新后保持
    const favBefore = JSON.parse((await promptByTitle(fixtureTitle)) ?? '{}').favorite;
    await cdp.realClick(`[data-testid="pm-fav-table-${String(fixtureId)}"]`, 1200);
    const favAfter = JSON.parse((await promptByTitle(fixtureTitle)) ?? '{}').favorite;
    out.ac57_favorite_flip = String(favBefore !== favAfter);
    await cdp.realClick(`[data-testid="pm-fav-table-${String(fixtureId)}"]`, 1200);
    const favRestored = JSON.parse((await promptByTitle(fixtureTitle)) ?? '{}').favorite;
    out.ac57_favorite_restored = String(favRestored === favBefore);
    await navigate();
    await viewMode('表格');
    const favReloaded = JSON.parse((await promptByTitle(fixtureTitle)) ?? '{}').favorite;
    out.ac57_persisted = String(favReloaded === favBefore);

    // ---------- AC-58 主题三态图标 ----------
    const iconInfo = async () =>
      cdp.evaluate(
        `(() => { const el = document.querySelector('[data-testid="pm-theme-toggle"]'); if (el === null) return 'missing'; return JSON.stringify({ desktop: !!el.querySelector('.anticon-desktop'), sun: !!el.querySelector('.anticon-sun'), moon: !!el.querySelector('.anticon-moon') }); })()`,
      );
    await cdp.evaluate(`window.localStorage.removeItem('pm-theme')`);
    await navigate();
    out.ac58_system_icons = await iconInfo();
    await cdp.evaluate(`window.localStorage.setItem('pm-theme', 'light')`);
    await navigate();
    out.ac58_light_icons = await iconInfo();
    await cdp.evaluate(`window.localStorage.setItem('pm-theme', 'dark')`);
    await navigate();
    out.ac58_dark_icons = await iconInfo();
    const sys = JSON.parse(out.ac58_system_icons);
    const light = JSON.parse(out.ac58_light_icons);
    const dark = JSON.parse(out.ac58_dark_icons);
    out.ac58_system_ok = String(sys.desktop === false && sys.sun === true && sys.moon === true);
    out.ac58_light_ok = String(light.sun === true && light.moon === false);
    out.ac58_dark_ok = String(dark.moon === true && dark.sun === false);
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
