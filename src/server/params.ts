import { InvalidBodyError, NotFoundError } from '../errors.js';

/**
 * 十进制整数字面量（可选前导 `-`，是否合法由调用方的下界决定）。
 *
 * 为什么不用 `Number()` 一把梭：`Number('0x10') === 16`、`Number('1e3') === 1000`、
 * `Number('1.0') === 1`、`Number(' 1') === 1` —— 而文档（`docs/api.md`）说这些参数是
 * "正整数 / 整数"。于是 `/api/prompts/1.0` 会等价于 `/api/prompts/1`（第三轮项目审视的收口项）。
 * 这里只认十进制字面量，拒绝一切"看起来像数字"的写法；超出安全整数范围同样按非法处理。
 */
const DECIMAL_INTEGER = /^-?[0-9]+$/;

/** 严格十进制整数；不是整数字面量或超出 `Number.MAX_SAFE_INTEGER` 时返回 null。 */
function parseDecimalInteger(raw: string): number | null {
  if (!DECIMAL_INTEGER.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** 契约里 :id 只有 200/404/401（没有 400），因此非数字/越界一律按"不存在"处理。 */
export function parsePositiveId(raw: string | undefined): number {
  const id = raw === undefined ? null : parseDecimalInteger(raw);
  if (id === null || id < 1) throw new NotFoundError();
  return id;
}

/**
 * 查询串里的整数：应用关掉了 ajv 类型强转（见 app.ts），所以这里手工解析。
 * 非法（非十进制整数、或小于 min）→ 400；超过 max → **截断**（BRIEF §6.1「limit 上限 200」）。
 */
export function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  field = 'query',
): number {
  if (raw === undefined || raw === '') return fallback;
  const value = parseDecimalInteger(raw);
  if (value === null || value < min) {
    throw new InvalidBodyError([{ path: field, message: `期望 >= ${min} 的整数，实际 "${raw}"` }]);
  }
  return Math.min(value, max);
}
