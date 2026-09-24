import { sql, type SqlBool } from 'kysely';
import type { QueryEngine } from '../db/index.js';
import { nowIso } from './auth.js';

/** 使用记录的"通道"（BRIEF FR-19 固定取值）。 */
export type UsageChannel = 'session' | 'token' | 'mcp';

/**
 * FR-114：使用记录的**事件类型**（`usage_events.kind`，迁移 006）——
 * 用于区分"只是点开看了看"与"真的复制/渲染取用"：
 * - `view`：**打开详情**（`GET /api/prompts/:id`）—— **留痕，但不计入取用**；
 * - `copy`：**复制 / 渲染取用**（`POST /api/prompts/:id/render`）—— 计入；
 * - `mcp` ：**MCP 取用**（`prompt_get` / `prompt_render` 经 `X-PM-Channel: mcp`）—— 计入。
 */
export type UsageKind = 'view' | 'copy' | 'mcp';

/**
 * **计入「取用 N 次」的事件类型**（D-50 ②）：只有这两种。
 * ⚠️ 所有对外暴露的计数（详情/列表的 `use_count`、`/api/usage/summary` 的 total / by_channel /
 * by_token / top）都必须用**同一套口径**，否则会出现"页面显示 3 次、统计说 5 次"的自相矛盾。
 */
export const COUNTED_KINDS: readonly UsageKind[] = ['copy', 'mcp'];

/** 库里 `kind` 可能为 NULL（历史行/手工插入）⇒ 与服务层口径一致地当作 `copy`。 */
export function normalizeKind(raw: unknown): UsageKind {
  return raw === 'view' || raw === 'copy' || raw === 'mcp' ? raw : 'copy';
}

/** 由认证通道推导事件类型：MCP 通道算 `mcp`，其余（会话 / 令牌）算 `copy`。 */
export function kindForChannel(channel: UsageChannel): UsageKind {
  return channel === 'mcp' ? 'mcp' : 'copy';
}

export interface UsageStats {
  use_count: number;
  last_used_at: string | null;
}

export interface UsageTopEntry {
  prompt_id: number;
  title: string;
  count: number;
  last_used_at: string | null;
}

export interface UsageSummary {
  days: number;
  total: number;
  by_channel: { session: number; token: number; mcp: number };
  /** FR-104：按**令牌**归因（`token_id = null` 表示 cookie 会话取用）—— 出事后能查"是哪把令牌取的"。 */
  by_token: Array<{ token_id: number | null; count: number }>;
  top: UsageTopEntry[];
}

export const DEFAULT_USAGE_DAYS = 30;
export const MAX_USAGE_TOP = 20;

/**
 * 写一条使用记录（FR-19 / D-17 / **FR-114**）：打开详情（`view`，留痕不计数）、
 * 渲染与复制（`copy`）、MCP 取用（`mcp`）；列表/搜索不记。
 *
 * ⚠️ 这里**只**写 usage_events，绝不碰 prompts 行 ⇒ 不产生版本、不改 updated_at。
 * `kind` 缺省 `'copy'` —— 与迁移 006 对存量行的回填口径一致（漏传也不会把"取用"记成不计数的）。
 */
export async function recordUsage(
  qe: QueryEngine,
  promptId: number,
  channel: UsageChannel,
  /** FR-104：令牌通道传该令牌 id；cookie 会话传 null（会话没有"令牌"可归因）。 */
  tokenId: number | null = null,
  /** FR-114：事件类型；**只有 `copy` / `mcp` 计入「取用 N 次」**，`view` 只留痕。 */
  kind: UsageKind = 'copy',
): Promise<void> {
  await qe
    .insertInto('usage_events')
    .values({ prompt_id: promptId, channel, used_at: nowIso(), token_id: tokenId, kind })
    .execute();
}

/** 批量取若干 prompt 的 {use_count, last_used_at}（列表路径另走 JOIN，避免 N+1）。 */
export async function usageStatsFor(qe: QueryEngine, promptIds: number[]): Promise<Map<number, UsageStats>> {
  const stats = new Map<number, UsageStats>();
  if (promptIds.length === 0) return stats;

  const rows = await qe
    .selectFrom('usage_events')
    .select((eb) => [
      'prompt_id',
      eb.fn.countAll<number>().as('use_count'),
      eb.fn.max('used_at').as('last_used_at'),
    ])
    .where('prompt_id', 'in', promptIds)
    /**
     * FR-114：**只统计"真的取用"**（复制/渲染/MCP）—— 打开详情（`kind='view'`）留痕但不计数。
     * `COALESCE` 是给"历史行 kind 为 NULL"兜底：迁移 006 已把存量行回填成 'copy'，
     * 但手工插入的行仍可能是 NULL ⇒ 与服务层"NULL 视作 copy"的口径保持一致。
     */
    .where(sql<SqlBool>`coalesce(kind, 'copy') in ('copy', 'mcp')`)
    .groupBy('prompt_id')
    .execute();

  for (const row of rows) {
    stats.set(row.prompt_id, {
      use_count: Number(row.use_count),
      last_used_at: row.last_used_at ?? null,
    });
  }
  return stats;
}

/** 指定 prompt 的统计（没有记录时是 0/null）。 */
export async function usageStatsOf(qe: QueryEngine, promptId: number): Promise<UsageStats> {
  const stats = await usageStatsFor(qe, [promptId]);
  return stats.get(promptId) ?? { use_count: 0, last_used_at: null };
}

/** `GET /api/usage/summary?days=N`：窗口内总量、分通道计数、top（count 降序，最多 20）。 */
export async function usageSummary(qe: QueryEngine, days: number): Promise<UsageSummary> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // FR-114：summary 与 use_count **同一口径** —— 只统计"真的取用"（copy/mcp），
  // 否则会出现"页面显示 N 次、统计说 M 次"的自相矛盾。
  const counted = sql<SqlBool>`coalesce(kind, 'copy') in ('copy', 'mcp')`;

  const totals = await qe
    .selectFrom('usage_events')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('used_at', '>=', since)
    .where(counted)
    .executeTakeFirstOrThrow();

  const channels = await qe
    .selectFrom('usage_events')
    .select((eb) => ['channel', eb.fn.countAll<number>().as('count')])
    .where('used_at', '>=', since)
    .where(counted)
    .groupBy('channel')
    .execute();

  const top = await qe
    .selectFrom('usage_events as e')
    .innerJoin('prompts as p', 'p.id', 'e.prompt_id')
    .select((eb) => [
      'e.prompt_id as prompt_id',
      'p.title as title',
      eb.fn.countAll<number>().as('count'),
      eb.fn.max('e.used_at').as('last_used_at'),
    ])
    .where('e.used_at', '>=', since)
    .where(sql<SqlBool>`coalesce(e.kind, 'copy') in ('copy', 'mcp')`)
    .groupBy(['e.prompt_id', 'p.title'])
    .orderBy(sql`count(*)`, 'desc')
    .orderBy(sql`max(e.used_at)`, 'desc')
    .limit(MAX_USAGE_TOP)
    .execute();

  const byChannel: UsageSummary['by_channel'] = { session: 0, token: 0, mcp: 0 };
  for (const row of channels) {
    if (row.channel === 'session' || row.channel === 'token' || row.channel === 'mcp') {
      byChannel[row.channel] = Number(row.count);
    }
  }

  // FR-104：按令牌归因（NULL = 会话取用）
  const tokens = await qe
    .selectFrom('usage_events')
    .select((eb) => ['token_id', eb.fn.countAll<number>().as('count')])
    .where('used_at', '>=', since)
    .where(counted)
    .groupBy('token_id')
    .orderBy(sql`count(*)`, 'desc')
    .execute();

  return {
    days,
    total: Number(totals.total),
    by_channel: byChannel,
    by_token: tokens.map((row) => ({ token_id: row.token_id ?? null, count: Number(row.count) })),
    top: top.map((row) => ({
      prompt_id: row.prompt_id,
      title: row.title,
      count: Number(row.count),
      last_used_at: row.last_used_at ?? null,
    })),
  };
}
