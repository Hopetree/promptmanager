// 阶段 29 / FR-82 / FR-83（BRIEF v38 §4 + §8 AC-84 / AC-85）的**前端源码级**断言。
// 运行时段（真鼠标 + 真实像素 + 长内容夹具 + chip 样式对比）见 tools/ac-stage29.sh 与 tools/ac-stage29-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const css = src('styles/app.css');
const useView = src('components/UseView.tsx');
const detail = src('components/PromptDetail.tsx');

/** 取出某个 CSS 规则块（从选择器到匹配的 `}`），便于逐条断言。 */
function rule(selector: string): string {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `app.css 里找不到规则：${selector}`);
  const end = css.indexOf('}', at);
  return css.slice(at, end + 1);
}

test('AC-84 ①：表头复选框半选态被显式重绘（主色底 + 白色横杠），且不改变 antd 的 16×16 外框', () => {
  const box = rule('.pm-table-dense .ant-checkbox-indeterminate {');
  assert.ok(/background-color:\s*var\(--pm-primary\)/.test(box), '半选态必须是主色底（而不是 antd 默认的白底）');
  assert.ok(/border-color:\s*var\(--pm-primary\)/.test(box), '半选态边框同主色');
  // 关键：只改视觉，不改尺寸 —— 不得出现 width/height（外框仍由 antd 的 16×16 决定，与行内一致）
  assert.equal(/\bwidth:/.test(box), false, '不得覆盖 width（尺寸一致由 antd 保证，AC-84 ② 量像素）');
  assert.equal(/\bheight:/.test(box), false, '不得覆盖 height');
  const dash = rule('.pm-table-dense .ant-checkbox-indeterminate::after');
  assert.ok(/background-color:\s*#fff/.test(dash), '半选横杠为白色（与已勾选态同一视觉体系）');
  assert.ok(/height:\s*2px/.test(dash) && /width:\s*8px/.test(dash), '横杠尺寸 8×2');
  // 对抗性自审第 2 轮：antd 对半选态单独注入了 hover（亮色下 `colorBgContainer` = 白底），
  // 若不覆盖，悬浮时就是"白底 + 白杠" ⇒ 又看不出半选。必须有一条更高优先级的 hover 规则把底/边钉回主色。
  const hover = rule('.pm-table-dense .ant-checkbox-indeterminate:not(.ant-checkbox-disabled):hover {');
  assert.ok(/background-color:\s*var\(--pm-primary\)/.test(hover), 'hover 态底色必须仍是主色（否则白底白杠）');
  assert.ok(/border-color:\s*var\(--pm-primary\)/.test(hover), 'hover 态边框必须仍是主色');
  assert.ok(
    /\.pm-table-dense\s+\.ant-checkbox-indeterminate/.test(css),
    'hover 规则必须带 .pm-table-dense 前缀（否则与 antd 同优先级、被运行时 CSS-in-JS 盖过）',
  );
});

test('AC-84 ②：表头与行内复选框都走 antd Checkbox（同一尺寸来源），未做任何尺寸覆写', () => {
  // 尺寸一致的根因：两者都是 antd Table rowSelection 的 Checkbox，本阶段没有对任何 checkbox **外框**写 width/height
  // （只对半选横杠 `::after` 写了 8×2 —— 那是图标本身，不是外框）
  const overrides = [...css.matchAll(/\.ant-checkbox[^{]*\{[^}]*\}/g)]
    .map((m) => m[0])
    .filter((block) => !block.includes('::after'));
  assert.ok(overrides.length > 0, '必须存在半选态覆写规则');
  for (const block of overrides) {
    assert.equal(/\bwidth:\s*\d/.test(block), false, `不得给 checkbox 外框覆写宽度：${block.slice(0, 60)}`);
    assert.equal(/\bheight:\s*\d/.test(block), false, `不得给 checkbox 外框覆写高度：${block.slice(0, 60)}`);
  }
  assert.ok(/rowSelection=\{/.test(useView), '表格仍用 antd rowSelection（首列复选框 + 表头全选）');
});

test('AC-84 ③：批量工具条与表头行之间有 ≥6px 间距（CSS 给 8px）', () => {
  assert.ok(useView.includes('className="pm-bulk-toolbar"'), '工具条必须有 pm-bulk-toolbar class');
  const block = rule('.pm-bulk-toolbar {');
  const match = /margin-bottom:\s*(\d+)px/.exec(block);
  assert.ok(match !== null, '.pm-bulk-toolbar 必须显式给 margin-bottom');
  assert.ok(Number(match[1]) >= 6, `margin-bottom 必须 ≥6px，实际 ${match[1]}px`);
});

test('AC-85 ①：元信息行与备注行拉开、且不大于与字段页签行的间距（层级对称）', () => {
  const meta = detail.slice(detail.indexOf('data-testid="pm-detail-meta"'), detail.indexOf('data-testid="pm-detail-fields"'));
  const top = /marginTop:\s*(\d+)/.exec(meta);
  const bottom = /marginBottom:\s*(\d+)/.exec(meta);
  assert.ok(top !== null, '元信息行必须有 marginTop（拉开与备注行的间距）');
  assert.ok(bottom !== null, '元信息行必须有 marginBottom（保证与页签行的间距更大）');
  assert.ok(Number(top[1]) >= 4, `marginTop 必须 ≥4px（父容器 gap 16 ⇒ 合计 ≥20px ≥ AC 的 12px），实际 ${top[1]}`);
  assert.ok(
    Number(bottom[1]) > Number(top[1]),
    `与页签行的间距必须大于与备注行的间距（层级对称）：marginBottom ${bottom[1]} > marginTop ${top[1]}`,
  );
});

test('AC-85 ②：元信息行有换行保护（minWidth:0 + wrap），长内容不把「+ 添加标签」顶出面板', () => {
  const meta = detail.slice(detail.indexOf('data-testid="pm-detail-meta"'), detail.indexOf('data-testid="pm-detail-fields"'));
  assert.ok(/minWidth:\s*0/.test(meta), '元信息行必须 minWidth: 0（否则 flex 子项不收缩、横向溢出）');
  assert.ok(/wrap/.test(meta), '元信息行必须允许换行');
  // 标签块可收缩并换行；添加标签控件不参与收缩（保证它自己不被压扁/挤出）
  assert.ok(/minWidth:\s*0,\s*flex:\s*'1 1 auto'/.test(meta), '标签块必须 minWidth:0 + flex:1 1 auto（可收缩换行）');
  assert.ok(/flex:\s*'0 0 auto'/.test(meta), '「+ 添加标签」必须 flex:0 0 auto');
  assert.ok(/maxWidth:\s*220/.test(meta), '文件夹下拉必须有 maxWidth（长文件夹名不撑宽整行）');
});

test('AC-85 ⑤：详情页标签 chip 与左栏「胶囊云」用同一套视觉', () => {
  assert.ok(
    /className="pm-tag-chip pm-detail-tag"/.test(detail),
    '详情页 Tag 必须复用左栏的 pm-tag-chip 视觉类',
  );
  const block = rule('.pm-detail-meta .ant-tag.pm-tag-chip {');
  for (const token of ['background: var(--pm-surface-2)', 'border: 1px solid transparent', 'border-radius: 13px']) {
    assert.ok(block.includes(token), `详情 chip 必须与左栏一致：缺 ${token}`);
  }
  // 与左栏 chip 基类同值（background / border / border-radius / 高度 / 字号）
  const base = rule('.pm-tag-chip {');
  for (const token of ['height: 26px', 'border-radius: 13px', 'background: var(--pm-surface-2)', 'border: 1px solid transparent', 'font-size: 12px']) {
    assert.ok(base.includes(token) && block.includes(token), `两处必须同值：${token}`);
  }
  // 优先级：静态样式表必须压过 antd 运行时注入的 .ant-tag（同优先级会被盖过 ⇒ 必须带前缀）
  assert.ok(/\.pm-detail-meta\s+\.ant-tag\.pm-tag-chip/.test(css), '选择器必须带 .pm-detail-meta 前缀提高优先级');
  // 对抗性自审第 2 轮：详情 chip 本体**不可点**（只有 ✕ 可点），必须中和左栏那条 `.pm-tag-chip:hover`，
  // 否则悬浮时底色/文字变化与"不可点"的语义矛盾。
  const hover = rule('.pm-detail-meta .ant-tag.pm-tag-chip:hover {');
  assert.ok(/background:\s*var\(--pm-surface-2\)/.test(hover), '详情 chip hover 不得变色（不可点）');
  assert.ok(/color:\s*var\(--pm-ink-subtle\)/.test(hover), '详情 chip hover 文字色不得变');
});

test('AC-85：不改功能语义（元信息行仍在标题+备注之下、字段页签之上；改文件夹/增删标签仍走 onMetaChange）', () => {
  const notesAt = detail.indexOf('data-testid="pm-detail-notes"');
  const metaAt = detail.indexOf('data-testid="pm-detail-meta"');
  const fieldsAt = detail.indexOf('data-testid="pm-detail-fields"');
  assert.ok(notesAt > 0 && metaAt > notesAt && fieldsAt > metaAt, '顺序仍是 备注行 → 元信息行 → 字段页签');
  assert.ok(/onMetaChange\(prompt, \{ folder_id/.test(detail), '改文件夹仍走 onMetaChange');
  assert.ok(/onMetaChange\(prompt, \{ tags: prompt\.tags\.filter/.test(detail), '删标签仍走 onMetaChange');
  assert.ok(/pm-detail-tag-remove/.test(detail), '标签 ✕ 入口仍在');
});
