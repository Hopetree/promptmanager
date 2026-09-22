import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { openDatabase } from '../dist/db/index.js';
import { runMigrations } from '../dist/db/migrate.js';

function withDb(fn: (db: ReturnType<typeof openDatabase>, dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-migrate-'));
  const cfg = loadConfig({ DATA_DIR: dir });
  const db = openDatabase(cfg);
  try {
    fn(db, dir);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('runMigrations 幂等：重复执行不报错，schema 版本稳定在当前版本（BRIEF §5、§6.2）', () => {
  withDb((db) => {
    const first = runMigrations(db);
    const second = runMigrations(db);
    // 001 初始 schema + 002（阶段 6：api_tokens / usage_events）+ 003（阶段 22：prompts.sort_order）
    // + 004（阶段 35：api_tokens.token_enc）+ 005（阶段 42：api_tokens.scope / usage_events.token_id）
    // ⇒ 当前 schema 版本 = 5
    assert.equal(first.version, 5);
    assert.equal(second.version, 5);
    assert.equal(second.applied.length, 0, '第二次执行不应重复应用迁移');
    const rows = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    for (const expected of [
      'api_tokens',
      'folders',
      'login_attempts',
      'prompt_tags',
      'prompt_versions',
      'prompts',
      'prompts_fts',
      'schema_migrations',
      'sessions',
      'tags',
      'usage_events',
      'users',
    ]) {
      assert.ok(names.includes(expected), `缺少表 ${expected}（实际：${names.join(',')}）`);
    }
  });
});

test('WAL 与 foreign_keys 开启（BRIEF §5 硬性要求）', () => {
  withDb((db) => {
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  });
});

test('FTS5 trigram：中文 ≥3 字命中、2 字 0 命中（LIKE 兜底前提，BRIEF §6.6 / D-3）', () => {
  withDb((db) => {
    runMigrations(db);
    const now = new Date().toISOString();
    const insert = db.prepare(
      'insert into prompts (title, user_prompt, system_prompt, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    );
    insert.run('会话交接文档', '把上下文交给下一个同学', '', '', now, now);
    insert.run('无关标题', '今天的天气', '', '', now, now);

    const match = (q: string) =>
      db
        .prepare('select count(*) as n from prompts_fts where prompts_fts match ?')
        .get(`"${q.replaceAll('"', '""')}"`) as { n: number };
    const like = (q: string) =>
      db
        .prepare("select count(*) as n from prompts where title like ? escape '\\'")
        .get(`%${q}%`) as { n: number };

    assert.equal(match('会话交接').n, 1, '≥3 字符应由 trigram 命中');
    assert.equal(match('交接').n, 0, 'trigram 对 2 字符应 0 命中（这是 LIKE 兜底存在的原因）');
    assert.equal(like('交接').n, 1, 'LIKE 兜底应命中 2 字符查询');
  });
});

test('FTS 索引随 prompts 的 UPDATE / DELETE 同步（BRIEF §6.6 "索引必须随增删改同步维护"）', () => {
  withDb((db) => {
    runMigrations(db);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        'insert into prompts (title, user_prompt, system_prompt, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run('会话交接', '', '', '', now, now);
    const id = Number(info.lastInsertRowid);

    const match = (q: string) =>
      (db.prepare('select count(*) as n from prompts_fts where prompts_fts match ?').get(`"${q}"`) as {
        n: number;
      }).n;

    assert.equal(match('会话交接'), 1, 'INSERT 后应命中');
    db.prepare('update prompts set title = ? where id = ?').run('无关标题', id);
    assert.equal(match('会话交接'), 0, 'UPDATE 后旧内容不应再命中');
    assert.equal(match('无关标题'), 1, 'UPDATE 后新内容应命中');
    db.prepare('delete from prompts where id = ?').run(id);
    assert.equal(match('无关标题'), 0, 'DELETE 后不应再命中');
  });
});

test('外键约束真的生效（越权写入被拒）', () => {
  withDb((db) => {
    runMigrations(db);
    assert.throws(
      () => db.prepare('insert into sessions (id, user_id, created_at, expires_at) values (?, ?, ?, ?)').run('s1', 999, 'x', 'y'),
      /FOREIGN KEY/i,
    );
  });
});
