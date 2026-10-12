#!/usr/bin/env node
// 构建体积账本工具（阶段 69 / BRIEF FR-146 / AC-131 C）。
//
// 用途：`tests/bundle-budget.json` 的**唯一写入者**。手工往测试里加 `ACCOUNTED_DELTA` 常量的做法已废弃。
//
//   node tools/bundle-budget.mjs                                  # 打印账本 + 实测 + 判定（不改文件）
//   node tools/bundle-budget.mjs --check                          # 同上，越界时退出码 1
//   node tools/bundle-budget.mjs --record 69 --note "<依据>"       # 用当前构建产物实测，记一条（delta 可为负）
//
// 口径与 `tests/stage18-bundle.test.ts` 完全一致：`dist/web/assets` 下所有 js+css 的
// `zlib.gzipSync`（默认级别）字节数之和。判定 = [floor(budget × floor_ratio), budget]。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'dist', 'web', 'assets');
const LEDGER_PATH = path.join(ROOT, 'tests', 'bundle-budget.json');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** dist/web/assets 的 js+css gzip 合计（与测试同一口径）。 */
function measure() {
  if (!existsSync(path.join(ROOT, 'dist', 'web', 'index.html'))) {
    throw new Error('dist/web 不存在：先跑 `npm run build:web`（或 `npm run build`）');
  }
  const files = walk(ASSETS).filter((file) => file.endsWith('.js') || file.endsWith('.css'));
  return files.reduce((sum, file) => sum + zlib.gzipSync(readFileSync(file)).byteLength, 0);
}

function readLedger() {
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
}

function budgetTotal(ledger) {
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
  console.log(`基线 ${ledger.baseline_total_gzip} B + 增量 ${budget - ledger.baseline_total_gzip} B = 预算 ${budget} B`);
  console.log(`允许区间：[${floor}, ${budget}] B（下界 = 预算 × ${ledger.floor_ratio}）`);
  console.log(`实测总 gzip = ${measured} B（余量 ${budget - measured} B）`);
  if (problems.length === 0) {
    console.log('✅ 在预算区间内');
    return true;
  }
  for (const problem of problems) console.log(`❌ ${problem}`);
  return false;
}

function parseArgs(argv) {
  const options = { check: false, record: null, note: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--record') options.record = argv[(i += 1)] ?? null;
    else if (arg === '--note') options.note = argv[(i += 1)] ?? '';
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const ledger = readLedger();
const measured = measure();

if (options.record === null) {
  const ok = printReport(ledger, measured);
  process.exit(options.check && !ok ? 1 : 0);
}

const before = budgetTotal(ledger);
const delta = measured - before;
const stage = /^\d+$/.test(options.record) ? Number(options.record) : options.record;
ledger.entries.push({
  id: `STAGE${String(stage).toUpperCase()}`,
  stage,
  delta,
  note: options.note === '' ? `（未写依据：请补上改前/改后实测值与构成）实测总 gzip = ${measured} B` : options.note,
});
writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
console.log(`已记账：阶段 ${String(stage)} delta = ${delta >= 0 ? '+' : ''}${delta} B（实测 ${measured} B）`);
printReport(readLedger(), measured);
