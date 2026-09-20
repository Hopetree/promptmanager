/**
 * 变量语法（BRIEF §6.5 / FR-8）：`{{` + 可选空白 + 名字 + 可选空白 + `}}`
 * - 名字 1–64 字符，允许 Unicode 字母/数字/下划线/连字符（含中文），**不含空白**；空名不算变量
 * - 不匹配的 `{{…}}`（如 `{{}}`、`{{a b}}`、`{{x!}}`）按**字面文本**处理
 * - `\{{name}}`（一个反斜杠）不算变量；渲染时去掉该反斜杠，输出字面 `{{name}}`
 * 本模块是纯函数，不碰数据库（渲染不写库）。
 */

/** 占位符：第 1 组是可选反斜杠（转义标记），第 2 组是变量名。 */
const PLACEHOLDER = /(\\?)\{\{\s*([\p{L}\p{N}_-]{1,64})\s*\}\}/gu;

/** 从若干段文本里按**首次出现顺序**提取变量名（去重、跳过转义的）。 */
export function extractVariables(...texts: Array<string | undefined>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    if (text === undefined || text === '') continue;
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (match[1] === '\\') continue; // 转义的不算变量
      const name = match[2];
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

export interface RenderResult {
  text: string;
  /** 未提供值的变量名（按提取顺序） */
  missing: string[];
}

/**
 * 渲染：提供了字符串值的占位符整体替换为值；**未提供的原样保留**（含内部空白）并列入 `missing`。
 * 给定空字符串算"已提供"（渲染成空）；非字符串值视为未提供。
 */
export function renderVariables(text: string, values: Record<string, unknown>): RenderResult {
  const missing: string[] = [];
  const seen = new Set<string>();

  const rendered = text.replace(PLACEHOLDER, (whole: string, escape: string, name: string) => {
    if (escape === '\\') return `{{${name}}}`; // 转义 → 去掉反斜杠，输出字面量

    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (typeof value === 'string') return value;

    if (!seen.has(name)) {
      seen.add(name);
      missing.push(name);
    }
    return whole;
  });

  return { text: rendered, missing };
}
