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
  /**
   * v58（FR-111）改写：原来是"恰好 6 列"（FR-99 固定 6 列的口径）；
   * 用户要求新增「创建时间」⇒ 现在是 **7 列**。这里保留原意（"不得再退回 4 列折叠版"），
   * 并把数量改为 7 —— 断言更严（多一列也要对得上），不是删断言。
   */
  assert.equal(titles.length, 7, `不得再是 4 列折叠版（实际 ${JSON.stringify(titles)}）`);
  assert.deepEqual(titles.slice(0, 4), ['名称', 'Token', '状态', '使用']);
  for (const gone of ['expandable', 'expandedRowRender', 'pm-token-expand-', 'pm-token-details-', 'pm-token-lastused-']) {
    assert.equal(drawer.includes(gone), false, `不得残留折叠实现：${gone}`);
  }
});

test('FR-98 保留目标 ①：抽屉宽度 ≤ 640（历史 880 → 折叠版 620 → 6 列版 640）', () => {
  const width = /width=\{(\d+)\}/.exec(drawer);
  assert.ok(width !== null, '找不到 Drawer width');
  /** v58（FR-111）：列变 7 列后用户明确允许加宽（判据=7 列无横滚都看清），上限放宽到 720。 */
  assert.ok(Number(width[1]) >= 640 && Number(width[1]) <= 720, `抽屉宽度须在 640–720（实际 ${width[1]}）`);
});

test('FR-98 保留目标 ②：名称不被挤压（按字符截断 + title 看全），不再靠折叠解决', () => {
  assert.ok(/truncateTokenName\(/.test(drawer), '名称必须显式按字符截断（FR-99 ②）');
  assert.ok(/onCell: \(token\) => \(\{ title: token\.name \}\)/.test(drawer), '完整名称必须进 title（悬停看全）');
  assert.ok(/textOverflow: 'ellipsis'/.test(drawer), '超长名称还要有 CSS 省略号兜底（不撑破列宽）');
});

test('FR-98 保留目标 ③：表格有可滚动容器（`scroll.x`）且 fixed 布局（v55 修订，见下）', () => {
  /**
   * ⚠️ **v55（FR-106）改写**：原文是"不设 scroll.x ⇒ 无横向滚动"，那是**按 640 宽桌面**得出的结论。
   * 手机 390 下抽屉被夹到视口宽，6 列必然放不下；不给 `scroll.x` 时 antd **不渲染可滚动容器** ⇒
   * 内容溢出表格外、`scrollLeft` 推不动（实测 `scrollWidth 714 > clientWidth 350` 而滚动量恒为 0）⇒ 两端列都够不着。
   * 因此改为**必须**设 `scroll.x`；"桌面无横向滚动"这个**真正的目标**由 AC-108 ⑤ 用
   * `scrollWidth === clientWidth` 在 1600×900 上实测（内容没超就不会出滚动条，比源码断言更强）。
   */
  assert.ok(/scroll=\{\{\s*x:/.test(drawer), '必须设 scroll.x（否则窄容器下表格没有可滚动容器）');
  /**
   * ⚠️ **v56（FR-107）改写**：这里原本钉的是"数值"。但那个数值是**手写的 419**，
   * 小于 6 列实际需求 ⇒ fixed 布局把唯一没有 `width` 的「名称」列压成 0 宽（用户看到"少了一列数据"）。
   * 现在钉的是**由列定义推导出的常量**（各列 `minWidth` 之和）—— 既排除了 `max-content`，
   * 也排除了"再手写一个数字"（那正是 FR-107 的根因）。
   */
  assert.ok(/scroll=\{\{\s*x: [A-Za-z_$][\w$]* \}\}/.test(drawer), 'scroll.x 必须是**由列定义推导的常量**');
  assert.equal(/scroll=\{\{\s*x: 'max-content'/.test(drawer), false, '不得用 max-content（会撑大桌面名称列）');
  assert.equal(/scroll=\{\{\s*x: \d+ \}\}/.test(drawer), false, '不得手写数值（FR-107：419 就是这么把名称列压成 0 的）');
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
