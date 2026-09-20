#!/usr/bin/env node
/**
 * 阶段 12 运行时探针（v17 修订）：AC-37（主界面纯净度）/ AC-39（反馈与安全提示未误删）/
 * AC-40（技术信息有落点：⋯更多 → 关于，testid 仍为 pm-settings）。
 * ⚠️ AC-38（导航归位）自 BRIEF v17 起由 AC-41 修订取代，本节已移除（改为 tools/ac-stage13.sh）。
 *
 * 零安装：Node 内置 WebSocket 直连 chrome-headless-shell 的 CDP（与 ac-stage11-probe 同一套路）。
 * 用法：node tools/ac-stage12-probe.mjs <baseUrl> <sid> <plainPromptId> <varsPromptId> <exportFixtureFile>
 * 输出：每行 `KEY=VALUE`，由 tools/ac-stage12.sh 断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, plainIdRaw, varsIdRaw, exportFile] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined || plainIdRaw === undefined || varsIdRaw === undefined || exportFile === undefined) {
  console.error('用法：node tools/ac-stage12-probe.mjs <baseUrl> <sid> <plainPromptId> <varsPromptId> <exportFixtureFile>');
  process.exit(2);
}
const plainId = Number(plainIdRaw);
const varsId = Number(varsIdRaw);

/** AC-37 禁用串（BRIEF §8 AC-37 逐字）：[输出用的 ASCII 键, 文本] */
const FORBIDDEN = [
  ['datadir', 'DATA_DIR'],
  ['api_path', '/api/'],
  ['sqlite', 'SQLite'],
  ['listen', '监听'],
  ['query_ms', '本次查询'],
  ['filter_hit', '筛选命中'],
  ['usage_stats', '使用统计'],
  ['api_token', 'API 令牌'],
  ['import', '导入'],
  ['export', '导出'],
  ['render_nowrite', '渲染不写库'],
  ['version_no', 'version_no'],
];

const REPLACE_WARNING = '将清空现有全部 prompt / 文件夹 / 标签 / 版本历史';

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
  async setFile(selector, files) {
    await this.send('DOM.enable');
    const document_ = await this.send('DOM.getDocument', { depth: -1 });
    const found = await this.send('DOM.querySelector', { nodeId: document_.root.nodeId, selector });
    if (!found.nodeId) throw new Error(`找不到文件输入框：${selector}`);
    await this.send('DOM.setFileInputFiles', { files, nodeId: found.nodeId });
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
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'pm-ac12-'));
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
    // 浏览器级会话：授权剪贴板（页面级会话不保证接受该命令）
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
    const bodyText = async () => cdp.evaluate('document.body.innerText');
    // v17：管理动作全在顶栏「⋯更多」菜单里
    const openMore = async () => {
      await clickTestId('header-more');
      await cdp.waitFor(`!!document.querySelector('.ant-dropdown-menu')`, '⋯更多 菜单出现');
      await sleep(250);
    };
    const switchView = async (label) => {
      await cdp.evaluate(
        `(() => { const items = [...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')]; const t = items.find((n) => n.innerText.includes(${JSON.stringify(label)})); if (t) { t.click(); return true; } return false; })()`,
      );
      await sleep(600);
    };
    const clickMenu = async (fragment) => {
      const ok = await cdp.evaluate(
        `(() => { const items = [...document.querySelectorAll('.ant-dropdown-menu-item')]; const target = items.find((n) => n.innerText.includes(${JSON.stringify(fragment)})); if (target) { target.click(); return true; } return false; })()`,
      );
      if (ok !== true) throw new Error(`⋯更多 菜单里点不到：${fragment}`);
      await sleep(400);
    };
    const countOf = (haystack, needle) => haystack.split(needle).length - 1;

    // 干净起点：清 localStorage → 默认使用视图
    await navigate();
    await cdp.evaluate('window.localStorage.clear()');
    await navigate();
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-split"]\')', '默认分栏视图');
    await sleep(400);

    // ---------- AC-37 使用视图纯净度（整个 body 的可见文本） ----------
    const useBody = (await bodyText()) ?? '';
    for (const [key, token] of FORBIDDEN) {
      out[`ac37_${key}`] = String(countOf(useBody, token));
    }
    out.ac37_internal_id_count = String((useBody.match(/#\d+/g) ?? []).length);
    out.ac37_body_head = useBody.replace(/\n+/g, ' | ').slice(0, 160);

    // ---------- AC-40 技术信息有落点（⋯更多 → 设置 → 关于） ----------
    await openMore();
    await clickMenu('关于');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-about"]\')', '关于面板出现');
    await sleep(300);
    const aboutText = (await text('pm-about')) ?? '';
    out.ac40_about_visible = 'true';
    out.ac40_about_has_pmdb = String(aboutText.includes('pm.db'));
    out.ac40_about_has_backup = String(aboutText.includes('备份'));
    out.ac40_about_has_datadir = String(aboutText.includes('DATA_DIR'));
    // v21（FR-52 / D-25）：关于页按"日常使用者"重写，不再暴露 DATA_DIR 这类内部概念；
    // 技术信息"移走不是丢失"的证据改为「备份方式」这一节。
    out.ac40_about_has_backup_way = String(aboutText.includes('备份方式'));
    out.ac40_about_head = aboutText.replace(/\n+/g, ' | ').slice(0, 200);
    // 关掉所有弹层：直接重载页面（最稳，不依赖 Esc / 关闭按钮的焦点语义）
    await navigate();
    await sleep(400);

    // ---------- AC-39 反馈与安全提示未被误删 ----------
    // v19：默认落「分栏」（AC-37 就在分栏下量的）；复制按钮在**卡片视图**里
    await switchView('卡片');
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-view-card"]\')', '卡片视图');
    await clickTestId(`pm-copy-${String(plainId)}`);
    await sleep(700);
    out.ac39_copied_toast = String(((await bodyText()) ?? '').includes('已复制'));

    await clickTestId(`pm-copy-${String(varsId)}`);
    await cdp.waitFor('!!document.querySelector(\'[data-testid="pm-vars-dialog"]\')', '填变量对话框出现');
    await sleep(300);
    await cdp.type('[data-testid="pm-var-input-姓名"]', '张三');
    await sleep(400);
    const missingHint = (await text('pm-vars-missing')) ?? '';
    out.ac39_unfilled_hint = missingHint === '' ? 'missing' : missingHint;
    out.ac39_unfilled_present = String(missingHint.includes('未填'));
    out.ac39_vars_preview = await text('pm-vars-preview');
    await cdp.key('Escape', 'Escape', 27);
    await cdp.waitFor('!document.querySelector(\'[data-testid="pm-vars-dialog"]\')', '填变量对话框关闭');

    // replace 清空警示与二次确认（导入对话框在 ⋯更多 里）
    await openMore();
    await clickMenu('导入');
    await cdp.waitFor('!!document.querySelector(\'.ant-upload-drag\')', '导入对话框出现');
    await sleep(300);
    await cdp.setFile('input[type=file]', [exportFile]);
    await cdp.waitFor(`document.body.innerText.includes('导入模式')`, '导入文件解析完成');
    await cdp.evaluate(
      `(() => { const items = [...document.querySelectorAll('.ant-segmented-item')]; const target = items.find((n) => n.innerText.indexOf('replace') >= 0); if (target) target.click(); return target !== undefined; })()`,
    );
    await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(REPLACE_WARNING)})`, 'replace 清空警示出现');
    out.ac39_replace_warning = 'true';
    out.ac39_replace_warning_text = (
      (await bodyText()) ?? ''
    )
      .split('\n')
      .filter((line) => line.includes(REPLACE_WARNING))[0] ?? '';
    await clickTestId('import-submit');
    await cdp.waitFor('!!document.querySelector(\'.ant-modal-confirm\')', 'replace 二次确认出现');
    const confirmText = await cdp.evaluate('document.querySelector(\'.ant-modal-confirm\').innerText');
    out.ac39_replace_confirm = String(confirmText.includes('确认') && confirmText.includes(REPLACE_WARNING));
    out.ac39_replace_confirm_head = String(confirmText).replace(/\n+/g, ' | ').slice(0, 160);
    // 点「取消」退出确认，**不真的导入**（避免破坏夹具）
    await cdp.evaluate(
      `(() => { const norm = (t) => t.replace(/\\s+/g, ''); const buttons = [...document.querySelectorAll('.ant-modal-confirm button')]; const cancel = buttons.find((b) => norm(b.innerText) === '取消'); if (cancel) cancel.click(); return cancel !== undefined; })()`,
    );
    await sleep(400);
    await cdp.evaluate(
      `(() => { const btn = document.querySelector('.ant-modal-close'); if (btn) btn.click(); return btn !== undefined; })()`,
    );
    await sleep(300);
    out.ac39_import_modal_closed = String(
      (await cdp.evaluate(`!document.querySelector('[data-testid="import-submit"]')`)) === true,
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
