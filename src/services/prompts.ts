import type { QueryEngine } from '../db/index.js';
import { pruneVersions } from '../db/prompt-versions.js';
import { searchPrompts } from '../db/prompt-queries.js';
import type { PromptRow } from '../db/schema.js';
import { InvalidBodyError, NotFoundError, isConstraintError } from '../errors.js';
import { nowIso } from './auth.js';
import { descendantFolderIds } from './folders.js';
import { usageStatsOf, type UsageStats } from './usage.js';

/** 契约里的 Prompt 对象（BRIEF §6.1；字段名固定）。 */
export interface PromptObject {
  id: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  tags: string[];
  favorite: boolean;
  created_at: string;
  updated_at: string;
  version_no: number;
  /** 只读：被"取用"（详情/渲染/MCP）的次数（FR-19） */
  use_count: number;
  /** 只读：最后一次取用时间（ISO 8601），从未取用为 null（FR-19） */
  last_used_at: string | null;
}

export interface CreatePromptInput {
  title?: string;
  user_prompt?: string;
  system_prompt?: string;
  notes?: string;
  folder_id?: number | null;
  tags?: string[];
  favorite?: boolean;
}

export interface UpdatePromptInput {
  title?: string;
  user_prompt?: string;
  system_prompt?: string;
  notes?: string;
  folder_id?: number | null;
  tags?: string[];
  favorite?: boolean;
}

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
  return {
    id: row.id,
    title: row.title,
    user_prompt: row.user_prompt,
    system_prompt: row.system_prompt,
    notes: row.notes,
    folder_id: row.folder_id,
    tags,
    favorite: row.favorite === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version_no: row.version_no,
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
  const values = {
    title: input.title ?? '',
    user_prompt: input.user_prompt ?? '',
    system_prompt: input.system_prompt ?? '',
    notes: input.notes ?? '',
    folder_id: input.folder_id ?? null,
    favorite: input.favorite === true ? 1 : 0,
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
 * 更新 prompt（FR-2 / FR-7）：只改传入的字段；**每次 PUT 都产生新版本**
 * （BRIEF §6.1「更新（可写字段的子集）→ 产生新版本」，不区分值是否真的变了）。
 * 提供 `tags` 时整体替换标签集合；`folder_id: null` 表示移出文件夹。
 */
export async function updatePrompt(
  qe: QueryEngine,
  id: number,
  patch: UpdatePromptInput,
): Promise<PromptObject> {
  const existing = await qe.selectFrom('prompts').selectAll().where('id', '=', id).executeTakeFirst();
  if (existing === undefined) throw new NotFoundError();

  const now = nowIso();
  const next = {
    title: patch.title ?? existing.title,
    user_prompt: patch.user_prompt ?? existing.user_prompt,
    system_prompt: patch.system_prompt ?? existing.system_prompt,
    notes: patch.notes ?? existing.notes,
    folder_id: patch.folder_id === undefined ? existing.folder_id : patch.folder_id,
    favorite: patch.favorite === undefined ? existing.favorite : patch.favorite ? 1 : 0,
    version_no: existing.version_no + 1,
    updated_at: now,
  };

  try {
    await qe.transaction().execute(async (trx) => {
      await trx.updateTable('prompts').set(next).where('id', '=', id).execute();

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

      // FR-86：PUT 每次都产生新版本 ⇒ 每次都要裁剪到最近 10 个
      await pruneVersions(trx as QueryEngine, id);

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
      throw new InvalidBodyError([{ path: 'body', message: 'folder_id 引用了不存在的文件夹' }]);
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
 * - `favorite` / `move` 复用**单条 PUT 的语义**（写目标列 + `version_no` 递增 + 留一条版本快照 + 更新 `updated_at`），
 *   保证"同一条 prompt 无论走单条还是批量，字段与版本号变化相同"；未选中的条目**一个字段都不动**。
 */
export async function bulkPrompts(qe: QueryEngine, input: BulkPromptsInput): Promise<BulkPromptsResult> {
  const { action, ids } = input;
  const rows = await loadPromptsForIds(qe, ids);

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

  const now = nowIso();
  const byId = new Map(rows.map((row) => [row.id, row]));
  await qe.transaction().execute(async (trx) => {
    for (const id of ids) {
      const row = byId.get(id);
      if (row === undefined) continue;
      const next = {
        ...(action === 'favorite' ? { favorite: 1 } : { folder_id: input.folder_id ?? null }),
        version_no: row.version_no + 1,
        updated_at: now,
      };
      await trx.updateTable('prompts').set(next).where('id', '=', id).execute();
      await trx
        .insertInto('prompt_versions')
        .values({
          prompt_id: id,
          version_no: next.version_no,
          title: row.title,
          user_prompt: row.user_prompt,
          system_prompt: row.system_prompt,
          notes: row.notes,
          created_at: now,
        })
        .execute();
      // FR-86：批量收藏/移动**也**会产生新版本（与单条 PUT 同语义），所以同样是"产生新版本之后"的写入点，
      // 必须一起裁剪 —— 否则"最多 10 个"这条数据层不变式会被批量操作打破（BRIEF 列了四处，这里是第五处）。
      await pruneVersions(trx as QueryEngine, id);
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
