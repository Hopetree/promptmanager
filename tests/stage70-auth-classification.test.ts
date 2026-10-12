// 阶段 70 / FR-149（鉴权分类与路由注册同源）+ FR-147/148 的对照 —— AC-132 C10–C13。
//
// 这一组不测"某条路径返回什么码"（那是阶段 42 的活），而测**分类机制本身**：
// ① 分类只有一处入口（闸门与声明表都调 classifyApiRequest）；
// ② 机械检查是活的：加一个没声明类别的 `/api/*` 端点 ⇒ 服务起不来；
// ③ 权限矩阵四类仍逐条按真实请求实测（read/write 令牌 + cookie 会话）；
// ④ `/mcp` 的 401 与 `/api/*` 同形，差异（自己 Bearer 鉴权、不收 cookie）写在 docs/traps.md。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { classifyApiRequest, declaredCategory, registerAuthGate, authRouteCoverage } from '../dist/server/auth.js';
import type { Fixture } from './helpers.ts';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource } from './source-text.ts';

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function makeToken(
  fx: Fixture,
  cookie: string,
  name: string,
  scope: 'read' | 'write',
): Promise<string> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { cookie },
    payload: { name, scope },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { token: string }).token;
}

test('AC-132 C10：每个已注册的 /api/* 路由都被声明表显式覆盖，且声明与运行时分类一致', async () => {
  const fx = await makeFixture();
  try {
    const coverage = authRouteCoverage(fx.app);
    assert.ok(coverage.length > 20, `应收集到全部 /api/* 路由，实测 ${String(coverage.length)} 条`);

    const undeclared = coverage.filter((route) => route.category === null);
    assert.deepEqual(
      undeclared,
      [],
      `有路由没被任何声明表覆盖：${JSON.stringify(undeclared)}`,
    );

    // 声明（机械检查用）与运行时分类（闸门用）必须给出同一个答案，否则两处会漂移
    for (const route of coverage) {
      assert.equal(
        route.category,
        classifyApiRequest(route.method, route.url),
        `${route.method} ${route.url} 的声明与运行时分类不一致`,
      );
    }

    // 四类各自的代表：少一类都说明表被改坏了
    const has = (method: string, url: string, category: string): boolean =>
      coverage.some((route) => route.method === method && route.url === url && route.category === category);
    assert.ok(has('POST', '/api/login', 'public'), '登录必须在公开表');
    assert.ok(has('GET', '/api/prompts', 'resource_read'), 'GET /api/prompts 必须归读');
    assert.ok(has('POST', '/api/prompts', 'resource_write'), 'POST /api/prompts 必须归写');
    assert.ok(has('POST', '/api/prompts/:id/render', 'resource_read'), '渲染类 POST 必须归读（FR-115/FR-103）');
    assert.ok(has('GET', '/api/tokens', 'session_only'), '令牌管理必须仅会话');
    assert.ok(has('POST', '/api/sync/pull', 'session_only'), '同步必须仅会话');
  } finally {
    await fx.close();
  }
});

test('AC-132 C11：机械检查是活的 —— 没声明类别的 /api/* 新端点让服务起不来', async () => {
  const bare = Fastify();
  registerAuthGate(bare);
  bare.get('/api/undeclared-probe', async () => ({ ok: true }));
  await assert.rejects(
    async () => {
      await bare.ready();
    },
    /认证分类缺失（FR-149 \/ AC-132 C10）：GET \/api\/undeclared-probe/,
    '未声明的 /api/* 端点必须在 onReady 阶段被拦下',
  );

  // 对照：把路径换成任何一张表覆盖过的前缀 ⇒ 正常就绪（证明拒绝的是"没声明"，不是"新端点"）
  const ok = Fastify();
  registerAuthGate(ok);
  ok.get('/api/prompts', async () => ({ ok: true }));
  await ok.ready();
  await ok.close();
});

test('AC-132 C12：权限矩阵四类逐条真发请求（401 / session_required / insufficient_scope / 放行）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const readToken = await makeToken(fx, cookie, 'AC132 read', 'read');
    const writeToken = await makeToken(fx, cookie, 'AC132 write', 'write');
    const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

    // ① 无凭据：401（fail-closed）
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts' })).statusCode, 401);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/does-not-exist' })).statusCode, 401);

    // ② 资源读：read 令牌放行
    assert.equal(
      (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(readToken) })).statusCode,
      200,
    );
    // 归读的 POST（渲染 / 记复制）也要放行，否则 MCP 的只读令牌会被误伤
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: 'AC132 渲染夹具', user_prompt: '正文 {{项目 | default(甲)}}' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const promptId = (created.json() as { id: number }).id;
    assert.equal(
      (
        await fx.app.inject({
          method: 'POST',
          url: `/api/prompts/${String(promptId)}/render`,
          headers: bearer(readToken),
          payload: { values: {} },
        })
      ).statusCode,
      200,
    );

    // ③ 资源写：read 令牌 403 insufficient_scope，write 令牌 201
    const denied = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: bearer(readToken),
      payload: { title: '不该落库', user_prompt: 'x' },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal((denied.json() as { error: string }).error, 'insufficient_scope');
    assert.equal(
      (
        await fx.app.inject({
          method: 'POST',
          url: '/api/prompts',
          headers: bearer(writeToken),
          payload: { title: 'AC132 写令牌建', user_prompt: 'x' },
        })
      ).statusCode,
      201,
    );

    // ④ 仅会话：令牌一律 403 session_required（与 scope 无关），cookie 会话放行
    for (const token of [readToken, writeToken]) {
      const res = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: bearer(token) });
      assert.equal(res.statusCode, 403, `${token.slice(0, 6)}… 调 /api/tokens 必须 403`);
      assert.equal((res.json() as { error: string }).error, 'session_required');
    }
    assert.equal(
      (await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } })).statusCode,
      200,
    );
    // 同步同理（FR-125：仅会话，令牌不可）
    assert.equal(
      (
        await fx.app.inject({
          method: 'POST',
          url: '/api/sync/pull',
          headers: bearer(writeToken),
          payload: { mode: 'merge', confirm: false },
        })
      ).statusCode,
      403,
    );
  } finally {
    await fx.close();
  }
});

test('AC-132 C13：/mcp 的 401 与 /api/* 同形；差异写在 docs/traps.md', async () => {
  const fx = await makeFixture();
  try {
    const mcp = await fx.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    assert.equal(mcp.statusCode, 401, mcp.body);
    const api = await fx.app.inject({ method: 'GET', url: '/api/prompts' });
    assert.equal(api.statusCode, 401);
    assert.deepEqual(mcp.json(), api.json(), '/mcp 与 /api/* 的 401 响应体必须同形');

    // 无状态：GET/DELETE 明确 405（不是静默 404，也不是"看起来能开会话"）
    assert.equal((await fx.app.inject({ method: 'GET', url: '/mcp' })).statusCode, 405);

    const traps = readSource('docs/traps.md');
    assert.match(traps, /## 20\./, 'docs/traps.md 必须有第 20 节（鉴权分类与 /mcp 的 401）');
    assert.match(traps, /`\/mcp`/, '第 20 节必须写明 /mcp 自己那套 Bearer 鉴权');
    assert.match(traps, /401/, '第 20 节必须写明 401 口径');
  } finally {
    await fx.close();
  }
});

test('AC-132 C10（续，源码级）：分类只有一处入口，闸门不含手写路径判断', async () => {
  const auth = readSource('src/server/auth.ts');
  assert.equal((auth.match(/export function classifyApiRequest\(/g) ?? []).length, 1, '分类入口只能有一个');
  assert.match(auth, /export function declaredCategory\(/);
  assert.match(auth, /const RESOURCE_WRITE_PREFIXES = \[/);
  // 闸门的 onRequest 必须走单一入口（这两行就是"同源"的机械证据）
  assert.match(auth, /const category = classifyApiRequest\(request\.method, path\);/);
  const gate = /app\.addHook\('onRequest'[\s\S]*?\n  \}\);\n\}/.exec(auth)?.[0] ?? '';
  assert.ok(gate.length > 0, '必须能取出闸门处理器本体');
  assert.doesNotMatch(gate, /isSessionOnly\(/, '闸门处理器里不许再手写 isSessionOnly 判断');
  assert.doesNotMatch(gate, /isResourceRead\(/, '闸门处理器里不许再手写 isResourceRead 判断');
  // 收集 + 断言两颗钩子都在注册期挂上（运行时闸门之外的第二重保险）
  assert.match(auth, /app\.addHook\('onRoute'/);
  assert.match(auth, /app\.addHook\('onReady'/);
  assert.match(auth, /认证分类缺失（FR-149 \/ AC-132 C10）/);
});
