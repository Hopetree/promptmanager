/**
 * 阶段 68 / FR-141（AC-130 ⑥⑦，渲染级）：文件夹计数**一次请求**拿全，且数字真的落到侧栏徽标上。
 *
 * 为什么必须是渲染级：AC-130 ⑥ 的判据是「单次刷新的请求数从『文件夹数 + 1』降到 ≤1」——
 * 请求数是前端行为，服务端用例看不见；而"数字有没有显示出来"也只有挂起组件才能断言。
 * 这里用 `./harness.ts` 的 `calls`（假 fetch 的请求流水）数请求，用真实渲染出的 `.pm-folder-count`
 * 断言徽标文本 —— 改前是 3 个文件夹 ⇒ 1（列表）+ 3（每个文件夹一次）= 4 次。
 */
// ⚠️ `./harness.ts` 必须**第一个**被 import（它要在 `react-dom` 求值前把 jsdom 全局装好）。
import { element, mount, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { App as AntdApp } from 'antd';
import type { Folder, Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

after(() => {
  releaseLoaderPort();
});

const FOLDERS: Folder[] = [
  { id: 1, name: '根甲', parent_id: null, sort_order: 1 },
  { id: 2, name: '子甲', parent_id: 1, sort_order: 1 },
  { id: 3, name: '根乙', parent_id: null, sort_order: 2 },
];

/** 服务端口径的答案（含子文件夹）：根甲 = 自己 1 + 子甲 2 = 3；子甲 = 2；根乙 = 0。 */
const COUNTS: Record<string, number> = { '1': 3, '2': 2, '3': 0 };

function makePrompt(id: number, folderId: number | null): Prompt {
  return {
    id,
    title: `夹具 ${String(id)}`,
    user_prompt: '正文',
    system_prompt: '',
    notes: '',
    folder_id: folderId,
    tags: [],
    favorite: false,
    remember_variables: true,
    created_at: '2026-10-12T00:00:00.000Z',
    updated_at: '2026-10-12T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
  };
}

const PROMPTS: Prompt[] = [makePrompt(1, 1), makePrompt(2, 2), makePrompt(3, 2)];

/** 记录 `/api/prompts` 的请求（含查询串），用于数"单次刷新发了几次"。 */
let listRequests: string[] = [];

function installRoutes(): void {
  route('GET', /^\/api\/prompts$/, (request) => {
    listRequests.push(request.search);
    const wantsCounts = request.search.includes('include=folder_counts');
    return {
      status: 200,
      body: {
        total: PROMPTS.length,
        limit: 20,
        offset: 0,
        items: PROMPTS,
        ...(wantsCounts ? { folder_counts: COUNTS } : {}),
      },
    };
  });
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: FOLDERS } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  route('POST', /^\/api\/render\/markdown$/, (request) => ({
    status: 200,
    body: { html: `<p>${(request.body as { markdown?: string } | undefined)?.markdown ?? ''}</p>` },
  }));
}

beforeEach(() => {
  resetRoutes();
  listRequests = [];
  window.localStorage.clear();
});

async function openWorkspace(): Promise<Mounted> {
  installRoutes();
  window.localStorage.setItem('pm-view-mode', 'split');
  // 侧栏只在 `!isMobile && !isNarrow` 时渲染，而 `isNarrow` 看的是 antd 的 `xl`（1200px）
  // ⇒ 桌面视口要设到 1200 以上，否则 `.pm-folder-count` 根本不在 DOM 里。
  window.innerWidth = 1440;
  window.innerHeight = 900;
  const mounted = await mount(
    element(AntdApp, {}, element(Workspace, {
      themeMode: 'light',
      onCycleTheme: () => undefined,
      onSignedOut: () => undefined,
    })),
  );
  await waitFor(() => document.querySelectorAll('.pm-folder-count').length === FOLDERS.length, '三个文件夹徽标应渲染出来');
  return mounted;
}

function badges(): string[] {
  return [...document.querySelectorAll('.pm-folder-count')].map((node) => (node.textContent ?? '').trim());
}

test('AC-130 ⑥⑦：单次刷新只发 1 次列表请求（改前是「文件夹数 + 1」= 4），徽标显示服务端给的数字', async () => {
  const mounted = await openWorkspace();
  try {
    // ⑥ 请求数：列表 1 次；**没有任何** per-folder 的 `?folder_id=N&limit=1` 请求
    const listCount = listRequests.length;
    const perFolder = listRequests.filter((search) => search.includes('folder_id='));
    assert.equal(listCount, 1, `单次刷新只该发 1 次列表请求（改前 3 个文件夹 ⇒ 4 次；实测 ${String(listCount)} 次）`);
    assert.equal(perFolder.length, 0, `不该再有 per-folder 计数请求（实测 ${JSON.stringify(perFolder)}）`);
    assert.ok(
      listRequests[0]?.includes('include=folder_counts'),
      `这一次请求应显式要计数（实测 ${String(listRequests[0])}）`,
    );

    // ⑦ 数字：徽标上就是服务端算的（含子文件夹）那几个数
    await waitFor(() => badges().join(',') === '3,2,0', `徽标应显示 3,2,0（实测 ${badges().join(',')}）`);
    assert.deepEqual(badges(), ['3', '2', '0']);
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑧：服务端回 folder_counts=null 时保留上一次的数字，列表照常显示', async () => {
  installRoutes();
  // 覆盖成"计数失败"：响应带 folder_counts: null（服务端 try/catch 的真实形状）
  resetRoutes();
  listRequests = [];
  route('GET', /^\/api\/prompts$/, (request) => {
    listRequests.push(request.search);
    return {
      status: 200,
      body: { total: PROMPTS.length, limit: 20, offset: 0, items: PROMPTS, folder_counts: null },
    };
  });
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: FOLDERS } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  window.localStorage.setItem('pm-view-mode', 'split');
  window.innerWidth = 1440;
  window.innerHeight = 900;
  const mounted = await mount(
    element(AntdApp, {}, element(Workspace, {
      themeMode: 'light',
      onCycleTheme: () => undefined,
      onSignedOut: () => undefined,
    })),
  );
  try {
    await waitFor(() => document.querySelectorAll('.pm-folder-count').length === FOLDERS.length, '文件夹徽标应渲染出来');
    // 列表照常渲染（不是错误页），计数是 0（保留旧值 = 初始空表）而不是崩掉
    await waitFor(() => document.querySelector('[data-testid="pm-detail-body"]') !== null, '右栏详情应渲染出来');
    assert.deepEqual(badges(), ['0', '0', '0'], '计数失败 ⇒ 保留旧值（初始为空 ⇒ 0），不影响列表');
  } finally {
    await mounted.unmount();
  }
});

test('FR-141 源码级：Workspace 不再对每个文件夹发计数请求，改用 include=folder_counts', async () => {
  const { readWebSource } = await import('../source-text.ts');
  const source = readWebSource('components/Workspace.tsx');
  assert.doesNotMatch(source, /folderId: folder\.id, limit: 1/, 'per-folder 的计数请求必须删掉');
  assert.match(source, /includeFolderCounts: true/, '列表请求要带 includeFolderCounts');
  assert.match(source, /result\.folder_counts/, '要读响应里的 folder_counts');
});
