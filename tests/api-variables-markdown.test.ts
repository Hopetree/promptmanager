import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

/** AC-8 规定的夹具（注意 \\{{保留}} 在 JS 里写成 '\\{{保留}}'，即文本里一个反斜杠）。 */
const AC8_USER_PROMPT = '你好 {{ 姓名 }}，重复 {{姓名}} 与 \\{{保留}} 以及 {{var-b}}';
const AC8_EXPECTED_RENDER = '你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

test('AC-8：变量提取（顺序=首次出现、去重、转义不算）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '变量夹具', user_prompt: AC8_USER_PROMPT },
      })
    ).json() as { id: number };

    const res = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(created.id)}/variables`, headers: { cookie } });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { variables: ['姓名', 'var-b'] });
  } finally {
    await fx.close();
  }
});

test('AC-8：渲染（替换已提供、原样保留未提供并列入 missing，逐字符一致）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '变量夹具', user_prompt: AC8_USER_PROMPT, system_prompt: '系统提示 {{系统变量}}' },
      })
    ).json() as { id: number };

    const res = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(created.id)}/render`,
      headers: { cookie },
      payload: { values: { 姓名: '张三' } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { user_prompt: string; system_prompt: string; missing: string[] };

    assert.equal(body.user_prompt, AC8_EXPECTED_RENDER);
    assert.ok(Buffer.from(body.user_prompt).equals(Buffer.from(AC8_EXPECTED_RENDER)), '渲染结果必须逐字符相等');
    assert.deepEqual(body.missing, ['var-b', '系统变量'], 'missing 按提取顺序（user 在前）');
    assert.equal(body.system_prompt, '系统提示 {{系统变量}}', '未提供值的占位符保持原样');

    // 渲染不写库
    const after = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(created.id)}`, headers: { cookie } })).json() as Record<string, unknown>;
    assert.equal(after.user_prompt, AC8_USER_PROMPT, '渲染不得写库');
    assert.equal(after.version_no, 1);
  } finally {
    await fx.close();
  }
});

test('AC-8 扩展：空 values / 未知变量 / 非法 body / 404', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: 'x', user_prompt: '{{a}}{{b}}' } })
    ).json() as { id: number };

    const noValues = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(created.id)}/render`,
      headers: { cookie },
      payload: {},
    });
    assert.equal(noValues.statusCode, 200, noValues.body);
    const noValuesBody = noValues.json() as { user_prompt: string; missing: string[] };
    assert.equal(noValuesBody.user_prompt, '{{a}}{{b}}');
    assert.deepEqual(noValuesBody.missing, ['a', 'b']);

    const extra = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(created.id)}/render`,
      headers: { cookie },
      payload: { values: { a: 'A', 无关: 'X' } },
    });
    const extraBody = extra.json() as { user_prompt: string; missing: string[] };
    assert.equal(extraBody.user_prompt, 'A{{b}}');
    assert.deepEqual(extraBody.missing, ['b']);

    const badBody = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(created.id)}/render`,
      headers: { cookie },
      payload: { values: 'not-an-object' },
    });
    assert.equal(badBody.statusCode, 400, badBody.body);
    assert.equal((badBody.json() as { error: string }).error, 'invalid_body');

    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts/999999/variables', headers: { cookie } })).statusCode, 404);
    assert.equal(
      (await fx.app.inject({ method: 'POST', url: '/api/prompts/999999/render', headers: { cookie }, payload: { values: {} } })).statusCode,
      404,
    );
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts/1/variables' })).statusCode, 401, '未认证 401');
  } finally {
    await fx.close();
  }
});

test('AC-12：POST /api/render/markdown 净化 + 高亮', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/render/markdown',
      headers: { cookie },
      payload: {
        markdown: ['# 预览', '', '<script>alert(1)</script>', '', '[x](javascript:alert(1))', '', '```js', 'const a = 1;', '```'].join('\n'),
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const html = (res.json() as { html: string }).html;
    assert.ok(!html.includes('<script'), `不应含 <script：${html}`);
    assert.ok(!html.includes('javascript:'), `不应含 javascript:：${html}`);
    assert.match(html, /<pre/);
    assert.match(html, /hljs/);
  } finally {
    await fx.close();
  }
});

test('AC-12 扩展：markdown 接口的 400 / 401 与大文本', async () => {
  const fx = await makeFixture();
  try {
    assert.equal((await fx.app.inject({ method: 'POST', url: '/api/render/markdown', payload: { markdown: '# x' } })).statusCode, 401);

    const cookie = await authed(fx);
    for (const payload of [{}, { markdown: 42 }, { markdown: 'x'.repeat(200_001) }]) {
      const res = await fx.app.inject({ method: 'POST', url: '/api/render/markdown', headers: { cookie }, payload });
      assert.equal(res.statusCode, 400, `${JSON.stringify(payload).slice(0, 40)} 应为 400，实际 ${res.statusCode}`);
    }

    const ok = await fx.app.inject({ method: 'POST', url: '/api/render/markdown', headers: { cookie }, payload: { markdown: '**粗**' } });
    assert.equal(ok.statusCode, 200);
    assert.match((ok.json() as { html: string }).html, /<strong>粗<\/strong>/);
  } finally {
    await fx.close();
  }
});
