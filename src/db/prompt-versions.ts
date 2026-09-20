import type { Selectable } from 'kysely';
import type { QueryEngine } from './index.js';
import type { PromptVersionsTable } from './schema.js';

export type PromptVersionRow = Selectable<PromptVersionsTable>;

/** 某个 prompt 的版本行，按 version_no 升序（含首版）。 */
export async function selectVersions(qe: QueryEngine, promptId: number): Promise<PromptVersionRow[]> {
  return qe
    .selectFrom('prompt_versions')
    .selectAll()
    .where('prompt_id', '=', promptId)
    .orderBy('version_no', 'asc')
    .execute();
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
