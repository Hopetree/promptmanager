// 变量值 CRLF 归一化 + 多行默认值 —— 接口级用例（POST /api/prompts/:id/render 与 GET /variables）。
//
// 走 `tests/helpers.ts` 的 makeFixture / login / cookieOf + `fx.app.inject`，不起真实端口、不碰 8767。
// 期望语义与 `tests/variable-syntax-multiline.test.ts`（纯函数级）一致，这里验证三通道共用同一实现后
// HTTP 响应里的行为：值里的 CRLF 归一化、多行默认值、$&/$1/反斜杠字面、值不二次渲染、50KB 级大值。
//
// 本文件**测试先行**：先于实现写就并跑出红，再改实现转绿。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

const newlineCount = (text: string): number => (text.match(/\n/gu) ?? []).length;
const crCount = (text: string): number => (text.match(/\r/gu) ?? []).length;

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function createPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: number }).id;
}

interface RenderedBody {
  user_prompt: string;
  system_prompt: string;
  missing: string[];
}

async function render(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  id: number,
  values: Record<string, unknown>,
): Promise<RenderedBody> {
  const res = await fx.app.inject({
    method: 'POST',
    url: `/api/prompts/${String(id)}/render`,
    headers: { cookie },
    payload: { values },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as RenderedBody;
}

test('多行变量值：3 行值经 /render 后恰好 2 个 \\n', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: '多行值', user_prompt: '{{ body }}' });
    const body = await render(fx, cookie, id, { body: '第一行\n第二行\n第三行' });

    assert.equal(newlineCount(body.user_prompt), 2);
    assert.deepEqual(body.user_prompt.split('\n'), ['第一行', '第二行', '第三行']);
    assert.deepEqual(body.missing, []);
  } finally {
    await fx.close();
  }
});

test('多行变量值：4 空格缩进 + 首尾各 1 空行经 /render 逐字保留', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: '缩进值', user_prompt: '{{ block }}' });
    const value = '\n    indented\n    second\n';
    const body = await render(fx, cookie, id, { block: value });

    assert.equal(body.user_prompt, value);
    assert.equal(body.user_prompt.startsWith('\n'), true);
    assert.equal(body.user_prompt.endsWith('\n'), true);
    assert.equal(body.user_prompt.split('\n')[1], '    indented');
  } finally {
    await fx.close();
  }
});

test('CRLF 变量值：/render 输出 \\r 计数为 0（\\r\\n 与裸 \\r 均归一化）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'CRLF 值', user_prompt: '{{ body }}' });
    const body = await render(fx, cookie, id, { body: 'a\r\nb\rc\nd' });

    assert.equal(body.user_prompt, 'a\nb\nc\nd');
    assert.equal(crCount(body.user_prompt), 0, '渲染结果不得残留 \\r');
    assert.equal(newlineCount(body.user_prompt), 3);
  } finally {
    await fx.close();
  }
});

test('$& / $1 / 反斜杠在 /render 中按字面输出（不做替换串展开）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: '替换串', user_prompt: '{{ v }}' });
    const value = '$& $1 \\n \\\\ end';
    const body = await render(fx, cookie, id, { v: value });

    assert.equal(body.user_prompt, value);
    assert.equal(body.user_prompt.includes('$&'), true);
    assert.equal(body.user_prompt.includes('$1'), true);
    assert.equal(body.user_prompt.includes('\\n'), true, '值里的反斜杠 + n 保持字面');
    assert.equal(newlineCount(body.user_prompt), 0);
  } finally {
    await fx.close();
  }
});

test('值里的 {{ other }} 经 /render 不二次渲染', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: '不二次渲染', user_prompt: '{{ v }}' });
    const body = await render(fx, cookie, id, { v: 'A {{ other }} B', other: 'SHOULD-NOT-APPEAR' });

    assert.equal(body.user_prompt, 'A {{ other }} B');
    assert.equal(body.user_prompt.includes('SHOULD-NOT-APPEAR'), false);
    assert.deepEqual(body.missing, []);
  } finally {
    await fx.close();
  }
});

test('多行默认值：default("a\\nb") 未填 /render 两行，已填以值为准', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, {
      title: '多行默认值',
      user_prompt: '{{ text | default("a\\nb") }}',
    });

    const unfilled = await render(fx, cookie, id, {});
    assert.equal(unfilled.user_prompt, 'a\nb');
    assert.equal(newlineCount(unfilled.user_prompt), 1);
    assert.deepEqual(unfilled.missing, [], '有默认值不进 missing');

    const filled = await render(fx, cookie, id, { text: 'X\nY\nZ' });
    assert.equal(filled.user_prompt, 'X\nY\nZ', '已填以值为准');
    assert.equal(newlineCount(filled.user_prompt), 2);
  } finally {
    await fx.close();
  }
});

test('GET /api/prompts/:id/variables：defaults 形状不变（数组 + 字符串表）且带出多行默认值', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, {
      title: 'defaults 形状',
      user_prompt: '{{ text | default("a\\nb") }} {{ plain }}',
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: `/api/prompts/${String(id)}/variables`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { variables: unknown; defaults: unknown };

    assert.ok(Array.isArray(body.variables), 'variables 仍是字符串数组（形状不变）');
    assert.deepEqual(body.variables, ['text', 'plain']);
    assert.deepEqual(body.defaults, { text: 'a\nb' }, '多行默认值以真实换行出现在 defaults 里');
    assert.equal(typeof (body.defaults as Record<string, unknown>).text, 'string');
  } finally {
    await fx.close();
  }
});

test('空串与未填：未填回落多行默认值，显式空串渲染为空（既有契约不变）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, {
      title: '空串默认值',
      user_prompt: '{{ m | default("甲\\n乙") }}',
    });

    const unfilled = await render(fx, cookie, id, {});
    assert.equal(unfilled.user_prompt, '甲\n乙', '未填（键缺失）⇒ 回落多行默认值');

    const explicitEmpty = await render(fx, cookie, id, { m: '' });
    assert.equal(explicitEmpty.user_prompt, '', '显式空串 ⇒ 空，不回落默认值');
    assert.deepEqual(explicitEmpty.missing, []);
  } finally {
    await fx.close();
  }
});

test('500 行 ≈50KB 的多行值：/render 2xx 且内容逐字一致', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: '大值', user_prompt: '{{ big }}' });
    const value = Array.from({ length: 500 }, (_, i) => `line-${String(i + 1).padStart(3, '0')}-` + 'x'.repeat(90)).join('\n');

    assert.equal(newlineCount(value), 499);
    assert.ok(value.length > 45_000, `夹具应 ≈50KB，实际 ${String(value.length)} 字节`);

    const body = await render(fx, cookie, id, { big: value });
    assert.equal(body.user_prompt, value);
    assert.equal(newlineCount(body.user_prompt), 499);
    assert.equal(crCount(body.user_prompt), 0);
    assert.deepEqual(body.missing, []);
  } finally {
    await fx.close();
  }
});

test('单行短值回归：/render 逐字符一致、missing 口径不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: '单行回归', user_prompt: '你好 {{ name }}！' });

    const filled = await render(fx, cookie, id, { name: '张三' });
    assert.equal(filled.user_prompt, '你好 张三！');
    assert.equal(newlineCount(filled.user_prompt), 0);
    assert.deepEqual(filled.missing, []);

    const unfilled = await render(fx, cookie, id, {});
    assert.equal(unfilled.user_prompt, '你好 {{ name }}！');
    assert.deepEqual(unfilled.missing, ['name']);
  } finally {
    await fx.close();
  }
});
