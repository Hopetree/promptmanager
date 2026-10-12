import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultProjectRoot } from '../config.js';
import type { Db } from './index.js';

export interface MigrationResult {
  /** 迁移完成后的 schema 版本 */
  version: number;
  /** 本次实际应用的迁移文件名（已应用过的不会重复出现） */
  applied: string[];
}

/**
 * 迁移文件命名规范：**三位数字前缀** + `_` + 名称 + `.sql`（FR-144 ⑤）。
 * 不符合者**明确报错**，不再被 `readdirSync(...).filter(...)` 静默丢掉 ——
 * 静默跳过的后果是"以为迁移生效了、其实那个文件从没被执行"，比直接报错危险得多。
 */
const MIGRATION_FILE = /^(\d{3})_[^/]+\.sql$/;

/**
 * 迁移内容校验值：对迁移文件的**原始字节**取 sha256（含注释、含换行）。
 *
 * 口径写死在这里，并在 `docs/development.md` §6 与 `tests/stage69-migration-checksums.test.ts` 里钉住：
 * **改一个注释、加一个空行都算改动** —— 已应用的迁移本来就不该再变（要变就新增一个迁移）。
 */
export function checksumOf(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 列出目录里的迁移文件（按版本号升序），并做命名护栏。
 * 非 `.sql` 的文件（README 之类）忽略；`.sql` 但不符合 `NNN_*.sql` 的一律报错。
 */
function listMigrationFiles(migrationsDir: string): string[] {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  const bad = files.filter((name) => !MIGRATION_FILE.test(name));
  if (bad.length > 0) {
    throw new Error(
      `迁移文件名不符合 NNN_*.sql 命名规范：${bad.join('、')}（目录 ${migrationsDir}）。` +
        '请改成三位数字前缀 + 下划线，例如 010_add-something.sql —— 不合规的文件不会被应用，必须报错。',
    );
  }
  const sorted = [...files].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const seen = new Map<number, string>();
  for (const file of sorted) {
    const version = Number.parseInt(file, 10);
    const previous = seen.get(version);
    if (previous !== undefined) {
      throw new Error(`两个迁移文件用了同一个版本号 ${String(version)}：${previous}、${file}（目录 ${migrationsDir}）。`);
    }
    seen.set(version, file);
  }
  return sorted;
}

/** schema_migrations 是否已经有 checksum 列（010 之前建的库没有）。 */
function hasChecksumColumn(db: Db): boolean {
  const rows = db.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{ name: string }>;
  return rows.some((row) => row.name === 'checksum');
}

/**
 * 校验**已应用**的迁移文件有没有被改动过（FR-144 ②③）。
 *
 * - 表里还没有 checksum 列（存量库第一次升级）⇒ 整个跳过，升级本身不许失败。
 * - 记录里的 checksum 为 NULL（加列之前应用的）⇒ **首次见到时补记**，不判失败。
 * - 记录与实际不符 ⇒ 抛错，消息里带文件名、期望值与实际值。
 * - 文件名与记录不符（被改名）⇒ 抛错：改名会让历史无法追溯。
 */
function verifyAppliedMigrations(db: Db, migrationsDir: string, files: string[]): void {
  if (!hasChecksumColumn(db)) return;
  const rows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations')
    .all() as Array<{ version: number; name: string; checksum: string | null }>;
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    const row = byVersion.get(version);
    if (row === undefined) continue;
    if (row.name !== file) {
      throw new Error(
        `已应用的迁移文件名与记录不符：记录是 ${row.name}，目录里是 ${file}。` +
          '已应用的迁移不许改名 —— 请改回原名（要变更就新增一个迁移）。',
      );
    }
    const actual = checksumOf(readFileSync(path.join(migrationsDir, file)));
    if (row.checksum === null) {
      db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?').run(actual, version);
      continue;
    }
    if (row.checksum !== actual) {
      throw new Error(
        `已应用的迁移文件被改动过：${file}（记录 checksum ${row.checksum}，实际 ${actual}）。` +
          '已应用的迁移在别人的库上跑过了，改它会让两份库的 schema 悄悄分叉 —— ' +
          '请恢复原文件，或新增一个迁移来做变更。',
      );
    }
  }
}

/** 记录一次应用：checksum 列还不存在时（010 自己之前）按老形状写。 */
function insertApplied(db: Db, version: number, file: string, checksum: string): void {
  const appliedAt = new Date().toISOString();
  if (hasChecksumColumn(db)) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(
      version,
      file,
      appliedAt,
      checksum,
    );
    return;
  }
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, file, appliedAt);
}

/**
 * 幂等迁移：按文件名数字前缀升序执行 migrations/*.sql，
 * 已应用的版本记录在 schema_migrations 里，重复执行为空操作（BRIEF §5、§6.2）。
 * 每个迁移在单个事务内完成（失败即整体回滚，不留半截 schema）。
 *
 * 阶段 69（FR-144）起还负责**内容校验**：应用前先比对已应用迁移的 checksum，
 * 应用后再跑一遍（让刚加上 checksum 列的存量库把历史迁移补记进去）。
 */
export function runMigrations(
  db: Db,
  migrationsDir: string = path.join(defaultProjectRoot, 'migrations'),
): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const files = listMigrationFiles(migrationsDir);

  // ① 先查"已应用的是否被改过"：篡改要在应用任何新迁移之前就失败。
  verifyAppliedMigrations(db, migrationsDir, files);

  const done = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  const applied: string[] = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (done.has(version)) continue;
    const bytes = readFileSync(path.join(migrationsDir, file));
    const sql = bytes.toString('utf8');
    const checksum = checksumOf(bytes);
    db.transaction(() => {
      db.exec(sql);
      insertApplied(db, version, file, checksum);
    })();
    applied.push(file);
  }

  // ② 再校验一次：本次刚给存量库补上 checksum 列，历史迁移在这里补记 / 受校验。
  verifyAppliedMigrations(db, migrationsDir, files);

  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
    version: number;
  };
  return { version: row.version, applied };
}
