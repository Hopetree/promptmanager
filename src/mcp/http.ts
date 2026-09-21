import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { bearerPlaintext } from '../server/auth.js';
import { resolveApiToken } from '../services/tokens.js';
import { buildMcpServer } from './server.js';

/**
 * MCP 的 **Streamable HTTP 传输**（FR-93 / D-35 ①）—— 让 MCP 客户端（如 QwenPaw）用
 * `url = http://<主机>:8767/mcp` + `Authorization: Bearer <token>` **远程接入**，不再需要本地副本/启动器。
 *
 * 设计要点（逐条对应 BRIEF FR-93）：
 * - **顶层路径 `/mcp`**（不在 `/api/` 下）：既有 `registerAuthGate` 只拦 `/api/*`，放顶层可避免与那套
 *   JSON 错误中间件耦合 ⇒ 本模块**自己做鉴权**。
 * - **Bearer-only**：必须 `Authorization: Bearer <API Token>`（与 `/api/*` 同一套 token，复用 `resolveApiToken`）；
 *   无 token / 无效 token → **401 且不继续**（不会去调内部 API）。**不接受 cookie 会话**（MCP 客户端不发 cookie）。
 * - **无状态**：`sessionIdGenerator: undefined`，不引入会话存储；每个请求新建一对 server/transport 并在响应后关闭。
 *   因此 `GET /mcp`（SSE 流）与 `DELETE /mcp`（会话终止）在无状态模式下没有意义 → 明确回 **405**。
 * - **凭据透传**：把本次请求携带的 token 交给 `buildMcpServer({ token })` ⇒ 工具内部对 `/api/*` 的调用用它
 *   （而不是服务端 env 的 `PM_API_TOKEN`），usage 归属正确、`X-PM-Channel: mcp` 语义不变。
 * - **不泄密**：token 明文不进日志/错误体/响应头（本模块只把它交给 `resolveApiToken` 与 MCP server）。
 * - **复用同一份工具实现**：工具定义只在 `src/mcp/server.ts`，stdio 与 HTTP 共用，无分叉。
 */
export function registerMcpHttpRoutes(app: FastifyInstance): void {
  app.post('/mcp', async (request, reply) => {
    const plaintext = bearerPlaintext(request);
    if (plaintext === null) {
      // 无 Authorization（或不是 Bearer 形态）：直接 401，**不触碰内部 API**
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const token = await resolveApiToken(app.qe, plaintext);
    if (token === null) {
      // 无效/已撤销的 token：同样 401，**不触碰内部 API**
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const server = buildMcpServer({ token: plaintext });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 无状态：不生成、不校验 session id
      enableJsonResponse: true, // POST 用 application/json 直接回，不强制 SSE（更省事、客户端都支持）
    });

    // 接管原始响应：后面的写入由 transport 负责（Fastify 不再插手）
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      // 出错也要给出可读结果；不打印任何凭据
      request.log.error({ err: error instanceof Error ? error.message : String(error) }, 'MCP HTTP 处理失败');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'internal_error' }));
      } else {
        reply.raw.end();
      }
    } finally {
      // 无状态：本次请求用完即关（连接/消息历史都不保留）
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  // 无状态模式下没有"长连 SSE 流"与"会话"可言 ⇒ 明确拒绝，而不是静默 404
  for (const method of ['get', 'delete'] as const) {
    app[method]('/mcp', async (_request, reply) =>
      reply.code(405).send({
        error: 'method_not_allowed',
        message: 'MCP 端点是**无状态**的：用 POST /mcp 发送 JSON-RPC（不要建立会话）。',
      }),
    );
  }
}
