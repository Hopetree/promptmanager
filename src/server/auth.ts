import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, resolveSession, type SessionUser } from '../services/auth.js';
import { resolveApiToken, type TokenScope } from '../services/tokens.js';

/** 使用记录里的"通道"取值（BRIEF FR-19 固定）。 */
export type AuthChannel = 'session' | 'token' | 'mcp';

/** 已认证主体：cookie 会话（浏览器）或 Bearer token（外部客户端/MCP）。 */
export interface Principal {
  kind: 'session' | 'token';
  username: string;
  channel: AuthChannel;
  /** 仅 token 通道有 */
  tokenId?: number;
  /**
   * 仅 token 通道有：FR-103 的令牌权限（`read` / `write`）。**只作用于资源** ——
   * 令牌管理、改口令、登出**与 scope 无关**，一律仅会话（见 `registerAuthGate` 的分类表）。
   */
  scope?: TokenScope;
  /** 仅 cookie 会话有：`sessions.id`（= sha256(token)），改密码时用它保留当前会话（FR-67） */
  sessionId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** 已认证主体；由 registerAuthGate 的 onRequest 钩子填充（未认证请求不会进业务处理器）。 */
    principal?: Principal;
  }
}

/** 无需认证的 /api/* 端点（BRIEF §6.1 只放行登录；/healthz 不在 /api/ 下）。 */
const PUBLIC_API_PATHS = new Set<string>(['/api/login']);

/* ─────────────────────────── FR-103：令牌权限的三类边界 ───────────────────────────
 * 分类**集中在这里**（而不是散落到每个路由），这样"新加一个端点忘了判权限"的默认行为是
 * **fail-closed**：不在"仅会话"与"资源读"白名单里的 `/api/*` 请求，令牌一律需要 `write`。
 * 三条边界（BRIEF v53 §4 FR-103 ②）：
 *   1. 资源读（read/write 都行）：prompts/folders/tags/export/usage 的 **GET** + `/api/me`
 *      + **渲染类 POST**（`POST /api/prompts/:id/render`、`POST /api/render/markdown`）
 *      —— 渲染只出文本、不改资源，**必须归读**，否则 MCP 的 `prompt_render` 会被只读令牌误伤；
 *   2. 资源写（**仅 write**）：其余 prompts/folders/tags/import 的 POST/PUT/PATCH/DELETE；
 *   3. 不属于资源 ⇒ **仅会话**（任何令牌都不可）：`/api/tokens*`、`/api/password`、`/api/logout`。
 */

/** 类别 ③：令牌**一律不可**（与 scope 无关），必须 cookie 会话。 */
const SESSION_ONLY_PREFIXES = ['/api/tokens'];
const SESSION_ONLY_PATHS = new Set<string>(['/api/password', '/api/logout']);

/** 类别 ①：资源读的路径前缀（方法为 GET 时）。`/api/me` 只是报身份，也算读。 */
const RESOURCE_READ_PREFIXES = ['/api/prompts', '/api/folders', '/api/tags', '/api/export', '/api/usage'];
const RESOURCE_READ_EXTRA_PATHS = new Set<string>(['/api/me']);

/** 类别 ①：**归"读"的 POST**（只渲染、不改资源）。 */
const RESOURCE_READ_POST = [/^\/api\/prompts\/\d+\/render$/, /^\/api\/render\/markdown$/];

function isSessionOnly(path: string): boolean {
  return SESSION_ONLY_PATHS.has(path) || SESSION_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 该请求是否属于"资源读"（GET 白名单路径，或归读的渲染类 POST）。 */
function isResourceRead(method: string, path: string): boolean {
  if (method === 'POST') return RESOURCE_READ_POST.some((pattern) => pattern.test(path));
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (RESOURCE_READ_EXTRA_PATHS.has(path)) return true;
  return RESOURCE_READ_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export async function registerCookieSupport(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
}

/**
 * `Authorization: Bearer <token>` → 明文；不是 Bearer 形态则返回 null。
 * 导出供 MCP 的 HTTP 传输（`src/mcp/http.ts`）复用同一套解析口径（FR-93）。
 */
export function bearerPlaintext(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const value = (match[1] ?? '').trim();
  return value === '' ? null : value;
}

/** `X-PM-Channel: mcp` 只对 Bearer 生效（MCP server 在阶段 7 用它标记通道）；cookie 恒为 session。 */
function bearerChannel(request: FastifyRequest): AuthChannel {
  const header = request.headers['x-pm-channel'];
  return typeof header === 'string' && header.trim().toLowerCase() === 'mcp' ? 'mcp' : 'token';
}

/**
 * 全局认证闸门：除放行清单外，所有 /api/* 未认证一律 401 {"error":"unauthorized"}。
 * 两条通道并存（D-13）：`Authorization: Bearer <token>` 优先，其次 `pm_sid` cookie 会话。
 * onRequest 在路由解析之前执行，因此**未实现的 /api/* 端点**对未认证请求同样 401（AC-3）。
 */
export function registerAuthGate(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_API_PATHS.has(path)) return;

    const plaintext = bearerPlaintext(request);
    if (plaintext !== null) {
      const token = await resolveApiToken(app.qe, plaintext);
      if (token === null) {
        await reply.code(401).send({ error: 'unauthorized' });
        return;
      }
      // 单用户：token 与本人等价（D-13），username 取唯一用户
      const owner = await app.qe
        .selectFrom('users')
        .select('username')
        .orderBy('id', 'asc')
        .limit(1)
        .executeTakeFirst();
      /**
       * FR-103 ②：先判"仅会话"（与 scope 无关），再判"资源写需要 write"。
       * 两者都是 **403**，但错误码分开：`session_required`（令牌本就不该调这个端点）
       * 与 `insufficient_scope`（只读令牌调了资源写 ⇒ 换读写令牌即可）。
       */
      if (isSessionOnly(path)) {
        await reply.code(403).send({
          error: 'session_required',
          message: '令牌管理与账号操作只允许浏览器会话（cookie）；请用界面操作，不要用 API 令牌。',
        });
        return;
      }
      if (!isResourceRead(request.method, path) && token.scope !== 'write') {
        await reply.code(403).send({
          error: 'insufficient_scope',
          message: '该令牌是只读（read），只能检索 / 查看 / 渲染；修改资源需要读写（write）令牌。',
        });
        return;
      }

      request.principal = {
        kind: 'token',
        username: owner?.username ?? 'admin',
        channel: bearerChannel(request),
        tokenId: token.id,
        scope: token.scope,
      };
      return;
    }

    const session = await resolveSession(app.qe, request.cookies[SESSION_COOKIE] ?? '');
    if (session === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    request.principal = {
      kind: 'session',
      username: session.username,
      channel: 'session',
      sessionId: session.sessionId,
    };
  });
}

/** 受保护处理器里取当前主体（闸门已保证存在）。 */
export function currentPrincipal(request: FastifyRequest): Principal {
  const principal = request.principal;
  if (principal === undefined) {
    throw new Error('认证闸门失效：受保护处理器拿到了未认证请求');
  }
  return principal;
}

/** 需要"真的是 cookie 会话"的场景（如登出）。 */
export function currentSession(request: FastifyRequest): SessionUser {
  const principal = currentPrincipal(request);
  if (principal.kind !== 'session') {
    const error = new Error('unauthorized');
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
  return { sessionId: '', userId: 0, username: principal.username, expiresAt: '' };
}

export function sessionToken(request: FastifyRequest): string {
  return request.cookies[SESSION_COOKIE] ?? '';
}

/**
 * 当前 cookie 会话的 `sessions.id`（= sha256(token)）；Bearer 通道没有会话 → `null`。
 * 改密码（FR-67）用它"保留当前会话、吊销其它会话"。
 */
export function currentSessionId(request: FastifyRequest): string | null {
  const principal = currentPrincipal(request);
  return principal.kind === 'session' ? (principal.sessionId ?? null) : null;
}
