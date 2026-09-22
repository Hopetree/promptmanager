import { createHash, randomBytes } from 'node:crypto';
import type { QueryEngine } from '../db/index.js';
import { ConflictError, InvalidBodyError, NotFoundError } from '../errors.js';
import { nowIso } from './auth.js';
import { TokenEncKeyUnavailableError, type TokenCipher } from './token-crypto.js';

/** 明文 token 前缀（AC-22 期望"形如 pm_… 的一行明文"）。 */
export const TOKEN_PREFIX = 'pm_';

/**
 * FR-103：令牌权限**只作用于资源**（prompts / folders / tags / 导入导出 / 取用记录）：
 * - `read`：检索、查看、渲染（**渲染类 POST 也算读**，否则 MCP 的 `prompt_render` 会被误伤）；
 * - `write`：在 read 之上还能新建 / 修改 / 删除 / 排序 / 回滚 / 导入。
 * **令牌管理（列表 / 新建 / 撤销 / 硬删 / reveal）与改口令、登出一律"仅会话"** —— 与 scope 无关，任何令牌都不可。
 */
export type TokenScope = 'read' | 'write';

/** 新建令牌的**缺省权限 = read**（最小权限；FR-103）。 */
export const DEFAULT_TOKEN_SCOPE: TokenScope = 'read';

/**
 * 把库里/入参的 scope 规范化：
 * - 合法值原样返回；
 * - **NULL / 未知值一律视作 `'write'`** —— 与 `005_token-scope.sql` 对存量行的回填口径一致，
 *   避免历史数据（或手工插入的行）被静默降权成只读而突然 403。
 *   ⚠️ 新建路径**不会**走到这个兜底：`createToken` 显式写入 `'read'` 或 `'write'`。
 */
export function normalizeScope(raw: unknown): TokenScope {
  return raw === 'read' || raw === 'write' ? raw : 'write';
}

/** 校验"用户显式给的 scope"（HTTP body / CLI 参数）：非法值返回 null，由调用方给 400 / 用法错误。 */
export function parseScope(raw: unknown): TokenScope | null {
  return raw === 'read' || raw === 'write' ? raw : null;
}

/** 契约里的 token 摘要（**绝不含明文**，也不含 token_hash / token_enc）。 */
export interface TokenSummary {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  /** FR-103：`read`（只读，缺省）或 `write`（读写）。 */
  scope: TokenScope;
  /**
   * FR-94：这条 token 的明文**是否可以再查看**（= 库里存了密文）。
   * 存量 token（迁移前创建）为 `false` —— 原明文从未落库，不可恢复，只能撤销后重建。
   */
  revealable: boolean;
}

function toSummary(row: {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  token_enc: string | null;
  scope: string | null;
}): TokenSummary {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    revealable: row.token_enc !== null,
    scope: normalizeScope(row.scope),
  };
}

export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** 库里只存这个（sha256 hex，64 字符；BRIEF D-13）。 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * 创建 token：明文出现在返回值里（创建响应），**并且**（FR-94）加密后落 `token_enc` 以便日后随时查看。
 *
 * `cipher` 可选：密钥不可用时**不阻断创建**（退化为"这条不可查看"，与存量 token 同态），
 * 只在服务端记一条**不含明文**的告警。
 */
export async function createToken(
  qe: QueryEngine,
  rawName: string | undefined,
  cipher?: TokenCipher,
  rawScope?: unknown,
): Promise<{ token: string; summary: TokenSummary }> {
  const name = (rawName ?? '').trim();
  if (name === '') throw new InvalidBodyError([{ path: 'name', message: 'token 名不能为空' }]);
  if ([...name].length > 100) throw new InvalidBodyError([{ path: 'name', message: 'token 名不能超过 100 字符' }]);
  // FR-103：不传 scope ⇒ 缺省 `read`（最小权限）；显式传非法值 ⇒ 400（不静默降级）
  const scope = rawScope === undefined ? DEFAULT_TOKEN_SCOPE : parseScope(rawScope);
  if (scope === null) {
    throw new InvalidBodyError([{ path: 'scope', message: "scope 只能是 'read' 或 'write'" }]);
  }

  const token = generateToken();
  let tokenEnc: string | null = null;
  if (cipher !== undefined) {
    try {
      tokenEnc = cipher.encrypt(token);
    } catch (error) {
      // 不打印明文/密钥；只说明"这条以后看不了"
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`warn: token 加密不可用，这条 token 之后无法查看（鉴权不受影响）：${reason}\n`);
      tokenEnc = null;
    }
  }

  const inserted = await qe
    .insertInto('api_tokens')
    .values({
      name,
      token_hash: hashToken(token),
      token_enc: tokenEnc,
      scope,
      created_at: nowIso(),
      last_used_at: null,
      revoked_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { token, summary: toSummary(inserted) };
}

/** 列表：按 id 升序；只给摘要（无明文、无 hash、无密文，只有 `revealable` 布尔）。 */
export async function listTokens(qe: QueryEngine): Promise<TokenSummary[]> {
  const rows = await qe.selectFrom('api_tokens').selectAll().orderBy('id', 'asc').execute();
  return rows.map(toSummary);
}

/** 撤销：置 revoked_at（保留行便于审计）；不存在 → 404；重复撤销是幂等的。 */
export async function revokeToken(qe: QueryEngine, id: number): Promise<void> {
  const row = await qe.selectFrom('api_tokens').select(['id', 'revoked_at']).where('id', '=', id).executeTakeFirst();
  if (row === undefined) throw new NotFoundError();
  if (row.revoked_at !== null) return;
  await qe.updateTable('api_tokens').set({ revoked_at: nowIso() }).where('id', '=', id).execute();
}

/**
 * FR-96：**硬删除**（真删行，审计记录一并消失）—— 只允许**已撤销**的行。
 *
 * 为什么要求"先撤销"：撤销是"立即失效但留痕"，删除是"连痕都不留"。
 * 若允许直接删有效凭据，一次误点就会**无声地**让一个正在被 CLI/agent 使用的 token 消失；
 * 强制两步（撤销 → 删除）让"失效"与"抹除"各占一次明确操作。
 *
 * - 不存在 → `NotFoundError`（404）；
 * - 仍有效（`revoked_at IS NULL`）→ `ConflictError('token_not_revoked')`（409）。
 */
export async function deleteTokenPermanently(qe: QueryEngine, id: number): Promise<void> {
  const row = await qe
    .selectFrom('api_tokens')
    .select(['id', 'revoked_at'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined) throw new NotFoundError();
  if (row.revoked_at === null) throw new ConflictError('token_not_revoked');
  await qe.deleteFrom('api_tokens').where('id', '=', id).execute();
}

/**
 * Bearer 校验：命中且未撤销 → 记录 last_used_at 并返回摘要；否则 null。
 * 撤销后**立即失效**（每次请求都查库，不做缓存）。
 */
export async function resolveApiToken(
  qe: QueryEngine,
  plaintext: string,
): Promise<{ id: number; name: string; scope: TokenScope } | null> {
  if (plaintext === '') return null;
  const row = await qe
    .selectFrom('api_tokens')
    .select(['id', 'name', 'revoked_at', 'scope'])
    .where('token_hash', '=', hashToken(plaintext))
    .executeTakeFirst();
  if (row === undefined || row.revoked_at !== null) return null;

  await qe.updateTable('api_tokens').set({ last_used_at: nowIso() }).where('id', '=', row.id).execute();
  return { id: row.id, name: row.name, scope: normalizeScope(row.scope) };
}

/**
 * FR-94：**查看 token 明文**（`POST /api/tokens/:id/reveal` 与 CLI `token reveal` 共用）。
 *
 * - 不存在 → `NotFoundError`（404）；
 * - 存量行（`token_enc IS NULL`）→ `ConflictError('token_not_revealable')`（409）——**它的鉴权照样可用**；
 * - 密钥不可用/不匹配 → `TokenEncKeyUnavailableError`（上层映射成明确错误，不崩不泄）。
 *
 * ⚠️ 明文只在返回值里出现，**绝不进日志**（调用方只允许记"某 id 被查看"）。
 */
export async function revealToken(qe: QueryEngine, id: number, cipher: TokenCipher): Promise<string> {
  const row = await qe
    .selectFrom('api_tokens')
    .select(['id', 'token_enc'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (row === undefined) throw new NotFoundError();
  if (row.token_enc === null) throw new ConflictError('token_not_revealable');
  return cipher.decrypt(row.token_enc);
}

export { TokenEncKeyUnavailableError };
