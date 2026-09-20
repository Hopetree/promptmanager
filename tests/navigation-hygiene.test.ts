// v17（BRIEF FR-43 / FR-44）的**源码级**结构锚点：
// 取消「使用 / 管理」双模式、顶栏精简、管理动作并入表格视图、主题图标按钮。
// 运行时证据见 tools/ac-stage13.sh（AC-41 / AC-42 / AC-43）。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

test('AC-41 ①：不再存在 pm-mode-use / pm-mode-manage 与模式记忆', () => {
  assert.equal(blob.includes('pm-mode-use'), false, '仍出现 pm-mode-use（双模式未删除）');
  assert.equal(blob.includes('pm-mode-manage'), false, '仍出现 pm-mode-manage（双模式未删除）');
  // 旧键只允许出现在「清理」逻辑里（theme-mode.ts 的 LEGACY_KEYS）
  const modeKeyUsers = files.filter((file) => /localStorage\.(getItem|setItem)\(\s*['"`]pm-mode['"`]/.test(file.text));
  assert.deepEqual(modeKeyUsers.map((file) => file.rel), [], '不得再读写 pm-mode');
});

test('AC-41 ②③：顶栏只留 主题图标 / ＋新建 / ⋯更多；管理动作在 ⋯更多 里', () => {
  const header = src('components/AppHeader.tsx');
  assert.ok(header.includes('data-testid="pm-theme-toggle"'), '顶栏缺少 pm-theme-toggle');
  assert.ok(header.includes('data-testid="header-new"'), '顶栏缺少 header-new');
  assert.ok(header.includes('data-testid="header-more"'), '顶栏缺少 header-more');
  assert.ok(header.includes('更多'), '⋯更多 需要有可见的「更多」文案（AC-41 ②）');
  for (const label of ['使用统计', 'API 令牌', '导入 / 导出', '关于']) {
    assert.ok(header.includes(label), `⋯更多 菜单缺少：${label}`);
  }
  assert.equal(header.includes('文件夹与标签'), false, '⋯更多 不应再有「文件夹与标签」（FR-48）');
  assert.ok(header.includes('data-testid="pm-settings"'), '⋯更多 里缺少 pm-settings');
});

test('AC-41 ④⑤：表格视图行内有编辑/删除，卡片视图不常驻删除', () => {
  const useView = src('components/UseView.tsx');
  assert.ok(useView.includes('data-testid="pm-view-table"'), '表格视图缺少 pm-view-table 锚点');
  assert.ok(useView.includes('data-testid={`pm-edit-'), '表格/列表缺少行内编辑入口');
  assert.ok(useView.includes('data-testid={`pm-delete-'), '表格缺少行内删除入口');
  assert.ok(useView.includes('Popconfirm'), '删除必须二次确认');
  // 卡片分支不出现删除：card 渲染里不得含 pm-delete-
  // FR-70：卡片渲染抽成 renderCard（要交给 SortableList 复用），函数名随实现更新
  const cardStart = useView.indexOf('const renderCard = (prompt: Prompt, index: number');
  const cardEnd = useView.indexOf('const tableColumns');
  const cardSource = useView.slice(cardStart, cardEnd);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, '找不到卡片渲染分支');
  assert.equal(cardSource.includes('pm-delete-'), false, '卡片视图不得常驻删除按钮（AC-41 ⑤）');
});

test('D-24：左栏就地管理（不再只读），且没有「文件夹与标签」抽屉', () => {
  const workspace = src('components/Workspace.tsx');
  assert.equal(workspace.includes('organizeOpen'), false, '「文件夹与标签」抽屉应已删除（FR-48）');
  assert.ok(workspace.includes('folderCounts'), 'Workspace 需要提供每个文件夹的条目数（FR-49 ④）');
  const sidebar = src('components/SidebarPanel.tsx');
  assert.equal(sidebar.includes('readOnly'), false, '侧栏不再有只读态（D-24 撤销 FR-43 的只读筛选栏）');
});

test('FR-49：文件夹区的新建入口、行内管理与层级能力', () => {
  const folder = src('components/FolderPanel.tsx');
  for (const token of ['data-testid="folder-create"', 'data-testid="pm-folder-rename"', 'data-testid="pm-folder-delete"', 'pm-folder-row']) {
    assert.ok(folder.includes(token), `FolderPanel 缺少 ${token}`);
  }
  assert.ok(/marginLeft:\s*depth\s*\*\s*16/.test(folder), '层级必须按级缩进（子级 left ≥ 父级 +16px）');
  assert.ok(folder.includes('collapsed'), '必须有展开/收起三角的折叠状态');
  assert.ok(folder.includes('Popconfirm'), '删除必须二次确认');
  assert.ok(folder.includes('pm-folder-count'), '每行右侧要有条目数（浅灰小字）');
  assert.equal(folder.includes('<Tree'), false, '不再用 antd Tree（要自定义行内悬浮操作与三角）');
});

test('FR-50：标签区是胶囊云（# 前缀、无计数徽标、无增删改）', () => {
  const tag = src('components/TagPanel.tsx');
  assert.ok(tag.includes('data-testid="pm-tag-cloud"'), '缺少 pm-tag-cloud');
  assert.ok(tag.includes('data-testid="pm-tag-chip"'), '缺少 pm-tag-chip');
  assert.ok(tag.includes('#{tag.name}') || /#\{tag\.name\}/.test(tag), '胶囊文本必须以 # 前缀');
  assert.ok(tag.includes('全部 {tags.length}'), '标题行右侧要显示「全部 N」');
  assert.equal(tag.includes('Badge'), false, '标签区不得再有计数徽标');
  assert.equal(tag.includes('createTag') || tag.includes('renameTag') || tag.includes('deleteTag'), false, '标签不做增删改');
});

/* ============================================================
   v20（BRIEF FR-47 / FR-48 / D-23）：顶栏四块顺序与菜单项序
   ============================================================ */

test('AC-47：顶栏四块顺序（新建 → 更多 → 主题 → 登出）且不含用户信息', () => {
  const header = src('components/AppHeader.tsx');
  const newAt = header.indexOf('data-testid="header-new"');
  const moreAt = header.indexOf('data-testid="header-more"');
  const themeAt = header.indexOf('data-testid="pm-theme-toggle"');
  const logoutAt = header.indexOf('data-testid="header-logout"');
  assert.ok(newAt >= 0 && moreAt > newAt && themeAt > moreAt && logoutAt > themeAt, '顶栏顺序必须是 新建 → 更多 → 主题 → 登出');
  // 用户信息不再出现在顶栏（只出现在 ⋯更多 里）
  assert.equal(header.includes('username.slice'), false, '顶栏不得再有头像首字母');
});

test('AC-48（v27 修订）：⋯更多 子项顺序与删减 —— 只读登录信息由「修改密码」取代', () => {
  const header = src('components/AppHeader.tsx');
  // BRIEF v27：删除「已登录：<用户名>」只读项，**原位置**改为「修改密码」（FR-67 / AC-67 ①）
  const order = ["'usage'", "'tokens'", "'import-export'", "'settings'", "'password'", "'logout'"];
  let at = -1;
  for (const key of order) {
    const next = header.indexOf(`key: ${key}`);
    assert.ok(next > at, `⋯更多 子项顺序不对：${key}`);
    at = next;
  }
  assert.equal(header.includes('已登录'), false, '只读的登录信息项必须删除（v27）');
  assert.equal(header.includes("key: 'account'"), false, 'account 项必须删除（v27）');
  assert.ok(header.includes('data-testid="pm-menu-password"'), '原位置改为「修改密码」（pm-menu-password）');
  assert.ok(/key: 'logout'[^\n]*danger: true/.test(header), '「登出」保留危险色');
  assert.ok(header.includes('data-testid="pm-settings"'), '关于项仍须保留 pm-settings testid');
  assert.ok(header.includes('>关于<') || header.includes('关于</span>'), '「设置」文案要改成「关于」');
});

test('AC-37 回归：主列表组件不出现内部 id 与禁用文案', () => {
  const useView = src('components/UseView.tsx');
  assert.equal(/#\{String\(prompt\.id\)\}|#\{prompt\.id\}/.test(useView), false, '使用视图不得再渲染内部 id');
  assert.equal(useView.includes('`#${String(id)}`'), false, '文件夹名回退不得再产出 #数字');
  for (const token of ['DATA_DIR', 'SQLite', '渲染不写库', '把已有的 JSON 导入', 'pm-kpi-row', 'pm-statusbar']) {
    assert.equal(useView.includes(token), false, `UseView.tsx 不应再出现「${token}」`);
  }
});

/* ============================================================
   v19（BRIEF FR-46 / AC-44 / AC-45）：分栏视图 + 删除「列表」档
   ============================================================ */

test('AC-45：视图档位按「分栏 / 表格 / 卡片」顺序，且「列表」档已删除', () => {
  const useView = src('components/UseView.tsx');
  assert.ok(
    /export type UseViewMode = 'split' \| 'table' \| 'card'/.test(useView),
    'UseViewMode 必须只含 split / table / card',
  );
  const splitAt = useView.indexOf("value: 'split'");
  const tableAt = useView.indexOf("value: 'table'");
  const cardAt = useView.indexOf("value: 'card'");
  assert.ok(splitAt >= 0 && tableAt > splitAt && cardAt > tableAt, '档位顺序必须是 分栏 → 表格 → 卡片');
  assert.ok(useView.includes("label: '分栏'") && useView.includes("label: '表格'") && useView.includes("label: '卡片'"));
  // 列表档：源码里不得再有 pm-view-list / 'list' 档
  assert.equal(blob.includes('pm-view-list'), false, 'web/src 里不得再出现 pm-view-list');
  assert.equal(/value: 'list'/.test(blob), false, "不得再有 value: 'list' 档");
});

test('AC-44：分栏视图的三栏结构锚点齐备，且右栏复用详情面组件', () => {
  const split = src('components/SplitView.tsx');
  for (const token of ['pm-view-split', 'pm-split-list', 'pm-split-item', 'data-selected']) {
    assert.ok(split.includes(token), `SplitView 缺少 ${token}`);
  }
  assert.ok(split.includes('PromptDetailPanel'), '右栏必须原样复用详情面（PromptDetailPanel）');
  // 详情面的实现在 PromptDetail.tsx，分栏只是复用，不复制一套 testid
  const detail = src('components/PromptDetail.tsx');
  assert.ok(detail.includes('export function PromptDetailPanel'), '详情面必须导出可内联复用的 Panel');
  for (const token of ['pm-detail', 'pm-detail-actions', 'pm-detail-copy', 'pm-detail-version-jump', 'pm-detail-delete', 'pm-detail-edit', 'pm-detail-fullscreen']) {
    assert.ok(detail.includes(token), `详情面缺少 ${token}`);
  }
  assert.equal(split.includes('data-testid="pm-detail"'), false, '分栏不得再写一份 pm-detail（要复用组件）');
});

test('AC-45：默认视图 = split（旧值 list 回退 split），且沿用 pm-view-mode 记忆', () => {
  const workspace = src('components/Workspace.tsx');
  assert.ok(
    /readPref<UseViewMode>\('pm-view-mode', 'split', \['split', 'table', 'card'\]\)/.test(workspace),
    '默认必须是 split，且允许值只有 split/table/card（list 自动回退）',
  );
});

/* ============================================================
   v21（BRIEF FR-51 ~ FR-58 / AC-51 ~ AC-58）
   ============================================================ */

test('AC-51（v32 修订）：顶栏品牌 = PromptM（简称），logo 整块可点回主页', () => {
  const header = src('components/AppHeader.tsx');
  // ⚠️ v32 / FR-76 / D-31 修订：顶栏空间受限 ⇒ 用简称 PromptM；其余四处（<title>/登录/关于/错误文案）保持全名。
  // 旧断言"品牌文字必须是 PromptManager"随之作废（规格变更，不是放宽）。
  assert.ok(header.includes('PromptM'), '顶栏品牌文字必须是简称 PromptM');
  assert.equal(header.includes('PromptManager'), false, '顶栏不得再出现全名');
  assert.equal(/promptmanager</.test(header), false, '不得再渲染全小写 promptmanager');
  assert.ok(header.includes('role="button"'), 'logo 需要 role=button');
  assert.ok(header.includes('aria-label="回到首页"'), 'logo 需要 aria-label="回到首页"');
  assert.ok(header.includes('className="pm-brand"'), 'logo 需要 .pm-brand（cursor:pointer / hover）');
  assert.ok(header.includes('onGoHome'), 'logo 点击要接回主页回调');
  const workspace = src('components/Workspace.tsx');
  assert.ok(/const goHome = useCallback/.test(workspace), 'Workspace 必须提供 goHome');
  assert.ok(/setViewMode\('split'\)/.test(workspace), 'goHome 要把视图切回分栏');
  assert.ok(/q: '', folderId: null, tag: null, favorite: false/.test(workspace), 'goHome 要清空搜索与全部筛选');
});

test('AC-52：关于页三分区 + 无 Result 大块 + 状态条', () => {
  const about = src('components/AboutModal.tsx');
  for (const key of ["key: 'service'", "key: 'usage'", "key: 'maintain'"]) {
    assert.ok(about.includes(key), `关于页缺少分区 ${key}`);
  }
  assert.ok(about.includes('Collapse'), '分区用 Collapse（维护区默认折叠）');
  assert.ok(about.includes('pm-about'), '保留 pm-about 锚点');
  assert.ok(about.includes('后端在线'), '顶区要有一行状态徽标');
  assert.equal(about.includes('<Result'), false, '不再用大块 Result');
  assert.equal(about.includes('BRIEF'), false, '不得引用内部资料 BRIEF');
  // HealthCard 已并入 AboutModal
  assert.equal(blob.includes('HealthCard'), false, 'HealthCard 组件应已并入关于页');
});

test('AC-53：删除「拿来就用」装饰标题', () => {
  const workspace = src('components/Workspace.tsx');
  assert.equal(/拿来就用<\/Typography\.Title>/.test(workspace), false, '不得再有「拿来就用」标题元素');
  assert.equal(workspace.includes("level={3}"), false, '该装饰块用的 H3 应一并移除');
  assert.ok(workspace.includes('aria-label="拿来就用"'), '语义只能由 aria-label 承载');
});

test('AC-54：文件夹删除弹层不被 hover 卸载 + 非空必给可见反馈', () => {
  const folder = src('components/FolderPanel.tsx');
  assert.ok(folder.includes('deleteOpenFor'), '需要有"弹层打开时钉住操作区"的状态');
  assert.ok(/open=\{deleteOpenFor === folder\.id\}/.test(folder), 'Popconfirm 必须是受控 open');
  assert.ok(folder.includes('onOpenChange'), '受控 open 需要 onOpenChange');
  assert.ok(/folder_not_empty/.test(folder), '必须专门处理 409 folder_not_empty');
  assert.ok(folder.includes('先清空'), '错误文案要说清下一步（先清空 / 移走）');
  assert.ok(folder.includes('message.error'), '必须有用户可见的失败反馈');
});

test('AC-55/AC-56：编辑页返回入口与右栏顺序', () => {
  const editor = src('components/PromptEditor.tsx');
  assert.ok(editor.includes('data-testid="editor-back"'), '编辑器需要返回按钮');
  assert.ok(editor.includes('返回详情') && editor.includes('返回列表'), '按来源显示 返回详情 / 返回列表');
  assert.ok(editor.includes('Breadcrumb'), '建议提供可点面包屑');
  assert.ok(editor.includes('onBackToDetail'), '返回详情回调要接上');
  const markdownAt = editor.indexOf('data-testid="pm-panel-markdown"');
  const variablesAt = editor.indexOf('data-testid="pm-panel-variables"');
  const versionsAt = editor.indexOf('data-testid="pm-panel-versions"');
  assert.ok(markdownAt >= 0 && variablesAt > markdownAt && versionsAt > variablesAt, '右栏顺序必须是 预览 → 变量 → 版本');
});

test('AC-57：四个屏都使用真正的收藏控件', () => {
  const star = src('components/FavoriteStar.tsx');
  assert.ok(star.includes('pm-fav-btn'), '星标走统一的 .pm-fav-btn（热区 ≥24×24）');
  assert.ok(star.includes('aria-label'), '星标要有 aria-label');
  assert.ok(star.includes('Tooltip'), '星标要有 tooltip');
  assert.ok(star.includes('onToggle'), '星标必须真的可点（回调）');
  const surfaces: Array<[string, string]> = [
    ['components/SplitView.tsx', 'pm-fav-split-'],
    ['components/UseView.tsx', 'pm-fav-card-'],
    ['components/UseView.tsx', 'pm-fav-table-'],
    ['components/PromptDetail.tsx', 'pm-fav-detail-'],
  ];
  for (const [file, testid] of surfaces) {
    assert.ok(src(file).includes(testid), `${file} 缺少收藏锚点 ${testid}`);
  }
  const css = readFileSync(path.join(ROOT, 'web', 'src', 'styles', 'app.css'), 'utf8');
  assert.ok(/\.pm-fav-btn\.ant-btn\s*\{[^}]*width:\s*24px/s.test(css), '.pm-fav-btn 热区必须 ≥24×24');
});

test('AC-58：跟随系统 = 太阳 + 月亮（不再用电脑图标）', () => {
  const header = src('components/AppHeader.tsx');
  assert.equal(header.includes('DesktopOutlined'), false, '不得再用 DesktopOutlined');
  assert.ok(header.includes('pm-theme-icon-both'), '跟随系统态要并排两个图标');
  assert.ok(header.includes('SunOutlined') && header.includes('MoonOutlined'), '太阳 + 月亮');
});

/* ============================================================
   v22（BRIEF FR-59 / AC-59 / D-26）：全站同一枚图标，只换尺寸
   ============================================================ */

const PUBLIC_DIR = path.join(ROOT, 'web', 'public');

test('AC-59 ②：index.html 四条 link/meta + title 严格等于 PromptManager', () => {
  const html = readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  for (const line of [
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    '<link rel="icon" href="/favicon.ico" sizes="any" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<meta name="theme-color" content="#5e6ad2" />',
  ]) {
    assert.ok(html.includes(line), `index.html 缺少：${line}`);
  }
  assert.ok(/<title>PromptManager<\/title>/.test(html), '<title> 必须严格等于 PromptManager');
});

test('AC-59 ①⑤：favicon 家族与三处装饰位资产齐全，且单张 ≤250KB', () => {
  const required = [
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'promptmanager-icon.svg',
    'promptmanager-96.png',
    'promptmanager-72.png',
    'promptmanager-48.png',
  ];
  for (const name of required) {
    const file = path.join(PUBLIC_DIR, name);
    assert.ok(existsSync(file), `web/public 缺少 ${name}`);
    assert.ok(statSync(file).size <= 250 * 1024, `${name} 超过 250KB`);
  }
});

test('AC-59 ⑤：不得引入第三种图形（folder-art / source-1254）', () => {
  const offenders = files.filter((file) => /folder-art|source-1254/.test(file.text)).map((file) => file.rel);
  assert.deepEqual(offenders, [], `仍引用了已撤销的插画资产：${offenders.join(', ')}`);
});

test('AC-59 ③④：顶栏 mark 26 用矢量；三处装饰位尺寸正确且无点击', () => {
  const header = src('components/AppHeader.tsx');
  assert.ok(header.includes('/promptmanager-icon.svg'), '顶栏 mark 必须用矢量 promptmanager-icon.svg');
  assert.ok(header.includes('width={26}') && header.includes('height={26}'), '顶栏 mark 必须是 26×26');
  assert.ok(/\.pm-brand\s*\{[^}]*gap:\s*9px/s.test(readFileSync(path.join(ROOT, 'web', 'src', 'styles', 'app.css'), 'utf8')), 'mark 与文字间距 9px');

  const login = src('components/LoginPage.tsx');
  assert.ok(login.includes('/promptmanager-96.png') && login.includes('width={96}'), '登录页要用 96');
  assert.ok(/aria-hidden="true"/.test(login), '登录页装饰位要 aria-hidden');

  const states = src('components/States.tsx');
  assert.ok(states.includes('/promptmanager-72.png') && states.includes('width={72}'), '空态要用 72');

  const about = src('components/AboutModal.tsx');
  assert.ok(about.includes('/promptmanager-48.png') && about.includes('width={48}'), '关于页要用 48');
  assert.ok(/aria-hidden="true"/.test(about), '关于页装饰位要 aria-hidden');

  // 三处装饰位不得有点击/hover/动画
  const css = readFileSync(path.join(ROOT, 'web', 'src', 'styles', 'app.css'), 'utf8');
  assert.ok(/\.pm-brand-art\s*\{[^}]*box-shadow:\s*none/s.test(css), '装饰图不得有阴影');
  assert.equal(/\.pm-brand-art[^{]*\{[^}]*animation/s.test(css), false, '装饰图不得有动画');
});
