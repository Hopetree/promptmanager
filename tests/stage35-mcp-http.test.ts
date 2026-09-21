// 阶段 35 / FR-93（BRIEF v46 §4 + §8 AC-95）的 **MCP Streamable HTTP 传输**断言。
// 运行时"真实对端"证据（官方 Python 客户端 mcp==1.30.0）在 tools/ac-stage35.sh 里，**不能用这里的 SDK 自测代替**。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/** 起一个**真实监听**的实例（MCP 的 HTTP 传输要写 raw response，`inject` 不适合）。 */
async function listening(fx: Fixture): Promise<{ base: string; close: () => Promise<void> }> {
  await fx.app.listen({ host: '127.0.0.1', port: 0 });
  const address = fx.app.server.address();
  assert.ok(address !== null && typeof address === 'object');
  const port = (address as { port: number }).port;
  return { base: `http://127.0.0.1:${String(port)}`, close: () => fx.app.close() };
}

async function newToken(fx: Fixture, cookie: string, name: string): Promise<string> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { token: string }).token;
}

async function createPrompt(fx: Fixture, cookie: string, title: string, body: string): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { title, user_prompt: body },
  });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

/** 用官方 TS SDK 客户端连 `POST /mcp`（Bearer 头由 transport 带上）。 */
async function withHttpMcp(
  base: string,
  token: string | undefined,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'pm-mcp-http-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * MCP 工具内部经 HTTP 调回本服务，因此测试进程必须知道"本实例的 URL"。
 * 生产里服务自己就知道（默认 `http://127.0.0.1:$PORT`），测试用的是**临时端口** ⇒ 显式设一次。
 */
async function withApiEnv<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const savedUrl = process.env['PM_API_URL'];
  const savedToken = process.env['PM_API_TOKEN'];
  process.env['PM_API_URL'] = base;
  delete process.env['PM_API_TOKEN'];
  try {
    return await fn();
  } finally {
    if (savedUrl === undefined) delete process.env['PM_API_URL'];
    else process.env['PM_API_URL'] = savedUrl;
    if (savedToken === undefined) delete process.env['PM_API_TOKEN'];
    else process.env['PM_API_TOKEN'] = savedToken;
  }
}

/** 直接查库读取用次数（**不能**用 GET /api/prompts/:id 量 —— 那个接口本身会记一次取用）。 */
function useCountOf(fx: Fixture, promptId: number): number {
  return readDb(
    fx,
    (db) =>
      (db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE prompt_id = ?').get(promptId) as { n: number }).n,
  );
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  return content?.find((item) => item.type === 'text')?.text ?? '';
}

test('AC-95 ①：真客户端经 POST /mcp 走 initialize → tools/list → tools/call，三个工具齐全且返回正确内容', async () => {
  const fx = await makeFixture();
  const { base, close } = await listening(fx);
  try {
    const cookie = cookieOf(await login(fx.app));
    const token = await newToken(fx, cookie, 'http-mcp');
    const id = await createPrompt(fx, cookie, 'AC35 HTTP 夹具', '你好 {{姓名}}');

    await withApiEnv(base, () =>
      withHttpMcp(base, token, async (client) => {
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name).sort(),
        ['prompt_get', 'prompt_render', 'prompt_search'],
        '工具面必须恰好是这三个只读工具',
      );

      const search = await client.callTool({ name: 'prompt_search', arguments: { query: 'AC35' } });
      assert.equal(search.isError, undefined);
      const found = JSON.parse(textOf(search)) as { items: Array<{ title: string }> };
      assert.equal(found.items.length, 1);
      assert.equal(found.items[0]?.title, 'AC35 HTTP 夹具');

      const got = await client.callTool({ name: 'prompt_get', arguments: { id } });
      const prompt = JSON.parse(textOf(got)) as { user_prompt: string; variables: string[] };
      assert.equal(prompt.user_prompt, '你好 {{姓名}}');
      assert.deepEqual(prompt.variables, ['姓名']);

      const rendered = await client.callTool({
        name: 'prompt_render',
        arguments: { id, values: { 姓名: '世界' } },
      });
      assert.equal((JSON.parse(textOf(rendered)) as { user_prompt: string }).user_prompt, '你好 世界');
      }),
    );
  } finally {
    await close();
    await fx.close();
  }
});

test('AC-95 ②：不带 Authorization / 带错 token → 401，且**不触碰内部 API**', async () => {
  const fx = await makeFixture();
  const { base, close } = await listening(fx);
  try {
    const cookie = cookieOf(await login(fx.app));
    const id = await createPrompt(fx, cookie, 'AC35 401 夹具', '正文');
    const useCountBefore = useCountOf(fx, id);

    // ① 完全不带 Authorization
    const noAuth = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'prompt_get', arguments: { id } } }),
    });
    assert.equal(noAuth.status, 401);
    assert.equal((await noAuth.json() as { error: string }).error, 'unauthorized');

    // ② 带一个格式正确但无效的 token
    const badAuth = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer pm_not-a-real-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'prompt_get', arguments: { id } } }),
    });
    assert.equal(badAuth.status, 401);

    // 负向：两次都不得去调内部 API ⇒ usage_events 里一条都不该新增（直接查库，不经会记 usage 的接口）
    assert.equal(useCountOf(fx, id), useCountBefore, '401 的请求不得触碰内部 API');
    assert.equal(useCountBefore, 0, '前置：此刻该 prompt 还没有任何取用记录');
  } finally {
    await close();
    await fx.close();
  }
});

test('AC-95 ③④：凭据透传 —— 服务端 env 无 PM_API_TOKEN 也能调通，且只有请求那个 token 被使用', async () => {
  const fx = await makeFixture();
  const { base, close } = await listening(fx);
  try {
    const cookie = cookieOf(await login(fx.app));
    const tokenA = await newToken(fx, cookie, 'token-A');
    const tokenB = await newToken(fx, cookie, 'token-B');
    const id = await createPrompt(fx, cookie, 'AC35 透传夹具', '正文');

    // 关键设置：**进程 env 里没有任何 token**（若工具回退到 env，就会返回"缺少凭据"错误）
    await withApiEnv(base, () =>
      withHttpMcp(base, tokenA, async (client) => {
        const got = await client.callTool({ name: 'prompt_get', arguments: { id } });
        assert.equal(got.isError, undefined, 'env 无 token 也必须成功 ⇒ 用的是请求头里的 token');
      }),
    );

    const rows = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    const items = (rows.json() as { items: Array<{ name: string; last_used_at: string | null }> }).items;
    const a = items.find((item) => item.name === 'token-A');
    const b = items.find((item) => item.name === 'token-B');
    assert.ok(a?.last_used_at !== null && a?.last_used_at !== undefined, 'token A 必须被标记使用过');
    assert.equal(b?.last_used_at, null, 'token B 一次都没被用过（证明没有回退到别的凭据）');
  } finally {
    await close();
    await fx.close();
  }
});

test('AC-95：无状态契约 —— GET /mcp 与 DELETE /mcp 明确 405（不建会话）', async () => {
  const fx = await makeFixture();
  const { base, close } = await listening(fx);
  try {
    const cookie = cookieOf(await login(fx.app));
    const token = await newToken(fx, cookie, 'stateless');
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${base}/mcp`, { method, headers: { authorization: `Bearer ${token}` } });
      assert.equal(res.status, 405, `${method} /mcp 必须是 405`);
      assert.equal((await res.json() as { error: string }).error, 'method_not_allowed');
    }
  } finally {
    await close();
    await fx.close();
  }
});

test('AC-95 ⑤⑥：同一份 buildMcpServer —— 工具定义只有一处（stdio 与 HTTP 不分叉），且源码不硬编码凭据', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { PROJECT_ROOT } = await import('./helpers.ts');
  const http = readFileSync(path.join(PROJECT_ROOT, 'src', 'mcp', 'http.ts'), 'utf8');
  const server = readFileSync(path.join(PROJECT_ROOT, 'src', 'mcp', 'server.ts'), 'utf8');
  // 工具注册只在 server.ts（http.ts 不重复定义工具）
  for (const tool of ['prompt_search', 'prompt_get', 'prompt_render']) {
    assert.ok(server.includes(`'${tool}'`), `工具定义应在 server.ts：${tool}`);
    assert.equal(http.includes(`'${tool}'`), false, `http.ts 不得重复定义工具：${tool}`);
  }
  assert.ok(http.includes('buildMcpServer({ token: plaintext })'), 'HTTP 传输必须把请求 token 交给 buildMcpServer');
  assert.ok(http.includes('sessionIdGenerator: undefined'), '必须是**无状态**模式');
  assert.ok(http.includes('resolveApiToken'), '必须复用 /api/* 同一套 token 校验');
  // 不泄密：不得把 token 写进日志/响应
  assert.equal(/log\.[a-z]+\([^)]*token/i.test(http.replace(/tokenId/g, '')), false, '不得把 token 明文写进日志');
});
