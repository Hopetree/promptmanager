// 阶段 23 前端源码级断言：
//   FR-72 ⑤：inclusive 视图下拖拽只在**同 folder_id** 内生效（卡片 / 分栏 / 表格三处都传 canReorder）
//   FR-73：卡片 body 撑满 + 末行 marginTop:auto 贴底 + 无标签时不渲染标签区
//   FR-74：表格每行手柄（不新增列）+ 复用同一 PATCH 接口 + 乐观更新（不 refresh）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const useView = src('components/UseView.tsx');
const split = src('components/SplitView.tsx');
const sortable = src('components/SortableList.tsx');
const workspace = src('components/Workspace.tsx');

test('AC-72 ⑤（已被 v31 / D-30 作废）：拖拽**不再**做「同 folder_id」限制', () => {
  // ⚠️ 规格变更留痕：v30/D-29 曾要求 inclusive 视图下"仅同目录内生效"，但该限制在默认「全部」视图下
  // 等于全面禁用（用户实测"卡片拖动根本不生效"）且被忽略时静默无反馈 ⇒ v31/FR-75/D-30 明令取消。
  // 故这里反向断言：源码里不得再出现 canReorder / sameFolder 这套判定。
  assert.equal(sortable.includes('canReorder'), false, 'SortableList 不得再有 canReorder（D-30 作废）');
  for (const [name, source] of [['卡片/表格', useView], ['分栏', split]] as Array<[string, string]>) {
    assert.equal(source.includes('canReorder'), false, `${name}视图不得再传 canReorder`);
    assert.equal(source.includes('sameFolder'), false, `${name}视图不得再有 sameFolder 判定`);
  }
});

test('AC-73：卡片 body 撑满 + 末行贴底 + 无标签不渲染标签区', () => {
  const card = useView.slice(useView.indexOf('const renderCard = ('), useView.indexOf('const tableColumns'));
  assert.ok(/display: 'flex'[\s\S]{0,80}flexDirection: 'column'/.test(card), '卡片本体竖向 flex（body 才能撑满）');
  assert.ok(/body: \{ padding: 14, flex: '1 1 auto'/.test(card), 'body 撑满（flex:1）且内边距仍是 14px');
  assert.ok(/marginTop: 'auto'/.test(card), '末行 marginTop:auto ⇒ 恒定贴底');
  assert.ok(/\{prompt\.tags\.length > 0 && \(/.test(card), '无标签时不得渲染标签区（不留空 Flex）');
  assert.ok(card.includes('data-testid={`pm-card-footer-'), '末行有 testid 便于 AC 量像素');
});

test('AC-74 ①：表格行手柄复用 SortableItem（不新增列、不新增依赖）', () => {
  assert.ok(useView.includes('SortableTableRow'), '表格需要自定义行组件');
  assert.ok(/components=\{\{ body: \{ row: SortableTableRow \} \}\}/.test(useView), 'antd Table 走 components.body.row');
  assert.ok(useView.includes('handleTestIdPrefix="pm-drag-row"'), '行手柄 testid 前缀 pm-drag-row');
  assert.ok(useView.includes('RowHandleContext'), '手柄经 context 注入「标题」单元格（不新增列 ⇒ 列宽不变）');
  assert.ok(useView.includes('<RowDragHandle promptId={prompt.id} />'), '标题单元格内渲染手柄');
  assert.ok(useView.includes("title: '标题',"), '列定义未变（没有新增手柄列）');
});

test('AC-74 ②：表格拖拽走同一个 onReorder（同一 PATCH 接口、同一次落库）', () => {
  assert.ok(useView.includes('const handleTableDragEnd'), '表格拖拽结束处理');
  assert.ok(/onReorder\(arrayMove\(ids, from, to\)\)/.test(useView), '表格拖拽复用 onReorder（⇒ Workspace 的 api.reorderPrompts）');
  assert.ok(workspace.includes('api.reorderPrompts(ids)'), '落库仍走同一接口');
});

test('AC-74 ③：乐观更新（本地立即生效 + 失败回滚），不再无脑 refresh', () => {
  const handler = workspace.slice(workspace.indexOf('const reorderPrompts = useCallback'), workspace.indexOf('const reorderFolders = useCallback'));
  assert.ok(/setData\(\{ \.\.\.snapshot, items: reordered \}\)/.test(handler), '本地立即生效新顺序');
  assert.ok(/setData\(snapshot\)/.test(handler), '失败必须回滚');
  assert.equal(/refresh\(\)/.test(handler), false, '不得再调用 refresh()（那会整列表重新请求 + loading 闪烁）');
  assert.ok(/await api\.reorderPrompts\(ids\)/.test(handler), '后端静默提交');
});
