import { createHash, randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { QueryEngine } from '../db/index.js';

/** session cookie 名（BRIEF §6.1 固定为 pm_sid）。 */
export const SESSION_COOKIE = 'pm_sid';

/**
 * 口令哈希：@node-rs/argon2 的**默认参数**即 RFC 9106 推荐的 Argon2id
 * （实测输出前缀 `$argon2id$v=19$m=19456,t=2,p=1$`），因此不显式传算法/代价参数
 * （该库的 Algorithm 是 ambient const enum，与 verbatimModuleSyntax 不兼容）。
 */
/**
 * 一个真实 argon2id 哈希（内容是一次性随机串，不可用于登录）。
 * 用途：用户名不存在时也做一次等价耗时的校验，避免用响应时间枚举用户。
 */
const TIMING_EQUALIZER_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$GWKIms+IwOIEa45Pxql1tg$irSkNa/Sk9CYcwx/Q10RYFCLcCaCOHvC3Z9jVFGYKfw';

export function nowIso(): string {
  return new Date().toISOString();
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** cookie 里放原始 token，库里只存 sha256(token) → 库被读走也无法直接冒用会话。 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 建用户或改口令（哈希后入库），并吊销该用户全部既有会话（口令轮换配套）。 */
export async function setUserPassword(qe: QueryEngine, username: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  const now = nowIso();

  await qe.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('users')
      .select('id')
      .where('username', '=', username)
      .executeTakeFirst();

    let userId: number;
    if (existing !== undefined) {
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, updated_at: now })
        .where('id', '=', existing.id)
        .execute();
      userId = existing.id;
    } else {
      const inserted = await trx
        .insertInto('users')
        .values({ username, password_hash: passwordHash, created_at: now, updated_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      userId = inserted.id;
    }

    await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
  });
}

export interface SessionUser {
  sessionId: string;
  userId: number;
  username: string;
  expiresAt: string;
}

export async function createSession(
  qe: QueryEngine,
  userId: number,
  ttlHours: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlHours * 3_600_000).toISOString();
  await qe
    .insertInto('sessions')
    .values({
      id: hashToken(token),
      user_id: userId,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt,
    })
    .execute();
  return { token, expiresAt };
}

/** 校验会话；过期即删除并视为未认证。 */
export async function resolveSession(qe: QueryEngine, token: string): Promise<SessionUser | null> {
  if (token === '') return null;
  const sessionId = hashToken(token);
  const row = await qe
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id',
      'sessions.expires_at as expires_at',
      'users.id as user_id',
      'users.username as username',
    ])
    .where('sessions.id', '=', sessionId)
    .executeTakeFirst();

  if (row === undefined) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await qe.deleteFrom('sessions').where('id', '=', sessionId).execute();
    return null;
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    expiresAt: row.expires_at,
  };
}

export async function deleteSession(qe: QueryEngine, token: string): Promise<void> {
  if (token === '') return;
  await qe.deleteFrom('sessions').where('id', '=', hashToken(token)).execute();
}

export async function pruneExpiredSessions(qe: QueryEngine): Promise<number> {
  const result = await qe.deleteFrom('sessions').where('expires_at', '<=', nowIso()).executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

export type LoginOutcome =
  | { status: 'ok'; userId: number; username: string }
  | { status: 'invalid_credentials' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

/** 新密码规则（FR-67）：**≥8 个 Unicode 码点**、且**不得与当前密码相同**。 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RULE_MESSAGE = `新密码至少 ${String(PASSWORD_MIN_LENGTH)} 个字符（按 Unicode 码点计），且不得与当前密码相同`;

/** 返回 `null` = 合规；否则返回给用户看的原因（前端与服务端共用同一句话）。 */
export function validateNewPassword(newPassword: string, oldPassword: string): string | null {
  if ([...newPassword].length < PASSWORD_MIN_LENGTH) return PASSWORD_RULE_MESSAGE;
  if (newPassword === oldPassword) return '新密码不得与当前密码相同';
  return null;
}

export type ChangePasswordOutcome =
  | { status: 'ok' }
  | { status: 'invalid_old_password' }
  | { status: 'invalid_password'; message: string }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export interface ChangePasswordParams {
  username: string;
  oldPassword: string;
  newPassword: string;
  remoteAddr: string;
  maxFailures: number;
  windowSeconds: number;
  /**
   * 发起修改的**当前会话**（`sessions.id` = sha256(token)）；cookie 通道才有。
   * 成功时保留它、吊销该用户的其它所有会话（FR-67 的会话语义）；
   * Bearer 通道传 `null`（没有可保留的 cookie 会话 → 吊销全部会话，token 本身不受影响）。
   */
  keepSessionId: string | null;
}

/**
 * 界面改口令（FR-67）：与 CLI `user set-password` 的**语义差异**（写在 PROGRESS 里）——
 * - 本函数（HTTP）：**保留当前会话**，只吊销其它会话；
 * - `setUserPassword`（CLI 本地管理动作）：删除该用户**全部**会话（保持原行为不动）。
 *
 * 失败计数**复用登录限流**（`login_attempts` 的 `username + remote_addr` 键，5 次/60s → 429），
 * 只有"当前密码错误"才计数；成功一次即清零。**不记录也不回显任何明文密码。**
 */
export async function changePassword(qe: QueryEngine, params: ChangePasswordParams): Promise<ChangePasswordOutcome> {
  const now = nowIso();
  const windowStart = new Date(Date.now() - params.windowSeconds * 1000).toISOString();

  const failures = await qe
    .selectFrom('login_attempts')
    .select('attempted_at')
    .where('username', '=', params.username)
    .where('remote_addr', '=', params.remoteAddr)
    .where('succeeded', '=', 0)
    .where('attempted_at', '>=', windowStart)
    .execute();

  if (failures.length >= params.maxFailures) {
    const oldest = failures.reduce(
      (min, row) => (row.attempted_at < min ? row.attempted_at : min),
      failures[0]?.attempted_at ?? now,
    );
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(oldest) + params.windowSeconds * 1000 - Date.now()) / 1000),
    );
    return { status: 'rate_limited', retryAfterSeconds };
  }

  const user = await qe
    .selectFrom('users')
    .select(['id', 'password_hash'])
    .where('username', '=', params.username)
    .executeTakeFirst();

  const oldOk = user !== undefined && (await verifyPassword(user.password_hash, params.oldPassword));
  if (!oldOk) {
    await qe
      .insertInto('login_attempts')
      .values({
        username: params.username,
        remote_addr: params.remoteAddr,
        succeeded: 0,
        attempted_at: now,
      })
      .execute();
    return { status: 'invalid_old_password' };
  }

  const problem = validateNewPassword(params.newPassword, params.oldPassword);
  if (problem !== null) return { status: 'invalid_password', message: problem };

  const passwordHash = await hashPassword(params.newPassword);
  await qe.transaction().execute(async (trx) => {
    await trx
      .updateTable('users')
      .set({ password_hash: passwordHash, updated_at: now })
      .where('id', '=', user.id)
      .execute();

    let revoke = trx.deleteFrom('sessions').where('user_id', '=', user.id);
    if (params.keepSessionId !== null) revoke = revoke.where('id', '!=', params.keepSessionId);
    await revoke.execute();

    await trx
      .deleteFrom('login_attempts')
      .where('username', '=', params.username)
      .where('remote_addr', '=', params.remoteAddr)
      .where('succeeded', '=', 0)
      .execute();
  });

  return { status: 'ok' };
}

export interface LoginParams {
  username: string;
  password: string;
  remoteAddr: string;
  maxFailures: number;
  windowSeconds: number;
}

/**
 * 登录失败阈值策略（BRIEF §6.3 + AC-4 的精确时序）：
 * - 窗口内（LOGIN_WINDOW_SECONDS）同一 `username + remote_addr` 的失败次数达到 LOGIN_MAX_FAILURES 后，
 *   后续尝试（含口令正确者）一律 429，附 Retry-After = 最早一次失败滚出窗口的秒数；
 * - 失败计数只增不解，直到窗口过期；登录成功清除该键的失败记录。
 *
 * 说明（见 PROGRESS 阶段 2 §4 决策 1）：@fastify/rate-limit 只能按**请求**计数、无"只计失败"选项，
 * 无法表达本契约；请求级洪泛保护仍由该插件承担（见 server/routes/auth.ts）。
 */
export async function attemptLogin(qe: QueryEngine, params: LoginParams): Promise<LoginOutcome> {
  const now = nowIso();
  const windowStart = new Date(Date.now() - params.windowSeconds * 1000).toISOString();

  const failures = await qe
    .selectFrom('login_attempts')
    .select('attempted_at')
    .where('username', '=', params.username)
    .where('remote_addr', '=', params.remoteAddr)
    .where('succeeded', '=', 0)
    .where('attempted_at', '>=', windowStart)
    .execute();

  if (failures.length >= params.maxFailures) {
    const oldest = failures.reduce(
      (min, row) => (row.attempted_at < min ? row.attempted_at : min),
      failures[0]?.attempted_at ?? now,
    );
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(oldest) + params.windowSeconds * 1000 - Date.now()) / 1000),
    );
    return { status: 'rate_limited', retryAfterSeconds };
  }

  const user = await qe
    .selectFrom('users')
    .select(['id', 'username', 'password_hash'])
    .where('username', '=', params.username)
    .executeTakeFirst();

  const passwordOk = await verifyPassword(user?.password_hash ?? TIMING_EQUALIZER_HASH, params.password);

  if (user === undefined || !passwordOk) {
    await qe
      .insertInto('login_attempts')
      .values({
        username: params.username,
        remote_addr: params.remoteAddr,
        succeeded: 0,
        attempted_at: now,
      })
      .execute();
    return { status: 'invalid_credentials' };
  }

  await qe.transaction().execute(async (trx) => {
    await trx
      .insertInto('login_attempts')
      .values({
        username: params.username,
        remote_addr: params.remoteAddr,
        succeeded: 1,
        attempted_at: now,
      })
      .execute();
    await trx
      .deleteFrom('login_attempts')
      .where('username', '=', params.username)
      .where('remote_addr', '=', params.remoteAddr)
      .where('succeeded', '=', 0)
      .execute();
  });

  return { status: 'ok', userId: user.id, username: user.username };
}
