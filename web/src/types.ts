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
  /** FR-127：这个提示词是否记住填过的变量值（默认 true）。开关存在服务端，变量值仍只存 localStorage。 */
  remember_variables: boolean;
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
  /** FR-127：省略 = 保持原值（PUT）/ 默认记住（POST）。 */
  remember_variables?: boolean;
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
  /** FR-94：明文是否还能再查看（= 库里存了密文）。存量 token 为 false（不可恢复，建议撤销后重建）。 */
  revealable: boolean;
  /** FR-103：令牌权限 —— `read` 只读（检索/查看/渲染）、`write` 读写（还能改资源）。 */
  scope: 'read' | 'write';
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

// ───────────────────────── FR-125 远程数据同步（阶段 59） ─────────────────────────

/** `GET/PUT /api/sync/config` 的响应：**只回脱敏形状**，绝不含 token 明文。 */
export interface SyncConfigView {
  configured: boolean;
  repo: string;
  instance: string;
  path: string;
  branch: string;
  /** 库里是否已存令牌（密文）。 */
  token_set: boolean;
  /** 令牌尾 4 位（只用于让用户确认"是不是这把"）。 */
  token_tail: string | null;
}

/** `PUT /api/sync/config` 的请求体：`token` 省略 = 沿用库里已有的。 */
export interface SyncConfigInput {
  repo: string;
  instance: string;
  path: string;
  token?: string;
  branch?: string;
}

/** `POST /api/sync/test` 的结果：`stage` 是机器可读的区分度，`message` 是中文可执行提示。 */
export interface SyncTestResult {
  ok: boolean;
  stage: 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'no_file' | 'rate_limited' | 'network' | 'upstream';
  message: string;
  repo: string;
  path: string;
  branch: string;
  file_exists: boolean | null;
  file_sha: string | null;
  can_push: boolean | null;
  default_branch: string | null;
}

/** `POST /api/sync/push` 的结果（`dry_run: true` 时 `commit_sha` 为 null）。 */
export interface SyncPushResult {
  dry_run: boolean;
  repo: string;
  path: string;
  branch: string;
  prompts: number;
  folders: number;
  tags: number;
  bytes: number;
  exists: boolean;
  action: 'create' | 'overwrite';
  current_sha: string | null;
  remote_sha: string | null;
  commit_sha: string | null;
  attempts: number;
  exported_at: string;
}

/** `POST /api/sync/pull` 的结果。 */
export interface SyncPullResult {
  mode: 'merge' | 'replace';
  imported: { folders: number; tags: number; prompts: number };
  remote_sha: string;
  /** `replace` 前自动写的本地快照文件名（`merge` 时为 null）。 */
  snapshot: string | null;
  snapshot_kept: number;
}
