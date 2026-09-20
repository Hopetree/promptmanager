import type { FastifyInstance } from 'fastify';
import { createToken, listTokens, revokeToken } from '../../services/tokens.js';
import { parsePositiveId } from '../params.js';

const createTokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

/**
 * FR-15 的 HTTP 面（§6.1 未列路径，本阶段按 REST 约定定并在 README 记录）：
 * - `GET /api/tokens`    列表（**不含明文**）
 * - `POST /api/tokens`   创建 → 201，**明文只在这一个响应里返回一次**
 * - `DELETE /api/tokens/:id` 撤销 → 204（立即失效；重复撤销幂等，不存在 → 404）
 * 认证沿用闸门：cookie 会话或既有 Bearer token 都可以（单用户，不做 scope 分层）。
 */
export function registerTokenRoutes(app: FastifyInstance): void {
  app.get('/api/tokens', async () => ({ items: await listTokens(app.qe) }));

  app.post('/api/tokens', { schema: { body: createTokenSchema } }, async (request, reply) => {
    const { name } = request.body as { name: string };
    const { token, summary } = await createToken(app.qe, name);
    return reply.code(201).send({ ...summary, token });
  });

  app.delete('/api/tokens/:id', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await revokeToken(app.qe, id);
    return reply.code(204).send();
  });
}
