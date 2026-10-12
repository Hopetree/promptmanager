// 阶段 69 / BRIEF FR-144（设计评审 F11）/ AC-131 A 组：迁移运行器的**内容校验**。
//
// 问题：schema_migrations 原本只有 (version, name, applied_at)，运行器只按数字前缀判断"跑过没有"。
// ⇒ 一个**已应用**的迁移被改动，没有任何机制发现，两份库的 schema 会悄悄分叉。
//
// 本文件钉住四件事：① 新迁移 010 加 checksum 列且已应用的 001–009 一字未改；
// ② 存量库（v9、无 checksum 列）升级后正常启动、历史迁移**首次补记**、重复执行为空操作；
// ③ 篡改/改名 ⇒ 明确失败并指出文件名；④ 不符合 NNN_*.sql 的文件 ⇒ 明确报错（不静默跳过）。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { checksumOf, runMigrations } from '../dist/db/migrate.js';
import { CURRENT_SCHEMA_VERSION, LATEST_MIGRATION, MIGRATION_COUNT } from './migrations.ts';
import { PROJECT_ROOT, readSource } from './source-text.ts';

const MIGRATIONS = path.join(PROJECT_ROOT, 'migrations');

/**
 * 阶段 69 开工前**已应用**的 9 个迁移（001–009）的冻结指纹：
 * `sha256(每个文件的 "文件名:内容 sha256" 逐行拼接)`。
 *
 * 这是一个**永不需要维护**的绊线：这 9 个迁移在别人的库上跑过了，一个字都不许再改
 * （要变更就新增迁移）——改一个字节、改一个注释、加一个空行，这里立刻红。
 */
const FROZEN_APPLIED_DIGEST = '5d416daf3efa56cffecd85f1587e9b998a52ef04fc17344611798d1620cf7242';

/** 迁移文件的版本号（三位数字前缀）。 */
function versionOf(file: string): number {
  return Number.parseInt(file, 10);
}

/** 001–009 的冻结指纹（与 FROZEN_APPLIED_DIGEST 比对）。 */
function frozenAppliedDigest(): string {
  const digest = createHash('sha256');
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    if (versionOf(file) > 9) continue;
    digest.update(`${file}:${checksumOf(readFileSync(path.join(MIGRATIONS, file)))}\n`);
  }
  return digest.digest('hex');
}

/** 复制整个迁移目录到临时目录，供篡改 / 改名 / 命名护栏用例使用。 */
function copyMigrations(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm69-mig-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  return dir;
}

function withDb(fn: (db: Database.Database) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm69-db-'));
  const db = new Database(path.join(dir, 'pm.db'));
  try {
    fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 造一个**只跑到 v9 的存量库**：`schema_migrations` 用 010 之前的形状（三列、无 checksum），
 * 001–009 手工标记为已应用，并灌一条 prompt（证明升级不动数据）。
 */
function withLegacyDb(fn: (db: Database.Database) => void): void {
  withDb((db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    for (const file of readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (versionOf(file) > 9) continue;
      db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        versionOf(file),
        file,
        new Date().toISOString(),
      );
    }
    db.prepare(
      `INSERT INTO prompts (title, user_prompt, system_prompt, notes, folder_id, favorite, version_no, created_at, updated_at)
       VALUES ('存量', 'u', '', '', NULL, 0, 1, '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00.000Z')`,
    ).run();
    fn(db);
  });
}

test('AC-131 ①：新迁移 010 给 schema_migrations 加 checksum 列，已应用的 001–009 一字未改', () => {
  assert.equal(MIGRATION_COUNT, 10, '本阶段新增一个迁移（9 → 10）');
  assert.equal(LATEST_MIGRATION, '010_migration-checksums.sql');
  assert.match(
    readSource('migrations/010_migration-checksums.sql'),
    /ALTER TABLE schema_migrations ADD COLUMN checksum TEXT/,
    '010 必须给 schema_migrations 加 checksum 列',
  );
  assert.equal(
    frozenAppliedDigest(),
    FROZEN_APPLIED_DIGEST,
    '001–009 是已应用的迁移，一个字都不许改（改了就与别人库上的 schema 悄悄分叉）',
  );
});

test('AC-131 ②④：存量库（v9、无 checksum 列）升级后正常启动、历史迁移首次补记、重复执行为空操作', () => {
  withLegacyDb((db) => {
    const first = runMigrations(db, MIGRATIONS);
    assert.equal(first.version, CURRENT_SCHEMA_VERSION, '存量库必须能升到当前版本');
    assert.deepEqual(first.applied, ['010_migration-checksums.sql'], '只有 010 是新的');

    const rows = db
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string; checksum: string | null }>;
    assert.equal(rows.length, MIGRATION_COUNT);
    assert.equal(
      rows.filter((row) => row.checksum === null).length,
      0,
      '存量口径 = 首次见到时补记：升级后所有历史迁移都必须有 checksum',
    );
    const row001 = rows.find((row) => row.version === 1);
    assert.equal(row001?.checksum, checksumOf(readFileSync(path.join(MIGRATIONS, '001_init.sql'))), '补记的必须是文件当前内容');

    const prompt = db.prepare('SELECT title FROM prompts').get() as { title: string };
    assert.equal(prompt.title, '存量', '升级不得动数据');

    const second = runMigrations(db, MIGRATIONS);
    assert.deepEqual(second.applied, [], '重复执行为空操作');
    assert.equal(second.version, CURRENT_SCHEMA_VERSION);
  });
});

test('AC-131 ③：已应用迁移被改一个字节 ⇒ 明确失败，且指出是哪个文件', () => {
  withDb((db) => {
    runMigrations(db, MIGRATIONS); // 先用**原样**目录建立带 checksum 的库
    const tampered = copyMigrations();
    try {
      const target = path.join(tampered, '002_tokens-and-usage.sql');
      writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- 偷偷改一个字节\n`);
      assert.throws(
        () => runMigrations(db, tampered),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /002_tokens-and-usage\.sql/, '必须指出是哪个文件');
          assert.match(message, /checksum/, '必须说清是内容校验不符');
          assert.match(message, /被改动过/, '必须明确失败，不是静默继续');
          return true;
        },
      );
      const version = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
        version: number;
      };
      assert.equal(version.version, CURRENT_SCHEMA_VERSION, '校验失败时不得改动版本表');
    } finally {
      rmSync(tampered, { recursive: true, force: true });
    }
  });
});

test('AC-131 ③（续）：已应用迁移被改名 ⇒ 明确失败（改名同样让历史无法追溯）', () => {
  withDb((db) => {
    runMigrations(db, MIGRATIONS);
    const renamed = copyMigrations();
    try {
      cpSync(path.join(renamed, '002_tokens-and-usage.sql'), path.join(renamed, '002_tokens.sql'));
      rmSync(path.join(renamed, '002_tokens-and-usage.sql'));
      assert.throws(
        () => runMigrations(db, renamed),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /002_tokens-and-usage\.sql/);
          assert.match(message, /002_tokens\.sql/);
          return true;
        },
      );
    } finally {
      rmSync(renamed, { recursive: true, force: true });
    }
  });
});

test('AC-131 ⑤：不符合 NNN_*.sql 的文件 ⇒ 明确报错（不静默跳过、不 NaN）', () => {
  withDb((db) => {
    for (const bad of ['add-something.sql', '10_ten.sql', '011.sql']) {
      const dir = copyMigrations();
      try {
        writeFileSync(path.join(dir, bad), 'SELECT 1;');
        assert.throws(
          () => runMigrations(db, dir),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(message, new RegExp(bad.replace('.', '\\.')), `错误信息必须点名 ${bad}`);
            assert.match(message, /NNN_\*\.sql/, '必须说清命名规范');
            assert.doesNotMatch(message, /NaN/, '不允许把文件名 parseInt 成 NaN 后静默跳过');
            return true;
          },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    // 非 .sql 的文件（README 之类）不受影响，也不算迁移
    const okDir = copyMigrations();
    try {
      writeFileSync(path.join(okDir, 'README.md'), '迁移目录说明\n');
      const result = runMigrations(db, okDir);
      assert.equal(result.version, CURRENT_SCHEMA_VERSION);
    } finally {
      rmSync(okDir, { recursive: true, force: true });
    }
  });
});

test('AC-131 ③（口径）：checksum 对**原始字节**取 —— 改注释、加空行同样算改动', () => {
  assert.equal(checksumOf('SELECT 1;'), checksumOf(Buffer.from('SELECT 1;')), '字符串与 Buffer 同口径');
  assert.notEqual(checksumOf('SELECT 1;'), checksumOf('SELECT 1;\n'), '加一个换行也算改动');
  assert.notEqual(checksumOf('SELECT 1;'), checksumOf('SELECT 1; -- 注释'), '改注释也算改动');
  assert.equal(checksumOf('SELECT 1;').length, 64, 'sha256 十六进制 64 字符');
});
