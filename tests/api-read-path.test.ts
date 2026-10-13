// 阶段 72 / BRIEF FR-159 / AC-134 E（N8 / N39）：读路径的开销与响应头。
//
// N39：`/api/*` 的响应既可能含提示词正文，也可能含令牌/统计 —— 必须显式禁止共享缓存
//      （中间代理、浏览器 bfcache、公司网关都可能缓存），而当前全仓没有任何 cache-control。
// N8：`GET /api/prompts/:id` 取一次数据后又取了一次（`return (await getPrompt(...)) ?? prompt`），
//      第二次纯属浪费（`recordUsage` 只写 usage_events，绝不改 prompts 行）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource, stripSourceComments } from './source-text.ts';

test('AC-134 E19：/api/* 一律带 cache-control: no-store（含 401），非 API 路径不受影响', async () => {
  const fixture = await makeFixture();
  try {
    const authed = cookieOf(await login(fixture.app));
    for (const url of ['/api/prompts', '/api/folders', '/api/tags', '/api/usage/summary']) {
      const response = await fixture.app.inject({ method: 'GET', url, headers: { cookie: authed } });
      assert.equal(response.statusCode, 200, `${url} 应 200`);
      assert.equal(response.headers['cache-control'], 'no-store', `${url} 缺少 no-store`);
    }
    // 未认证的 401 也必须带（错误响应同样可能被缓存）
    const denied = await fixture.app.inject({ method: 'GET', url: '/api/prompts' });
    assert.equal(denied.statusCode, 401, '前置：未认证应 401');
    assert.equal(denied.headers['cache-control'], 'no-store', '401 也要带 no-store');
    // 范围就是 /api/*：健康检查不在其中，别顺手全局加
    const health = await fixture.app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(health.statusCode, 200, '前置：/healthz 应 200');
    assert.notEqual(health.headers['cache-control'], 'no-store', 'no-store 只该覆盖 /api/*');
  } finally {
    await fixture.close();
  }
});

test('AC-134 E18：GET /api/prompts/:id 只取一次数（读码证据 + 行为面仍取到正文）', async () => {
  const source = stripSourceComments(readSource('src/server/routes/prompts.ts'));
  const start = source.indexOf("app.get('/api/prompts/:id'");
  const end = source.indexOf("app.put('/api/prompts/:id'");
  assert.ok(start > 0 && end > start, '找不到详情路由（源码结构变了？）');
  const block = source.slice(start, end);
  const calls = [...block.matchAll(/getPrompt\(/g)].length;
  assert.equal(calls, 1, `详情路由必须只取一次数，实际 ${calls} 次`);
  assert.match(block, /return prompt;/, '应直接返回已取到的对象（不许再取一次）');

  const fixture = await makeFixture();
  try {
    const cookie = cookieOf(await login(fixture.app));
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '读路径夹具', user_prompt: '正文-只取一次' },
    });
    assert.equal(created.statusCode, 201, '前置：创建应 201');
    const id = (created.json() as { id: number }).id;
    const detail = await fixture.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.json() as { user_prompt: string }).user_prompt, '正文-只取一次', '详情正文必须正确');
  } finally {
    await fixture.close();
  }
});
