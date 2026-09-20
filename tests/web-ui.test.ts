// 阶段 8 前端 P0 的结构化验收（静态断言）。
// 渲染级证据（真实 DOM 里的 ant-* 类名、截图）由 `tools/ac-stage8.sh` / `tools/ui-shots.sh` 产出；
// 这里断言的是"界面源码里确实实现了 BRIEF §4 FR-11 / FR-11b / §5 硬性要求"。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(ROOT, 'web', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(WEB_SRC)
  .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
  .map((file) => ({ rel: path.relative(ROOT, file), text: readFileSync(file, 'utf8') }));

const blob = files.map((file) => file.text).join('\n');

function assertSomewhere(pattern: RegExp, label: string): void {
  const hit = files.find((file) => pattern.test(file.text));
  assert.ok(hit !== undefined, `${label}：web/src 下没有任何文件匹配 ${String(pattern)}`);
}

test('登录页：POST /api/login + 口令表单 + 启动时用 /api/me 判会话', () => {
  assertSomewhere(/['"`]\/api\/login['"`]/, '登录接口');
  assertSomewhere(/['"`]\/api\/me['"`]/, '会话探测接口');
  assertSomewhere(/<Form[\s>]/, 'antd Form');
  assertSomewhere(/Input\.Password/, 'antd Input.Password');
});

test('列表页：接 /api/prompts 的 q/folder_id/tag/favorite/sort 与分页', () => {
  assertSomewhere(/['"`]\/api\/prompts['"`]/, '列表接口');
  for (const key of ['q', 'folder_id', 'tag', 'favorite', 'sort', 'limit', 'offset']) {
    assert.ok(blob.includes(key), `列表查询缺少参数 ${key}`);
  }
  assertSomewhere(/Pagination|pagination/, 'antd 分页');
});

test('编辑器：标题/用户提示词/系统提示词/备注/文件夹/标签/收藏 七个可写字段齐全', () => {
  for (const key of ['title', 'user_prompt', 'system_prompt', 'notes', 'folder_id', 'tags', 'favorite']) {
    assert.ok(blob.includes(key), `编辑器缺少字段 ${key}`);
  }
  assertSomewhere(/Input\.TextArea/, 'antd Input.TextArea');
  assertSomewhere(/TreeSelect/, 'antd TreeSelect（文件夹）');
  assertSomewhere(/<Switch[\s>]/, 'antd Switch（收藏）');
});

test('版本面板：列表 / diff / 回滚三个动作都在', () => {
  assertSomewhere(/\/versions['"`]/, '版本列表接口');
  assertSomewhere(/\/diff\?/, 'diff 接口');
  assertSomewhere(/\/rollback['"`]/, '回滚接口');
  assertSomewhere(/Popconfirm/, 'antd Popconfirm（回滚确认）');
});

test('变量面板：/variables + /render，且渲染结果可一键复制', () => {
  assertSomewhere(/\/variables['"`]/, '变量提取接口');
  assertSomewhere(/\/render['"`]/, '变量渲染接口');
  // 一键复制：显式按钮走 navigator.clipboard，另有用 antd copyable 的地方（Token 明文）
  assertSomewhere(/navigator\.clipboard/, '剪贴板一键复制');
  assertSomewhere(/CopyOutlined/, '复制按钮图标');
});

test('Markdown 预览：直接调用服务端 /api/render/markdown（不重写净化）', () => {
  assertSomewhere(/['"`]\/api\/render\/markdown['"`]/, 'Markdown 渲染接口');
  assert.equal(
    files.some((file) => /DOMPurify|dompurify/.test(file.text)),
    false,
    '前端不得再写一套净化（净化在高亮服务端已实现）',
  );
});

test('导入导出界面：两种模式 + FR-11b 文案与 merge 计数', () => {
  assertSomewhere(/['"`]\/api\/export['"`]/, '导出接口');
  assertSomewhere(/['"`]\/api\/import['"`]/, '导入接口');
  assert.ok(blob.includes('将清空现有全部 prompt / 文件夹 / 标签 / 版本历史'), 'FR-11b 的 replace 二次确认文案缺失');
  // 用 App.useApp() 的 modal.confirm（能吃到 ConfigProvider 的主题/中文 locale），而不是静态 Modal.confirm
  assertSomewhere(/[Mm]odal\.confirm/, 'antd modal.confirm（replace 二次确认）');
  assertSomewhere(/analyzeImportFile/, '导入文件解析（merge 显示将新增条目数）');
});

test('响应式 + 亮暗跟随系统（antd theme.algorithm / Grid.useBreakpoint）', () => {
  assertSomewhere(/darkAlgorithm/, 'antd 暗色算法');
  assertSomewhere(/defaultAlgorithm/, 'antd 亮色算法');
  assertSomewhere(/prefers-color-scheme/, '跟随系统');
  assertSomewhere(/useBreakpoint\(\)/, 'antd 响应式断点');
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
  const required = [
    'pm-topnav', 'pm-sidebar',
    'pm-editor', 'pm-panel-versions', 'pm-panel-variables', 'pm-panel-markdown',
  ];
  const missing = required.filter((id) => !blob.includes(`data-testid="${id}"`));
  assert.deepEqual(missing, [], `缺少 testid：${missing.join(', ')}`);
});

test('AC-31 ④：pm-panel-* 恰好 3 个（多一个就会让运行时计数 ≠ 3）', () => {
  const count = (blob.match(/data-testid="pm-panel-/g) ?? []).length;
  assert.equal(count, 3, `源码里 pm-panel-* 应为 3 个，实际 ${count}`);
});

test('AC-31 ⑥：编辑器不再用标签页承载版本/变量/预览（三栏常驻）', () => {
  const editor = files.find((file) => file.rel.endsWith('components/PromptEditor.tsx'));
  assert.ok(editor !== undefined, '找不到 PromptEditor.tsx');
  assert.equal(/<Tabs[\s>]/.test(editor.text), false, '编辑器里不得再出现 antd Tabs');
  for (const panel of ['VersionPanel', 'VariablePanel', 'MarkdownPreview']) {
    assert.ok(editor.text.includes(panel), `编辑器里必须同时挂载 ${panel}（三块常驻）`);
  }
});

test('AC-29 ①：theme.token 与 theme.components 都被定制（不是只有 algorithm）', () => {
  assert.ok(/\btoken:\s*\{/.test(blob), '缺少 theme.token 定制');
  assert.ok(/\bcomponents:\s*\{/.test(blob), '缺少 theme.components 定制');
});

test('FR-40b 移动端：卡片列表 + 抽屉编辑（不是横向溢出表格）', () => {
  assertSomewhere(/useBreakpoint\(\)/, '响应式断点');
  assert.ok(blob.includes('isMobile'), '必须按断点分流移动端形态');
});
