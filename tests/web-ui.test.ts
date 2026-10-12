// 阶段 8 前端 P0 的结构化验收。
//
// 阶段 67（FR-139 / AC-129 B7）改造：这里原来用 `assertSomewhere()` ——
// **任意一个 web/src 文件命中就算过**。后果是"整段功能删掉"也照样绿
// （比如把版本面板的回滚整段删了，只要别的文件里还有一个 `/rollback` 字面量就过）。
// 现在每条断言都指名**具体文件**，并且能走行为断言的地方就走行为断言
// （例如列表查询串不再数 blob 里有没有 `folder_id`，而是直接调 `buildPromptListQuery` 看输出）。
//
// 渲染级证据（真实 DOM 里的 ant-* 类名、截图）由 库外验收记录 / `tools/ui-shots.sh` 产出；
// 阶段 67 起"渲染出来是什么"的断言在 `tests/render/`（jsdom + react-dom）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPromptListQuery } from '../web/src/list-query.ts';
import { readWebSource, webSourceFiles } from './source-text.ts';

const files = webSourceFiles();
const src = (rel: string): string => readWebSource(rel);

/**
 * 在**指定文件**里断言（替代"任意文件命中即过"）。
 * `rel` 相对 `web/src`，例如 `'api.ts'`、`'components/VersionPanel.tsx'`。
 */
function assertIn(rel: string, pattern: RegExp | string, label: string): void {
  const text = src(rel);
  const hit = typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  assert.ok(hit, `${label}：${rel} 里找不到 ${String(pattern)}`);
}

test('登录页：POST /api/login + 口令表单 + 启动时用 /api/me 判会话', () => {
  assertIn('api.ts', /['"`]\/api\/login['"`]/, '登录接口');
  assertIn('api.ts', /['"`]\/api\/me['"`]/, '会话探测接口');
  assertIn('components/LoginPage.tsx', /<Form[\s<]/, 'antd Form');
  assertIn('components/LoginPage.tsx', /Input\.Password/, 'antd Input.Password');
});

test('列表页：查询参数由 buildPromptListQuery 生成（行为断言）+ antd 分页', () => {
  // 行为断言：整段功能删掉（少一个参数）就红 —— 原来只是 `blob.includes('folder_id')`。
  assert.equal(
    buildPromptListQuery({
      q: 'abc',
      folderId: 3,
      tag: 'x',
      favorite: true,
      sort: 'custom',
      limit: 20,
      offset: 40,
    }),
    '?q=abc&folder_id=3&tag=x&favorite=true&sort=custom&limit=20&offset=40',
    '列表查询串必须把 q/folder_id/tag/favorite/sort/limit/offset 都带上',
  );
  assert.equal(buildPromptListQuery({}), '', '没有任何条件时不得带 `?`');
  assertIn('api.ts', /['"`]\/api\/prompts['"`]/, '列表接口');
  assertIn('components/UseView.tsx', /Pagination|pagination/, 'antd 分页');
});

test('编辑器：标题/用户提示词/系统提示词/备注/文件夹/标签/收藏/记住变量值 八个可写字段齐全', () => {
  for (const key of [
    'title',
    'user_prompt',
    'system_prompt',
    'notes',
    'folder_id',
    'tags',
    'favorite',
    'remember_variables',
  ]) {
    assertIn('components/PromptEditor.tsx', key, `编辑器缺少字段 ${key}`);
  }
  assertIn('components/PromptEditor.tsx', /Input\.TextArea/, 'antd Input.TextArea');
  assertIn('components/PromptEditor.tsx', /TreeSelect/, 'antd TreeSelect（文件夹）');
  assertIn('components/PromptEditor.tsx', /<Switch[\s>]/, 'antd Switch（收藏）');
});

test('版本面板：列表 / diff / 回滚三个动作都在', () => {
  assertIn('components/VersionPanel.tsx', /api\.versions\(/, '版本面板要调版本列表');
  assertIn('components/VersionPanel.tsx', /api\.diff\(/, '版本面板要调 diff');
  assertIn('components/VersionPanel.tsx', /api\.rollback\(/, '版本面板要调回滚');
  assertIn('components/VersionPanel.tsx', /Popconfirm/, 'antd Popconfirm（回滚确认）');
  assertIn('api.ts', /\/versions['"`]/, '版本列表接口路径');
  assertIn('api.ts', /\/diff\?/, 'diff 接口路径');
  assertIn('api.ts', /\/rollback['"`]/, '回滚接口路径');
});

test('变量面板：/variables + /render，且渲染结果可一键复制', () => {
  assertIn('components/VariablePanel.tsx', /api\.variables\(/, '变量提取接口');
  assertIn('components/VariablePanel.tsx', /api\.render\(/, '变量渲染接口');
  // 一键复制：走共享的剪贴板助手（内网 IP 下 async clipboard 不存在，助手有兜底）
  assertIn('clipboard.ts', /navigator\.clipboard/, '剪贴板一键复制');
  assertIn('components/VariablePanel.tsx', /CopyOutlined/, '复制按钮图标');
});

test('Markdown 预览：直接调用服务端 /api/render/markdown（不重写净化）', () => {
  assertIn('components/MarkdownPreview.tsx', /api\.renderMarkdown\(/, 'Markdown 渲染调用');
  assertIn('api.ts', /['"`]\/api\/render\/markdown['"`]/, 'Markdown 渲染接口路径');
  assert.equal(
    files.some((file) => /DOMPurify|dompurify/.test(file.text)),
    false,
    '前端不得再写一套净化（净化在高亮服务端已实现）',
  );
});

test('导入导出界面：两种模式 + FR-11b 文案与 merge 计数', () => {
  assertIn('components/ImportExportModal.tsx', /api\.exportAll\(/, '导出接口');
  assertIn('components/ImportExportModal.tsx', /api\.importAll\(/, '导入接口');
  // FR-11b 的 replace 二次确认文案：常量在 pure.ts、必须被弹窗真的用上（删掉使用就红）
  assertIn('import-file.ts', /REPLACE_WARNING = '将清空现有全部 prompt \/ 文件夹 \/ 标签 \/ 版本历史'/, 'FR-11b 文案定义');
  assertIn('components/ImportExportModal.tsx', /REPLACE_WARNING/, '弹窗必须使用 FR-11b 文案');
  // 用 App.useApp() 的 modal.confirm（能吃到 ConfigProvider 的主题/中文 locale），而不是静态 Modal.confirm
  assertIn('components/ImportExportModal.tsx', /[Mm]odal\.confirm/, 'antd modal.confirm（replace 二次确认）');
  assertIn('components/ImportExportModal.tsx', /analyzeImportFile/, '导入文件解析（merge 显示将新增条目数）');
});

test('响应式 + 亮暗跟随系统（antd theme.algorithm / Grid.useBreakpoint）', () => {
  assertIn('theme.ts', /darkAlgorithm/, 'antd 暗色算法');
  assertIn('theme.ts', /defaultAlgorithm/, 'antd 亮色算法');
  assertIn('use-prefers-dark.ts', /prefers-color-scheme/, '跟随系统');
  assertIn('components/Workspace.tsx', /useBreakpoint\(\)/, 'antd 响应式断点');
});

test('AC-20 ②：源码里不出现原生表单/表格标签', () => {
  const offenders = files
    .filter((file) => /<(button|input|select|textarea|table|dialog)[ >/]/.test(file.text))
    .map((file) => file.rel);
  assert.deepEqual(offenders, []);
});

test('AC-20 ④：源码零 CDN 外链', () => {
  // 与 AC-20 ④ 的命令口径一致：**大小写敏感**（避免中文注释里的「CDN」被误判）
  const offenders = files
    .filter((file) => /(cdn|unpkg|jsdelivr|googleapis)/.test(file.text))
    .map((file) => file.rel);
  assert.deepEqual(offenders, []);
});

// v17（FR-43）取消「管理页」后，KPI 行 / 状态条 / 管理筛选行随管理页一并移除；
// 仍保留的结构锚点 = 顶栏 / 侧栏 / 编辑器三栏（AC-31 的这部分继续有效）。
test('AC-31（v17 修订）：顶栏 / 侧栏 / 编辑器三块面板的固定 data-testid 齐全', () => {
  // 按**所属组件**断言：删掉某个面板，它所在文件立刻红（原来是对 blob 找 testid）
  assertIn('components/AppHeader.tsx', 'data-testid="pm-topnav"', '顶栏锚点');
  assertIn('components/SidebarPanel.tsx', 'data-testid="pm-sidebar"', '侧栏锚点');
  assertIn('components/PromptEditor.tsx', 'data-testid="pm-editor"', '编辑器锚点');
  assertIn('components/PromptEditor.tsx', 'data-testid="pm-panel-versions"', '版本面板锚点');
  assertIn('components/PromptEditor.tsx', 'data-testid="pm-panel-variables"', '变量面板锚点');
  assertIn('components/PromptEditor.tsx', 'data-testid="pm-panel-markdown"', '预览面板锚点');
});

test('AC-31 ④：编辑器里 pm-panel-* 恰好 3 个（多一个就会让运行时计数 ≠ 3）', () => {
  const editor = src('components/PromptEditor.tsx');
  const count = (editor.match(/data-testid="pm-panel-/g) ?? []).length;
  assert.equal(count, 3, `编辑器里 pm-panel-* 应为 3 个，实际 ${count}`);
  // 渲染后的对照在 tests/render/stage67-render-behavior.test.ts（数真的挂载了几个面板）
});

test('AC-31 ⑥：编辑器不再用标签页承载版本/变量/预览（三栏常驻）', () => {
  const editor = src('components/PromptEditor.tsx');
  assert.equal(/<Tabs[\s>]/.test(editor), false, '编辑器里不得再出现 antd Tabs');
  for (const panel of ['VersionPanel', 'VariablePanel', 'MarkdownPreview']) {
    assert.ok(editor.includes(panel), `编辑器里必须同时挂载 ${panel}（三块常驻）`);
  }
});

test('AC-29 ①：theme.token 与 theme.components 都被定制（不是只有 algorithm）', () => {
  const theme = src('theme.ts');
  assert.ok(/\btoken:\s*\{/.test(theme), '缺少 theme.token 定制');
  assert.ok(/\bcomponents:\s*\{/.test(theme), '缺少 theme.components 定制');
});

test('FR-40b 移动端：卡片列表 + 抽屉编辑（不是横向溢出表格）', () => {
  assertIn('components/Workspace.tsx', /useBreakpoint\(\)/, '响应式断点');
  assertIn('components/Workspace.tsx', 'isMobile', '必须按断点分流移动端形态');
});
