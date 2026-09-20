import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';

/** GET /healthz —— 健康检查，无需认证（BRIEF §6.1）。 */
export function registerHealthRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get('/healthz', async () => ({ status: 'ok', version: config.version }));
}
