/**
 * 阶段 54 / FR-118 / AC-118 B 段：全面 UI 验证探针（**串行、单浏览器上下文、用完即关**）。
 *
 * 用法：node tools/ac-stage54-ui-probe.mjs <baseUrl> <sid> <form:pc|mobile> <outDir>
 *
 * 资源纪律（BRIEF D-54 ②，228 是 4GB 小机器）：
 *  - **一次只开一个浏览器**（整个 form 的所有界面共用这一个），结束必定 close + 杀进程；
 *  - 绝不并行、绝不同时跑第二个探针；
 *  - 每截完一个界面就把资源（free available / load1）打出来，熔断由外层脚本判断
 *    （available < 800MB 或 load1 > 20 ⇒ 停手）。
 *
 * 交付尺寸（D-54 ①，**硬性**）：PC 1440×900；移动 440×956（isMobile + hasTouch + deviceScaleFactor=1）。
 *
 * 已知的工具坑（D-54 ③，此处已规避，勿"修"）：
 *  - 视图切换点在 Segmented 内的 .ant-segmented-item（按文案），不是 pm-view-* 容器；
 *  - 弹窗内容在 .ant-modal-wrap 内，**本版 antd 没有 .ant-modal-content**；
 *  - 编辑器是 fixed 浮层，**Esc 关不掉**，必须点 [data-testid="editor-back"]，否则拦掉后续所有点击；
 *  - 版本面板在**编辑器**里；版本对比要挑 ≥2 个版本的提示词；
 *  - pm-detail-text 是条件渲染，默认渲染视图下找不到属正常；
 *  - 关于弹窗是懒加载，首次点开要给足时间。
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, form, outDir] = process.argv.slice(2);
const isMobile = form === 'mobile';
// D-54 ① 交付尺寸
const W = isMobile ? 440 : 1440;
const H = isMobile ? 956 : 900;
const TAG = isMobile ? 'mobile' : 'pc';
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

/** 资源快照（每界面一次，供外层做熔断判断） */
function resources() {
  try {
    const out = execFileSync('bash', ['-c', "free -m | awk 'NR==2{print $7}'; uptime | sed 's/.*load average: //' | cut -d, -f1"], { encoding: 'utf8' }).trim().split('\n');
    return { availableMB: Number(out[0]), load1: Number(out[1]) };
  } catch { return { availableMB: -1, load1: -1 }; }
}

class Cdp {
  constructor(s) {
    this.socket = s; this.nextId = 1; this.pending = new Map();
    // ⚠️ 必须挂消息监听，否则 send 发出去后**永远收不到响应**（表现为 `timeout Page.enable`）。
    s.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (typeof m.id !== 'number' || !this.pending.has(m.id)) return;
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      m.error !== undefined ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 25000);
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error(`页内求值失败：${String(e.exception?.description ?? e.text).split('\n')[0]} ← ${expr.slice(0, 120)}`);
    }
    return r.result?.value;
  }
  async waitFor(expr, label, t = 20000) {
    const d = Date.now() + t;
    for (;;) {
      if (await this.ev(expr) === true) return true;
      if (Date.now() > d) throw new Error(`超时：${label}（${expr.slice(0, 100)}）`);
      await sleep(150);
    }
  }
  async box(expr) {
    const v = await this.ev(`(()=>{const el=(${expr});if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height})})()`);
    return v === null ? null : JSON.parse(v);
  }
  /** 真鼠标三连（AC 规范：绝不用 JS .click()） */
  async click(expr, wait = 800) {
    await this.ev(`(()=>{const el=(${expr});el.scrollIntoView({block:'center',inline:'center'});return true})()`).catch(() => {});
    await sleep(150);
    const b = await this.box(expr);
    if (b === null) throw new Error(`点不到：${String(expr).slice(0, 100)}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.cx, y: b.cy, button: 'none', buttons: 0 });
    await sleep(90);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.cx, y: b.cy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.cx, y: b.cy, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(wait);
  }
  async dblclick(expr, wait = 1200) {
    await this.ev(`(()=>{const el=(${expr});el.scrollIntoView({block:'center',inline:'center'});return true})()`).catch(() => {});
    await sleep(150);
    const b = await this.box(expr);
    if (b === null) throw new Error(`双击不到：${String(expr).slice(0, 100)}`);
    const base = { x: b.cx, y: b.cy };
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none', buttons: 0 });
    await sleep(90);
    for (const clickCount of [1, 2]) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, button: 'left', buttons: 1, clickCount });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, button: 'left', buttons: 0, clickCount });
      await sleep(50);
    }
    await sleep(wait);
  }
  async shot(scene) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${TAG}-${String(scene).padStart(2, '0')}-${scene.replace(/[^\w一-龥-]/g, '_')}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

/** 通用量测：页面级横向溢出 / 被裁文字 / 关键元素是否在视口内 */
const MEASURE = `(() => {
  const de = document.documentElement, vw = window.innerWidth;
  const out = {
    innerW: vw, innerH: window.innerHeight,
    docScrollW: de.scrollWidth, docClientW: de.clientWidth,
    pageOverflowX: de.scrollWidth - de.clientWidth,   // ≤2 才算没有页面级横向溢出
    clipped: [],
  };
  for (const el of document.querySelectorAll('td,.ant-card,.ant-list-item,.ant-form-item-label,label,.ant-descriptions-item-content,.ant-alert,.ant-empty-description')) {
    const cs = getComputedStyle(el);
    if (cs.overflow === 'visible' || cs.textOverflow === 'ellipsis') continue; // 刻意省略号不算裁切
    if (el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0) {
      out.clipped.push({ cls: String(el.className).slice(0, 36), over: el.scrollWidth - el.clientWidth, text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 30) });
    }
  }
  out.clipped = out.clipped.slice(0, 6);
  return JSON.stringify(out);
})()`;

/** 弹窗/抽屉量测：取**可见**的那个（antd 关闭动画期间旧节点仍在 DOM 里，会量错） */
const OVERLAY = `(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const ds = [...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis);
  const d = ds.length ? ds[ds.length - 1] : null;
  const ms = [...document.querySelectorAll('.ant-modal-wrap')].filter(vis);
  const m = ms.length ? ms[ms.length - 1] : null;
  const mIn = m === null ? null : m.querySelector('.ant-modal');
  const mBody = m === null ? null : m.querySelector('.ant-modal-body');
  const dBody = d === null ? null : d.querySelector('.ant-drawer-body');
  return JSON.stringify({
    drawerW: d === null ? null : Math.round(d.getBoundingClientRect().width),
    drawerH: d === null ? null : Math.round(d.getBoundingClientRect().height),
    drawerTop: d === null ? null : Math.round(d.getBoundingClientRect().top),
    drawerBodyScroll: dBody === null ? null : { scrollH: dBody.scrollHeight, clientH: dBody.clientHeight, canScroll: dBody.scrollHeight > dBody.clientHeight },
    modalW: mIn === null ? null : Math.round(mIn.getBoundingClientRect().width),
    modalH: mIn === null ? null : Math.round(mIn.getBoundingClientRect().height),
    modalTop: mIn === null ? null : Math.round(mIn.getBoundingClientRect().top),
    modalBottom: mIn === null ? null : Math.round(mIn.getBoundingClientRect().bottom),
    modalBodyScroll: mBody === null ? null : { scrollH: mBody.scrollHeight, clientH: mBody.clientHeight, canScroll: mBody.scrollHeight > mBody.clientHeight },
  });
})()`;

const dir = mkdtempSync(path.join(tmpdir(), 'pm-s54-'));
const child = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--force-color-profile=srgb', `--window-size=${W},${H}`, '--user-data-dir=' + dir, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

let cdp = null;
const results = [];
async function record(scene, note, extra) {
  const m = JSON.parse(await cdp.ev(MEASURE));
  const ov = JSON.parse(await cdp.ev(OVERLAY));
  const file = await cdp.shot(scene);
  const res = resources();
  const row = { scene, file: path.basename(file), viewport: `${W}x${H}`, ...m, ...ov, ...(extra || {}), resources: res };
  results.push(row);
  console.log(`SCENE|${JSON.stringify(row)}`);
  console.log(`RES|${scene}|avail=${res.availableMB}MB load1=${res.load1}`);
  return row;
}

try {
  let port = null;
  for (let i = 0; i < 120 && port === null; i++) {
    try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: isMobile,
  });
  if (isMobile) {
    // D-54 ①：移动端必须 isMobile=true（上面 setDeviceMetricsOverride 的 mobile）+ hasTouch=true + deviceScaleFactor=1
    // ⚠️ 只开 setTouchEmulationEnabled。**不要**再开 setEmitTouchEventsForMouse —— 它会把后续
    //    Input.dispatchMouseEvent 吞掉，表现为 `timeout Input.dispatchMouseEvent`，
    //    那样连"真鼠标"这条 AC 纪律都做不成了。
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  // ===== ① 登录页（先不带 cookie 截，截完再种 cookie）=====
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-login"]')!==null`, '登录页');
  await sleep(800);
  await record('login', '未登录态', {
    hasVerticalScroll: await cdp.ev(`document.documentElement.scrollHeight > document.documentElement.clientHeight`),
    docH: await cdp.ev('document.documentElement.scrollHeight'),
    clientH: await cdp.ev('document.documentElement.clientHeight'),
    inputs: await cdp.ev(`document.querySelectorAll('[data-testid="pm-login"] input').length`),
    buttonText: await cdp.ev(`(()=>{const b=document.querySelector('[data-testid="pm-login"] button');return b===null?null:(b.innerText||'').trim()})()`),
  });

  // 种会话 cookie，转入已登录态
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-topnav"]')!==null`, '主界面');
  await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"],.ant-table-tbody tr.ant-table-row,[data-testid="pm-split-item"]')!==null`, '列表内容');
  await sleep(1200);

  const setView = async (label) => cdp.click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>(el.innerText||'').trim()==='${label}')`, 1200);
  const moreMenu = async (itemText) => {
    await cdp.click(`document.querySelector('[data-testid="header-more"]')`, 700);
    await cdp.waitFor(`document.querySelector('.ant-dropdown-menu')!==null`, '⋯更多菜单');
    await cdp.click(`[...document.querySelectorAll('.ant-dropdown-menu-item')].find(el=>(el.innerText||'').includes('${itemText}'))`, 1500);
  };
  /** 关浮层：弹窗用 Esc；**编辑器浮层 Esc 不掉，必须点 editor-back** */
  const closeOverlay = async () => {
    for (let i = 0; i < 25; i++) {
      const state = await cdp.ev(`(() => {
        const ov = document.querySelector('[data-testid="pm-editor-overlay"]');
        const open = ov !== null && ov.getBoundingClientRect().width > 1;
        return { editor: open };
      })()`);
      if (!state.editor) break;
      const back = `document.querySelector('[data-testid="editor-back"]')`;
      if (await cdp.ev(`${back} !== null`)) await cdp.click(back, 900);
      else break;
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    // 等到没有可见抽屉/弹窗为止
    for (let i = 0; i < 30; i++) {
      const open = await cdp.ev(`(() => {
        const vis = e => e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1;
        return [...document.querySelectorAll('.ant-drawer-content-wrapper,.ant-modal-wrap')].some(vis);
      })()`);
      if (!open) break;
      await sleep(200);
    }
    await sleep(400);
  };
  const cardByTitle = (title) => `(()=>{const c=[...document.querySelectorAll('[data-testid="pm-use-card"]')].find(e=>(e.innerText||'').includes('${title}'));return c===undefined?null:c})()`;
  const openDetail = async (title) => {
    await setView('卡片');
    await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`, '卡片');
    await sleep(500);
    const sel = cardByTitle(title);
    if (await cdp.ev(`${sel} === null`)) return false;
    await cdp.dblclick(sel, 1600);
    return await cdp.ev(`document.querySelector('[data-testid="pm-detail"]')!==null`);
  };

  // ===== ② 卡片视图 =====
  await setView('卡片');
  await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`, '卡片');
  await sleep(600);
  await record('cards', '主工作区·卡片视图', {
    cardCount: await cdp.ev(`document.querySelectorAll('[data-testid="pm-use-card"]').length`),
    cardFooter: await cdp.ev(`(() => {
      const f = document.querySelector('[data-testid^="pm-card-footer-"]');
      if (!f) return null;
      const meta = f.firstElementChild;
      const items = [...meta.children].filter(el => (el.innerText || '').trim() !== '');
      return { full: (f.innerText || '').replace(/\\n/g, ' ⏎ '), first: (items[0]?.innerText || '').replace(/\\n/g, ' ').trim(), firstHasIcon: items[0]?.querySelector('svg,.anticon') != null, gap: getComputedStyle(meta).gap, seps: [...meta.children].filter(el => (el.innerText || '').trim() === '·').length };
    })()`),
  });

  // ===== ③ 表格视图 =====
  await setView('表格');
  await cdp.waitFor(`document.querySelector('.ant-table-thead th')!==null`, '表格');
  await sleep(700);
  const tableBase = await cdp.ev(`(() => {
    const t = document.querySelector('.ant-table-content') || document.querySelector('.ant-table-body');
    return { cols: [...document.querySelectorAll('.ant-table-thead th')].map(e => (e.innerText || '').trim()), scrollW: t ? t.scrollWidth : null, clientW: t ? t.clientWidth : null, rows: document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length };
  })()`);
  // 移动端专项：把 scrollLeft 从 0 往右移，确认能移 + 末列操作按钮右缘 ≤ 视口宽
  let tableScrollProbe = null;
  if (isMobile && tableBase.clientW !== null) {
    tableScrollProbe = await cdp.ev(`(() => {
      const t = document.querySelector('.ant-table-content') || document.querySelector('.ant-table-body');
      t.scrollLeft = 0; const before = t.scrollLeft;
      t.scrollLeft = 99999; const after = t.scrollLeft;
      const row = document.querySelector('.ant-table-tbody tr.ant-table-row');
      const btn = row === null ? null : row.querySelector('td:last-child button');
      const br = btn === null ? null : btn.getBoundingClientRect();
      const tr = row === null ? null : row.getBoundingClientRect();
      return { scrollLeftBefore: before, scrollLeftAfter: after, canScroll: after > before,
               btnRight: br === null ? null : Math.round(br.right), viewportW: window.innerWidth,
               btnWithinViewport: br === null ? null : br.right <= window.innerWidth + 2,
               lastColRight: tr === null ? null : Math.round(tr.right) };
    })()`);
    await sleep(400);
  }
  await record('table', '主工作区·表格视图', { ...tableBase, tableScrollProbe });

  // ===== ④ 分栏视图 =====
  await setView('分栏');
  await cdp.waitFor(`document.querySelector('[data-testid="pm-split-item"]')!==null`, '分栏');
  await sleep(600);
  await record('split', '主工作区·分栏视图', {
    items: await cdp.ev(`document.querySelectorAll('[data-testid="pm-split-item"]').length`),
  });

  // ===== ⑤ 侧栏·文件夹面板（移动端要先开筛选抽屉）=====
  if (isMobile) {
    const fb = `document.querySelector('button[aria-label="筛选"]')`;
    if (await cdp.ev(`${fb} !== null`)) { await cdp.click(fb, 1300); await sleep(800); }
  }
  await record('sidebar-folders', '侧栏·文件夹面板', {
    sidebarVisible: await cdp.ev(`(()=>{const s=document.querySelector('[data-testid="pm-sidebar"]');if(s===null)return false;const r=s.getBoundingClientRect();return r.width>0&&r.height>0})()`),
    hasCreate: await cdp.ev(`document.querySelector('[data-testid="folder-create"]')!==null`),
    text: await cdp.ev(`(()=>{const s=document.querySelector('[data-testid="pm-sidebar"]');return s===null?null:(s.innerText||'').replace(/\\s+/g,' ').slice(0,140)})()`),
  });

  // ===== ⑥ 侧栏·标签面板 =====
  await record('sidebar-tags', '侧栏·标签面板', {
    tagCloud: await cdp.ev(`document.querySelector('[data-testid="pm-tag-cloud"]')!==null`),
    tags: await cdp.ev(`(()=>{const c=document.querySelector('[data-testid="pm-tag-cloud"]');return c===null?'[]':JSON.stringify([...c.querySelectorAll('[data-testid="pm-tag-chip"]')].map(e=>(e.innerText||'').trim()))})()`),
  });
  if (isMobile) await closeOverlay();

  // ===== ⑦ 提示词详情 =====
  if (await openDetail('周报模板')) {
    await record('detail', '提示词详情', {
      title: await cdp.ev(`(()=>{const t=document.querySelector('[data-testid="pm-detail-title"]');return t===null?null:(t.innerText||'').trim()})()`),
      hasHead: await cdp.ev(`document.querySelector('[data-testid="pm-detail-head"]')!==null`),
      hasMeta: await cdp.ev(`document.querySelector('[data-testid="pm-detail-meta"]')!==null`),
      hasActions: await cdp.ev(`document.querySelector('[data-testid="pm-detail-actions"]')!==null`),
      hasCopy: await cdp.ev(`document.querySelector('[data-testid="pm-detail-copy"]')!==null`),
      hasEdit: await cdp.ev(`document.querySelector('[data-testid="pm-detail-edit"]')!==null`),
      detailPanelW: await cdp.ev(`(()=>{const d=document.querySelector('[data-testid="pm-detail"]');return d===null?null:Math.round(d.getBoundingClientRect().width)})()`),
      // pm-detail-text 只在"源码"模式出现，默认渲染视图下为 null 属正常（D-54 ③）
      detailPlainTextNode: await cdp.ev(`document.querySelector('[data-testid="pm-detail-text"]')!==null`),
    });
  }

  // ===== ⑧ 提示词编辑器（打开已有多版本那条的编辑器）=====
  await closeOverlay();
  if (await openDetail('多版本示例')) {
    if (await cdp.ev(`document.querySelector('[data-testid="pm-detail-edit"]')!==null`)) {
      await cdp.click(`document.querySelector('[data-testid="pm-detail-edit"]')`, 2500);
      if (await cdp.ev(`document.querySelector('[data-testid="pm-editor"]')!==null`)) {
        await sleep(1500);
        await record('editor', '提示词编辑器（编辑已有多版本的提示词）', {
          overlayIsFixed: await cdp.ev(`(()=>{const o=document.querySelector('[data-testid="pm-editor-overlay"]');return o===null?null:getComputedStyle(o).position})()`),
          hasTitleInput: await cdp.ev(`document.querySelector('[data-testid="pm-editor"] input')!==null`),
          panels: await cdp.ev(`JSON.stringify([...document.querySelectorAll('[data-testid="pm-panel-markdown"],[data-testid="pm-panel-variables"],[data-testid="pm-panel-versions"]')].map(e=>e.getAttribute('data-testid')))`),
          hasBack: await cdp.ev(`document.querySelector('[data-testid="editor-back"]')!==null`),
        });

        // ===== ⑨ 版本面板 =====
        if (await cdp.ev(`document.querySelector('[data-testid="pm-panel-versions"]')!==null`)) {
          await cdp.click(`document.querySelector('[data-testid="pm-panel-versions"]')`, 1500);
          await sleep(900);
          await record('versions', '版本面板（编辑器内）', {
            text: await cdp.ev(`(()=>{const v=document.querySelector('[data-testid="pm-panel-versions"]');return v===null?null:(v.innerText||'').replace(/\\s+/g,' ').slice(0,150)})()`),
            hasViews: await cdp.ev(`document.querySelector('[data-testid="pm-version-views"]')!==null`),
          });

          // ===== ⑩ 版本对比 =====
          const cmpSel = `(()=>{const s=document.querySelector('[data-testid="pm-version-views"]');if(s===null)return null;return [...s.querySelectorAll('.ant-segmented-item')].find(e=>(e.innerText||'').includes('对比版本'))??null})()`;
          if (await cdp.ev(`${cmpSel} !== null`)) {
            await cdp.click(cmpSel, 2000);
            await sleep(800);
            await record('versions-compare', '版本对比（上一版 ↔ 最新）', {
              text: await cdp.ev(`(()=>{const v=document.querySelector('[data-testid="pm-panel-versions"]');return v===null?null:(v.innerText||'').replace(/\\s+/g,' ').slice(0,220)})()`),
              hasPrevBtn: await cdp.ev(`document.querySelector('[data-testid="pm-vdetail-compare-prev"]')!==null`),
              diffBlocks: await cdp.ev(`document.querySelectorAll('[data-testid="pm-panel-versions"] pre,[data-testid="pm-panel-versions"] .diff-add,[data-testid="pm-panel-versions"] .diff-del').length`),
            });
          }
        }
        await closeOverlay(); // 编辑器必须点 editor-back（D-54 ③）
      }
    }
  }
  await closeOverlay();

  // ===== ⑪ 变量填写弹窗 =====
  await setView('卡片');
  await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`, '卡片');
  await sleep(600);
  const varsSel = `(()=>{const b=[...document.querySelectorAll('[data-testid^="pm-copy-"]')].find(x=>(x.innerText||'').includes('填值后复制'));return b===undefined?null:b})()`;
  if (await cdp.ev(`${varsSel} !== null`)) {
    await cdp.click(varsSel, 1800);
    if (await cdp.ev(`document.querySelector('[data-testid="pm-vars-dialog"]')!==null`)) {
      await record('vars', '变量填写弹窗', {
        fields: await cdp.ev(`document.querySelectorAll('[data-testid="pm-vars-dialog"] input').length`),
        text: await cdp.ev(`(()=>{const d=document.querySelector('[data-testid="pm-vars-dialog"]');return d===null?null:(d.innerText||'').replace(/\\s+/g,' ').slice(0,120)})()`),
      });
    }
    await closeOverlay();
  }

  // ===== ⑫ 导入 / 导出弹窗 =====
  await moreMenu('导入 / 导出');
  await cdp.waitFor(`document.querySelector('.ant-modal-wrap')!==null`, '导入导出弹窗').catch(() => {});
  await sleep(900);
  await record('import-export', '导入 / 导出弹窗', {
    title: await cdp.ev(`(()=>{const t=document.querySelector('.ant-modal-title');return t===null?null:(t.innerText||'').trim()})()`),
    hasTextarea: await cdp.ev(`document.querySelector('.ant-modal textarea')!==null`),
  });
  await closeOverlay();

  // ===== ⑬ 修改口令弹窗 =====
  await moreMenu('修改密码');
  await cdp.waitFor(`document.querySelector('[data-testid="pm-password-modal"]')!==null`, '修改口令弹窗').catch(() => {});
  await sleep(800);
  await record('password', '修改口令弹窗', {
    fields: await cdp.ev(`document.querySelectorAll('[data-testid="pm-password-modal"] input').length`),
    hasOld: await cdp.ev(`document.querySelector('[data-testid="pm-old-password"]')!==null`),
    hasNew: await cdp.ev(`document.querySelector('[data-testid="pm-new-password"]')!==null`),
    hasConfirm: await cdp.ev(`document.querySelector('[data-testid="pm-confirm-password"]')!==null`),
  });
  await closeOverlay();

  // ===== ⑭ API 令牌抽屉 =====
  await moreMenu('API 令牌');
  await cdp.waitFor(`document.querySelector('.ant-drawer-content-wrapper')!==null`, '令牌抽屉', 25000).catch(() => {});
  await sleep(2200);
  const tokenScrollProbe = isMobile ? await cdp.ev(`(() => {
    const vis = e => e.getBoundingClientRect().width > 1;
    const ds = [...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis);
    const d = ds.length ? ds[ds.length - 1] : null;
    const t = d === null ? null : (d.querySelector('.ant-table-body') || d.querySelector('.ant-table-content'));
    if (t === null) return null;
    t.scrollLeft = 0; const before = t.scrollLeft; t.scrollLeft = 99999; const after = t.scrollLeft;
    const firstTh = d.querySelector('.ant-table-thead th');
    const row = d.querySelector('.ant-table-tbody tr.ant-table-row');
    const btn = row === null ? null : row.querySelector('td:last-child button');
    const br = btn === null ? null : btn.getBoundingClientRect();
    return { scrollLeftBefore: before, scrollLeftAfter: after, canScroll: after > before,
             firstColText: firstTh === null ? null : (firstTh.innerText || '').trim(),
             firstColW: firstTh === null ? null : Math.round(firstTh.getBoundingClientRect().width),
             btnRight: br === null ? null : Math.round(br.right), viewportW: window.innerWidth,
             btnWithinViewport: br === null ? null : br.right <= window.innerWidth + 2 };
  })()`) : null;
  await sleep(400);
  await record('tokens', 'API 令牌抽屉', {
    cols: await cdp.ev(`(()=>{const vis=e=>e.getBoundingClientRect().width>1;const ds=[...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis);const d=ds.length?ds[ds.length-1]:null;return d===null?'[]':JSON.stringify([...d.querySelectorAll('.ant-table-thead th')].map(t=>(t.innerText||'').trim()))})()`),
    tokenColors: await cdp.ev(`(() => {
      const vis = e => e.getBoundingClientRect().width > 1;
      const ds = [...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis);
      const d = ds.length ? ds[ds.length - 1] : null;
      if (d === null) return '[]';
      return JSON.stringify([...d.querySelectorAll('.ant-table-tbody tr.ant-table-row')].map(r => {
        const tag = [...r.querySelectorAll('.ant-tag')].find(t => /只读|读写|已撤销/.test(t.innerText || '')) ?? null;
        return { name: (r.querySelector('td')?.innerText || '').trim().slice(0, 14), scope: tag === null ? null : (tag.innerText || '').replace(/\\s+/g, ' ').trim(), bg: tag === null ? null : getComputedStyle(tag).backgroundColor, fg: tag === null ? null : getComputedStyle(tag).color };
      }));
    })()`),
    tokenScrollProbe,
  });
  await closeOverlay();

  // ===== ⑮ 使用统计抽屉 =====
  await moreMenu('使用统计');
  await cdp.waitFor(`document.querySelector('.ant-drawer-content-wrapper')!==null`, '使用统计抽屉', 25000).catch(() => {});
  await sleep(2500);
  await record('usage', '使用统计（取用记录）抽屉', {
    text: await cdp.ev(`(()=>{const vis=e=>e.getBoundingClientRect().width>1;const ds=[...document.querySelectorAll('.ant-drawer')].filter(vis);const d=ds.length?ds[ds.length-1]:null;return d===null?null:(d.innerText||'').replace(/\\s+/g,' ').slice(0,150)})()`),
  });
  await closeOverlay();

  // ===== ⑯ 关于弹窗（懒加载，给足时间）=====
  await moreMenu('关于');
  await cdp.waitFor(`document.querySelector('[data-testid="pm-about"]')!==null`, '关于弹窗', 25000).catch(() => {});
  await sleep(2000);
  await record('about', '关于弹窗', {
    address: await cdp.ev(`(()=>{const rows=[...document.querySelectorAll('[data-testid="pm-about"] .ant-descriptions-row')];const r=rows.find(x=>(x.innerText||'').includes('访问地址'));const c=r===undefined?null:r.querySelector('.ant-descriptions-item-content');return c===null?null:(c.innerText||'').trim()})()`),
    serviceRows: await cdp.ev(`document.querySelectorAll('[data-testid="pm-about"] .ant-descriptions-row').length`),
    statusTag: await cdp.ev(`(()=>{const t=document.querySelector('[data-testid="pm-about"] .ant-tag');return t===null?null:(t.innerText||'').trim()})()`),
    panels: await cdp.ev(`JSON.stringify([...document.querySelectorAll('[data-testid="pm-about"] .ant-collapse-item')].map(p=>(p.querySelector('.ant-collapse-header')?.innerText||'').trim()))`),
  });
  await closeOverlay();

  // ===== ⑰ 空态：搜索无结果（不是空库）=====
  await setView('卡片');
  await sleep(500);
  const searchSel = `document.querySelector('[data-testid="pm-search-input"]')`;
  await cdp.click(searchSel, 300);
  await cdp.send('Input.insertText', { text: 'zzz-不存在的关键词-zzz' });
  await sleep(2000);
  await record('empty-search', '空态（搜索无结果）', {
    emptyText: await cdp.ev(`(()=>{const e=document.querySelector('[data-testid="pm-brand-art-empty"]');const root=e===null?null:e.closest('[class*="empty"],.ant-empty,div');return root===null?null:(root.innerText||'').replace(/\\s+/g,' ').slice(0,120)})()`),
    cardCount: await cdp.ev(`document.querySelectorAll('[data-testid="pm-use-card"]').length`),
  });
  // 清空搜索
  await cdp.click(searchSel, 300);
  for (let i = 0; i < 30; i++) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }); }
  await sleep(1500);

  // ===== ⑱ 深色主题（三态循环：亮→暗→跟随系统；点到达暗为止）=====
  // ⚠️ 判据必须读 **document.body**（实际画布色）。`documentElement` 的 backgroundColor
  //    在明暗两态都恒为 `rgba(0,0,0,0)`，拿它判会**永远判不出暗色**，于是连点 3 次
  //    （跟随系统→亮→暗→跟随系统）又转回浅色，截出一张"名为深色、实为浅色"的图。
  let clicks = 0, isDark = false, bg = '';
  for (let i = 0; i < 3; i++) {
    await cdp.click(`document.querySelector('[data-testid="pm-theme-toggle"]')`, 1000);
    clicks++;
    bg = String(await cdp.ev(`getComputedStyle(document.body).backgroundColor`));
    if (bg === 'rgb(1, 1, 2)') { isDark = true; break; }   // 暗色画布 = #010102
  }
  await sleep(700);
  await record('dark', '深色主题', {
    isDark, clicks,
    themeLabel: await cdp.ev(`(()=>{const b=document.querySelector('[data-testid="pm-theme-toggle"]');return b===null?null:(b.getAttribute('title')||'').trim()})()`),
    bodyBg: await cdp.ev(`getComputedStyle(document.body).backgroundColor`),
    cardBg: await cdp.ev(`(()=>{const c=document.querySelector('[data-testid="pm-use-card"]');return c===null?null:getComputedStyle(c).backgroundColor})()`),
    cardText: await cdp.ev(`(()=>{const c=document.querySelector('[data-testid="pm-use-card"] .ant-typography');return c===null?null:getComputedStyle(c).color})()`),
  });

  console.log('DONE');
  writeFileSync(path.join(outDir, `_results-${TAG}.json`), JSON.stringify(results, null, 2));
} catch (err) {
  console.log(`FATAL|${String(err && err.message ? err.message : err)}`);
  writeFileSync(path.join(outDir, `_results-${TAG}.json`), JSON.stringify({ error: String(err && err.message ? err.message : err), done: results }, null, 2));
  process.exitCode = 1;
} finally {
  // 单上下文用完即关（D-54 ②）
  try { if (cdp !== null) await cdp.send('Browser.close'); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
  console.log(`CLOSED|${TAG}`);
}
