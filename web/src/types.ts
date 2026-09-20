/** 服务端契约类型（BRIEF §6.1 / §6.4；字段名固定，改了就会和 AC 对不上）。 */

export interface Prompt {
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
  use_count: number;
  last_used_at: string | null;
}

export interface PromptListResponse {
  total: number;
  limit: number;
  offset: number;
  items: Prompt[];
}

/** POST/PUT 的可写字段（BRIEF §6.1） */
export interface PromptWritable {
  title?: string;
  user_prompt?: string;
  system_prompt?: string;
  notes?: string;
  folder_id?: number | null;
  tags?: string[];
  favorite?: boolean;
}

export interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface VersionSummary {
  version_no: number;
  created_at: string;
  title: string;
}

export interface RenderResult {
  user_prompt: string;
  system_prompt: string;
  missing: string[];
}

/**
 * 列表筛选（界面本地状态；映射到 `GET /api/prompts` 的查询参数）。
 * v17 取消「管理页」后，筛选是唯一页面的状态，因此类型上移到契约旁边的共享层。
 */
export interface PromptListFilters {
  q: string;
  folderId: number | null;
  tag: string | null;
  favorite: boolean;
  /** FR-70 / D-28：updated（最近更新）/ recent_used（最近使用）/ custom（自定义顺序） */
  sort: 'updated' | 'recent_used' | 'custom';
  page: number;
  pageSize: number;
}

export interface UsageSummary {
  days: number;
  total: number;
  by_channel: { session: number; token: number; mcp: number };
  top: Array<{ prompt_id: number; title: string; count: number; last_used_at: string | null }>;
}

export interface TokenSummary {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** 创建 token 的响应：**明文只在这一个响应里出现一次**（BRIEF §5）。 */
export interface CreatedToken extends TokenSummary {
  token: string;
}

export interface ImportResult {
  mode: 'replace' | 'merge';
  imported: { folders: number; tags: number; prompts: number };
}

export interface ExportFile {
  app: string;
  schema_version: number;
  exported_at: string;
  folders: unknown[];
  tags: unknown[];
  prompts: unknown[];
}
