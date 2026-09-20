import type { QueryEngine } from '../db/index.js';
import { InvalidBodyError, NotFoundError, isConstraintError } from '../errors.js';
import { nowIso } from './auth.js';

/** 契约里的标签对象（BRIEF §6.1：id / name / count）。 */
export interface TagObject {
  id: number;
  name: string;
  count: number;
}

function requireName(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  if (name === '') throw new InvalidBodyError([{ path: 'name', message: '标签名不能为空' }]);
  return name;
}

function translateConstraint(error: unknown): never {
  if (isConstraintError(error)) {
    throw new InvalidBodyError([{ path: 'name', message: '标签名已存在' }]);
  }
  throw error;
}

async function countForTag(qe: QueryEngine, tagId: number): Promise<number> {
  const row = await qe
    .selectFrom('prompt_tags')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('tag_id', '=', tagId)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

/** 标签列表（FR-5）：每个标签带 prompt 计数，按名称升序。 */
export async function listTags(qe: QueryEngine): Promise<TagObject[]> {
  const rows = await qe
    .selectFrom('tags as t')
    .leftJoin('prompt_tags as pt', 'pt.tag_id', 't.id')
    .select((eb) => ['t.id as id', 't.name as name', eb.fn.count<number>('pt.prompt_id').as('count')])
    .groupBy(['t.id', 't.name'])
    .orderBy('t.name', 'asc')
    .execute();
  return rows.map((row) => ({ id: row.id, name: row.name, count: Number(row.count) }));
}

export async function createTag(qe: QueryEngine, rawName: string | undefined): Promise<TagObject> {
  const name = requireName(rawName);
  const existing = await qe.selectFrom('tags').select('id').where('name', '=', name).executeTakeFirst();
  if (existing !== undefined) {
    throw new InvalidBodyError([{ path: 'name', message: `标签「${name}」已存在` }]);
  }

  const now = nowIso();
  try {
    const inserted = await qe
      .insertInto('tags')
      .values({ name, created_at: now, updated_at: now })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { id: inserted.id, name: inserted.name, count: 0 };
  } catch (error) {
    translateConstraint(error);
  }
}

/**
 * 改名（FR-5）：若目标名字已被别的标签占用 → **合并**（把源标签的关联重指向目标标签后删除源标签），
 * 返回存活的那个标签；否则普通改名。
 */
export async function renameTag(qe: QueryEngine, id: number, rawName: string | undefined): Promise<TagObject> {
  const name = requireName(rawName);
  const source = await qe.selectFrom('tags').selectAll().where('id', '=', id).executeTakeFirst();
  if (source === undefined) throw new NotFoundError();

  if (source.name === name) {
    return { id: source.id, name: source.name, count: await countForTag(qe, source.id) };
  }

  const target = await qe.selectFrom('tags').selectAll().where('name', '=', name).executeTakeFirst();
  if (target === undefined) {
    await qe.updateTable('tags').set({ name, updated_at: nowIso() }).where('id', '=', id).execute();
    return { id, name, count: await countForTag(qe, id) };
  }

  await qe.transaction().execute(async (trx) => {
    const links = await trx.selectFrom('prompt_tags').select('prompt_id').where('tag_id', '=', id).execute();
    for (const link of links) {
      await trx
        .insertInto('prompt_tags')
        .values({ prompt_id: link.prompt_id, tag_id: target.id })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    await trx.deleteFrom('prompt_tags').where('tag_id', '=', id).execute();
    await trx.deleteFrom('tags').where('id', '=', id).execute();
  });

  return { id: target.id, name: target.name, count: await countForTag(qe, target.id) };
}

export async function deleteTag(qe: QueryEngine, id: number): Promise<void> {
  const result = await qe.deleteFrom('tags').where('id', '=', id).executeTakeFirst();
  if (Number(result.numDeletedRows ?? 0) === 0) throw new NotFoundError();
}
