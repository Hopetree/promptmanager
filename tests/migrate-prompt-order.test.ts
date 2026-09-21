// 阶段 22 / FR-70 / D-28：`prompts.sort_order` 迁移（migrations/003_prompt-sort-order.sql）
// 关键断言：① 从**旧结构库**升级后，既有条目顺序**不乱**（按升级前的默认顺序 最近更新倒序 回填 1..N）；
//           ② 幂等：重复执行迁移不报错、不改动已有 sort_order；
//           ③ 新库（全新 DATA_DIR）也能正常建表并可用 custom 排序。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../dist/db/migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

/** 造一个**只跑到 002**的"旧库"，并写入若干 prompt（不同 updated_at）。 */
function makeLegacyDb(): { db: Database.Database; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-legacy-'));
  const db = new Database(path.join(dir, 'pm.db'));
  // 真实旧库里 schema_migrations 由 runMigrations 创建（**不属于**任何迁移文件），这里照抄同一 DDL
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const file of ['001_init.sql', '002_tokens-and-usage.sql']) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      Number.parseInt(file, 10),
      file,
      new Date().toISOString(),
    );
  }
  const insert = db.prepare(
    `INSERT INTO prompts (title, user_prompt, system_prompt, notes, folder_id, favorite, version_no, created_at, updated_at)
     VALUES (?, ?, '', '', NULL, 0, 1, ?, ?)`,
  );
  // updated_at 故意与 id 顺序**相反**：id 1 最新、id 3 最旧 → 默认顺序 = [1, 2, 3]
  insert.run('第一新', 'u1', '2026-09-20T03:00:00.000Z', '2026-09-20T03:00:00.000Z');
  insert.run('第二', 'u2', '2026-09-20T02:00:00.000Z', '2026-09-20T02:00:00.000Z');
  insert.run('第三旧', 'u3', '2026-09-20T01:00:00.000Z', '2026-09-20T01:00:00.000Z');
  return { db, dir };
}

function rows(db: Database.Database): Array<{ id: number; sort_order: number }> {
  return db.prepare('SELECT id, sort_order FROM prompts ORDER BY sort_order ASC, id ASC').all() as Array<{
    id: number;
    sort_order: number;
  }>;
}

test('FR-70 迁移：旧库升级后既有条目顺序不变（按升级前的默认顺序回填 1..N）', () => {
  const { db, dir } = makeLegacyDb();
  try {
    // 升级前：默认顺序 = updated_at DESC, id DESC
    const before = db.prepare('SELECT id FROM prompts ORDER BY updated_at DESC, id DESC').all() as Array<{ id: number }>;
    assert.deepEqual(before.map((row) => row.id), [1, 2, 3]);

    const result = runMigrations(db, MIGRATIONS);
    assert.equal(result.version, 4);
    assert.ok(result.applied.includes('003_prompt-sort-order.sql'));

    const after = rows(db);
    assert.deepEqual(after.map((row) => row.id), before.map((row) => row.id), '升级后 custom 顺序必须与升级前的默认顺序一致');
    assert.deepEqual(after.map((row) => row.sort_order), [1, 2, 3], '既有条目的 sort_order 必须回填成 1..N（不能全体 0）');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FR-70 迁移幂等：重复执行不报错、不改动已有 sort_order', () => {
  const { db, dir } = makeLegacyDb();
  try {
    runMigrations(db, MIGRATIONS);
    // 用户拖拽后的顺序
    db.prepare('UPDATE prompts SET sort_order = ? WHERE id = ?').run(7, 1);
    const snapshot = rows(db);

    const again = runMigrations(db, MIGRATIONS);
    assert.deepEqual(again.applied, [], '已应用过的迁移不得重复执行');
    assert.deepEqual(rows(db), snapshot, '再次执行迁移不得改动 sort_order');
    // 列仍然存在且可用
    db.prepare('UPDATE prompts SET sort_order = 0 WHERE id = 2').run();
    assert.equal((rows(db).find((row) => row.id === 2) ?? {}).sort_order, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FR-70 迁移：全新库从 0 跑到当前版本（含 sort_order 列与索引）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-fresh-'));
  const db = new Database(path.join(dir, 'pm.db'));
  try {
    const result = runMigrations(db, MIGRATIONS);
    assert.equal(result.version, 4);
    const columns = (db.prepare('PRAGMA table_info(prompts)').all() as Array<{ name: string }>).map((row) => row.name);
    assert.ok(columns.includes('sort_order'), 'prompts 必须有 sort_order 列');
    const indexes = (db.prepare('PRAGMA index_list(prompts)').all() as Array<{ name: string }>).map((row) => row.name);
    assert.ok(indexes.includes('idx_prompts_sort'), '应有 idx_prompts_sort 索引');
    // 新插入的 prompt 默认 sort_order = 0（排在既有 1..N 之前）
    db.prepare(
      `INSERT INTO prompts (title, user_prompt, system_prompt, notes, folder_id, favorite, version_no, created_at, updated_at)
       VALUES ('新', 'u', '', '', NULL, 0, 1, '2026-09-20T04:00:00.000Z', '2026-09-20T04:00:00.000Z')`,
    ).run();
    const row = db.prepare('SELECT sort_order FROM prompts').get() as { sort_order: number };
    assert.equal(row.sort_order, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
