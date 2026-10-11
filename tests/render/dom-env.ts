/**
 * 渲染级测试的**浏览器环境**（阶段 65 / AC-127 A1）。
 *
 * 这个文件必须被**第一个**求值：`react-dom` 在模块初始化时读一次
 * `typeof window !== 'undefined' && typeof window.document !== 'undefined'`（`canUseDOM`），
 * 并把输入事件的实现固定下来。如果 jsdom 的全局是在 `react-dom` 之后才装上的，
 * 之后真的派发 `input` 事件时会走 IE 兜底分支，炸 `activeElement.attachEvent is not a function`。
 * 所以这里只 import `jsdom`，不 import 任何 react 相关模块；`harness.ts` 再把它放在第一个 import。
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
});

export const jsdomWindow = dom.window;

export function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/**
 * 一定从 jsdom 取的 DOM 类名：这些即使 Node 里已经有同名全局（`Event` / `EventTarget` / `navigator` …），
 * 也必须换成 jsdom 的 —— React 的事件系统与 DOM 节点必须来自**同一套**实现，混用会出 `instanceof` 类怪事。
 */
const FORCE_FROM_JSDOM = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLButtonElement',
  'HTMLDivElement',
  'SVGElement',
  'Text',
  'Comment',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'InputEvent',
  'FocusEvent',
  'PointerEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'DOMParser',
  'CSSStyleDeclaration',
  'DOMRect',
  'Range',
] as const;

/** 绝不从 jsdom 覆盖的名字：Node 自己的模块系统与计时器要保住。 */
const NEVER_FROM_JSDOM = new Set([
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
  'process',
  'require',
  'module',
  'exports',
  'undefined',
  'NaN',
  'Infinity',
]);

for (const name of FORCE_FROM_JSDOM) {
  const value = (jsdomWindow as unknown as Record<string, unknown>)[name];
  if (value !== undefined) define(name, value);
}

// 其余 jsdom 有、Node 没有的名字（`SVGElement` 之类）一并补上 —— 漏一个就会在组件里炸出
// `ReferenceError: XXXElement is not defined`，而这种错误只在渲染到那一行时才出现。
for (const name of Object.getOwnPropertyNames(jsdomWindow)) {
  if (NEVER_FROM_JSDOM.has(name) || name in globalThis) continue;
  const value = (jsdomWindow as unknown as Record<string, unknown>)[name];
  if (typeof value === 'function' || (typeof value === 'object' && value !== null)) define(name, value);
}

/**
 * jsdom 没有 `matchMedia`，而 antd 的响应式（`Grid.useBreakpoint`）完全靠它 ——
 * 桩必须**真的按窗口宽度算**：一律 `matches: false` 会让 `screens.md === false`，
 * 于是 `Workspace` 认定自己在移动端，分栏右栏根本不渲染（第一版就栽在这里）。
 */
function mediaMatches(query: string, width: number): boolean {
  return query.split(/\s+and\s+/i).every((part) => {
    const min = /min-width:\s*([\d.]+)px/.exec(part);
    if (min !== null) return width >= Number(min[1]);
    const max = /max-width:\s*([\d.]+)px/.exec(part);
    if (max !== null) return width <= Number(max[1]);
    // 不认识的查询（`prefers-color-scheme` 之类）一律不匹配：测试里要的是浅色 + 桌面。
    return false;
  });
}

const matchMediaStub = (query: string): MediaQueryList => ({
  matches: mediaMatches(query, jsdomWindow.innerWidth),
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
}) as unknown as MediaQueryList;
define('matchMedia', matchMediaStub);

/** jsdom 没有 `ResizeObserver`（`Workspace` 量顶栏高度要用）。 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
define('ResizeObserver', NoopResizeObserver);
define('IntersectionObserver', NoopResizeObserver);

// 组件里读的是 `window.matchMedia` / `window.ResizeObserver`（不是裸全局）——
// jsdom 的 window 上没有这几个，不补就会在渲染中途炸 `window.matchMedia is not a function`。
for (const name of ['matchMedia', 'ResizeObserver', 'IntersectionObserver'] as const) {
  Object.defineProperty(jsdomWindow, name, {
    value: (globalThis as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
}

/** React 19 的 `act()` 需要这个开关，否则会警告"环境没配置成支持 act"。 */
define('IS_REACT_ACT_ENVIRONMENT', true);
