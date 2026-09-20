import { InvalidBodyError, NotFoundError } from '../errors.js';

/** 契约里 :id 只有 200/404/401（没有 400），因此非数字/越界一律按"不存在"处理。 */
export function parsePositiveId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new NotFoundError();
  return id;
}

/**
 * 查询串里的整数：应用关掉了 ajv 类型强转（见 app.ts），所以这里手工解析。
 * 非法（非整数或小于 min）→ 400；超过 max → **截断**（BRIEF §6.1「limit 上限 200」）。
 */
export function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  field = 'query',
): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new InvalidBodyError([{ path: field, message: `期望 >= ${min} 的整数，实际 "${raw}"` }]);
  }
  return Math.min(value, max);
}
