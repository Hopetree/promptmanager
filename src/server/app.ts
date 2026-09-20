import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { prepareDatabase, type Db, type QueryEngine } from '../db/index.js';
import { ConflictError, InvalidBodyError, InvalidImportError, NotFoundError } from '../errors.js';
import { registerAuthGate, registerCookieSupport } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerExportRoutes } from './routes/export.js';
import { registerFolderRoutes } from './routes/folders.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerRenderRoutes } from './routes/render.js';
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
      return reply.code(409).send({ error: error.code });
    }
    if (error instanceof InvalidImportError) {
      return reply.code(400).send({ error: 'invalid_import', details: error.details });
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
    return reply.code(status).send({ error: status === 404 ? 'not_found' : 'unauthorized' });
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
  registerTokenRoutes(app);
  registerUsageRoutes(app);

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
