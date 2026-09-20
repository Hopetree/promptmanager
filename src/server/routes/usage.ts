import type { FastifyInstance } from 'fastify';
import { DEFAULT_USAGE_DAYS, usageSummary } from '../../services/usage.js';
import { parseBoundedInt } from '../params.js';

/** 使用记录摘要（FR-19）：`GET /api/usage/summary?days=<N>`，默认 30 天，窗口内 top 最多 20。 */
const usageQuerySchema = {
  type: 'object',
  additionalProperties: true,
  properties: { days: { type: 'string', pattern: '^[0-9]+$' } },
} as const;

export function registerUsageRoutes(app: FastifyInstance): void {
  app.get('/api/usage/summary', { schema: { querystring: usageQuerySchema } }, async (request) => {
    const query = request.query as { days?: string };
    const days = parseBoundedInt(query.days, DEFAULT_USAGE_DAYS, 1, 3650, 'days');
    return usageSummary(app.qe, days);
  });
}
