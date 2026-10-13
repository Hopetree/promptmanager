/**
 * 常驻回归（阶段 73 / FR-160 / AC-135 A1）—— 编辑器"八字段齐全"的**渲染级**断言。
 *
 * 为什么要有这条（N19，major）：`tests/web-ui.test.ts` 原来对八个字段名做**裸子串**断言
 * （`assertIn(..., key)`）—— 字段名出现在**注释或类型**里就能过。评审在副本里删掉**唯一的**
 * `<Form.Item name="tags"><Select mode="tags">` 后，`npm test` 仍然全绿。
 *
 * 这里的判据是「**删掉真控件必须变红**」：真实挂载 `Workspace` → 打开编辑器 → 在**渲染出来的 DOM** 上
 * 断言八个字段的**标签文本**与**控件类型**都在（标签是用户可见文本，删掉 Form.Item 就没了）。
 * 对应的源码级结构断言在 `tests/web-ui.test.ts`（`Form.Item name=` + 控件类型，同一条判据的静态半边）。
 */
import { element, mountRegistry, releaseLoaderPort, route, waitFor } from './harness.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function makePrompt(id: number, title: string, body: string): Prompt {
  return {
    id,
    title,
    user_prompt: body,
    system_prompt: '系统角色',
    notes: '备注内容',
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
  route('GET', /^\/api\/prompts$/, () => ({
    status: 200,
    body: { total: 1, limit: 20, offset: 0, items: [makePrompt(1, '甲', '正文甲')] },
  }));
  route('GET', /^\/api\/prompts\/\d+$/, () => ({ status: 200, body: makePrompt(1, '甲', '正文甲') }));
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts\/\d+\/variables$/, () => ({
    status: 200,
    body: { variables: [], defaults: {} },
  }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>m</p>' } }));
}

/** 八个可写字段：`label` 是**渲染出来的标签文本**，`probe` 是控件类型的存在性判据。 */
interface EditorField {
  name: string;
  label: string;
  probe: (form: Element) => boolean;
}

const textareaCount = (form: Element): number => form.querySelectorAll('textarea').length;

const EDITOR_FIELDS: readonly EditorField[] = [
  { name: 'title', label: '标题', probe: (form) => form.querySelector('[data-testid="editor-title"]') !== null },
  {
    name: 'user_prompt',
    label: '用户提示词（user_prompt）',
    probe: (form) => form.querySelector('[data-testid="editor-user-prompt"]') !== null,
  },
  // 用户 / 系统 / 备注 = 恰好 3 个 textarea：删掉任意一个都会掉到 2
  { name: 'system_prompt', label: '系统提示词（system_prompt）', probe: (form) => textareaCount(form) === 3 },
  { name: 'notes', label: '备注（notes）', probe: (form) => textareaCount(form) === 3 },
  { name: 'folder_id', label: '文件夹', probe: (form) => form.querySelector('.ant-select:not(.ant-select-multiple)') !== null },
  // tags 是 `mode="tags"` ⇒ antd 渲染 `ant-select-multiple`（唯一的单选/多选区分点）
  { name: 'tags', label: '标签', probe: (form) => form.querySelector('.ant-select-multiple') !== null },
  { name: 'favorite', label: '收藏（置顶到列表）', probe: (form) => form.querySelector('[data-testid="editor-favorite"]') !== null },
  {
    name: 'remember_variables',
    label: '记住变量值（下次自动填充）',
    probe: (form) => form.querySelector('[data-testid="editor-remember-variables"]') !== null,
  },
];

/** 挂 Workspace（分栏）→ 右栏「编辑」→ 返回编辑器**表单**元素（文档顺序上第一个 `form.ant-form`）。 */
async function openEditorForm(): Promise<Element> {
  install();
  await mountTracked(
    element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(Workspace, {
      themeMode: 'light',
      onCycleTheme: () => undefined,
      onSignedOut: () => undefined,
    }))),
  );
  await waitFor(() => document.querySelector('[data-testid="pm-detail-edit"]') !== null, '详情编辑按钮出现', 3000);
  await act(async () => {
    document.querySelector<HTMLElement>('[data-testid="pm-detail-edit"]')?.click();
  });
  await waitFor(() => document.querySelector('[data-testid="editor-user-prompt"]') !== null, '编辑器出现', 3000);
  const form = document.querySelector('[data-testid="pm-editor"] form.ant-form');
  assert.ok(form !== null, '编辑器里必须渲染出 antd Form');
  return form;
}

test('AC-135 A1：编辑器八字段在**渲染出来的 DOM** 里齐全（删掉任一控件必红）', async () => {
  const form = await openEditorForm();

  const labels = [...form.querySelectorAll('.ant-form-item-label')].map((node) => (node.textContent ?? '').trim());
  for (const field of EDITOR_FIELDS) {
    assert.ok(
      labels.some((text) => text.includes(field.label)),
      `缺少字段「${field.name}」的标签「${field.label}」（实际标签：${labels.join(' | ')}）`,
    );
    assert.ok(field.probe(form), `字段「${field.name}」的控件不在 DOM 里（判据见本文件 EDITOR_FIELDS）`);
  }

  // 结构下界：八个 Form.Item 一个都不能少（删掉整块 Form.Item 时上面已经红，这里给"数量"再钉一次）
  assert.equal(
    form.querySelectorAll('.ant-form-item').length,
    EDITOR_FIELDS.length,
    `编辑器表单必须恰好 ${String(EDITOR_FIELDS.length)} 个 Form.Item`,
  );
});

test('AC-135 A1：标签控件必须是 antd Select 多选（静态半边，与 tests/web-ui.test.ts 同一判据）', () => {
  const source = readFileSync(new URL('../../web/src/components/PromptEditor.tsx', import.meta.url), 'utf8');
  const block = source.match(/<Form.Item\b[\s\S]*?name="tags"[\s\S]*?<\/Form.Item>/)?.[0] ?? '';
  assert.ok(block !== '', 'PromptEditor.tsx 里必须有 name="tags" 的 Form.Item');
  assert.match(block, /mode="tags"/, '标签控件必须是 antd Select 的多选（mode="tags"）');
});
