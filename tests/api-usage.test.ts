import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function tokenOf(fx: Awaited<ReturnType<typeof makeFixture>>, cookie: string, name = 'usage'): Promise<string> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { token: string }).token;
}

async function createPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<Record<string, any>> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as Record<string, any>;
}

interface Summary {
  days: number;
  total: number;
  by_channel: { session: number; token: number; mcp: number };
  top: Array<{ prompt_id: number; title: string; count: number; last_used_at: string | null }>;
}

async function summary(fx: Awaited<ReturnType<typeof makeFixture>>, headers: Record<string, string>, days = 30): Promise<Summary> {
  const res = await fx.app.inject({ method: 'GET', url: `/api/usage/summary?days=${String(days)}`, headers });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Summary;
}

test('AC-27 ①②③：只记"取用"（详情/渲染），通道分 session/token/mcp', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await tokenOf(fx, cookie);
    const bearer = { authorization: `Bearer ${token}` };
    const prompt = await createPrompt(fx, cookie, { title: '使用记录夹具', user_prompt: '你好 {{姓名}}' });
    const id = Number(prompt.id);

    // ① token：两次详情 + 一次 render
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).statusCode, 200);
    assert.equal(
      (await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: bearer, payload: { values: { 姓名: '张三' } } })).statusCode,
      200,
    );

    let s = await summary(fx, bearer, 7);
    assert.equal(s.by_channel.token, 3, `token 通道应记 3 次：${JSON.stringify(s)}`);
    assert.equal(s.top[0]?.prompt_id, id);
    assert.equal(s.top[0]?.count, 3);
    assert.equal(s.top[0]?.title, '使用记录夹具');
    assert.ok(s.top[0]?.last_used_at?.endsWith('Z'));

    // ② MCP 通道（阶段 6 交付管线，阶段 7 由 MCP server 用同一个头调用）
    const beforeMcp = s.total;
    const mcpCall = await fx.app.inject({
      method: 'GET',
      url: `/api/prompts/${String(id)}`,
      headers: { ...bearer, 'x-pm-channel': 'mcp' },
    });
    assert.equal(mcpCall.statusCode, 200);
    s = await summary(fx, bearer, 7);
    assert.equal(s.by_channel.mcp, 1);
    assert.equal(s.total, beforeMcp + 1);

    // ③ 浏览器 cookie 通道
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } })).statusCode, 200);
    s = await summary(fx, { cookie }, 7);
    assert.equal(s.by_channel.session, 1);
    assert.equal(s.by_channel.token, 3);
    assert.equal(s.by_channel.mcp, 1);
    assert.equal(s.total, 5);
  } finally {
    await fx.close();
  }
});

test('AC-27 ④：写 usage 不产生新版本、不改 updated_at；Prompt 对象带 use_count/last_used_at', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await tokenOf(fx, cookie);
    const bearer = { authorization: `Bearer ${token}` };
    const prompt = await createPrompt(fx, cookie, { title: '副作用断言', user_prompt: '正文' });
    const id = Number(prompt.id);

    // 新prompt：use_count=0、last_used_at=null
    assert.equal(prompt.use_count, 0);
    assert.equal(prompt.last_used_at, null);

    const before = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).json() as Record<string, any>;
    assert.equal(before.use_count, 1, '本次取用应计入响应');

    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer });
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: bearer, payload: { values: {} } });

    const after = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).json() as Record<string, any>;
    assert.equal(after.version_no, before.version_no, 'version_no 必须不变');
    assert.equal(after.updated_at, before.updated_at, 'updated_at 必须不变');
    assert.equal(after.use_count, 4, 'use_count 递增（含本次）');
    assert.ok(String(after.last_used_at).endsWith('Z'));

    // 列表里也带这两个字段
    const list = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer })).json() as {
      items: Array<Record<string, any>>;
    };
    assert.equal(list.items[0]?.use_count, 4);
    assert.ok(String(list.items[0]?.last_used_at).endsWith('Z'));

    // 列表/搜索本身不记录
    const totalBefore = (await summary(fx, bearer)).total;
    await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=10', headers: bearer });
    await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('正文')}`, headers: bearer });
    assert.equal((await summary(fx, bearer)).total, totalBefore, '列表/搜索不得写 usage');
  } finally {
    await fx.close();
  }
});

test('AC-27 ⑤：?sort=recent_used —— 用过的在前、从未用过的排最后（同档按 updated_at 倒序）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await tokenOf(fx, cookie);
    const bearer = { authorization: `Bearer ${token}` };

    const usedFirst = await createPrompt(fx, cookie, { title: '先被用过' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const usedSecond = await createPrompt(fx, cookie, { title: '后被用过' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const neverUsed = await createPrompt(fx, cookie, { title: '从未用过' });

    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(usedFirst.id)}`, headers: bearer });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(usedSecond.id)}`, headers: bearer });

    const sorted = (await fx.app.inject({ method: 'GET', url: '/api/prompts?sort=recent_used', headers: bearer })).json() as {
      items: Array<{ id: number; title: string; use_count: number; last_used_at: string | null }>;
    };
    assert.deepEqual(
      sorted.items.map((item) => item.title),
      ['后被用过', '先被用过', '从未用过'],
      '最近使用倒序；从未使用过的排最后',
    );
    assert.equal(sorted.items[2]?.last_used_at, null);
    assert.equal(sorted.items[2]?.use_count, 0);

    // 默认排序仍是 updated_at 倒序
    const byUpdated = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer })).json() as {
      items: Array<{ title: string }>;
    };
    assert.deepEqual(
      byUpdated.items.map((item) => item.title),
      ['从未用过', '后被用过', '先被用过'],
    );

    // 非法 sort 值 → 400
    const badSort = await fx.app.inject({ method: 'GET', url: '/api/prompts?sort=whatever', headers: bearer });
    assert.equal(badSort.statusCode, 400, badSort.body);
  } finally {
    await fx.close();
  }
});

test('AC-27 ⑥：usage 不参与导入导出（ExportFile 结构不变、往返仍 EQUAL）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await tokenOf(fx, cookie);
    const bearer = { authorization: `Bearer ${token}` };
    const prompt = await createPrompt(fx, cookie, { title: '导出与用量', user_prompt: '正文' });
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(prompt.id)}`, headers: bearer });

    const before = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: bearer })).json() as Record<string, any>;
    const serialized = JSON.stringify(before);
    assert.ok(!serialized.includes('use_count'), 'ExportFile 不得含 use_count');
    assert.ok(!serialized.includes('last_used_at'), 'ExportFile 不得含 last_used_at');
    // 结构断言（比 grep 关键词更硬）：prompt 对象的字段集必须与 §6.4 完全一致
    assert.deepEqual(
      Object.keys((before.prompts as Array<Record<string, unknown>>)[0] ?? {}).sort(),
      [
        'created_at',
        'favorite',
        'folder_id',
        'id',
        'notes',
        'system_prompt',
        'tags',
        'title',
        'updated_at',
        'user_prompt',
        'versions',
      ],
      'prompt 对象不得多出 usage 字段',
    );

    const imported = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: bearer,
      payload: { mode: 'replace', data: before },
    });
    assert.equal(imported.statusCode, 200, imported.body);

    const after = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: bearer })).json() as Record<string, any>;
    delete before.exported_at;
    delete after.exported_at;
    assert.equal(JSON.stringify(after), JSON.stringify(before), 'usage 不参与导入导出 → 往返仍 EQUAL');

    // replace 导入后 usage 被级联清掉（prompts 重建 → 旧行删除）
    const s = await summary(fx, bearer);
    assert.equal(s.total, 0, 'prompt 重建后旧 usage 行应随外键级联删除');
  } finally {
    await fx.close();
  }
});

test('usage summary 的参数与认证：days 默认 30、非法 → 400、未认证 → 401；删 prompt 级联删 usage', async () => {
  const fx = await makeFixture();
  try {
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/usage/summary' })).statusCode, 401);

    const cookie = await authed(fx);
    const token = await tokenOf(fx, cookie);
    const bearer = { authorization: `Bearer ${token}` };
    const prompt = await createPrompt(fx, cookie, { title: '删除级联' });
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(prompt.id)}`, headers: bearer });

    const def = (await fx.app.inject({ method: 'GET', url: '/api/usage/summary', headers: bearer })).json() as Summary;
    assert.equal(def.days, 30, 'days 默认 30');
    assert.equal(def.total, 1);

    for (const bad of ['days=abc', 'days=0', 'days=-1']) {
      const res = await fx.app.inject({ method: 'GET', url: `/api/usage/summary?${bad}`, headers: bearer });
      assert.equal(res.statusCode, 400, `${bad} 应 400`);
    }

    // top 最多 20 条
    const s = await summary(fx, bearer);
    assert.ok(s.top.length <= 20);

    // 删除 prompt → usage 级联
    await fx.app.inject({ method: 'DELETE', url: `/api/prompts/${String(prompt.id)}`, headers: bearer });
    assert.equal((await summary(fx, bearer)).total, 0);
    const rows = readDb(fx, (db) => db.prepare('select count(*) as n from usage_events').get() as { n: number });
    assert.equal(rows.n, 0, 'usage_events 应随 prompt 级联删除');
  } finally {
    await fx.close();
  }
});
