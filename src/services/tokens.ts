import { createHash, randomBytes } from 'node:crypto';
import type { QueryEngine } from '../db/index.js';
import { InvalidBodyError, NotFoundError } from '../errors.js';
import { nowIso } from './auth.js';

/** 明文 token 前缀（AC-22 期望"形如 pm_… 的一行明文"）。 */
export const TOKEN_PREFIX = 'pm_';

/** 契约里的 token 摘要（**绝不含明文**，也不含 token_hash）。 */
export interface TokenSummary {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toSummary(row: {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}): TokenSummary {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
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
 * 创建 token：**明文只在这一个返回值里出现一次**，此后任何接口/日志都不再回显。
 */
export async function createToken(
  qe: QueryEngine,
  rawName: string | undefined,
): Promise<{ token: string; summary: TokenSummary }> {
  const name = (rawName ?? '').trim();
  if (name === '') throw new InvalidBodyError([{ path: 'name', message: 'token 名不能为空' }]);
  if ([...name].length > 100) throw new InvalidBodyError([{ path: 'name', message: 'token 名不能超过 100 字符' }]);

  const token = generateToken();
  const inserted = await qe
    .insertInto('api_tokens')
    .values({
      name,
      token_hash: hashToken(token),
      created_at: nowIso(),
      last_used_at: null,
      revoked_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { token, summary: toSummary(inserted) };
}

/** 列表：按 id 升序；只给摘要（无明文、无 hash）。 */
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
 * Bearer 校验：命中且未撤销 → 记录 last_used_at 并返回摘要；否则 null。
 * 撤销后**立即失效**（每次请求都查库，不做缓存）。
 */
export async function resolveApiToken(
  qe: QueryEngine,
  plaintext: string,
): Promise<{ id: number; name: string } | null> {
  if (plaintext === '') return null;
  const row = await qe
    .selectFrom('api_tokens')
    .select(['id', 'name', 'revoked_at'])
    .where('token_hash', '=', hashToken(plaintext))
    .executeTakeFirst();
  if (row === undefined || row.revoked_at !== null) return null;

  await qe.updateTable('api_tokens').set({ last_used_at: nowIso() }).where('id', '=', row.id).execute();
  return { id: row.id, name: row.name };
}
