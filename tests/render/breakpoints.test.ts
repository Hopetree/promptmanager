/**
 * 常驻回归（阶段 71 / FR-154 / AC-133 D13）。
 *
 * 判据：**断点判断只有一个来源**（`web/src/breakpoints.ts`），且"antd 还没测出来（undefined）"
 * 与"窄"是两件事 —— 未测量时按窗口宽度显式兜底，并把"这一轮是兜底值"如实暴露出来。
 *
 * 机械核对两条：
 *   ① `viewportBands()` 的行为（antd 测量值优先；未测量 = 按宽度兜底且 `measured === false`）；
 *   ② 全仓 `web/src`（除 `breakpoints.ts`）不得再出现 `innerWidth` / `useBreakpoint` —— 唯一来源。
 */
import './dom-env.ts';
import assert from 'node:assert/strict';
import { webSourceFiles } from '../source-text.ts';
import { test } from 'node:test';
import { MOBILE_MAX_WIDTH, NARROW_MAX_WIDTH, viewportBands } from '../../web/src/breakpoints.ts';

test('常驻：viewportBands 以 antd 的测量值为准', () => {
  assert.equal(MOBILE_MAX_WIDTH, 768);
  assert.equal(NARROW_MAX_WIDTH, 1200);
  const phone = viewportBands({ md: false, xl: false }, 1440);
  assert.equal(phone.isMobile, true, 'antd 说 md=false 时必须是移动端（不得被窗口宽度覆盖）');
  assert.equal(phone.measured, true);
  const desktop = viewportBands({ md: true, xl: true }, 400);
  assert.equal(desktop.isMobile, false, 'antd 说 md=true 时不得被判成移动端');
  assert.equal(desktop.isNarrow, false);
  assert.equal(desktop.measured, true);
  const narrowDesktop = viewportBands({ md: true, xl: false }, 1440);
  assert.equal(narrowDesktop.isMobile, false);
  assert.equal(narrowDesktop.isNarrow, true, 'md 命中但 xl 未命中 = 窄屏（侧栏收起）');
});

test('常驻：未测量（undefined）按窗口宽度兜底，且与"窄"分开标记', () => {
  const small = viewportBands({}, 500);
  assert.equal(small.isMobile, true);
  assert.equal(small.measured, false, '未测量必须如实标记 measured=false');
  const middle = viewportBands({}, 1000);
  assert.equal(middle.isMobile, false);
  assert.equal(middle.isNarrow, true);
  assert.equal(middle.measured, false);
  const wide = viewportBands({}, 1440);
  assert.equal(wide.isMobile, false);
  assert.equal(wide.isNarrow, false, '未知 ≠ 窄：1440 宽窗在未测量时也不得被判成窄屏');
  assert.equal(wide.measured, false);

  // 兜底结果必须与"同样宽度下 antd 真测过"逐档一致（不许两套口径漂移）
  for (const width of [320, 500, 767, 768, 1199, 1200, 1440, 2000]) {
    const fallback = viewportBands({}, width);
    const measured = viewportBands({ md: width >= MOBILE_MAX_WIDTH, xl: width >= NARROW_MAX_WIDTH }, width);
    assert.deepEqual(
      { isMobile: fallback.isMobile, isNarrow: fallback.isNarrow },
      { isMobile: measured.isMobile, isNarrow: measured.isNarrow },
      `宽度 ${String(width)} 下兜底档位与实测档位不一致`,
    );
  }
});

test('常驻：全仓断点判断只有一个来源（breakpoints.ts）', () => {
  // 走统一入口 `tests/source-text.ts`：`readWebSource` 拿到的文本**已经剥掉注释**
  // （判据是"还能不能自己算断点"，注释里为了说明历史缺陷写出字面量不算违规）。
  const offenders: string[] = [];
  for (const file of webSourceFiles()) {
    if (file.rel === 'web/src/breakpoints.ts') continue;
    const label = file.rel.replace('web/src/', '');
    if (file.text.includes('innerWidth')) offenders.push(`${label}: 自己读 window.innerWidth`);
    if (file.text.includes('useBreakpoint')) offenders.push(`${label}: 自己调 Grid.useBreakpoint`);
  }
  assert.deepEqual(offenders, [], '断点判断必须只来自 web/src/breakpoints.ts（含 AboutModal 的 isNarrowHint）');
});
