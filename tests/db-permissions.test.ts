// 阶段 72 / BRIEF FR-155 / AC-134 A1~A6（N1）：数据库文件必须是 0600 —— 新建、既有、服务、容器四条路径都要成立。
//
// 为什么值得一条常驻测试：库里装着**全部提示词正文 + 口令哈希 + 令牌密文**，而同仓库其它敏感文件
// （token-enc.key / 导出文件 / 快照）早就是 0600 —— 只有 SQLite 文件例外（`new Database()` 落 umask）。
// 这条测试同时钉住三件事：①新建库 600 ②已存在的 0644 库在下次打开/迁移时被收紧 ③WAL 的 `-wal`/`-shm` 也是 600
// （SQLite 自己建这两个文件时固定 0644，所以必须在它建完之后收紧）。
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertCliOk, makeTempDir, removeTempDir, runCliProcess } from './helpers.ts';

/** 文件权限（八进制字符串，如 '600'）；文件不存在返回 'absent'。 */
function modeOf(file: string): string {
  if (!existsSync(file)) return 'absent';
  return (statSync(file).mode & 0o777).toString(8);
}

function dbFiles(dir: string): { db: string; wal: string; shm: string } {
  const db = path.join(dir, 'pm.db');
  return { db, wal: `${db}-wal`, shm: `${db}-shm` };
}

test('AC-134 A1：CLI migrate 新建的库是 0600（哪怕进程 umask 是 000）', async () => {
  const dir = makeTempDir('pm-db-perm-');
  const previous = process.umask(0o000);
  try {
    const res = await runCliProcess(['migrate'], { dataDir: dir });
    assertCliOk(res, 'AC-134 A1：migrate');
    const files = dbFiles(dir);
    assert.equal(modeOf(files.db), '600', `新建的 pm.db 不是 0600：${modeOf(files.db)}`);
    // `-wal`/`-shm` 在 migrate 结束后通常已被 checkpoint 掉；存在就必须是 600
    for (const file of [files.wal, files.shm]) {
      const mode = modeOf(file);
      assert.ok(mode === '600' || mode === 'absent', `${path.basename(file)} 权限不对：${mode}`);
    }
  } finally {
    process.umask(previous);
    removeTempDir(dir);
  }
});

test('AC-134 A2：已存在的 0644 库在下次 migrate 时被收紧到 0600', async () => {
  const dir = makeTempDir('pm-db-perm-');
  try {
    const files = dbFiles(dir);
    assertCliOk(await runCliProcess(['migrate'], { dataDir: dir }), 'A2：第一次 migrate');
    chmodSync(files.db, 0o644); // 模拟"历史遗留的 0644 库"
    assert.equal(modeOf(files.db), '644', '前置：库应为 0644');
    assertCliOk(await runCliProcess(['migrate'], { dataDir: dir }), 'A2：第二次 migrate');
    assert.equal(modeOf(files.db), '600', `已存在的 0644 库没有被收紧：${modeOf(files.db)}`);
  } finally {
    removeTempDir(dir);
  }
});

test('AC-134 A3：服务启动路径（prepareDatabase）同样是 0600，含 -wal/-shm', async () => {
  const dir = makeTempDir('pm-db-perm-');
  try {
    const { loadConfig } = await import('../dist/config.js');
    const { prepareDatabase } = await import('../dist/db/index.js');
    const config = loadConfig({ DATA_DIR: dir });
    const { db, qe } = prepareDatabase(config);
    const files = dbFiles(dir);
    try {
      assert.equal(modeOf(files.db), '600', `服务路径的 pm.db 不是 0600：${modeOf(files.db)}`);
      // 写一笔（真实服务启动后必然发生）—— WAL 两个文件此刻存在，也必须 600
      db.exec('BEGIN IMMEDIATE; COMMIT');
      for (const file of [files.wal, files.shm]) {
        assert.ok(existsSync(file), `${path.basename(file)} 应已存在（WAL 已启用）`);
        assert.equal(modeOf(file), '600', `${path.basename(file)} 不是 0600：${modeOf(file)}`);
      }
    } finally {
      await qe.destroy();
    }
  } finally {
    removeTempDir(dir);
  }
});

test('AC-134 A4：容器形态同一路径（Dockerfile 未设 UMASK ⇒ 由代码收紧，不靠 umask）', async () => {
  const dir = makeTempDir('pm-db-perm-');
  const previous = process.umask(0o000);
  try {
    const { loadConfig } = await import('../dist/config.js');
    const { prepareDatabase } = await import('../dist/db/index.js');
    const { qe } = prepareDatabase(loadConfig({ DATA_DIR: dir }));
    await qe.destroy();
    assert.equal(modeOf(dbFiles(dir).db), '600', 'umask 000 下仍必须是 0600');
  } finally {
    process.umask(previous);
    removeTempDir(dir);
  }
});

test('AC-134 A5：本来就 0600 的敏感文件不许回退（token-enc.key）', async () => {
  const dir = makeTempDir('pm-db-perm-');
  try {
    const { loadConfig } = await import('../dist/config.js');
    const { resolveTokenKey, TOKEN_ENC_KEY_FILE } = await import('../dist/services/token-crypto.js');
    resolveTokenKey(loadConfig({ DATA_DIR: dir }), {});
    const key = path.join(dir, TOKEN_ENC_KEY_FILE);
    assert.equal(modeOf(key), '600', `token-enc.key 权限回退了：${modeOf(key)}`);
  } finally {
    removeTempDir(dir);
  }
});

test('AC-134 A2 补充：openDatabase 直接打开一个 0644 库也当场收紧（不经迁移）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-db-perm-'));
  try {
    const files = dbFiles(dir);
    // 造一个 0644 的库文件（不走 openDatabase）
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(files.db);
    raw.exec('CREATE TABLE t(a)');
    raw.close();
    chmodSync(files.db, 0o644);
    assert.equal(modeOf(files.db), '644', '前置：库应为 0644');

    const { loadConfig } = await import('../dist/config.js');
    const { openDatabase } = await import('../dist/db/index.js');
    const db = openDatabase(loadConfig({ DATA_DIR: dir }));
    try {
      assert.equal(modeOf(files.db), '600', `openDatabase 没有收紧既有库：${modeOf(files.db)}`);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-134 A1 补充：DATA_DIR 布局不变（pm.db 仍在数据目录根、media/ 仍被创建）', async () => {
  const dir = makeTempDir('pm-db-perm-');
  try {
    const { loadConfig } = await import('../dist/config.js');
    const { openDatabase } = await import('../dist/db/index.js');
    const db = openDatabase(loadConfig({ DATA_DIR: dir }));
    db.close();
    assert.ok(existsSync(path.join(dir, 'pm.db')), 'pm.db 必须仍在 DATA_DIR 根目录');
    assert.ok(existsSync(path.join(dir, 'media')), 'media/ 仍要被创建');
    // 目录里不允许出现别的新文件（不许改布局）
    const { readdirSync } = await import('node:fs');
    const names = readdirSync(dir).filter((name) => !name.startsWith('pm.db')).sort();
    assert.deepEqual(names, ['media'], `DATA_DIR 布局变了：${names.join(', ')}`);
  } finally {
    removeTempDir(dir);
  }
});
