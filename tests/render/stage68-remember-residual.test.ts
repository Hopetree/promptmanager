/**
 * 阶段 68 / FR-143（AC-130 ⑬⑭⑮，渲染级）：关掉「记住变量值」必须清掉**本地残留**。
 *
 * 问题（设计评审 F18）：三个记忆 helper 只在填值弹窗里被调用，编辑页保存 `remember_variables`
 * 时完全不碰 `localStorage` ⇒ 从编辑页关掉开关后，`pm-vars:<id>` 里那份旧值仍然躺着，
 * 下次（万一）重新勾上就"诈尸"。两条入口都要清：编辑页开关（⑬）与弹窗勾选框（⑭）。
 */
// ⚠️ `./harness.ts` 必须**第一个**被 import（它要在 `react-dom` 求值前把 jsdom 全局装好）。
import { byTestId, element, mount, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: PromptEditor } = await import('../../web/src/components/PromptEditor.tsx');
const { default: VarsDialog } = await import('../../web/src/components/VarsDialog.tsx');

after(() => {
  releaseLoaderPort();
});

const KEY = 'pm-vars:1';
const STORED = JSON.stringify({ 项目: '旧记忆甲' });

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 1,
    title: '记忆夹具',
    user_prompt: '{{项目}}',
    system_prompt: '',
    notes: '',
    folder_id: null,
    tags: [],
    favorite: false,
    remember_variables: true,
    created_at: '2026-10-12T00:00:00.000Z',
    updated_at: '2026-10-12T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
    ...overrides,
  };
}

function installCommonRoutes(): void {
  route('GET', /^\/api\/prompts\/\d+\/variables$/, () => ({
    status: 200,
    body: { variables: ['项目'], defaults: {} },
  }));
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({ status: 200, body: { items: [] } }));
  route('POST', /^\/api\/render\/markdown$/, (request) => ({
    status: 200,
    body: { html: `<p>${(request.body as { markdown?: string } | undefined)?.markdown ?? ''}</p>` },
  }));
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
});

async function click(testid: string): Promise<void> {
  await act(async () => {
    byTestId(testid).click();
  });
}

async function mountEditor(): Promise<Mounted> {
  installCommonRoutes();
  route('PUT', /^\/api\/prompts\/\d+$/, (request) => {
    const patch = (request.body ?? {}) as Partial<Prompt>;
    return { status: 200, body: { ...makePrompt(), ...patch, version_no: 2 } };
  });
  const mounted = await mount(
    element(AntdApp, {}, element(PromptEditor, {
      prompt: makePrompt(),
      isNew: false,
      origin: 'list',
      onToggleFavorite: () => undefined,
      folders: [],
      tags: [],
      isMobile: false,
      onClose: () => undefined,
      onBackToDetail: () => undefined,
      onSaved: () => undefined,
      onDeleted: () => undefined,
      onCopyText: () => undefined,
      fullscreen: false,
      onToggleFullscreen: () => undefined,
    })),
  );
  await waitFor(() => document.querySelector('[data-testid="editor-remember-variables"]') !== null, '记住变量值开关应渲染出来');
  return mounted;
}

test('AC-130 ⑬：编辑页关掉「记住变量值」并保存 ⇒ pm-vars:<id> 被删（真渲染 + 真点击）', async () => {
  window.localStorage.setItem(KEY, STORED);
  const mounted = await mountEditor();
  try {
    // 开关当前是"记住"（来自 prompt.remember_variables = true）
    assert.equal(byTestId('editor-remember-variables').getAttribute('aria-checked'), 'true');
    assert.equal(window.localStorage.getItem(KEY), STORED, '前置：本地有旧记忆');

    await click('editor-remember-variables'); // 关掉
    await waitFor(() => byTestId('editor-remember-variables').getAttribute('aria-checked') === 'false', '开关应变成"不记住"');
    await click('editor-save');
    await waitFor(() => window.localStorage.getItem(KEY) === null, '保存后本地记忆必须被删掉');
    assert.equal(window.localStorage.getItem(KEY), null, '关掉开关 ⇒ pm-vars:1 必须消失（FR-143 ①）');
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑬（反向）：开关保持「记住」并保存 ⇒ 本地记忆不得被误删', async () => {
  window.localStorage.setItem(KEY, STORED);
  const mounted = await mountEditor();
  try {
    assert.equal(byTestId('editor-remember-variables').getAttribute('aria-checked'), 'true');
    await click('editor-save');
    await waitFor(() => document.querySelector('.ant-message-notice') !== null, '保存后应有提示');
    assert.equal(window.localStorage.getItem(KEY), STORED, '记住时不许动本地记忆（否则就是"修好一个、弄坏另一个"）');
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑭：弹窗里取消勾选 ⇒ 立刻删掉本地记忆（既有行为不回归）', async () => {
  window.localStorage.setItem(KEY, STORED);
  installCommonRoutes();
  const changes: boolean[] = [];
  const mounted = await mount(
    element(AntdApp, {}, element(VarsDialog, {
      prompt: makePrompt(),
      busy: false,
      onCancel: () => undefined,
      onConfirm: () => undefined,
      onRememberChange: (_prompt: Prompt, remember: boolean) => {
        changes.push(remember);
      },
    })),
  );
  try {
    await waitFor(() => document.querySelector('[data-testid="pm-vars-remember"]') !== null, '勾选框应渲染出来');
    // 勾选态来自服务端字段；预填也来自记忆（说明前置状态是"真的记住了"）
    await waitFor(() => (byTestId('pm-var-input-项目') as HTMLInputElement).value === '旧记忆甲', '记忆里的值应被预填');
    await click('pm-vars-remember');
    await waitFor(() => window.localStorage.getItem(KEY) === null, '取消勾选应立刻删掉本地记忆');
    assert.deepEqual(changes, [false], '取消勾选要通知调用方写服务端（onRememberChange）');
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑮（源码级）：两条入口都调用同一个删除 helper（编辑页 + 弹窗）', async () => {
  const { readWebSource } = await import('../source-text.ts');
  const editor = readWebSource('components/PromptEditor.tsx');
  const dialog = readWebSource('components/VarsDialog.tsx');
  assert.match(editor, /if \(payload\.remember_variables === false\) removeRememberedVars\(updated\.id\)/, '编辑页保存路径要删残留');
  assert.match(dialog, /if \(!next\) removeRememberedVars\(prompt\.id\)/, '弹窗取消勾选要删残留');
  assert.match(dialog, /removeRememberedVars\(prompt\.id\)/, '弹窗「清空」/「复制结果」也要删残留');
});
