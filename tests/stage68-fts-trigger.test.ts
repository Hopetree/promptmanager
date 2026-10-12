// 阶段 68 / FR-140（AC-130 ①②③④⑤）：FTS 触发器加 `WHEN` 子句。
//
// 问题（设计评审 F10）：`migrations/001_init.sql` 的 `prompts_fts_au`（`AFTER UPDATE ON prompts`）
// **没有 `WHEN`** ⇒ 改收藏 / 拖拽排序 / 切「记住变量值」/ 移动目录这些**不碰被索引列**的写入，
// 也在 delete + insert 整行 FTS。修法是**新增迁移 009**（001 已应用，不许改）重建带 `WHEN` 的版本。
//
// 纪律：
//   · 「不重建」**不接受推理**（D-66 ②）⇒ 用 `total_changes()`（SQLite 内置函数，含触发器引起的行变更）
//     作为可观测口径：不碰索引列 ⇒ 只变 1 行（prompts 自身）；碰索引列 ⇒ 9 行（prompts + FTS 的
//     delete/insert 及其 shadow 表写入）。用例里还有一条**对照**：把 001 的旧触发器装回去，
//     同一口径立刻变成 9 ⇒ 证明这个口径**能看见重建**，不是"恒为 1 的假绿"。
//   · 「改了还能搜到」是真检索（`GET /api/prompts?q=`），不是看触发器定义。
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { openDatabase } from '../dist/db/index.js';
import { runMigrations } from '../dist/db/migrate.js';
import { cookieOf, login, makeFixture, PROJECT_ROOT, readDb } from './helpers.ts';
import { readRaw, readSource } from './source-text.ts';

const NOW = '2026-10-12T00:00:00.000Z';

/** 旧触发器（001_init.sql 里那份，**无 WHEN**）——只在「对照」里用，产品代码不含它。 */
const LEGACY_AU_TRIGGER = `CREATE TRIGGER prompts_fts_au AFTER UPDATE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, title, user_prompt, system_prompt, notes)
  VALUES ('delete', old.id, old.title, old.user_prompt, old.system_prompt, old.notes);
  INSERT INTO prompts_fts(rowid, title, user_prompt, system_prompt, notes)
  VALUES (new.id, new.title, new.user_prompt, new.system_prompt, new.notes);
END;`;

/** 建一个只跑到 v8（= 009 之前）的库，并灌一条**存量** prompt，模拟"已经用了一阵子的库"。
 *  四个被索引列各给一个**互不相同**的 3 字标记（trigram 至少要 3 字才命中），
 *  这样"改哪一列"就能用"搜哪一列"独立验证，不会被别的列里还留着的旧值干扰。 */
const LEGACY_ROW = { title: '旧标甲', user_prompt: '旧正乙', system_prompt: '旧系丙', notes: '旧注丁' };

function makeLegacyDb(): { dir: string; id: number } {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-s68-fts-'));
  const legacyDir = path.join(dir, 'legacy-migrations');
  mkdirSync(legacyDir);
  for (const name of readdirSync(path.join(PROJECT_ROOT, 'migrations'))) {
    if (/^00[1-8]_/.test(name)) cpSync(path.join(PROJECT_ROOT, 'migrations', name), path.join(legacyDir, name));
  }
  const db = openDatabase(loadConfig({ DATA_DIR: dir }));
  try {
    const result = runMigrations(db, legacyDir);
    assert.equal(result.version, 8, '前置：只跑到 008 ⇒ v8（009 还没应用）');
    const info = db
      .prepare(
        'insert into prompts (title, user_prompt, system_prompt, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run(LEGACY_ROW.title, LEGACY_ROW.user_prompt, LEGACY_ROW.system_prompt, LEGACY_ROW.notes, NOW, NOW);
    return { dir, id: Number(info.lastInsertRowid) };
  } finally {
    db.close();
  }
}

function triggerCount(db: ReturnType<typeof openDatabase>, name = 'prompts_fts_au'): number {
  const row = db
    .prepare("select count(*) as n from sqlite_master where type = 'trigger' and name = ?")
    .get(name) as { n: number };
  return row.n;
}

test('AC-130 ①：新增迁移 009 重建带 WHEN 的 AFTER UPDATE 触发器，且 001_init.sql 一字未改', () => {
  const files = readdirSync(path.join(PROJECT_ROOT, 'migrations'))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .sort();
  assert.equal(files.length, 9, `迁移数应为 9（实测 ${String(files.length)}：${files.join(', ')}）`);
  assert.equal(files.at(-1), '009_fts-update-when.sql');

  // 断言的是**剥掉注释后的代码**：WHEN 子句必须真的在 SQL 里，不能只是注释里写了
  const migration = readSource('migrations/009_fts-update-when.sql');
  assert.match(migration, /DROP TRIGGER IF EXISTS prompts_fts_au/, '必须先 DROP 旧触发器（幂等的关键）');
  assert.match(migration, /CREATE TRIGGER prompts_fts_au AFTER UPDATE ON prompts/, '再重建同名触发器');
  assert.match(migration, /WHEN old\.title IS NOT new\.title/);
  assert.match(migration, /OR old\.user_prompt IS NOT new\.user_prompt/);
  assert.match(migration, /OR old\.system_prompt IS NOT new\.system_prompt/);
  assert.match(migration, /OR old\.notes IS NOT new\.notes/);

  // 已应用的迁移不许改（AGENTS.md 硬规矩）：001 里那份仍是**无 WHEN** 的原样
  const init = readSource('migrations/001_init.sql');
  assert.match(init, /CREATE TRIGGER IF NOT EXISTS prompts_fts_au AFTER UPDATE ON prompts BEGIN/);
  assert.doesNotMatch(init, /WHEN old\./, '001_init.sql 是已应用的迁移，不许被改（FR-140 ①）');
  // 另外两个触发器不在本条的改动范围内（FR-140 ② 明确不做）
  assert.match(init, /CREATE TRIGGER IF NOT EXISTS prompts_fts_ai AFTER INSERT ON prompts BEGIN/);
  assert.match(init, /CREATE TRIGGER IF NOT EXISTS prompts_fts_ad AFTER DELETE ON prompts BEGIN/);
});

test('AC-130 ②：迁移在已有数据的库上执行后，改 4 个被索引列之一随后能真搜到新内容', async () => {
  const { dir, id } = makeLegacyDb();
  // 复用同一个 DATA_DIR ⇒ 应用启动时会在这份"已有数据"的库上应用 009
  const fx = await makeFixture({}, { dir });
  try {
    const cookie = cookieOf(await login(fx.app));

    // 前置：应用启动时真的在这份**已有数据**的库上应用了 009（直查库，不看回包猜）
    const version = readDb(fx, (db) => {
      const row = db.prepare('select max(version) as v from schema_migrations').get() as { v: number };
      return row.v;
    });
    assert.equal(version, 9, '复用既有 DATA_DIR 启动后，009 应已应用 ⇒ schema v9');

    const cases: Array<{ field: keyof typeof LEGACY_ROW; next: string }> = [
      { field: 'title', next: '新标甲' },
      { field: 'user_prompt', next: '新正乙' },
      { field: 'system_prompt', next: '新系丙' },
      { field: 'notes', next: '新注丁' },
    ];
    const search = async (q: string): Promise<{ total: number; items: Array<{ id: number }> }> => {
      const response = await fx.app.inject({
        method: 'GET',
        url: `/api/prompts?q=${encodeURIComponent(q)}`,
        headers: { cookie },
      });
      assert.equal(response.statusCode, 200);
      return response.json() as { total: number; items: Array<{ id: number }> };
    };

    const current: Record<string, string> = { ...LEGACY_ROW };
    for (const item of cases) {
      const put = await fx.app.inject({
        method: 'PUT',
        url: `/api/prompts/${String(id)}`,
        headers: { cookie },
        payload: { [item.field]: item.next },
      });
      assert.equal(put.statusCode, 200, `改 ${item.field} 应 200（实测 ${String(put.statusCode)}）`);
      current[item.field] = item.next;

      // ① 新内容必须能搜到（真检索，不是看触发器定义）
      const hit = await search(item.next);
      assert.equal(hit.total, 1, `改 ${item.field} 后应能搜到新内容「${item.next}」（实测 total=${String(hit.total)}）`);
      assert.equal(hit.items[0]?.id, id);

      // ② 这一列的旧内容必须搜不到（索引里那行被换掉了）
      const stale = await search(LEGACY_ROW[item.field]);
      assert.equal(stale.total, 0, `改 ${item.field} 后，该列的旧内容「${LEGACY_ROW[item.field]}」不该再命中`);

      // ③ 其余三列的**当前值**都还得在索引里（改一列不该把别的列搞丢）
      for (const [field, value] of Object.entries(current)) {
        if (field === item.field) continue;
        const kept = await search(value);
        assert.equal(kept.total, 1, `只改了 ${item.field}，${field} 的当前值「${value}」必须还能搜到`);
      }
    }
  } finally {
    await fx.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-130 ③：改非索引列不触发重建（total_changes 口径，含"这个口径看得见重建"的对照）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-s68-changes-'));
  const db = openDatabase(loadConfig({ DATA_DIR: dir }));
  try {
    const result = runMigrations(db);
    assert.equal(result.version, 9);
    const info = db
      .prepare(
        'insert into prompts (title, user_prompt, system_prompt, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run('标题甲', '正文甲', '系统甲', '备注甲', NOW, NOW);
    const id = Number(info.lastInsertRowid);

    /**
     * `total_changes()` = 本连接自打开以来**被修改的行数**（含触发器改的行）⇒ 它是"重建有没有发生"的
     * 可观测代理：不重建 ⇒ 只有 prompts 那一行（1）；重建 ⇒ prompts + FTS delete + insert + shadow 写入（9）。
     */
    const delta = (sql: string): number => {
      const before = (db.prepare('select total_changes() as n').get() as { n: number }).n;
      db.prepare(sql).run();
      const after = (db.prepare('select total_changes() as n').get() as { n: number }).n;
      return after - before;
    };

    // ① 非索引列：只有 prompts 自己那 1 行
    assert.equal(delta(`update prompts set favorite = 1 where id = ${String(id)}`), 1, 'favorite 不该触发 FTS 重建');
    assert.equal(delta(`update prompts set sort_order = 7 where id = ${String(id)}`), 1, 'sort_order 不该触发 FTS 重建');
    assert.equal(
      delta(`update prompts set remember_variables = 0 where id = ${String(id)}`),
      1,
      'remember_variables 不该触发 FTS 重建',
    );
    assert.equal(delta(`update prompts set updated_at = '${NOW}' where id = ${String(id)}`), 1, 'updated_at 不该触发 FTS 重建');

    // ② 索引列：prompts + FTS delete + insert（9 行）
    assert.equal(delta(`update prompts set title = '标题乙' where id = ${String(id)}`), 9, 'title 变了必须重建');
    assert.equal(delta(`update prompts set user_prompt = '正文乙' where id = ${String(id)}`), 9, 'user_prompt 变了必须重建');
    assert.equal(delta(`update prompts set system_prompt = '系统乙' where id = ${String(id)}`), 9, 'system_prompt 变了必须重建');
    assert.equal(delta(`update prompts set notes = '备注乙' where id = ${String(id)}`), 9, 'notes 变了必须重建');
    // 写回同样的值 = 没变化 ⇒ 不重建（WHEN 是"真的变了"，不是"被 UPDATE 语句碰到"）
    assert.equal(delta(`update prompts set title = '标题乙' where id = ${String(id)}`), 1, '值没变不该重建');

    // ③ 对照：把 001 的旧触发器（无 WHEN）装回去 ⇒ 同一口径立刻变 9，证明上面不是"恒为 1 的假绿"
    db.exec('DROP TRIGGER prompts_fts_au');
    db.exec(LEGACY_AU_TRIGGER);
    assert.equal(
      delta(`update prompts set favorite = 0 where id = ${String(id)}`),
      9,
      '对照：旧触发器下改 favorite 也会重建 ⇒ 本口径确实能看见重建',
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-130 ④⑤：_ai / _ad 行为不变；迁移幂等（重复执行不报错、触发器恰一个）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-s68-idem-'));
  const db = openDatabase(loadConfig({ DATA_DIR: dir }));
  try {
    const first = runMigrations(db);
    const second = runMigrations(db);
    assert.equal(first.version, 9);
    assert.equal(second.version, 9);
    assert.equal(second.applied.length, 0, '第二次执行不应重复应用迁移');
    assert.equal(triggerCount(db), 1, 'prompts_fts_au 应恰好一个');

    // 直接把 009 的 SQL 再执行两遍（幂等：DROP IF EXISTS + CREATE）
    const sql = readRaw('migrations/009_fts-update-when.sql');
    db.exec(sql);
    db.exec(sql);
    assert.equal(triggerCount(db), 1, '重复执行 009 不该产生第二个触发器');

    const definition = (
      db.prepare("select sql from sqlite_master where type = 'trigger' and name = 'prompts_fts_au'").get() as {
        sql: string;
      }
    ).sql;
    assert.match(definition, /WHEN old\.title IS NOT new\.title/, '库里生效的定义必须带 WHEN');

    // _ai：INSERT 仍进索引；_ad：DELETE 仍清索引
    const match = (q: string): number =>
      (db.prepare('select count(*) as n from prompts_fts where prompts_fts match ?').get(`"${q}"`) as { n: number }).n;
    const info = db
      .prepare(
        'insert into prompts (title, user_prompt, system_prompt, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run('插入索引甲', '', '', '', NOW, NOW);
    const id = Number(info.lastInsertRowid);
    assert.equal(match('插入索引甲'), 1, 'INSERT 后应命中（_ai 未变）');
    db.prepare('delete from prompts where id = ?').run(id);
    assert.equal(match('插入索引甲'), 0, 'DELETE 后不应命中（_ad 未变）');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
