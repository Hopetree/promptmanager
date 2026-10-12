/**
 * 变量语法（BRIEF §6.5 / FR-8 / FR-126 / **FR-147**）—— 服务端侧门面。
 *
 * ⚠️ 阶段 70 起，语法的**唯一定义**在 `src/variable-syntax.ts`（前后端共用的纯函数模块）：
 * 正则、默认值解析、扫描、渲染都只写在那里一份。本模块只做两件事：
 * 1. 用服务端的命名转出（`scanVariables` / `extractVariables` / `renderVariables`）；
 * 2. 把结果类型（`VariableScan` / `RenderResult`）按原样暴露给路由与 MCP。
 *
 * 这样"服务端改一次语法、前端没跟上"这类**用户可见的数据损坏**（预览 ≠ 剪贴板）
 * 在结构上不再可能 —— 改的地方只有一处。
 *
 * 本模块是纯函数，不碰数据库（渲染不写库）。
 */

import {
  renderVariableText,
  scanVariableTexts,
  type VariableRenderResult,
  type VariableScan,
} from '../variable-syntax.js';

export type { VariableScan } from '../variable-syntax.js';

/** 扫描若干段文本：变量名单 + 默认值表（默认值取**首次出现**，保证全篇一致）。 */
export function scanVariables(...texts: Array<string | undefined>): VariableScan {
  return scanVariableTexts(...texts);
}

/** 从若干段文本里按**首次出现顺序**提取变量名（去重、跳过转义的）。 */
export function extractVariables(...texts: Array<string | undefined>): string[] {
  return scanVariables(...texts).variables;
}

/** 渲染结果：`missing` = 未提供值且**没有默认值**的变量名（按提取顺序）。 */
export type RenderResult = VariableRenderResult;

/**
 * 渲染：提供了字符串值的占位符整体替换为值；没填（键不存在 / 值不是字符串）时，
 * 有默认值 ⇒ 用默认值，没有默认值 ⇒ **原样保留**（含内部空白）并列入 `missing`。
 * 给定空字符串算"已提供"（渲染成空，**不回落默认值**）；转义写法去掉反斜杠、其余原样。
 *
 * `defaultsScope`（阶段 60 返工 ①）：一条提示词有**两段**（用户段 + 系统段）时，默认值表必须是
 * **全篇**的 —— 也就是 `scanVariables(user_prompt, system_prompt).defaults`，与
 * `GET /api/prompts/:id/variables` 报出去的那张表**同一张**。否则两段各算各的，
 * 就会出现"接口说默认值是甲、系统段却填了乙"。不传时退化为只看本段（单文本调用方）。
 */
export function renderVariables(
  text: string,
  values: Record<string, unknown>,
  defaultsScope?: Record<string, string>,
): RenderResult {
  return renderVariableText(text, values, defaultsScope);
}
