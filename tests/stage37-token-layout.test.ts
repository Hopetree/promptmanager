// 阶段 37（FR-98「4 列 + 折叠」）**已被 v49 的 FR-99 推翻**，AC-100 明确作废。
//
// ⚠️ 本文件**不删除**：按 AC-101 ⑧ 的要求把上一批断言**同步更新为 6 列口径** ——
//   这里保留"FR-98 的两个目标"（**无横向滚动 + 名称不被挤压**）并额外断言
//   **折叠方案已彻底清除**（不能留下任何 4 列/展开的残留）。
//    6 列的列头 / 截断 / 掩码 / 操作语义在 tests/stage38-token-columns.test.ts 里断言。
//    真实像素 + 真鼠标 + 内网 IP 真粘贴在 tools/ac-stage38.sh 里跑。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const raw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8');
/** 负向断言扫"去注释后的代码"（注释里会描述被移除的东西，直接 grep 全文会假红）。 */
const drawer = raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('FR-98 → FR-99：折叠方案已彻底清除（不再有 4 列口径与任何展开入口）', () => {
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(titles.length, 6, `不得再是 4 列（实际 ${JSON.stringify(titles)}）`);
  assert.deepEqual(titles.slice(0, 4), ['名称', 'Token', '状态', '使用']);
  for (const gone of ['expandable', 'expandedRowRender', 'pm-token-expand-', 'pm-token-details-', 'pm-token-lastused-']) {
    assert.equal(drawer.includes(gone), false, `不得残留折叠实现：${gone}`);
  }
});

test('FR-98 保留目标 ①：抽屉宽度 ≤ 640（历史 880 → 折叠版 620 → 6 列版 640）', () => {
  const width = /width=\{(\d+)\}/.exec(drawer);
  assert.ok(width !== null, '找不到 Drawer width');
  assert.ok(Number(width[1]) <= 640, `抽屉宽度必须 ≤640（实际 ${width[1]}）`);
});

test('FR-98 保留目标 ②：名称不被挤压（按字符截断 + title 看全），不再靠折叠解决', () => {
  assert.ok(/truncateTokenName\(/.test(drawer), '名称必须显式按字符截断（FR-99 ②）');
  assert.ok(/onCell: \(token\) => \(\{ title: token\.name \}\)/.test(drawer), '完整名称必须进 title（悬停看全）');
  assert.ok(/textOverflow: 'ellipsis'/.test(drawer), '超长名称还要有 CSS 省略号兜底（不撑破列宽）');
});

test('FR-98 保留目标 ③：不设 scroll.x（表格自适应 ⇒ 无横向滚动）', () => {
  assert.equal(/scroll=\{\{\s*x:/.test(drawer), false, '不得设 scroll.x');
  assert.ok(/tableLayout="fixed"/.test(drawer), 'fixed 布局让列宽可控（避免时间列被挤裁）');
});

test('FR-98 的「显示」入口随折叠一起移除，且**文案随之修正**（不再指向不存在的入口）', () => {
  assert.equal(/pm-token-show-/.test(drawer), false, '「显示」按钮必须已移除');
  assert.equal(drawer.includes('「显示」'), false, '不得再出现指向已移除入口的文案');
  assert.ok(/pm token reveal/.test(drawer), '失败提示改为指向真实存在路径（命令行）');
});

test('FR-98 的展开区内容已回到列里（最近使用 / 操作）', () => {
  assert.ok(/title: '最近使用'/.test(drawer), '「最近使用」必须回到列头');
  assert.ok(/title: '操作'/.test(drawer), '「操作」必须回到列头');
  assert.ok(/dataIndex: 'last_used_at'/.test(drawer), '最近使用直接取 last_used_at');
  assert.ok(/pm-token-revoke-/.test(drawer) && /pm-token-delete-/.test(drawer), '操作列仍按撤销/删除分支');
});

test('FR-98/99 之间 FR-95 语义保持不变（预取 / 同步写 / 关抽屉即清）', () => {
  assert.ok(/api\.revealToken\(token\.id\)/.test(drawer), '仍须预取明文');
  assert.ok(/setPlaintexts\(new Map\(\)\)/.test(drawer), '关抽屉仍须清空明文缓存');
  const handler = drawer.slice(drawer.indexOf('const copyPlaintext'), drawer.indexOf('const revoke'));
  const writeAt = handler.indexOf('writeClipboard(plaintext)');
  assert.ok(writeAt > 0, '仍须同步写剪贴板');
  assert.equal(/\bawait\b/.test(handler.slice(0, writeAt)), false, 'writeClipboard 之前仍不得 await');
});
