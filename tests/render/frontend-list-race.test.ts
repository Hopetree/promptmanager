/**
 * 常驻回归（阶段 71 / FR-151 ① ② / AC-133 A1·A3）。
 *
 * 判据：列表类请求必须"**最后一次发出者赢**"——慢的旧响应不得覆盖新的筛选结果；
 * 并且"**有请求在飞**"时界面必须给出加载态（不许静默展示旧结果）。
 *
 * 来源：`var/review-2/frontend-race.test.ts`（评审探针，改前 fail）。**断言只增不减**：
 * 原探针的乱序前提断言、`deepEqual(['pm-copy-900'])` 判定、超时长度都原样保留，新增的只有 A3 的加载态断言。
 */
import { calls, element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

/** 断言中途失败也要卸载：否则上一棵 DOM 会留给下一条用例（详见 harness 的 mountRegistry）。 */
const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function makePrompt(id: number, title: string): Prompt {
  return {
    id,
    title,
    user_prompt: `正文${String(id)}`,
    system_prompt: '',
    notes: '',
    folder_id: null,
    tags: [],
    favorite: false,
    remember_variables: true,
    created_at: '2026-10-11T00:00:00.000Z',
    updated_at: '2026-10-11T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
  };
}

function install(): void {
  route('GET', /^\/api\/me$/, () => ({ status: 200, body: { username: 'admin' } }));
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts$/, async (request) => {
    if (request.search.includes('q=zz')) {
      // 新的筛选请求：立刻回来
      return { status: 200, body: { total: 1, limit: 20, offset: 0, items: [makePrompt(900, '新结果')] } };
    }
    if (request.search.includes('favorite=true')) {
      // 旧的筛选请求：慢 600ms
      await new Promise((resolve) => setTimeout(resolve, 600));
      return {
        status: 200,
        body: { total: 2, limit: 20, offset: 0, items: [makePrompt(100, '旧的收藏一'), makePrompt(200, '旧的收藏二')] },
      };
    }
    return { status: 200, body: { total: 2, limit: 20, offset: 0, items: [makePrompt(100, '旧一'), makePrompt(200, '旧二')] } };
  });
}

function visibleCopyIds(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="pm-copy-"]')).map(
    (node) => node.getAttribute('data-testid') ?? '',
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.localStorage.setItem('pm-view-mode', 'card');
});

test('常驻：慢的旧筛选响应不得覆盖新的筛选结果（乱序响应）', async () => {
  install();
  const mounted: Mounted = await mountTracked(
    element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(Workspace, {
      themeMode: 'light',
      onCycleTheme: () => undefined,
      onSignedOut: () => undefined,
    }))),
  );
  await waitFor(() => visibleCopyIds().includes('pm-copy-100'), '初始列表出现', 3000);
  assert.deepEqual(visibleCopyIds().sort(), ['pm-copy-100', 'pm-copy-200']);

  // 步骤 2：点「只看收藏」→ 慢请求发出
  await act(async () => {
    const only = document.querySelector<HTMLButtonElement>('[data-testid="pm-use-favorite-only"]');
    assert.ok(only !== null, '找不到「只看收藏」开关');
    only.click();
  });
  /**
   * AC-133 A3：请求仍在飞（旧筛选要 600ms 才回来）时，界面必须给出加载态 ——
   * 判据是"界面**不是**静默展示旧结果"，骨架屏 / loading 皆可（D-69 ②：形式自定但必须可断言）。
   */
  assert.ok(
    document.querySelector('[data-testid="pm-list-loading"]') !== null,
    '「只看收藏」请求在飞时没有加载态（界面在静默展示旧结果）',
  );
  // 步骤 3：立刻输入搜索词，防抖 300ms 后发出第二个（新的）请求，此时慢请求仍在途
  const input = document.querySelector<HTMLInputElement>('input[data-testid="pm-search-input"]');
  assert.ok(input !== null, '找不到搜索框');
  await act(async () => {
    setInputValue(input, 'zz');
  });
  await waitFor(() => visibleCopyIds().includes('pm-copy-900'), '新筛选（q=zz）结果出现', 3000);
  // 步骤 4：等旧响应到达（并在到达后再多等一会儿让其 effect 落定）
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });

  const promptCalls = calls.filter((c) => c.path === '/api/prompts');
  assert.ok(
    promptCalls.length >= 2 && promptCalls.some((c) => c.search.includes('favorite=true')) && promptCalls.some((c) => c.search.includes('q=zz')),
    `乱序前提不成立：${JSON.stringify(promptCalls.map((c) => c.search))}`,
  );
  const finalIds = visibleCopyIds().sort();
  assert.deepEqual(
    finalIds,
    ['pm-copy-900'],
    `列表被旧的慢响应覆盖：当前渲染 ${JSON.stringify(finalIds)}`,
  );
  // 旧响应落地后不得再翻回加载态（loading 只能被"最后一次发出的请求"清掉）
  assert.equal(
    document.querySelector('[data-testid="pm-list-loading"]'),
    null,
    '最后一次请求已落地，界面却仍停在加载态',
  );
});
