// 阶段 20 / FR-66（BRIEF v27 §4 + §8 AC-66）：详情页去掉冗余的「当前字段 + 预览」头部。
// MarkdownPreview 在 fields.length === 1（详情面）时隐藏头部；编辑器页（3 字段）保持现状。
// 运行时段（真鼠标 + 真实像素 + 切换预览）见 tools/ac-stage20.sh 与 tools/ac-stage20-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const markdown = src('components/MarkdownPreview.tsx');
const detail = src('components/PromptDetail.tsx');
const editor = src('components/PromptEditor.tsx');

test('AC-66 ①③：MarkdownPreview 只在多字段时渲染头部（单字段 = 详情页不渲染下拉与「预览」标签）', () => {
  assert.ok(/fields\.length\s*>\s*1/.test(markdown), '必须有 fields.length > 1 的判断');
  const guardAt = markdown.search(/fields\.length\s*>\s*1/);
  const before = markdown.slice(0, guardAt);
  assert.equal(before.includes('<Select'), false, '判断之前不得渲染 Select');
  assert.equal(before.includes('<EyeOutlined'), false, '判断之前不得渲染 EyeOutlined 说明标签');
  assert.ok(markdown.indexOf('<Select') > guardAt, '字段下拉必须在判断之后（单字段时不渲染）');
  assert.ok(markdown.indexOf('<EyeOutlined') > guardAt, '「预览」说明标签也必须在判断之后（单字段时一并隐藏）');
});

test('AC-66 ④（v28 修订）：详情页只传 1 个字段；编辑器页的预览字段 = 用户/系统提示词两项', () => {
  assert.ok(/fields=\{\[\{ key: field/.test(detail), '详情页只传当前字段一项');
  assert.equal((detail.match(/fields=\{/g) ?? []).length, 1, '详情页只应有一处 MarkdownPreview 调用');
  // BRIEF v28 / FR-68：备注不做 Markdown 预览 → 编辑器页的字段从 3 项减为 2 项（AC-66 ④ 的"3 选项"随之修订）
  for (const key of ["key: 'user_prompt'", "key: 'system_prompt'"]) {
    assert.ok(editor.includes(key), `编辑器页预览字段要有 ${key}`);
  }
  const fieldsBlock = editor.slice(editor.indexOf('fields={['), editor.indexOf(']}\n', editor.indexOf('fields={[')));
  assert.equal(fieldsBlock.includes("key: 'notes'"), false, 'v28：备注必须从预览字段里去掉');
});

test('AC-66 ②：详情页其余控件不变（页签 / 预览·源码 / 显示纯文本 / 全屏展开）', () => {
  for (const token of ['用户提示词', '系统提示词', '备注', 'sourceMode', 'pm-detail-plain', 'pm-detail-fullscreen']) {
    assert.ok(detail.includes(token), `详情页缺少 ${token}`);
  }
});

