// 构建体积预算的**账本 + 判定**（阶段 69 / BRIEF FR-146 / AC-131 C）。
//
// 为什么存在：过去预算 = `BASELINE_TOTAL_GZIP` + **20 个手工累加的 `ACCOUNTED_DELTA` 常量**，
// 只有上界（`total <= budget`）。两个后果：
//   ① 体积降下来不会回收预算（预算只随阶段单调上升）；
//   ② 常量既是账本又是阈值 ⇒ 自证，且测试标题与常量已经对不上。
//
// 现在：账本落在 `tests/bundle-budget.json`（由 `tools/bundle-budget.mjs --record` 写入，不手改），
// 判定是一个**纯函数** `evaluateBundleBudget(measured, ledger)` —— 上界 + 下界都查，
// 并且可以被测试注入极端值来验证"超预算红 / 体积塌了也红"。
//
// 阶段 73 / FR-161（评审 N22）把**预算与实测分离**：过去 `--record` 记一笔 `delta = 实测 − 预算`，
// 于是预算永远等于最后一次实测（余量恒为 0，门禁从不预警）。现在：
//   · `budget_total_gzip` 是**人工设定的上界**（显式数字，不由任何实测派生）；
//   · `entries[]` 只是**实测历史**（`delta` = 本阶段实测总 gzip − 上一笔实测总 gzip），
//     增删条目都不影响预算；
//   · 要抬预算必须走显式路径 `--raise-budget <新预算>`（工具会拒绝"默默抬高"）。
//
// ⚠️ 本文件不是 `*.test.ts`，不会被单独执行。
import { readJson } from './source-text.ts';

export interface BudgetEntry {
  /** 稳定标识（工具按 `STAGE<阶段>` 生成） */
  id: string;
  /** 阶段号；非阶段来源（例如依赖补丁）用字符串 */
  stage: number | string;
  /** 该阶段**实测**的增量字节数（= 本阶段实测总 gzip − 上一笔实测总 gzip；体积下降时为负数） */
  delta: number;
  /** 依据：改前/改后实测值、构成、为什么这笔是规格要求 */
  note: string;
}

export interface BundleBudget {
  /** 阶段 18 开工前的实测总 gzip（js+css 合计） */
  baseline_total_gzip: number;
  /** **人工设定的预算上界**（阶段 73 起不再由 `--record` 派生；抬它要显式 `--raise-budget`） */
  budget_total_gzip: number;
  /** 下界比例：实测低于 `预算 × 该比例` 视为"账本该回收了" */
  floor_ratio: number;
  note?: string;
  entries: BudgetEntry[];
}

export interface BudgetVerdict {
  /** 上界：账本里显式写死的 `budget_total_gzip` */
  budget: number;
  /** 下界：floor(budget × floor_ratio) */
  floor: number;
  ok: boolean;
  /** 账本里列出的阶段（测试标题直接用它 ⇒ 标题与账本不会再对不上） */
  stages: string;
  message: string;
}

/**
 * 账本 → 预算上界。**只读显式字段**，不看 `entries`：
 * 这正是"预算与实测分离"的可机械验证点（追加/删除实测条目都不许改变它）。
 */
export function budgetTotal(ledger: BundleBudget): number {
  return ledger.budget_total_gzip;
}

/** 账本 → 最新一次实测总 gzip（= 基线 + Σ 实测增量）。只用于报告与缩水护栏，**不参与预算**。 */
export function lastMeasuredTotal(ledger: BundleBudget): number {
  return ledger.baseline_total_gzip + ledger.entries.reduce((sum, entry) => sum + entry.delta, 0);
}

/** 账本 → 阶段清单（按账本顺序，逗号分隔）。 */
export function budgetStages(ledger: BundleBudget): string {
  return ledger.entries.map((entry) => String(entry.stage)).join(' / ');
}

/**
 * 判定实测体积是否落在 [下界, 上界] 内。
 * 纯函数：不读文件、不看构建产物 ⇒ 测试可以注入任意实测值验证两个方向都会红。
 */
export function evaluateBundleBudget(measuredTotal: number, ledger: BundleBudget): BudgetVerdict {
  const budget = budgetTotal(ledger);
  const floor = Math.floor(budget * ledger.floor_ratio);
  const problems: string[] = [];
  if (measuredTotal > budget) {
    problems.push(
      `总 gzip = ${String(measuredTotal)} B，超过预算 ${String(budget)} B（预算由 tests/bundle-budget.json 的 budget_total_gzip 人工设定，` +
        '不由实测派生；体积真的增长要走显式路径：`node tools/bundle-budget.mjs --record <阶段> --note "<依据>" --raise-budget <新预算>`）',
    );
  }
  if (measuredTotal < floor) {
    problems.push(
      `总 gzip = ${String(measuredTotal)} B，低于下界 ${String(floor)} B（预算 ${String(budget)} B 的 ${String(Math.round(ledger.floor_ratio * 100))}%）：` +
        '体积明显变小说明账本该回收了 —— 跑 `node tools/bundle-budget.mjs --record <阶段> --note "<依据>"` 记一条负增量',
    );
  }
  return {
    budget,
    floor,
    ok: problems.length === 0,
    stages: budgetStages(ledger),
    message: problems.length > 0 ? problems.join('；') : `总 gzip = ${String(measuredTotal)} B，在 [${String(floor)}, ${String(budget)}] 内`,
  };
}

/** 读账本（`tests/bundle-budget.json`）。 */
export function readBundleBudget(): BundleBudget {
  return readJson<BundleBudget>('tests/bundle-budget.json');
}
