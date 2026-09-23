// 阶段 39 / FR-100（BRIEF v50 §4 + §8 AC-102）**撤销后的 token 仍显示值并支持复制**断言。
//
// 这里覆盖**前端源码级**口径（预取过滤、「使用」列判断、不可恢复行的 title 说明、操作列不变）；
// 真实像素 + 真鼠标 + 内网 IP 真粘贴在 tools/ac-stage39.sh + ac-stage39-probe.mjs 里跑。
// 服务端**一行未改**（`revealToken` 本来就不看 `revoked_at`）= FR-100 的前提，见下面最后一条。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from '../tests/helpers.ts';

const raw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8');
/** 负向断言扫"去注释后的代码"（注释里会**描述**这些规则，直接 grep 全文会假红）。 */
const drawer = raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const tokensService = readFileSync(path.join(PROJECT_ROOT, 'src', 'services', 'tokens.ts'), 'utf8');

test('AC-102 ①：预取过滤**不再排除已撤销行**（只按 revealable 过滤）', () => {
  assert.ok(/filter\(\(token\) => token\.revealable\)/.test(drawer), '预取过滤必须只看 revealable');
  assert.equal(
    /filter\(\(token\) => token\.revealable && token\.revoked_at === null\)/.test(drawer),
    false,
    '不得再按 revoked_at === null 排除撤销行（FR-100 的就是这一条）',
  );
});

test('AC-102 ②：撤销行的「使用」列判断**只看 revealable**（不再看 revoked_at）', () => {
  const useCol = drawer.slice(drawer.indexOf("title: '使用'"), drawer.indexOf("title: '最近使用'"));
  assert.ok(/if \(!token\.revealable\) \{/.test(useCol), '「使用」列必须只按 revealable 判断');
  assert.equal(
    /token\.revoked_at !== null \|\| !token\.revealable/.test(useCol),
    false,
    '不得再把 revoked_at 作为「使用」列的排除条件',
  );
  assert.ok(/pm-token-copy-/.test(useCol), '可查看行（含已撤销）必须有「复制」');
});

test('AC-102 ②：撤销行的「复制」仍是**同步写**（点击不发请求）—— 与未撤销行完全一致', () => {
  const handler = drawer.slice(drawer.indexOf('const copyPlaintext'), drawer.indexOf('const revoke'));
  const writeAt = handler.indexOf('writeClipboard(plaintext)');
  assert.ok(writeAt > 0, '必须调用 writeClipboard(内存里的明文)');
  assert.equal(/\bawait\b/.test(handler.slice(0, writeAt)), false, 'writeClipboard 之前不得 await');
  assert.equal(/api\.revealToken/.test(handler), false, '点击「复制」不得发请求（撤销行同样如此）');
});

test('AC-102 ④：真正不可恢复的行（revealable=false）仍 `—`，且带 title 说明原因（不报错不留白）', () => {
  assert.ok(/const UNREVEALABLE_HINT = '迁移前创建的令牌没有保存可恢复的密文，无法查看；可撤销后重建'/.test(drawer), '必须有统一的"原因"文案常量');
  // Token 列的 — 带 title
  const maskCol = drawer.slice(drawer.indexOf("title: 'Token'"), drawer.indexOf("title: '状态'"));
  assert.ok(/title=\{UNREVEALABLE_HINT\}/.test(maskCol), 'Token 列的 `—` 必须带 title 说明');
  assert.ok(/plaintext === undefined/.test(maskCol), 'Token 列以"取不到明文"为 `—` 条件');
  // 「使用」列的 — 同样带 title
  const useCol = drawer.slice(drawer.indexOf("title: '使用'"), drawer.indexOf("title: '最近使用'"));
  assert.ok(/title=\{UNREVEALABLE_HINT\}/.test(useCol), '「使用」列的 `—` 也必须带同样的 title 说明');
});

test('AC-102 ⑥：操作列与删除逻辑不变（有效→撤销；已撤销→删除，删除在 else 分支）', () => {
  const actionCol = drawer.slice(drawer.indexOf("title: '操作'"));
  assert.ok(/pm-token-revoke-/.test(actionCol) && /pm-token-delete-/.test(actionCol), '操作列必须含撤销/删除');
  assert.ok(/token\.revoked_at === null \?/.test(actionCol), '仍按 revoked_at 分支');
  assert.ok(actionCol.indexOf('pm-token-delete-') > actionCol.indexOf('pm-token-revoke-'), '删除仍只在已撤销分支');
  assert.ok(/永久删除、不可恢复/.test(actionCol), '删除二次确认文案不变');
});

test('AC-102 ⑦：6 列结构 / 宽度 / 折叠已移除 等 FR-99 口径未回归', () => {
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((match) => match[1]);
  /** v58（FR-111）：6 列 → 7 列（新增「创建时间」）；其余顺序与「折叠已移除」等口径一字未改。 */
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '创建时间', '最近使用', '操作'], '列头与顺序必须不变（FR-111 起为 7 列）');
  const width = /width=\{(\d+)\}/.exec(drawer);
  /** v58（FR-111）：列变 7 列后允许加宽到 720（用户明确允许）；原「≤640」的意图（"不得无限变宽"）保留，改为区间上限 720。 */
  assert.ok(width !== null && Number(width[1]) >= 640 && Number(width[1]) <= 720, `抽屉宽度须在 640–720（实际 ${width?.[1]}）`);
  /**
   * ⚠️ **v55（FR-106）改写**：这条原本断言"不得设 scroll.x"。那是按 640 宽桌面得出的结论，
   * 手机 390 下会让表格没有可滚动容器（列够不着）。现在断言**必须设** `scroll.x`；
   * 桌面无横滚由 AC-108 ⑤ 在 1600×900 上实测 `scrollWidth === clientWidth` 保证。
   * 本用例关心的其余口径（6 列 / ≤640 / fixed / 折叠已移除）**一字未改**。
   */
  assert.ok(/scroll=\{\{\s*x:/.test(drawer), '仍须设 scroll.x（窄容器下表格要能横滚）');
  assert.ok(/tableLayout="fixed"/.test(drawer), '仍须 fixed 布局');
  for (const gone of ['expandable', 'expandedRowRender', 'pm-token-expand-']) {
    assert.equal(drawer.includes(gone), false, `折叠仍须保持移除：${gone}`);
  }
});

test('AC-102 ⑦：FR-95 纪律不变（关抽屉即清 / 明文不落持久存储 / 仍用掩码而非完整明文）', () => {
  assert.ok(/setPlaintexts\(new Map\(\)\)/.test(drawer), '关抽屉必须清空明文缓存');
  assert.ok(/destroyOnHidden/.test(drawer), '仍须 destroyOnHidden');
  assert.equal(/localStorage|sessionStorage/.test(drawer), false, '明文仍不得写持久存储');
  assert.ok(/maskToken\(plaintext\)/.test(drawer), 'Token 列仍只渲染掩码（不渲染完整明文）');
});

test('AC-102 前提（服务端未改）：revealToken 不看 revoked_at，revealable = token_enc !== null', () => {
  const reveal = tokensService.slice(tokensService.indexOf('export async function revealToken'));
  assert.equal(/revoked_at/.test(reveal), false, 'revealToken 不得引入 revoked_at 判断（撤销行本来就能 reveal）');
  assert.ok(/row\.token_enc === null\) throw new ConflictError\('token_not_revealable'\)/.test(reveal), '只按密文缺失 409');
  assert.ok(/revealable: row\.token_enc !== null/.test(tokensService), 'revealable 只看密文是否存在（撤销不清密文）');
});
