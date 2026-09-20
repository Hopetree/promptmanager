import type { FastifyInstance } from 'fastify';
import { buildExport } from '../../services/export.js';
import { importData } from '../../services/import.js';

/**
 * body 形状在这里只做"必须是对象"的最弱校验，字段级校验全部交给 services/import.ts —— 
 * 这样该端点的 400 一律是契约要求的 `invalid_import`（而不是框架的 `invalid_body`）。
 */
const importBodySchema = {
  type: 'object',
  additionalProperties: true,
} as const;

/** 导入是"备份恢复"，可能一次塞进整库：单请求体上限放宽到 32MB（Fastify 默认 1MB）。 */
const IMPORT_BODY_LIMIT = 32 * 1024 * 1024;

/** FR-10：全量导出 / 导入（两种模式 + 校验 + 原子性）。 */
export function registerExportRoutes(app: FastifyInstance): void {
  app.get('/api/export', async () => buildExport(app.qe));

  app.post(
    '/api/import',
    { bodyLimit: IMPORT_BODY_LIMIT, schema: { body: importBodySchema } },
    async (request) => {
      const body = request.body as { mode?: unknown; data?: unknown };
      return importData(app.qe, body.mode, body.data);
    },
  );
}
