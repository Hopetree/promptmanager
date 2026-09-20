// 阶段 24 / FR-75 / D-30 的前端源码级断言：
//   ① 取消 D-29 的跨目录限制（不再有 canReorder / sameFolder），且不得有静默 return；
//   ③ 卡片/条目/表格行**本体**即拖拽激活点（rootListeners），手柄保留（键盘 + 视觉提示）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const sortable = src('components/SortableList.tsx');
const useView = src('components/UseView.tsx');
const split = src('components/SplitView.tsx');
const folder = src('components/FolderPanel.tsx');

test('FR-75 ①：跨目录限制已取消（D-29 作废），拖拽总是生效', () => {
  assert.equal(sortable.includes('canReorder'), false, 'SortableList 不得再有 canReorder');
  assert.ok(/不再有跨目录限制/.test(sortable), 'SortableList 注释要写明 D-30 的取消');
  assert.equal(useView.includes('sameFolder'), false);
  assert.equal(split.includes('sameFolder'), false);
});

test('FR-75 ①：不得有静默忽略分支（保留的拒绝情形必须给可见反馈）', () => {
  // 文件夹树仍不允许跨父级移动 —— 但必须弹提示，不能静默
  assert.ok(/folder\.parent_id !== overRow\.folder\.parent_id/.test(folder), '文件夹树仍限制同父级');
  assert.ok(/message\.info\('文件夹只能在同一个父级下调整顺序'\)/.test(folder), '跨父级必须给可见反馈');
  // 提示必须出现在 return 之前
  const block = folder.slice(folder.indexOf("folder.parent_id !== overRow.folder.parent_id"));
  const infoAt = block.indexOf('message.info(');
  const returnAt = block.indexOf('return;');
  assert.ok(infoAt >= 0 && returnAt > infoAt, '必须先提示再 return');
});

test('FR-75 ③：本体即拖拽激活点（rootListeners 挂到卡片/条目/表格行）', () => {
  assert.ok(sortable.includes('rootListeners'), 'SortableItemContext 必须提供 rootListeners');
  // 手柄保留完整监听（指针 + 键盘），本体另挂一份指针监听；手柄内部阻止冒泡避免双激活
  assert.ok(/const \{ onPointerDown \} = allListeners;/.test(sortable), '本体取指针监听，手柄保留完整监听');
  assert.ok(/listeners\?\.onPointerDown as/.test(sortable) && /event\.stopPropagation\(\);/.test(sortable), '手柄先处理再阻止冒泡');
  assert.ok(useView.includes('{...(context?.rootListeners ?? {})}'), '卡片本体挂指针监听');
  assert.ok(useView.includes('{...(context.rootListeners as React.HTMLAttributes<HTMLTableRowElement>)}'), '表格行本体挂指针监听');
  assert.ok(split.includes('{...(rootListeners as React.HTMLAttributes<HTMLDivElement>)}'), '分栏条目本体挂指针监听');
  assert.ok(folder.includes('{...(context.rootListeners as React.HTMLAttributes<HTMLDivElement>)}'), '文件夹行本体也挂指针监听');
});

test('FR-75 ③：手柄保留（键盘可达 + 视觉提示 + cursor grab）', () => {
  assert.ok(sortable.includes('setActivatorNodeRef'), '手柄仍是键盘激活点');
  assert.ok(sortable.includes('listeners={allListeners}'), '手柄保留完整监听（含键盘）');
  assert.ok(sortable.includes('title="按住拖动以调整顺序"'), '手柄有可见提示文案');
  const css = src('styles/app.css');
  assert.ok(/cursor:\s*grab/.test(css), 'cursor: grab 仍在');
});
