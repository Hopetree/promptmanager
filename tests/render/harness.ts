/**
 * 渲染级测试基建（阶段 65 / AC-127 A1）：jsdom + `react-dom/client` + 假 `fetch`。
 *
 * ⚠️ `./dom-env.ts` 必须是**第一个** import：它要在 `react-dom` 求值之前把 jsdom 的
 * `window`/`document` 装成全局（详见那个文件的注释）。
 *
 * 这个文件在环境之外只做三件事：
 * 1. **注册 `.tsx` 加载钩子**（`tools/tsx-loader.mjs`）—— Node 的类型擦除不支持 JSX；
 * 2. **假 `fetch`**：`web/src/api.ts` 用的是相对路径 `fetch('/api/...')`，
 *    测试按"方法 + 路径正则"注册应答，并记录每一次请求（断言"发了什么"用）；
 * 3. **挂载 / 冲洗 / 卸载**：`act()` 包一层，让 effect、promise 链、antd 的异步更新都落定。
 *
 * ⚠️ jsdom 与 react-dom **本来就在依赖里**（`jsdom 30.1.2`、`react-dom 19.3.0`），本阶段没有新增依赖。
 */
import './dom-env.ts';
import { define } from './dom-env.ts';
import { register } from 'node:module';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

register('../../tools/tsx-loader.mjs', import.meta.url);

/**
 * 放掉加载钩子 worker 的 `MessagePort`。
 *
 * ⚠️ 不调用它，`node --test` **永远不会退出**：一旦渲染树里的 `React.lazy` 走了一次动态 import，
 * 那个 MessagePort 就被引用住了（实测 `process.getActiveResourcesInfo()` 里一直挂着 `MessagePort`，
 * 关掉 jsdom 的 window 也没用），node:test 会一直等事件循环空下来。
 * `unref()` 之后进程正常退出（3s 内），且**不影响退出码** —— 测试失败照样是 1。
 */
export function releaseLoaderPort(): void {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  for (const handle of handles) {
    if ((handle as { constructor?: { name?: string } }).constructor?.name !== 'MessagePort') continue;
    (handle as { unref?: () => void }).unref?.();
  }
}

// ---- 假 fetch ------------------------------------------------------------------

export interface FakeRequest {
  method: string;
  /** 路径（不含查询串），如 `/api/prompts/3` */
  path: string;
  /** 查询串（含 `?`），如 `?limit=20` */
  search: string;
  body: unknown;
}

interface Route {
  method: string;
  path: RegExp;
  reply: (request: FakeRequest) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
}

const routes: Route[] = [];

/** 记录每一次请求（按时间顺序），断言"发了什么 / 发了几次"用。 */
export const calls: FakeRequest[] = [];

/**
 * 注册一条应答。`path` 是正则（对整个路径做 `test`）。
 * 未命中的请求一律回 404 `{ error: 'not_found' }`，并且仍会被记进 `calls` —— 静默失败最难查。
 */
export function route(
  method: string,
  path: RegExp,
  reply: Route['reply'],
): void {
  routes.push({ method, path, reply });
}

/** 清掉路由与调用记录（同一个测试文件里跑多条用例时用）。 */
export function resetRoutes(): void {
  routes.length = 0;
  calls.length = 0;
}

define('fetch', async (input: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
  const raw = String(input);
  const url = new URL(raw, 'http://127.0.0.1');
  const request: FakeRequest = {
    method: init?.method ?? 'GET',
    path: url.pathname,
    search: url.search,
    body: init?.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
  };
  calls.push(request);
  const matched = routes.find((item) => item.method === request.method && item.path.test(request.path));
  if (matched === undefined) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  const { status, body } = await matched.reply(request);
  /**
   * 204 / 205 **不许带 body**（`new Response('', { status: 204 })` 会被运行时直接拒绝：
   * `Invalid response status code 204`）。所以这两个状态码一律传 `null`，
   * 这样假服务端才能像真服务端那样回"空 204"（`DELETE /api/tokens/:id` 就是这种）。
   */
  const noBody = status === 204 || status === 205;
  return new Response(noBody || body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
});

// ---- 挂载 / 冲洗 ----------------------------------------------------------------

export interface Mounted {
  container: HTMLElement;
  root: Root;
  /** 让 effect、promise 链、antd 的异步更新落定。 */
  settle: () => Promise<void>;
  unmount: () => Promise<void>;
}

/** 挂一个 React 元素到 jsdom 的 document.body，返回容器与冲洗/卸载句柄。 */
export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await act(async () => {
    root.render(element);
  });
  await settle();
  return {
    container,
    root,
    settle,
    unmount: async (): Promise<void> => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      // 每次卸载都放一次：最后一条用例卸载后进程就能自己退出（见 `releaseLoaderPort` 的注释）。
      releaseLoaderPort();
    },
  };
}

/** 渲染一个元素（`mount` 的简写，元素用 `createElement` 造，测试文件因此不必是 `.tsx`）。 */
export function element(
  type: unknown,
  props: Record<string, unknown> = {},
  ...children: unknown[]
): ReactElement {
  return createElement(type as never, props, ...(children as never[]));
}

/** 等某个条件成立（每轮都过一遍 `act`，最多 `timeoutMs` 毫秒）。 */
export async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`等待超时：${message}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** 按 `data-testid` 取元素（取不到就抛，避免断言在 `null` 上悄悄通过）。 */
export function byTestId(testid: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (found === null) throw new Error(`找不到 [data-testid="${testid}"]`);
  return found;
}

/** 取元素可见文本（antd 的输入框值走 `value`，不在 textContent 里）。 */
export function textOf(selector: string): string {
  const found = document.querySelector(selector);
  if (found === null) throw new Error(`找不到 ${selector}`);
  return (found.textContent ?? '').trim();
}
