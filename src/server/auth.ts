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
 *   3. 不属于资源 ⇒ **仅会话**（任何令牌都不可）：`/api/tokens*`、`/api/sync*`、`/api/password`、`/api/logout`。
 */

/** 类别 ③：令牌**一律不可**（与 scope 无关），必须 cookie 会话。 */
const SESSION_ONLY_PREFIXES = ['/api/tokens', '/api/sync'];
const SESSION_ONLY_PATHS = new Set<string>(['/api/password', '/api/logout']);

/** 类别 ①：资源读的路径前缀（方法为 GET 时）。`/api/me` 只是报身份，也算读。 */
const RESOURCE_READ_PREFIXES = ['/api/prompts', '/api/folders', '/api/tags', '/api/export', '/api/usage'];
const RESOURCE_READ_EXTRA_PATHS = new Set<string>(['/api/me']);

/**
 * 类别 ①：**归"读"的 POST**（只渲染/只记使用，**不改资源**）。
 * - `/render`（渲染取用）、`/render/markdown`（Markdown 渲染）；
 * - **`/copy`（FR-115）**：只"记一次复制"、不返回正文也不改资源 ⇒ 与渲染类同档，
 *   这样**只读令牌**经 HTTP/MCP 也能记复制（口径与 render 一致）。
 */
const RESOURCE_READ_POST = [
  // 运行时看到的是真实数字 id；机械检查（FR-149）看到的是路由**模式**里的 `:id` ⇒ 两者都要认，
  // 否则 `POST /api/prompts/:id/render` 会被误判成资源写。
  /^\/api\/prompts\/(?:\d+|:id)\/render$/,
  /^\/api\/render\/markdown$/,
  /^\/api\/prompts\/(?:\d+|:id)\/copy$/,
];

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

/**
 * 类别 ②：资源写（**仅 write** 令牌）。这张表只服务于"每个 `/api/*` 路由都必须被显式声明"
 * 的机械检查（FR-149 / AC-132 C）；**运行时**判定仍走 `classifyApiRequest` 的 fail-closed 兜底，
 * 所以鉴权行为与阶段 42 逐字一致。
 */
const RESOURCE_WRITE_PREFIXES = ['/api/prompts', '/api/folders', '/api/tags', '/api/import', '/api/export'];

function isResourceWrite(path: string): boolean {
  return RESOURCE_WRITE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 一个 `/api/*` 请求所属的鉴权类别（FR-149：分类集中在这里，闸门与机械检查共用）。 */
export type AuthCategory = 'public' | 'session_only' | 'resource_read' | 'resource_write';

/**
 * **唯一的分类入口**（FR-149 / AC-132 C10）：认证闸门的 `onRequest` 与
 * 「有路由无法分类即失败」的机械检查都调它，避免"路由注册"与"权限分类"两处各记一份。
 *
 * 兜底是 **fail-closed 的 `resource_write`**：不在公开/仅会话/资源读白名单里的 `/api/*`
 * 一律按"需要 write 令牌"处理 —— 与阶段 42 的行为逐字相同。
 */
export function classifyApiRequest(method: string, path: string): AuthCategory {
  if (PUBLIC_API_PATHS.has(path)) return 'public';
  if (isSessionOnly(path)) return 'session_only';
  if (isResourceRead(method, path)) return 'resource_read';
  return 'resource_write';
}

/**
 * **显式声明**查询（FR-149）：只有被上面四张表之一明确覆盖的路由才算"已分类"。
 * 与 `classifyApiRequest` 的区别：后者对未知路由也回一个类别（兜底），这里回 `null` ——
 * 机械检查据此判定"新加的端点忘了声明类别"。
 * ⚠️ 边界：`SESSION_ONLY_PREFIXES` / `RESOURCE_READ_PREFIXES` / `RESOURCE_WRITE_PREFIXES` 是**前缀**表，
 * 因此已声明命名空间下的新子路径（如 `GET /api/prompts/admin-dump`）会被该命名空间覆盖、不报错；
 * 机械检查真正拦的是**没被任何表覆盖的新命名空间**（如 `/api/reports`、`/api/v2/prompts`）。
 * 这与 AC-132 C10「有路由无法分类即失败」一致，且比改动前的纯前缀判定更严（改前连新命名空间都不拦）。
 */
export function declaredCategory(method: string, path: string): AuthCategory | null {
  if (PUBLIC_API_PATHS.has(path)) return 'public';
  if (isSessionOnly(path)) return 'session_only';
  if (isResourceRead(method, path)) return 'resource_read';
  if (isResourceWrite(path)) return 'resource_write';
  return null;
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
/** 启动时收集到的 `/api/*` 路由（供 `authRouteCoverage` 与机械检查使用）。 */
export interface ApiRoute {
  method: string;
  url: string;
}

const COLLECTED_ROUTES = new WeakMap<FastifyInstance, ApiRoute[]>();

/**
 * 本次启动注册表里每个 `/api/*` 路由的分类结果（测试用；`category === null` = 没被任何声明覆盖）。
 * 见 `registerAuthGate` 的 `onRoute` 收集与 `onReady` 断言（FR-149 / AC-132 C10/C11）。
 */
export function authRouteCoverage(app: FastifyInstance): Array<ApiRoute & { category: AuthCategory | null }> {
  return (COLLECTED_ROUTES.get(app) ?? []).map((route) => ({
    ...route,
    category: declaredCategory(route.method, route.url),
  }));
}

/**
 * 全局认证闸门：除放行清单外，所有 /api/* 未认证一律 401 {"error":"unauthorized"}。
 * 两条通道并存（D-13）：`Authorization: Bearer <token>` 优先，其次 `pm_sid` cookie 会话。
 * onRequest 在路由解析之前执行，因此**未实现的 /api/* 端点**对未认证请求同样 401（AC-3）。
 *
 * FR-149：分类只在 `classifyApiRequest` 一处，且本函数在注册期收集所有 `/api/*` 路由、
 * 在 `onReady` 时断言"每个路由都被某张声明表覆盖" —— 新加一个没声明类别的端点，
 * 服务**起不来**（而不是悄悄落进兜底）。这与路由注册同源，不需要两处人肉同步。
 */
export function registerAuthGate(app: FastifyInstance): void {
  const routes: ApiRoute[] = [];
  COLLECTED_ROUTES.set(app, routes);
  app.addHook('onRoute', (route) => {
    if (typeof route.url !== 'string' || !route.url.startsWith('/api/')) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      // Fastify 会给 GET 自动补一个 HEAD ⇒ 只登记显式声明过的那个动词，避免噪声
      if (method === 'HEAD') continue;
      routes.push({ method, url: route.url });
    }
  });
  app.addHook('onReady', () => {
    const missing = routes.filter((route) => declaredCategory(route.method, route.url) === null);
    if (missing.length > 0) {
      throw new Error(
        `认证分类缺失（FR-149 / AC-132 C10）：${missing.map((route) => `${route.method} ${route.url}`).join('、')}` +
          ' —— 新端点必须显式落进 src/server/auth.ts 的四张声明表之一' +
          '（PUBLIC_API_PATHS / SESSION_ONLY_* / RESOURCE_READ_* / RESOURCE_WRITE_PREFIXES），不许依赖 fail-closed 兜底。',
      );
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    const category = classifyApiRequest(request.method, path);
    if (category === 'public') return;

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
      if (category === 'session_only') {
        await reply.code(403).send({
          error: 'session_required',
          message: '令牌管理与账号操作只允许浏览器会话（cookie）；请用界面操作，不要用 API 令牌。',
        });
        return;
      }
      if (category === 'resource_write' && token.scope !== 'write') {
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
