/**
 * 阶段 59 / FR-125 / AC-121 G⑫ + F⑪ + C④：远程数据同步弹窗的**真浏览器实测**。
 *
 * 用法：`node tools/ac-stage59-sync-probe.mjs <baseUrl> <sid> <stubUrl> <pc|mobile> <token>`
 * 其中 `<stubUrl>` 是 `tools/ac-stage59-sync-stub.mjs` 的 URL —— 探针直接读它的 `/__stats`
 * 来证明「不点按钮就不出网」与「dry_run 不改远端」。
 *
 * 输出（每行 `KEY:值`，shell 侧 grep 后断言）：
 *   VIEWPORT:<JSON>            实测 innerWidth / innerHeight / devicePixelRatio（FR-118 基线）
 *   MENU_SYNC:true             ⋯更多 菜单里有「远程数据同步」且可点开弹窗
 *   ZERO_OUTBOUND:true         打开弹窗后静置 1.5s，桩上的请求数**没有增加**（不点按钮就不出网）
 *   SYNC_API_CALLS:<JSON>      这段时间里浏览器发出的 /api/sync/* 请求（只应有 GET 配置）
 *   CONFIG_SAVED:true          保存配置后出现「解析后完整路径」区
 *   TARGET:<文本>              `${repo}@${branch}:${path}` —— 界面上显著展示的完整目标路径
 *   TEST_STAGE:<ok|no_file|error>
 *   TEST_TEXT:<弹窗里测试连接结果 Alert 的文本>
 *   TEST_ERROR_ZH:<401 形态下结果 Alert 的文本>
 *   CONFIRM_TEXT:<二次确认框全文>（含条数 / 完整路径 / "包含提示词正文全文"）
 *   CONFIRM_CANCELLED:true     点「取消」后确认框消失
 *   DRYRUN_PUTS:<数字>         取消后桩上的 PUT 次数（必须为 0 ⇒ dry_run 没改远端）
 *   OVERFLOW:<数字>            页面级横向溢出 scrollWidth-clientWidth（必须为 0）
 *   SCREENSHOT:<路径>
 *
 * 尺寸（STANDARDS §4.1 / FR-118）：PC `1440×900 CSS px / DPR 2`、移动 `440×956 CSS px / DPR 3`，
 * 都用 `Emulation.setDeviceMetricsOverride` **显式设置**，绝不用 screen.* / outerWidth。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, stubUrl, viewport, plaintextToken] = process.argv.slice(2);
if (baseUrl === undefined || sid === undefined || stubUrl === undefined || viewport === undefined) {
  throw new Error('用法：node tools/ac-stage59-sync-probe.mjs <baseUrl> <sid> <stubUrl> <pc|mobile> <token>');
}
const isMobile = viewport === 'mobile';
const W = isMobile ? 440 : 1440;
const H = isMobile ? 956 : 900;
const DPR = isMobile ? 3 : 2;
const SHOT_DIR = process.env.AC59_SHOT_DIR ?? 'tmp/shots/stage59-sync';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

const stubStats = async () => {
  const r = await fetch(`${stubUrl}/__stats`);
  return await r.json();
};
const stubMode = async (patch) => {
  await fetch(`${stubUrl}/__mode`, { method: 'POST', body: JSON.stringify(patch) });
};

class Cdp {
  constructor(s) {
    this.socket = s;
    this.nextId = 1;
    this.pending = new Map();
    this.reqs = [];
    s.addEventListener('message', (e) => {
      let m;
      try {
        m = JSON.parse(typeof e.data === 'string' ? e.data : '');
      } catch {
        return;
      }
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params?.request?.url ?? '';
        const me = m.params?.request?.method ?? '';
        const rel = u.startsWith(baseUrl) ? u.replace(baseUrl, '') : '';
        if (rel.startsWith('/api/') || rel.startsWith('/healthz')) this.reqs.push(`${me} ${rel}`);
      }
      if (typeof m.id === 'number' && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error !== undefined) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout ${method}`));
        }
      }, 30000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval');
    return r.result?.value;
  }
  async waitFor(x, l, t = 20000) {
    const d = Date.now() + t;
    for (;;) {
      if ((await this.ev(x)) === true) return;
      if (Date.now() > d) throw new Error(`超时 ${l}`);
      await sleep(120);
    }
  }
  /** 真鼠标点击（AC 纪律：绝不用 JS .click()）。 */
  async click(x, s = 700) {
    const v = await this.ev(
      `(()=>{const el=(${x});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`,
    );
    if (v === null) throw new Error(`找不到 ${x}`);
    const { x: cx, y: cy } = JSON.parse(v);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(s);
  }
  /** 真键盘输入：先 Ctrl+A 全选清空，再 insertText（保证受控组件吃到 React 事件）。 */
  async fill(x, text) {
    await this.click(x, 300);
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await sleep(80);
    await this.send('Input.insertText', { text });
    await sleep(150);
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(SHOT_DIR, { recursive: true });
    const p = path.join(SHOT_DIR, file);
    writeFileSync(p, Buffer.from(r.data, 'base64'));
    return p;
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'pm-s59-sync-'));
const child = spawn(
  CHROME,
  [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--ignore-certificate-errors',
    `--window-size=${String(W)},${String(H)}`,
    `--user-data-dir=${dir}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const out = {};
try {
  let port = null;
  for (let i = 0; i < 120 && port === null; i++) {
    try {
      port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch {
      await sleep(100);
    }
  }
  const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  // FR-118 基线尺寸：CSS px 由 width/height 给，DPR 由 deviceScaleFactor 给。
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: isMobile });
  if (isMobile) {
    // 只开触摸模拟；**不要**再开 setEmitTouchEventsForMouse（会吞掉 Input.dispatchMouseEvent）。
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-topnav"]')!==null`, '主界面');
  await sleep(900);

  out.VIEWPORT = await cdp.ev(
    `JSON.stringify({innerWidth:window.innerWidth,innerHeight:window.innerHeight,devicePixelRatio:window.devicePixelRatio})`,
  );

  // ===== ① 打开「远程数据同步」弹窗 =====
  cdp.reqs.length = 0; // 从这里开始记：打开弹窗只该发一条同步 API（读配置），且不该有任何 GitHub 往来
  await cdp.click(`document.querySelector('[data-testid="pm-topnav"] button[aria-haspopup="menu"], .ant-dropdown-trigger')`, 500);
  await cdp.waitFor(`document.querySelector('[data-testid="pm-menu-sync"]')!==null`, '⋯更多菜单');
  const menuText = await cdp.ev(`(document.querySelector('[data-testid="pm-menu-sync"]')||{}).innerText||''`);
  out.MENU_SYNC = menuText.includes('远程数据同步');
  await cdp.click(`document.querySelector('[data-testid="pm-menu-sync"]')`, 1200);
  await cdp.waitFor(`document.querySelector('[data-testid="sync-config-form"]')!==null`, '同步弹窗');

  // ===== ② 零出网：静置 1.5s，桩上的请求数不增，浏览器也只发了「读配置」这一条 =====
  const before = await stubStats();
  await sleep(1500);
  const after = await stubStats();
  out.ZERO_OUTBOUND = after.requests === before.requests;
  out.SYNC_API_CALLS = JSON.stringify(cdp.reqs.filter((r) => r.includes('/api/sync/')));
  out.STUB_REQUESTS_BEFORE = String(before.requests);

  // ===== ③ 保存配置（真键盘输入，非 JS 赋值）=====
  await cdp.fill(`document.querySelector('[data-testid="sync-repo"]')`, 'Hopetree/sync-data-test');
  await cdp.fill(`document.querySelector('[data-testid="sync-instance"]')`, 'pm');
  await cdp.fill(`document.querySelector('[data-testid="sync-path"]')`, 'promptmanager/pm.json');
  await cdp.fill(`document.querySelector('[data-testid="sync-branch"]')`, 'main');
  if (plaintextToken !== undefined && plaintextToken !== '') {
    await cdp.fill(`document.querySelector('[data-testid="sync-token"]')`, plaintextToken);
  }
  await cdp.click(`document.querySelector('[data-testid="sync-save"]')`, 1200);
  await cdp.waitFor(`document.querySelector('[data-testid="sync-resolved"]')!==null`, '解析后完整路径区');
  out.CONFIG_SAVED = true;
  out.TARGET = await cdp.ev(`(document.querySelector('[data-testid="sync-target"]')||{}).innerText||''`);

  // ===== ④ 测试连接：空仓库 ⇒ "连接正常，但云端还没有这个文件" =====
  await cdp.click(`document.querySelector('[data-testid="sync-test"]')`, 1500);
  await cdp.waitFor(`document.querySelector('[data-testid="sync-test-result"]')!==null`, '测试连接结果');
  const testText = await cdp.ev(`(document.querySelector('[data-testid="sync-test-result"]')||{}).innerText||''`);
  out.TEST_TEXT = testText.replace(/\n/g, ' | ');
  out.TEST_STAGE = testText.includes('云端还没有这个文件') ? 'no_file' : testText.includes('连接正常') ? 'ok' : 'error';

  // 同一枚按钮的 401 形态：桩改成"只认别的 token" ⇒ 界面必须给中文可执行提示，而不是裸抛状态码。
  // 注意：接口失败时弹窗走 message.error（toast），不会渲染成结果 Alert —— 所以要读 toast 容器。
  await stubMode({ token: 'wrong-token-' + String(Date.now()) });
  await cdp.click(`document.querySelector('[data-testid="sync-test"]')`, 900);
  const dumpToast = `(()=>{
    const toasts = [...document.querySelectorAll('.ant-message,.ant-message-notice,[class*="message-notice"]')]
      .map(e => (e.innerText||'').trim()).filter(Boolean);
    const alert = (document.querySelector('[data-testid="sync-test-result"]')||{}).innerText||'';
    return JSON.stringify({ toasts, alert, cls: [...document.querySelectorAll('body > div')].map(e => e.className).filter(c => typeof c === 'string' && c.includes('message')) });
  })()`;
  for (let i = 0; i < 25 && out.TEST_ERROR_ZH === undefined; i++) {
    const seen = JSON.parse(await cdp.ev(dumpToast));
    if (seen.toasts.length > 0) out.TEST_ERROR_ZH = seen.toasts.join(' | ');
    else if (seen.alert.trim() !== '') out.TEST_ERROR_ZH = seen.alert.replace(/\n/g, ' | ');
    else {
      out.TEST_ERROR_DOM = JSON.stringify(seen.cls);
      await sleep(200);
    }
  }
  if (out.TEST_ERROR_ZH === undefined) out.TEST_ERROR_ZH = '(没等到任何错误提示)';
  await stubMode({ token: plaintextToken ?? null });

  // ===== ⑤ 立即上传：先 dry_run ⇒ 二次确认框（条数 + 完整路径 + 含正文全文）=====
  await cdp.click(`document.querySelector('[data-testid="sync-push"]')`, 1600);
  await cdp.waitFor(`document.querySelector('.ant-modal-confirm')!==null`, '上传二次确认框');
  await sleep(400);
  out.CONFIRM_TEXT = ((await cdp.ev(`(document.querySelector('.ant-modal-confirm')||{}).innerText||''`)) || '').replace(/\n/g, ' | ');
  out.SCREENSHOT_CONFIRM = await cdp.shot(`${isMobile ? 'mobile' : 'pc'}-2-confirm.png`);
  // 点「取消」：不上传 ⇒ 桩上不该出现任何 PUT。
  // ⚠️ antd 会在两字按钮里插空格（innerText 是"取 消"），所以要先把空白去掉再比。
  await cdp.click(
    `[...document.querySelectorAll('.ant-modal-confirm .ant-btn')].find(b => (b.innerText||'').replace(/\\s/g,'') === '取消')`,
    900,
  );
  await cdp.waitFor(`document.querySelector('.ant-modal-confirm')===null`, '确认框关闭');
  out.CONFIRM_CANCELLED = true;
  const finalStats = await stubStats();
  out.DRYRUN_PUTS = String(finalStats.puts);
  out.STUB_COMMITS = String(finalStats.commits.length);

  // ===== ⑥ 页面级横向滚动 + 截图 =====
  out.OVERFLOW = String(await cdp.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
  out.SCREENSHOT = await cdp.shot(`${isMobile ? 'mobile' : 'pc'}-1-modal.png`);
} catch (error) {
  // 中途超时也要把已测到的键打出来，否则 shell 侧只能看到一片空值、没法定位。
  out.ERROR = String(error);
} finally {
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  rmSync(dir, { recursive: true, force: true });
}

out.VIEWPORT_LABEL = `${viewport}(${String(W)}x${String(H)}@${String(DPR)}x)`;
for (const [key, value] of Object.entries(out)) process.stdout.write(`${key}:${String(value)}\n`);
if (out.ERROR !== undefined) process.exitCode = 1;
