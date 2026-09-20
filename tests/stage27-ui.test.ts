// 阶段 27 / FR-77 ~ FR-81（BRIEF v34 §4 + §8 AC-78 ~ AC-82）的**前端源码级**断言。
// 运行时段（真鼠标 + 落库读数 + 请求计数 + 真实像素）见 tools/ac-stage27.sh 与 tools/ac-stage27-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const useView = src('components/UseView.tsx');
const detail = src('components/PromptDetail.tsx');
const split = src('components/SplitView.tsx');
const vars = src('components/VarsDialog.tsx');
const api = src('api.ts');
const workspace = src('components/Workspace.tsx');

test('AC-78 ①：表格有 rowSelection（首列复选框 + 表头全选由 antd Table 提供）', () => {
  assert.ok(/rowSelection=\{/.test(useView), '表格必须有 rowSelection');
  assert.ok(/selectedRowKeys/.test(useView), '选中集合由 selectedRowKeys 持有');
  assert.ok(/onChange: \(keys\)/.test(useView), 'onChange 接选中变化');
});

test('AC-78 ②③：批量工具条 = 已选择 N 项 + 批量收藏/移动/删除 + 取消（无选中不占位）', () => {
  for (const id of ['pm-bulk-toolbar', 'pm-bulk-count', 'pm-bulk-favorite', 'pm-bulk-move', 'pm-bulk-delete', 'pm-bulk-cancel']) {
    assert.ok(useView.includes(`data-testid="${id}"`), `缺少 ${id}`);
  }
  for (const label of ['已选择', '项', '批量收藏', '批量移动', '批量删除', '取消']) {
    assert.ok(useView.includes(label), `工具条缺少文案「${label}」`);
  }
  // 无选中时不渲染工具条
  assert.ok(/selectedKeys\.length > 0/.test(useView), '工具条必须仅在选中非空时渲染');
});

test('AC-78 ⑤⑥：批量移动走「目标文件夹（含未归类）」选择；批量删除二次确认含条数与「不可恢复」', () => {
  assert.ok(useView.includes('pm-bulk-move-modal'), '批量移动必须有目标文件夹选择弹窗');
  assert.ok(useView.includes('未归类'), '目标文件夹选项必须含「未归类」');
  assert.ok(useView.includes('不可恢复'), '批量删除二次确认必须写明不可恢复');
  assert.ok(/将删除/.test(useView) && /条 prompt/.test(useView), '二次确认必须写明将删除的条数');
});

test('AC-78 ⑥：前端走**一个**批量接口（POST /api/prompts/bulk），不是循环单条接口', () => {
  assert.ok(/bulkPrompts/.test(api), 'api.ts 必须有 bulkPrompts');
  assert.ok(/'POST',\s*'\/api\/prompts\/bulk'/.test(api), '必须 POST /api/prompts/bulk');
  assert.ok(/bulkPrompts/.test(workspace), 'Workspace 必须调用 bulkPrompts');
  // 不得在批量路径里循环调用单条 delete/update
  const bulkBlock = useView.slice(useView.indexOf('pm-bulk-toolbar'), useView.indexOf('pm-bulk-toolbar') + 4000);
  assert.equal(/api\.deletePrompt|api\.updatePrompt/.test(bulkBlock), false, '批量工具条不得直接循环单条接口');
});

test('AC-79 ①②③④：详情面元信息行 = 文件夹下拉（可改）+ 标签胶囊（✕ 可删）+ 添加标签入口', () => {
  assert.ok(detail.includes('data-testid="pm-detail-meta"'), '必须有元信息行 pm-detail-meta');
  assert.ok(detail.includes('data-testid="pm-detail-tag"'), '每个标签胶囊要有 testid');
  assert.ok(detail.includes('data-testid="pm-detail-tag-remove"'), '标签胶囊要有 ✕ 删除入口');
  assert.ok(detail.includes('data-testid="pm-detail-tag-add"'), '要有添加标签入口');
  assert.ok(/TreeSelect|Select/.test(detail), '文件夹必须是组件库的下拉/TreeSelect');
  assert.ok(detail.includes("'未归类'"), '文件夹下拉必须含「未归类」');
  // 位置：备注行之下、字段页签之上
  const notesAt = detail.indexOf('data-testid="pm-detail-notes"');
  const metaAt = detail.indexOf('data-testid="pm-detail-meta"');
  const fieldsAt = detail.indexOf('data-testid="pm-detail-fields"');
  assert.ok(notesAt > 0 && metaAt > notesAt && fieldsAt > metaAt, '顺序必须是 备注行 → 元信息行 → 字段页签');
});

test('AC-79 ⑤：详情页改的是同一条 prompt 的 folder_id / tags（走 PUT，与编辑器同源）', () => {
  assert.ok(/onMetaChange/.test(detail), '详情面必须把元信息变更交回外层');
  assert.ok(/updatePrompt/.test(workspace), '外层用既有 PUT /api/prompts/:id 落库');
  // 分栏右栏与详情弹层都把 folders / tags / onMetaChange 传下去
  assert.ok(/folders=\{folders\}/.test(split), 'SplitView 必须把 folders 传给详情面');
  assert.ok(/onMetaChange=/.test(split), 'SplitView 必须把 onMetaChange 传给详情面');
});

test('AC-80：详情面字段页签恰好 2 个（用户提示词 / 系统提示词），没有「备注」页签', () => {
  const optionsBlock = detail.slice(detail.indexOf('options={['), detail.indexOf(']}\n', detail.indexOf('options={[')));
  assert.ok(optionsBlock.includes("label: '用户提示词'"), '保留用户提示词');
  assert.ok(optionsBlock.includes("label: '系统提示词'"), '保留系统提示词');
  assert.equal(optionsBlock.includes("label: '备注'"), false, 'FR-79：详情面不得再有「备注」页签');
  assert.equal(detail.includes("field === 'notes'"), false, 'FR-79：正文区不再有 notes 字段分支');
  // 编辑器备注输入框仍在（另一个文件）
  assert.ok(/name="notes"/.test(src('components/PromptEditor.tsx')), '编辑器备注输入框必须保留');
});

test('AC-81：详情面不再渲染「变量填值」区块（编辑器与 VarsDialog 保留）', () => {
  assert.equal(detail.includes('变量填值'), false, '详情面不得再有「变量填值」');
  assert.equal(detail.includes('LazyVariablePanel'), false, '详情面不得再引用变量面板');
  assert.ok(/LazyMarkdownPreview/.test(detail) && /LazyVersionPanel/.test(detail), '「预览」「版本历史」必须保留');
  // 编辑器与复制弹窗保留
  assert.ok(/LazyVariablePanel/.test(src('components/PromptEditor.tsx')), '编辑器变量面板必须保留');
  assert.ok(/VarsDialog/.test(src('lazy.ts')), 'VarsDialog 必须保留');
  assert.ok(/LazyVarsDialog/.test(workspace), 'Workspace 仍渲染 VarsDialog');
});

test('AC-82：VarsDialog 宽、高都比原 640 大 ≥15%（宽 ≥ 736；有显式最小高度）', () => {
  const widthMatch = /width=\{(\d+)\}/.exec(vars);
  assert.ok(widthMatch !== null, 'VarsDialog 必须有显式 width');
  const width = Number(widthMatch[1]);
  assert.ok(width >= 736, `宽度必须 ≥736（640×1.15），实际 ${String(width)}`);
  // 高度：弹窗 body 有显式 minHeight（否则内容驱动的高度无法保证 +15%）
  const heightMatch = /minHeight:\s*(\d+)/.exec(vars);
  assert.ok(heightMatch !== null, 'VarsDialog 必须给 body 显式 minHeight');
  assert.ok(Number(heightMatch[1]) >= 340, `body minHeight 必须 ≥340，实际 ${heightMatch[1]}`);
  // 字段 / 按钮 / 语义不动
  for (const token of ['pm-vars-preview', 'pm-vars-confirm', 'pm-var-input-', '复制结果', '取消']) {
    assert.ok(vars.includes(token), `VarsDialog 不得改字段/按钮：缺 ${token}`);
  }
});
