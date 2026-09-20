import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, resolveSession, type SessionUser } from '../services/auth.js';
import { resolveApiToken } from '../services/tokens.js';

/** 使用记录里的"通道"取值（BRIEF FR-19 固定）。 */
export type AuthChannel = 'session' | 'token' | 'mcp';

/** 已认证主体：cookie 会话（浏览器）或 Bearer token（外部客户端/MCP）。 */
export interface Principal {
  kind: 'session' | 'token';
  username: string;
  channel: AuthChannel;
  /** 仅 token 通道有 */
  tokenId?: number;
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

export async function registerCookieSupport(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
}

/** `Authorization: Bearer <token>` → 明文；不是 Bearer 形态则返回 null。 */
function bearerPlaintext(request: FastifyRequest): string | null {
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
      request.principal = {
        kind: 'token',
        username: owner?.username ?? 'admin',
        channel: bearerChannel(request),
        tokenId: token.id,
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
