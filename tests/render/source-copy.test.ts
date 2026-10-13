/**
 * 常驻回归（阶段 74 / FR-165 / AC-136 —— 口径 A1 / B1 / C1）。
 *
 * 判据（渲染级、可机械核对）：
 * - **位置**：详情页「复制源码」在**正文区工具行**（`pm-detail-fields`）里，**不在**底部主操作条（`pm-detail-actions`）；
 * - **等级**：它不是 `ant-btn-primary`，而「复制提示词」仍是 primary（同一棵 DOM 里的等级对照）；
 * - **内容（B1）**：复制的是**当前字段的模板原文**（`{{变量}}` 原样）—— 详情跟页签、编辑器用表单当前值；
 * - **零网络（A1）**：复制源码**不发任何请求**（既不记账也不渲染）⇒ `calls` 长度不变。
 *
 * 剪贴板捕获：jsdom 没有 async clipboard，`writeClipboard` 走 `clipboard.ts` 的
 * Selection + `document.execCommand('copy')` 兜底；这里给 `execCommand` 打桩，
 * 记录**文档选区**里的文本（就是真正会被复制的内容）。
 */
import { calls, element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

const USER_SOURCE = '正文甲 {{名字 | default(甲)}}';
const SYSTEM_SOURCE = '你是{{角色}}助手';
const RENDERED_USER = '正文甲 甲';
const RENDERED_SYSTEM = '你是评审助手';

const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 1,
    title: '甲',
    user_prompt: USER_SOURCE,
    system_prompt: SYSTEM_SOURCE,
    notes: '',
    folder_id: null,
    tags: [],
    favorite: false,
    /** false = 不预填变量记忆（FR-127），让"填值 → 渲染"这条路径可确定地复现。 */
    remember_variables: false,
    created_at: '2026-10-11T00:00:00.000Z',
    updated_at: '2026-10-11T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
    ...overrides,
  };
}

function install(prompt: Prompt = makePrompt()): void {
  route('GET', /^\/api\/me$/, () => ({ status: 200, body: { username: 'admin' } }));
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts$/, () => ({
    status: 200,
    body: { total: 1, limit: 20, offset: 0, items: [prompt] },
  }));
  route('GET', /^\/api\/prompts\/\d+$/, () => ({ status: 200, body: prompt }));
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts\/\d+\/variables$/, () => ({
    status: 200,
    body: { variables: ['名字', '角色'], defaults: { 名字: '甲' } },
  }));
  route('POST', /^\/api\/prompts\/\d+\/render$/, () => ({
    status: 200,
    body: { user_prompt: RENDERED_USER, system_prompt: RENDERED_SYSTEM, missing: [] },
  }));
  route('POST', /^\/api\/prompts\/\d+\/copy$/, () => ({ status: 204, body: {} }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>m</p>' } }));
}

/** 打桩 `document.execCommand`：记录每次 "copy" 时**文档选区**里的文本。 */
function stubClipboard(): string[] {
  const copied: string[] = [];
  (document as Document & { execCommand?: (command: string) => boolean }).execCommand = (command: string): boolean => {
    if (command === 'copy') copied.push(window.getSelection()?.toString() ?? '');
    return true;
  };
  return copied;
}

async function mountWorkspace(): Promise<void> {
  await mountTracked(
    element(
      ConfigProvider,
      { theme: { token: { motion: false } } },
      element(
        AntdApp,
        {},
        element(Workspace, { themeMode: 'light', onCycleTheme: () => undefined, onSignedOut: () => undefined }),
      ),
    ),
  );
  await waitFor(() => document.querySelector('[data-testid="pm-detail-fields"]') !== null, '分栏右栏详情出现', 3000);
}

async function settle(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.localStorage.setItem('pm-view-mode', 'split');
});

test('AC-136 ①②⑧：详情页「复制源码」在正文区工具行、不是主按钮，且零网络请求', async () => {
  install();
  const copied = stubClipboard();
  await mountWorkspace();

  const fields = document.querySelector('[data-testid="pm-detail-fields"]');
  const actions = document.querySelector('[data-testid="pm-detail-actions"]');
  const source = document.querySelector<HTMLElement>('[data-testid="pm-detail-copy-source"]');
  const promptCopy = document.querySelector<HTMLElement>('[data-testid="pm-detail-copy"]');

  assert.ok(source !== null, '详情页缺少「复制源码」入口');
  assert.equal(fields?.contains(source) === true, true, '「复制源码」必须在正文区工具行（pm-detail-fields）里');
  assert.equal(actions?.contains(source) === true, false, '「复制源码」不许放进底部主操作条（pm-detail-actions）');
  assert.ok(promptCopy !== null, '「复制提示词」必须还在（本阶段是并列新增）');
  assert.equal(source.className.includes('ant-btn-primary'), false, '「复制源码」不许是 primary');
  assert.equal(
    promptCopy.className.includes('ant-btn-primary'),
    true,
    '「复制提示词」仍必须是 primary —— 等级对照的基准',
  );

  const before = calls.length;
  await act(async () => {
    source.click();
  });
  await settle();
  assert.deepEqual(copied, [USER_SOURCE], `剪贴板必须是模板原文（{{}} 原样），实际 ${JSON.stringify(copied)}`);
  assert.equal(calls.length, before, `复制源码不得发任何请求，实际新增 ${JSON.stringify(calls.slice(before))}`);
});

test('AC-136 ③（B1 跟页签）：切到「系统提示词」后复制的是 system_prompt 原文', async () => {
  install();
  const copied = stubClipboard();
  await mountWorkspace();

  const tab = [...document.querySelectorAll<HTMLElement>('[data-testid="pm-detail-fields"] .ant-segmented-item')].find(
    (node) => (node.textContent ?? '').includes('系统提示词'),
  );
  assert.ok(tab !== undefined, '找不到「系统提示词」页签');
  await act(async () => {
    tab.click();
  });
  await settle();

  const before = calls.length;
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-detail-copy-source"]')?.click();
  });
  await settle();
  assert.deepEqual(copied, [SYSTEM_SOURCE], `切页签后必须复制 system_prompt 原文，实际 ${JSON.stringify(copied)}`);
  assert.equal(calls.length, before, '切页签 + 复制源码都不得发请求');
});

test('AC-136 ④⑨：含变量时「复制源码」= 原文、「复制提示词」= 渲染结果（两次剪贴板对照）', async () => {
  install();
  const copied = stubClipboard();
  await mountWorkspace();

  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-detail-copy-source"]')?.click();
  });
  await settle();

  // 「复制提示词」：含变量 ⇒ 打开填值弹窗（既有语义，不动）
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-detail-copy"]')?.click();
  });
  await waitFor(() => document.querySelector('[data-testid="pm-vars-confirm"]') !== null, '填值弹窗出现', 3000);
  const input = document.querySelector<HTMLInputElement>('[data-testid="pm-var-input-角色"]');
  assert.ok(input !== null, '找不到变量输入框');
  await act(async () => {
    setNativeValue(input, '评审');
  });
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-vars-confirm"]')?.click();
  });
  await waitFor(
    () => calls.some((call) => call.method === 'POST' && /\/api\/prompts\/\d+\/render$/.test(call.path)),
    '「复制提示词」必须走 /api/prompts/:id/render',
    3000,
  );

  assert.deepEqual(
    copied,
    [USER_SOURCE, RENDERED_USER],
    `两次剪贴板必须"源码 = 原文 / 提示词 = 渲染结果"，实际 ${JSON.stringify(copied)}`,
  );
  const renderCalls = calls.filter((call) => call.method === 'POST' && /\/api\/prompts\/\d+\/render$/.test(call.path));
  assert.equal(renderCalls.length, 1, '「复制提示词」必须恰好渲染一次');
  assert.equal(
    calls.some((call) => /\/api\/prompts\/\d+\/copy$/.test(call.path)),
    false,
    '含变量路径不该走 /copy（既有语义）',
  );
});

test('AC-136 ⑥⑪：编辑器「复制源码」有可见文字，复制的是当前编辑框内容（未保存也算）', async () => {
  install();
  const copied = stubClipboard();
  await mountWorkspace();

  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-detail-edit"]')?.click();
  });
  await waitFor(() => document.querySelector('[data-testid="editor-user-prompt"]') !== null, '编辑器出现', 3000);

  const button = document.querySelector<HTMLElement>('[data-testid="editor-copy-user"]');
  assert.ok(button !== null, '编辑器缺少字段复制入口');
  assert.equal(
    (button.textContent ?? '').includes('复制源码'),
    true,
    `字段复制必须"一眼能看出是复制"（有可见文字），实际 ${JSON.stringify(button.textContent)}`,
  );

  const box = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]');
  assert.ok(box !== null, '找不到 editor-user-prompt');
  const typed = '改了一半 {{名字}}';
  await act(async () => {
    setNativeValue(box, typed);
  });
  await settle(60);

  const before = calls.length;
  await act(async () => {
    button.click();
  });
  await settle();
  assert.deepEqual(copied, [typed], `编辑器必须复制"当前编辑框内容"，实际 ${JSON.stringify(copied)}`);
  assert.equal(calls.length, before, '编辑器复制源码不得发请求');
});

test('AC-136 ⑤⑨：不含变量时两者内容相同，但位置与等级仍不同（「复制提示词」仍记一次取用）', async () => {
  const plain = '没有变量的正文';
  // 两个字段都不能含变量：hasVariables() 会同时看 user_prompt 与 system_prompt
  install(makePrompt({ user_prompt: plain, system_prompt: '没有变量的系统提示' }));
  const copied = stubClipboard();
  await mountWorkspace();

  const fields = document.querySelector('[data-testid="pm-detail-fields"]');
  const actions = document.querySelector('[data-testid="pm-detail-actions"]');
  const source = document.querySelector<HTMLElement>('[data-testid="pm-detail-copy-source"]');
  const promptCopy = document.querySelector<HTMLElement>('[data-testid="pm-detail-copy"]');
  assert.ok(source !== null && promptCopy !== null, '两个入口都必须存在');

  // 位置与等级：与含变量时同款判据（⑤ 的"仍不同"这一半）
  assert.equal(fields?.contains(source) === true, true, '「复制源码」必须在正文区工具行里');
  assert.equal(actions?.contains(source) === true, false, '「复制源码」不许进底部主操作条');
  assert.equal(source.className.includes('ant-btn-primary'), false, '「复制源码」不许是 primary');
  assert.equal(promptCopy.className.includes('ant-btn-primary'), true, '「复制提示词」仍必须是 primary');

  const before = calls.length;
  await act(async () => {
    source.click();
  });
  await settle();
  assert.deepEqual(copied, [plain], `不含变量时「复制源码」= 正文原文，实际 ${JSON.stringify(copied)}`);
  assert.equal(calls.length, before, `复制源码不得发任何请求，实际新增 ${JSON.stringify(calls.slice(before))}`);

  // ⑤ 的另一半 + ⑨：「复制提示词」不含变量 ⇒ 直接复制正文、仍记一次取用（既有语义不动）
  await act(async () => {
    promptCopy.click();
  });
  await waitFor(
    () => calls.some((call) => call.method === 'POST' && /\/api\/prompts\/\d+\/copy$/.test(call.path)),
    '「复制提示词」必须记一次取用（/api/prompts/:id/copy）',
    3000,
  );
  assert.deepEqual(copied, [plain, plain], `不含变量时两者内容相同，实际 ${JSON.stringify(copied)}`);
});
