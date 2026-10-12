/**
 * 阶段 67 渲染级用例（FR-139 / AC-129 B4 / B5 / B6 / B7 / C10）。
 *
 * 为什么这些用例必须"渲染级"：它们替换的旧断言守的都是**书写形式或文本位置** ——
 * `header.includes('width={26}')`、`indexOf('header-new') < indexOf('header-more')`、
 * 把 `web/src` 拼成一个 blob 后 `blob.includes('pm-mode-use')`。
 * 这类断言有两个方向的错：
 *   - 假红：把尺寸写成变量、把按钮抽成子组件（行为没变）⇒ 无谓地红；
 *   - 假绿：功能整段删掉但字面量还留在别处 ⇒ 照样绿。
 * 只有把组件真的挂起来、看渲染出来的 DOM 是什么，才能同时避免这两种错。
 *
 * 基建在 `./harness.ts`（jsdom + react-dom/client + 假 fetch），`.tsx` 由 `tools/tsx-loader.mjs` 转译。
 */
// ⚠️ `./harness.ts` 必须**第一个**被 import：它要在 `react-dom` 求值之前把 jsdom 的
// `window`/`document` 装成全局（详见 `./dom-env.ts` 的注释）。
import { byTestId, element, mount, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp } from 'antd';
import type { Prompt, PromptListFilters } from '../../web/src/types.ts';

const { default: AppHeader } = await import('../../web/src/components/AppHeader.tsx');
const { default: LoginPage } = await import('../../web/src/components/LoginPage.tsx');
const { default: AboutModal } = await import('../../web/src/components/AboutModal.tsx');
const { EmptyState } = await import('../../web/src/components/States.tsx');
const { default: UseView } = await import('../../web/src/components/UseView.tsx');
const { default: PromptEditor } = await import('../../web/src/components/PromptEditor.tsx');

// 让 `node --test` 能在最后一条用例之后自己退出（详见 `releaseLoaderPort` 的注释）。
after(() => {
  releaseLoaderPort();
});

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
});

// ---- 小工具 --------------------------------------------------------------------

/**
 * 元素**渲染后的尺寸**：先看 `width`/`height` 属性，再看行内 `style`，最后看 IDL 属性。
 * 故意不看源码怎么写 —— 写成字面量、写成变量、写成 `style` 都算同一个渲染结果。
 */
function renderedSize(el: HTMLElement): { width: number; height: number } {
  const fromAttribute = (name: string): number | null => {
    const raw = el.getAttribute(name);
    return raw === null || raw.trim() === '' ? null : Number(raw);
  };
  const fromStyle = (value: string): number | null =>
    value.endsWith('px') && Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : null;
  const idl = el as unknown as { width?: number; height?: number };
  return {
    width: fromAttribute('width') ?? fromStyle(el.style.width) ?? idl.width ?? 0,
    height: fromAttribute('height') ?? fromStyle(el.style.height) ?? idl.height ?? 0,
  };
}

/** 容器里所有 `data-testid`（按 DOM 顺序）。 */
function testIdsIn(container: HTMLElement, prefix = ''): string[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)].map(
    (el) => el.getAttribute('data-testid') ?? '',
  );
}

/** 点一个元素（包在 `act` 里，让 antd/React 的更新算作"测试内的更新"）。 */
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

async function mountInApp(child: ReturnType<typeof element>): Promise<Mounted> {
  return mount(element(AntdApp, {}, child));
}

// ---- 夹具 ----------------------------------------------------------------------

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
    created_at: '2026-10-12T00:00:00.000Z',
    updated_at: '2026-10-12T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
    ...overrides,
  };
}

function headerProps(): Record<string, unknown> {
  return {
    themeMode: 'light',
    onCycleTheme: () => undefined,
    isMobile: false,
    showFilters: false,
    onOpenFilters: () => undefined,
    onCreate: () => undefined,
    onOpenUsage: () => undefined,
    onOpenTokens: () => undefined,
    onOpenImportExport: () => undefined,
    onOpenSync: () => undefined,
    onOpenSettings: () => undefined,
    onOpenPassword: () => undefined,
    onLogout: () => undefined,
    onGoHome: () => undefined,
  };
}

const FILTERS: PromptListFilters = {
  q: '',
  folderId: null,
  tag: null,
  favorite: false,
  sort: 'updated',
  page: 1,
  pageSize: 20,
};

function useViewProps(prompt: Prompt, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: { total: 1, limit: 20, offset: 0, items: [prompt] },
    loading: false,
    error: null,
    onRetry: () => undefined,
    filters: FILTERS,
    onFiltersChange: () => undefined,
    sort: 'updated' as const,
    onSortChange: () => undefined,
    viewMode: 'card' as const,
    onViewModeChange: () => undefined,
    pinFavorites: false,
    onPinFavoritesChange: () => undefined,
    folders: [],
    tags: [],
    isMobile: false,
    busyId: null,
    activeIndex: 0,
    onActiveIndexChange: () => undefined,
    onCopy: () => undefined,
    onOpenDetail: () => undefined,
    onEdit: () => undefined,
    onEditDetail: () => undefined,
    onDelete: () => undefined,
    onToggleFavorite: () => undefined,
    onMetaChange: () => undefined,
    onBulk: () => Promise.resolve(true),
    onReorder: () => undefined,
    selected: null,
    onSelect: () => undefined,
    onReload: () => undefined,
    ...overrides,
  };
}

function editorProps(prompt: Prompt): Record<string, unknown> {
  return {
    prompt,
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
  };
}

/** 编辑器 / 关于页会自己发请求：注册最小应答，免得面板里显示 404。 */
function installBasicRoutes(prompt: Prompt): void {
  route('GET', /^\/api\/prompts\/\d+$/, () => ({ status: 200, body: prompt }));
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({
    status: 200,
    body: { items: [{ version_no: 1, created_at: '2026-10-12T00:00:00.000Z', title: prompt.title }] },
  }));
  route('GET', /^\/api\/prompts\/\d+\/variables$/, () => ({ status: 200, body: { variables: [], defaults: {} } }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>ok</p>' } }));
  route('GET', /^\/healthz$/, () => ({ status: 200, body: { status: 'ok', version: '1.8.0-beta.2' } }));
}

// ---- B4：品牌图形按**渲染后的尺寸**判定（原断言看源码里有没有 `width={26}`） --------

test('AC-129 B4：顶栏品牌 mark 渲染成 26×26 的矢量图', async () => {
  const mounted = await mountInApp(element(AppHeader, headerProps()));
  const mark = byTestId('pm-brand-mark');
  assert.equal(mark.tagName, 'IMG', '顶栏 mark 必须是 <img>');
  assert.equal(mark.getAttribute('src'), '/promptmanager-icon.svg', '顶栏 mark 必须用矢量版');
  assert.deepEqual(renderedSize(mark), { width: 26, height: 26 }, '顶栏 mark 的渲染尺寸必须是 26×26');
  await mounted.unmount();
});

test('AC-129 B4：登录页 / 空态 / 关于页的装饰图渲染成 96 / 72 / 48 且不进无障碍树', async () => {
  const login = await mountInApp(element(LoginPage, { onSuccess: () => undefined }));
  const loginArt = byTestId('pm-brand-art-login');
  assert.equal(loginArt.getAttribute('src'), '/promptmanager-96.png', '登录页要用 96');
  assert.deepEqual(renderedSize(loginArt), { width: 96, height: 96 }, '登录页装饰图必须是 96×96');
  assert.equal(loginArt.getAttribute('aria-hidden'), 'true', '登录页装饰图要 aria-hidden');
  await login.unmount();

  const empty = await mountInApp(element(EmptyState, { title: '还没有内容', withBrandIcon: true }));
  const emptyArt = byTestId('pm-brand-art-empty');
  assert.equal(emptyArt.getAttribute('src'), '/promptmanager-72.png', '空态要用 72');
  assert.deepEqual(renderedSize(emptyArt), { width: 72, height: 72 }, '空态装饰图必须是 72×72');
  assert.equal(emptyArt.getAttribute('aria-hidden'), 'true', '空态装饰图要 aria-hidden');
  await empty.unmount();

  installBasicRoutes(makePrompt());
  const about = await mountInApp(element(AboutModal, { open: true, onClose: () => undefined }));
  await waitFor(() => document.querySelector('[data-testid="pm-about"]') !== null, '关于页应渲染出来');
  const aboutArt = byTestId('pm-brand-art-about');
  assert.equal(aboutArt.getAttribute('src'), '/promptmanager-48.png', '关于页要用 48');
  assert.deepEqual(renderedSize(aboutArt), { width: 48, height: 48 }, '关于页装饰图必须是 48×48');
  assert.equal(aboutArt.getAttribute('aria-hidden'), 'true', '关于页装饰图要 aria-hidden');
  await about.unmount();
});

// ---- B5：顶栏顺序按**渲染后的 DOM 顺序**判定（原断言用源码 indexOf） ----------------

test('AC-129 B5：顶栏四块（新建 → 更多 → 主题 → 登出）按渲染后的 DOM 顺序判定', async () => {
  const mounted = await mountInApp(element(AppHeader, headerProps()));
  const order = ['header-new', 'header-more', 'pm-theme-toggle', 'header-logout'];
  const nodes = order.map((testid) => byTestId(testid));
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    assert.ok(previous !== undefined && current !== undefined);
    const following = previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING;
    assert.notEqual(
      following,
      0,
      `顶栏顺序必须是 新建 → 更多 → 主题 → 登出（${String(order[index - 1])} 应排在 ${String(order[index])} 之前）`,
    );
  }
  // 「筛选」按钮只在移动端 / 左栏收起时出现（它没有 testid，按 aria-label 找）
  assert.equal(document.querySelector('button[aria-label="筛选"]'), null, '桌面顶栏不该有筛选按钮');
  await mounted.unmount();
});

test('AC-129 B5：⋯更多 菜单里的项目顺序按**渲染后的 DOM 顺序**判定', async () => {
  const mounted = await mountInApp(element(AppHeader, headerProps()));
  await click(byTestId('header-more'));
  await waitFor(() => document.querySelector('[data-testid="pm-menu-sync"]') !== null, '⋯更多 菜单应打开');
  const labels = [...document.querySelectorAll('.ant-dropdown-menu-item')].map((item) =>
    (item.textContent ?? '').trim(),
  );
  const expected = ['使用统计', 'API 令牌', '导入 / 导出', '远程数据同步', '关于', '修改密码', '登出'];
  const found = expected.map((label) => labels.findIndex((text) => text.includes(label)));
  assert.ok(
    found.every((index) => index >= 0),
    `⋯更多 菜单缺少项目（实际：${labels.join(' | ')}）`,
  );
  for (let index = 1; index < found.length; index += 1) {
    const previous = found[index - 1];
    const current = found[index];
    assert.ok(previous !== undefined && current !== undefined && current > previous,
      `⋯更多 子项顺序不对：${String(expected[index])} 应排在 ${String(expected[index - 1])} 之后（实际 ${labels.join(' | ')}）`);
  }
  await mounted.unmount();
});

// ---- B6：双模式在**渲染结果**里不存在（原断言对 blob 做 !includes） ------------------

test('AC-129 B6：渲染后的顶栏里没有任何「使用 / 管理」双模式开关', async () => {
  const mounted = await mountInApp(element(AppHeader, headerProps()));
  assert.deepEqual(testIdsIn(byTestId('pm-topnav'), 'pm-mode'), [], '顶栏不得再有 pm-mode-* 锚点');
  assert.equal(document.body.textContent?.includes('管理模式'), false, '界面上不得再有「管理模式」字样');
  await mounted.unmount();
});

// ---- B7：卡片视图不常驻删除（原断言切源码片段找 `pm-delete-`） ----------------------

test('AC-129 B7：卡片视图渲染后没有任何删除按钮，表格视图行内必须有删除按钮', async () => {
  const prompt = makePrompt();
  const card = await mountInApp(element(UseView, useViewProps(prompt, { viewMode: 'card' })));
  await waitFor(() => document.querySelector('[data-testid="pm-use-card"]') !== null, '卡片视图应渲染出来');
  assert.deepEqual(testIdsIn(card.container, 'pm-delete-'), [], '卡片视图不得常驻删除按钮');
  assert.equal(document.querySelector('.ant-popconfirm'), null, '卡片视图不该渲染删除二次确认');
  await card.unmount();

  const table = await mountInApp(element(UseView, useViewProps(prompt, { viewMode: 'table' })));
  await waitFor(() => document.querySelector('[data-testid="pm-view-table"]') !== null, '表格视图应渲染出来');
  assert.deepEqual(testIdsIn(table.container, 'pm-delete-'), ['pm-delete-1'], '表格行内必须有删除入口');
  assert.deepEqual(testIdsIn(table.container, 'pm-edit-'), ['pm-edit-1'], '表格行内必须有编辑入口');
  await table.unmount();
});

// ---- C10：以前只有文本断言守护的行为（AC-31 ④ 数 blob 里的 pm-panel-*） -------------

test('AC-129 C10：编辑器渲染后恰好挂载 3 个面板（版本 / 变量 / 预览），且没有标签页', async () => {
  const prompt = makePrompt();
  installBasicRoutes(prompt);
  const mounted = await mountInApp(element(PromptEditor, editorProps(prompt)));
  await waitFor(() => document.querySelector('[data-testid="pm-editor"]') !== null, '编辑器应渲染出来');
  const panels = testIdsIn(mounted.container, 'pm-panel-').sort();
  assert.deepEqual(panels, ['pm-panel-markdown', 'pm-panel-variables', 'pm-panel-versions'], '三块面板必须同屏常驻');
  assert.equal(mounted.container.querySelectorAll('.ant-tabs-tab').length, 0, '编辑器里不得再出现 antd 标签页');
  await mounted.unmount();
});
