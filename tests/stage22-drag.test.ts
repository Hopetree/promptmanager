// 阶段 22 / FR-70（BRIEF v29 §4 + §8 AC-70 + §9 D-28）的源码级断言：
// 拖拽用成熟库 @dnd-kit（不手写引擎）；手柄热区 24×24 且不增高行高；过渡 ≤150ms；两处手柄锚点；排序档「自定义」。
// 端到端（真鼠标拖拽 + 刷新持久 + 像素回归 + 接口负例）见 tools/ac-stage22.sh / ac-stage22-probe.mjs 与 tests/api-order.test.ts。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

const sortable = src('components/SortableList.tsx');
const split = src('components/SplitView.tsx');
const useView = src('components/UseView.tsx');
const folder = src('components/FolderPanel.tsx');
const css = src('styles/app.css');
const pure = src('pure.ts');
const api = src('api.ts');
const types = src('types.ts');

test('FR-70 依赖纪律：拖拽用 @dnd-kit（MIT、pin 精确版本、lockfile 已提交），不手写引擎', () => {
  for (const name of ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', '@dnd-kit/modifiers']) {
    assert.ok(pkg.dependencies[name] !== undefined, `package.json 必须登记 ${name}`);
    assert.match(pkg.dependencies[name] ?? '', /^\d+\.\d+\.\d+$/, `${name} 必须 pin 精确版本`);
  }
  assert.ok(sortable.includes('@dnd-kit/core'), 'SortableList 基于 @dnd-kit/core');
  assert.ok(sortable.includes('@dnd-kit/sortable'), 'SortableList 基于 @dnd-kit/sortable');
  // 不手写拖拽引擎：不得自己监听 mousemove/touchmove 做拖拽
  assert.equal(/addEventListener\(\s*['"](mouse|touch|pointer)move/.test(sortable), false, '不得手写拖拽引擎');
  const deps = readFileSync(path.join(ROOT, 'docs', 'dependencies.md'), 'utf8');
  assert.ok(deps.includes('@dnd-kit/core'), 'docs/dependencies.md 必须登记新依赖');
});

test('AC-70 ①：手柄热区 24×24、cursor grab/grabbing、且不增高行高（放在标题行内）', () => {
  const rule = css.slice(css.indexOf('.pm-drag-handle.ant-btn'), css.indexOf('.pm-drag-handle.ant-btn') + 400);
  assert.ok(/width:\s*24px/.test(rule), '手柄宽 24');
  assert.ok(/height:\s*24px/.test(rule), '手柄高 24');
  assert.ok(/cursor:\s*grab/.test(rule), 'cursor: grab');
  assert.ok(/cursor:\s*grabbing/.test(rule), '激活态 cursor: grabbing');
  assert.ok(sortable.includes('HolderOutlined'), '图标语义明确（HolderOutlined）');
  // 手柄与星标/标题同排：卡片与分栏条目里都在标题行内
  assert.ok(/FavoriteStar[\s\S]{0,400}handle/.test(useView), '卡片：手柄在标题行（与星标同排）');
  assert.ok(/FavoriteStar[\s\S]{0,400}handle/.test(split), '分栏条目：手柄在标题行（与星标同排）');
});

test('AC-70 ②：让位过渡 ≤150ms（dnd-kit transition.duration = 150），且拖动只改 transform', () => {
  assert.match(sortable, /transition:\s*\{\s*duration:\s*150/, 'useSortable 的 transition.duration 必须是 150ms');
  assert.ok(sortable.includes('CSS.Transform.toString(transform)'), '让位用 transform（不重排 DOM、不闪烁）');
  assert.ok(sortable.includes('arrayMove'), '拖拽结束用 arrayMove 计算新顺序');
});

test('AC-70：三处拖拽锚点（分栏中栏 / 卡片 / 文件夹树）与手柄 testid 前缀', () => {
  assert.ok(split.includes('handleTestIdPrefix="pm-drag-split"'), '分栏中栏手柄 testid 前缀');
  assert.ok(useView.includes('handleTestIdPrefix="pm-drag-card"'), '卡片手柄 testid 前缀');
  assert.ok(folder.includes('handleTestIdPrefix="pm-drag-folder"'), '文件夹树手柄 testid 前缀');
  // 文件夹树只允许同父级重排
  assert.ok(/parent_id !== overRow\.folder\.parent_id/.test(folder), '跨父级拖动必须被忽略（不落库）');
});

test('D-28：新增「自定义」排序档（前端 type/query/下拉 + 拖拽后自动切换）', () => {
  assert.ok(types.includes("'custom'"), 'types.ts 的排序档要含 custom');
  assert.ok(pure.includes("params.sort === 'custom'"), '查询串要带上 sort=custom');
  assert.ok(pure.includes("sort: 'updated' | 'recent_used' | 'custom' | 'title'"), 'orderPrompts 支持 custom');
  assert.ok(useView.includes("{ value: 'custom', label: '自定义' }"), '排序下拉要有「自定义」');
  assert.ok(/api\.reorderPrompts/.test(src('components/Workspace.tsx')), '拖拽结束调用 reorderPrompts');
  assert.ok(src('components/Workspace.tsx').includes('已切换为自定义排序'), '首次自动切档要有轻提示');
  assert.ok(api.includes("'PATCH', '/api/prompts/order'"), 'api.ts 有 PATCH /api/prompts/order');
  assert.ok(api.includes("'PATCH', '/api/folders/order'"), 'api.ts 有 PATCH /api/folders/order');
});

test('FR-70 键盘可达：手柄聚焦后可用方向键移动（dnd-kit KeyboardSensor）', () => {
  assert.ok(sortable.includes('KeyboardSensor'), '需要 KeyboardSensor');
  assert.ok(sortable.includes('sortableKeyboardCoordinates'), '键盘坐标计算');
  assert.ok(folder.includes('KeyboardSensor'), '文件夹树同样支持键盘');
});
