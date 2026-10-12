/** 列表查询串的组装（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁；行为未变）。 */

export interface PromptListQueryParams {
  q?: string;
  folderId?: number | null;
  tag?: string;
  favorite?: boolean;
  sort?: 'updated' | 'recent_used' | 'custom';
  limit?: number;
  offset?: number;
  /** FR-141：让响应带上全部文件夹的条目数（一次请求替代 N+1）。 */
  includeFolderCounts?: boolean;
}

/**
 * 组装 `GET /api/prompts` 的查询串（BRIEF §6.1 的 q/folder_id/tag/favorite/sort/limit/offset）。
 * 空串/纯空白不发参数；`sort=updated` 是默认值，不显式发；`favorite=false` 是有效筛选，必须发。
 */
export function buildPromptListQuery(params: PromptListQueryParams): string {
  const search = new URLSearchParams();
  const q = params.q?.trim();
  if (q !== undefined && q !== '') search.set('q', q);
  if (params.folderId !== undefined && params.folderId !== null) {
    search.set('folder_id', String(params.folderId));
  }
  const tag = params.tag?.trim();
  if (tag !== undefined && tag !== '') search.set('tag', tag);
  if (params.favorite !== undefined) search.set('favorite', String(params.favorite));
  if (params.sort === 'recent_used' || params.sort === 'custom') search.set('sort', params.sort);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.includeFolderCounts === true) search.set('include', 'folder_counts');
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}
