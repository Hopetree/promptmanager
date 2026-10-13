import { Grid } from 'antd';

/**
 * **断点判断的唯一来源**（FR-154 / N16 / N18 / AC-133 D13）。
 *
 * 为什么要收拢：此前 `Workspace.tsx` / `PromptEditor.tsx` 各自把 antd `Grid.useBreakpoint()`
 * 的 `undefined`（**首帧还没测量**）当成"比 md 窄"，`AboutModal.tsx` 又自己写了一份按视口宽度的
 * 判定。三份判断在首帧会互相不一致（宽屏上先按移动端渲染一帧再纠正），也没有"未知"这个概念。
 *
 * 这里把两件事分开：
 * - `undefined` = **未知**（antd 还没出测量值）⇒ 按视口宽度显式兜底，并如实标记 `measured: false`；
 * - 真测出窄 ⇒ `isMobile` / `isNarrow`。
 */
export const MOBILE_MAX_WIDTH = 768;
export const NARROW_MAX_WIDTH = 1200;

export interface ViewportBands {
  /** < 768px：移动端单栏 + 抽屉 */
  isMobile: boolean;
  /** 768–1200px：保留"中栏 + 右栏"，左栏收成抽屉（FR-46） */
  isNarrow: boolean;
  /** antd 是否已经测出断点（`false` = 这一轮是"未知 → 宽度兜底"，不是"测量结果是窄"） */
  measured: boolean;
}

/** 纯函数：给定 antd 的断点表与视口宽度算出两个档位（测试可直接驱动，不必真改窗口）。 */
export function viewportBands(screens: Partial<Record<'md' | 'xl', boolean>>, width: number): ViewportBands {
  const measured = screens.md !== undefined && screens.xl !== undefined;
  const isMobile = screens.md === undefined ? width < MOBILE_MAX_WIDTH : !screens.md;
  const isNarrow = !isMobile && (screens.xl === undefined ? width < NARROW_MAX_WIDTH : !screens.xl);
  return { isMobile, isNarrow, measured };
}

/** 组件里唯一的断点入口 —— 内部仍是 antd `Grid.useBreakpoint()`，不自造 media query。 */
export function useViewportBands(): ViewportBands {
  const screens = Grid.useBreakpoint();
  const width = typeof window === 'undefined' ? NARROW_MAX_WIDTH : window.innerWidth;
  return viewportBands(screens, width);
}
