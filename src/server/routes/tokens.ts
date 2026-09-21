import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import { createToken, listTokens, revealToken, revokeToken } from '../../services/tokens.js';
import { TokenEncKeyUnavailableError, loadTokenCipher, type TokenCipher } from '../../services/token-crypto.js';
import { parsePositiveId } from '../params.js';

const createTokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

/**
 * FR-15 的 HTTP 面（§6.1 未列路径，本阶段按 REST 约定定并在 docs/api.md 记录）：
 * - `GET /api/tokens`    列表（**不含明文**；FR-94 起每项多一个 `revealable: boolean`）
 * - `POST /api/tokens`   创建 → 201，明文在这一个响应里返回；FR-94 起**同时加密落库**以便日后查看
 * - `POST /api/tokens/:id/reveal` 查看明文（FR-94）→ 200 `{token}`；**只允许 cookie 会话**；存量行 → 409
 * - `DELETE /api/tokens/:id` 撤销 → 204（立即失效；重复撤销幂等，不存在 → 404）
 * 认证沿用闸门：cookie 会话或既有 Bearer token 都可以（单用户，不做 scope 分层）——**reveal 除外**（见下）。
 */
export function registerTokenRoutes(app: FastifyInstance, config: AppConfig): void {
  /**
   * 密钥解析**惰性**：密钥缺失/不可写不应该影响启动、列表或创建（只是"看不了"）。
   * 失败时返回 undefined，由各调用点决定怎么降级。
   */
  const cipherOrUndefined = (): TokenCipher | undefined => {
    try {
      return loadTokenCipher(config);
    } catch {
      return undefined;
    }
  };

  app.get('/api/tokens', async () => ({ items: await listTokens(app.qe) }));

  app.post('/api/tokens', { schema: { body: createTokenSchema } }, async (request, reply) => {
    const { name } = request.body as { name: string };
    const { token, summary } = await createToken(app.qe, name, cipherOrUndefined());
    return reply.code(201).send({ ...summary, token });
  });

  /**
   * FR-94 / D-35 ③：**只允许 cookie 会话**（用 Bearer 调 → 403 `session_required`）。
   * 理由：不允许"token 自己看自己/互相看" —— 一把钥匙不应该能复制出另一把钥匙的明文。
   */
  app.post('/api/tokens/:id/reveal', async (request, reply) => {
    const principal = request.principal;
    if (principal === undefined || principal.kind !== 'session') {
      return reply.code(403).send({
        error: 'session_required',
        message: '查看 token 明文只允许浏览器会话（cookie）；不接受 Bearer，避免 token 互相窥视。',
      });
    }

    const id = parsePositiveId((request.params as { id?: string }).id);
    try {
      const token = await revealToken(app.qe, id, loadTokenCipher(config));
      // 只记"被查看"，**不含值**（FR-94 ⑧）
      request.log.info({ tokenId: id }, 'token revealed');
      return { token };
    } catch (error) {
      if (error instanceof TokenEncKeyUnavailableError) {
        // 明确错误：不崩、不泄；鉴权不受影响
        return reply.code(500).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.delete('/api/tokens/:id', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await revokeToken(app.qe, id);
    return reply.code(204).send();
  });
}
