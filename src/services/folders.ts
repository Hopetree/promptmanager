import { sql } from 'kysely';
import type { QueryEngine } from '../db/index.js';
import type { FolderRow } from '../db/schema.js';
import { ConflictError, InvalidBodyError, NotFoundError, isConstraintError } from '../errors.js';
import { nowIso } from './auth.js';

/** 契约里的文件夹对象（BRIEF §6.1：id / name / parent_id / sort_order）。 */
export interface FolderObject {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

export interface CreateFolderInput {
  name: string;
  parent_id?: number | null;
  sort_order?: number;
}

export interface UpdateFolderInput {
  name?: string;
  parent_id?: number | null;
  sort_order?: number;
}

function toFolderObject(row: FolderRow): FolderObject {
  return { id: row.id, name: row.name, parent_id: row.parent_id, sort_order: row.sort_order };
}

function requireName(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  if (name === '') throw new InvalidBodyError([{ path: 'name', message: '文件夹名不能为空' }]);
  return name;
}

async function assertFolderExists(qe: QueryEngine, id: number): Promise<void> {
  const row = await qe.selectFrom('folders').select('id').where('id', '=', id).executeTakeFirst();
  if (row === undefined) {
    throw new InvalidBodyError([{ path: 'parent_id', message: `父文件夹 ${id} 不存在` }]);
  }
}

/** candidate 是否是 ancestor 的后代（沿 parent 链向上走；遇到既有环也保守返回 true）。 */
async function isDescendant(qe: QueryEngine, ancestorId: number, candidateId: number): Promise<boolean> {
  const seen = new Set<number>();
  let current: number | null = candidateId;
  while (current !== null) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const row = await qe
      .selectFrom('folders')
      .select('parent_id')
      .where('id', '=', current)
      .executeTakeFirst();
    current = row?.parent_id ?? null;
  }
  return false;
}

function translateConstraint(error: unknown): never {
  if (isConstraintError(error)) {
    throw new InvalidBodyError([{ path: 'name', message: '同一父文件夹下已存在同名文件夹' }]);
  }
  throw error;
}

/** 文件夹列表（FR-4）：扁平返回 parent_id，排序按 sort_order, id（前端建树）。 */
export async function listFolders(qe: QueryEngine): Promise<FolderObject[]> {
  const rows = await qe
    .selectFrom('folders')
    .selectAll()
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows.map(toFolderObject);
}

export async function createFolder(qe: QueryEngine, input: CreateFolderInput): Promise<FolderObject> {
  const name = requireName(input.name);
  const parentId = input.parent_id ?? null;
  if (parentId !== null) await assertFolderExists(qe, parentId);

  const now = nowIso();
  try {
    const inserted = await qe
      .insertInto('folders')
      .values({
        name,
        parent_id: parentId,
        sort_order: input.sort_order ?? 0,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toFolderObject(inserted);
  } catch (error) {
    translateConstraint(error);
  }
}

export async function updateFolder(
  qe: QueryEngine,
  id: number,
  patch: UpdateFolderInput,
): Promise<FolderObject> {
  const existing = await qe.selectFrom('folders').selectAll().where('id', '=', id).executeTakeFirst();
  if (existing === undefined) throw new NotFoundError();

  const name = patch.name === undefined ? existing.name : requireName(patch.name);
  const parentId = patch.parent_id === undefined ? existing.parent_id : patch.parent_id;

  if (parentId !== null) {
    if (parentId === id) {
      throw new InvalidBodyError([{ path: 'parent_id', message: '不能把文件夹挂到自己下面' }]);
    }
    await assertFolderExists(qe, parentId);
    if (await isDescendant(qe, id, parentId)) {
      throw new InvalidBodyError([{ path: 'parent_id', message: '不能把文件夹挂到自己的后代下面（会成环）' }]);
    }
  }

  try {
    const updated = await qe
      .updateTable('folders')
      .set({
        name,
        parent_id: parentId,
        sort_order: patch.sort_order ?? existing.sort_order,
        updated_at: nowIso(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toFolderObject(updated);
  } catch (error) {
    translateConstraint(error);
  }
}

/** 删除文件夹：有子文件夹或有 prompt 归属 → 409 folder_not_empty（BRIEF §6.1）。 */
export async function deleteFolder(qe: QueryEngine, id: number): Promise<void> {
  const existing = await qe.selectFrom('folders').select('id').where('id', '=', id).executeTakeFirst();
  if (existing === undefined) throw new NotFoundError();

  const child = await qe
    .selectFrom('folders')
    .select('id')
    .where('parent_id', '=', id)
    .limit(1)
    .executeTakeFirst();
  if (child !== undefined) throw new ConflictError('folder_not_empty');

  const prompt = await qe
    .selectFrom('prompts')
    .select('id')
    .where('folder_id', '=', id)
    .limit(1)
    .executeTakeFirst();
  if (prompt !== undefined) throw new ConflictError('folder_not_empty');

  await qe.deleteFrom('folders').where('id', '=', id).execute();
}

/**
 * FR-70 / D-28：**同一父级下**的文件夹重排（`sort_order = 1..N`，`parent_id` 不变）。
 * - 校验：ids 不得为空 / 不得重复 / 每个 id 都必须存在且 `parent_id` 与传入一致
 *   （跨父级移动**本期不做** → 不一致直接 400 `invalid_body`）；
 * - 幂等：同样的 ids 再调一次结果相同；只改 `sort_order`，不动 `updated_at`。
 */
export async function reorderFolders(qe: QueryEngine, parentId: number | null, ids: number[]): Promise<void> {
  if (ids.length === 0) {
    throw new InvalidBodyError([{ path: 'ids', message: 'ids 不得为空（需要该层级内的完整顺序）' }]);
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const seen = new Set<number>();
    const duplicated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    throw new InvalidBodyError([{ path: 'ids', message: `ids 不得重复：${[...new Set(duplicated)].join(', ')}` }]);
  }
  const rows = await qe.selectFrom('folders').select(['id', 'parent_id']).where('id', 'in', ids).execute();
  const byId = new Map(rows.map((row) => [row.id, row.parent_id]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new InvalidBodyError([{ path: 'ids', message: `以下 folder id 不存在：${missing.join(', ')}` }]);
  }
  const wrongParent = ids.filter((id) => (byId.get(id) ?? null) !== parentId);
  if (wrongParent.length > 0) {
    throw new InvalidBodyError([
      { path: 'ids', message: `以下文件夹不属于 parent_id=${String(parentId)}（本期不支持跨父级移动）：${wrongParent.join(', ')}` },
    ]);
  }

  await qe.transaction().execute(async (trx) => {
    for (const [index, id] of ids.entries()) {
      await trx
        .updateTable('folders')
        .set({ sort_order: index + 1 })
        .where('id', '=', id)
        .execute();
    }
  });
}

/**
 * FR-72 / D-29：`rootId` 及其**全部后代**文件夹 id（任意深度，含自身）。
 * 列表筛选与侧栏计数（`inclusiveCount`）统一到这个口径：点父目录 = 看它和所有子目录里的 prompt。
 * - 根 id 不存在时返回 `[]`（调用方据此让筛选命中 0 条，而不是报错）；
 * - 用 `WITH RECURSIVE` 一条 SQL 取完，避免 N 次往返；`folders` 表结构不变（无迁移）。
 */
export async function descendantFolderIds(qe: QueryEngine, rootId: number): Promise<number[]> {
  const result = await sql<{ id: number }>`
    WITH RECURSIVE sub(id) AS (
      SELECT ${rootId} AS id
      UNION ALL
      SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
    )
    SELECT id FROM sub
  `.execute(qe);
  return result.rows.map((row) => row.id);
}
