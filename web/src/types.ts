/** 服务端契约类型（BRIEF §6.1 / §6.4；字段名固定，改了就会和 AC 对不上）。 */

import type { PromptEntity, PromptWritable as PromptWritableShape } from '../../src/prompt-columns.js';

/**
 * FR-138 / D-64：字段集**派生**自 `src/prompt-columns.ts`（服务端与前端共用同一份列清单）。
 * 这里只做 type-only 引用 —— 构建时被抹掉，不进 bundle。
 */
export type Prompt = PromptEntity;

export interface PromptListResponse {
  total: number;
  limit: number;
  offset: number;
  items: Prompt[];
  /**
   * FR-141：只有请求里带 `include=folder_counts` 才出现。
   * `{ [folder_id]: 条目数 }`（含子文件夹，与 `?folder_id=X` 的 `total` 同口径）；计数失败是 `null`。
   */
  folder_counts?: Record<string, number> | null;
}

/** POST/PUT 的可写字段（BRIEF §6.1）—— 与 `Prompt` 派生自同一份清单。 */
export type PromptWritable = PromptWritableShape;

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

/** FR-134：replace 导入对取用历史做了什么（`cleared` = 被级联清空，`kept` = merge 原样保留）。 */
export interface UsageHistoryReport {
  action: 'cleared' | 'kept';
  count: number;
  /** 清空前留下的备份文件绝对路径（没有东西可留时为 null）。 */
  backup: string | null;
}

export interface ImportResult {
  mode: 'replace' | 'merge';
  imported: { folders: number; tags: number; prompts: number };
  usage_history: UsageHistoryReport;
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
  /** FR-134：取用历史的去向（replace 会级联清空，必须如实回报）。 */
  usage_history: UsageHistoryReport;
  remote_sha: string;
  /** `replace` 前自动写的本地快照文件名（`merge` 时为 null）。 */
  snapshot: string | null;
  snapshot_kept: number;
}
