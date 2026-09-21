// 阶段 22 / FR-71（BRIEF v29 §4 + §8 AC-71）：分栏中栏条目精简为「标题 + 备注（固定两行）」+ 中栏宽度 -8%。
// 运行时段（真实像素 + 文本断言 + 单击切换 + 卡片/表格对照）见 tools/ac-stage22.sh 与 tools/ac-stage22-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const split = src('components/SplitView.tsx');
const useView = src('components/UseView.tsx');
const css = src('styles/app.css');

test('AC-71 ①：中栏条目只渲染 标题 + 备注（不再有正文摘要与一切元信息）', () => {
  // 条目的渲染块：从 pm-split-item 到该条目结束（取到 list 的结尾即可）
  const itemAt = split.indexOf('data-testid="pm-split-item"');
  const itemBlock = split.slice(itemAt, split.indexOf('</SortableList>'));
  assert.ok(itemBlock.includes('prompt.title'), '要有标题');
  assert.ok(itemBlock.includes('pm-split-notes'), '要有备注区');
  assert.ok(itemBlock.includes('prompt.notes'), '备注区渲染的是 notes');
  for (const banned of ['promptExcerpt', 'version_no', 'use_count', 'updated_at', 'folderName', 'extractVariablesLocal']) {
    assert.equal(itemBlock.includes(banned), false, `中栏条目不得再出现 ${banned}`);
  }
  // 收藏星标与拖拽手柄保留（FR-57 / FR-70）
  assert.ok(itemBlock.includes('FavoriteStar'), '收藏星标保留');
  assert.ok(itemBlock.includes('handle'), '拖拽手柄保留');
});

test('AC-71 ②：备注区固定两行（-webkit-line-clamp: 2 + 最小高度 = 2 行，空备注不塌陷）', () => {
  const rule = css.slice(css.indexOf('.pm-split-notes'), css.indexOf('.pm-split-notes') + 500);
  assert.ok(/-webkit-line-clamp:\s*2/.test(rule), '备注区必须两行截断');
  assert.ok(/-webkit-box-orient:\s*vertical/.test(rule), '-webkit-box-orient: vertical 才生效');
  assert.ok(/overflow:\s*hidden/.test(rule), '截断要配 overflow: hidden');
  assert.ok(/min-height:\s*calc\(2 \* 1\.6em\)/.test(rule), '最小高度 = 2 行（空备注不塌陷、所有条目等高）');
  assert.ok(/white-space:\s*pre-wrap/.test(rule), '备注按纯文本显示（保留换行 + 自动折行，与 FR-68 一致）');
});

test('AC-71 ③（v45 按断点修订）：桌面中栏仍是 -8% clamp；移动端改为撑满', () => {
  // 桌面分支必须仍是三档 clamp（原 300/34%/380 ⇒ 实测 366px→337px，比值 0.92）
  assert.ok(
    /flex: isMobile \? '1 1 100%' : '0 0 clamp\(276px, 31\.3%, 350px\)'/.test(split),
    '桌面中栏宽度应为 clamp(276px, 31.3%, 350px)；移动端撑满（FR-90）',
  );
  // 两个分支都必须真的在：不允许"顺手把桌面 clamp 也改掉"或"只留一个分支"
  assert.ok(split.includes("'1 1 100%'"), '移动端必须撑满可用宽度（1 1 100%）');
  assert.ok(split.includes('clamp(276px, 31.3%, 350px)'), '桌面必须保留三档 clamp');
  assert.equal(/clamp\(300px, 34%, 380px\)/.test(split), false, '旧宽度不得残留在 style 里');
});

test('AC-71 ⑥：卡片 / 表格视图不受影响（卡片仍有正文摘要与元信息）', () => {
  assert.ok(/promptExcerpt\(prompt\.user_prompt/.test(useView), '卡片仍显示正文摘要');
  assert.ok(useView.includes('metaLine(prompt)'), '卡片仍有元信息行');
  assert.ok(useView.includes('tableColumns'), '表格视图仍在');
});

test('AC-71 ④：中栏条目仍单击切换右栏（onClick → onSelect）', () => {
  assert.ok(/onClick=\{\(\) => onSelect\(prompt\)\}/.test(split), '单击条目仍切换右栏');
  assert.ok(split.includes('onDoubleClick'), '双击行为保留');
});
