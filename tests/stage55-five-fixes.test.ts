// 阶段 55 / FR-119 ~ FR-123 / AC-119 ⑮：为**可量化**的部分补自动化断言，防止后续回归。
//
// 本文件是**源码级 / 纯逻辑级**断言（不依赖浏览器）；真浏览器的像素与几何证据见
// tools/ac-stage55.sh + tools/ac-stage55-verify.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const usageDrawer = src('web/src/components/UsageDrawer.tsx');
const useView = src('web/src/components/UseView.tsx');
const splitView = src('web/src/components/SplitView.tsx');
const tokenDrawer = src('web/src/components/TokenDrawer.tsx');
const theme = src('web/src/theme.ts');
const usageSvc = src('src/services/usage.ts');

/** WCAG 相对亮度与对比度（与 ac-stage55.sh 里那份算法一致） */
function srgbToLin(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function relLum(hex: string): number {
  const h = hex.replace('#', '');
  const ch = (i: number): number => srgbToLin(parseInt(h.slice(i, i + 2), 16) || 0);
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
function contrast(a: string, b: string): number {
  const sorted: number[] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return ((sorted[0] ?? 0) + 0.05) / ((sorted[1] ?? 0) + 0.05);
}
const pick = (re: RegExp, label: string): { light: string; dark: string } => {
  const m = re.exec(theme);
  assert.ok(m !== null && m[1] !== undefined && m[2] !== undefined, `主题里找不到 ${label}`);
  return { dark: m[1], light: m[2] };
};

// ══════════════ ① FR-119 使用统计口径文案 ══════════════

test('AC-119 ①：两处口径文案都不再声称「打开详情」计入', () => {
  // 「口径」行：从 label 往后找 children（中间可能有任意多行注释）
  const kouJing = /label: '口径',([\s\S]{0,600}?)children: '([^']+)'/.exec(usageDrawer);
  assert.ok(kouJing !== null, '找不到「口径」行的文案');
  const text = kouJing[2] ?? '';
  assert.equal(text.includes('（打开详情 /'), false, `口径行不得再写"（打开详情 / …）"：${text}`);
  assert.match(text, /打开详情[^；]*不计/, `口径行要明确说明打开详情不计：${text}`);
  assert.match(text, /复制/, '口径行应写明"复制"计入');
  assert.match(text, /MCP/, '口径行应写明"MCP 取用"计入');

  // 空态提示
  const hint = /hint="([^"]*打开详情[^"]*)"/.exec(usageDrawer);
  assert.ok(hint !== null, '找不到空态提示文案');
  const h = hint[1] ?? '';
  assert.match(h, /打开详情只留痕、不计入/, `空态提示应说明打开详情只留痕不计：${h}`);
  assert.equal(/打开详情[^）]*都会计入/.test(h), false, `空态提示不得说打开详情会计入：${h}`);
});

test('AC-119 ①③：两处口径互相一致（都把「复制」算进去、都排除「打开详情」）', () => {
  // 两处文案必须**同时**满足：出现「复制」+ 明确排除「打开详情」
  const kouJing = /label: '口径',([\s\S]{0,600}?)children: '([^']+)'/.exec(usageDrawer)?.[2] ?? '';
  const emptyHint = /hint="([^"]*计入[^"]*)"/.exec(usageDrawer)?.[1] ?? '';
  assert.ok(kouJing.length > 0, '口径行文案缺失');
  assert.ok(emptyHint.length > 0, '空态提示文案缺失');

  for (const [where, text] of [['口径行', kouJing], ['空态提示', emptyHint]] as const) {
    assert.match(text, /复制/, `${where}必须写明"复制"计入`);
    assert.match(text, /打开详情/, `${where}必须提到"打开详情"（并说明它不计）`);
    assert.match(text, /不计/, `${where}必须明确说"不计"`);
    // 关键红线：不得出现"打开详情…计入/都会计入"这种肯定式表述
    assert.equal(/打开详情\s*[/、和]?\s*[^，。；]{0,8}计入(?!；打开详情)/.test(text) && !/打开详情[^；]*不计/.test(text), false,
      `${where}不得声称打开详情计入：${text}`);
  }
});

test('AC-119 ②：口径本身（COUNTED_KINDS）没被动过', () => {
  assert.match(
    usageSvc,
    /COUNTED_KINDS: readonly UsageKind\[\] = \['copy', 'mcp'\]/,
    'COUNTED_KINDS 必须仍是 copy+mcp（本轮只改文案，不改口径）',
  );
  assert.match(usageSvc, /export type UsageKind = 'view' \| 'copy' \| 'mcp'/, 'UsageKind 取值未变');
});

// ══════════════ ② FR-120 空态区分 ══════════════

test('AC-119 ②⑥：空态按「是否带筛选」判定，两处视图共用同一份文案', () => {
  // 判定依据必须是「有没有搜索/筛选条件」，不是靠 items.length 猜
  assert.match(useView, /const hasActiveFilter = query !== '' \|\| filters\.folderId !== null \|\| filters\.tag !== null \|\| filters\.favorite;/,
    '必须按搜索/筛选条件判定空态（hasActiveFilter）');
  assert.match(useView, /const trulyEmpty = !hasActiveFilter;/, 'trulyEmpty 应由 hasActiveFilter 推导，避免两套口径');

  // 两套文案：有筛选 → 「没有匹配的条目」；无筛选 → 保留原句
  assert.match(useView, /hasActiveFilter \? '没有匹配的条目' : '还没有可用的 prompt'/,
    '主标题必须区分两种场景');
  // 卡片/表格视图用它
  assert.match(useView, /<EmptyState\s*\n\s*title=\{emptyTitle\}\s*\n\s*hint=\{emptyHint\}/,
    '卡片/表格视图的空态要用 emptyTitle/emptyHint');
  // 分栏视图由 UseView 下发，不自己判断（AC-119 ⑥）
  assert.match(useView, /emptyTitle=\{emptyTitle\}\s*\n\s*emptyHint=\{emptyHint\}/, '必须把文案下发给 SplitView');
  assert.match(splitView, /title=\{emptyTitle\} hint=\{emptyHint\}/, 'SplitView 必须用下发的文案');
  assert.equal(splitView.includes('title="还没有可用的 prompt"'), false,
    'SplitView 不得再自己写死「还没有可用的 prompt」（否则两处口径会漂移）');
});

// ══════════════ ③ FR-121 分隔符对比度 ══════════════

test('AC-119 ⑦：分隔符对比度亮/暗均 ≥ 3:1，且仍比正文淡', () => {
  const faint = pick(/inkFaint:\s*prefersDark\s*\?\s*'(#[0-9a-f]{6})'\s*:\s*'(#[0-9a-f]{6})'/, 'inkFaint');
  const subtle = pick(/inkSubtle:\s*prefersDark\s*\?\s*'(#[0-9a-f]{6})'\s*:\s*'(#[0-9a-f]{6})'/, 'inkSubtle');
  const surface1 = /surface1:\s*prefersDark\s*\?\s*'(#[0-9a-f]{6})'\s*:\s*'(#[0-9a-f]{6})'/.exec(theme);
  assert.ok(surface1 !== null, '找不到 surface1（卡片底色）');
  const bgLight = surface1[2] ?? '#ffffff';
  const bgDark = surface1[1] ?? '#0f1011';

  const cLight = contrast(faint.light, bgLight);
  const cDark = contrast(faint.dark, bgDark);
  assert.ok(cLight >= 3, `亮色分隔符对比度 ${cLight.toFixed(2)}:1 必须 ≥ 3:1`);
  assert.ok(cDark >= 3, `深色分隔符对比度 ${cDark.toFixed(2)}:1 必须 ≥ 3:1`);
  // 仍要比正文淡（不喧宾夺主）
  assert.ok(cLight < contrast(subtle.light, bgLight), '亮色分隔符仍须比正文淡');
  assert.ok(cDark < contrast(subtle.dark, bgDark), '深色分隔符仍须比正文淡');
});

test('AC-119 ⑧：分隔符形态未变（字形/宽度/gap/aria-hidden/不可选中）', () => {
  // 字形仍是「·」两个分隔元素
  const seps = [...useView.matchAll(/<span aria-hidden className="pm-meta-sep">·<\/span>/g)];
  assert.equal(seps.length, 2, '仍应是两个「·」分隔元素');
  // gap 仍是 6
  assert.match(useView, /<Flex gap=\{6\} wrap align="center"/, '元信息 Flex 的 gap 必须仍是 6px');
  assert.equal(/<Flex gap=\{10\} wrap align="center"/.test(useView), false, '不得回到 10px');
  // 不可选中
  const rule = useView.includes('pm-meta-sep');
  assert.ok(rule, 'className 仍在');
  const css = src('web/src/styles/app.css');
  const block = css.slice(css.indexOf('.pm-meta-sep'));
  assert.match(block.slice(0, 260), /user-select:\s*none/, '分隔符必须 user-select:none');
  assert.match(block.slice(0, 260), /-webkit-user-select:\s*none/, '需同时给 -webkit- 前缀');
  // 颜色仍走变量（不是写死色值）
  assert.match(block.slice(0, 260), /var\(--pm-ink-faint\)/, '分隔符颜色必须走 --pm-ink-faint');
});

// ══════════════ ④ FR-122 Token 掩码单行 ══════════════

test('AC-119 ⑨⑩：掩码单行，且宽度约束是推导出来的（手写 x 的老坑不复现）', () => {
  // nowrap
  assert.match(tokenDrawer, /style=\{\{ fontSize: 12, whiteSpace: 'nowrap' \}\}/, '掩码单元格必须 nowrap（不折行）');
  // 掩码列宽只加宽到"够放 12 个等宽字符"，不是随手拍
  const minW = /const TOKEN_MASK_MIN_WIDTH = (\d+);/.exec(tokenDrawer);
  assert.ok(minW !== null, '找不到 TOKEN_MASK_MIN_WIDTH');
  const n = Number(minW[1]);
  // 12 字（5 + '...' + 4）× 12px 等宽 0.6em ≈ 86.4px + 单元格内边距 ~16px ⇒ ≥102；取 120 留余量
  assert.ok(n >= 110, `掩码列最小宽 ${String(n)}px 不足以放下 12 个等宽字符（需 ≥102px）`);
  // 7 列宽度都 > 0 的下限没被破坏
  for (const [name, min] of [
    ['TOKEN_NAME_MIN_WIDTH', 60], ['TOKEN_MASK_MIN_WIDTH', 120], ['TOKEN_STATE_MIN_WIDTH', 104],
    ['TOKEN_USE_MIN_WIDTH', 76], ['TOKEN_CREATED_MIN_WIDTH', 123], ['TOKEN_LAST_USED_MIN_WIDTH', 123],
    ['TOKEN_ACTION_MIN_WIDTH', 50],
  ] as const) {
    const m = new RegExp(`const ${name} = (\\d+);`).exec(tokenDrawer);
    assert.ok(m !== null, `找不到 ${name}`);
    assert.ok(Number(m[1]) >= min, `${name} 被改小了（下限 ${String(min)}）`);
  }
  // scroll.x 仍是求和推导（阶段 45 的硬规则）
  assert.match(
    tokenDrawer,
    /const TOKEN_TABLE_MIN_WIDTH =\s*\n\s*TOKEN_NAME_MIN_WIDTH \+\s*\n\s*TOKEN_MASK_MIN_WIDTH \+/,
    'TOKEN_TABLE_MIN_WIDTH 必须仍是各列 minWidth 之和（不能手写数值）',
  );
  // ⚠️ 不能用 `scroll={{ x: \d` 这种全文正则 —— 文件顶部的**注释里**就写着当年的
  //    `scroll={{ x: 419 }}` 反面教材，会误报。只断言**真正生效的**那处用的是推导常量。
  assert.match(tokenDrawer, /scroll=\{\{ x: TOKEN_TABLE_MIN_WIDTH \}\}/,
    'Table 的 scroll.x 必须用推导常量 TOKEN_TABLE_MIN_WIDTH');
  const code = tokenDrawer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/scroll=\{\{ x:\s*\d/.test(code), false, '去掉注释后，scroll.x 仍是写死的数字（阶段 44/45 的老坑）');
});

// ══════════════ ⑤ FR-123 文件夹列 ══════════════

test('AC-119 ⑪⑫：移动端「文件夹」列不折行（给最小宽度，不靠缩字号/隐藏）', () => {
  const col = useView.slice(useView.indexOf("title: '文件夹'"), useView.indexOf("title: '版本'"));
  assert.ok(col.length > 0, '找不到「文件夹」列定义');
  assert.match(col, /minWidth: 110,/, '文件夹列必须给 minWidth（≥110px 放得下「AI 协作与验收」）');
  assert.equal(/fontSize:\s*(1[01]|[0-9])\b/.test(col), false, '不得靠缩小字号解决折行');
  assert.equal(/responsive:/.test(col), false, '本实现选择给最小宽度而非移动端隐藏（别两种都上）');
  // 其它列没被动（别顺手改）
  assert.match(useView, /\{ title: '版本', key: 'version', width: 58,/, '「版本」列宽不应被本轮改动');
  assert.match(useView, /\{ title: '变量数', key: 'vars', width: 66,/, '「变量数」列宽不应被本轮改动');
  assert.match(useView, /scroll=\{\{ x: 'max-content' \}\}/, '表格横向滚动配置未变（移动端仍靠它横滚）');
});
