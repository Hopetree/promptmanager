import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ApiConnectionError, apiError, apiRequest, resolveApiEnv } from '../client/pm-api.js';
import { loadConfig } from '../config.js';

/**
 * MCP server（FR-18 / D-15）：**stdio 传输、只读工具面、经 HTTP API + Bearer 取数**。
 *
 * 硬约束（AC-26）：
 * - 恰好三个工具：`prompt_search` / `prompt_get` / `prompt_render`，没有任何写操作工具；
 * - 不监听端口（stdio 由 agent 拉起子进程）；
 * - 本层**不 import 数据库/业务服务模块**，构造上不可能直连 DB；
 * - 每次调用都带 `X-PM-Channel: mcp` → 服务端 usage 记 `mcp` 通道（FR-19）；
 * - 缺 `PM_API_TOKEN` 或服务不可达 → 工具返回 `isError: true` 的**明确错误**，不静默返回空结果。
 *
 * ⚠️ stdout 只用于 JSON-RPC：本模块**不得**向 stdout 写任何东西（诊断一律 stderr）。
 */
export const MCP_SERVER_NAME = 'promptmanager';

/** 直接用 SDK 的 CallToolResult，避免自造形状与 SDK 漂移。 */
type ToolResult = CallToolResult;

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

type ApiOutcome<T> = { ok: true; data: T } | { ok: false; result: ToolResult };

function missingToken(): ToolResult {
  return fail(
    '缺少 PM_API_TOKEN：MCP 一律经本服务的 HTTP API 取数（不直连数据库）。' +
      '请设置 PM_API_URL（如 http://127.0.0.1:8767）与 PM_API_TOKEN 后重试；' +
      'token 用 `node bin/pm.mjs token create --name mcp` 创建（明文只显示一次）。',
  );
}

/** 统一的 API 调用：把"缺 token / 连不上 / HTTP 错误 / 404"翻译成工具错误结果。 */
async function requestJson<T>(
  method: string,
  pathName: string,
  body?: unknown,
  notFoundMessage?: string,
): Promise<ApiOutcome<T>> {
  if (resolveApiEnv().token === undefined) return { ok: false, result: missingToken() };

  try {
    const response = await apiRequest(method, pathName, body, { channel: 'mcp' });
    if (response.status === 404 && notFoundMessage !== undefined) {
      return { ok: false, result: fail(notFoundMessage) };
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, result: fail(`调用 API 失败：${apiError(response)}`) };
    }
    return { ok: true, data: response.json as T };
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      return {
        ok: false,
        result: fail(
          `无法连接 ${error.url}（${error.reason}）—— MCP 只经本服务的 HTTP API 取数，不直连数据库；` +
            '请确认服务已启动、PM_API_URL 正确。',
        ),
      };
    }
    return { ok: false, result: fail(`调用 API 失败：${error instanceof Error ? error.message : String(error)}`) };
  }
}

interface SearchItem {
  id: number;
  title: string;
  tags: string[];
  favorite: boolean;
  updated_at: string;
  use_count: number;
  last_used_at: string | null;
}

/** 组装 MCP server（不连接传输，便于测试）。 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: loadConfig().version });

  server.registerTool(
    'prompt_search',
    {
      title: '检索 prompt',
      description:
        '按关键词检索 prompt（中文可用：≥3 字走全文索引、两字词走子串兜底）。' +
        '返回命中的 id/标题/标签/更新时间与取用统计，不返回正文（正文用 prompt_get 取）。',
      inputSchema: {
        query: z.string().describe('检索关键词；传空字符串表示不过滤（按更新时间倒序）'),
        limit: z.number().int().min(1).max(200).optional().describe('返回条数上限，默认 20'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const size = limit ?? 20;
      const outcome = await requestJson<{ total: number; items: Array<Record<string, unknown>> }>(
        'GET',
        `/api/prompts?q=${encodeURIComponent(query)}&limit=${String(size)}`,
      );
      if (!outcome.ok) return outcome.result;
      const items: SearchItem[] = outcome.data.items.map((item) => ({
        id: Number(item.id),
        title: String(item.title ?? ''),
        tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
        favorite: item.favorite === true,
        updated_at: String(item.updated_at ?? ''),
        use_count: Number(item.use_count ?? 0),
        last_used_at: (item.last_used_at as string | null) ?? null,
      }));
      return ok({ total: outcome.data.total, limit: size, items });
    },
  );

  server.registerTool(
    'prompt_get',
    {
      title: '取单个 prompt',
      description: '按 id 取一个 prompt 的完整内容（user_prompt / system_prompt / notes / 标签 / 变量列表）。这次取用会记入使用记录。',
      inputSchema: { id: z.number().int().positive().describe('prompt id') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const prompt = await requestJson<Record<string, unknown>>('GET', `/api/prompts/${String(id)}`, undefined, `prompt ${String(id)} 不存在`);
      if (!prompt.ok) return prompt.result;

      const variables = await requestJson<{ variables: string[] }>(
        'GET',
        `/api/prompts/${String(id)}/variables`,
        undefined,
        `prompt ${String(id)} 不存在`,
      );
      if (!variables.ok) return variables.result;

      return ok({ ...prompt.data, variables: variables.data.variables });
    },
  );

  server.registerTool(
    'prompt_render',
    {
      title: '渲染变量出成品',
      description:
        '把 prompt 里的 {{变量}} 用给定值渲染成成品文本（未提供的变量原样保留并列入 missing）。只返回文本，不写库；这次取用会记入使用记录。',
      inputSchema: {
        id: z.number().int().positive().describe('prompt id'),
        values: z.record(z.string(), z.string()).optional().describe('变量名 → 值的映射，如 {"姓名":"张三"}'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, values }) => {
      const outcome = await requestJson<{ user_prompt: string; system_prompt: string; missing: string[] }>(
        'POST',
        `/api/prompts/${String(id)}/render`,
        { values: values ?? {} },
        `prompt ${String(id)} 不存在`,
      );
      if (!outcome.ok) return outcome.result;
      return ok(outcome.data);
    },
  );

  return server;
}

/** 以 stdio 启动（由 agent 拉起；不监听任何端口）。 */
export async function runMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  const { url, token } = resolveApiEnv();
  // 诊断只走 stderr：stdout 是 JSON-RPC 专用
  process.stderr.write(
    `promptmanager MCP server (stdio) — API=${url}｜token=${token === undefined ? '未设置（工具调用会返回明确错误）' : '已设置'}\n`,
  );
  await server.connect(transport);
}
