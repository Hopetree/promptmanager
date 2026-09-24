import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PROJECT_ROOT, cookieOf, login, makeFixture, readDb } from './helpers.ts';

/**
 * 这些用例用 **官方 TS SDK 客户端** 经 stdio 跑端到端，作为回归防线。
 * ⚠️ 注意：BRIEF AC-25 明确要求"真实对端"（Python `mcp` 1.30.0，协议 2025-11-25）——
 * 那份证据在 tools/ac-stage7.sh 里，**不能用这里的 SDK 自测代替**。
 */
const ENTRY = path.join(PROJECT_ROOT, 'bin', 'pm-mcp.mjs');

async function withMcp(
  env: Record<string, string>,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: { ...getDefaultEnvironment(), ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'pm-mcp-test-client', version: '0.0.0' });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

/** 从工具结果里取第一段 text（SDK 的结果是联合类型，这里按结构窄化）。 */
function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  return content?.find((item) => item.type === 'text')?.text ?? '';
}

/** 起夹具：服务 + 一条 prompt + 一个 token，返回 MCP 需要的 env 与事实。 */
async function fixture() {
  const fx = await makeFixture();
  const cookie = cookieOf(await login(fx.app));
  const created = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'mcp' } });
  assert.equal(created.statusCode, 201, created.body);
  const token = (created.json() as { token: string }).token;

  const prompt = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { title: 'MCP 会话交接', user_prompt: '你好 {{姓名}}，交给下一位 {{var-b}}', notes: 'mcp 备注' },
  });
  const id = (prompt.json() as { id: number }).id;
  const base = (await fx.app.listen({ host: '127.0.0.1', port: 0 })).replace(/\/$/, '');

  return {
    fx,
    id,
    base,
    env: { PM_API_URL: base, PM_API_TOKEN: token },
    token,
    cleanup: async () => {
      await fx.close();
    },
  };
}

test('MCP：initialize + tools/list 恰好三个只读工具（名字固定）', async () => {
  const ctx = await fixture();
  try {
    await withMcp(ctx.env, async (client) => {
      const server = client.getServerVersion();
      assert.ok(server !== undefined, 'initialize 后应能读到 serverInfo');
      assert.equal(server?.name, 'promptmanager');

      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name).sort(),
        ['prompt_get', 'prompt_render', 'prompt_search'],
        '工具面必须恰好是这三个（名字固定）',
      );
      for (const tool of tools.tools) {
        assert.ok(tool.inputSchema !== undefined, `${tool.name} 应声明 inputSchema`);
      }
    });
  } finally {
    await ctx.cleanup();
  }
});

test('MCP：prompt_search 命中夹具；prompt_get 返回正文与变量；prompt_render 与 API 逐字符一致', async () => {
  const ctx = await fixture();
  try {
    await withMcp(ctx.env, async (client) => {
      const search = await client.callTool({ name: 'prompt_search', arguments: { query: '会话交接' } });
      assert.notEqual(search.isError, true, textOf(search));
      const searchBody = JSON.parse(textOf(search)) as { total: number; items: Array<{ id: number; title: string }> };
      assert.equal(searchBody.total, 1);
      assert.equal(searchBody.items[0]?.id, ctx.id);
      assert.equal(searchBody.items[0]?.title, 'MCP 会话交接');

      const got = await client.callTool({ name: 'prompt_get', arguments: { id: ctx.id } });
      assert.notEqual(got.isError, true, textOf(got));
      const prompt = JSON.parse(textOf(got)) as Record<string, unknown>;
      assert.equal(prompt.user_prompt, '你好 {{姓名}}，交给下一位 {{var-b}}');
      assert.equal(prompt.system_prompt, '');
      assert.equal(prompt.notes, 'mcp 备注');
      assert.deepEqual(prompt.variables, ['姓名', 'var-b'], 'prompt_get 应带变量列表');

      const rendered = await client.callTool({ name: 'prompt_render', arguments: { id: ctx.id, values: { 姓名: '张三' } } });
      assert.notEqual(rendered.isError, true, textOf(rendered));
      const body = JSON.parse(textOf(rendered)) as { user_prompt: string; missing: string[] };

      const api = await ctx.fx.app.inject({
        method: 'POST',
        url: `/api/prompts/${String(ctx.id)}/render`,
        headers: { authorization: `Bearer ${ctx.token}` },
        payload: { values: { 姓名: '张三' } },
      });
      const apiBody = api.json() as { user_prompt: string };
      assert.equal(body.user_prompt, apiBody.user_prompt, 'MCP 渲染必须与 /api/render 完全一致');
      assert.deepEqual(body.missing, ['var-b']);
    });
  } finally {
    await ctx.cleanup();
  }
});

test('MCP：经 MCP 的取用计入 usage（channel=mcp），且不改 updated_at', async () => {
  const ctx = await fixture();
  try {
    const before = (await ctx.fx.app.inject({ method: 'GET', url: `/api/prompts/${String(ctx.id)}`, headers: { authorization: `Bearer ${ctx.token}` } })).json() as Record<string, unknown>;

    await withMcp(ctx.env, async (client) => {
      await client.callTool({ name: 'prompt_get', arguments: { id: ctx.id } });
      await client.callTool({ name: 'prompt_render', arguments: { id: ctx.id, values: {} } });
    });

    const summary = (await ctx.fx.app.inject({ method: 'GET', url: '/api/usage/summary?days=7', headers: { authorization: `Bearer ${ctx.token}` } })).json() as {
      by_channel: Record<string, number>;
    };
    /**
     * ⚠️ **v61（FR-114）改写**：原来断言 `mcp >= 2`（`prompt_get` + `prompt_render` 各一次）。
     * 现在「打开详情」类读取**只留痕不计入** ⇒ `prompt_get`（MCP 版"打开详情"）落 `kind='view'`，
     * 只有 `prompt_render` 计为 `kind='mcp'` ⇒ summary（只统计计入型）里 mcp 应为 **1**。
     * 覆盖没有减弱：下面新增断言"两条记录都在，且 kind 分别是 view / mcp"（原来只看了汇总数字）。
     */
    assert.equal(summary.by_channel.mcp ?? 0, 1, `mcp 通道只应计入 render 那一次：${JSON.stringify(summary.by_channel)}`);
    const kinds = readDb(
      ctx.fx,
      (db) =>
        db
          .prepare("SELECT kind, COUNT(*) AS n FROM usage_events WHERE channel = 'mcp' GROUP BY kind ORDER BY kind")
          .all() as Array<{ kind: string; n: number }>,
    );
    assert.deepEqual(
      kinds.map((row) => `${row.kind}:${String(row.n)}`),
      ['mcp:1', 'view:1'],
      `MCP 的 prompt_get 应留痕 view、prompt_render 应记 mcp：${JSON.stringify(kinds)}`,
    );

    const after = (await ctx.fx.app.inject({ method: 'GET', url: `/api/prompts/${String(ctx.id)}`, headers: { authorization: `Bearer ${ctx.token}` } })).json() as Record<string, unknown>;
    assert.equal(after.updated_at, before.updated_at, 'MCP 取用不得改 updated_at');
    assert.equal(after.version_no, before.version_no, 'MCP 取用不得产生版本');
  } finally {
    await ctx.cleanup();
  }
});

test('AC-26 ③：未设 PM_API_TOKEN → 工具调用返回明确错误（tools/list 仍可用），绝不静默返回空结果', async () => {
  const ctx = await fixture();
  try {
    await withMcp({ PM_API_URL: ctx.base }, async (client) => {
      // 没有 token 也要能 list（否则无法执行 AC-26 ③ 的"调用工具"）
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['prompt_get', 'prompt_render', 'prompt_search']);

      const result = await client.callTool({ name: 'prompt_search', arguments: { query: '会话交接' } });
      assert.equal(result.isError, true, '缺 token 必须是明确错误');
      const message = textOf(result);
      assert.match(message, /PM_API_TOKEN/, `错误消息要点名 PM_API_TOKEN：${message}`);
      assert.doesNotMatch(message, /^\s*\[\s*\]\s*$/, '不得静默返回空数组');
    });
  } finally {
    await ctx.cleanup();
  }
});

test('AC-26 ④：服务停掉后调用工具 → 连接错误（证明经 API 而非直连 DB）', async () => {
  const ctx = await fixture();
  const base = ctx.base;
  const env = ctx.env;
  await ctx.fx.close(); // 服务停掉（数据库文件仍在：若工具直连 DB 就会"照常返回"）

  await withMcp(env, async (client) => {
    const result = await client.callTool({ name: 'prompt_get', arguments: { id: ctx.id } });
    assert.equal(result.isError, true, '服务不可达时必须报错');
    const message = textOf(result);
    assert.match(message, /无法连接|HTTP|ECONNREFUSED|fetch failed/i, `应给出连接类错误：${message}`);
    assert.ok(message.includes(base), `错误里应包含目标地址：${message}`);
  });
});
