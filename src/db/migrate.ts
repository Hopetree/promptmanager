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

const MIGRATION_FILE = /^(\d+)[-_].*\.sql$/;

/**
 * 幂等迁移：按文件名数字前缀升序执行 migrations/*.sql，
 * 已应用的版本记录在 schema_migrations 里，重复执行为空操作（BRIEF §5、§6.2）。
 * 每个迁移在单个事务内完成（失败即整体回滚，不留半截 schema）。
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

  const files = readdirSync(migrationsDir)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  const done = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  const applied: string[] = [];
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (done.has(version)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        file,
        new Date().toISOString(),
      );
    })();
    applied.push(file);
  }

  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
    version: number;
  };
  return { version: row.version, applied };
}
