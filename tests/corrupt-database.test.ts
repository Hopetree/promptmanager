/**
 * 常驻回归（阶段 73 / FR-160 / AC-135 A4）—— 「库损坏可诊断」。
 *
 * 为什么要有这条（N24 指出的失败注入缺口：没有损坏/截断库的用例）：
 * 只有"文件根本不是 SQLite 库"或"库被截断"这类输入才会走 `enableWal` 的异常分支，
 * 而阶段 72 加的重试循环把**任何**异常都当成"库被另一个进程独占" ⇒ 损坏的库被误报成
 * 「请确认没有卡住的实例（或等它结束）」，运维照着这条提示永远修不好。
 *
 * 判据：报错必须**点名文件 + 说明是损坏**、不许谎称被占用、不许把裸 SQLite 文本直接抛给用户，
 * 且原始错误保留在 `cause` 里供诊断。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareDatabase } from '../dist/db/index.js';
import { PROJECT_ROOT } from './source-text.ts';

const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'migrations');

/** 打开（并迁移）一个 DATA_DIR；成功返回 null，抛错返回那个错误。 */
function captureOpenError(dataDir: string): unknown {
  try {
    const prepared = prepareDatabase({ dataDir, migrationsDir: MIGRATIONS_DIR });
    prepared.db.close();
    return null;
  } catch (error) {
    return error;
  }
}

function assertDiagnosable(error: unknown, label: string): void {
  assert.ok(error !== null, `${label}：打开损坏的库必须报错，不许静默继续`);
  const message = error instanceof Error ? error.message : String(error);
  assert.match(message, /pm\.db/, `${label}：报错要点名是哪个文件 —— ${message}`);
  assert.match(message, /损坏|不是有效的 SQLite/, `${label}：报错要说明「库坏了」 —— ${message}`);
  assert.doesNotMatch(
    message,
    /独占|被其它进程占用|并行启动/,
    `${label}：不许把损坏误报成「被占用」 —— ${message}`,
  );
  assert.doesNotMatch(
    message,
    /SQLITE_|file is not a database|malformed/i,
    `${label}：不许把裸 SQLite 文本直接抛给用户 —— ${message}`,
  );
  assert.ok(error instanceof Error && error.cause !== undefined, `${label}：原始错误必须留在 cause 里`);
}

test('AC-135 A4：库文件不是 SQLite 库 ⇒ 报错可诊断（点名文件、说清损坏、不谎称被占用）', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pm-corrupt-text-'));
  writeFileSync(path.join(dataDir, 'pm.db'), 'this is not a sqlite database at all, just text');
  assertDiagnosable(captureOpenError(dataDir), '非 SQLite 文件');
});

test('AC-135 A4：库文件被截断（SQLITE_CORRUPT）⇒ 同样是可诊断报错', () => {
  // 先造一个真库（跑完迁移），再截断前 200 字节 —— SQLite 读页头时会报 SQLITE_CORRUPT
  const goodDir = mkdtempSync(path.join(os.tmpdir(), 'pm-good-'));
  const prepared = prepareDatabase({ dataDir: goodDir, migrationsDir: MIGRATIONS_DIR });
  prepared.db.close();

  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pm-corrupt-trunc-'));
  const bytes = readFileSync(path.join(goodDir, 'pm.db'));
  writeFileSync(path.join(dataDir, 'pm.db'), bytes.subarray(0, 200));
  assertDiagnosable(captureOpenError(dataDir), '截断的库');
});
