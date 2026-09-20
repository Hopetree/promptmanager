/**
 * 检索语义的纯函数（BRIEF §6.6 / D-3）。查询词一律当**字面短语**：
 * - ≥3 个 Unicode 码点 → FTS5 `trigram` 的 `MATCH`（外层加引号，内部引号双写）
 * - <3 个 Unicode 码点 → `LIKE '%…%' ESCAPE '\'` 兜底（转义 `\` `%` `_`）
 * 长度按**码点**而不是 `String.length` 计数（`"👍👍"` 的 length 是 4、码点是 2）。
 */

/** 匹配范围（BRIEF §6.6）。 */
export const SEARCH_COLUMNS = ['title', 'user_prompt', 'system_prompt', 'notes'] as const;

/** trigram 分词器的最小查询长度（码点）；小于它必然 0 命中，必须走 LIKE（228 实测）。 */
export const FTS_MIN_CODE_POINTS = 3;

export function countCodePoints(value: string): number {
  return [...value].length;
}

export function normalizeQuery(raw: string | undefined): string {
  return (raw ?? '').trim();
}

export function hasQuery(raw: string | undefined): boolean {
  return normalizeQuery(raw) !== '';
}

export function isFtsQuery(raw: string | undefined): boolean {
  const q = normalizeQuery(raw);
  return q !== '' && countCodePoints(q) >= FTS_MIN_CODE_POINTS;
}

/** FTS5 字面短语；特殊字符（引号/星号/减号/括号/百分号…）包在短语里就不会被当语法（见 docs/search-zh.md）。 */
export function ftsMatchExpression(raw: string): string {
  return `"${normalizeQuery(raw).replaceAll('"', '""')}"`;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function likePattern(raw: string): string {
  return `%${escapeLike(normalizeQuery(raw))}%`;
}
