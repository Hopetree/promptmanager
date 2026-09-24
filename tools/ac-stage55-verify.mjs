/**
 * 阶段 55 / AC-119：五项小修的真浏览器实测（串行、单上下文、用完即关）。
 *
 * 用法：node tools/ac-stage55-verify.mjs <baseUrl> <sid> <form:pc|mobile> <outDir>
 *
 * 覆盖：
 *   ① 使用统计口径文案（两处都不再提"打开详情"计入）
 *   ② 空态两种场景（库为空 vs 搜索无匹配）× 两处视图（UseView / SplitView）
 *   ③ 分隔符对比度（亮/暗）与形态（字形/宽度/gap/不可选中）
 *   ④ Token 掩码单行 + 移动端 7 列均 >0 / 名称列非 0 / 可横滚 / 末列按钮可达
 *   ⑤ 移动端「文件夹」列不折行
 *
 * 输出：每项一行 `CHECK|<项>|<JSON>`，由 tools/ac-stage55.sh 断言。
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid, form, outDir] = process.argv.slice(2);
const isMobile = form === 'mobile';
const W = isMobile ? 440 : 1440;
const H = isMobile ? 956 : 900;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

function resources() {
  try {
    const o = execFileSync('bash', ['-c', "free -m | awk 'NR==2{print $7}'; uptime | sed 's/.*load average: //' | cut -d, -f1"], { encoding: 'utf8' }).trim().split('\n');
    return { availableMB: Number(o[0]), load1: Number(o[1]) };
  } catch { return { availableMB: -1, load1: -1 }; }
}
const check = (id, data) => {
  const res = resources();
  console.log(`CHECK|${id}|${JSON.stringify({ ...data, _res: res })}`);
};

class Cdp {
  constructor(s) {
    this.socket = s; this.n = 1; this.p = new Map();
    s.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (typeof m.id !== 'number' || !this.p.has(m.id)) return;
      const q = this.p.get(m.id); this.p.delete(m.id);
      m.error ? q.reject(new Error(m.error.message)) : q.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = this.n++;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error('timeout ' + method)); } }, 25000);
    });
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split('\n')[0]);
    return r.result?.value;
  }
  async waitFor(e, l, t = 20000) {
    const d = Date.now() + t;
    for (;;) { if (await this.ev(e) === true) return; if (Date.now() > d) throw new Error('超时 ' + l); await sleep(150); }
  }
  async click(expr, wait = 900) {
    await this.ev(`(()=>{const el=(${expr});el.scrollIntoView({block:'center',inline:'center'});return true})()`).catch(() => {});
    await sleep(150);
    const b = await this.ev(`(()=>{const el=(${expr});if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
    if (b === null) throw new Error('点不到 ' + String(expr).slice(0, 70));
    const { x, y } = JSON.parse(b);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }); await sleep(90);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(wait);
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(outDir, `${form}-${name}.png`), Buffer.from(r.data, 'base64'));
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'pm-s55-'));
const child = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--force-color-profile=srgb', `--window-size=${W},${H}`, '--user-data-dir=' + dir, '--remote-debugging-port=0', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

let cdp = null;
const moreMenu = async (item) => {
  await cdp.click(`document.querySelector('[data-testid="header-more"]')`, 700);
  await cdp.waitFor(`document.querySelector('.ant-dropdown-menu')!==null`, '⋯更多');
  await cdp.click(`[...document.querySelectorAll('.ant-dropdown-menu-item')].find(el=>(el.innerText||'').includes('${item}'))`, 1600);
};
const closeOverlay = async () => {
  for (let i = 0; i < 25; i++) {
    if (await cdp.ev(`document.querySelector('[data-testid="pm-editor-overlay"]')===null`)) break;
    const back = `document.querySelector('[data-testid="editor-back"]')`;
    if (await cdp.ev(`${back} !== null`)) await cdp.click(back, 800); else break;
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  for (let i = 0; i < 30; i++) {
    const open = await cdp.ev(`(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>1&&r.height>1};return [...document.querySelectorAll('.ant-drawer-content-wrapper,.ant-modal-wrap')].some(vis)})()`);
    if (!open) break;
    await sleep(200);
  }
  await sleep(400);
};

try {
  let port = null;
  for (let i = 0; i < 120 && port === null; i++) {
    try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: isMobile });
  if (isMobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: baseUrl + '/' });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-topnav"]')!==null`, '主界面');
  await sleep(2200);

  const setView = async (label) => cdp.click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>(el.innerText||'').trim()==='${label}')`, 1200);

  // ================= ② 空态：先测「搜索无匹配」（两处视图） =================
  const EMPTY_TEXT = `(() => {
    const e = document.querySelector('[data-testid="pm-brand-art-empty"]')?.closest('div');
    const all = [...document.querySelectorAll('div')].filter(x => {
      const t = (x.innerText || '').trim();
      return t.includes('条目') || t.includes('还没有可用的 prompt');
    });
    // 取最短的那个（含主+副标题但不含外层重复文本）
    let best = null;
    for (const x of all) { const t = (x.innerText || '').replace(/\\s+/g, ' ').trim(); if (t && (best === null || t.length < best.length)) best = t; }
    return best;
  })()`;

  for (const view of ['卡片', '分栏']) {
    await setView(view);
    await sleep(1200);
    const search = `document.querySelector('[data-testid="pm-search-input"]')`;
    await cdp.click(search, 400);
    await cdp.send('Input.insertText', { text: 'zzz-不存在-zzz' });
    await sleep(2000);
    const t = await cdp.ev(EMPTY_TEXT);
    check('empty-nomatch-' + view, { view, text: t, isMisleading: t !== null && t.includes('还没有可用的 prompt') });
    await cdp.shot('empty-nomatch-' + view);
    // 清空搜索
    await cdp.click(search, 300);
    for (let i = 0; i < 30; i++) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    }
    await sleep(1500);
  }

  // ================= ③ 分隔符：形态 + 颜色 =================
  await setView('卡片');
  await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`, '卡片');
  await sleep(700);
  const sep = await cdp.ev(`(() => {
    const f = document.querySelector('[data-testid^="pm-card-footer-"]');
    const meta = f.firstElementChild;
    const seps = [...meta.children].filter(el => (el.innerText || '').trim() === '·');
    const card = f.closest('[data-testid="pm-use-card"]');
    const cs = getComputedStyle(seps[0]);
    return {
      count: seps.length,
      glyph: seps[0].innerText.trim(),
      width: +seps[0].getBoundingClientRect().width.toFixed(2),
      color: cs.color,
      userSelect: cs.userSelect,
      ariaHidden: seps[0].getAttribute('aria-hidden'),
      className: seps[0].className,
      gap: getComputedStyle(meta).gap,
      cardBg: getComputedStyle(card).backgroundColor,
    };
  })()`);
  check('separator', sep);
  await cdp.shot('cards');

  // 深色下的分隔符
  for (let i = 0; i < 3; i++) {
    await cdp.click(`document.querySelector('[data-testid="pm-theme-toggle"]')`, 1000);
    if (String(await cdp.ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(1, 1, 2)') break;
  }
  await sleep(700);
  const sepDark = await cdp.ev(`(() => {
    const f = document.querySelector('[data-testid^="pm-card-footer-"]');
    const meta = f.firstElementChild;
    const s = [...meta.children].find(el => (el.innerText || '').trim() === '·');
    const card = f.closest('[data-testid="pm-use-card"]');
    return { color: getComputedStyle(s).color, cardBg: getComputedStyle(card).backgroundColor };
  })()`);
  check('separator-dark', sepDark);
  await cdp.shot('cards-dark');
  // 切回浅色
  for (let i = 0; i < 3; i++) {
    if (String(await cdp.ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(255, 255, 255)') break;
    await cdp.click(`document.querySelector('[data-testid="pm-theme-toggle"]')`, 800);
  }
  await sleep(600);

  // ================= ① 使用统计：两处口径文案 =================
  await moreMenu('使用统计');
  await cdp.waitFor(`document.querySelector('.ant-drawer-content-wrapper')!==null`, '使用统计抽屉', 25000);
  await sleep(2500);
  const usage = await cdp.ev(`(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const d = [...document.querySelectorAll('.ant-drawer')].filter(vis).pop();
    if (d === null) return { err: 'no drawer' };
    const text = (d.innerText || '').replace(/\\s+/g, ' ');
    const rows = [...d.querySelectorAll('.ant-descriptions-row')].map(r => (r.innerText || '').replace(/\\n/g, ' = ').trim());
    const kou = rows.find(r => r.startsWith('口径')) || '';
    const m = text.match(/复制提示词[^]*?打开详情[^。]*。/);
    return { kouJing: kou, emptyHint: m === null ? null : m[0], fullText: text.slice(0, 400) };
  })()`);
  check('usage-copy', usage);
  await cdp.shot('usage');
  await closeOverlay();

  // ================= ④ Token 掩码 + 移动端 7 列 =================
  await moreMenu('API 令牌');
  await cdp.waitFor(`document.querySelector('.ant-drawer-content-wrapper')!==null`, '令牌抽屉', 25000);
  await sleep(2500);
  const token = await cdp.ev(`(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const d = [...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis).pop();
    const rows = [...d.querySelectorAll('.ant-table-tbody tr.ant-table-row')];
    const t = d.querySelector('.ant-table-body') || d.querySelector('.ant-table-content');
    const masks = rows.map(r => {
      const m = r.querySelector('[data-testid^="pm-token-mask-"]');
      if (m === null) return null;
      const cs = getComputedStyle(m);
      const td = m.closest('td');
      return {
        text: (m.innerText || '').trim(),
        cellH: +td.getBoundingClientRect().height.toFixed(1),
        // 单行判据：文本节点高度不超过一行行高（nowrap 时 scrollHeight≈clientHeight）
        elH: +m.getBoundingClientRect().height.toFixed(1),
        whiteSpace: cs.whiteSpace,
        tdScrollW: td.scrollWidth, tdClientW: td.clientWidth,
        colW: +td.getBoundingClientRect().width.toFixed(1),
      };
    }).filter(Boolean);
    const ths = [...d.querySelectorAll('.ant-table-thead th')].map(x => ({ t: (x.innerText || '').trim(), w: +x.getBoundingClientRect().width.toFixed(1) }));
    return {
      masks, cols: ths,
      allColsPositive: ths.every(x => x.w > 0),
      firstCol: ths[0],
      scrollW: t.scrollWidth, clientW: t.clientWidth, canScroll: t.scrollWidth > t.clientWidth,
      drawerW: +d.getBoundingClientRect().width.toFixed(1),
    };
  })()`);
  // 移动端：滚到最右，验末列按钮可达
  if (isMobile) {
    token.atRight = await cdp.ev(`(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1; };
      const d = [...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis).pop();
      const t = d.querySelector('.ant-table-body') || d.querySelector('.ant-table-content');
      t.scrollLeft = 0; const before = t.scrollLeft; t.scrollLeft = 99999; const after = t.scrollLeft;
      const btn = d.querySelector('.ant-table-tbody tr.ant-table-row td:last-child button');
      const br = btn === null ? null : btn.getBoundingClientRect();
      return { scrollLeftBefore: before, scrollLeftAfter: after, canScroll: after > before,
               btnRight: br === null ? null : +br.right.toFixed(1), viewportW: window.innerWidth,
               btnWithinViewport: br === null ? null : br.right <= window.innerWidth + 2 };
    })()`);
    await sleep(400);
  }
  check('token', token);
  await cdp.shot('tokens');
  if (isMobile) {
    await cdp.ev(`(()=>{const vis=e=>e.getBoundingClientRect().width>1;const d=[...document.querySelectorAll('.ant-drawer-content-wrapper')].filter(vis).pop();const t=d.querySelector('.ant-table-body')||d.querySelector('.ant-table-content');t.scrollLeft=0;return true})()`);
    await sleep(400); await cdp.shot('tokens-atleft');
  }
  await closeOverlay();

  // ================= ⑤ 移动端表格「文件夹」列 =================
  await setView('表格');
  await cdp.waitFor(`document.querySelector('.ant-table-thead th')!==null`, '表格');
  await sleep(900);
  const folderCol = await cdp.ev(`(() => {
    const ths = [...document.querySelectorAll('.ant-table-thead th')];
    const th = ths.find(t => (t.innerText || '').trim() === '文件夹');
    if (th === undefined) return { err: 'no folder col' };
    const idx = ths.indexOf(th);
    const row = document.querySelector('.ant-table-tbody tr.ant-table-row');
    const td = row === null ? null : row.children[idx];
    if (td === null) return { err: 'no cell' };
    const r = td.getBoundingClientRect();
    const cs = getComputedStyle(td);
    const lines = td.innerText.trim() === '' ? 0 : (td.innerText.trim().split(/\\n/).filter(Boolean).length);
    return {
      colWidth: +r.width.toFixed(1),
      text: td.innerText.trim().replace(/\\n/g, '⏎'),
      lineCount: lines,
      cellH: +r.height.toFixed(1),
      whiteSpace: cs.whiteSpace,
      scrollH: td.scrollHeight, clientH: td.clientHeight,
      wraps: lines > 1,
    };
  })()`);
  check('folder-col', folderCol);
  await cdp.shot('table');
  // 移动端表格整体横滚 + 末列可达
  if (isMobile) {
    const t = await cdp.ev(`(() => {
      const el = document.querySelector('.ant-table-content') || document.querySelector('.ant-table-body');
      el.scrollLeft = 0; const before = el.scrollLeft; el.scrollLeft = 99999; const after = el.scrollLeft;
      const row = document.querySelector('.ant-table-tbody tr.ant-table-row');
      const btn = row === null ? null : row.querySelector('td:last-child button');
      const br = btn === null ? null : btn.getBoundingClientRect();
      el.scrollLeft = 0;
      return { canScroll: after > before, scrollW: el.scrollWidth, clientW: el.clientWidth,
               btnRight: br === null ? null : +br.right.toFixed(1), viewportW: window.innerWidth };
    })()`);
    check('table-scroll', t);
    await sleep(400);
    await cdp.shot('table-atleft');
  }

  console.log('DONE');
} catch (err) {
  console.log(`FATAL|${String(err && err.message ? err.message : err)}`);
  process.exitCode = 1;
} finally {
  try { if (cdp !== null) await cdp.send('Browser.close'); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
  console.log(`CLOSED|${form}`);
}
