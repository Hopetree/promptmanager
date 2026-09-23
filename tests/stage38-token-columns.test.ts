// 阶段 38 / FR-99（BRIEF v49 §4 + §8 AC-101）令牌列表**固定 6 列**（去掉折叠）断言。
//
// ⚠️ 本文件是 **tests/stage37-token-layout.test.ts 的接替者**：v48 的 FR-98「4 列 + 折叠」被用户推翻，
//    AC-100 作废；这里按 FR-99 的 6 列口径**逐条改写**上一批断言（列头/宽度/名称/使用/操作/回归），
//    并**新增**截断与掩码两条规则的断言。真实像素 + 真鼠标 + 内网 IP 真粘贴在 tools/ac-stage38.sh 里跑。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const raw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8');
/** 负向断言扫"去注释后的代码"（注释里会**描述**被移除的东西，直接 grep 全文会假红）。 */
const drawer = raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('AC-101 ①：列头**按顺序恰好 6 列** 名称/Token/状态/使用/最近使用/操作', () => {
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(
    titles,
    ['名称', 'Token', '状态', '使用', '创建时间', '最近使用', '操作'],
    `列头必须恰好这七个且按此顺序（实际 ${JSON.stringify(titles)}）`,
  );
});

test('AC-101 ①：**不存在折叠** —— 源码里没有 expandable / 展开箭头 / 展开相关 testid（对应用例同步改写，不是删掉了事）', () => {
  for (const gone of [
    'expandable',
    'expandedRowRender',
    'expandedRowKeys',
    'onExpandedRowsChange',
    'rowExpandable',
    'expandIcon',
    'toggleExpanded',
    'pm-token-expand-',
    'pm-token-details-',
    'pm-token-lastused-',
    'pm-token-plaintext-',
    'DownOutlined',
    'RightOutlined',
    'EyeOutlined',
  ]) {
    assert.equal(drawer.includes(gone), false, `FR-99 要求移除折叠 ⇒ 不应再出现 ${gone}`);
  }
  // 「显示」按钮随折叠一起移除；「最近使用」「操作」回到列里（上面已断列头）
  assert.equal(drawer.includes('收起'), false, '不应再有「收起」（折叠态遗留）');
});

test('AC-101 ②③：名称按**字符**截断（20 + 省略号，完整名进 title）；Token 用**脱敏**掩码渲染', () => {
  assert.ok(/truncateTokenName\(value\)/.test(drawer), '名称必须走 truncateTokenName（纯函数，单测覆盖）');
  assert.ok(/onCell: \(token\) => \(\{ title: token\.name \}\)/.test(drawer), '名称**完整值必须进单元格 title**（悬停看全）');
  assert.equal(/ellipsis: true/.test(drawer), false, '不要用 antd 的 ellipsis（它会把 title 设成截断后的文本）');
  assert.ok(/maskToken\(plaintext\)/.test(drawer), 'Token 列必须走 maskToken（前 5 + ... + 后 4）');
  // 掩码只在**页面文本**里出现；完整明文仍只用于写剪贴板
  const maskCol = drawer.slice(drawer.indexOf("title: 'Token'"), drawer.indexOf("title: '状态'"));
  assert.ok(/plaintexts\.get\(token\.id\)/.test(maskCol), '掩码数据来自**预取到内存的明文**');
  assert.ok(/—/.test(maskCol), '取不到明文（旧令牌 / 已撤销）⇒ `—`');
});

test('AC-101 ①⑦（v55 修订）：抽屉 ≤640、**必须**设 scroll.x、tableLayout=fixed（否则列宽会被 antd 重分配把时间挤裁）', () => {
  const width = /width=\{(\d+)\}/.exec(drawer);
  assert.ok(width !== null, '找不到 Drawer width');
  /** v58（FR-111）：列变 7 列后允许加宽到 720（用户明确允许；判据=PC 无横滚）。 */
  assert.ok(Number(width[1]) >= 640 && Number(width[1]) <= 720, `抽屉宽度须在 640–720（实际 ${width[1]}）`);
  /**
   * ⚠️ **v55（FR-106）改写**：原文"不得设 scroll.x（要求无横向滚动）"是按 640 宽桌面得出的结论；
   * 手机 390 下抽屉被夹到视口宽，不给 `scroll.x` 会让表格**没有可滚动容器**（两端列都够不着）。
   * 现在要求**设** `scroll.x`；"桌面无横向滚动"改由 AC-108 ⑤ 在 1600×900 上实测
   * `scrollWidth === clientWidth` 来保证（实测比源码断言更强）。
   */
  assert.ok(/scroll=\{\{\s*x:/.test(drawer), '必须设 scroll.x（窄容器下才有可滚动容器）');
  assert.ok(/tableLayout="fixed"/.test(drawer), '必须用 fixed 布局（auto 会把「最近使用」挤到 ~73px 导致时间被裁）');
});

test('AC-101 ④：使用列只有「复制」（预取 + 同步写 + 点击不发请求），已撤销/不可查看行给 `—`', () => {
  const useCol = drawer.slice(drawer.indexOf("title: '使用'"), drawer.indexOf("title: '最近使用'"));
  assert.ok(/pm-token-copy-/.test(useCol), '有效行必须有「复制」');
  assert.equal(/pm-token-show-/.test(useCol), false, '「显示」按钮已随折叠移除');
  /**
   * ⚠️ v50（FR-100）变更：「使用」列判断**只看 revealable**（撤销行也给「复制」）；
   * 这条断言随之**同步改写**为"只有真正取不到密文的行才 `—`"，不是删掉覆盖。
   */
  assert.ok(/if \(!token\.revealable\) \{/.test(useCol), '只有 revealable=false 才 `—`（撤销行照常给「复制」）');
  assert.equal(/token\.revoked_at !== null \|\| !token\.revealable/.test(useCol), false, '不得再把 revoked_at 作为「使用」列的排除条件');
  const handler = drawer.slice(drawer.indexOf('const copyPlaintext'), drawer.indexOf('const revoke'));
  const writeAt = handler.indexOf('writeClipboard(plaintext)');
  assert.ok(writeAt > 0, '必须调用 writeClipboard(内存里的明文)');
  assert.equal(/\bawait\b/.test(handler.slice(0, writeAt)), false, 'writeClipboard 之前不得 await（否则内网 HTTP 下写不进去）');
  assert.equal(/api\.revealToken/.test(handler), false, '点击「复制」不得发请求');
  assert.ok(/plaintexts\.get\(id\)/.test(handler), '明文必须取自内存缓存');
});

test('AC-101 ④ 文案：复制失败提示指向**真实存在**的路径（命令行 pm token reveal），不再指向已移除的「显示」', () => {
  const code = drawer;
  assert.equal(code.includes('「显示」'), false, '不得再出现指向已移除入口的「显示」文案');
  assert.ok(/pm token reveal/.test(code), '失败提示必须给出命令行取明文的方式');
  assert.ok(/浏览器不允许自动复制/.test(code), '仍要有可读的失败提示');
});

test('AC-101 ⑤：操作列按**是否已撤销**分支 —— 有效→撤销；已撤销→删除（逻辑不变）', () => {
  const actionCol = drawer.slice(drawer.indexOf("title: '操作'"));
  assert.ok(/pm-token-revoke-/.test(actionCol) && /pm-token-delete-/.test(actionCol), '操作列必须含撤销/删除');
  assert.ok(/token\.revoked_at === null \?/.test(actionCol), '必须按 revoked_at 分支');
  assert.ok(/永久删除、不可恢复/.test(actionCol), '删除二次确认必须写明不可恢复');
  // 两者互斥：删除在 else 分支（撤销之后）
  assert.ok(actionCol.indexOf('pm-token-delete-') > actionCol.indexOf('pm-token-revoke-'), '删除必须在撤销的 else 分支里');
});

test('AC-101 ⑥：最近使用回到**列**里（时间文案；从未使用由 formatDateTime 给 `—`）', () => {
  const col = drawer.slice(drawer.indexOf("title: '最近使用'"), drawer.indexOf("title: '操作'"));
  assert.ok(/dataIndex: 'last_used_at'/.test(col), '最近使用必须直接取 last_used_at（回到列里）');
  assert.ok(/formatDateTime\(value\)/.test(col), '必须用统一的时间文案（从未使用显示 —）');
});

test('AC-101 ⑧：FR-95 / FR-97 语义未回归（预取 / 关抽屉即清 / 不落持久存储 / 创建无弹窗且提示不变）', () => {
  assert.ok(/api\.revealToken\(token\.id\)/.test(drawer), '仍须预取明文（掩码与复制都靠它）');
  assert.ok(/Promise\.all\(/.test(drawer), '仍须并发预取');
  assert.ok(/setPlaintexts\(new Map\(\)\)/.test(drawer), '关抽屉必须清空明文缓存');
  assert.ok(/destroyOnHidden/.test(drawer), '仍须 destroyOnHidden');
  assert.equal(/localStorage|sessionStorage/.test(drawer), false, '明文仍不得写持久存储');
  assert.equal(/\bModal\b/.test(drawer), false, '不得再有明文弹窗（FR-97）');
  assert.ok(/message\.success\('已创建；点列表里的「复制」取明文'\)/.test(drawer), '创建提示必须保持不变');
  assert.ok(/pm-token-name/.test(drawer) && /pm-token-create/.test(drawer), '创建区必须在');
  assert.ok(/<ReloadOutlined \/>/.test(drawer), '刷新按钮必须在');
  assert.ok(/Token 与本人等价/.test(drawer), '说明文案必须在');
});
