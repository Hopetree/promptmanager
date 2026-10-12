// 阶段 69 / BRIEF FR-145（评审 F12）+ FR-146（评审 F13）/ AC-131 B、C 组。
//
// 本文件把两件事变成**机械可验**的断言：
//   B 组：schema 版本 / 迁移数只在 `tests/migrations.ts` 手写**一处**，其余从 `migrations/` 目录派生；
//        并且**绊线仍在**（删迁移、改版本号都必须让测试变红）。
//   C 组：体积预算改成「账本 JSON + 纯函数判定」后，**下界与上界都查**（体积被改小同样红），
//        `ACCOUNTED_DELTA` 常量归零，测试标题与账本同源。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetStages, budgetTotal, evaluateBundleBudget, readBundleBudget } from './bundle-budget.ts';
import {
  CURRENT_SCHEMA_VERSION,
  LATEST_MIGRATION,
  MIGRATION_COUNT,
  MIGRATION_FILES,
  MIGRATION_VERSIONS,
} from './migrations.ts';
import { readSource, sourceFiles } from './source-text.ts';

const LEDGER = readBundleBudget();
const BUDGET = budgetTotal(LEDGER);
const FLOOR = Math.floor(BUDGET * LEDGER.floor_ratio);

/** 迁移集合的自洽问题（空数组 = 自洽）。删除 / 新增迁移、改版本号都会让它非空。 */
function consistencyProblems(files: readonly string[], version: number): string[] {
  const problems: string[] = [];
  if (files.length !== version) {
    problems.push(`迁移文件数 ${String(files.length)} ≠ 当前 schema 版本 ${String(version)}`);
  }
  files.forEach((file, index) => {
    const parsed = Number.parseInt(file, 10);
    if (parsed !== index + 1) {
      problems.push(`第 ${String(index + 1)} 个迁移的版本号是 ${String(parsed)}（不连续）`);
    }
  });
  return problems;
}

test('AC-131 B6：schema 版本 / 迁移数只在一处手写，其余全部从 migrations/ 目录派生', () => {
  // 目录是事实来源
  assert.equal(MIGRATION_COUNT, MIGRATION_FILES.length);
  assert.equal(LATEST_MIGRATION, MIGRATION_FILES[MIGRATION_FILES.length - 1]);
  assert.deepEqual(
    [...MIGRATION_VERSIONS],
    Array.from({ length: MIGRATION_COUNT }, (_unused, index) => index + 1),
    '迁移编号必须从 001 起连续',
  );

  // 唯一手写处就是绊线本身
  const hardcoded = sourceFiles('tests').filter((file) => /CURRENT_SCHEMA_VERSION\s*=\s*\d+/.test(file.text));
  assert.deepEqual(
    hardcoded.map((file) => file.rel),
    ['tests/migrations.ts'],
    '「当前 schema 版本」只允许在 tests/migrations.ts 手写一处；别处必须 import 常量',
  );

  // 没有人再抄一份迁移清单或写死 `schema at vN`
  const copied = sourceFiles('tests').filter(
    (file) => file.rel !== 'tests/migrations.ts' && /(?<![A-Z_])MIGRATION_FILES\s*=|schema at v\d/.test(file.text),
  );
  assert.deepEqual(copied.map((file) => file.rel), [], '迁移清单/版本号不许在别处再抄一份（阶段 63 曾抄过一次）');
});

test('AC-131 B7：加一个迁移要改的测试文件数 = 1（只有 tests/migrations.ts 的绊线）', () => {
  // 「要改」= 文件里含**当前版本/迁移数的字面量**（改一处就得跟着改的地方）。
  const needsEdit = sourceFiles('tests')
    .filter((file) => /CURRENT_SCHEMA_VERSION\s*=\s*\d+|(?<![A-Z_])MIGRATION_FILES\s*=|schema at v\d/.test(file.text))
    .map((file) => file.rel);
  assert.deepEqual(
    needsEdit,
    ['tests/migrations.ts'],
    `加一个迁移只需改 tests/migrations.ts 一处；实测要改的文件：${needsEdit.join(' / ')}`,
  );
  assert.equal(MIGRATION_COUNT, CURRENT_SCHEMA_VERSION, '迁移数必须等于当前版本（编号连续）');
});

test('AC-131 B8：绊线仍在 —— 删一个迁移文件、改版本号，都必须让断言变红', () => {
  assert.deepEqual(consistencyProblems(MIGRATION_FILES, CURRENT_SCHEMA_VERSION), [], '当前仓库必须自洽');

  const deleted = MIGRATION_FILES.slice(0, -1);
  assert.notDeepEqual(
    consistencyProblems(deleted, CURRENT_SCHEMA_VERSION),
    [],
    '删掉一个迁移文件后必须能发现（否则绊线就白留了）',
  );

  assert.notDeepEqual(
    consistencyProblems(MIGRATION_FILES, CURRENT_SCHEMA_VERSION + 1),
    [],
    '把版本号改大后必须能发现',
  );

  // 绊线的另一半：已应用的迁移被改动，由 tests/stage69-migration-checksums.test.ts 的冻结指纹盯着。
  assert.match(
    readSource('tests/stage69-migration-checksums.test.ts'),
    /FROZEN_APPLIED_DIGEST/,
    '已应用迁移的内容指纹必须留在测试里（改一个字节就红）',
  );
});

test('AC-131 C9/C10：体积预算上界与下界都查（人为改小 / 超出预算都必须红）', () => {
  assert.ok(FLOOR < BUDGET, '下界必须低于上界');
  assert.ok(LEDGER.floor_ratio > 0 && LEDGER.floor_ratio < 1, 'floor_ratio 必须是 (0,1) 内的小数');

  const within = evaluateBundleBudget(BUDGET, LEDGER);
  assert.equal(within.ok, true, '正好等于上界算通过');
  assert.equal(evaluateBundleBudget(FLOOR, LEDGER).ok, true, '正好等于下界算通过');

  const over = evaluateBundleBudget(BUDGET + 1, LEDGER);
  assert.equal(over.ok, false, '超预算必须红');
  assert.match(over.message, /超过预算/, '超预算要给上界提示');

  const shrunk = evaluateBundleBudget(FLOOR - 1, LEDGER);
  assert.equal(shrunk.ok, false, '体积被人为改小到下界以下必须红（这是本阶段新增的下界）');
  assert.match(shrunk.message, /低于下界/, '下界失败要给"账本该回收了"的提示');
  assert.match(shrunk.message, /--record/, '下界失败必须指向记账工具');
});

test('AC-131 C11：ACCOUNTED_DELTA 常量归零，账本改成 JSON + 工具生成', () => {
  const source = readSource('tests/stage18-bundle.test.ts');
  assert.equal(
    [...source.matchAll(/ACCOUNTED_DELTA/g)].length,
    0,
    '手工累加的增量常量必须全部退休（改前 20 个）',
  );
  assert.equal([...source.matchAll(/BASELINE_TOTAL_GZIP/g)].length, 0, '基线也搬进账本 JSON');
  assert.match(source, /readBundleBudget\(\)/, '预算必须从账本读');
  assert.match(source, /evaluateBundleBudget\(/, '判定必须走纯函数');

  assert.ok(LEDGER.entries.length >= 20, '账本必须保留历史各阶段的增量记录');
  for (const entry of LEDGER.entries) {
    assert.ok(entry.id.length > 0, '账本每条都要有 id');
    assert.ok(Number.isInteger(entry.delta), `账本 ${entry.id} 的 delta 必须是整数`);
    assert.ok(entry.note.length > 20, `账本 ${entry.id} 必须有可读依据（note）`);
  }
  assert.match(readSource('tests/bundle-budget.json'), /--record/, '账本要写明用工具记账，不要手改');
});

test('AC-131 C12：测试标题与账本同源（阶段清单从账本派生，不再手写）', () => {
  const source = readSource('tests/stage18-bundle.test.ts');
  assert.match(
    source,
    /AC-61 ⑤：总 gzip 在账本区间内（上界与下界都查；账本阶段：\$\{STAGES\}）/,
    '标题里的阶段清单必须由账本派生',
  );
  assert.equal(budgetStages(LEDGER), LEDGER.entries.map((entry) => String(entry.stage)).join(' / '));
  assert.match(budgetStages(LEDGER), /18/, '账本至少覆盖阶段 18 的基线增量');

  // D-67 ④：只改记账方式，**不许放宽红线**
  assert.match(source, /const MAX_CHUNK_BYTES = 500_000;/, '500 KB 红线必须原样保留');
  assert.match(readSource('tools/ci-check.sh'), /MAX_CHUNK_BYTES=500000/, 'ci-check 的红线也必须原样保留');
});
