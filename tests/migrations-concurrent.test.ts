// 阶段 72 / BRIEF FR-158 / AC-134 D14（N4）：**迁移并发**必须"互斥"或"可读可重试"。
//
// 缺陷原状：`runMigrations` 在锁**外**读已应用版本集合（`done`），再逐个 `db.transaction(...)` 应用。
// 两个进程同时打开同一个空 DATA_DIR 时，双方都以为"还没应用" ⇒ 后到者会重放迁移 SQL，
// 报出裸 SQLite 文本（`table … already exists` / `duplicate column name` / `UNIQUE constraint failed:
// schema_migrations.version`），运维看到的是数据库方言而不是"该怎么办"。
//
// 本文件用**真实子进程**并发跑迁移（不是 mock）：每个 worker 先就绪、再由测试统一放行，
// 保证它们几乎同时进入 `prepareDatabase`。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { MIGRATION_COUNT } from './migrations.ts';

const DB_INDEX_URL = pathToFileURL(path.join(fileURLToPath(new URL('..', import.meta.url)), 'dist/db/index.js')).href;
const REPO_MIGRATIONS = path.join(fileURLToPath(new URL('..', import.meta.url)), 'migrations');
// 临时目录里我**自己**放两条迁移；版本号从条数推出来，不写死 `vN`（AC-131 B6/B7：加一个迁移不该改这个文件）。
const FAKE_MIGRATION_COUNT = 2;
const fakeVersion = new RegExp('ok: schema at v' + String(FAKE_MIGRATION_COUNT));
const realVersion = new RegExp('ok: schema at v' + String(MIGRATION_COUNT));

const WORKER = `
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const { prepareDatabase } = await import(process.env.AC_DB_INDEX);
// 屏障：先报到，再等测试放行 —— 保证所有 worker 几乎同时开始迁移
writeFileSync(process.env.AC_READY, '');
while (!existsSync(process.env.AC_GO)) await sleep(5);
try {
  const { migration } = prepareDatabase({ dataDir: process.env.AC_DATA, migrationsDir: process.env.AC_MIGRATIONS });
  process.stdout.write('ok: schema at v' + String(migration.version) + '\\n');
} catch (error) {
  process.stderr.write('error: ' + (error instanceof Error ? error.message : String(error)) + '\\n');
  process.exitCode = 1;
}
`;

interface WorkerResult {
  code: number | null;
  out: string;
  err: string;
}

function runWorker(workerPath: string, env: Record<string, string>): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerPath], {
      // AGENTS.md 陷阱 4：测试里起的子进程必须 detached，否则会被进程组清理带走
      detached: true,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** 起 N 个 worker，等它们全部就绪后放行，再收集结果。 */
async function raceMigrations(
  workDir: string,
  dataDir: string,
  migrationsDir: string,
  count: number,
): Promise<WorkerResult[]> {
  const workerPath = path.join(workDir, 'migrate-worker.mjs');
  writeFileSync(workerPath, WORKER, 'utf8');
  const goFile = path.join(workDir, `go-${String(Date.now())}`);
  const readyFiles = Array.from({ length: count }, (_, index) => path.join(workDir, `ready-${String(index)}`));
  const children = readyFiles.map((readyFile) =>
    runWorker(workerPath, {
      AC_DB_INDEX: DB_INDEX_URL,
      AC_DATA: dataDir,
      AC_MIGRATIONS: migrationsDir,
      AC_GO: goFile,
      AC_READY: readyFile,
    }),
  );
  // 条件轮询等"全部就绪"（有超时保护），不盲等固定时长
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !readyFiles.every((file) => existsSync(file))) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(readyFiles.every((file) => existsSync(file)), '有 worker 没能在超时内就绪');
  writeFileSync(goFile, '');
  return Promise.all(children);
}

const RAW_SQLITE = /SQLITE_|constraint failed|duplicate column name|already exists/i;

test('AC-134 D14：两个以上进程并发跑同一 DATA_DIR 的迁移 —— 互斥且无裸 SQLite 文本', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'pm-mig-race-'));
  const dataDir = path.join(workDir, 'data');
  const migrationsDir = path.join(workDir, 'migrations');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(migrationsDir, { recursive: true });
  // 故意放一条**慢且不幂等**的迁移：并发窗口足够宽，旧实现必然重放它
  writeFileSync(
    path.join(migrationsDir, '001_slow.sql'),
    `CREATE TABLE slow_probe (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200000)
INSERT INTO slow_probe (payload) SELECT 'x' || n FROM seq;
`,
    'utf8',
  );
  writeFileSync(path.join(migrationsDir, '002_marker.sql'), 'CREATE TABLE slow_marker (id INTEGER PRIMARY KEY);\n', 'utf8');
  try {
    const results = await raceMigrations(workDir, dataDir, migrationsDir, 4);
    for (const result of results) {
      assert.equal(result.code, 0, `并发迁移必须成功（互斥或可重试），实际失败：${result.err || result.out}`);
      assert.doesNotMatch(result.out + result.err, RAW_SQLITE, `不许把裸 SQLite 文本抛给用户：${result.err}`);
    }
    const okCount = results.filter((result) => fakeVersion.test(result.out)).length;
    assert.equal(
      okCount,
      results.length,
      `每个进程都该报出最终版本 v${String(FAKE_MIGRATION_COUNT)}：${results.map((r) => r.out).join(' | ')}`,
    );
    const db = new Database(path.join(dataDir, 'pm.db'), { readonly: true });
    try {
      const rows = db.prepare('SELECT COUNT(*) AS n FROM slow_probe').get() as { n: number };
      assert.equal(rows.n, 200000, '迁移只该被应用一次（数据不许翻倍）');
      const version = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number };
      assert.equal(version.v, FAKE_MIGRATION_COUNT);
    } finally {
      db.close();
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('AC-134 D14：真实 migrations/ 目录并发迁移同样安全（端到端）', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'pm-mig-real-'));
  const dataDir = path.join(workDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  try {
    const results = await raceMigrations(workDir, dataDir, REPO_MIGRATIONS, 4);
    for (const result of results) {
      assert.equal(result.code, 0, `真实目录并发迁移失败：${result.err || result.out}`);
      assert.doesNotMatch(result.out + result.err, RAW_SQLITE, `不许把裸 SQLite 文本抛给用户：${result.err}`);
      assert.match(result.out, realVersion, `应报到 v${String(MIGRATION_COUNT)}：${result.out}`);
    }
    const db = new Database(path.join(dataDir, 'pm.db'), { readonly: true });
    try {
      const rows = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
      assert.equal(rows.n, MIGRATION_COUNT, '每个迁移只该有一条记录');
    } finally {
      db.close();
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
