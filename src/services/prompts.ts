import type { QueryEngine } from '../db/index.js';
import { pruneVersions } from '../db/prompt-versions.js';
import { searchPrompts } from '../db/prompt-queries.js';
import type { PromptRow } from '../db/schema.js';
import { constraintKind, InvalidBodyError, NotFoundError, isConstraintError } from '../errors.js';
import {
  promptCreateColumns,
  promptEntityColumnsFrom,
  promptPatchColumns,
  type PromptEntity,
  type PromptWritable,
} from '../prompt-columns.js';
import { nowIso } from './auth.js';
import { descendantFolderIds } from './folders.js';
import { usageStatsOf, type UsageStats } from './usage.js';

/**
 * 契约里的 Prompt 对象（BRIEF §6.1；字段名固定）。
 * FR-138 / D-64：字段集**派生**自 `src/prompt-columns.ts` 的列清单，本文件不再手写字段表。
 */
export type PromptObject = PromptEntity;

/** `POST /api/prompts` 的可写字段（派生；`tags` 不是列，单独声明在那份清单里）。 */
export type CreatePromptInput = PromptWritable;

/** `PUT /api/prompts/:id` 的可写字段（派生；与 create 同一份字段集，PUT 不设 required）。 */
export type UpdatePromptInput = PromptWritable;

export interface ListPromptsParams {
  /** 检索词（FR-6）；空/纯空白 = 不过滤 */
  q?: string | undefined;
  folderId?: number | undefined;
  tag?: string | undefined;
  favorite?: boolean | undefined;
  /**
   * 排序：默认 updated_at 倒序；recent_used = 最近使用倒序（从未用过排最后）；
   * custom（FR-70 / D-28）= 用户拖拽出来的 sort_order, id 升序
   */
  sort?: 'updated' | 'recent_used' | 'custom' | undefined;
  limit: number;
  offset: number;
}

export interface ListPromptsResult {
  total: number;
  items: PromptObject[];
}

function toPromptObject(row: PromptRow, tags: string[], usage: UsageStats): PromptObject {
  // FR-138：逐字段映射由列清单派生（`favorite` / `remember_variables` 的 0/1 → true/false 也在那里）。
  return {
    ...promptEntityColumnsFrom(row),
    tags,
    use_count: usage.use_count,
    last_used_at: usage.last_used_at,
  };
}

/** 一次取回多个 prompt 的标签（按标签名升序，与契约一致）。 */
async function tagsByPrompt(qe: QueryEngine, promptIds: number[]): Promise<Map<number, string[]>> {
  const grouped = new Map<number, string[]>();
  if (promptIds.length === 0) return grouped;

  const rows = await qe
    .selectFrom('prompt_tags')
    .innerJoin('tags', 'tags.id', 'prompt_tags.tag_id')
    .select(['prompt_tags.prompt_id as prompt_id', 'tags.name as name'])
    .where('prompt_tags.prompt_id', 'in', promptIds)
    .orderBy('tags.name', 'asc')
    .execute();

  for (const row of rows) {
    const list = grouped.get(row.prompt_id) ?? [];
    list.push(row.name);
    grouped.set(row.prompt_id, list);
  }
  return grouped;
}

async function findOrCreateTag(qe: QueryEngine, name: string, now: string): Promise<number> {
  const existing = await qe.selectFrom('tags').select('id').where('name', '=', name).executeTakeFirst();
  if (existing !== undefined) return existing.id;

  const inserted = await qe
    .insertInto('tags')
    .values({ name, created_at: now, updated_at: now })
    .onConflict((oc) => oc.column('name').doNothing())
    .returning('id')
    .executeTakeFirst();

  if (inserted !== undefined) return inserted.id;
  const raced = await qe.selectFrom('tags').select('id').where('name', '=', name).executeTakeFirstOrThrow();
  return raced.id;
}

/** 新建 prompt：写主体 + 首版留档（version_no=1）+ 标签关联，全程单事务。 */
function normalizeTagNames(raw: string[]): string[] {
  return [...new Set(raw.map((tag) => tag.trim()).filter((tag) => tag !== ''))];
}

export async function createPrompt(qe: QueryEngine, input: CreatePromptInput): Promise<PromptObject> {
  const now = nowIso();
  const tags = normalizeTagNames(input.tags ?? []);
  // FR-138：可写列的值由列清单派生（缺省取清单上的 `default`：字符串 ''、folder_id null、
  // favorite false、remember_variables true —— FR-127 / D-59 ② 的"默认记住"就在那份清单里）。
  const values = {
    ...promptCreateColumns(input),
    version_no: 1,
    created_at: now,
    updated_at: now,
  };

  let promptId: number;
  try {
    promptId = await qe.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto('prompts').values(values).returning('id').executeTakeFirstOrThrow();
      const id = inserted.id;

      await trx
        .insertInto('prompt_versions')
        .values({
          prompt_id: id,
          version_no: 1,
          title: values.title,
          user_prompt: values.user_prompt,
          system_prompt: values.system_prompt,
          notes: values.notes,
          created_at: now,
        })
        .execute();

      // FR-86：每次产生新版本后统一裁剪（新建只有 v1，这里是"覆盖全部写入点"的一部分，防止将来改动漏掉）
      await pruneVersions(trx as QueryEngine, id);

      for (const name of tags) {
        const tagId = await findOrCreateTag(trx as QueryEngine, name, now);
        await trx.insertInto('prompt_tags').values({ prompt_id: id, tag_id: tagId }).execute();
      }
      return id;
    });
  } catch (error) {
    if (isConstraintError(error)) {
      throw new InvalidBodyError([{ path: 'body', message: 'folder_id/tags 引用了不存在的记录' }]);
    }
    throw error;
  }

  const created = await getPrompt(qe, promptId);
  if (created === null) throw new Error('创建后无法回读 prompt');
  return created;
}

export async function getPrompt(qe: QueryEngine, id: number): Promise<PromptObject | null> {
  const row = await qe.selectFrom('prompts').selectAll().where('id', '=', id).executeTakeFirst();
  if (row === undefined) return null;
  const [tags, usage] = await Promise.all([tagsByPrompt(qe, [row.id]), usageStatsOf(qe, row.id)]);
  return toPromptObject(row, tags.get(row.id) ?? [], usage);
}

/**
 * 列表 + 检索 + 筛选（FR-3 / FR-6）：SQL 走 src/db/prompt-queries.ts 的 searchPrompts，
 * 这里只负责把行映射成契约对象（并批量补齐每个 prompt 的标签）。
 */
export async function listPrompts(qe: QueryEngine, params: ListPromptsParams): Promise<ListPromptsResult> {
  // FR-72 / D-29：folder_id 筛选 = **含全部后代**（与侧栏 inclusiveCount 同口径）
  const folderIds =
    params.folderId === undefined ? undefined : await descendantFolderIds(qe, params.folderId);
  const { total, rows } = await searchPrompts(qe, {
    q: params.q ?? '',
    folderIds,
    tag: params.tag,
    favorite: params.favorite,
    sort: params.sort,
    limit: params.limit,
    offset: params.offset,
  });

  const tags = await tagsByPrompt(
    qe,
    rows.map((row) => row.id),
  );

  return {
    total,
    items: rows.map((row) =>
      toPromptObject(row, tags.get(row.id) ?? [], {
        use_count: Number(row.use_count ?? 0),
        last_used_at: row.last_used_at ?? null,
      }),
    ),
  };
}

/**
 * FR-129 / D-60 ③：**内容字段** = `prompt_versions` 装得下、且回滚能恢复的那 4 个。
 *
 * 只有它们的值**真的变了**（`!==`，不是"请求里带了这个字段"）才产生新版本、才更新 `updated_at`；
 * 其余可写字段（`folder_id` / `favorite` / `remember_variables` / 标签）改多少遍都不碰版本号
 * （BRIEF FR-129 ① / D-60 ③：这个边界**固定为 4 个，不新增也不减少**）。
 */
export const CONTENT_FIELDS = ['title', 'user_prompt', 'system_prompt', 'notes'] as const;

export type ContentField = (typeof CONTENT_FIELDS)[number];

/** 4 个内容字段里是否有值真的变了（逐字比较，不做 trim / 归一化 —— FR-129 的判据是"值真的变了"）。 */
export function hasContentChange(
  existing: Pick<PromptRow, ContentField>,
  next: Pick<PromptRow, ContentField>,
): boolean {
  return CONTENT_FIELDS.some((field) => existing[field] !== next[field]);
}

/**
 * 更新 prompt（FR-2 / FR-7 / **FR-129**）：只改传入的字段。
 *
 * **FR-129（阶段 62）行为契约变更**：`version_no` / `updated_at` / 版本快照**只在内容字段真的变化时**才动 ——
 * 收藏 / 移动目录 / 切「记住变量值」/ 改标签这些非内容操作，版本号不动、不写快照、`updated_at` 也不碰
 * （`updated_at` 从此是「内容最后变更时间」，D-60 ①；「置顶」用 `favorite`，不借 `updated_at`）。
 * 传了内容字段但值与旧值相同 ⇒ 同样不动（FR-129 ②）。
 * 提供 `tags` 时整体替换标签集合；`folder_id: null` 表示移出文件夹。
 */
export async function updatePrompt(
  qe: QueryEngine,
  id: number,
  patch: UpdatePromptInput,
): Promise<PromptObject> {
  const now = nowIso();

  try {
    await qe.transaction().execute(async (trx) => {
      /**
       * FR-135 ①：`existing` 必须在**事务内**读。
       *
       * 它在事务外读时，`version_no` 是拿事务外的快照算的 ⇒ 两个并发 PUT 都算出同一个
       * `existing.version_no + 1`，后写的那条会撞 `UNIQUE(prompt_id, version_no)`
       * （SQLite 的写锁只保证写入串行，不保证"读-算-写"整体串行）⇒ 用户的这次编辑白丢。
       * 收进同一个事务后，读与写共享同一把锁：要么串行成功、要么给出可理解的错误。
       */
      const existing = await trx.selectFrom('prompts').selectAll().where('id', '=', id).executeTakeFirst();
      if (existing === undefined) throw new NotFoundError();

      /**
       * FR-138：可写列的值由列清单派生 —— 请求里给了的覆盖 `existing`，没给的保持原值。
       * 返回的键集合 = 全部可写列（4 个内容字段 + `folder_id` + `favorite` + `remember_variables`），
       * 与派生之前的写法逐字段一致（含 `favorite` / `remember_variables` 的 true/false → 1/0）。
       */
      const writable = promptPatchColumns(existing, patch);
      const content = {
        title: writable.title,
        user_prompt: writable.user_prompt,
        system_prompt: writable.system_prompt,
        notes: writable.notes,
      };
      // FR-129 ②：判据是"值真的变了"，不是"请求里带了这个字段"
      const contentChanged = hasContentChange(existing, content);
      const next = {
        ...writable,
        // 内容没变 ⇒ 版本号与 updated_at 原样写回（等于不动）；变了才 +1 / 取当前时间
        version_no: contentChanged ? existing.version_no + 1 : existing.version_no,
        updated_at: contentChanged ? now : existing.updated_at,
      };

      await trx.updateTable('prompts').set(next).where('id', '=', id).execute();

      // FR-129：只有内容真的变了才写版本快照 + 裁剪（非内容操作连快照都不写）
      if (contentChanged) {
        await trx
          .insertInto('prompt_versions')
          .values({
            prompt_id: id,
            version_no: next.version_no,
            title: next.title,
            user_prompt: next.user_prompt,
            system_prompt: next.system_prompt,
            notes: next.notes,
            created_at: now,
          })
          .execute();

        // FR-86：产生新版本之后统一裁剪到最近 10 个
        await pruneVersions(trx as QueryEngine, id);
      }

      if (patch.tags !== undefined) {
        await trx.deleteFrom('prompt_tags').where('prompt_id', '=', id).execute();
        for (const name of normalizeTagNames(patch.tags)) {
          const tagId = await findOrCreateTag(trx as QueryEngine, name, now);
          await trx
            .insertInto('prompt_tags')
            .values({ prompt_id: id, tag_id: tagId })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
      }
    });
  } catch (error) {
    if (isConstraintError(error)) {
      /**
       * FR-135 ②：按**类型**分派，不再一律甩"folder_id 引用了不存在的文件夹"。
       * 原来那种写法下，并发撞唯一约束的用户会照着 folder 提示去查一个根本不存在的问题，
       * 而这次编辑已经丢了 —— 报错必须指向真实原因。
       */
      const kind = constraintKind(error);
      if (kind === 'foreign_key') {
        throw new InvalidBodyError([{ path: 'body', message: 'folder_id 引用了不存在的文件夹' }]);
      }
      if (kind === 'unique') {
        throw new InvalidBodyError([
          { path: 'body', message: '这条提示词正被另一个写入占用（版本号冲突），请重试' },
        ]);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new InvalidBodyError([{ path: 'body', message: `数据约束冲突：${message}` }]);
    }
    throw error;
  }

  const updated = await getPrompt(qe, id);
  if (updated === null) throw new NotFoundError();
  return updated;
}

/** 删除 prompt（FR-2）：版本、标签关联由外键级联清理，FTS 索引由触发器同步。 */
export async function deletePrompt(qe: QueryEngine, id: number): Promise<void> {
  const result = await qe.deleteFrom('prompts').where('id', '=', id).executeTakeFirst();
  if (Number(result.numDeletedRows ?? 0) === 0) throw new NotFoundError();
}

/** FR-77：批量动作（BRIEF §4 FR-77 ⑥ 的 ① 方案 = 新增批量接口）。 */
export type BulkAction = 'favorite' | 'move' | 'delete';

export interface BulkPromptsInput {
  action: BulkAction;
  /** 选中的条目 id（非空、不重复、必须都存在） */
  ids: number[];
  /** 仅 `move` 需要：目标文件夹 id，`null` = 移回「未归类」 */
  folder_id?: number | null;
}

export interface BulkPromptsResult {
  action: BulkAction;
  /** 受影响条数 */
  affected: number;
}

/**
 * 校验 `ids`（FR-70/FR-77 共用口径）：非空 / 不重复 / 每个 id 都必须存在
 * （单用户下"不存在"即覆盖"越权"）→ 400 `invalid_body`。
 */
async function loadPromptsForIds(qe: QueryEngine, ids: number[]): Promise<PromptRow[]> {
  if (ids.length === 0) {
    throw new InvalidBodyError([{ path: 'ids', message: 'ids 不得为空' }]);
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const seen = new Set<number>();
    const duplicated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    throw new InvalidBodyError([{ path: 'ids', message: `ids 不得重复：${[...new Set(duplicated)].join(', ')}` }]);
  }
  const rows = await qe.selectFrom('prompts').selectAll().where('id', 'in', ids).execute();
  const known = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new InvalidBodyError([{ path: 'ids', message: `以下 prompt id 不存在：${missing.join(', ')}` }]);
  }
  return rows;
}

/**
 * FR-77 ⑥：**批量操作**（表格模式多选后的 批量收藏 / 批量移动 / 批量删除）——整批**一个事务**。
 *
 * 语义（PROGRESS 记录理由）：
 * - `favorite`：把选中条目**设为已收藏**（已是收藏的保持；不做"切换"）；
 * - `move`：把选中条目的 `folder_id` 设为 `folder_id`（`null` = 未归类）；目标文件夹必须存在；
 * - `delete`：删除选中条目（版本历史/标签关联由外键级联清理，与单条删除一致）。
 * - `favorite` / `move` 只写**目标列**：`favorite` / `folder_id` 都是**非内容字段**（FR-129 ①）
 *   ⇒ **不动 `version_no`、不写版本快照、不碰 `updated_at`**（与单条 `PUT` 的新语义一致 —— FR-129 ③）。
 *   未选中的条目**一个字段都不动**。
 */
export async function bulkPrompts(qe: QueryEngine, input: BulkPromptsInput): Promise<BulkPromptsResult> {
  const { action, ids } = input;
  // 只做校验（非空 / 不重复 / 都存在）—— 非内容操作不再需要旧行内容
  await loadPromptsForIds(qe, ids);

  if (action === 'delete') {
    await qe.transaction().execute(async (trx) => {
      await trx.deleteFrom('prompts').where('id', 'in', ids).execute();
    });
    return { action, affected: ids.length };
  }

  if (action === 'move') {
    if (input.folder_id === undefined) {
      throw new InvalidBodyError([{ path: 'folder_id', message: 'move 必须提供 folder_id（null = 未归类）' }]);
    }
    if (input.folder_id !== null) {
      const folder = await qe
        .selectFrom('folders')
        .select('id')
        .where('id', '=', input.folder_id)
        .executeTakeFirst();
      if (folder === undefined) {
        throw new InvalidBodyError([{ path: 'folder_id', message: `文件夹 ${String(input.folder_id)} 不存在` }]);
      }
    }
  }

  await qe.transaction().execute(async (trx) => {
    for (const id of ids) {
      // FR-129：收藏 / 移动都是非内容操作 ⇒ 只改目标列，版本号 / updated_at / 版本快照一概不动。
      const next = action === 'favorite' ? { favorite: 1 } : { folder_id: input.folder_id ?? null };
      await trx.updateTable('prompts').set(next).where('id', '=', id).execute();
    }
  });

  return { action, affected: ids.length };
}

/**
 * FR-70 / D-28 + **FR-75 / D-30（槽位保持）**：按给定顺序重排 prompt 的自定义位。
 * - 落库口径：**当前视图内的完整 id 序列**，位置即新顺序；幂等（同样的 ids 再调一次结果相同）；
 * - **槽位保持**：先把这些 id **当前占据的 `sort_order` 槽位**按 `sort_order, id` 升序取出，
 *   再把新顺序**依次分配回这些槽位**。于是：
 *   · 其他条目（不在 ids 里）的 `sort_order` **完全不变**；
 *   · 不会产生重复的 `sort_order`（槽位集合与 id 集合一一对应）；
 *   · 在**具体目录视图**里拖拽（只提交该目录的少数 id）**不会**把这组条目顶到全局最前
 *     （旧实现一律写 `1..N`，会把它们挪到最前并与其它条目撞号 —— 这是本次顺带修掉的既有缺陷）。
 * - 校验：ids 不得为空 / 不得重复 / 每个 id 都必须存在（单用户下"不存在"即覆盖"越权"）→ 400 `invalid_body`；
 * - 只改 `sort_order`，**不动** `updated_at` / 版本号 / 其它字段（拖拽不该产生新版本）。
 */
export async function reorderPrompts(qe: QueryEngine, ids: number[]): Promise<void> {
  if (ids.length === 0) {
    throw new InvalidBodyError([{ path: 'ids', message: 'ids 不得为空（需要当前视图内的完整顺序）' }]);
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const seen = new Set<number>();
    const duplicated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    throw new InvalidBodyError([{ path: 'ids', message: `ids 不得重复：${[...new Set(duplicated)].join(', ')}` }]);
  }
  const rows = await qe
    .selectFrom('prompts')
    .select(['id', 'sort_order'])
    .where('id', 'in', ids)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute();
  const known = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new InvalidBodyError([{ path: 'ids', message: `以下 prompt id 不存在：${missing.join(', ')}` }]);
  }

  // 槽位 = 这组 id 当前占据的 sort_order（升序）；新顺序依次落回这些槽位
  const slots = rows.map((row) => row.sort_order);
  const distinctSlots = new Set(slots).size === slots.length;

  await qe.transaction().execute(async (trx) => {
    if (distinctSlots) {
      for (const [index, id] of ids.entries()) {
        await trx
          .updateTable('prompts')
          .set({ sort_order: slots[index] ?? index + 1 })
          .where('id', '=', id)
          .execute();
      }
      return;
    }

    // 槽位有重复（典型：全新数据 `sort_order` 全是 0，或同值并列）——此时"把新顺序写回原槽位"无法表达顺序。
    // 处理：先把**全表**按当前 `(sort_order, id)` 归一化成 1..M（其他条目的相对顺序完全不变），
    // 再把新顺序落到这组 id 原本占据的**全局位次**上。之后所有拖拽都走上面的纯槽位分支（不重复、不顶到最前）。
    const all = await trx
      .selectFrom('prompts')
      .select('id')
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const allIds = all.map((row) => row.id);
    const positions = allIds
      .map((id, position) => (unique.has(id) ? position : -1))
      .filter((position) => position >= 0);
    const next = [...allIds];
    ids.forEach((id, index) => {
      const position = positions[index];
      if (position !== undefined) next[position] = id;
    });
    for (const [index, id] of next.entries()) {
      await trx
        .updateTable('prompts')
        .set({ sort_order: index + 1 })
        .where('id', '=', id)
        .execute();
    }
  });
}
