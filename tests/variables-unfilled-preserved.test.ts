// 阶段 11.1（BRIEF v15 / AC-33b 新期望，2026-09-19 用户决定「没填写的变量按照原样输出」）：
// 填变量对话框只把**已填写**的变量传给服务端 `/render`；未填写的变量绝不传空串，
// 因此服务端按 §6.5 既有语义**原样保留 `{{name}}`** 并列入 `missing`，预览与剪贴板一致。
//
// 这是本 FIX 的回归锚点：最后一条反向对照证明"传空串"会把 `{{项目}}` 吞成空（旧行为），
// 从而保证本测试在修复前必然变红。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filledValues, previewRender } from '../web/src/pure.ts';
import { cookieOf, login, makeFixture } from './helpers.ts';

const TEXT = '你好 {{姓名}}，项目 {{项目}}。';
const EXPECTED = '你好 张三，项目 {{项目}}。';

test('filledValues：只保留已填写的变量（空串与未出现的名字都不进 values）', () => {
  assert.deepEqual(filledValues(['姓名', '项目'], { 姓名: '张三', 项目: '' }), { 姓名: '张三' });
  assert.deepEqual(filledValues(['姓名', '项目'], { 姓名: '张三' }), { 姓名: '张三' });
  assert.deepEqual(filledValues(['姓名', '项目'], { 姓名: '', 项目: '' }), {});
  // 表单里可能存在的、不在服务端变量表里的键不得混进 values
  assert.deepEqual(filledValues(['姓名'], { 姓名: '张三', 别的: 'x' }), { 姓名: '张三' });
  // 纯空白也算"填了"（值本身原样传给服务端，不在这里替用户判空）
  assert.deepEqual(filledValues(['姓名'], { 姓名: ' ' }), { 姓名: ' ' });
});

test('只填「姓名」的预览：已填被替换、未填保持 {{项目}} 原文（AC-33b v15）', () => {
  const values = filledValues(['姓名', '项目'], { 姓名: '张三', 项目: '' });
  assert.equal(previewRender(TEXT, values), EXPECTED);
});

test('只把已填变量传给 /render：未填变量原样保留 + 列入 missing + 预览逐字符一致', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await cookieOf(await login(fx.app));
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '未填变量夹具', user_prompt: TEXT, system_prompt: '' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = (created.json() as { id: number }).id;

    // 对话框里"填一个留一个"的原始表单状态：项目 是空串
    const form = { 姓名: '张三', 项目: '' };
    const values = filledValues(['姓名', '项目'], form);
    assert.deepEqual(values, { 姓名: '张三' });

    const rendered = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { cookie },
      payload: { values },
    });
    assert.equal(rendered.statusCode, 200, rendered.body);
    const body = rendered.json() as { user_prompt: string; missing: string[] };
    assert.equal(body.user_prompt, EXPECTED);
    assert.deepEqual(body.missing, ['项目']);
    // 预览用的客户端替换与服务端返回逐字符一致（"复制结果 == 预览"的前提）
    assert.equal(previewRender(TEXT, values), body.user_prompt);

    // 反向对照（旧行为）：把空串也传下去，服务端会把 {{项目}} 替换成空 → 用户不要的结果。
    // 这一条同时证明上面的修复不是"测试没覆盖到"的假绿。
    const wrong = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { cookie },
      payload: { values: { 姓名: '张三', 项目: '' } },
    });
    assert.equal(wrong.statusCode, 200, wrong.body);
    assert.equal((wrong.json() as { user_prompt: string }).user_prompt, '你好 张三，项目 。');
  } finally {
    await fx.close();
  }
});
