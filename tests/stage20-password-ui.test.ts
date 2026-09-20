// 阶段 20 / FR-67（BRIEF v27 §4 + §8 AC-67）的**源码级**断言（界面侧）：
// ⋯更多 删「已登录」、原位置「修改密码」；弹窗三密码框 + autoComplete + 前端校验（≥8 码点 / 不同 / 一致）；
// 统一走 api.changePassword（POST /api/password，snake_case）；关于页维护区提到界面入口。
// 运行时段（真鼠标 + 内网 IP + 真实会话与限流）见 tools/ac-stage20.sh 与 tools/ac-stage20-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const header = src('components/AppHeader.tsx');
const workspace = src('components/Workspace.tsx');
const about = src('components/AboutModal.tsx');
const api = src('api.ts');
const lazy = src('lazy.ts');

test('AC-67 ①：⋯更多 菜单项与顺序（已登录 → 修改密码），无「已登录」', () => {
  assert.equal(header.includes('已登录'), false, '「已登录：<用户名>」只读项必须删除');
  const order = ["'usage'", "'tokens'", "'import-export'", "'settings'", "'password'", "'logout'"];
  let cursor = -1;
  for (const key of order) {
    const at = header.indexOf(`key: ${key}`);
    assert.ok(at > cursor, `菜单项顺序必须固定：${order.join(' → ')}（${key} 位置不对）`);
    cursor = at;
  }
  assert.ok(header.includes('data-testid="pm-menu-password"'), '「修改密码」要有 data-testid="pm-menu-password"');
  assert.ok(header.includes('LockOutlined'), '「修改密码」用 LockOutlined');
  const passwordBlock = header.slice(header.indexOf("key: 'password'"), header.indexOf("key: 'logout'"));
  assert.ok(passwordBlock.includes('LockOutlined'), '图标挂在 password 项上');
  assert.ok(passwordBlock.includes('pm-menu-password'), 'testid 挂在 password 项上');
  assert.equal(passwordBlock.includes('danger'), false, '「修改密码」是普通项（非 danger）');
  assert.ok(header.includes('onOpenPassword'), '点击要接到 onOpenPassword');
});

test('AC-67 ②：修改密码弹窗（三密码框 + autoComplete + 取消/确认 + testid）', () => {
  const modal = src('components/PasswordModal.tsx');
  assert.ok(modal.includes('data-testid="pm-password-modal"'), '弹窗 testid');
  assert.equal((modal.match(/Input\.Password/g) ?? []).length, 3, '三个 Input.Password');
  assert.ok(modal.includes('autoComplete="current-password"'), '当前密码用 current-password');
  assert.equal((modal.match(/autoComplete="new-password"/g) ?? []).length, 2, '新密码 / 确认新密码都用 new-password');
  for (const label of ['当前密码', '新密码', '确认新密码']) {
    assert.ok(modal.includes(label), `缺少字段 ${label}`);
  }
  assert.ok(modal.includes('取消') && modal.includes('确认修改'), '底部要有 取消 / 确认修改');
  assert.ok(/confirmLoading=\{submitting\}|loading=\{submitting\}|disabled=\{submitting\}/.test(modal), '提交中要禁用按钮');
  assert.ok(modal.includes('api.changePassword'), '提交走 api.changePassword');
  // 弹窗按需挂载（FR-61 的懒加载口径）：open 为假时不渲染内容
  assert.ok(/if \(!open\) return null|open \?/.test(modal) || modal.includes('open={open}'), '弹窗要支持关闭态');
  assert.ok(lazy.includes("import('./components/PasswordModal')"), 'PasswordModal 走懒加载');
  assert.ok(workspace.includes('passwordOpen') && workspace.includes('LazyPasswordModal'), 'Workspace 按需挂载弹窗');
});

test('AC-67 ④：前端校验（≥8 码点 / 不得与当前相同 / 两次必须一致）', () => {
  const modal = src('components/PasswordModal.tsx');
  assert.ok(/\[\.\.\.\s*\w+\s*\]\.length|Array\.from\([^)]*\)\.length/.test(modal), '长度要按 Unicode 码点计数');
  assert.ok(/8/.test(modal), '规则里要有 8');
  assert.ok(/不得与当前密码相同|与当前密码相同/.test(modal), '要校验"不得与当前密码相同"');
  assert.ok(/确认|不一致|dependencies/.test(modal), '要校验两次新密码一致');
});

test('AC-67 ⑥⑦：接口定义与关于页文案', () => {
  assert.ok(api.includes("'/api/password'"), 'api.ts 要有 /api/password');
  assert.ok(/old_password/.test(api) && /new_password/.test(api), '入参用 snake_case');
  assert.ok(/changePassword/.test(api), '导出 changePassword');
  assert.ok(about.includes('修改密码'), '关于页维护区要提到界面改密码入口');
});
