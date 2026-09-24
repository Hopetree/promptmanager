// 阶段 52 / FR-116（BRIEF v63 §4 + §8 AC-117）：卡片视图底部元信息
//   = 所属目录（带图标·排最前·只要目录名）+ 版本 + 变量数；去掉取用数与日期；
//     相邻两项之间有可见「·」分隔符，项间距 6px，分隔符更淡且不可被复制/选中。
//
// 本文件是**源码级 + jsdom 级**断言；真浏览器的像素/间距/图标/截图证据见
// tools/ac-stage52.sh 与 tools/ac-stage52-probe.mjs（AC-117 ①–⑨）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CARD_FOLDER_FALLBACK, folderNameOf } from '../web/src/pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const useView = src('components/UseView.tsx');
const css = src('styles/app.css');
const theme = src('theme.ts');

/** 只截卡片那一行元信息（metaLine 的定义块），避免把表格列里的同名字段误判进来。 */
const metaBlock = ((): string => {
  const at = useView.indexOf('const metaLine = (prompt: Prompt)');
  assert.ok(at > 0, '找不到 metaLine 定义');
  return useView.slice(at, useView.indexOf('/** 卡片渲染', at));
})();

const folders: { id: number; name: string; parent_id: number | null; sort_order: number }[] = [
  { id: 1, name: '工作', parent_id: null, sort_order: 0 },
  { id: 2, name: 'AI 协作与验收', parent_id: 1, sort_order: 0 },
  { id: 3, name: '', parent_id: 1, sort_order: 1 },
];

test('AC-117 ②（源码）：目录项用 folders 映射出目录名，不是只渲染 folder_id', () => {
  assert.ok(metaBlock.includes('folderNameOf(folders, prompt.folder_id)'), '目录项必须走 folderNameOf(folders, …)');
  assert.equal(/prompt\.folder_id\s*[,)}]/.test(metaBlock.replace(/folderNameOf\(folders, prompt\.folder_id\)/g, '')), false, '不得把 folder_id 数字直接渲染出来');
});

test('AC-117 ②（逻辑）：folderNameOf 只给目录名，不带父级路径、不出现数字', () => {
  assert.equal(folderNameOf(folders, 2), 'AI 协作与验收');
  // 父目录 id=1 的 prompt 也只得到「工作」本身
  assert.equal(folderNameOf(folders, 1), '工作');
  // 即便库里存了「父/子」字面量，也只取最后一段（绝不拼路径）
  assert.equal(folderNameOf([{ id: 9, name: '工作/AI 协作与验收', parent_id: null, sort_order: 0 }], 9), 'AI 协作与验收');
  for (const id of [1, 2]) {
    const name = folderNameOf(folders, id);
    assert.equal(name.includes('/'), false, `「${name}」不得含路径分隔符`);
    assert.equal(name.includes(String(id)), false, `「${name}」不得出现 folder_id 数字`);
  }
});

test('AC-117 ③（逻辑）：无目录 / 目录已被删 / 目录名为空 ⇒ 一律「未分组」，绝不 null/undefined/空白', () => {
  assert.equal(CARD_FOLDER_FALLBACK, '未分组');
  assert.equal(folderNameOf(folders, null), '未分组', 'folder_id = NULL ⇒ 未分组');
  assert.equal(folderNameOf(folders, undefined), '未分组');
  assert.equal(folderNameOf(folders, 999), '未分组', '目录已被删（映射不到）⇒ 未分组，不是空白');
  assert.equal(folderNameOf(folders, 3), '未分组', '目录名为空串 ⇒ 未分组');
  assert.equal(folderNameOf([], 2), '未分组', 'folders 还没加载出来 ⇒ 未分组（不是空白）');
  for (const bad of [null, undefined]) {
    const out = folderNameOf(folders, bad as number | null | undefined);
    assert.equal(out.includes('null'), false);
    assert.equal(out.includes('undefined'), false);
    assert.notEqual(out.trim(), '');
  }
});

test('AC-117 ①④：metaLine 里目录排最前，且带图标；版本与变量数保留', () => {
  const folderAt = metaBlock.indexOf('pm-card-folder-');
  const versionAt = metaBlock.indexOf('v{prompt.version_no}');
  const varsAt = metaBlock.indexOf('变量 {varCount(prompt)}');
  assert.ok(folderAt > 0 && versionAt > 0 && varsAt > 0, '目录 / 版本 / 变量数三件都要在');
  assert.ok(folderAt < versionAt, '目录项必须排在版本**之前**');
  assert.ok(versionAt < varsAt, '顺序必须是 目录 → 版本 → 变量数');
  // 带图标（文件夹类图标，来自组件库 @ant-design/icons）
  const iconAt = metaBlock.indexOf('<FolderOpenOutlined');
  assert.ok(iconAt > 0, '目录项必须带文件夹图标元素');
  assert.ok(iconAt < versionAt, '图标属于目录项（在版本之前）');
  assert.ok(useView.includes("from '@ant-design/icons'"), '图标来自组件库，不是手搓 svg');
});

test('AC-117 ⑤：metaLine 不再有「取用」与日期', () => {
  assert.equal(metaBlock.includes('取用'), false, '卡片底部不得再出现「取用」');
  assert.equal(metaBlock.includes('use_count'), false, '卡片底部不得再读 use_count');
  assert.equal(metaBlock.includes('formatListDateTime'), false, '卡片底部不得再渲染日期');
  assert.equal(metaBlock.includes('updated_at'), false, '卡片底部不得再读 updated_at');
  // 反向确认：表格视图**仍然**有这两列（FR-116 ③：只改卡片视图）
  const tableAt0 = useView.indexOf('const tableColumns');
  const tableAll = useView.slice(tableAt0, useView.indexOf('\n  ];', tableAt0));
  assert.ok(tableAll.includes("title: '取用次数'"), '表格视图的「取用次数」列必须保留');
  assert.ok(tableAll.includes("title: '更新于'"), '表格视图的「更新于」列必须保留');
  assert.ok(tableAll.includes('formatListDateTime'), '表格视图仍用日期格式化');
});

test('AC-117 ⑤b：相邻两项之间有可见「·」分隔元素，且项间距 = 6px', () => {
  // gap=6 只写在这一个 Flex 上
  const flexAt = metaBlock.indexOf('<Flex gap={6}');
  assert.ok(flexAt > 0, '元信息 Flex 的 gap 必须是 6');
  assert.equal(/gap=\{10\}/.test(metaBlock), false, '元信息 Flex 不得再是 gap=10');
  // 分隔符：恰好两个（夹在三项之间），且是 aria-hidden 的独立元素
  const seps = [...metaBlock.matchAll(/<span aria-hidden className="pm-meta-sep">·<\/span>/g)];
  assert.equal(seps.length, 2, '三项之间必须恰好有 2 个「·」分隔元素');
  assert.ok(metaBlock.includes('aria-hidden'), '分隔符必须 aria-hidden（屏幕阅读器不该念「·」）');
  // 分隔符是装饰、不是内容
  const rule = css.slice(css.indexOf('.pm-meta-sep'));
  const ruleBlock = rule.slice(0, rule.indexOf('}') + 1);
  assert.ok(/user-select:\s*none/.test(ruleBlock), '分隔符必须 user-select:none（不被框选/复制带走）');
  assert.ok(/-webkit-user-select:\s*none/.test(ruleBlock), '同时给 -webkit- 前缀');
  assert.ok(/var\(--pm-ink-faint\)/.test(ruleBlock), '分隔符颜色走更淡的一档变量，不写裸色值');
});

test('AC-117 ⑤b / ⑥：分隔符比正文更淡，且只改了卡片视图这一处的 gap', () => {
  /**
   * 判据 = **与卡片底色的对比度**（不是裸亮度）："更淡"在任何主题下都等于"离底色更近"。
   * 亮色底 `#ffffff`、暗色底 `surface1` `#0f1011`（theme.ts 的 palette）。
   * 拿裸亮度比会在暗色下判反（暗色的"淡"= 更暗 ⇒ 亮度更低），这正是本条断言要防的错。
   */
  const chan = (c: number): number => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = (hex: string): number => {
    const v = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
    return 0.2126 * chan(r ?? 0) + 0.7152 * chan(g ?? 0) + 0.0722 * chan(b ?? 0);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  const pick = (re: RegExp, label: string): { light: string; dark: string } => {
    const m = re.exec(theme);
    assert.ok(m !== null && m[1] !== undefined && m[2] !== undefined, `主题里找不到 ${label}`);
    return { dark: m[1], light: m[2] };
  };
  const faint = pick(/inkFaint:\s*prefersDark\s*\?\s*'(#[0-9a-f]{6})'\s*:\s*'(#[0-9a-f]{6})'/, 'inkFaint');
  const subtle = pick(/inkSubtle:\s*prefersDark\s*\?\s*'(#[0-9a-f]{6})'\s*:\s*'(#[0-9a-f]{6})'/, 'inkSubtle');
  const lightBg = '#ffffff';
  const darkBg = /surface1:\s*prefersDark\s*\?\s*'(#[0-9a-f]{6})'/.exec(theme)?.[1] ?? '#0f1011';
  const cl = contrast(faint.light, lightBg);
  const sl = contrast(subtle.light, lightBg);
  const cd = contrast(faint.dark, darkBg);
  const sd = contrast(subtle.dark, darkBg);
  assert.ok(cl < sl, `亮色下分隔符对比度(${cl.toFixed(2)})必须低于正文(${sl.toFixed(2)}) —— 更淡`);
  assert.ok(cd < sd, `暗色下分隔符对比度(${cd.toFixed(2)})必须低于正文(${sd.toFixed(2)}) —— 更淡`);

  // 只动这一处：卡片内部/标签区/竖向 gap 都没跟着变成 6
  assert.ok(useView.includes('<Flex vertical gap={10}'), '卡片竖向 gap 仍是 10（未回归）');
  assert.ok(useView.includes('<Flex gap={4} wrap>'), '标签区 gap 仍是 4（未回归）');
  assert.ok(useView.includes('<Flex align="center" gap={4}>'), '标题行 gap 仍是 4（未回归）');
});

test('AC-117 ⑦：FR-73 末行贴底与星标/复制/拖拽手柄未被改动', () => {
  assert.ok(useView.includes("marginTop: 'auto'"), 'FR-73 ①：末行 marginTop:auto 仍在');
  assert.ok(useView.includes('data-testid={`pm-card-footer-${String(prompt.id)}`}'), '末行 testid 仍在（AC 靠它量像素）');
  assert.ok(useView.includes('pm-fav-card-'), '星标 testid 仍在');
  assert.ok(useView.includes('pm-copy-${String(prompt.id)}') || useView.includes('`pm-copy-${String(prompt.id)}`'), '复制按钮 testid 仍在');
  assert.ok(useView.includes('context.handle'), '拖拽手柄仍在卡片上');
  // FR-73 ④：无标签不渲染标签区
  assert.ok(useView.includes('prompt.tags.length > 0 && ('), 'FR-73 ④：无标签不渲染标签区，仍成立');
});

test('AC-117 ⑥⑨：表格视图与分栏视图完全没动；接口契约与迁移未动', () => {
  // 表格列一个不多一个不少（顺序也要一致）
  // ⚠️ 切片停在 tableColumns 定义体的 `  ];`（后面还有 Modal 的 title，不能扫进去）
  const tableAt = useView.indexOf('const tableColumns');
  const tableBlock = useView.slice(tableAt, useView.indexOf('\n  ];', tableAt));
  const titles = [...tableBlock.matchAll(/title: '([^']+)'/g)].map((m) => m[1] ?? '');
  assert.deepEqual(titles, ['标题', '标签', '文件夹', '版本', '变量数', '取用次数', '更新于', '操作'], '表格列必须与改前完全一致');
  // 分栏中栏本来就没有元信息行（FR-71），不得被本次改动塞回去
  const split = src('components/SplitView.tsx');
  const itemAt = split.indexOf('data-testid="pm-split-item"');
  const itemBlock = split.slice(itemAt, split.indexOf('</SortableList>', itemAt));
  for (const banned of ['use_count', 'updated_at', 'version_no', 'folderNameOf', 'extractVariablesLocal']) {
    assert.equal(itemBlock.includes(banned), false, `分栏中栏不得出现 ${banned}`);
  }
  // 前端类型契约未改：Prompt 仍是 folder_id（没有新增 folder_name 字段）
  const types = src('types.ts');
  assert.ok(/folder_id: number \| null;/.test(types), 'Prompt.folder_id 语义未变');
  assert.equal(types.includes('folder_name'), false, '没有给契约新增字段（本阶段选择前端映射）');
});
