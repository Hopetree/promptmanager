/**
 * 变量语法（BRIEF §6.5 / FR-8 / FR-126）：
 * - 基本形：`{{` + 可选空白 + 名字 + 可选空白 + `}}`
 * - 默认值：`{{` + 名字 + `| default(默认值)` + `}}`（Jinja 系；竖线也可写成转义形式 `\|`）
 * - 名字 1–64 字符，允许 Unicode 字母/数字/下划线/连字符（含中文），**不含空白**；空名不算变量
 * - 不匹配的 `{{…}}`（如 `{{}}`、`{{a b}}`、`{{x!}}`、`{{x|upper}}`、`{{x|default}}`）
 *   按**字面文本**处理 —— 宁可不生效，也不猜、不静默换成别的值
 * - `\{{…}}`（一个反斜杠）不算变量；渲染时去掉该反斜杠，**其余原样**输出
 *
 * 默认值语义（FR-126 / D-58）：**没填** = `values` 里根本没有这个键 ⇒ 用默认值；
 * **显式传空串 ⇒ 渲染成空**；有默认值的变量不再进 `missing`；同名多处取**首次出现**、全篇一致。
 * 默认值是**字面文本**：内部写 `{{…}}` 不会再被解析；两端若是一对相同引号则剥掉。
 * 本模块是纯函数，不碰数据库（渲染不写库）。
 */

/** 占位符：第 1 组是可选反斜杠（转义标记），第 2 组是变量名，第 3 组是 `default(...)` 的原始内容。 */
const PLACEHOLDER = /(\\?)\{\{\s*([\p{L}\p{N}_-]{1,64})\s*(?:\\?\|\s*default\s*\(([\s\S]*?)\)\s*)?\}\}/gu;

/** `default(...)` 的原始内容 → 字面默认值；`undefined` 表示这个占位符没写默认值。 */
function parseDefaultText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === "'" || first === '"') && first === trimmed[trimmed.length - 1]) {
      return trimmed.slice(1, -1); // 两端成对引号 ⇒ 剥掉这一对
    }
  }
  return trimmed;
}

export interface VariableScan {
  /** 变量名（按首次出现顺序、去重、跳过转义的） */
  variables: string[];
  /** 只有**写了默认值**的变量才在这里；值是字面文本（引号已剥、两端空白已去） */
  defaults: Record<string, string>;
}

/** 扫描若干段文本：变量名单 + 默认值表（默认值取**首次出现**，保证全篇一致）。 */
export function scanVariables(...texts: Array<string | undefined>): VariableScan {
  const variables: string[] = [];
  const defaults: Record<string, string> = {};
  const seen = new Set<string>();

  for (const text of texts) {
    if (text === undefined || text === '') continue;
    for (const match of text.matchAll(PLACEHOLDER)) {
      if (match[1] === '\\') continue; // 转义的不算变量
      const name = match[2];
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      variables.push(name);
      const parsed = parseDefaultText(match[3]);
      if (parsed !== undefined) defaults[name] = parsed;
    }
  }

  return { variables, defaults };
}

/** 从若干段文本里按**首次出现顺序**提取变量名（去重、跳过转义的）。 */
export function extractVariables(...texts: Array<string | undefined>): string[] {
  return scanVariables(...texts).variables;
}

export interface RenderResult {
  text: string;
  /** 未提供值且**没有默认值**的变量名（按提取顺序） */
  missing: string[];
}

/**
 * 渲染：提供了字符串值的占位符整体替换为值；没填（键不存在 / 值不是字符串）时，
 * 有默认值 ⇒ 用默认值，没有默认值 ⇒ **原样保留**（含内部空白）并列入 `missing`。
 * 给定空字符串算"已提供"（渲染成空，**不回落默认值**）；转义写法去掉反斜杠、其余原样。
 */
export function renderVariables(text: string, values: Record<string, unknown>): RenderResult {
  const missing: string[] = [];
  const seen = new Set<string>();
  const { defaults } = scanVariables(text);

  const rendered = text.replace(PLACEHOLDER, (whole: string, escape: string, name: string) => {
    if (escape === '\\') return whole.slice(1); // 转义 → 去掉反斜杠，其余原样输出

    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (typeof value === 'string') return value;

    const fallback = defaults[name];
    if (fallback !== undefined) return fallback;

    if (!seen.has(name)) {
      seen.add(name);
      missing.push(name);
    }
    return whole;
  });

  return { text: rendered, missing };
}
