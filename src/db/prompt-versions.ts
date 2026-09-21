import type { Selectable } from 'kysely';
import type { QueryEngine } from './index.js';
import type { PromptVersionsTable } from './schema.js';

export type PromptVersionRow = Selectable<PromptVersionsTable>;

/**
 * FR-86：每个 prompt 在 `prompt_versions` 里**最多保留最近 10 个版本**（`version_no` 最大的 10 行）。
 * 导出成常量，供服务层与文案共用同一个数字（版本面板的说明、README 的已知限制都指它）。
 */
export const VERSION_KEEP_LIMIT = 10;

/** 某个 prompt 的版本行，按 version_no 升序（含首版）。 */
export async function selectVersions(qe: QueryEngine, promptId: number): Promise<PromptVersionRow[]> {
  return qe
    .selectFrom('prompt_versions')
    .selectAll()
    .where('prompt_id', '=', promptId)
    .orderBy('version_no', 'asc')
    .execute();
}

/**
 * FR-86：**版本保留裁剪** —— 把某个 prompt 的版本行裁到"最近的 `keep` 个"，超出的**真删**（不是隐藏）。
 *
 * 语义（BRIEF v41 §4 FR-86）：
 * - 保留集合 = `version_no` 最大的 `keep` 行；**只删行，绝不重编号**（保留行的 `version_no` 一字不动）；
 * - **当前版本永远在保留集合内**：`prompts.version_no` 指向的那一行额外豁免删除。
 *   正常写入路径下当前版本就是最大号、天然在集合里；这里显式豁免是为了让不变式在**任何**调用点都成立
 *   （例如导入文件里 `prompts.version_no` 与版本行的最大值不一致时），代价只是那种畸形数据会留 `keep+1` 行；
 * - **调用时机**：**每次产生新版本之后**（新建 / 更新 / 回滚 / 导入 / 批量），与写入同事务调用；
 * - **存量数据不做一次性迁移**（FR-86 明确不加迁移）：旧数据在**下一次产生新版本**时被自然裁剪。
 *
 * @returns 本次真正删掉的行数（0 = 本来就不超过 `keep` 行）
 */
export async function pruneVersions(
  qe: QueryEngine,
  promptId: number,
  keep: number = VERSION_KEEP_LIMIT,
): Promise<number> {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`pruneVersions: keep 必须是 >= 1 的整数，实际 ${String(keep)}`);
  }

  // 第 keep 大的 version_no = 保留集合的下界（不足 keep 行时 undefined ⇒ 无需裁剪）
  const boundary = await qe
    .selectFrom('prompt_versions')
    .select('version_no')
    .where('prompt_id', '=', promptId)
    .orderBy('version_no', 'desc')
    .limit(1)
    .offset(keep - 1)
    .executeTakeFirst();
  if (boundary === undefined) return 0;

  const current = await qe
    .selectFrom('prompts')
    .select('version_no')
    .where('id', '=', promptId)
    .executeTakeFirst();

  const deleted = await qe
    .deleteFrom('prompt_versions')
    .where('prompt_id', '=', promptId)
    .where('version_no', '<', boundary.version_no)
    // 当前版本豁免（见上方注释：正常路径下不会命中，这里只做不变式兜底）
    .$if(current !== undefined, (qb) => qb.where('version_no', '<>', current?.version_no ?? -1))
    .executeTakeFirst();

  return Number(deleted.numDeletedRows ?? 0);
}

export async function selectVersion(
  qe: QueryEngine,
  promptId: number,
  versionNo: number,
): Promise<PromptVersionRow | undefined> {
  return qe
    .selectFrom('prompt_versions')
    .selectAll()
    .where('prompt_id', '=', promptId)
    .where('version_no', '=', versionNo)
    .executeTakeFirst();
}
