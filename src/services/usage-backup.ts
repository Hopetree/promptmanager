import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { QueryEngine } from '../db/index.js';
import { nowIso } from './auth.js';

/**
 * FR-134（评审 F6）：`replace` 导入**清空前**给取用历史留一份。
 *
 * 为什么需要它：`usage_events.prompt_id` 是 `ON DELETE CASCADE`（`migrations/002_tokens-and-usage.sql`），
 * 而 replace 导入会 `DELETE FROM prompts` ⇒ 本地全部取用次数与「最近使用」被**级联清空**；
 * 导出文件里又只有交付数据（5 张表，不含 usage）⇒ 「从云端恢复」等于永久丢掉取用历史，
 * 而且**一声不响**。
 *
 * 取舍（D-62 ③）：关键词是「不静默」，不是「不许清空」—— 恢复本质上就是重建数据，
 * 清空可以是有意的取舍；但不许既清空又不告诉用户，也不许连一份都留不下。
 * 所以：清空**前**把 `usage_events` 全量落成一份 JSON（0600，落在 `DATA_DIR` 下，
 * 与 `pre-restore-*.json` 同一个地方），响应里如实回报去向与条数。
 *
 * ⚠️ 这份备份**不进导出文件、不上传云端**（那会把「快照 = 交付数据」的语义搅浑，D-62 ⑥）；
 * 它只是本地的一次救命存档，保留最近 {@link USAGE_BACKUP_KEEP} 份。
 */
export const USAGE_BACKUP_KEEP = 3;

/** 备份文件前缀（`pre-restore-*.json` 是内容快照，这个是取用历史快照，刻意用不同前缀）。 */
export const USAGE_BACKUP_PREFIX = 'pre-replace-usage-';

/** 一行取用事件（形状 = `usage_events` 的业务列，不含自增 id）。 */
export interface UsageEventRow {
  prompt_id: number;
  channel: string;
  used_at: string;
  token_id: number | null;
  kind: string | null;
}

/** 备份文件的顶层结构（自带 `count`，便于人工打开时先看条数）。 */
export interface UsageBackupFile {
  app: 'promptmanager-usage-backup';
  created_at: string;
  reason: string;
  count: number;
  rows: UsageEventRow[];
}

/** 读出全部取用事件（按 id 升序 = 写入顺序）。 */
export async function readUsageEvents(qe: QueryEngine): Promise<UsageEventRow[]> {
  const rows = await qe
    .selectFrom('usage_events')
    .select(['prompt_id', 'channel', 'used_at', 'token_id', 'kind'])
    .orderBy('id', 'asc')
    .execute();
  return rows.map((row) => ({
    prompt_id: row.prompt_id,
    channel: row.channel,
    used_at: row.used_at,
    token_id: row.token_id ?? null,
    kind: row.kind ?? null,
  }));
}

/** 只数条数（merge 路径不备份，但要如实回报「保留了多少条」）。 */
export async function countUsageEvents(qe: QueryEngine): Promise<number> {
  const row = await qe
    .selectFrom('usage_events')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/**
 * 把取用历史写一份到 `dir`，返回**绝对路径**；顺带只保留最近 {@link USAGE_BACKUP_KEEP} 份。
 *
 * 文件名用 `YYYYMMDDTHHMMSSmmmZ` 形式的时间戳（把 ISO 里的 `:` 与 `.` 换掉，Windows 也能用），
 * 这样按名字排序 = 按时间排序，裁剪不必读文件内容。
 */
export async function writeUsageBackup(dir: string, rows: UsageEventRow[]): Promise<string> {
  await mkdir(dir, { recursive: true });

  const created = nowIso();
  const stamp = created.replace(/[:.]/g, '-');
  const file = path.join(dir, `${USAGE_BACKUP_PREFIX}${stamp}.json`);
  const payload: UsageBackupFile = {
    app: 'promptmanager-usage-backup',
    created_at: created,
    reason: 'replace 导入会级联清空 usage_events（ON DELETE CASCADE），清空前留档',
    count: rows.length,
    rows,
  };
  // 0600：与凭据 / 内容快照同一口径（只有服务进程可读）
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  const names = (await readdir(dir)).filter((name) => name.startsWith(USAGE_BACKUP_PREFIX) && name.endsWith('.json')).sort();
  for (const stale of names.slice(0, Math.max(0, names.length - USAGE_BACKUP_KEEP))) {
    await rm(path.join(dir, stale), { force: true });
  }

  return file;
}
