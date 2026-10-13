#!/usr/bin/env node
/**
 * 阶段 10B 的**运行时**结构探针（AC-31 ④–⑦ + FR-40b 的表格密度 + AC-21）。
 * 零安装：Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP；服务由 `tools/ac-stage10.sh` 起停。
 *
 * 用法：node tools/ac-stage10-probe.mjs <baseUrl> <sid>
 * 输出：每行 `KEY=VALUE`（由 ac-stage10.sh 断言），并把结论打到 stdout。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const baseUrl = process.argv[2];
const sid = process.argv[3];
if (baseUrl === undefined || sid === undefined) {
  console.error('用法：node tools/ac-stage10-probe.mjs <baseUrl> <sid>');
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
  async waitFor(expression, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.evaluate(expression)) === true) return;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
  }
}

async function main() {
  if (CHROME === undefined) throw new Error('找不到 chrome-headless-shell');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac10-'));
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
    if (page === undefined) throw new Error('没有可用的 page target');

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const host = new URL(baseUrl).hostname;
    await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: host, path: '/', httpOnly: true, sameSite: 'Lax' });
    await cdp.send('Page.navigate', { url: baseUrl + '/' });
    // v17（FR-43）起没有「管理页」：唯一主界面默认卡片视图；AC-31 仍有效的结构判据
    // （顶栏 / 侧栏 / 编辑器三栏）在主界面与表格视图里量。
    // ⚠️ KPI 行 / 状态条 / pm-filter-row 随管理页一并移除（D-21），不再断言。
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-search-input"]\')', '主界面出现');
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const t = items.find((n) => n.innerText.indexOf('表格') >= 0); if (t) t.click(); return t !== undefined; })()`,
    );
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-table"]\')', '表格视图出现');
    // 列表是异步加载的：等表格真的渲染出数据行，否则密度会量到 0
    await cdp.waitFor(`document.querySelectorAll('.ant-table-tbody > tr').length > 0`, '列表数据渲染完成');
    await sleep(300);

    // ---- 表格密度（一屏可见行数）
    const rowsDensity = await cdp.evaluate(
      `JSON.stringify((() => {
        const rows = [...document.querySelectorAll('.ant-table-tbody > tr')];
        const inViewport = rows.filter((tr) => { const r = tr.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight; });
        return { rendered: rows.length, inViewport: inViewport.length, viewportH: window.innerHeight,
                 lastRow: inViewport.length ? Math.round(inViewport[inViewport.length - 1].getBoundingClientRect().bottom) : 0 };
      })())`,
    );
    const density = JSON.parse(rowsDensity ?? '{"rendered":-1,"inViewport":-1}');
    const rowsVisible = density.inViewport;
    const listTestids = await cdp.evaluate(
      `['pm-topnav','pm-sidebar','pm-search-input','pm-use-viewmode','pm-view-table'].map((id) => !!document.querySelector('[data-testid="'+id+'"]')).join(',')`,
    );

    // ---- 进编辑器：三栏常驻（④⑤⑥）——表格行内「编辑」
    const opened = await cdp.evaluate(
      `(() => { const b = document.querySelector('[data-testid^="pm-edit-"]'); if (!b) return false; b.click(); return true; })()`,
    );
    if (opened !== true) throw new Error('表格里没有可编辑的 prompt（夹具没建成？）');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-editor"]\')', '编辑器出现');
    await sleep(600);

    const panels = await cdp.evaluate(`document.querySelectorAll('[data-testid^="pm-panel-"]').length`);
    const panelsAllVisible = await cdp.evaluate(
      `[...document.querySelectorAll('[data-testid^="pm-panel-"]')].every((e) => e.offsetParent !== null)`,
    );
    const tabs = await cdp.evaluate(`document.querySelectorAll('.ant-tabs-tab').length`);
    const panelIds = await cdp.evaluate(
      `[...document.querySelectorAll('[data-testid^="pm-panel-"]')].map((e) => e.getAttribute('data-testid')).join(',')`,
    );
    const antClasses = await cdp.evaluate(
      `(() => { const s = new Set(); document.querySelectorAll('*').forEach((el) => { const c = el.getAttribute('class'); if (!c) return; c.split(/\\s+/).forEach((t) => { if (t.startsWith('ant-')) s.add(t); }); }); return s.size; })()`,
    );
    // 运行时的"原生表单/表格元素"只作为**参考信息**：antd 自己也会渲染带 ant-* 类的原生标签
    // （Switch 是 button.ant-switch、Select 内部是 input.ant-select-selection-search-input…），
    // 所以这里数的是"**一个 ant-* 类都没有**"的元素（= 自建控件的特征）；只返回字符串，避免 CDP 序列化 DOM 节点。
    const nativeJson = await cdp.evaluate(
      `JSON.stringify((() => {
        const offenders = [...document.querySelectorAll('button,input,select,textarea,table,dialog')].filter((el) => {
          const cls = el.getAttribute('class') || '';
          return !/(^|\\s)ant-/.test(cls);
        });
        return {
          count: offenders.length,
          sample: offenders.slice(0, 8).map((el) => el.tagName.toLowerCase()
            + (el.getAttribute('class') ? '.' + el.getAttribute('class').split(/\\s+/).join('.') : '.(no-class)')
            + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '')).join(' | '),
        };
      })())`,
    );
    const native = JSON.parse(nativeJson ?? '{"count":-1,"sample":""}');

    console.log(`AC31_LIST_TESTIDS=${listTestids}`);
    console.log(`AC31_ROWS_VISIBLE=${rowsVisible}`);
    console.log(`AC31_ROWS_RENDERED=${density.rendered}`);
    console.log(`AC31_ROWS_LAST_BOTTOM=${density.lastRow}`);
    console.log(`AC31_04_PANELS=${panels}`);
    console.log(`AC31_05_PANELS_ALL_VISIBLE=${panelsAllVisible}`);
    console.log(`AC31_06_TABS=${tabs}`);
    console.log(`AC31_PANEL_IDS=${panelIds}`);
    console.log(`AC21_ANT_CLASSES=${antClasses}`);
    console.log(`AC20_NATIVE_TAGS=${native.count}`);
    console.log(`AC20_NATIVE_SAMPLE=${native.sample}`);
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
  console.error(`FAIL ac-stage10-probe: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
