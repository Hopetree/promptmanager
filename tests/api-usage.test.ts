import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

/**
 * FR-103（v53）：新建令牌**缺省只读**，而本文件的用例要覆盖"令牌取用 + 用令牌做写操作（导入 / 删除）"，
 * 所以夹具显式要 `write`。只读令牌的用法与归因在 `tests/stage42-token-scope.test.ts` 里单独验。
 */
async function tokenOf(fx: Awaited<ReturnType<typeof makeFixture>>, cookie: string, name = 'usage'): Promise<string> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { cookie },
    payload: { name, scope: 'write' },
  });
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

    /**
     * ⚠️ **v61（FR-114）改写**：原为"两次详情 + 一次 render ⇒ token 通道 3 次"。
     * 用户拍板「打开详情不要算」⇒ **只统计计入型（copy/mcp）**，那两次详情只剩留痕（kind='view'），
     * 所以 summary 里 token 通道应为 **1**（只有 render 那一次）。
     * 覆盖没有减弱：**两次详情确实留了痕**这一条由下面的"记录表 kind 分布"断言补上（原来没查过）。
     */
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).statusCode, 200);
    assert.equal(
      (await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: bearer, payload: { values: { 姓名: '张三' } } })).statusCode,
      200,
    );

    // 留痕仍在：3 条记录（2 次 view + 1 次 copy），但只有 copy 计入
    const kinds = readDb(
      fx,
      (db) =>
        db.prepare('SELECT kind, COUNT(*) AS n FROM usage_events WHERE prompt_id = ? GROUP BY kind ORDER BY kind').all(id) as Array<{ kind: string; n: number }>,
    );
    assert.deepEqual(
      kinds.map((row) => `${row.kind}:${String(row.n)}`),
      ['copy:1', 'view:2'],
      `打开详情应留痕为 view、render 记为 copy：${JSON.stringify(kinds)}`,
    );

    let s = await summary(fx, bearer, 7);
    assert.equal(s.by_channel.token, 1, `token 通道只应记"计入型"1 次（render）：${JSON.stringify(s)}`);
    assert.equal(s.top[0]?.prompt_id, id);
    assert.equal(s.top[0]?.count, 1);
    assert.equal(s.top[0]?.title, '使用记录夹具');
    assert.ok(s.top[0]?.last_used_at?.endsWith('Z'));

    /**
     * ② MCP 通道（阶段 6 交付管线，阶段 7 由 MCP server 用同一个头调用）
     * ⚠️ **v61（FR-114）改写**：原来用 `GET /api/prompts/:id` + mcp 头来制造 MCP 取用；
     * 现在"打开详情"只留痕不计入 ⇒ 改用真正计入的 **render**（MCP 的 prompt_render 正是这条路）。
     */
    const beforeMcp = s.total;
    const mcpCall = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { ...bearer, 'x-pm-channel': 'mcp' },
      payload: { values: {} },
    });
    assert.equal(mcpCall.statusCode, 200);
    s = await summary(fx, bearer, 7);
    assert.equal(s.by_channel.mcp, 1);
    assert.equal(s.total, beforeMcp + 1);

    /**
     * ③ 浏览器 cookie 通道
     * ⚠️ **v61（FR-114）改写**：原来用 cookie 的 GET 详情制造 session 取用；现在打开详情不计入
     * ⇒ 改用 **render**（session 通道的计入型取用）。总数随之从 5 变为 **3**
     * （token 1 次 render + session 1 次 render + mcp 1 次 render；两次 GET 详情只剩 view 留痕）。
     */
    assert.equal(
      (await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: { cookie }, payload: { values: {} } })).statusCode,
      200,
    );
    s = await summary(fx, { cookie }, 7);
    assert.equal(s.by_channel.session, 1);
    assert.equal(s.by_channel.token, 1);
    assert.equal(s.by_channel.mcp, 1);
    assert.equal(s.total, 3);
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
    // v61（FR-114）：打开详情不计入 ⇒ 响应里的 use_count 仍是 0（但它确实留了一条 view）
    assert.equal(before.use_count, 0, '打开详情**不计入** use_count（FR-114）');
    assert.equal(
      readDb(fx, (db) => (db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE prompt_id = ?').get(id) as { n: number }).n),
      1,
      '打开详情仍应**留痕**一条（kind=view）',
    );

    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer });
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: bearer, payload: { values: {} } });

    const after = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer })).json() as Record<string, any>;
    assert.equal(after.version_no, before.version_no, 'version_no 必须不变');
    assert.equal(after.updated_at, before.updated_at, 'updated_at 必须不变');
    /** v61（FR-114）：3 次打开（全 view）+ 1 次 render（copy）⇒ **只有 render 计入** ⇒ 1。 */
    assert.equal(after.use_count, 1, 'use_count 只统计计入型（copy/mcp）');
    assert.ok(String(after.last_used_at).endsWith('Z'));

    // 列表里也带这两个字段（口径必须与详情一致）
    const list = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer })).json() as {
      items: Array<Record<string, any>>;
    };
    assert.equal(list.items[0]?.use_count, 1, 'D-50：列表与详情的 use_count 必须同一口径');
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

    /**
     * ⚠️ **v61（FR-114）改写**：`sort=recent_used` 原来靠"打开详情"制造使用记录；
     * 现在打开不计入 ⇒ 改用**真正计入的渲染取用**来制造（否则三个都"从未用过"，排序无意义）。
     */
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(usedFirst.id)}/render`, headers: bearer, payload: { values: {} } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(usedSecond.id)}/render`, headers: bearer, payload: { values: {} } });

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
    // v61（FR-114）：用 render（计入型）而非 GET 详情来制造一条统计记录
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(prompt.id)}/render`, headers: bearer, payload: { values: {} } });

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
