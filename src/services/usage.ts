import { sql } from 'kysely';
import type { QueryEngine } from '../db/index.js';
import { nowIso } from './auth.js';

/** 使用记录的"通道"（BRIEF FR-19 固定取值）。 */
export type UsageChannel = 'session' | 'token' | 'mcp';

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
 * 写一条"取用"记录（FR-19 / D-17）：只记详情、渲染、MCP 取用；列表/搜索不记。
 * ⚠️ 这里**只**写 usage_events，绝不碰 prompts 行 ⇒ 不产生版本、不改 updated_at。
 */
export async function recordUsage(
  qe: QueryEngine,
  promptId: number,
  channel: UsageChannel,
  /** FR-104：令牌通道传该令牌 id；cookie 会话传 null（会话没有"令牌"可归因）。 */
  tokenId: number | null = null,
): Promise<void> {
  await qe
    .insertInto('usage_events')
    .values({ prompt_id: promptId, channel, used_at: nowIso(), token_id: tokenId })
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

  const totals = await qe
    .selectFrom('usage_events')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('used_at', '>=', since)
    .executeTakeFirstOrThrow();

  const channels = await qe
    .selectFrom('usage_events')
    .select((eb) => ['channel', eb.fn.countAll<number>().as('count')])
    .where('used_at', '>=', since)
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
