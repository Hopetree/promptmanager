// 阶段 37 / FR-98（BRIEF v48 §4 + §8 AC-100）令牌列表**折叠排版**断言。
//
// 这里覆盖**前端源码级**结构（列头/顺序、两种展开入口、展开区三块、宽度）；
// **真实像素 + 真鼠标 + 内网 IP 非安全上下文**下的行为在 tools/ac-stage37.sh + ac-stage37-probe.mjs 里跑。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const raw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8');
/** 负向断言扫"去注释后的代码"（注释里会描述这些规则，直接 grep 全文会假红）。 */
const drawer = raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('AC-100 ②：折叠态列头**按顺序**恰好 名称 / 状态 / 创建时间 / 使用（无「最近使用」「操作」列）', () => {
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(titles, ['名称', '状态', '创建时间', '使用'], `列头必须恰好这四个且按此顺序（实际 ${JSON.stringify(titles)}）`);
  // 「最近使用」「操作」不得再作为列头（它们已在展开区）
  assert.equal(/title: '最近使用'/.test(drawer), false, '「最近使用」不得再作为列头');
  assert.equal(/title: '操作'/.test(drawer), false, '「操作」不得再作为列头');
  assert.equal(/title: '令牌'/.test(drawer), false, '旧的「令牌」列应已并入「使用」');
});

test('AC-100 ①：抽屉宽度 ≤ 640，表格不设 scroll.x（自适应 ⇒ 无横向滚动），名称列不 ellipsis', () => {
  const width = /width=\{(\d+)\}/.exec(drawer);
  assert.ok(width !== null, '找不到 Drawer width');
  assert.ok(Number(width[1]) <= 640, `抽屉宽度必须 ≤640（实际 ${width[1]}）`);
  assert.equal(/scroll=\{\{\s*x:/.test(drawer), false, '不得设 scroll.x（那会造成横向滚动）');
  // 名称列：不设固定宽 + 不 ellipsis（靠换行保证完整显示）
  const nameCol = drawer.slice(drawer.indexOf("title: '名称'"), drawer.indexOf("title: '状态'"));
  assert.equal(/ellipsis/.test(nameCol), false, '名称列不得 ellipsis（否则又会出现 "A…"）');
  assert.equal(/width:/.test(nameCol), false, '名称列不应固定宽度（让它吃掉剩余空间）');
});

test('AC-100 ③：两种展开入口都接同一个展开状态（「显示」按钮 + 每行行展开箭头）', () => {
  // 「显示」= 切换展开
  assert.ok(/onClick=\{\(\) => toggleExpanded\(token\.id\)\}/.test(drawer), '「显示」必须切换展开态');
  assert.ok(/expanded\.includes\(token\.id\) \? '收起' : '显示'/.test(drawer), '「显示」应在展开后变「收起」');
  // antd 行展开：expandedRowKeys + onExpandedRowsChange + rowExpandable（每行都能展开）
  assert.ok(/expandedRowKeys: expanded/.test(drawer), '必须把展开态交给 antd（expandedRowKeys）');
  assert.ok(/onExpandedRowsChange/.test(drawer), '必须接 onExpandedRowsChange（点箭头能改状态）');
  assert.ok(/rowExpandable: \(\) => true/.test(drawer), '必须**每行都能展开**（含已撤销行 ⇒「删除」可达）');
  const openers = drawer.match(/pm-token-expand-\$\{String\(\(record as TokenSummary\)\.id\)\}/g) ?? [];
  assert.ok(openers.length >= 1, '行展开入口必须有可定位的 testid（探针要真鼠标点它）');
});

test('AC-100 ④：展开区三块 —— 明文 / 最近使用 / 操作（有效→撤销；已撤销→删除，逻辑不变）', () => {
  const details = drawer.slice(drawer.indexOf('const renderDetails'), drawer.indexOf('return (\n    <Drawer'));
  assert.ok(/pm-token-details-/.test(details), '展开区必须有容器 testid');
  // ① 明文（可选中）
  assert.ok(/pm-token-plaintext-/.test(details), '展开区必须渲染明文节点');
  assert.ok(/userSelect: 'text'/.test(details), '明文必须显式 userSelect:text（antd 6 Typography 默认 none）');
  // ② 最近使用
  assert.ok(/最近使用：/.test(details), '展开区必须含「最近使用」');
  assert.ok(/formatDateTime\(token\.last_used_at\)/.test(details), '最近使用必须显示时间文案');
  // ③ 操作：按 revoked_at 分支
  assert.ok(/pm-token-revoke-/.test(details) && /pm-token-delete-/.test(details), '展开区必须含撤销/删除');
  assert.ok(/token\.revoked_at === null \? \(/.test(details), '操作必须按「是否已撤销」分支');
  assert.ok(/永久删除、不可恢复/.test(details), '删除二次确认必须写明不可恢复');
  // 折叠态不再有操作按钮（只有展开区有）
  const columnsPart = drawer.slice(drawer.indexOf('const columns'), drawer.indexOf('const renderDetails'));
  assert.equal(/pm-token-revoke-|pm-token-delete-/.test(columnsPart), false, '折叠态列里不得出现撤销/删除');
});

test('AC-100 ③：不可查看 / 已撤销行的「使用」列给 `—`（语义不变）', () => {
  const useCol = drawer.slice(drawer.indexOf("title: '使用'"), drawer.indexOf('const renderDetails'));
  assert.ok(/token\.revoked_at !== null \|\| !token\.revealable/.test(useCol), '已撤销或不可查看 → 走 `—` 分支');
  assert.ok(/pm-token-copy-/.test(useCol) && /pm-token-show-/.test(useCol), '可查看行必须有「复制」+「显示」');
});

test('AC-100 ⑦：FR-95 语义未回归（预取 / 同步复制 / 关抽屉即清 / 不落持久存储）', () => {
  assert.ok(/api\.revealToken\(token\.id\)/.test(drawer), '仍须预取明文');
  assert.ok(/Promise\.all\(/.test(drawer), '仍须并发预取');
  const handler = drawer.slice(drawer.indexOf('const copyPlaintext'), drawer.indexOf('const toggleExpanded'));
  const writeAt = handler.indexOf('writeClipboard(plaintext)');
  assert.ok(writeAt > 0, '仍须调用 writeClipboard');
  assert.equal(/\bawait\b/.test(handler.slice(0, writeAt)), false, 'writeBoard 之前仍不得 await');
  assert.equal(/api\.revealToken/.test(handler), false, '点「复制」仍不得再发 reveal');
  assert.ok(/setPlaintexts\(new Map\(\)\)/.test(drawer), '关抽屉仍须清空明文缓存');
  assert.ok(/setExpanded\(\[\]\)/.test(drawer), '关抽屉也应清空展开态');
  assert.ok(/destroyOnHidden/.test(drawer), '仍须 destroyOnHidden');
  assert.equal(/localStorage|sessionStorage/.test(drawer), false, '明文仍不得写持久存储');
});

test('AC-100 ⑦：FR-97 语义未回归（创建无明文弹窗 + 提示不变 + 列表刷新）', () => {
  assert.equal(/\bModal\b/.test(drawer), false, '不得再有明文 Modal');
  assert.ok(/message\.success\('已创建；点列表里的「复制」取明文'\)/.test(drawer), '创建提示必须保持不变');
  assert.ok(/await load\(\)/.test(drawer), '创建后必须刷新列表');
  // 创建区与刷新按钮仍在
  assert.ok(/pm-token-name/.test(drawer) && /pm-token-create/.test(drawer), '创建区必须在');
  assert.ok(/<ReloadOutlined \/>/.test(drawer), '刷新按钮必须在');
  assert.ok(/Token 与本人等价/.test(drawer), '说明文案必须在');
});
