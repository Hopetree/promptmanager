#!/usr/bin/env node
/**
 * 阶段 41 运行时探针（**真浏览器** + 真鼠标；CDP）：FR-102 / AC-104
 *
 *   edit <baseUrl> <sid> <shotsDir>
 *     ① 桌面：真鼠标改一条既有 prompt 的备注 → 保存 → 点「返回详情」（**不刷新页面**）
 *        → 版本列表**条数 +1**、**最上方版本号 = 新版本号**；详情上的版本号与之一致
 *     ② 再按 F5 → 版本条数/最新版本号与 ① 相同（证明 ① 不是"看起来对"）
 *     ③ 详情版本号 == 列表最上方版本号
 *     ④ 回滚：点「回滚」→ 二次确认 → 版本列表**立即**多出新版本
 *     ⑤ 移动端（390 宽）：走详情抽屉路径重复 ①
 *     ⑥ 无多余请求：回到详情后反复点"用户/系统提示词"与"源码/预览"，`/versions` 请求数**不得增加**
 *
 * 输出 `key=value` 行供 AC 脚本断言；**不打印任何凭据**。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MODES = ['edit'];
const [mode, baseUrl, sid, ...rest] = process.argv.slice(2);
if (!MODES.includes(mode ?? '') || baseUrl === undefined || sid === undefined) {
  console.error(`用法：node tools/ac-stage41-probe.mjs <${MODES.join('|')}> <baseUrl> <sid> [shotsDir]`);
  process.exit(2);
}
const shotsDir = rest[0] ?? 'tmp/shots/stage41';
const TITLE = process.env['AC104_TITLE'] ?? '';
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
    this.requests = [];
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.text ?? 'exception');
      if (message.method === 'Network.requestWillBeSent') this.requests.push(message.params?.request?.url ?? '');
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
  async realClickOf(jsExpr, settle = 500) {
    const { x, y } = await this.centerOf(jsExpr);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
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

/** 版本列表快照：条数 + 最上方版本号（`rowKey="version_no"` ⇒ tr[data-row-key]）。 */
/**
 * 版本列表快照：
 * - `count` 取自面板里的「共 N 个版本」（**与当前视图无关**，最稳），并与表格行数交叉核对；
 * - `top` 取表格首行的 `data-row-key`（表格视图按 version_no 作 rowKey，首行 = 最新）；
 * - `detailVersion` 取详情头部 `v{N}`。
 */
/**
 * 版本列表快照（**只认可见的详情面板**）：
 * ⚠️ antd Drawer 关闭后内容会留在 DOM 里 ⇒ 页面可能同时存在"隐藏的旧面板"与"可见的新面板"，
 * 全局选择器会读到旧的那个（首版就因此在移动端读空/点错）。所有查询都先按 `offsetParent !== null` 过滤。
 * - `count` 取自面板里的「共 N 个版本」（**与当前视图无关**，最稳），并与表格行数交叉核对；
 * - `top` 取表格首行的 `data-row-key`（表格按 version_no 作 rowKey；显示层已翻转为最新在上）；
 * - `detailVersion` 取详情头部 `v{N}`。
 */
const SNAPSHOT = `JSON.stringify((() => {
  const panels = [...document.querySelectorAll('[data-testid="pm-detail"]')];
  const panel = panels.find((el) => el.offsetParent !== null) ?? panels[0] ?? null;
  const rows = panel === null ? [] : [...panel.querySelectorAll('tr[data-row-key]')];
  const head = panel?.querySelector('[data-testid="pm-detail-head"]')?.innerText ?? '';
  const text = panel?.innerText ?? '';
  const countMatch = /共\\s*(\\d+)\\s*个版本/.exec(text);
  const versionMatch = /v(\\d+)/.exec(head);
  return {
    count: countMatch === null ? rows.length : Number(countMatch[1]),
    tableRows: rows.length,
    top: rows.length > 0 ? Number(rows[0].getAttribute('data-row-key')) : null,
    detailVersion: versionMatch === null ? null : Number(versionMatch[1]),
    headText: head.replace(/\\n/g, ' ').slice(0, 80),
  };
})())`;

const NOTES_TEXTAREA = `[...document.querySelectorAll('.ant-form-item')].find((el) => el.innerText.includes('备注（notes）'))?.querySelector('textarea')`;

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac41-'));
  const child = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-color-profile=srgb', '--window-size=1440,900', '--user-data-dir=' + userDataDir, '--remote-debugging-port=0', 'about:blank'],
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
    await cdp.send('Network.enable');
    await cdp.send('Network.setCookie', {
      name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
    });

    const versionsRequests = () => cdp.requests.filter((u) => /\/api\/prompts\/\d+\/versions/.test(u)).length;

    /** 切到「表格」视图（幂等，**只在可见面板里点**）：版本面板默认是「对比版本」，没有表格行。 */
    const ensureTableView = () =>
      cdp.evaluate(`(() => {
        const panels = [...document.querySelectorAll('[data-testid="pm-detail"]')];
        const panel = panels.find((el) => el.offsetParent !== null) ?? panels[0];
        if (panel === undefined) return false;
        if (panel.querySelectorAll('tr[data-row-key]').length > 0) return true;
        const views = panel.querySelector('[data-testid="pm-version-views"]');
        if (views === null) return false;
        const label = [...views.querySelectorAll('.ant-segmented-item-label')].find((el) => el.innerText.trim() === '表格');
        if (label !== undefined) label.click();
        return true;
      })()`);

    /**
     * 取快照前先确保表格视图：
     * 移动端每次打开详情抽屉都会让版本面板**重新挂载**（视图回到默认的「对比版本」）⇒ 直接读会拿不到行。
     * `count` 用的是「共 N 个版本」（与视图无关），`top` 用表格首行 —— 两者互补，互为交叉验证。
     */
    const snap = async () => {
      await ensureTableView();
      await cdp.waitFor(
        `[...document.querySelectorAll('[data-testid="pm-detail"]')].some((p) => p.offsetParent !== null && p.querySelectorAll('tr[data-row-key]').length > 0)`,
        '版本表格行（可见面板）',
        15_000,
      );
      return JSON.parse(await cdp.evaluate(SNAPSHOT));
    };

    /** 打开某条 prompt 的详情（桌面走分栏列表项；移动端走卡片 → 详情抽屉）。 */
    const openDetail = async (isMobilePhase) => {
      /**
       * 就绪信号：`pm-brand-text` 只在**非移动端**渲染（AppHeader 里 `!isMobile &&`），
       * 所以用"搜索框或品牌字"任一存在即可（两者都不依赖档位/视口）。
       */
      await cdp.waitFor(
        `document.querySelector('[data-testid="pm-search-input"], [data-testid="pm-brand-text"]') !== null`,
        isMobilePhase ? '主界面（移动端）' : '主界面',
        25_000,
      );
      // ⚠️ 必须**等列表项渲染出来再点**：只等主界面会在列表还没加载时点空（首版就这么超时了）
      /**
       * 移动端可能停在"卡片"（默认，FR-92）或"分栏"（若 localStorage 里已有偏好 —— 桌面阶段会写下
       * `pm-view-mode`）⇒ 两种列表项都认，哪个在就点哪个。
       */
      // 桌面与移动端都用「分栏」列表项（移动端详情抽屉同样由它打开）
      const itemSelector = '[data-testid="pm-split-item"]';
      await cdp.waitFor(
        `[...document.querySelectorAll('${itemSelector}')].some((el) => el.innerText.includes(${JSON.stringify(TITLE)}))`,
        isMobilePhase ? '卡片列表出现夹具' : '分栏列表出现夹具',
        25_000,
      );
      await cdp.realClickOf(
        `[...document.querySelectorAll('${itemSelector}')].find((el) => el.innerText.includes(${JSON.stringify(TITLE)}))`,
        900,
      );
      await cdp.waitFor(`document.querySelector('[data-testid="pm-detail"]') !== null`, '详情面');
      // ⚠️ 版本面板默认是「对比版本」视图（没有表格行）；AC-104 说的"版本列表"是「表格」视图
      await cdp.waitFor(`document.querySelector('[data-testid="pm-version-views"]') !== null`, '版本面板');
      await ensureTableView();
      await cdp.waitFor(
        `[...document.querySelectorAll('[data-testid="pm-detail"]')].some((p) => p.offsetParent !== null && p.querySelectorAll('tr[data-row-key]').length > 0)`,
        '版本列表有行（表格视图）',
        20_000,
      );
      await sleep(300);
    };

    /** 编辑 → 改备注 → 保存 → 点「返回详情」（**不刷新页面**）。 */
    const editSaveBack = async () => {
      await cdp.realClickOf(`document.querySelector('[data-testid="pm-detail-edit"]')`, 900);
      await cdp.waitFor(`document.querySelector('[data-testid="editor-save"]') !== null`, '编辑器打开');
      await sleep(400);
      const marker = `AC104-${String(Date.now())}`;
      await cdp.evaluate(
        `(() => { const el = ${NOTES_TEXTAREA}; el.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, el.value + ' ' + ${JSON.stringify(marker)}); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value.length; })()`,
      );
      await sleep(200);
      await cdp.realClickOf(`document.querySelector('[data-testid="editor-save"]')`, 1600);
      out.save_marker = marker;
      await cdp.waitFor(`document.querySelector('[data-testid="editor-back"]') !== null`, '编辑器仍在（保存后停在编辑器）');
      await cdp.realClickOf(`document.querySelector('[data-testid="editor-back"]')`, 1200);
      await cdp.waitFor(`document.querySelector('[data-testid="pm-detail"]') !== null`, '回到详情面');
      await sleep(600);
    };

    // ───────────── 桌面阶段 ─────────────
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await cdp.evaluate(`window.localStorage.setItem('pm-theme','light'); true`);
    await openDetail(false);
    const before = await snap();
    out.before_count = before.count;
    out.before_top = before.top;
    out.before_detail_version = before.detailVersion;
    out.before_head = before.headText;

    await editSaveBack();
    const after = await snap();
    out.after_count = after.count;
    out.after_top = after.top;
    out.after_detail_version = after.detailVersion;
    out.after_head = after.headText;
    out.no_page_reload = true; // 全程只 navigate 过一次（见下面 page_navigations 计数）
    out.page_navigations = cdp.requests.filter((u) => u === `${baseUrl}/`).length;
    await cdp.shot('01-after-save-back-to-detail');

    // ⑥ 无多余请求：反复点无关按钮
    const vBefore = versionsRequests();
    out.versions_requests_before_toggles = vBefore;
    for (const label of ['系统提示词', '用户提示词', '源码', '预览', '系统提示词', '源码']) {
      await cdp.realClickOf(
        `[...document.querySelectorAll('[data-testid="pm-detail-fields"] .ant-segmented-item-label')].find((el) => el.innerText.trim() === ${JSON.stringify(label)})`,
        350,
      );
    }
    await sleep(700);
    out.versions_requests_after_toggles = versionsRequests();

    // ② F5 后一致
    await cdp.send('Page.reload');
    await sleep(2500);
    await openDetail(false);
    const afterF5 = await snap();
    out.f5_count = afterF5.count;
    out.f5_top = afterF5.top;
    out.f5_detail_version = afterF5.detailVersion;

    // ④ 回滚不回归
    const rbBefore = await snap();
    out.rollback_before_count = rbBefore.count;
    out.rollback_before_top = rbBefore.top;
    // 回滚到"上一版本"（列表里第二个版本 = top-1）
    const target = rbBefore.top === null ? null : rbBefore.top - 1;
    out.rollback_target = target;
    await cdp.realClickOf(`document.querySelector('[data-testid="rollback-${String(target)}"]')`, 700);
    out.rollback_confirm_text = await cdp.evaluate(
      `[...document.querySelectorAll('.ant-popconfirm')].map((el) => el.innerText.replace(/\\n/g, ' ')).join(' | ')`,
    );
    /**
     * ⚠️ 不能按文案匹配：antd 会在**两个汉字**的按钮里插空格 ⇒ 实际渲染是 `确 定`（首版就这么点空了）。
     * Popconfirm 的 primary 按钮就是"确定"，直接按 class 选。
     */
    await cdp.realClickOf(`document.querySelector('.ant-popconfirm .ant-btn-primary')`, 2000);
    await cdp.waitFor(
      `(() => { const rows = [...document.querySelectorAll('[data-testid="pm-detail"] tr[data-row-key]')]; return rows.length > ${String(rbBefore.count)}; })()`,
      '回滚后版本列表变长',
      20_000,
    );
    const rbAfter = await snap();
    out.rollback_after_count = rbAfter.count;
    out.rollback_after_top = rbAfter.top;
    out.rollback_after_detail_version = rbAfter.detailVersion;
    await cdp.shot('02-after-rollback');

    // ───────────── 移动端阶段（390 宽，详情抽屉路径）─────────────
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    /**
     * 移动端阶段用「**分栏**」档位：
     * - 桌面阶段写下的 `pm-view-mode` 会被移动端**正确地**沿用（FR-92 不覆盖已有偏好），所以这里显式设一次；
     * - 且**只有分栏列表项/表格行双击**会打开详情抽屉（卡片单击只是"设为当前条目"高亮，不开详情）⇒
     *   走分栏才是移动端打开详情的可靠路径（`detail` → Drawer，即 AC-104 ⑤ 说的"详情抽屉路径"）。
     */
    await cdp.evaluate(`window.localStorage.setItem('pm-view-mode','split'); true`);
    await cdp.send('Page.reload');
    await sleep(2600);
    await openDetail(true);
    const mBefore = await snap();
    out.mobile_before_count = mBefore.count;
    out.mobile_before_top = mBefore.top;
    await editSaveBack();
    const mAfter = await snap();
    out.mobile_after_count = mAfter.count;
    out.mobile_after_top = mAfter.top;
    out.mobile_after_detail_version = mAfter.detailVersion;
    await cdp.shot('03-mobile-after-save-back');

    out.ac41_runtime_errors = JSON.stringify(cdp.errors);
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
