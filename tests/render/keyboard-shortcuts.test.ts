/**
 * 返工②（第三轮审视 M1 / M2）—— 两条都违反**既有**契约，不是新需求：
 *
 * - **M1**：编辑器里有未保存改动时按 `Ctrl/Cmd+K` 或 `/` ⇒ 直接切回列表、编辑器被卸载、改动静默丢失。
 *   根因：这两条快捷键自己 `setView('list')`，**没有**经过 `requestLeave()` 那道闸门
 *   （阶段 71 返工① 的同类漏项：§9.16 路径审计表里 11 条路径都判"已过闸"，而这两条根本不调 `closeEditor`）。
 *   契约：FR-152「切换/关闭必须先告知并确认，不许静默丢弃」。
 *
 * - **M2**：分栏视图里 `↑↓` 只改 `activeIndex`，而分栏的高亮与右栏都取自 `selectedId`
 *   ⇒ 按了**没有任何反馈**；`Enter` 取 `list[activeIndex]` ⇒ 右栏显示乙、复制的却是甲，
 *   还向服务端记了一次**假的取用**（`POST /api/prompts/1/copy`）。
 *   契约：`Workspace.tsx` 自己写的「↑↓ 选择 · Enter 复制」+ AGENTS.md「取用 = 真实使用」。
 *
 * 判据：M1 必须出现「放弃修改」确认（要么保存、要么确认）；M2 光标与界面同源、Enter 复制所见的那条。
 */
import './dom-env.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import { calls, element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor } from './harness.ts';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

const { mountTracked, unmountAll } = mountRegistry();

afterEach(() => {
  unmountAll();
  // 视口宽度是全局的：移动端用例跑完必须还原，否则后面的用例被带着变窄
  window.innerWidth = 1440;
});

after(() => {
  releaseLoaderPort();
});

const TYPED = '我改了一半还没保存';

function makePrompt(id: number, title: string, body: string): Prompt {
  return {
    id,
    title,
    user_prompt: body,
    system_prompt: '',
    notes: '',
    folder_id: null,
    tags: [],
    favorite: false,
    remember_variables: false,
    created_at: '2026-10-13T00:00:00.000Z',
    updated_at: '2026-10-13T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
  };
}

function install(): void {
  route('GET', /^\/api\/me$/, () => ({ status: 200, body: { username: 'admin' } }));
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts$/, () => ({
    status: 200,
    body: {
      total: 2,
      limit: 20,
      offset: 0,
      items: [makePrompt(1, '甲', '正文甲'), makePrompt(2, '乙', '正文乙')],
    },
  }));
  route('GET', /^\/api\/prompts\/\d+$/, (request) => {
    const id = Number(request.path.split('/').pop());
    return { status: 200, body: makePrompt(id, id === 1 ? '甲' : '乙', id === 1 ? '正文甲' : '正文乙') };
  });
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({ status: 200, body: { items: [] } }));
  route('POST', /^\/api\/prompts\/\d+\/copy$/, () => ({ status: 204, body: {} }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>m</p>' } }));
}

/** jsdom 没有 async clipboard：让 `clipboard.ts` 的 `execCommand` 兜底成功，`copyPrompt` 才会走到记账那一步。 */
function stubClipboard(): void {
  (document as Document & { execCommand?: (command: string) => boolean }).execCommand = (): boolean => true;
}

async function settle(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
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
  await waitFor(
    () => document.querySelectorAll('[data-testid="pm-split-item"]').length === 2,
    '分栏两条 prompt 出现',
    3000,
  );
}

/** 真键盘事件（落在 window 上 ⇒ `event.target` 不是输入控件，走的就是全局快捷键分支）。 */
function pressKey(init: KeyboardEventInit): void {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function editorValue(): string {
  const box = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]');
  return box === null ? '(editor gone)' : box.value;
}

function typeIntoEditor(text: string): void {
  const box = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]');
  assert.ok(box !== null, '编辑器输入框不在');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(box, text);
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** 分栏里被高亮的那条（SplitView 的 `data-selected` 就是界面上的"当前项"）。 */
function selectedItemText(): string {
  const node = document.querySelector('[data-testid="pm-split-item"][data-selected="true"]');
  return node?.textContent ?? '(none)';
}

async function openEditorFromDetail(): Promise<void> {
  const edit = document.querySelector<HTMLButtonElement>('[data-testid="pm-detail-edit"]');
  assert.ok(edit !== null, '详情「编辑」按钮不在');
  await act(async () => {
    edit.click();
  });
  await waitFor(() => document.querySelector('[data-testid="editor-user-prompt"]') !== null, '编辑器出现', 3000);
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.localStorage.setItem('pm-view-mode', 'split');
});

test('返工② M1：编辑器有未保存改动时按 Ctrl+K 必须出现「放弃修改」确认（不许直接切走）', async () => {
  install();
  stubClipboard();
  await mountWorkspace();
  await openEditorFromDetail();
  await act(async () => {
    typeIntoEditor(TYPED);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.equal(editorValue(), TYPED, '前提不成立：改动没进编辑器');

  await act(async () => {
    pressKey({ key: 'k', ctrlKey: true });
  });
  await settle(120);

  assert.equal(
    editorValue().includes(TYPED),
    true,
    `Ctrl+K 把未保存内容丢了：editor=${editorValue()}`,
  );
  assert.ok(
    document.querySelector('[data-testid="pm-unsaved-confirm"]') !== null,
    'Ctrl+K 既没保存也没出现确认（FR-152：不许静默丢弃）',
  );
});

test('返工② M1：编辑器有未保存改动时按 `/` 也必须出现确认', async () => {
  install();
  await mountWorkspace();
  await openEditorFromDetail();
  await act(async () => {
    typeIntoEditor(TYPED);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await act(async () => {
    pressKey({ key: '/' });
  });
  await settle(120);

  assert.equal(editorValue().includes(TYPED), true, `\`/\` 把未保存内容丢了：editor=${editorValue()}`);
  assert.ok(
    document.querySelector('[data-testid="pm-unsaved-confirm"]') !== null,
    '`/` 既没保存也没出现确认（FR-152：不许静默丢弃）',
  );
});

test('返工② M1（阴性对照）：没有未保存改动时 Ctrl+K 直接回列表、不弹确认', async () => {
  install();
  await mountWorkspace();
  await openEditorFromDetail();

  await act(async () => {
    pressKey({ key: 'k', ctrlKey: true });
  });
  await settle(120);

  assert.equal(document.querySelector('[data-testid="pm-unsaved-confirm"]'), null, '没有改动时不该弹确认');
  assert.equal(editorValue(), '(editor gone)', '没有改动时 Ctrl+K 应当直接切回列表（编辑器卸载）');
});

test('返工② M2：分栏里 ↑↓ 必须让高亮跟着动（现在按了没反馈）', async () => {
  install();
  await mountWorkspace();
  assert.equal(selectedItemText().includes('甲'), true, `初始高亮应为第一条（甲）：${selectedItemText()}`);

  await act(async () => {
    pressKey({ key: 'ArrowDown' });
  });
  await settle(80);
  assert.equal(selectedItemText().includes('乙'), true, `↑↓ 没有把高亮移到乙（界面没反馈）：当前=${selectedItemText()}`);

  await act(async () => {
    pressKey({ key: 'ArrowUp' });
  });
  await settle(80);
  assert.equal(selectedItemText().includes('甲'), true, `↑ 没有把高亮移回甲：当前=${selectedItemText()}`);
});

test('返工② M2：分栏里 Enter 复制的必须是界面显示的那条（否则记一次假取用）', async () => {
  install();
  stubClipboard();
  await mountWorkspace();
  const items = document.querySelectorAll<HTMLElement>('[data-testid="pm-split-item"]');
  await act(async () => {
    items[1]?.click();
  });
  await settle(200);
  assert.equal(selectedItemText().includes('乙'), true, '前提不成立：界面当前项应是乙');
  assert.equal(
    calls.filter((request) => request.path === '/api/prompts/1/copy').length,
    0,
    '前提不成立：还没按 Enter 就已经记了取用',
  );

  await act(async () => {
    pressKey({ key: 'Enter' });
  });
  await settle(120);

  const copied = calls.filter((request) => request.method === 'POST' && request.path.endsWith('/copy')).map((r) => r.path);
  assert.deepEqual(
    copied,
    ['/api/prompts/2/copy'],
    `Enter 复制了界面看不见的那条（记了假取用）：${JSON.stringify(copied)}`,
  );
});

test('返工② M1（移动端 Drawer）：`view` 仍是 list 但编辑器开着时按 `/` 也必须出现确认', async () => {
  install();
  window.innerWidth = 440;
  await mountWorkspace();
  const item = document.querySelector<HTMLElement>('[data-testid="pm-split-item"]');
  await act(async () => {
    item?.click();
  });
  await waitFor(() => document.querySelector('[data-testid="pm-detail-edit"]') !== null, '移动端详情出现', 3000);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="pm-detail-edit"]')?.click();
  });
  await waitFor(
    () => document.querySelector('[data-testid="editor-user-prompt"]') !== null,
    '移动端编辑器 Drawer 出现',
    3000,
  );
  await act(async () => {
    typeIntoEditor(TYPED);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.equal(editorValue(), TYPED, '前提不成立：改动没进 Drawer 编辑器');

  await act(async () => {
    pressKey({ key: '/' });
  });
  await settle(120);

  assert.equal(editorValue().includes(TYPED), true, `移动端 \`/\` 把未保存内容丢了：editor=${editorValue()}`);
  assert.ok(
    document.querySelector('[data-testid="pm-unsaved-confirm"]') !== null,
    '移动端 Drawer 开着时 `/` 没出现确认（`view` 是 list 但 `editorOpen` 为真）',
  );
});
