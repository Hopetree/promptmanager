import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>) {
  return cookieOf(await login(fx.app));
}

test('POST /api/prompts：全字段落库并回读一致（version_no=1，tags 升序，时间 ISO UTC）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: {
        title: '会话交接模板',
        user_prompt: '你好 {{姓名}}，请把上下文交给下一位同学',
        system_prompt: '你是严谨的交接助手',
        notes: '备注：含 emoji ✅ 与 "引号"',
        folder_id: null,
        tags: ['运维', '交接'],
        favorite: true,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const body = created.json() as Record<string, unknown>;

    assert.equal(typeof body.id, 'number');
    assert.equal(body.title, '会话交接模板');
    assert.equal(body.user_prompt, '你好 {{姓名}}，请把上下文交给下一位同学');
    assert.equal(body.system_prompt, '你是严谨的交接助手');
    assert.equal(body.notes, '备注：含 emoji ✅ 与 "引号"');
    assert.equal(body.folder_id, null);
    assert.deepEqual(body.tags, ['交接', '运维']);
    assert.equal(body.favorite, true);
    assert.equal(body.version_no, 1);
    assert.match(String(body.created_at), ISO_UTC);
    assert.match(String(body.updated_at), ISO_UTC);
    assert.equal(body.created_at, body.updated_at);

    const got = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(body.id)}`, headers: { cookie } });
    assert.equal(got.statusCode, 200);
    /**
     * ⚠️ **v61（FR-114）改写**：阶段 6 起"GET 详情记一次取用"，现用户拍板「打开详情不要算」⇒
     * 打开详情只留痕（kind='view'）、不计入 ⇒ 这里的 use_count 与创建响应**同为 0**。
     */
    const fetched = got.json() as Record<string, unknown>;
    assert.equal(fetched.use_count, 0, '打开详情不计入取用（FR-114）');
    assert.equal(body.use_count, 0);
    const withoutUsage = (obj: Record<string, unknown>) => {
      const clone = { ...obj };
      delete clone.use_count;
      delete clone.last_used_at;
      return clone;
    };
    assert.deepEqual(withoutUsage(fetched), withoutUsage(body));
  } finally {
    await fx.close();
  }
});

test('GET /api/prompts：total/limit/offset 语义（默认 50/0，按 updated_at 倒序）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    for (const title of ['第一条', '第二条', '第三条']) {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title, user_prompt: title },
      });
      assert.equal(res.statusCode, 201, res.body);
    }

    const all = await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } });
    assert.equal(all.statusCode, 200);
    const body = all.json() as { total: number; limit: number; offset: number; items: Array<{ title: string }> };
    assert.equal(body.total, 3);
    assert.equal(body.limit, 50);
    assert.equal(body.offset, 0);
    assert.equal(body.items.length, 3);

    const page = await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=2&offset=2', headers: { cookie } });
    const pageBody = page.json() as { total: number; limit: number; offset: number; items: unknown[] };
    assert.equal(pageBody.total, 3);
    assert.equal(pageBody.limit, 2);
    assert.equal(pageBody.offset, 2);
    assert.equal(pageBody.items.length, 1);

    const capped = await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=9999', headers: { cookie } });
    assert.equal((capped.json() as { limit: number }).limit, 200, 'limit 上限 200');
  } finally {
    await fx.close();
  }
});

test('GET /api/prompts/:id：不存在 → 404 not_found；非法 id → 404', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const missing = await fx.app.inject({ method: 'GET', url: '/api/prompts/999999', headers: { cookie } });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: 'not_found' });

    const bad = await fx.app.inject({ method: 'GET', url: '/api/prompts/not-a-number', headers: { cookie } });
    assert.equal(bad.statusCode, 404);
  } finally {
    await fx.close();
  }
});

test('POST /api/prompts：非法 body → 400 invalid_body + details（不 500）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: 42, tags: 'not-an-array' },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json() as { error: string; details: unknown[] };
    assert.equal(body.error, 'invalid_body');
    assert.ok(Array.isArray(body.details) && body.details.length > 0);
  } finally {
    await fx.close();
  }
});

test('POST /api/prompts：folder_id 指向不存在的文件夹 → 400（外键约束生效，不 500）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '坏文件夹', folder_id: 424242 },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal((res.json() as { error: string }).error, 'invalid_body');
  } finally {
    await fx.close();
  }
});
