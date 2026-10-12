/** 变量：扫描 / 预览 / 填值 / 本地记忆（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

import {
  renderVariableText,
  scanVariableTexts,
  type VariableScan,
} from '../../src/variable-syntax.ts';

/**
 * 变量语法**不再在前端实现**（阶段 70 / FR-147 / AC-132 ①②）：
 * 正则、默认值解析、扫描、渲染全部来自前后端共用的 `src/variable-syntax.ts`（唯一一份）。
 * 这里保留原来的导出名，调用方不必改；实现只有一行委派。
 */
export type { VariableScan } from '../../src/variable-syntax.ts';

/** 扫描若干段文本：变量名单 + 默认值表（默认值取**首次出现**，保证全篇一致）——服务端同规则。 */
export function scanVariablesLocal(...texts: Array<string | undefined>): VariableScan {
  return scanVariableTexts(...texts);
}

/** 从若干段文本里按**首次出现顺序**提取变量名（去重、跳过转义的）——服务端同规则。 */
export function extractVariablesLocal(...texts: Array<string | undefined>): string[] {
  return scanVariablesLocal(...texts).variables;
}

/** 这条 prompt 是否含变量（决定"复制"是直接复制还是先弹填值对话框）。 */
export function hasVariables(...texts: Array<string | undefined>): boolean {
  return extractVariablesLocal(...texts).length > 0;
}

/**
 * 填变量对话框的**实时预览**：按服务端 `renderVariables` 的规则做替换
 * （提供了字符串值 → 替换；转义 → 去掉反斜杠、其余原样；没填但有默认值 → 用默认值；
 * 没填且无默认值 → **原样保留**）。
 * 这只是"对占位符做替换"，不是模板引擎（无表达式/循环/函数）。
 * ⚠️ 最终复制仍以服务端 `POST /api/prompts/:id/render` 的返回为准；两者一致性由
 * `tests/variables-preview-parity.test.ts` 逐字符对照。
 */
export function previewRender(text: string, values: Record<string, string>): string {
  // 直接用服务端同款渲染函数：`values` 只装已填项（见 filledValues），默认值取自本段文本。
  return renderVariableText(text, values, scanVariableTexts(text).defaults).text;
}

/**
 * 表单原始值 → `POST /api/prompts/:id/render` 的 `values`：**只保留已填写的变量**。
 *
 * BRIEF §6.5 / FR-41e 第 2 条（v15，2026-09-19 用户决定「没填写的变量按照原样输出」）：
 * 服务端对**未提供值**的变量原样保留 `{{name}}` 并列入 `missing`；一旦前端把空串也传下去，
 * 服务端会把它当"提供了值"而替换成空——`{{项目}}` 就被静默吞掉（旧缺陷）。
 * 因此"未填"必须在**进入 values 之前**就被剔除，空串绝不外发。
 *
 * 变量名一律以服务端 `GET /api/prompts/:id/variables` 为准（单一真相源），
 * 这里只做"按服务端给的名单筛掉未填项"，不重新解析 prompt。
 */
export function filledValues(variables: string[], raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of variables) {
    const value = raw[name];
    if (typeof value === 'string' && value !== '') out[name] = value;
  }
  return out;
}

// ─────────────────── FR-127 / FR-128：变量记忆（localStorage，键 pm-vars:<id>） ───────────────────

/**
 * 记忆的**存储介质不变**（D-59 ⑦）：变量值仍只存在浏览器 `localStorage`，键 `pm-vars:<id>`；
 * 本次只加"要不要记"的控制（开关在服务端，见 FR-127）。把这几个函数从组件里提出来，
 * 是为了让「写入 / 读取 / 删除」能在 node:test 里用内存版存储机械验证，且全站只有一份实现。
 */
export const VARS_STORAGE_PREFIX = 'pm-vars:';

/** 只用到这三个方法（浏览器 `Storage` 天然满足；测试传内存版）。 */
export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function varsStorageKey(promptId: number): string {
  return `${VARS_STORAGE_PREFIX}${String(promptId)}`;
}

/** 取存储：显式传入（测试的内存版）→ 否则浏览器 localStorage；都没有 ⇒ null（静默降级）。 */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readRememberedVars(promptId: number, storage?: StorageLike): Record<string, string> {
  const store = resolveStorage(storage);
  if (store === null) return {};
  try {
    const raw = store.getItem(varsStorageKey(promptId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRememberedVars(promptId: number, values: Record<string, string>, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  try {
    store.setItem(varsStorageKey(promptId), JSON.stringify(values));
  } catch {
    /* 隐私模式等场景写不进就算了，不影响复制 */
  }
}

/** FR-127 / D-59 ⑤：取消勾选（或点「清空」）⇒ 把该提示词已存的记忆**删掉**，避免旧值"诈尸"。 */
export function removeRememberedVars(promptId: number, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  try {
    store.removeItem(varsStorageKey(promptId));
  } catch {
    /* 同上：删不掉也不影响复制 */
  }
}

/** FR-127：弹窗标题 —— 记住时沿用原文案；**不记住时不含「（自动记忆）」**。 */
export function varsDialogTitle(remember: boolean): string {
  return remember ? '请填写变量值（自动记忆）' : '请填写变量值';
}

/**
 * 「未填」名单（FR-41e / FR-126 / FR-128 ⑯）：**不在** `values` 里 **且** 没有默认值的变量。
 * `values` 由 `filledValues` 产出（已剔除空串）⇒ "不在里面" == 未填；有默认值的不算未填。
 */
export function missingVariables(
  variables: string[],
  values: Record<string, string>,
  defaults: Record<string, string>,
): string[] {
  // 空串与"键不存在"一样算未填：界面上输入框为空 == 没填（服务端只收到 `filledValues` 剔空后的
  // 值，因此这里把空串也当未填，与服务端 `/render` 的 `missing` 口径一致）。
  return variables.filter((name) => (values[name] ?? '') === '' && defaults[name] === undefined);
}

/** FR-128 ⑰：有没有**非空**的已填值（全空 ⇒ 「清空」按钮置灰）。 */
export function hasAnyFilled(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value !== '');
}

/**
 * FR-127 / AC-123 ⑧：把「这次打开弹窗该往表单里写什么」算成一张**完整的**表。
 *
 * ⚠️ 必须给**每个变量**都写一个值（没记忆的写空串），不能只写「有记忆的那几个」：
 * antd 的 `form.setFieldsValue()` **不会清空未提供的字段**，只传有记忆的部分会让上一次打开
 * 留在 Form 里的字原样显示 —— 用户看到的就是"不记住却还是被预填了"，直接违反 FR-127。
 *
 * 提成纯函数是为了让这条口径**能被 node:test 机械验证**（组件里的 antd 表单跑不进 node:test）。
 */
export function varsFormValues(variables: string[], initial: Record<string, string>): Record<string, string> {
  const formValues: Record<string, string> = {};
  for (const name of variables) formValues[name] = initial[name] ?? '';
  return formValues;
}
