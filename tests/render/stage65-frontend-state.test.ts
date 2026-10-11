/**
 * 阶段 65 渲染级用例（FR-136 / FR-137 / AC-127 A–D 组）。
 *
 * 为什么这些用例必须"渲染级"：这两个 bug 的形态都是**同一份数据的多个副本不同步** ——
 * 表单值、分栏右栏、详情、列表项各自拿着一个旧对象。源码级断言（正则找某个 `setXxx(`）
 * 根本看不见这种不同步；只有真的把组件挂起来、改表单、点按钮，才能断言"屏幕上显示的是什么"。
 *
 * 基建在 `./harness.ts`（jsdom + react-dom/client + 假 fetch），`.tsx` 由 `tools/tsx-loader.mjs` 转译。
 * 每个用例都用一个**假服务端**（`state.prompts`）：PUT 会真的改掉它，GET 会真的返回改后的值 ——
 * 这样"右栏是不是拿到了最新数据"才有意义。
 */
// ⚠️ `./harness.ts` 必须**第一个**被 import：它要在 `react-dom` 求值之前把 jsdom 的
// `window`/`document` 装成全局 —— 否则 react-dom 会在 `canUseDOM === false` 下初始化，
// 之后真的派发 input 事件时会走 IE 兜底分支，炸 `activeElement.attachEvent is not a function`。
import { byTestId, element, mount, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

// 让 `node --test` 能在最后一条用例之后自己退出（详见 `releaseLoaderPort` 的注释）。
after(() => {
  releaseLoaderPort();
});

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 1,
    title: '第一条',
    user_prompt: '正文一',
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
    ...overrides,
  };
}

/** 版本历史里的一条（`VersionSummary` 没有正文，所以多带一份 `user_prompt` 供回滚用）。 */
interface FakeVersion {
  version_no: number;
  created_at: string;
  title: string;
  user_prompt: string;
}

/** 假服务端：`PUT` 真的改这里，`GET` 真的读这里。 */
interface ServerState {
  prompts: Prompt[];
  /** `GET /api/prompts/:id/versions` 的内容；缺省为空（多数用例用不到版本历史）。 */
  versions?: FakeVersion[];
}

function findById(state: ServerState, id: number): Prompt | undefined {
  return state.prompts.find((prompt) => prompt.id === id);
}

function installRoutes(state: ServerState): void {
  route('GET', /^\/api\/prompts$/, () => ({
    status: 200,
    body: { total: state.prompts.length, limit: 20, offset: 0, items: state.prompts },
  }));
  route('GET', /^\/api\/prompts\/\d+$/, (request) => {
    const id = Number(request.path.split('/').pop());
    const found = findById(state, id);
    return found === undefined
      ? { status: 404, body: { error: 'not_found' } }
      : { status: 200, body: found };
  });
  route('PUT', /^\/api\/prompts\/\d+$/, (request) => {
    const id = Number(request.path.split('/').pop());
    const index = state.prompts.findIndex((prompt) => prompt.id === id);
    const before = state.prompts[index];
    if (before === undefined) return { status: 404, body: { error: 'not_found' } };
    const patch = (request.body ?? {}) as Partial<Prompt>;
    const updated: Prompt = {
      ...before,
      ...patch,
      version_no: before.version_no + 1,
      updated_at: '2026-10-11T01:00:00.000Z',
    };
    state.prompts[index] = updated;
    return { status: 200, body: updated };
  });
  route('GET', /^\/api\/prompts\/\d+\/variables$/, () => ({
    status: 200,
    body: { variables: [], defaults: {} },
  }));
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({
    status: 200,
    body: {
      items: (state.versions ?? []).map(({ version_no, created_at, title }) => ({ version_no, created_at, title })),
    },
  }));
  // 回滚：把目标版本那一条的正文写回当前 prompt（`version_no` 前进一格），并返回**完整**的 prompt。
  route('POST', /^\/api\/prompts\/\d+\/versions\/\d+\/rollback$/, (request) => {
    const segments = request.path.split('/');
    const id = Number(segments[3]);
    const versionNo = Number(segments[5]);
    const index = state.prompts.findIndex((prompt) => prompt.id === id);
    const before = state.prompts[index];
    const target = (state.versions ?? []).find((version) => version.version_no === versionNo);
    if (before === undefined || target === undefined) return { status: 404, body: { error: 'not_found' } };
    const updated: Prompt = {
      ...before,
      user_prompt: target.user_prompt,
      version_no: before.version_no + 1,
      updated_at: '2026-10-11T02:00:00.000Z',
    };
    state.prompts[index] = updated;
    return { status: 200, body: updated };
  });
  // 详情与编辑器里的 Markdown 预览会 POST 到这里；不注册的话详情正文会显示 `HTTP 404 not_found`。
  route('POST', /^\/api\/render\/markdown$/, (request) => {
    const markdown = (request.body as { markdown?: string } | undefined)?.markdown ?? '';
    return { status: 200, body: { html: `<p>${markdown}</p>` } };
  });
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
});

/** 挂起整个 Workspace（桌面宽度 1024 ⇒ 非移动端），并等到分栏视图与右栏详情都渲染出来。 */
async function openWorkspace(state: ServerState): Promise<Mounted> {
  installRoutes(state);
  window.localStorage.setItem('pm-view-mode', 'split');
  const mounted = await mount(
    element(AntdApp, {}, element(Workspace, {
      themeMode: 'light',
      onCycleTheme: () => undefined,
      onSignedOut: () => undefined,
    })),
  );
  await waitFor(
    () => document.querySelector('[data-testid="pm-view-split"]') !== null,
    '分栏视图应渲染出来',
  );
  await waitFor(
    () => document.querySelector('[data-testid="pm-detail-body"]') !== null,
    '右栏详情应渲染出来（分栏会自动选中第一条）',
  );
  return mounted;
}

/** 点一个元素（包在 `act` 里，让 antd/React 的更新算作"测试内的更新"）。 */
async function click(testid: string): Promise<void> {
  await act(async () => {
    byTestId(testid).click();
  });
}

/** 从分栏右栏的「去编辑」进编辑器。 */
async function openEditorFromDetail(): Promise<void> {
  await click('pm-detail-edit');
  await waitFor(
    () => document.querySelector('[data-testid="editor-user-prompt"]') !== null,
    '编辑器表单应渲染出来',
  );
}

/** 往受控输入框里写字（绕过 React 的 value tracker，模拟真人输入）。 */
async function typeInto(testid: string, value: string): Promise<void> {
  await act(async () => {
    const field = byTestId(testid) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    assert.ok(setter !== undefined, 'textarea 必须有原生 value setter');
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function valueOf(testid: string): string {
  return (byTestId(testid) as HTMLTextAreaElement).value;
}

/**
 * 版本面板默认停在「对比版本」视图，而「回滚」按钮只在「表格」视图的操作列里 ⇒ 先切页签。
 * （antd 的 Segmented 是 `div`，没有原生 `value`，只能按可见文案找到那一段再点。）
 */
async function clickVersionTableTab(containerTestid: string): Promise<void> {
  await waitFor(
    () => byTestId(containerTestid).querySelector('[data-testid="pm-version-views"]') !== null,
    '版本面板应渲染出来',
  );
  await act(async () => {
    const panel = byTestId(containerTestid).querySelector('[data-testid="pm-version-views"]');
    const items = [...(panel?.querySelectorAll('.ant-segmented-item') ?? [])];
    const table = items.find((item) => (item.textContent ?? '').includes('表格'));
    assert.ok(table !== undefined, '版本面板必须有「表格」页签');
    (table as HTMLElement).click();
  });
}

/**
 * 在某个容器内点元素。
 * ⚠️ 分栏视图里**详情面板与编辑器各有一个版本面板**（两处 `VersionPanel` 同时挂载），
 * `byTestId()` 只取第一个命中 ⇒ 不限定范围就会点到详情面板那一份，测的就不是编辑器这条路了。
 */
async function clickIn(containerTestid: string, testid: string): Promise<void> {
  const target = byTestId(containerTestid).querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  assert.ok(target !== null, `[${containerTestid}] 里应有 [${testid}]`);
  await act(async () => {
    target.click();
  });
}

/** 点 Popconfirm 的确认按钮（harness 只挂了 antd 的 `App`、没装 zh 语言包 ⇒ 按钮是默认英文 `OK`）。 */
async function confirmPopconfirm(): Promise<void> {
  await waitFor(() => document.querySelector('.ant-popconfirm') !== null, 'Popconfirm 应弹出来');
  await act(async () => {
    const buttons = [...document.querySelectorAll('.ant-popconfirm .ant-btn')];
    const confirm = buttons.find((button) => /OK|确定/i.test(button.textContent ?? ''));
    assert.ok(confirm !== undefined, 'Popconfirm 必须有确认按钮');
    (confirm as HTMLElement).click();
  });
}

/** 等某个容器里出现目标文本（详情正文是**异步**的 Markdown 预览，必须等）。失败时把实际内容带出来。 */
async function waitForText(testid: string, pattern: RegExp, message: string): Promise<void> {
  try {
    await waitFor(() => pattern.test(byTestId(testid).textContent ?? ''), message);
  } catch {
    const actual = byTestId(testid).textContent ?? '';
    assert.fail(`${message}（实际显示：${JSON.stringify(actual)}）`);
  }
}

test('AC-127 B4：编辑器里改了正文、随手点收藏 ⇒ 未保存的正文不得被静默重置（FR-136 ①）', async () => {
  const state: ServerState = {
    prompts: [
      makePrompt({ id: 1, title: '第一条', user_prompt: '正文一' }),
      makePrompt({ id: 2, title: '第二条', user_prompt: '正文二' }),
    ],
  };
  const mounted = await openWorkspace(state);
  try {
    await openEditorFromDetail();
    await typeInto('editor-user-prompt', '改了一半的正文');
    assert.equal(valueOf('editor-user-prompt'), '改了一半的正文', '输入应生效');

    await click('pm-fav-editor-1');
    await mounted.settle();

    assert.equal(
      valueOf('editor-user-prompt'),
      '改了一半的正文',
      '点收藏只改了 favorite 这一个属性，不得把整张表单重置回服务端内容（会丢未保存的编辑）',
    );
  } finally {
    await mounted.unmount();
  }
});

test('AC-127 B7：编辑器里点星标 ⇒ 表单的收藏开关必须同步，保存不得把收藏改回去（FR-136 ① 的代价）', async () => {
  const state: ServerState = { prompts: [makePrompt({ id: 1, title: '第一条', user_prompt: '正文一' })] };
  const mounted = await openWorkspace(state);
  try {
    await openEditorFromDetail();
    await typeInto('editor-user-prompt', '改了一半的正文');
    assert.equal(byTestId('editor-favorite').getAttribute('aria-checked'), 'false', '初始应是未收藏');

    await click('pm-fav-editor-1');
    await mounted.settle();
    await waitFor(
      () => byTestId('editor-favorite').getAttribute('aria-checked') === 'true',
      '点星标后表单里的收藏开关必须同步 —— 保存时 favorite 是从表单里读的，不同步就会把收藏改回去',
    );

    await click('editor-save');
    await waitFor(() => findById(state, 1)?.favorite === true, '保存后服务端的 favorite 必须是点星标后的值');
    assert.equal(valueOf('editor-user-prompt'), '改了一半的正文', '星标与保存都不得重置未保存的正文');
  } finally {
    await mounted.unmount();
  }
});

test('AC-127 B5：切到另一条 prompt ⇒ 表单必须重新填充（该重置的时候要重置）', async () => {
  const state: ServerState = {
    prompts: [
      makePrompt({ id: 1, title: '第一条', user_prompt: '正文一' }),
      makePrompt({ id: 2, title: '第二条', user_prompt: '正文二' }),
    ],
  };
  const mounted = await openWorkspace(state);
  try {
    await openEditorFromDetail();
    await typeInto('editor-user-prompt', '第一条的临时改动');
    await mounted.settle();

    await click('pm-editor-list-item-2');
    await waitFor(
      () => valueOf('editor-user-prompt') === '正文二',
      '换成第二条后，表单必须重填成第二条的正文',
    );
  } finally {
    await mounted.unmount();
  }
});

test('AC-127 C8：编辑器保存后，分栏右栏立刻显示新正文（所有位置同一份最新数据，FR-136 ②）', async () => {
  const state: ServerState = { prompts: [makePrompt({ id: 1, title: '第一条', user_prompt: '正文一' })] };
  const mounted = await openWorkspace(state);
  try {
    await openEditorFromDetail();
    await typeInto('editor-user-prompt', '正文一改');
    await mounted.settle();

    await click('editor-save');
    await waitFor(() => findById(state, 1)?.user_prompt === '正文一改', '保存应写到假服务端');

    await waitForText(
      'pm-detail-body',
      /正文一改/,
      '保存后右栏必须显示保存后的正文，而不是改之前的旧对象',
    );
  } finally {
    await mounted.unmount();
  }
});

test('AC-127 C9：分栏列表点收藏后，右栏与列表项显示同一份最新数据', async () => {
  const state: ServerState = { prompts: [makePrompt({ id: 1, title: '第一条', user_prompt: '正文一' })] };
  const mounted = await openWorkspace(state);
  try {
    assert.equal(byTestId('pm-fav-detail-1').getAttribute('aria-label'), '收藏');

    await click('pm-fav-split-1');
    await mounted.settle();

    assert.equal(byTestId('pm-fav-split-1').getAttribute('aria-label'), '取消收藏', '列表项应变成已收藏');
    assert.equal(byTestId('pm-fav-detail-1').getAttribute('aria-label'), '取消收藏', '右栏必须同步');
  } finally {
    await mounted.unmount();
  }
});

test('AC-127 B6：回滚到旧版本后，编辑器表单必须拿到服务端的新内容（显式重取，不靠对象引用）', async () => {
  const state: ServerState = {
    prompts: [makePrompt({ id: 1, title: '第一条', user_prompt: '正文二', version_no: 2 })],
    versions: [
      { version_no: 1, created_at: '2026-10-11T00:00:00.000Z', title: '第一条', user_prompt: '正文一' },
      { version_no: 2, created_at: '2026-10-11T01:00:00.000Z', title: '第一条', user_prompt: '正文二' },
    ],
  };
  const mounted = await openWorkspace(state);
  try {
    await openEditorFromDetail();
    await typeInto('editor-user-prompt', '未保存的临时改动');
    await mounted.settle();
    assert.equal(valueOf('editor-user-prompt'), '未保存的临时改动', '先确认未保存的编辑在表单里');

    await clickVersionTableTab('pm-editor');
    await clickIn('pm-editor', 'rollback-1');
    await confirmPopconfirm();

    await waitFor(
      () => valueOf('editor-user-prompt') === '正文一',
      '回滚后表单必须显示服务端回滚后的正文（不能停在旧对象 / 未保存的编辑上）',
    );
    assert.equal(findById(state, 1)?.user_prompt, '正文一', '假服务端应已被回滚到 v1 的内容');
  } finally {
    await mounted.unmount();
  }
});
