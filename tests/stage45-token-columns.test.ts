// 阶段 45 / FR-107（FIX 移动端令牌表「名称」列被压成 0 宽）断言。
//
// 覆盖：`scroll.x` **必须由列定义的 `minWidth` 求和得出**（不得再手写数值、不得用 max-content）、
// 名称列有可读下限（≥ 60px）、6 列定义齐全且顺序不变，以及阶段 44 的两条能力（可横滚、移动端竖排）不被破坏。
// 真实 390×844 与 1600×900 下的**逐列像素**证据在 tools/ac-stage45.sh + ac-stage45-probe.mjs
// （真浏览器 + 真鼠标 + 等抽屉动画结束）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const read = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

/** 去掉注释后的组件源码（源码级断言只检查**真代码**）。 */
const drawer = read('web/src/components/TokenDrawer.tsx')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** 六个列宽常量名（顺序 = 列顺序）。 */
const MIN_WIDTH_CONSTS = [
  'TOKEN_NAME_MIN_WIDTH',
  'TOKEN_MASK_MIN_WIDTH',
  'TOKEN_STATE_MIN_WIDTH',
  'TOKEN_USE_MIN_WIDTH',
  'TOKEN_CREATED_MIN_WIDTH',
  'TOKEN_LAST_USED_MIN_WIDTH',
  'TOKEN_ACTION_MIN_WIDTH',
];

const constOf = (name: string): number => Number(new RegExp(`const ${name} = (\\d+);`).exec(drawer)?.[1] ?? '0');

test('AC-109 ①（源码级）：`scroll.x` 由各列 `minWidth` **求和得出**，不得手写数值、不得用 max-content', () => {
  /**
   * FR-107 的根因就是"手写了一个小于实际需求的 `scroll.x`"（阶段 44 的 `419`）：
   * `tableLayout: fixed` 下前五列的定宽分完就没有剩余，**唯一没有 `width` 的「名称」列被算成 0 宽**。
   * 所以这里钉的不只是"有个值"，而是**这个值必须是推导出来的** —— 以后改任何一列的宽度，
   * `scroll.x` 自动跟着变，结构上不可能再漂移。
   */
  assert.ok(/scroll=\{\{\s*x: TOKEN_TABLE_MIN_WIDTH \}\}/.test(drawer), 'scroll.x 必须引用 TOKEN_TABLE_MIN_WIDTH');
  assert.equal(/scroll=\{\{\s*x: 'max-content'/.test(drawer), false, '不得用 max-content（会撑大桌面名称列、冒出横滚条）');
  assert.equal(/scroll=\{\{\s*x: \d+ \}\}/.test(drawer), false, '不得手写数值（FR-107 的 419 就是这么把名称列压成 0 的）');

  // 求和表达式必须**恰好**由六个列常量相加组成，且不含任何字面数字
  const sumExpr = /const TOKEN_TABLE_MIN_WIDTH =\s*([\s\S]*?);/.exec(drawer)?.[1] ?? '';
  assert.ok(sumExpr !== '', '必须能定位 TOKEN_TABLE_MIN_WIDTH 的求和表达式');
  assert.equal(/\d/.test(sumExpr), false, `求和表达式里不得出现字面数字：${sumExpr.trim()}`);
  const parts = [...sumExpr.matchAll(/([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
  assert.deepEqual(parts, MIN_WIDTH_CONSTS, '求和必须恰好覆盖七列的最小宽度常量（顺序 = 列顺序）');
});

test('AC-109 ①（源码级）：名称列有可读下限 ≥ 60px；六列都声明了 `minWidth`', () => {
  const nameMin = constOf('TOKEN_NAME_MIN_WIDTH');
  assert.ok(nameMin >= 60, `名称列 minWidth 必须 ≥ 60（实际 ${String(nameMin)}）—— 这是"不再被压成 0"的兜底`);
  for (const name of MIN_WIDTH_CONSTS) {
    assert.ok(constOf(name) > 0, `${name} 必须 > 0（每列都要有下限）`);
  }
  // 每一列都真的把常量用上了（不是定义了却没用）
  for (const name of MIN_WIDTH_CONSTS) {
    assert.ok(new RegExp(`minWidth: ${name},`).test(drawer), `${name} 必须被某一列用作 minWidth`);
  }
  // 名称列不得再出现 `minWidth: 0`
  assert.equal(/minWidth: 0,/.test(drawer), false, '名称列不得再声明 minWidth: 0（FR-107 的旧写法）');
  // 六列之和 = scroll.x 的实际值（与常量定义一致）
  const total = MIN_WIDTH_CONSTS.reduce((sum, name) => sum + constOf(name), 0);
  assert.ok(total >= 350, `六列最小宽度之和 ${String(total)} 应 ≥ 手机容器宽 350（这样 390 下必然溢出并可横滚）`);
});

test('AC-109 ①（源码级）：表头 6 列顺序与语义不变，抽屉宽度不变，fixed 布局不变', () => {
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  /** v58（FR-111）：6 列 → 7 列（新增「创建时间」）；名称仍是第一列。 */
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '创建时间', '最近使用', '操作'], '7 列与顺序不得变（名称仍是第一列）');
  const width = /width=\{(\d+)\}/.exec(drawer);
  /** v58（FR-111）：列变 7 列后允许加宽到 720。 */
  assert.equal(width?.[1], '720', '抽屉宽度为 720（FR-111 加宽）');
  assert.ok(/tableLayout="fixed"/.test(drawer), '仍须 tableLayout="fixed"');
});

test('AC-109 ⑦（源码级）：阶段 44 的两条能力未被改坏（可横滚 + 移动端竖排表单）', () => {
  // ① 可横滚：仍设了 scroll.x（这是 antd 渲染 .ant-table-content 可滚动容器的唯一条件）
  assert.ok(/scroll=\{\{\s*x:/.test(drawer), '仍须设 scroll.x');
  // ② 移动端竖排：isMobile 分支仍在
  assert.ok(/layout=\{isMobile \? 'vertical' : 'inline'\}/.test(drawer), '移动端表单仍须竖排');
  assert.ok(/style=\{isMobile \? undefined : \{ flex: 1 \}\}/.test(drawer), '名称项的 flex 仍只在桌面生效');
  // ③ FR-105 的改权限入口没被碰掉
  assert.ok(/<Dropdown/.test(drawer), '状态列的改权限入口必须还在');
  assert.ok(/api\.setTokenScope\(id, scope\)/.test(drawer), '仍调 PATCH 接口');
  // ④ 名称列的完整名仍进 title（FR-99 ②，超长名悬停看全）
  assert.ok(/onCell: \(token\) => \(\{ title: token\.name \}\)/.test(drawer), '完整名称仍须进 title');
  assert.ok(/truncateTokenName\(/.test(drawer), '名称仍按字符截断（不撑破列宽）');
});
