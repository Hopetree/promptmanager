import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { QueryEngine } from './index.js';
import type { PromptRow } from './schema.js';
import { ftsMatchExpression, isFtsQuery, likePattern, normalizeQuery, SEARCH_COLUMNS } from './search.js';

/**
 * 列表排序：默认按更新时间；`recent_used` 按最近使用（从未用过排最后）；
 * `custom`（FR-70 / D-28）按用户拖拽出来的 `sort_order, id` 升序。
 */
export type PromptSort = 'updated' | 'recent_used' | 'custom';

export interface PromptSearchParams {
  /** 原始查询词（未 trim）；空/纯空白 = 不过滤 */
  q: string;
  /**
   * FR-72：命中的文件夹 id 集合（**含全部后代**，由服务层用 `descendantFolderIds` 解析）。
   * 传 `[]` 表示"该文件夹不存在/没有可命中项" → 恒不匹配。
   */
  folderIds?: number[] | undefined;
  tag?: string | undefined;
  favorite?: boolean | undefined;
  sort?: PromptSort | undefined;
  limit: number;
  offset: number;
}

/** 列表行 = prompt 行 + 使用统计（一次 JOIN 拿到，避免 N+1）。 */
export type PromptSearchRow = PromptRow & { use_count: number | null; last_used_at: string | null };

export interface PromptSearchResult {
  total: number;
  rows: PromptSearchRow[];
  /** 本次实际走的路径：relevance = FTS5 bm25；recent = updated_at 倒序 */
  order: 'relevance' | 'recent';
}

/** folder_id / tag / favorite 三个筛选（对两条路径通用，全部参数化）。 */
function filterFragment(params: PromptSearchParams): RawBuilder<SqlBool> {
  const parts: Array<RawBuilder<unknown>> = [];
  if (params.folderIds !== undefined) {
    parts.push(
      params.folderIds.length === 0
        ? sql<SqlBool>`1 = 0`
        : sql<SqlBool>`p.folder_id in (${sql.join(params.folderIds.map((id) => sql`${id}`), sql`, `)})`,
    );
  }
  if (params.tag !== undefined) {
    parts.push(
      sql`exists (select 1 from prompt_tags pt join tags t on t.id = pt.tag_id where pt.prompt_id = p.id and t.name = ${params.tag})`,
    );
  }
  if (params.favorite !== undefined) {
    parts.push(sql`p.favorite = ${params.favorite ? 1 : 0}`);
  }
  if (parts.length === 0) return sql<SqlBool>`1 = 1`;
  return sql<SqlBool>`(${sql.join(parts, sql` and `)})`;
}

/** LIKE 兜底的字面匹配（title/user_prompt/system_prompt/notes 四列；ESCAPE '\'）。 */
function likeFragment(pattern: string): RawBuilder<SqlBool> {
  const columnLikes = SEARCH_COLUMNS.map((column) => sql`p.${sql.ref(column)} LIKE ${pattern} ESCAPE '\\'`);
  return sql<SqlBool>`(${sql.join(columnLikes, sql` or `)})`;
}

/**
 * 列表 + 检索的统一入口（FR-3 / FR-6 / FR-19）：
 * - 无 q 或 <3 码点 → LIKE 兜底（或不过滤）；≥3 码点 → FTS5 trigram `MATCH`（bm25 相关性排序）；
 * - `folderIds`（FR-72）对**两条路径**都生效：`p.folder_id IN (…含全部后代…)`；
 * - 两条路径都 LEFT JOIN 使用统计（`use_count` / `last_used_at` 随行返回，并可据此排序）；
 * - `sort=recent_used`：`(last_used_at IS NULL) ASC, last_used_at DESC, updated_at DESC, id DESC`（从未用过排最后）；
 * - `sort=custom`（FR-70）：`sort_order ASC, id ASC` —— 走 FTS 检索时也用它（用户的自定义顺序优先于 bm25 相关性）。
 * `total` 是命中总数（不受 limit/offset 影响）。
 */
export async function searchPrompts(qe: QueryEngine, params: PromptSearchParams): Promise<PromptSearchResult> {
  const q = normalizeQuery(params.q);
  const filters = filterFragment(params);
  const useFts = isFtsQuery(q);
  const recentUsed = params.sort === 'recent_used';
  const custom = params.sort === 'custom';

  // 每个 prompt 一行；LEFT JOIN 不会放大行数
  /**
   * FR-114：列表里的 `use_count` 必须与详情**同一口径** —— 只统计"真的取用"（copy/mcp），
   * 打开详情产生的 `kind='view'` 只留痕、不计入。`COALESCE` 给历史/手工插入的 NULL 行兜底（视作 copy）。
   */
  const usage = qe
    .selectFrom('usage_events')
    .select((eb) => [
      'prompt_id',
      eb.fn.countAll<number>().as('use_count'),
      eb.fn.max('used_at').as('last_used_at'),
    ])
    .where(sql<SqlBool>`coalesce(kind, 'copy') in ('copy', 'mcp')`)
    .groupBy('prompt_id')
    .as('u');

  if (useFts) {
    const match = ftsMatchExpression(q);
    const base = qe
      .selectFrom('prompts as p')
      .innerJoin('prompts_fts', 'prompts_fts.rowid', 'p.id')
      .leftJoin(usage, 'u.prompt_id', 'p.id')
      .where(sql<SqlBool>`prompts_fts MATCH ${match}`)
      .where(filters);

    const counted = await base.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();

    const rowsQuery = base.selectAll('p').select(['u.use_count as use_count', 'u.last_used_at as last_used_at']);
    const ordered = custom
      ? rowsQuery.orderBy('p.sort_order', 'asc').orderBy('p.id', 'asc')
      : recentUsed
        ? rowsQuery
            .orderBy(sql`(u.last_used_at is null)`, 'asc')
            .orderBy(sql`u.last_used_at`, 'desc')
            .orderBy('p.updated_at', 'desc')
            .orderBy('p.id', 'desc')
        : rowsQuery.orderBy(sql`bm25(prompts_fts)`, 'asc').orderBy('p.updated_at', 'desc').orderBy('p.id', 'desc');

    const rows = await ordered.limit(params.limit).offset(params.offset).execute();
    return { total: Number(counted.total), rows: rows as PromptSearchRow[], order: 'relevance' };
  }

  const searched = qe
    .selectFrom('prompts as p')
    .leftJoin(usage, 'u.prompt_id', 'p.id')
    .where(q === '' ? filters : likeFragment(likePattern(q)))
    .where(filters);

  const counted = await searched.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();

  const rowsQuery = searched.selectAll('p').select(['u.use_count as use_count', 'u.last_used_at as last_used_at']);
  const ordered = custom
    ? rowsQuery.orderBy('p.sort_order', 'asc').orderBy('p.id', 'asc')
    : recentUsed
      ? rowsQuery
          .orderBy(sql`(u.last_used_at is null)`, 'asc')
          .orderBy(sql`u.last_used_at`, 'desc')
          .orderBy('p.updated_at', 'desc')
          .orderBy('p.id', 'desc')
      : rowsQuery.orderBy('p.updated_at', 'desc').orderBy('p.id', 'desc');

  const rows = await ordered.limit(params.limit).offset(params.offset).execute();
  return { total: Number(counted.total), rows: rows as PromptSearchRow[], order: 'recent' };
}
