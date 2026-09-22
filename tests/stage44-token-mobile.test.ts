// 阶段 44 / FR-106（FIX 移动端令牌页不可用）断言。
//
// 覆盖：表格**必须有可滚动容器**（`scroll.x`）、移动端表单竖排（`isMobile` 由 `Workspace` 下发）、
// Alert 文案无 Markdown 星号，以及"桌面 6 列 / 列宽 / 折叠已移除"这些**不该被改坏**的口径。
// 真实 390×844 与 1600×900 下的像素级证据在 tools/ac-stage44.sh + ac-stage44-probe.mjs（真浏览器 + 真鼠标）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const read = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

/** 去掉注释后的组件源码（源码级断言只检查**真代码**，不检查注释里提到的名字）。 */
const drawer = read('web/src/components/TokenDrawer.tsx')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test("AC-108 ①（源码级）：表格**必须**有可滚动容器 —— 设了 `scroll.x`（数值，不是 max-content）", () => {
  /**
   * 这是 FR-106 的根因：antd 只有拿到 `scroll.x` 才会渲染 `.ant-table-content` 这个可滚动容器。
   * 不给的话，窄容器（手机 390）里内容会直接溢出到表格外，`scrollLeft` 怎么设都不动 ⇒ 两端列都够不着。
   *
   * ⚠️ 用**数值**而不是 `'max-content'`：`max-content` 会往表格元素写 `width: max-content`，
   * 它不吃单元格的 `maxWidth: 100%` ⇒ 最长的中文名把名称列撑到 257px、表格宽 714 > 抽屉 600
   * ⇒ **1600×900 下冒出横滚条、最右列被推出抽屉**（实测，正是 AC-108 ⑤ 要防的回归）。
   * 数值 419 = 五个定宽列之和 + 名称列的最小可读余量：宽容器下 `min-width: 100%` 让它撑满（桌面逐像素不变），
   * 窄容器下 419 > 350 才溢出并可横滚。两端行为分别由 AC-108 ①/⑤ 的像素数钉住。
   */
  assert.ok(/scroll=\{\{\s*x: \d+ \}\}/.test(drawer), '必须设**数值** scroll.x（而非 max-content）');
  assert.equal(/scroll=\{\{\s*x: 'max-content'/.test(drawer), false, '不得用 max-content（会把桌面名称列撑大、冒出横滚条）');
  // 数值必须 ≥ 五个定宽列之和（104+104+76+123+50 = 457？否 —— 是 457 减去名称余量；这里核"够放下定宽列"）
  const scrollX = Number(/scroll=\{\{\s*x: (\d+) \}\}/.exec(drawer)?.[1] ?? '0');
  assert.ok(scrollX >= 419, `scroll.x 必须 ≥ 419（放得下五个定宽列）实际 ${String(scrollX)}`);
  // tableLayout=fixed 仍要在（它让列宽真正生效；与 scroll.x 并存，不冲突）
  assert.ok(/tableLayout="fixed"/.test(drawer), '仍须 tableLayout="fixed"');
  // 列头与顺序不变（6 列）
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '最近使用', '操作'], '6 列与顺序不得变');
  // 抽屉宽度不变
  const width = /width=\{(\d+)\}/.exec(drawer);
  assert.equal(width?.[1], '640', '抽屉宽度仍是 640');
});

test('AC-108 ②（源码级）：移动端把创建表单改成竖排，且 `isMobile` 由 Workspace 下发', () => {
  // 组件接 isMobile（可选 prop，缺省 false ⇒ 既有调用点不会突然变形）
  assert.ok(/isMobile\?: boolean/.test(drawer), 'TokenDrawer 必须有 isMobile prop');
  assert.ok(/isMobile = false/.test(drawer), 'isMobile 缺省必须是 false（桌面行为不变）');
  // 移动端 vertical，桌面仍是 inline（一行三件）
  assert.ok(/layout=\{isMobile \? 'vertical' : 'inline'\}/.test(drawer), "表单布局：移动端 vertical / 桌面 inline");
  // 「名称」在桌面靠 flex:1 吃剩余宽度；移动端不再设 flex（vertical 下独占一行）
  assert.ok(/style=\{isMobile \? undefined : \{ flex: 1 \}\}/.test(drawer), '名称项的 flex 只在桌面生效');
  assert.ok(/<Input placeholder="例如：dsh \/ mcp-cli" data-testid="pm-token-name" \/>/.test(drawer), '名称输入框与它的 testid 不变');
  assert.ok(/data-testid="pm-token-scope"/.test(drawer) && /data-testid="pm-token-create"/.test(drawer), '权限选择与创建按钮仍是原控件');

  // Workspace 必须把 isMobile 传下去（它已有与 SplitView 同款断点算出的 isMobile）
  const workspace = read('web/src/components/Workspace.tsx');
  const usage = /<LazyTokenDrawer[\s\S]*?\/>/.exec(workspace)?.[0] ?? '';
  assert.ok(usage !== '', '必须能定位到 Workspace 里的 LazyTokenDrawer');
  assert.ok(/isMobile=\{isMobile\}/.test(usage), 'Workspace 必须把 isMobile 下发给令牌抽屉');
  assert.ok(/const isMobile = screens\.md === undefined/.test(workspace), 'isMobile 仍来自 Grid.useBreakpoint（与 SplitView 同款断点）');
});

test('AC-108 ③（源码级）：Alert 描述里不再有 Markdown 星号，其余文字不变', () => {
  // ⚠️ 必须**锚在 `<Alert` 上**取描述：文件里还有 Popconfirm 的 `description="撤销后立即失效。"`
  const alert = /<Alert[\s\S]*?\/>/.exec(drawer)?.[0] ?? '';
  assert.ok(alert !== '', '必须能定位到 Alert');
  const description = /description="([^"]*)"/.exec(alert)?.[1] ?? '';
  assert.ok(description !== '', '必须能取到 Alert 描述');
  assert.equal(description.includes('**'), false, 'Alert 不渲染 Markdown ⇒ 描述里不得出现 **');
  // 那句话还在（只是去掉星号）
  assert.ok(description.includes('有效令牌的权限可点「状态」列直接切换（立即生效，不用重建令牌）'), '去星号后文字必须保留');
  // 既有段落一字未动
  assert.ok(description.includes('只读可搜索 / 查看 / 渲染，读写还能新建、修改、删除'), '权限说明段不变');
  assert.ok(description.includes('令牌管理与改口令只能用界面会话'), '仅会话说明段不变');
  assert.ok(description.includes('pm token reveal <id>'), 'reveal 兜底说明不变');
});

test('AC-108 ⑤（源码级）：桌面口径未回归 —— 6 列 / ≤640 / 折叠仍移除 / 点状态列改权限仍接在 Dropdown 上', () => {
  for (const gone of ['expandable', 'expandedRowRender', 'pm-token-expand-']) {
    assert.equal(drawer.includes(gone), false, `折叠仍须保持移除：${gone}`);
  }
  // FR-105 的入口没被这次改动碰掉
  assert.ok(/<Dropdown/.test(drawer), '状态列的改权限入口（Dropdown）必须还在');
  assert.ok(/api\.setTokenScope\(id, scope\)/.test(drawer), '仍调 PATCH 接口');
  assert.ok(/cursor: 'pointer'/.test(drawer), '指针手型仍在');
  // FR-95 纪律不变
  assert.ok(/setPlaintexts\(new Map\(\)\)/.test(drawer), '关抽屉必须清空明文缓存');
  assert.ok(/destroyOnHidden/.test(drawer), '仍须 destroyOnHidden');
});
