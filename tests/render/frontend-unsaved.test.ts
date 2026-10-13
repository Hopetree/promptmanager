/**
 * 常驻回归（阶段 71 / FR-152 / AC-133 B6·B7·B8·B9）。
 *
 * 判据：**绝不允许"内容没了且无任何提示"** —— 改了内容再切换 / 关闭，必须"要么保存、要么出现确认"；
 * 输入控件里按 Esc 不得直接关掉编辑器（`typing` 守卫顺序）；`beforeunload` 必须被拦；
 * 草稿徽标要覆盖"改了一半的既有 prompt"。
 *
 * 来源：`var/review-2/frontend-unsaved.test.ts`（评审探针，改前 fail）。原探针的两条断言原样保留。
 */
import { calls, element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

const TYPED = '我改了一半还没保存';

/** 断言中途失败也要卸载：否则上一棵 DOM 会留给下一条用例（详见 harness 的 mountRegistry）。 */
const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function makePrompt(id: number, title: string, body: string): Prompt {
  return {
    id, title, user_prompt: body, system_prompt: '', notes: '', folder_id: null, tags: [],
    favorite: false, remember_variables: true,
    created_at: '2026-10-11T00:00:00.000Z', updated_at: '2026-10-11T00:00:00.000Z',
    version_no: 1, use_count: 0, last_used_at: null,
  };
}

function install(): void {
  route('GET', /^\/api\/me$/, () => ({ status: 200, body: { username: 'admin' } }));
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts$/, () => ({
    status: 200,
    body: { total: 2, limit: 20, offset: 0, items: [makePrompt(1, '甲', '正文甲'), makePrompt(2, '乙', '正文乙')] },
  }));
  route('GET', /^\/api\/prompts\/\d+$/, (request) => ({ status: 200, body: makePrompt(Number(request.path.split('/').pop()), '?', '?') }));
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({ status: 200, body: { items: [] } }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>m</p>' } }));
}

/** 分栏 → 右栏「编辑」→ 把正文改成 TYPED（半半未保存）。 */
async function openEditorAndType(): Promise<Mounted> {
  const mounted = await mountTracked(
    element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(Workspace, {
      themeMode: 'light', onCycleTheme: () => undefined, onSignedOut: () => undefined,
    }))),
  );
  await waitFor(() => document.querySelectorAll('[data-testid="pm-split-item"]').length === 2, '分栏 2 条', 3000);
  await waitFor(() => document.querySelector('[data-testid="pm-detail-edit"]') !== null, '详情编辑按钮出现', 3000);
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-detail-edit"]')?.click();
  });
  await waitFor(() => document.querySelector('[data-testid="editor-user-prompt"]') !== null, '编辑器出现', 3000);
  await typeIntoEditor(TYPED);
  return mounted;
}

async function typeIntoEditor(text: string): Promise<void> {
  const box = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]');
  assert.ok(box !== null, '找不到 editor-user-prompt');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(box, text);
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function editorBody(): string {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]')?.value ?? '(editor gone)';
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.localStorage.setItem('pm-view-mode', 'split');
});

test('常驻（原探针）：切换左栏条目不静默丢弃未保存编辑，出现确认且内容仍在', async () => {
  install();
  const mounted = await openEditorAndType();
  const before = editorBody();
  assert.equal(before.includes(TYPED), true, `前置不成立：打字没进表单 ${JSON.stringify(before)}`);

  // 点编辑器左栏的另一条（Workspace.openEditor → 换编辑对象）
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-editor-list-item-2"]')?.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  const after = editorBody();
  assert.notEqual(after, '(editor gone)', '编辑器被直接关掉了');
  // 原探针断言（原样保留）：内容不许静默消失
  assert.equal(after.includes(TYPED), true, `未保存编辑已丢失：before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  // 新增：而且必须先出现确认（AC-133 B6「要么保存、要么出现确认」）
  assert.ok(
    document.querySelector('[data-testid="pm-unsaved-confirm"]') !== null,
    '切换左栏条目时既没有保存、也没有出现确认',
  );
});

test('常驻：确认里的「放弃修改」不是死路 —— 放弃后真的切到那一条', async () => {
  install();
  const mounted = await openEditorAndType();
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-editor-list-item-2"]')?.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const discard = document.querySelector<HTMLButtonElement>('[data-testid="pm-unsaved-discard"]');
  assert.ok(discard !== null, '确认弹窗里没有「放弃修改」');
  await act(async () => {
    discard.click();
  });
  await waitFor(
    () => document.querySelector<HTMLInputElement>('[data-testid="editor-title"]')?.value === '?',
    '放弃修改后切到左栏点的那条',
    3000,
  );
  assert.equal(document.querySelector('[data-testid="pm-unsaved-confirm"]'), null, '确认弹窗没有关闭');
  assert.equal(
    calls.filter((c) => c.method === 'PUT' || c.method === 'POST').some((c) => c.path === '/api/prompts/1'),
    false,
    '「放弃修改」不得偷偷保存',
  );
});

test('常驻：Esc 关闭编辑器前必须确认（非输入区按 Esc）', async () => {
  install();
  const mounted = await openEditorAndType();
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert.ok(
    document.querySelector('[data-testid="pm-unsaved-confirm"]') !== null,
    '按 Esc 关闭编辑器时既没有保存、也没有出现确认（未保存内容被静默丢弃）',
  );
  assert.equal(editorBody().includes(TYPED), true, '按 Esc 后未保存内容已经没了');
});

test('常驻：输入控件（textarea）里按 Esc 不得关掉编辑器（typing 守卫顺序）', async () => {
  install();
  const mounted = await openEditorAndType();
  const box = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]');
  assert.ok(box !== null, '找不到 editor-user-prompt');
  box.focus();
  await act(async () => {
    box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert.ok(
    document.querySelector('[data-testid="editor-user-prompt"]') !== null,
    '在输入框（textarea）里按 Esc 直接关掉了编辑器（typing 守卫顺序 bug）',
  );
  assert.equal(
    document.querySelector('[data-testid="pm-unsaved-confirm"]'),
    null,
    '在输入框里按 Esc 弹出了「放弃修改」确认（输入控件内 Esc 语义错误）',
  );
  assert.equal(editorBody().includes(TYPED), true, '输入框里按 Esc 后未保存内容没了');
});

test('常驻：有未保存修改时 beforeunload 被拦下', async () => {
  install();
  await openEditorAndType();

  const dirtyEvent = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirtyEvent);
  assert.equal(dirtyEvent.defaultPrevented, true, '有未保存修改时 beforeunload 没有被拦下');
});

test('常驻（阴性对照）：没有未保存修改时 beforeunload 不许拦', async () => {
  install();
  // 独立用例、独立挂载：上一个用例的 dirty 监听已经随 unmountAll 一起卸载
  await mountTracked(
    element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(Workspace, {
      themeMode: 'light', onCycleTheme: () => undefined, onSignedOut: () => undefined,
    }))),
  );
  await waitFor(() => document.querySelectorAll('[data-testid="pm-split-item"]').length === 2, '分栏 2 条', 3000);
  const cleanEvent = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanEvent);
  assert.equal(cleanEvent.defaultPrevented, false, '没有未保存修改时 beforeunload 也被拦下了（误拦）');
});

test('常驻：草稿徽标覆盖"改了一半的既有 prompt"', async () => {
  install();
  const mounted = await openEditorAndType();
  assert.ok(
    document.querySelector('[data-testid="editor-dirty-badge"]') !== null,
    '既有 prompt 改了一半却没有「未保存」徽标（FR-152 ② / AC-133 B9）',
  );
  // 保存一次（PUT /api/prompts/1）→ 徽标必须消失（否则"未保存"提示不可信）
  route('PUT', /^\/api\/prompts\/\d+$/, () => ({ status: 200, body: makePrompt(1, '甲', TYPED) }));
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click();
  });
  await waitFor(
    () => document.querySelector('[data-testid="editor-dirty-badge"]') === null,
    '保存后「未保存」徽标消失',
    3000,
  );
});

test('常驻（C11）：界面往 localStorage 写的键只有白名单，没有任何凭据', async () => {
  install();
  await openEditorAndType();

  // 白名单 = 应用自己声明的偏好与记忆（`pm-theme` / `pm-use-sort` / `pm-view-mode` /
  // `pm-pin-favorites` / `pm-vars:<id>` / `pm-vnote:<id>:<version>`）；别的键一律不许出现。
  const allowed = /^pm-(theme|use-sort|view-mode|pin-favorites|vars:\d+|vnote:\d+:\d+)$/;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    keys.push(window.localStorage.key(index) ?? '');
  }
  for (const key of keys) {
    assert.ok(allowed.test(key), `localStorage 出现白名单外的键：${key}（凭据不许进 localStorage，AC-133 C11）`);
  }
  // 阴性对照必须真的走过了写路径：挂载 + 进编辑器后至少要落一个偏好键（否则"没违规"是假的）
  assert.ok(keys.includes('pm-view-mode'), `没有任何偏好键落盘 —— 这条检查没覆盖到真实路径：${keys.join(',')}`);
});
