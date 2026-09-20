import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import {
  attemptLogin,
  changePassword,
  createSession,
  deleteSession,
  pruneExpiredSessions,
  SESSION_COOKIE,
} from '../../services/auth.js';
import { currentPrincipal, currentSession, currentSessionId, sessionToken } from '../auth.js';

/**
 * 粗粒度请求限流（防"用登录接口烧 argon2 的 CPU"的洪泛）：
 * 每 IP 60 秒 30 次。**不是** BRIEF §6.3 的失败阈值策略（那个见 services/auth.ts 的 attemptLogin）。
 * 上限写成常量而不加新环境变量：BRIEF §6.3 的环境变量表是固定契约，不外扩。
 */
const LOGIN_FLOOD_MAX = 30;
const LOGIN_FLOOD_WINDOW_MS = 60_000;

const loginBodySchema = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

/** FR-67：`POST /api/password` 的入参（snake_case，与现网一致）。 */
const passwordBodySchema = {
  type: 'object',
  required: ['old_password', 'new_password'],
  additionalProperties: false,
  properties: {
    old_password: { type: 'string', minLength: 1, maxLength: 1024 },
    new_password: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post(
    '/api/login',
    {
      config: {
        rateLimit: {
          max: LOGIN_FLOOD_MAX,
          timeWindow: LOGIN_FLOOD_WINDOW_MS,
          errorResponseBuilder: () => ({ error: 'rate_limited' }),
        },
      },
      schema: { body: loginBodySchema },
    },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };

      const outcome = await attemptLogin(app.qe, {
        username,
        password,
        remoteAddr: request.ip,
        maxFailures: config.loginMaxFailures,
        windowSeconds: config.loginWindowSeconds,
      });

      if (outcome.status === 'rate_limited') {
        return reply
          .header('retry-after', String(outcome.retryAfterSeconds))
          .code(429)
          .send({ error: 'rate_limited' });
      }
      if (outcome.status === 'invalid_credentials') {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      await pruneExpiredSessions(app.qe);
      const { token, expiresAt } = await createSession(app.qe, outcome.userId, config.sessionTtlHours);
      return reply
        .setCookie(SESSION_COOKIE, token, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          expires: new Date(expiresAt),
          // D-18 / AC-28：公网（HTTPS 反代）形态才加 Secure；内网 HTTP 形态不得加，否则登不上
          ...(config.publicOrigin === undefined ? {} : { secure: true }),
        })
        .code(200)
        .send({ ok: true, username: outcome.username });
    },
  );

  app.post('/api/logout', async (request, reply) => {
    // 登出只对 cookie 会话有意义：Bearer 请求没有可清的会话 → 401（闸门已保证认证过）
    currentSession(request);
    await deleteSession(app.qe, sessionToken(request));
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).code(204).send();
  });

  /**
   * 界面改口令（FR-67）。**当前密码错误用 400 而不是 401**：前端把 401 当"会话失效"会把用户踢回登录页。
   * 响应体一律只有 `error`（+ 规则说明），**不回显任何密码**；服务日志也不记录 body（见下方 logger 说明）。
   */
  app.post('/api/password', { schema: { body: passwordBodySchema } }, async (request, reply) => {
    const { old_password: oldPassword, new_password: newPassword } = request.body as {
      old_password: string;
      new_password: string;
    };
    const principal = currentPrincipal(request);

    const outcome = await changePassword(app.qe, {
      username: principal.username,
      oldPassword,
      newPassword,
      remoteAddr: request.ip,
      maxFailures: config.loginMaxFailures,
      windowSeconds: config.loginWindowSeconds,
      keepSessionId: currentSessionId(request),
    });

    switch (outcome.status) {
      case 'rate_limited':
        return reply
          .header('retry-after', String(outcome.retryAfterSeconds))
          .code(429)
          .send({ error: 'rate_limited' });
      case 'invalid_old_password':
        return reply.code(400).send({ error: 'invalid_old_password' });
      case 'invalid_password':
        return reply.code(400).send({ error: 'invalid_password', message: outcome.message });
      default:
        return reply.code(204).send();
    }
  });

  app.get('/api/me', async (request) => ({ username: currentPrincipal(request).username }));
}
