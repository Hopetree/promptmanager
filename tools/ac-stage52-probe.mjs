/**
 * 阶段 52 / AC-117 探针（真浏览器 + 真鼠标）：量**卡片视图底部那一行**的文本、顺序、图标与项间距。
 *
 * 用法：node tools/ac-stage52-probe.mjs <baseUrl> <sid>
 *
 * 输出（stdout，供 ac-stage52.sh 断言）：
 *   FOOTER_TEXT:<id>|<该行完整 innerText（换行折成 ⏎）>
 *   SEGMENTS:<id>|<JSON 数组：每个"项"的 {text,x,hasIcon,isSep}>   —— 项 = 非分隔符元素
 *   GAPS:<id>|<JSON 数组：相邻项 x 坐标差>
 *   TABLE_COLS:<列标题逗号串>
 *   TABLE_META:<表格视图里第一条的关键文本>
 *   SPLIT_META:<分栏中栏第一条的关键文本>
 *   CARD_GEOM:<id>|{cardH, cardBottom, footerBottom, star, copy, handle}
 *
 * ⚠️ 判据取"语义"而非总数：本探针只读 DOM，不发业务写请求。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [baseUrl, sid] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

class Cdp {
  constructor(s) {
    this.socket = s; this.nextId = 1; this.pending = new Map();
    s.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (typeof m.id === 'number' && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error !== undefined ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval');
    return r.result?.value;
  }
  async waitFor(x, l, t = 20000) {
    const d = Date.now() + t;
    for (;;) { if (await this.ev(x) === true) return; if (Date.now() > d) throw new Error('超时 ' + l); await sleep(120); }
  }
  async center(x) {
    const v = await this.ev(`(()=>{const el=(${x});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`);
    if (v === null) throw new Error('找不到 ' + x);
    return JSON.parse(v);
  }
  /** 真鼠标三连（AC 规范：绝不用 JS .click()） */
  async click(x, s = 600) {
    const { x: cx, y: cy } = await this.center(x);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 }); await sleep(120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 }); await sleep(s);
  }
}

/**
 * 页内取数脚本：把卡片底部那一行拆成"项"与"分隔符"。
 * 判据：
 *   - 项（item）= flex 子元素里 innerText 非空、且不是纯「·」的元素；
 *   - 分隔符（sep）= innerText trim 后 === '·' 的元素（无论它是独立 span 还是带伪元素）；
 *   - x = getBoundingClientRect().left；
 *   - hasIcon = 元素内含 svg/.anticon；
 *   - gaps = 相邻**项**之间的 (下一个项的 left) - (本项的 right)。
 *     —— 用 right→left 的"视觉空隙"，加了分隔符后这才是真正的"项间距"观感值。
 */
const EXTRACT = (id) => `(() => {
  const footer = document.querySelector('[data-testid="pm-card-footer-${id}"]');
  if (!footer) return JSON.stringify({error:'no footer'});
  const meta = footer.firstElementChild ? footer.firstElementChild : footer;
  const kids = [...meta.children];
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const segs = kids.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: txt(el),
      x: Math.round(r.left * 100) / 100,
      right: Math.round(r.right * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      hasIcon: el.querySelector('svg, .anticon') !== null,
      isSep: txt(el) === '·',
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      tag: el.tagName.toLowerCase(),
    };
  });
  const items = segs.filter((s) => !s.isSep && s.text !== '');
  const gaps = [];
  for (let i = 1; i < items.length; i++) {
    gaps.push(Math.round((items[i].x - items[i - 1].right) * 100) / 100);
  }
  // 相邻**元素**（含分隔符）之间的 x 差 —— 用于证明分隔符确实夹在两项之间
  const all = segs.filter((s) => s.text !== '');
  const elemGaps = [];
  for (let i = 1; i < all.length; i++) {
    elemGaps.push({ from: all[i - 1].text, to: all[i].text, dx: Math.round((all[i].x - all[i - 1].x) * 100) / 100 });
  }
  /**
   * 项间距的直接判据 = computed 的 gap 属性（这才是 FR-116 ⑥ 说的"项间距 6px"）。
   * 另一条口径（sepSpan）：加分隔符后"前一元素右边缘 → 后一元素左边缘"的视觉空隙
   *   = gap + 分隔符宽 + 2×gap（分隔符两侧各有一个 gap），
   *   报告它便于人工核对观感，但判据用 gap 本身。
   */
  const cs = getComputedStyle(meta);
  const sepEls = segs.filter((s) => s.isSep);
  const sepSpanExamples = [];
  for (let i = 1; i < all.length; i++) {
    if (all[i - 1].isSep || all[i].isSep) continue;
    const a = all[i - 1], b = all[i];
    const between = all.slice(i, all.indexOf(b)).filter(() => false);
    void between;
    sepSpanExamples.push({ from: a.text, to: b.text, span: Math.round((b.x - a.right) * 100) / 100 });
  }
  const fullText = (footer.innerText || '').replace(/\\n/g, ' ⏎ ');
  return JSON.stringify({
    segs, items, gaps, elemGaps, fullText,
    computedGap: cs.gap, columnGap: cs.columnGap, rowGap: cs.rowGap,
    sepCount: sepEls.length,
    sepWidths: sepEls.map((s) => s.w),
    sepColor: sepEls.length > 0 ? getComputedStyle(kids.find((el) => txt(el) === '·')).color : null,
    sepUserSelect: sepEls.length > 0 ? getComputedStyle(kids.find((el) => txt(el) === '·')).userSelect : null,
    metaColor: cs.color,
    sepSpanExamples,
  });
})()`;

const dir = mkdtempSync(path.join(tmpdir(), 'pm-ac52-'));
const child = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--force-color-profile=srgb', '--window-size=1600,900', '--user-data-dir=' + dir, '--remote-debugging-port=0', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });
try {
  let port = null;
  for (let i = 0; i < 100 && port === null; i++) {
    try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Network.setCookie', { name: 'pm_sid', value: sid, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await cdp.waitFor(`document.querySelector('[data-testid="pm-use-viewmode"]')!==null`, '使用视图');
  await sleep(800);

  /** 切到卡片视图（真鼠标点 Segmented 的「卡片」） */
  await cdp.click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>el.innerText.trim()==='卡片')`, 1200);
  await cdp.waitFor(`document.querySelector('[data-testid^="pm-card-footer-"]')!==null`, '卡片视图');

  const ids = await cdp.ev(`JSON.stringify([...document.querySelectorAll('[data-testid^="pm-card-footer-"]')].map(el=>el.getAttribute('data-testid').replace('pm-card-footer-','')))`);
  const idList = JSON.parse(ids);
  console.log('CARD_IDS:' + JSON.stringify(idList));

  for (const id of idList) {
    const raw = await cdp.ev(EXTRACT(id));
    const o = JSON.parse(raw);
    console.log(`FOOTER_TEXT:${id}|${o.fullText}`);
    console.log(`ITEMS:${id}|${JSON.stringify(o.items)}`);
    console.log(`SEGS:${id}|${JSON.stringify(o.segs)}`);
    console.log(`GAPS:${id}|${JSON.stringify(o.gaps)}`);
    console.log(`ELEMGAPS:${id}|${JSON.stringify(o.elemGaps)}`);
    console.log(`SPACING:${id}|${JSON.stringify({ computedGap: o.computedGap, columnGap: o.columnGap, rowGap: o.rowGap, sepCount: o.sepCount, sepWidths: o.sepWidths, sepColor: o.sepColor, sepUserSelect: o.sepUserSelect, metaColor: o.metaColor, sepSpanExamples: o.sepSpanExamples })}`);
    // 卡片几何：高度、末行贴底、星标/复制/手柄存在
    const geo = await cdp.ev(`(() => {
      const footer = document.querySelector('[data-testid="pm-card-footer-${id}"]');
      const card = footer.closest('[data-testid="pm-use-card"]');
      const cr = card.getBoundingClientRect(); const fr = footer.getBoundingClientRect();
      const body = card.querySelector('.ant-card-body');
      const br = body.getBoundingClientRect();
      const cs = getComputedStyle(body);
      return JSON.stringify({
        cardH: Math.round(cr.height), cardBottom: Math.round(cr.bottom), footerBottom: Math.round(fr.bottom),
        bottomGap: Math.round(cr.bottom - fr.bottom), padBottom: cs.paddingBottom,
        star: card.querySelector('[data-testid="pm-fav-card-${id}"]') !== null,
        copy: card.querySelector('[data-testid="pm-copy-${id}"]') !== null,
        handle: card.querySelector('[data-testid^="pm-drag-card"], [data-testid^="pm-drag-"]') !== null,
      });
    })()`);
    console.log(`CARD_GEOM:${id}|${geo}`);
  }

  /** 表格视图：列名 + 第一条的关键文本（证明未动） */
  await cdp.click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>el.innerText.trim()==='表格')`, 1200);
  await cdp.waitFor(`document.querySelector('.ant-table-thead th')!==null`, '表格');
  const cols = await cdp.ev(`JSON.stringify([...document.querySelectorAll('.ant-table-thead th')].map(el=>el.innerText.trim()))`);
  console.log('TABLE_COLS:' + cols);
  const tmeta = await cdp.ev(`(() => { const tr = document.querySelector('.ant-table-tbody tr.ant-table-row'); return tr === null ? '' : (tr.innerText||'').replace(/\\n/g,' | '); })()`);
  console.log('TABLE_META:' + tmeta);

  /** 表格里那行元信息对应的元素间距（证明"只改了卡片视图这一处"） */
  const tableGap = await cdp.ev(`(() => {
    const tr = document.querySelector('.ant-table-tbody tr.ant-table-row');
    if (tr === null) return 'none';
    const tds = [...tr.querySelectorAll('td')].map(td=>({t:(td.innerText||'').trim(), x:Math.round(td.getBoundingClientRect().left*100)/100}));
    return JSON.stringify(tds);
  })()`);
  console.log('TABLE_CELLS:' + tableGap);

  /** 分栏视图：中栏第一条的关键文本（证明未动） */
  await cdp.click(`[...document.querySelectorAll('[data-testid="pm-use-viewmode"] .ant-segmented-item')].find(el=>el.innerText.trim()==='分栏')`, 1200);
  await cdp.waitFor(`document.querySelector('[data-testid="pm-split-item"]')!==null`, '分栏');
  const smeta = await cdp.ev(`(() => { const el = document.querySelector('[data-testid="pm-split-item"]'); return el === null ? '' : (el.innerText||'').replace(/\\n/g,' | '); })()`);
  console.log('SPLIT_META:' + smeta);
} finally {
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
}
