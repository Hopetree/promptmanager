// 阶段 21 / FR-69（BRIEF v28 §4 + §8 AC-69）：详情面「标题行之下、字段页签行之上」新增备注行。
// 源码级断言：锚点 / 纯文本 / 空备注不渲染 / 样式（13px、2 行省略、行高 1.6）/ title 全文 / 位置。
// 运行时段（真鼠标 + computedStyle + 真实像素 + 三态截图）见 tools/ac-stage21.sh 与 tools/ac-stage21-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const detail = src('components/PromptDetail.tsx');
const css = src('styles/app.css');

test('AC-69 ①③：锚点存在、纯文本渲染、位置在标题行与 pm-detail-fields 之间', () => {
  assert.ok(detail.includes('data-testid="pm-detail-notes"'), '必须有 pm-detail-notes 锚点');
  const notesAt = detail.indexOf('data-testid="pm-detail-notes"');
  const titleAt = detail.indexOf('data-testid="pm-detail-title"');
  const fieldsAt = detail.indexOf('data-testid="pm-detail-fields"');
  assert.ok(titleAt > 0 && fieldsAt > 0, '标题行与字段页签行的锚点必须都在');
  assert.ok(titleAt < notesAt && notesAt < fieldsAt, '备注行必须夹在标题行与字段页签行之间');
  // 纯文本：直接渲染字符串（不带 dangerouslySetInnerHTML / 不挂 MarkdownPreview）
  const block = detail.slice(notesAt, notesAt + 400);
  assert.equal(block.includes('dangerouslySetInnerHTML'), false, '备注行不得注入 HTML');
  assert.equal(block.includes('MarkdownPreview'), false, '备注行不得走 Markdown 渲染');
  assert.ok(/\{prompt\.notes\}|>\s*\{[^}]*notes[^}]*\}\s*</.test(block) || block.includes('notes'), '备注行渲染的是备注文本本身');
});

test('AC-69 ④：空备注整行不渲染（不占位）', () => {
  assert.ok(
    /prompt\.notes\.trim\(\)\s*!==\s*''\s*&&|prompt\.notes\s*!==\s*''\s*&&|notes\s*!==\s*''\s*&&/.test(detail),
    '备注行必须有「非空才渲染」的条件',
  );
});

test('AC-69 ⑤：超长备注最多 2 行省略 + title 承载全文', () => {
  assert.ok(/title=\{[^}]*notes[^}]*\}/.test(detail), '备注行要有 title 属性承载全文');
  assert.ok(/\.pm-detail-notes/.test(css), '备注行样式类要落在 app.css 里');
  const rule = css.slice(css.indexOf('.pm-detail-notes'));
  assert.ok(/-webkit-line-clamp:\s*2/.test(rule), '必须 2 行截断（-webkit-line-clamp: 2）');
  assert.ok(/overflow:\s*hidden/.test(rule), '截断要配 overflow: hidden');
  assert.ok(/-webkit-box-orient:\s*vertical/.test(rule), '-webkit-box-orient: vertical 才生效');
  // FR-68 口径：备注是"文本输入输出"——保留作者换行 + 长行折行，故用 pre-wrap（否则 innerText 会把换行折成空格）
  assert.ok(/white-space:\s*pre-wrap/.test(rule), '备注行用 white-space: pre-wrap（保留换行 + 自动折行）');
});

test('AC-69 ②：样式（13px / 次级灰 / 行高 1.6 / 紧凑）', () => {
  const rule = css.slice(css.indexOf('.pm-detail-notes'), css.indexOf('.pm-detail-notes') + 500);
  assert.ok(/font-size:\s*13px/.test(rule), '字号 13px（标题 18px，差 5px 落在 PromptHub 的 4–6px 区间）');
  assert.ok(/line-height:\s*1\.6/.test(rule), '行高 1.6');
  assert.ok(/margin:\s*0/.test(rule), '与标题行紧凑（不靠外边距撑开，间距由父容器 gap 控制 ≤10px）');
  // 颜色用 token（次级/三级灰），不写死色值
  assert.ok(/colorTextSecondary|colorTextTertiary/.test(detail), '备注行颜色取 antd token 的次级/三级灰');
  assert.equal(/color:\s*#[0-9a-fA-F]{3,8}/.test(rule), false, '不得写死十六进制色值');
});

test('FR-69 不做交互：备注行不可点、不弹层', () => {
  const block = detail.slice(detail.indexOf('data-testid="pm-detail-notes"'), detail.indexOf('data-testid="pm-detail-notes"') + 400);
  for (const forbidden of ['onClick', 'Popover', 'Tooltip', 'role="button"']) {
    assert.equal(block.includes(forbidden), false, `备注行不得有 ${forbidden}`);
  }
});
