/**
 * 使用侧（CLI / MCP）共用的 HTTP 客户端：**只经 HTTP API**，绝不 import 数据库模块。
 * 认证走 `Authorization: Bearer <PM_API_TOKEN>`；地址取 `PM_API_URL`（缺省 `http://127.0.0.1:$PORT`）。
 */

export interface ApiEnv {
  url: string;
  token?: string;
  /** true = 用户显式设置了 PM_API_URL */
  explicit: boolean;
}

export function resolveApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const rawUrl = (env['PM_API_URL'] ?? '').trim();
  const explicit = rawUrl !== '';
  const url = (explicit ? rawUrl : `http://127.0.0.1:${env['PORT'] ?? '8767'}`).replace(/\/+$/, '');
  const rawToken = (env['PM_API_TOKEN'] ?? '').trim();
  return { url, token: rawToken === '' ? undefined : rawToken, explicit };
}

/** 连接层失败（DNS/拒绝连接/超时）：携带目标地址，便于上层给出可读错误。 */
export class ApiConnectionError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`无法连接 ${url}（${reason}）`);
    this.name = 'ApiConnectionError';
    this.url = url;
    this.reason = reason;
  }
}

export interface ApiRequestOptions {
  /** 'mcp' = 供 MCP server 标记通道（服务端 usage 记为 mcp） */
  channel?: 'token' | 'mcp';
  timeoutMs?: number;
  /**
   * **凭据覆盖**（FR-93 ④）：MCP 的 HTTP 传输必须把「本次 HTTP 请求携带的那个 token」透传给内部 API 调用，
   * 而不是用服务端进程 env 里的 `PM_API_TOKEN` —— 否则 usage 归属会记到错误的 token 上。
   * 不传 = 沿用 env（stdio 路径的行为一字不变）。
   */
  token?: string;
}

export interface ApiResponse {
  status: number;
  json: unknown;
  text: string;
}

export async function apiRequest(
  method: string,
  pathName: string,
  body?: unknown,
  options: ApiRequestOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApiResponse> {
  const resolved = resolveApiEnv(env);
  // FR-93 ④：显式传入的 token（HTTP 传输的请求凭据）优先于 env
  const token = options.token ?? resolved.token;
  const url = resolved.url;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (options.channel === 'mcp') headers['x-pm-channel'] = 'mcp';

  let response: Response;
  try {
    response = await fetch(`${url}${pathName}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    throw new ApiConnectionError(url, error instanceof Error ? error.message : String(error));
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text };
}

/** 统一的人类可读错误串（`HTTP 401 unauthorized`）。 */
export function apiError(response: ApiResponse): string {
  const error = (response.json as { error?: unknown } | undefined)?.error;
  return `HTTP ${String(response.status)}${typeof error === 'string' ? ` ${error}` : ''}`;
}
