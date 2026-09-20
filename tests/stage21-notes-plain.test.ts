// 阶段 21 / FR-68（BRIEF v28 §4 + §8 AC-68）：**备注 = 纯文本**。
// 编辑器 Markdown 预览去掉「备注」字段；详情面「备注」页签按原样纯文本显示（不解析 Markdown、不请求 /api/render/markdown）。
// 运行时段（真鼠标 + CDP 网络层计数 + DOM 元素计数）见 tools/ac-stage21.sh 与 tools/ac-stage21-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const editor = src('components/PromptEditor.tsx');
const detail = src('components/PromptDetail.tsx');

test('AC-68 ①：编辑器页 Markdown 预览的字段只剩 用户提示词 / 系统提示词（去掉备注）', () => {
  const fieldsBlock = editor.slice(editor.indexOf('fields={['), editor.indexOf(']}\n', editor.indexOf('fields={[')));
  assert.ok(fieldsBlock.includes("key: 'user_prompt'"), '保留用户提示词');
  assert.ok(fieldsBlock.includes("key: 'system_prompt'"), '保留系统提示词');
  assert.equal(fieldsBlock.includes("key: 'notes'"), false, '备注必须从 Markdown 预览字段里去掉');
  assert.equal(fieldsBlock.includes('label: \'备注\''), false, '备注的预览选项不得再出现');
  // 备注输入框仍是普通多行文本（没有被渲染组件接管）
  assert.ok(/name="notes"[\s\S]{0,200}<Input\.TextArea/.test(editor), '备注仍是普通 Input.TextArea');
});

test('AC-68 ②（v34 修订：由 FR-79 取代）：详情面不再有「备注」页签，备注改由标题下的 pm-detail-notes 纯文本承担', () => {
  // FR-79：字段页签只剩 用户提示词 / 系统提示词 ⇒ 正文区不再有 `field === 'notes'` 分支
  assert.equal(/field === 'notes'/.test(detail), false, 'FR-79：正文区不得再有 notes 字段分支（备注页签已移除）');
  const optionsBlock = detail.slice(detail.indexOf('options={['), detail.indexOf(']}\n', detail.indexOf('options={[')));
  assert.equal(optionsBlock.includes("label: '备注'"), false, 'FR-79：不得再有「备注」页签');
  // 备注仍以**纯文本**呈现（标题下的 pm-detail-notes，FR-69）——不经 Markdown 渲染、不注入 HTML
  assert.ok(detail.includes('data-testid="pm-detail-notes"'), '备注行仍在（标题下）');
  const notesBlock = detail.slice(detail.indexOf('data-testid="pm-detail-notes"'), detail.indexOf('data-testid="pm-detail-meta"'));
  assert.equal(notesBlock.includes('dangerouslySetInnerHTML'), false, '备注行不得注入 HTML');
  assert.equal(notesBlock.includes('MarkdownPreview'), false, '备注行不得走 Markdown 渲染');
  // 纯文本分支容器仍在（源码 / 显示纯文本模式用）
  assert.ok(detail.includes('data-testid="pm-detail-text"'), '纯文本容器仍在');
  assert.ok(/whiteSpace: 'pre-wrap'/.test(detail), '纯文本要按原样换行显示');
  // MarkdownPreview 仍服务于用户 / 系统提示词
  const markdownCall = detail.indexOf('<LazyMarkdownPreview');
  assert.ok(markdownCall > 0, '用户/系统提示词仍要 Markdown 预览');
  const ternaryAt = detail.search(/sourceMode \|\| plain \? \(/);
  assert.ok(ternaryAt > 0, '正文区必须是 sourceMode/plain 的纯文本分支');
  const between = detail.slice(ternaryAt, markdownCall);
  assert.ok(between.includes(') : ('), 'MarkdownPreview 必须在该三元表达式的 else 分支里');
});

test('AC-68 ③④：不外溢（列表摘要 / 变量 / 导出 / diff 都不受备注去向影响）', () => {
  // 卡片摘要仍取 user_prompt，不掺备注；分栏中栏自 FR-71 起已不再显示正文摘要（本断言随之收窄）
  assert.ok(/promptExcerpt\(prompt\.user_prompt/.test(src('components/UseView.tsx')), '卡片摘要仍基于 user_prompt');
  assert.equal(src('components/SplitView.tsx').includes('promptExcerpt'), false, 'FR-71：分栏中栏不得再出现正文摘要');
  // 变量面板只处理用户/系统提示词
  const variable = src('components/VariablePanel.tsx');
  assert.equal(variable.includes('notes'), false, '变量填值不得掺入备注');
  // 版本 diff 的快照文本仍包含 [notes]（FR-64 的文本对比不受影响）
  const versions = readFileSync(path.join(ROOT, 'src', 'services', 'versions.ts'), 'utf8');
  assert.ok(versions.includes("section('notes'"), 'snapshotText 仍包含 notes 段（FR-64 修复不受影响）');
  // 导入导出格式未改（app 契约值不变）
  const exportService = readFileSync(path.join(ROOT, 'src', 'services', 'export.ts'), 'utf8');
  assert.ok(exportService.includes("EXPORT_APP = 'promptmanager'"), '导出契约值不变');
});
