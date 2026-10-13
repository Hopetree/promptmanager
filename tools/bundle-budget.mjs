#!/usr/bin/env node
// 构建体积账本工具（阶段 69 / BRIEF FR-146 / AC-131 C；阶段 73 / FR-161 / AC-135 B6 改预算口径）。
//
// 用途：`tests/bundle-budget.json` 的**唯一写入者**。手工往测试里加 `ACCOUNTED_DELTA` 常量的做法已废弃。
//
//   node tools/bundle-budget.mjs                                  # 打印账本 + 实测 + 判定（不改文件）
//   node tools/bundle-budget.mjs --check                          # 同上，越界时退出码 1
//   node tools/bundle-budget.mjs --record 73 --note "<依据>"       # 只追加一条**实测**记录，预算不动
//   node tools/bundle-budget.mjs --record 73 --note "<依据>" --raise-budget 440000   # 显式抬预算
//
// ⚠️ 预算与实测**分离**（阶段 73 / 评审 N22）：`budget_total_gzip` 是人工设定的上界，`--record`
// 只往 `entries[]` 追加实测增量（`delta` = 本次实测总 gzip − 上一笔实测总 gzip），**从不改预算**。
// 实测超过预算时 `--record` 会**拒绝**并要求走显式 `--raise-budget`（"真增长走显式路径"）。
// 这样门禁才有余量可预警，而不是永远贴着 0 B 余量。
//
// ⚠️ `--record` 的缩水护栏（阶段 69 返工 ①）：一次记账若比上一笔实测掉超过 5%，会被**拒绝**
// （防止对着半成品 / dev 构建记一次账就把账本永久压扁）。确实要压扁（例如真删掉一个大依赖）时加 `--force`。
//
// 口径与 `tests/stage18-bundle.test.ts` 完全一致：`dist/web/assets` 下所有 js+css 的
// `zlib.gzipSync`（默认级别）字节数之和。判定 = [floor(budget × floor_ratio), budget]。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'dist', 'web', 'assets');
const DEFAULT_LEDGER_PATH = path.join(ROOT, 'tests', 'bundle-budget.json');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** dist/web/assets 的 js+css gzip 合计（与测试同一口径；js 与 css 都算）。 */
function measure() {
  if (!existsSync(path.join(ROOT, 'dist', 'web', 'index.html'))) {
    throw new Error('dist/web 不存在：先跑 `npm run build:web`（或 `npm run build`）');
  }
  const files = walk(ASSETS).filter((file) => file.endsWith('.js') || file.endsWith('.css'));
  return files.reduce((sum, file) => sum + zlib.gzipSync(readFileSync(file)).byteLength, 0);
}

function readLedger(ledgerPath) {
  return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

/** 预算上界 = 账本里**人工写死**的字段（不由实测派生）。 */
function budgetTotal(ledger) {
  return ledger.budget_total_gzip;
}

/** 上一笔实测总 gzip（基线 + Σ 实测增量）——只用于报告与缩水护栏。 */
function lastMeasured(ledger) {
  return ledger.baseline_total_gzip + ledger.entries.reduce((sum, entry) => sum + entry.delta, 0);
}

function evaluate(measured, ledger) {
  const budget = budgetTotal(ledger);
  const floor = Math.floor(budget * ledger.floor_ratio);
  const problems = [];
  if (measured > budget) problems.push(`超过预算 ${budget} B`);
  if (measured < floor) problems.push(`低于下界 ${floor} B（预算的 ${Math.round(ledger.floor_ratio * 100)}%）：账本该回收了`);
  return { budget, floor, problems };
}

function printReport(ledger, measured) {
  const { budget, floor, problems } = evaluate(measured, ledger);
  console.log(`账本条目：${ledger.entries.length} 条（阶段 ${ledger.entries.map((e) => String(e.stage)).join(' / ')}）`);
  console.log(`预算（人工设定，不由实测派生）= ${budget} B；上一笔实测 = ${lastMeasured(ledger)} B`);
  console.log(`允许区间：[${floor}, ${budget}] B（下界 = 预算 × ${ledger.floor_ratio}）`);
  console.log(`本次实测总 gzip = ${measured} B（余量 ${budget - measured} B）`);
  if (problems.length === 0) {
    console.log('✅ 在预算区间内');
    return true;
  }
  for (const problem of problems) console.log(`❌ ${problem}`);
  return false;
}

function parseArgs(argv) {
  const options = { check: false, record: null, note: '', force: false, ledger: DEFAULT_LEDGER_PATH, raiseBudget: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--record') options.record = argv[(i += 1)] ?? null;
    else if (arg === '--note') options.note = argv[(i += 1)] ?? '';
    else if (arg === '--force') options.force = true;
    else if (arg === '--ledger') options.ledger = path.resolve(argv[(i += 1)] ?? '');
    else if (arg === '--raise-budget') options.raiseBudget = Number(argv[(i += 1)]);
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const ledger = readLedger(options.ledger);
const measured = measure();

if (options.record === null) {
  const ok = printReport(ledger, measured);
  process.exit(options.check && !ok ? 1 : 0);
}

const before = budgetTotal(ledger);
const previous = lastMeasured(ledger);
const stage = /^\d+$/.test(options.record) ? Number(options.record) : options.record;

// 缩水护栏：一次记账比上一笔实测掉 >5% 通常是**构建不完整**（半成品 / 只跑了 build:web 的一部分）
// 而不是真的瘦身 —— 记下去会把实测曲线永久压扁。要压扁就显式 --force。
const SHRINK_GUARD = 0.95;
if (!options.force && measured < previous * SHRINK_GUARD) {
  const percent = Math.round((1 - measured / previous) * 100);
  console.error(
    `❌ 拒绝记账：实测 ${measured} B 比上一笔实测 ${previous} B 低约 ${percent}%（超过 5% 的缩水护栏）。\n` +
      '   先确认这是**完整** `npm run build` 的产物，而不是半成品 / dev 构建；\n' +
      '   确实是真瘦身（例如删掉一个大依赖）时，加 `--force` 重跑。',
  );
  process.exit(1);
}

// "真增长走显式路径"：实测超预算时不许靠记账悄悄把预算抬上去。
if (measured > before && options.raiseBudget === null) {
  console.error(
    `❌ 拒绝记账：实测 ${measured} B 已超过预算 ${before} B（超 ${measured - before} B）。\n` +
      '   预算不由实测派生 —— 要么先把体积降回预算内，要么显式抬预算（运维/维护者确认后）：\n' +
      `   node tools/bundle-budget.mjs --record ${String(stage)} --note "<为什么必须增>" --raise-budget <新预算>`,
  );
  process.exit(1);
}

if (options.raiseBudget !== null) {
  if (!Number.isInteger(options.raiseBudget) || options.raiseBudget <= 0) {
    throw new Error(`--raise-budget 需要正整数，收到：${String(options.raiseBudget)}`);
  }
  if (options.raiseBudget < measured) {
    throw new Error(`--raise-budget ${options.raiseBudget} 低于本次实测 ${measured} B：抬预算不能抬到仍然超预算`);
  }
  ledger.budget_total_gzip = options.raiseBudget;
  console.log(`已显式抬预算：${before} B → ${options.raiseBudget} B`);
}

ledger.entries.push({
  id: `STAGE${String(stage).toUpperCase()}`,
  stage,
  delta: measured - previous,
  note: options.note === '' ? `（未写依据：请补上改前/改后实测值与构成）实测总 gzip = ${measured} B` : options.note,
});
writeFileSync(options.ledger, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
console.log(`已记账：阶段 ${String(stage)} 实测增量 = ${measured - previous >= 0 ? '+' : ''}${measured - previous} B（实测 ${measured} B）`);
console.log(`预算${options.raiseBudget === null ? '未变' : '已按显式参数调整'}：${budgetTotal(readLedger(options.ledger))} B`);
printReport(readLedger(options.ledger), measured);
