/** 令牌名的截断与掩码（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

/**
 * 令牌名称的**显示截断**（FR-99 ②，用户原话「名称最多显示前 20 个字符超过用省略号」）。
 *
 * 按**字符**（`Array.from`，不是 UTF-16 code unit）截断 —— 否则 emoji / 生僻字会被从中间劈开。
 * ⚠️ 只影响**显示**：完整名称仍放在单元格 `title` 里（悬停可看全），**不写回服务端**。
 */
export const TOKEN_NAME_DISPLAY_LIMIT = 20;

export function truncateTokenName(name: string, limit: number = TOKEN_NAME_DISPLAY_LIMIT): string {
  const chars = Array.from(name);
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : name;
}

/** 令牌掩码的形状（前 5 + `...` + 后 4），也是 AC-101 ③ 的判据。 */
export const TOKEN_MASK_PREFIX = 5;

export const TOKEN_MASK_SUFFIX = 4;

/**
 * 令牌**脱敏展示**（FR-99 ④，用户原话「token 显示前 5 位 + 后 4 位，中间用省略号」，例 `pm_96...7LU8`）。
 *
 * 输入是**抽屉打开时预取到内存的明文**（FR-95 的既有纪律：明文只在内存，不落任何持久存储/日志）。
 * 太短的值（不足 10 个字符）一律只显示 `…`，避免"脱敏"反而把整串露出来。
 */
export function maskToken(plaintext: string): string {
  const chars = Array.from(plaintext);
  if (chars.length < TOKEN_MASK_PREFIX + TOKEN_MASK_SUFFIX + 2) return '…';
  return `${chars.slice(0, TOKEN_MASK_PREFIX).join('')}...${chars.slice(-TOKEN_MASK_SUFFIX).join('')}`;
}
