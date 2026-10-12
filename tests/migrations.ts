// 迁移数与 schema 版本的**单一来源**（阶段 69 / BRIEF FR-145 / AC-131 B）。
//
// 为什么存在：过去「当前 schema 版本」被手写在 9 个测试文件里、迁移文件数被写在 3 个里，
// 每加一个迁移都要逐个改（阶段 68 新增 009 时，机械重复部分横跨十来个文件）——抄漏一处就是静默不一致。
//
// 现在的分工（**一处绊线，其余派生**）：
//   - `CURRENT_SCHEMA_VERSION` 是**唯一手写的数字**，它的作用就是绊线：迁移数变了要有人知道；
//   - 其余全部从 `migrations/` 目录派生（文件名即事实），测试之间不再互相抄数字。
//
// ⚠️ 新增一个迁移时，**只改下面这一处**（外加迁移文件本身与 4 处文档）。
// ⚠️ 本文件不是 `*.test.ts`（测试文件计数只数 `*.test.ts`），不会被单独执行。
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './source-text.ts';

/** ⚠️ 唯一手写的绊线：新增迁移时只改这一处（阶段 69 起是 010_migration-checksums.sql ⇒ v10）。 */
export const CURRENT_SCHEMA_VERSION = 10;

/** 目录里真实的迁移文件（按版本号升序）——「迁移数」不再手写，就是它的长度。 */
export const MIGRATION_FILES: readonly string[] = readdirSync(path.join(PROJECT_ROOT, 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** 迁移文件数（= 当前 schema 版本，因为编号从 001 起连续）。 */
export const MIGRATION_COUNT = MIGRATION_FILES.length;

/** 目录里最后一个迁移文件。 */
export const LATEST_MIGRATION = MIGRATION_FILES[MIGRATION_FILES.length - 1] ?? '';

/** 迁移文件名 → 版本号（三位数字前缀）。 */
export function migrationVersion(file: string): number {
  return Number.parseInt(file, 10);
}

/** 目录里所有迁移的版本号（升序）。 */
export const MIGRATION_VERSIONS: readonly number[] = MIGRATION_FILES.map(migrationVersion);
