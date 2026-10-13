/**
 * 常驻回归（阶段 71 / FR-151 ③ / AC-133 A4）。
 *
 * 判据：`use-copy.ts` 的 `copyRendered` **不得再用"捕获时刻的 prompt 对象"** ——
 * 它必须只凭 `id` 在当前单一数据源（Workspace 的 `Map<id, Prompt>`）里取当次正文；
 * 填值弹窗拿到的对象也必须跟着单一数据源走（弹窗期间列表刷新过，就不能还渲染旧正文）。
 *
 * 本用例覆盖两件可机检的事：
 *   ① `copyRendered` 按 **id** 发 `POST /api/prompts/:id/render`（改前传对象 ⇒ 路径里是 `undefined`）；
 *   ② `varsPrompt` 始终由 resolver 现取 —— 解析结果换成新对象并重渲染后，弹窗看到的是新正文。
 */
import { calls, element, mountRegistry, releaseLoaderPort, resetRoutes, route } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act, useState } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Prompt } from '../../web/src/types.ts';
import type { PromptCopier } from '../../web/src/use-copy.ts';

const { usePromptCopy } = await import('../../web/src/use-copy.ts');

/** 断言中途失败也要卸载：否则上一棵 DOM 会留给下一条用例（详见 harness 的 mountRegistry）。 */
const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function makePrompt(id: number, body: string): Prompt {
  return {
    id,
    title: `标题${String(id)}`,
    user_prompt: body,
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

let resolved: Prompt = makePrompt(7, '你好 {{name}}');
const holder: { current: PromptCopier | null } = { current: null };
let forceRerender: (() => void) | null = null;
let renders = 0;

function CopyProbe(): ReturnType<typeof element> {
  renders += 1;
  const [, setTick] = useState(0);
  forceRerender = () => setTick((tick) => tick + 1);
  const copier = usePromptCopy((id) => (resolved.id === id ? resolved : null));
  holder.current = copier;
  const varsBody = copier.varsPrompt === null ? 'none' : copier.varsPrompt.user_prompt;
  return element('div', { 'data-testid': 'copy-probe' }, element('span', { 'data-testid': 'probe-vars' }, varsBody));
}

function probeVars(): string {
  return document.querySelector('[data-testid="probe-vars"]')?.textContent ?? '(gone)';
}

/** 去掉对"参数是个对象"的类型依赖：改前传对象、改后传 id 都能编译。 */
function copyRenderedById(copier: PromptCopier, id: number, values: Record<string, string>): Promise<void> {
  const loose = copier.copyRendered as unknown as (promptId: number, values: Record<string, string>) => Promise<void>;
  return loose(id, values);
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  resolved = makePrompt(7, '你好 {{name}}');
  renders = 0;
});

test('常驻：copyRendered 按 id 渲染；弹窗对象始终取单一数据源的最新一份', async () => {
  route('POST', /^\/api\/prompts\/\d+\/render$/, () => ({ status: 200, body: { user_prompt: '你好，世界' } }));
  await mountTracked(element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(CopyProbe, {}))));
  const copier = holder.current;
  assert.ok(copier !== null, '拿不到 PromptCopier');
  assert.equal(probeVars(), 'none', '前置不成立：还没打开填值弹窗');

  // 含变量 → 打开填值弹窗（只记 id，不复制对象）
  await act(async () => {
    await copier.copyPrompt(resolved);
  });
  assert.equal(probeVars(), '你好 {{name}}', 'copyPrompt 没有打开含变量条目的弹窗');

  // 单一数据源里的那条被换成新对象（模拟列表刷新 / 详情回填）→ 弹窗必须跟着换
  resolved = makePrompt(7, '你好 {{name}}（更新后的正文）');
  await act(async () => {
    forceRerender?.();
  });
  assert.equal(
    probeVars(),
    '你好 {{name}}（更新后的正文）',
    '✖ 填值弹窗还在用捕获时刻的旧对象（FR-151 ③）',
  );
  assert.ok(renders > 1, '前置不成立：数据源变了但组件没有重渲染');

  // 点「复制结果」：必须按 id 打渲染接口 —— 改前传的是对象，路径里会变成 `undefined`
  const live = holder.current;
  assert.ok(live !== null, '拿不到最新的 PromptCopier');
  await act(async () => {
    await copyRenderedById(live, 7, { name: '世界' });
  });
  const renderCall = calls.find((call) => call.method === 'POST' && call.path === '/api/prompts/7/render');
  assert.ok(
    renderCall !== undefined,
    `copyRendered 没有按 id 发渲染请求（改前路径里是 undefined）：${JSON.stringify(calls.map((call) => `${call.method} ${call.path}`))}`,
  );
  assert.deepEqual(renderCall.body, { values: { name: '世界' } }, '渲染请求没有带上填值');
  assert.equal(probeVars(), 'none', '复制成功后填值弹窗没有关闭');
});
