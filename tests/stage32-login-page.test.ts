// 阶段 32 / FR-88（BRIEF v42 §4 + §8 AC-90）的**源码级**断言：登录页简化 + 不暴露账号名。
// 运行时段（真鼠标登录 / 错误提示 / 亮暗截图 / 移动端不溢出 / 运行时 DOM 无账号名）见
// tools/ac-stage32.sh 与 tools/ac-stage32-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const login = readFileSync(path.join(ROOT, 'web', 'src', 'components', 'LoginPage.tsx'), 'utf8');

/** FR-88 ② 要删干净的四条噪音（逐条断言命中 0）。 */
const NOISE = ['SELF-HOSTED', '数据只在本机', '网页不提供注册', '未认证一律'];

test('AC-90 ②：登录页源码里**不含**任何默认账号名（大小写不敏感都为 0）', () => {
  assert.equal(/admin/i.test(login), false, '登录页源码不得出现默认账号名（含注释里也不行 —— 断言是纯 grep）');
  assert.equal(login.toLowerCase().includes('admin'), false, '同上（小写化后再查一次）');
});

test('AC-90 ①：用户名框没有任何 initialValues 预填，且 placeholder 是中性文案', () => {
  assert.equal(login.includes('initialValues'), false, '不得给表单任何 initialValues（预填会暴露账号名）');
  assert.ok(/placeholder="用户名"/.test(login), '用户名框的 placeholder 必须是中性文案「用户名」');
  // 口令框的 placeholder 保持原样（本来就是中性的）
  assert.ok(/placeholder="口令"/.test(login), '口令框 placeholder 仍是「口令」');
  // 必填校验仍在（空输入不能提交）
  assert.ok(/name="username"[\s\S]{0,120}required: true/.test(login), '用户名仍必须是必填项');
  assert.ok(/name="password"[\s\S]{0,120}required: true/.test(login), '口令仍必须是必填项');
});

test('AC-90 ③：四条噪音逐条已删干净', () => {
  for (const text of NOISE) {
    assert.equal(login.includes(text), false, `登录页仍残留噪音文案：${text}`);
  }
});

test('AC-90 ③：只留登录信息 —— 品牌图 / 标题 / 用户名 / 口令 / 登录按钮齐全', () => {
  // 品牌图形（FR-59 / AC-59：登录页用 96px mark，装饰位 aria-hidden）
  assert.ok(login.includes('data-testid="pm-brand-art-login"'), '品牌图锚点 pm-brand-art-login 必须保留');
  assert.ok(/src="\/promptmanager-96\.png"/.test(login), '品牌图 src 未变');
  assert.ok(/width=\{96\}[\s\S]{0,40}height=\{96\}/.test(login), '品牌图仍是 96×96');
  assert.ok(/aria-hidden="true"/.test(login), '装饰位仍 aria-hidden');
  // 标题（FR-76 反例断言：登录页仍是全名 PromptManager）
  assert.ok(/PromptManager/.test(login), '登录页标题仍是 PromptManager');
  assert.equal(/[^r]PromptM[^a]/.test(login), false, '登录页不得被改成顶栏简称 PromptM');
  // 表单三件套
  assert.ok(/<Input[\s\S]{0,400}autoComplete="username"/.test(login), '用户名输入框（autoComplete=username）');
  assert.ok(/<Input\.Password[\s\S]{0,400}autoComplete="current-password"/.test(login), '口令输入框（autoComplete=current-password）');
  assert.ok(/htmlType="submit"/.test(login), '登录按钮是表单提交按钮');
  assert.ok(/data-testid="pm-login"/.test(login), '登录页根锚点 pm-login 保留');
});

test('AC-90 ③（对抗性）：删的是"展示文案"，登录逻辑本身一字未改', () => {
  // 接口调用与错误处理路径不得被顺手改掉
  assert.ok(/api\.login\(values\.username, values\.password\)/.test(login), '仍调用 api.login(username, password)');
  assert.ok(/setError\(describeError\(caught\)\)/.test(login), '错误仍走 describeError 展示成可读提示');
  assert.ok(/<Alert type="error" showIcon/.test(login), '错误提示仍是可见的 antd Alert');
  assert.ok(/onSuccess\(result\.username\)/.test(login), '成功后仍回调 onSuccess');
  // 亮暗仍跟随系统 token（不是写死颜色）
  assert.ok(/theme\.useToken\(\)/.test(login), '仍从 antd token 取色（亮暗跟随）');
  // 未引入新的手搓组件 / 新依赖
  assert.equal(/from 'antd\/es\//.test(login), false, '不得直接引 antd 内部模块');
});
