// 阶段 41 / FR-102（BRIEF v52 §4 + §8 AC-104）**编辑保存后返回详情，版本历史即时更新**断言。
//
// 这是**前端状态刷新**问题 ⇒ 真正的证据是**真浏览器**里"改 → 保存 → 返回详情 → 不刷新页面"的数字对照，
// 在 tools/ac-stage41.sh + ac-stage41-probe.mjs 里跑（AC-104 ①–⑥）。本文件只钉住**源码级契约**：
// 刷新信号必须是 `prompt.version_no`（而不是"只在回滚时自增的内部 state"），且不得变成"每次渲染都拉"。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const detailRaw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'PromptDetail.tsx'), 'utf8');
const panelRaw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'VersionPanel.tsx'), 'utf8');
const workspaceRaw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'Workspace.tsx'), 'utf8');
/** 负向断言扫"去注释后的代码"（注释里会**描述**这些规则，直接 grep 全文会假红）。 */
const strip = (src: string): string =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const detail = strip(detailRaw);
const panel = strip(panelRaw);
const workspace = strip(workspaceRaw);

test('AC-104 ①（源码级）：版本面板的刷新信号 = `prompt.version_no`（不再依赖"只在回滚时自增"的内部 state）', () => {
  assert.ok(/refreshKey=\{prompt\.version_no\}/.test(detail), 'refreshKey 必须直接由 prompt.version_no 派生');
  assert.equal(/const \[versionKey, setVersionKey\]/.test(detail), false, '不得再保留只在回滚时自增的内部 versionKey state');
  assert.equal(/setVersionKey/.test(detail), false, '不得再有 setVersionKey 调用点');
  // 回滚回调仍要重取这条 prompt（详情正文/元信息也刷新）
  assert.ok(/onRollbackDone=\{\(\) => onReload\(prompt\)\}/.test(detail), '回滚后仍须 onReload 重新取回该 prompt');
});

test('AC-104 ⑥（源码级）：刷新信号只在版本变化时变 —— 无关 UI 状态（字段/源码预览/全屏）不参与 key', () => {
  const keyLine = /refreshKey=\{([^}]+)\}/.exec(detail);
  assert.ok(keyLine !== null, '找不到 refreshKey 表达式');
  const expr = keyLine[1] ?? '';
  for (const unrelated of ['field', 'sourceMode', 'plain', 'fullscreen', 'versionKey']) {
    assert.equal(expr.includes(unrelated), false, `refreshKey 不得掺入无关 UI 状态：${unrelated}`);
  }
  // VersionPanel 的 effect 仍只以 refreshKey 为触发条件（不得变成每渲染都拉）
  assert.ok(/\[loadDiff, message, onUnauthorized, promptId, refreshKey\]/.test(panel), 'VersionPanel 的加载 effect 依赖必须仍是 refreshKey（不是每次都跑）');
});

test('AC-104 ①（源码级）：保存回详情这条链路把"保存接口返回的对象"带进详情（version_no 因此会变）', () => {
  const onSaved = workspace.slice(workspace.indexOf('onSaved={(prompt) => {'), workspace.indexOf('onDeleted={() => {'));
  assert.ok(/setEditing\(prompt\)/.test(onSaved), 'onSaved 必须用保存接口返回的 prompt 更新 editing');
  assert.ok(/refresh\(\)/.test(onSaved), 'onSaved 仍须刷新列表/文件夹/标签');
  // backToDetail 把 editing 交给 selected ⇒ 详情面拿到新的 version_no ⇒ 上面的 key 变化 ⇒ 版本面板重拉
  const back = workspace.slice(workspace.indexOf('const backToDetail'), workspace.indexOf('const backToDetail') + 600);
  assert.ok(/setSelected\(editing\)|setDetail\(target\)/.test(back), 'backToDetail 必须把 editing/target 交给详情面（移动端走 detail）');
});

test('AC-104 ③（源码级）：详情头部显示的版本号来自同一个 prompt.version_no（与版本列表同源，不会一个新一个旧）', () => {
  assert.ok(/v\{prompt\.version_no\}/.test(detail), '详情头部的版本号必须取自 prompt.version_no');
  assert.ok(/formatDateTime\(prompt\.updated_at\)/.test(detail), '更新时间同样取自这条 prompt');
  // 版本面板的"最上方"是版本列表首项 ⇒ 与 prompt.version_no 同源（服务端每次保存都 +1）
  assert.ok(/rowKey="version_no"/.test(panel), '版本列表按 version_no 作 rowKey（首项 = 最新）');
});

test('AC-104 ①（源码级）：版本表格**最新在上**（接口是升序返回，直接渲染会把新版本压在最下面）', () => {
  assert.ok(/dataSource=\{\[\.\.\.versions\]\.reverse\(\)\}/.test(panel), '表格显示顺序必须翻转为"最新在上"（AC-104 ① 要求最上方 = 新版本号）');
  // 只翻转表格：`versions` 本身仍保持升序，供对比/详情视图使用（不改既有语义）
  assert.ok(/dataSource=\{versions\}/.test(panel) === false, '不得把原始升序数组直接交给表格');
  assert.ok(/setFrom\(first\)/.test(panel) && /setTo\(last\)/.test(panel), '对比视图仍用升序的 first→last（旧→新 diff 方向不变）');
});

test('AC-104 ④（源码级）：回滚路径仍会触发刷新（能力不变）', () => {
  assert.ok(/onRollbackDone\(\)/.test(panel), 'VersionPanel 回滚成功后仍须回调 onRollbackDone');
  assert.ok(/await api\.rollback\(/.test(panel), '回滚仍走 api.rollback');
  // 版本面板既有能力（对比 / 详情 / 备注 / 回滚）未被本阶段删除
  for (const capability of ['pm-version-views', 'pm-vdetail-', 'rollback-', 'pm-vnote-input', 'pm-vnote-save', 'pm-vdetail-compare-prev']) {
    assert.ok(panel.includes(capability), `版本面板能力不得丢失：${capability}`);
  }
});
