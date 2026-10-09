// 变量预览的**服务端一致性**对照（阶段 11 / AC-33b 的前提）：
// 填变量对话框里的实时预览用的是客户端替换（`previewRender`），而"复制结果"用的是服务端 `/render`。
// 只要两者对同一组输入不一致，"预览 == 剪贴板"就会破。这里逐个用例把两边**逐字符**比对。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewRender } from '../web/src/pure.ts';
import { cookieOf, login, makeFixture } from './helpers.ts';

const TEXT = [
  '你是 {{项目}} 项目的交接助手。',
  '交接人：{{ 姓名 }}；重复一次：{{姓名}}。',
  '转义写法：\\{{保留}}。',
  '默认值写法不算是变量：{{name:张三}}。',
  '未提供的会被保留：{{未提供}}。',
  // FR-126 / AC-122 ⑬：默认值场景也要逐字符一致
  '语气：{{语气 | default(专业)}}；带引号：{{署名 | default(\'匿名\')}}。',
  '空默认值：{{空默认 | default()}}；不认识的过滤器：{{x | upper}}；无括号：{{y | default}}。',
  '转义的默认值写法：\\{{转义默认 | default(z)}}。',
  '同名多处取首次：{{重复默认 | default(第一)}} 与 {{重复默认 | default(第二)}}。',
].join('\n');

const CASES: Array<Record<string, string>> = [
  { 项目: 'greenhouse', 姓名: '张三', 未提供: '已给' },
  { 项目: 'greenhouse' },
  { 姓名: '' },
  {},
  { 项目: '带 "引号" 与 \\反斜杠', 姓名: '李四', 未提供: 'x' },
  // 默认值专项：不填 / 显式空串 / 显式给值 / 只填一半
  { 语气: '随意', 署名: '' },
  { 语气: '', 空默认: '', 重复默认: '' },
  { 重复默认: '显式', 转义默认: '给了也不渲染' },
];

test('previewRender 与服务端 /render 逐字符一致（8 组输入，含缺失值/空串/转义/默认值）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await cookieOf(await login(fx.app));
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '预览一致性夹具', user_prompt: TEXT, system_prompt: '' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = (created.json() as { id: number }).id;

    for (const [index, values] of CASES.entries()) {
      const rendered = await fx.app.inject({
        method: 'POST',
        url: `/api/prompts/${String(id)}/render`,
        headers: { cookie },
        payload: { values },
      });
      assert.equal(rendered.statusCode, 200, rendered.body);
      const server = (rendered.json() as { user_prompt: string }).user_prompt;
      const client = previewRender(TEXT, values);
      assert.equal(client, server, `第 ${String(index + 1)} 组输入预览与服务端不一致`);
    }
  } finally {
    await fx.close();
  }
});
