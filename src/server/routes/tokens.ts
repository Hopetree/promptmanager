import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import {
  createToken,
  deleteTokenPermanently,
  listTokens,
  revealToken,
  revokeToken,
  setTokenScope,
  type TokenScope,
} from '../../services/tokens.js';
import { TokenEncKeyUnavailableError, loadTokenCipher, type TokenCipher } from '../../services/token-crypto.js';
import { parsePositiveId } from '../params.js';

const createTokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    /** FR-103：权限两档；**不传 = read**（最小权限）。 */
    scope: { type: 'string', enum: ['read', 'write'] },
  },
} as const;

/**
 * FR-105：改权限**只收 `scope`**。
 * `additionalProperties: false` ⇒ 传 `name` 或任何别的字段一律 400（本接口不做改名）；
 * `required: ['scope']` ⇒ 空 body `{}` 也是 400（不做"不改任何东西"的空操作）。
 */
const setScopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scope'],
  properties: {
    scope: { type: 'string', enum: ['read', 'write'] },
  },
} as const;

/**
 * FR-15 的 HTTP 面（§6.1 未列路径，本阶段按 REST 约定定并在 docs/api.md 记录）：
 * FR-103：**本文件的全部端点一律"仅会话"**（令牌不可调，闸门在 `registerAuthGate` 里按 `/api/tokens*` 前缀拦成
 * 403 `session_required`）—— 令牌能枚举/新建令牌就等于"能自我繁殖"，一处泄漏会变成永久全权。
 *
 * - `GET /api/tokens`    列表（**不含明文**；FR-94 起每项多 `revealable`；FR-103 起多 `scope`）
 * - `POST /api/tokens`   创建 → 201，明文在这一个响应里返回；FR-94 起**同时加密落库**以便日后查看
 * - `PATCH /api/tokens/:id` **改权限**（FR-105）→ 200 返回该行摘要；**只收 `scope`**（多传字段 → 400）；
 *   有效令牌**立即生效**；已撤销 → 409 `token_revoked`；不存在 → 404
 * - `POST /api/tokens/:id/reveal` 查看明文（FR-94）→ 200 `{token}`；**只允许 cookie 会话**；存量行 → 409
 * - `DELETE /api/tokens/:id` 撤销 → 204（立即失效；重复撤销幂等，不存在 → 404）
 * - `DELETE /api/tokens/:id/permanent` **硬删除**（FR-96）→ 204；**只允许已撤销的行**（未撤销 → 409
 *   `token_not_revoked`，不存在 → 404）；**真删行、审计记录一并消失**（与"撤销留痕"语义不同）
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
    const { name, scope } = request.body as { name: string; scope?: string };
    // FR-103：scope 省略 ⇒ 服务层缺省 read；显式非法值由 schema（enum）挡成 400
    const { token, summary } = await createToken(app.qe, name, cipherOrUndefined(), scope);
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

  /**
   * FR-105：**改权限**（只读 ↔ 读写）。
   *
   * ⚠️ **防自我提权**：本端点属于"令牌管理" ⇒ 闸门已把 `/api/tokens*` 归为**仅会话**，
   * **任何令牌（包括它自己）**调进来都是 `403 session_required`（在到达这里之前就被拦下）。
   * 若允许只读令牌改自己的 scope，它就能把自己变成读写 ⇒ 阶段 42 的边界会被整体绕过。
   * 因此本处理器**不写任何令牌判定**（不要在这里补一套更弱的），只用 `app.qe` 改库。
   */
  app.patch('/api/tokens/:id', { schema: { body: setScopeSchema } }, async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    const { scope } = request.body as { scope: TokenScope };
    const { summary, previousScope } = await setTokenScope(app.qe, id, scope);
    // AC-107 ⑨：只记 id 与两档权限，**不含明文、不含 token_hash / token_enc**
    request.log.info({ tokenId: id, from: previousScope, to: summary.scope }, 'token scope changed');
    return reply.code(200).send(summary);
  });

  app.delete('/api/tokens/:id', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await revokeToken(app.qe, id);
    return reply.code(204).send();
  });

  /** FR-96：硬删除（只允许已撤销）。未撤销 → 409；不存在 → 404。 */
  app.delete('/api/tokens/:id/permanent', async (request, reply) => {
    const id = parsePositiveId((request.params as { id?: string }).id);
    await deleteTokenPermanently(app.qe, id);
    return reply.code(204).send();
  });
}
