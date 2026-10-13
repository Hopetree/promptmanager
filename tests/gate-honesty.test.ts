// 阶段 73 / BRIEF FR-161（评审 N22 / N25 / N26）/ AC-135 B6、B7、B8。
//
// 门禁的**诚实性**：一个门禁如果自己骗人，比没有门禁更糟。本文件钉住三件事：
//   B6 预算与实测分离：`budget_total_gzip` 是人工设定的上界，`--record` 只追加实测列，不许动预算；
//      实测超预算时 `--record` 必须**拒绝**，抬预算只能走显式 `--raise-budget`。
//   B7 `SKIP_TEST=1` 跳过测试 ≠ 通过：④ 按失败记，汇总横幅换成"未全部执行"，退出码 1。
//   B8 体积门禁覆盖 js **与** css（单文件上限此前只看 .js）。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  budgetTotal,
  evaluateBundleBudget,
  lastMeasuredTotal,
  readBundleBudget,
  type BundleBudget,
} from './bundle-budget.ts';
import { PROJECT_ROOT, readSource } from './source-text.ts';

const LEDGER = readBundleBudget();
const LEDGER_PATH = path.join(PROJECT_ROOT, 'tests', 'bundle-budget.json');
const TOOL = path.join(PROJECT_ROOT, 'tools', 'bundle-budget.mjs');

/** 账本 → 深拷贝（测试改副本，绝不动仓库里的账本）。 */
function cloneLedger(ledger: BundleBudget): BundleBudget {
  return JSON.parse(JSON.stringify(ledger)) as BundleBudget;
}

function runTool(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: PROJECT_ROOT });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('AC-135 B6：预算由人工设定、与实测分离（追加实测条目不许改变预算）', () => {
  assert.ok(
    Number.isInteger(LEDGER.budget_total_gzip) && LEDGER.budget_total_gzip > 0,
    'tests/bundle-budget.json 必须有显式的整数 budget_total_gzip（预算不再由实测派生）',
  );
  assert.equal(budgetTotal(LEDGER), LEDGER.budget_total_gzip, 'budgetTotal 只读显式预算字段');

  // 纯函数层面：往副本里追加/删掉实测条目，预算都不许动。
  const grown = cloneLedger(LEDGER);
  grown.entries.push({ id: 'STAGE99', stage: 99, delta: 12345, note: '测试用：这条不该影响预算' });
  assert.equal(budgetTotal(grown), budgetTotal(LEDGER), '追加实测条目不许改变预算');
  const shrunk = cloneLedger(LEDGER);
  shrunk.entries.pop();
  assert.equal(budgetTotal(shrunk), budgetTotal(LEDGER), '删掉实测条目也不许改变预算');

  // 预算必须留出余量（余量恒为 0 正是 N22 的病症）。
  const measured = lastMeasuredTotal(LEDGER);
  assert.ok(
    budgetTotal(LEDGER) > measured,
    `预算 ${String(budgetTotal(LEDGER))} B 必须高于上一笔实测 ${String(measured)} B —— 否则门禁没有预警余量`,
  );
  assert.equal(evaluateBundleBudget(budgetTotal(LEDGER), LEDGER).ok, true, '正好等于预算算通过');
  assert.match(
    evaluateBundleBudget(budgetTotal(LEDGER) + 1, LEDGER).message,
    /超过预算/,
    '超预算必须红，并指出预算是人工设定、要走显式 --raise-budget',
  );
  assert.match(evaluateBundleBudget(budgetTotal(LEDGER) + 1, LEDGER).message, /--raise-budget/, '超预算要指向显式抬预算路径');
});

test('AC-135 B6（实测）：--record 只追加实测列；抬预算必须显式 --raise-budget', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-budget-'));
  try {
    const tempLedger = path.join(dir, 'bundle-budget.json');
    copyFileSync(LEDGER_PATH, tempLedger);
    const before = JSON.parse(readFileSync(tempLedger, 'utf8')) as BundleBudget;
    const measured = lastMeasuredTotal(before);

    const recorded = runTool(['--ledger', tempLedger, '--record', '99', '--note', '测试用：只追加实测列，不许改预算']);
    assert.equal(recorded.status, 0, `--record 应当成功：${recorded.stdout}${recorded.stderr}`);
    const after = JSON.parse(readFileSync(tempLedger, 'utf8')) as BundleBudget;
    assert.equal(after.budget_total_gzip, before.budget_total_gzip, '--record 后预算本身必须不变');
    assert.equal(after.entries.length, before.entries.length + 1, '--record 应当只追加一条实测记录');
    assert.equal(after.entries.at(-1)?.stage, 99);
    assert.equal(lastMeasuredTotal(after), measured, '实测总量没变时，新增条目的 delta 应为 0');

    // 显式抬预算：唯一能改 budget_total_gzip 的路径。
    const raised = runTool([
      '--ledger', tempLedger,
      '--record', '99',
      '--note', '测试用：显式抬预算',
      '--raise-budget', String(measured + 1000),
    ]);
    assert.equal(raised.status, 0, `显式抬预算应当成功：${raised.stdout}${raised.stderr}`);
    assert.equal(
      (JSON.parse(readFileSync(tempLedger, 'utf8')) as BundleBudget).budget_total_gzip,
      measured + 1000,
      '只有显式 --raise-budget 才能改预算',
    );

    // "真增长走显式路径"：实测超预算且没给 --raise-budget ⇒ 拒绝（而不是默默抬上去）。
    const tiny = cloneLedger(LEDGER);
    tiny.budget_total_gzip = measured - 1;
    const tinyLedger = path.join(dir, 'tiny.json');
    writeFileSync(tinyLedger, `${JSON.stringify(tiny, null, 2)}\n`, 'utf8');
    const refused = runTool(['--ledger', tinyLedger, '--record', '99', '--note', '测试用：实测超预算']);
    assert.equal(refused.status, 1, '实测超预算时 --record 必须拒绝');
    assert.match(refused.stderr, /超过预算/, '拒绝理由要点名超预算');
    assert.match(refused.stderr, /--raise-budget/, '拒绝理由要给出显式抬预算的命令');
    assert.equal(
      (JSON.parse(readFileSync(tinyLedger, 'utf8')) as BundleBudget).budget_total_gzip,
      measured - 1,
      '被拒绝时不许偷偷改预算',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-135 B7：SKIP_TEST=1 跳过测试必须按"未全部执行"处理（rc=1，不许显示全部通过）', () => {
  const script = readSource('tools/ci-check.sh');

  // ④ 的跳过分支：标记 SKIPPED 并按**失败**记录（rc 参数是 1，不是 0）。
  assert.match(script, /SKIPPED=0/, '脚本要有 SKIPPED 状态位');
  assert.match(
    script,
    /if \[ "\$SKIP_TEST" = "1" \]; then[\s\S]{0,400}?SKIPPED=1[\s\S]{0,200}?record "④ npm test" 1/,
    'SKIP_TEST=1 时 ④ 必须按失败记录（rc=1），不能记 rc=0',
  );

  // 汇总：跳过时走独立分支 —— 打印"未全部执行"并 exit 1，且这段必须在 ✅ 横幅**之前**。
  const summaryStart = script.indexOf('== 汇总 ==');
  assert.ok(summaryStart > 0, '脚本必须有汇总段');
  const summary = script.slice(summaryStart);
  assert.match(summary, /if \[ "\$SKIPPED" = "1" \]; then/, '汇总要单独处理"被跳过"的情形');
  const skipBranch = summary.indexOf('未全部执行');
  const passBanner = summary.indexOf('✅ 代码质量检查全部通过');
  assert.ok(skipBranch > 0, '跳过时的横幅必须明说"未全部执行"');
  assert.ok(passBanner > skipBranch, '✅「全部通过」横幅必须在跳过分支之后（跳过时到不了）');
  assert.match(summary.slice(skipBranch, passBanner), /exit 1/, '跳过时必须非零退出');

  // 阴性对照：不带 SKIP_TEST 的正常路径仍然是 ✅ + exit "$FAIL"。
  assert.match(summary, /if \[ "\$FAIL" -eq 0 \]; then/, '正常路径仍按 FAIL 判定');
  assert.match(script, /SKIP_TEST=\$\{SKIP_TEST:-0\}/, '默认（CI）不跳过');
});

test('AC-135 B8：体积门禁覆盖 js 与 css（单文件上限 + 总预算同一口径）', () => {
  const script = readSource('tools/ci-check.sh');
  const start = script.indexOf('line "⑤ 体积预算"');
  assert.ok(start > 0, '脚本必须有 ⑤ 体积预算');
  const block = script.slice(start, script.indexOf('== 汇总 =='));
  assert.match(block, /\.js"\) \|\| f\.endsWith\("\.css"\)/, '⑤ 的单文件上限必须同时覆盖 .js 与 .css');
  assert.match(block, /js\+css 合计/, '⑤ 的摘要要写明合计口径是 js+css');

  const tool = readSource('tools/bundle-budget.mjs');
  assert.match(tool, /\.js'\) \|\| file\.endsWith\('\.css'\)/, '总预算工具必须量 js+css');
  const bundleTest = readSource('tests/stage18-bundle.test.ts');
  assert.match(bundleTest, /\.js'\) \|\| file\.endsWith\('\.css'\)/, 'AC-61 ⑤ 的实测口径也必须是 js+css');
});
