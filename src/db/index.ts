import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { AppConfig } from '../config.js';
import { runMigrations, type MigrationResult } from './migrate.js';
import type { Database as Schema } from './schema.js';

/** better-sqlite3 数据库句柄（同步 API，本项目单进程单连接）。 */
export type Db = Database.Database;

/** 类型安全的查询入口（kysely；STANDARDS §4.2：不手搓 SQL 拼装）。 */
export type QueryEngine = Kysely<Schema>;

/**
 * 打开（必要时创建）SQLite 单文件库并设置硬性 PRAGMA：
 * - journal_mode=WAL、foreign_keys=ON（BRIEF §5 硬性要求）
 * - media/ 目录本期只建空目录（D-9；上传是 P1）
 */
export function openDatabase(config: Pick<AppConfig, 'dataDir'>): Db {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });

  const db = new Database(path.join(config.dataDir, 'pm.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** 在既有连接上建查询引擎；`qe.destroy()` 会关闭底层连接（kysely SqliteDriver.destroy）。 */
export function createQueryEngine(db: Db): QueryEngine {
  return new Kysely<Schema>({ dialect: new SqliteDialect({ database: db }) });
}

export interface PreparedDatabase {
  db: Db;
  qe: QueryEngine;
  migration: MigrationResult;
}

/** 打开库 + 迁移到最新 schema + 建查询引擎（HTTP 服务、CLI、测试共用同一条路径）。 */
export function prepareDatabase(
  config: Pick<AppConfig, 'dataDir' | 'migrationsDir'>,
): PreparedDatabase {
  const db = openDatabase(config);
  const migration = runMigrations(db, config.migrationsDir);
  return { db, qe: createQueryEngine(db), migration };
}
