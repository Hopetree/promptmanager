import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
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
 * FR-155 / AC-134 A：库文件必须 0600（库里装着全部正文 + 口令哈希 + 令牌密文）。
 *
 * 为什么不能只靠 umask：`new Database()` 建文件走进程 umask（022 ⇒ 0644），容器与手工运行都落这个坑；
 * 同仓库其它敏感文件（`token-enc.key` / 导出文件 / 快照）早就是 0600 —— 只有 SQLite 文件例外。
 * 每次打开都收紧 ⇒ **新建库、历史 0644 库、CLI、服务、容器** 五条路径同一份代码全覆盖。
 */
function secureDatabaseFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      chmodSync(file, 0o600);
    } catch {
      // 文件还不存在（-wal/-shm 是惰性创建的）—— 不存在就无需收紧
    }
  }
}

/**
 * 把 WAL 的两个附属文件**预先以 0600 建出来**。
 *
 * 实测结论（2026-10-13）：SQLite 自己创建 `-wal`/`-shm` 时**固定用 0644**，不继承库文件的模式；
 * 但只要这两个文件**已经存在**，SQLite 就原样沿用（inode 与模式都不变）。
 * 所以「预创建」是唯一不依赖 umask 的收紧手段 —— 否则运行期 WAL 里会躺着一份 0644 的正文副本。
 *
 * `'a'` 只创建不截断：绝不能碰一个正在使用的 WAL（截断等于丢数据）；失败（只读目录）不致命，
 * 交给 SQLite 自己建，只是那种环境下模式由 umask 决定。
 */
function precreateWalFiles(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (existsSync(file)) continue;
    try {
      closeSync(openSync(file, 'a', 0o600));
    } catch {
      /* 只读数据目录：让 SQLite 自己创建 */
    }
  }
}

/**
 * 打开（必要时创建）SQLite 单文件库并设置硬性 PRAGMA：
 * - journal_mode=WAL、foreign_keys=ON（BRIEF §5 硬性要求）
 * - media/ 目录本期只建空目录（D-9；上传是 P1）
 */
export function openDatabase(config: Pick<AppConfig, 'dataDir'>): Db {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });

  const dbPath = path.join(config.dataDir, 'pm.db');
  // 先建 600 的 -wal/-shm（SQLite 建它们时固定 0644），再开库、再收紧库文件本身
  precreateWalFiles(dbPath);
  const db = new Database(dbPath);
  secureDatabaseFiles(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  // 兜底：万一 SQLite 重建过这两个文件，这里再收紧一次
  secureDatabaseFiles(dbPath);
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
