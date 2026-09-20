// 阶段 19 / FR-63（BRIEF v25 §4 + §8 AC-63，**取代 AC-62 的形态要求**）：
// 编辑器全屏 = 「应用内全屏」：**不调 Fullscreen API**；只隐藏编辑器内部左栏 `editor-list`；
// 编辑栏 : 右栏 = 1 : 1；按钮与详情面 `pm-detail-fullscreen` 同款。
// 运行时段（真鼠标 + 真实像素）见 `tools/ac-stage19.sh` / `tools/ac-stage19-probe.mjs`。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const editor = src('components/PromptEditor.tsx');
const workspace = src('components/Workspace.tsx');
const detail = src('components/PromptDetail.tsx');
const css = src('styles/app.css');

test('AC-63 ①：不得再调用浏览器 Fullscreen API（document.fullscreenElement 必须恒为 null）', () => {
  for (const [name, text] of [
    ['PromptEditor.tsx', editor],
    ['Workspace.tsx', workspace],
  ] as const) {
    for (const banned of ['requestFullscreen', 'exitFullscreen', 'fullscreenchange', 'fullscreenEnabled', 'fullscreenElement']) {
      assert.equal(text.includes(banned), false, `${name} 不得再出现 ${banned}（FR-63 撤销浏览器全屏）`);
    }
  }
  // 也不得再隐藏外壳（顶栏 / 侧栏 / 分栏列表）——那是被撤销的 FR-62 形态
  assert.equal(workspace.includes('pm-shell-hidden'), false, 'Workspace 不得再用 pm-shell-hidden');
  assert.equal(css.includes('pm-shell-hidden'), false, 'app.css 不得再留隐藏外壳的规则');
});

test('AC-63 ②：全屏只隐藏编辑器内部左栏（data-testid="editor-list"）', () => {
  assert.ok(editor.includes('data-testid="editor-list"'), '编辑器内部左栏必须有 data-testid="editor-list"');
  const listRule = /\[data-testid='editor-list'\]\s*\{[^}]*display:\s*none/s;
  assert.ok(listRule.test(css), "app.css 必须让全屏下的 [data-testid='editor-list'] display:none（⇒ offsetParent === null）");
  assert.ok(/\.pm-editor-fullscreen/.test(css), '仍然要有 .pm-editor-fullscreen 这个全屏态类');
});

test('AC-63 ②：全屏下 编辑栏 : 右栏 = 1 : 1（两列等宽的网格模板）', () => {
  const fullscreenBlock = css.slice(css.indexOf('.pm-editor-fullscreen'));
  assert.match(
    fullscreenBlock,
    /\.pm-editor-fullscreen\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s,
    '全屏态必须把网格改成两列等宽（minmax(0,1fr) minmax(0,1fr)）',
  );
  // 只靠 CSS 还不够：两栏要有稳定的测量锚点（AC-63 要贴真实像素）
  assert.ok(editor.includes('data-testid="editor-main"'), '编辑栏需要 data-testid="editor-main" 供测量');
  assert.ok(editor.includes('data-testid="editor-side"'), '右栏需要 data-testid="editor-side" 供测量');
  // 左栏在全屏态不得再带 .pm-editor-col（否则"可见列"查询会把它算进去，宽度为 0 破坏比值）
  assert.ok(/data-testid="editor-list"[\s\S]{0,400}?className=\{[^}]*fullscreen/.test(editor), '左栏的 pm-editor-col 应只在非全屏时挂');
});

test('AC-63 ③：按钮与详情面 pm-detail-fullscreen 同款（ExpandOutlined / CompressOutlined + 文案）', () => {
  assert.ok(detail.includes('ExpandOutlined') && detail.includes('CompressOutlined'), '详情面按钮的图标形态（基线）');
  assert.ok(detail.includes('全屏展开') && detail.includes('退出全屏'), '详情面按钮的文案（基线）');
  assert.ok(editor.includes('ExpandOutlined'), '编辑页未全屏时用 ExpandOutlined');
  assert.ok(editor.includes('CompressOutlined'), '编辑页全屏时用 CompressOutlined');
  assert.ok(editor.includes('全屏展开') && editor.includes('退出全屏'), '编辑页按钮要有「全屏展开」/「退出全屏」文案');
  assert.ok(editor.includes('data-testid="editor-fullscreen"'), 'testid 仍为 editor-fullscreen');
  assert.ok(/data-testid="editor-fullscreen"[\s\S]{0,300}?size="small"/.test(editor) || /size="small"[\s\S]{0,300}?data-testid="editor-fullscreen"/.test(editor), '按钮尺寸与详情面一致（size="small"）');
  assert.ok(/data-testid="editor-fullscreen"[\s\S]{0,300}?type="text"/.test(editor) || /type="text"[\s\S]{0,300}?data-testid="editor-fullscreen"/.test(editor), '按钮类型与详情面一致（type="text"）');
});

test('AC-63 ④：Esc 只退全屏（不返回、不丢内容）；退出后左栏与宽度回原布局', () => {
  const escBlock = workspace.slice(workspace.indexOf("event.key === 'Escape'"), workspace.indexOf("event.key === 'Escape'") + 700);
  assert.ok(/editorFullscreen/.test(escBlock), 'Workspace 的 Esc 分支必须先处理"退出全屏"');
  assert.ok(
    escBlock.indexOf('editorFullscreen') < escBlock.indexOf('closeEditor'),
    'Esc 处理顺序：先退全屏，再考虑关闭编辑器',
  );
  // 非全屏网格仍是三列（左 300 / 中 1fr / 右 380），退出后自然复原
  assert.match(
    css,
    /\.pm-editor-grid\s*\{[^}]*grid-template-columns:\s*300px\s+minmax\(0,\s*1fr\)\s+380px/s,
    '常态网格必须保持三列（退出全屏后宽度复原）',
  );
});

test('AC-63 ⑤⑥：切换态可用；详情面 pm-detail-fullscreen 互不顶替', () => {
  assert.ok(/onToggleFullscreen/.test(editor), '按钮必须是切换态（同一按钮进出）');
  assert.ok(detail.includes('data-testid="pm-detail-fullscreen"'), '详情面全屏按钮必须保留');
  assert.ok(detail.includes('pm-detail-fullscreen'), '详情面全屏样式类必须保留');
});

test('FR-62 未被撤销的部分仍然成立（大内容体验 / 独立滚动 / 工具栏常驻 / 右栏顺序 / 窄屏单栏）', () => {
  assert.ok(/pm-editor-fullscreen[\s\S]{0,600}height:\s*7[0-9]vh/.test(css), '全屏下正文编辑区高度仍要 ≥70vh');
  assert.ok(css.includes('pm-editor-scroll'), '中栏仍要有独立滚动容器');
  assert.ok(css.includes('pm-editor-toolbar'), '工具栏仍要单独成块（常驻）');
  const markdownAt = editor.indexOf('data-testid="pm-panel-markdown"');
  const variablesAt = editor.indexOf('data-testid="pm-panel-variables"');
  const versionsAt = editor.indexOf('data-testid="pm-panel-versions"');
  assert.ok(markdownAt >= 0 && variablesAt > markdownAt && versionsAt > variablesAt, '右栏顺序必须是 预览 → 变量 → 版本');
  assert.ok(/singleColumn|fsPane/.test(editor), '窄屏全屏仍要有单栏二选一');
  assert.ok(css.includes('pm-editor-fullscreen-single'), '单栏全屏样式仍在');
});
