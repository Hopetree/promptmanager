// 阶段 48 / FR-112（令牌「状态」列只读 / 读写 用不同背景色区分）断言。
//
// 覆盖：`TOKEN_SCOPE_TAG_COLOR` 的两个档位必须**不同**且语义正确（读写比只读"重"、只读不得红色系）、
// 已撤销走中性色、渲染处按 scope 取色（不再写死 green）、列结构与可点击入口未被破坏。
// 真实渲染值（亮/暗两主题的 getComputedStyle + 真鼠标改权限）在 tools/ac-stage48.sh + ac-stage48-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const read = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

/** 去掉注释后的源码（源码级断言只检查**真代码**，不检查注释里提到的颜色名）。 */
const drawer = read('web/src/components/TokenDrawer.tsx')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('AC-113 ①（源码级）：只读与读写必须取**不同**的 Tag 色，且由 scope 决定', () => {
  /**
   * FR-112 的根因：旧代码两个分支都写死 `color="green"`，`scope` 只用来改文字 ⇒
   * 两种权限的 `backgroundColor` 完全相同（亮色实测都是 rgb(246,255,237)）。
   * 这里钉住"两档色值不同"+"渲染时按 scope 取色"，从源码层杜绝回退。
   */
  const map = /export const TOKEN_SCOPE_TAG_COLOR = \{([^}]*)\}/.exec(drawer)?.[1] ?? '';
  assert.ok(map !== '', '必须能定位 TOKEN_SCOPE_TAG_COLOR');
  const readColor = /read:\s*'([^']+)'/.exec(map)?.[1] ?? '';
  const writeColor = /write:\s*'([^']+)'/.exec(map)?.[1] ?? '';
  assert.ok(readColor !== '', '必须有 read 档色值');
  assert.ok(writeColor !== '', '必须有 write 档色值');
  assert.notEqual(readColor, writeColor, `只读与读写必须是不同颜色（当前都是 ${readColor}）`);

  // 渲染处必须按 scope 取色，**不得**再写死单一颜色
  assert.ok(
    /color=\{token\.scope === 'write' \? TOKEN_SCOPE_TAG_COLOR\.write : TOKEN_SCOPE_TAG_COLOR\.read\}/.test(drawer),
    '状态列必须按 token.scope 取色',
  );
  assert.equal(
    /<Tag\s+color="green"/.test(drawer),
    false,
    '不得再写死 color="green"（那正是两种权限同色的原因）',
  );
});

test('AC-113 ③（源码级）：语义正确 —— 读写比只读"重"，且只读**不得**用红色系', () => {
  const map = /export const TOKEN_SCOPE_TAG_COLOR = \{([^}]*)\}/.exec(drawer)?.[1] ?? '';
  const readColor = /read:\s*'([^']+)'/.exec(map)?.[1] ?? '';
  const writeColor = /write:\s*'([^']+)'/.exec(map)?.[1] ?? '';

  // 只用 antd preset 名（不是裸十六进制）⇒ 亮/暗两套主题都由组件库配对，不会"亮色能分、暗色分不出"
  const presets = ['green', 'gold', 'blue', 'geekblue', 'purple', 'cyan', 'orange', 'volcano', 'lime', 'magenta', 'red', 'default'];
  assert.ok(presets.includes(readColor), `只读色应是 antd preset 名（实际 ${readColor}）`);
  assert.ok(presets.includes(writeColor), `读写色应是 antd preset 名（实际 ${writeColor}）`);

  // 只读不得是红色系（FR-112 ② 明令：红色在本产品里读成"危险/已撤销"）
  for (const red of ['red', 'volcano', 'magenta']) {
    assert.notEqual(readColor, red, `只读不得用红色系（${red}）`);
    assert.notEqual(writeColor, red, `读写也不该用红色系（${red}）—— 读写是"权限更大"不是"危险"`);
  }
  // 读写要比只读"重"：这里用色相语义表达（只读=green 低调；读写=gold 醒目）
  assert.equal(readColor, 'green', '只读 = green（原有的低调"可用"观感）');
  assert.equal(writeColor, 'gold', '读写 = gold（比绿色更暖更醒目 ⇒ 权限更大那一档）');
});

test('AC-113 ②（源码级）：已撤销走**中性**色，且与两种有效色都不同', () => {
  const revoked = /export const TOKEN_REVOKED_TAG_COLOR = '([^']+)'/.exec(drawer)?.[1] ?? '';
  assert.equal(revoked, 'default', '已撤销必须是 default（中性；theme.ts 里定制成靛蓝淡底）');
  const map = /export const TOKEN_SCOPE_TAG_COLOR = \{([^}]*)\}/.exec(drawer)?.[1] ?? '';
  const readColor = /read:\s*'([^']+)'/.exec(map)?.[1] ?? '';
  const writeColor = /write:\s*'([^']+)'/.exec(map)?.[1] ?? '';
  assert.notEqual(revoked, readColor, '已撤销不得与只读同色（撤销 ≠ 只读）');
  assert.notEqual(revoked, writeColor, '已撤销不得与读写同色');
  // 渲染处确实用了它
  assert.ok(/<Tag color=\{TOKEN_REVOKED_TAG_COLOR\}/.test(drawer), '已撤销行必须用 TOKEN_REVOKED_TAG_COLOR');
});

test('AC-113 ⑤⑥（源码级）：可点击入口、列结构、文案与列宽都未变', () => {
  // 点状态列改权限的入口仍在（FR-105/AC-107）
  assert.ok(/<Dropdown/.test(drawer), '有效行的改权限入口（Dropdown）必须还在');
  assert.ok(/api\.setTokenScope\(id, scope\)/.test(drawer), '仍调 PATCH 接口');
  assert.ok(/cursor: 'pointer'/.test(drawer), '指针手型仍在');
  assert.ok(/data-scope-editable="1"/.test(drawer), '有效行仍标记可编辑');
  assert.ok(/title="点击切换：只读 ↔ 读写"/.test(drawer), '悬停提示仍在');
  // 列结构：仍是 7 列（本阶段不新增列）
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '创建时间', '最近使用', '操作'], '不得新增列（仍是 7 列）');
  // 文案：文字仍是 有效/已撤销 · 只读/读写（颜色只是加速识别，文字必须保留）
  assert.ok(/有效 · \{scopeText\}/.test(drawer), '有效行文案不变');
  assert.ok(/已撤销 · \{scopeText\}/.test(drawer), '已撤销行文案不变');
  assert.ok(/token\.scope === 'write' \? '读写' : '只读'/.test(drawer), 'scope → 文字映射不变');
});

test('AC-113 ④（源码级）：用的是 antd preset 色名而非写死十六进制 ⇒ 两套主题都会自适应', () => {
  const map = /export const TOKEN_SCOPE_TAG_COLOR = \{([^}]*)\}/.exec(drawer)?.[1] ?? '';
  assert.equal(/#[0-9a-fA-F]{3,8}/.test(map), false, '不得在配色映射里写死十六进制（那会只适配一套主题）');
  assert.equal(/rgba?\(/.test(map), false, '不得在配色映射里写死 rgb/rgba');
  // 两个常量都 export（便于测试与复用），并带 FR-112 的来源注释
  assert.ok(/export const TOKEN_SCOPE_TAG_COLOR/.test(drawer), 'TOKEN_SCOPE_TAG_COLOR 必须导出');
  assert.ok(/export const TOKEN_REVOKED_TAG_COLOR/.test(drawer), 'TOKEN_REVOKED_TAG_COLOR 必须导出');
});
