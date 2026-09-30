import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { prepareDatabase, type Db, type QueryEngine } from '../db/index.js';
import { ConflictError, InvalidBodyError, InvalidImportError, NotFoundError, SyncError } from '../errors.js';
import { registerMcpHttpRoutes } from '../mcp/http.js';
import { registerAuthGate, registerCookieSupport } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerExportRoutes } from './routes/export.js';
import { registerFolderRoutes } from './routes/folders.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerRenderRoutes } from './routes/render.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerTokenRoutes } from './routes/tokens.js';
import { registerUsageRoutes } from './routes/usage.js';
import { registerTagRoutes } from './routes/tags.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 原始 SQLite 连接（迁移、测试用） */
    db: Db;
    /** 类型安全查询入口（业务代码用） */
    qe: QueryEngine;
  }
}

/** node:test 子进程会设置该变量；测试里关掉请求日志，保持输出可读。 */
function isTestRun(): boolean {
  return process.env['NODE_TEST_ENV'] !== undefined || process.env['NODE_TEST_CONTEXT'] !== undefined;
}

/**
 * 组装应用：打开库 → 迁移到最新 schema → 认证闸门 → 路由 → 静态托管前端产物（FR-12 单端口）。
 * 不在此处 listen（由 index.ts / 测试各自决定端口）。
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const { db, qe } = prepareDatabase(config);

  const app = Fastify({
    logger: isTestRun() ? false : { level: 'info' },
    trustProxy: config.trustProxy, // D-18：默认 false；只有确有反代时才开（否则 XFF 可伪造）
    // ajv 不做任何"静默改写"：
    // - coerceTypes: false —— 否则 `title: 42` 会被悄悄转成 "42"、`tags: "x"` 会被转成 ["x"]；
    // - removeAdditional: false —— 否则 `additionalProperties: false` 会变成"悄悄丢掉未知字段"而不是 400。
    // 两者都与契约"非法 body → 400 invalid_body"的意图相悖。查询串的整数由路由自行解析（见 routes/prompts.ts）。
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  app.decorate('db', db);
  app.decorate('qe', qe);
  app.addHook('onClose', async () => {
    await qe.destroy(); // kysely 的 destroy 会关闭底层 better-sqlite3 连接
  });

  // 契约里的错误形状：400 invalid_body（含 details）/ 404 not_found / 500 internal_error
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation !== undefined && error.validation.length > 0) {
      return reply.code(400).send({
        error: 'invalid_body',
        details: error.validation.map((issue: { instancePath?: string; message?: string }) => ({
          path: issue.instancePath === undefined || issue.instancePath === '' ? 'body' : issue.instancePath,
          message: issue.message ?? 'invalid',
        })),
      });
    }
    if (error instanceof InvalidBodyError) {
      return reply.code(400).send({ error: 'invalid_body', details: error.details });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (error instanceof ConflictError) {
      // FR-105：只有带了 detail 的 409 才多一个 message（其余 409 的响应体逐字不变）
      const conflict = error as ConflictError;
      return reply
        .code(409)
        .send(conflict.detail === undefined ? { error: conflict.code } : { error: conflict.code, message: conflict.detail });
    }
    if (error instanceof InvalidImportError) {
      return reply.code(400).send({ error: 'invalid_import', details: error.details });
    }
    if (error instanceof SyncError) {
      // FR-125 ④.7：同步错误的提示已经是「中文 + 可执行」，原样回给前端（不套 invalid_body）。
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: 'internal_error' });
    }
    if (status === 400) {
      return reply
        .code(400)
        .send({ error: 'invalid_body', details: [{ path: 'body', message: error.message }] });
    }
    if (status === 415) {
      return reply.code(415).send({ error: 'unsupported_media_type' });
    }
    if (status === 429) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    // P2-2：非预期状态码不再一律误标 `unauthorized`（413/405 曾都回 unauthorized，对 API 消费者是误导）。
    if (status === 404) return reply.code(404).send({ error: 'not_found' });
    if (status === 405) return reply.code(405).send({ error: 'method_not_allowed' });
    if (status === 413) return reply.code(413).send({ error: 'payload_too_large' });
    if (status === 401) return reply.code(401).send({ error: 'unauthorized' });
    return reply.code(status).send({ error: 'request_error' });
  });

  // ── P1-1：安全响应头 ─────────────────────────────────────────────────────────
  // 不引 helmet：项目规矩是「依赖只减不增」，这里需要的 4~5 个头用 onSend 钩子几行就够。
  // CSP 的取值是按本应用的实际情况定的，改动前请先读注释：
  //   · `style-src` 必须留 'unsafe-inline' —— antd 是 CSS-in-JS，运行时往 <head> 注入 <style>；
  //   · `script-src` 只给 'self' —— 构建产物是外链 module（dist/web/index.html 里无内联脚本），
  //     Markdown 预览走的 dangerouslySetInnerHTML 已由服务端 DOMPurify 净化，这层是兜底；
  //   · `connect-src` 只给 'self' —— 前端所有请求都打同源 API（跨域是别人调我们，不是我们调别人）；
  //   · `img-src` 留 data:/blob: —— antd 图标与可能的本地预览用得上。
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  // HSTS 只在确认对外是 HTTPS 时下发（内网 HTTP 加了会让浏览器把 http 也强制跳 https）。
  const hsts = config.publicOrigin !== undefined && config.publicOrigin.startsWith('https://');

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('content-security-policy', csp);
    if (hsts) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    return payload;
  });

  await registerCookieSupport(app);

  // FR-17：CORS 默认关闭；只有 CORS_ORIGINS 非空时才注册（精确白名单、禁 *、不用 credentials）。
  // 必须在认证闸门**之前**注册：预检请求不带 Authorization，得由 CORS 插件先答。
  if (config.corsOrigins.length > 0) {
    const allowed = new Set(config.corsOrigins);
    await app.register(cors, {
      origin: (origin, callback) => callback(null, origin === undefined || allowed.has(origin)),
      credentials: false,
      // FR-70 起新增 PATCH（/api/prompts/order、/api/folders/order）；仍不使用 credentials
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
    app.log.info(`CORS 白名单已启用：${config.corsOrigins.join(', ')}`);
  }

  await app.register(rateLimit, { global: false }); // 只有显式声明 config.rateLimit 的路由才限流
  registerAuthGate(app);

  registerHealthRoutes(app, config);
  registerAuthRoutes(app, config);
  registerPromptRoutes(app);
  registerFolderRoutes(app);
  registerTagRoutes(app);
  registerRenderRoutes(app);
  registerExportRoutes(app);
  registerSyncRoutes(app, config); // FR-125：远程数据同步（仅会话可用，不做自动上传）
  registerTokenRoutes(app, config);
  registerUsageRoutes(app);
  // FR-93：MCP 的 Streamable HTTP 传输（顶层 `/mcp`，自己做 Bearer 鉴权；不经过 /api/* 闸门）
  registerMcpHttpRoutes(app);

  const indexHtml = path.join(config.webRoot, 'index.html');
  const hasWeb = existsSync(indexHtml);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webRoot,
      index: ['index.html'],
      wildcard: false,
    });
  }

  // 非 /api 路径一律回落到前端入口；/api 未命中就是 404 JSON（未认证的情形已被闸门拦成 401）。
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (hasWeb && request.method === 'GET') {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
