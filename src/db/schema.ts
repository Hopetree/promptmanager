import type { Generated, Selectable } from 'kysely';
import type { PromptColumn, PromptColumnTsType, PromptGeneratedColumn } from '../prompt-columns.js';

/** Kysely 表类型（列名与 migrations/001_init.sql 一致）。时间统一为 ISO 8601 UTC 字符串。 */

export interface UsersTable {
  id: Generated<number>;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  id: string; // sha256(token) 的十六进制；cookie 里放原始 token（见 services/auth.ts）
  user_id: number;
  created_at: string;
  expires_at: string;
}

export interface LoginAttemptsTable {
  id: Generated<number>;
  username: string;
  remote_addr: string | null;
  succeeded: number; // 0/1
  attempted_at: string;
}

export interface FoldersTable {
  id: Generated<number>;
  name: string;
  parent_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TagsTable {
  id: Generated<number>;
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * FR-138 / D-64：**派生**自 `src/prompt-columns.ts` 的列清单，本文件不再手写字段表。
 *
 * 这里只做一件事：给清单里 `generated: true` 的列（`id` / `sort_order`，列上有 `DEFAULT`）套上
 * kysely 的 `Generated<>` 标记 —— 这是**唯一无法干净派生的一层**（kysely 的列包装类型），
 * 因此保留在此处，标记本身仍来自同一份清单（D-64 ②）。
 *
 * 列的语义注释（`favorite` 的 0/1、`remember_variables` 的 FR-127、`sort_order` 的 FR-70 等）
 * 随列清单走：见 `src/prompt-columns.ts`。
 */
export type PromptsTable = {
  [K in PromptColumn]: K extends PromptGeneratedColumn
    ? Generated<PromptColumnTsType<K>>
    : PromptColumnTsType<K>;
};

export interface PromptVersionsTable {
  id: Generated<number>;
  prompt_id: number;
  version_no: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  created_at: string;
}

export interface ApiTokensTable {
  id: Generated<number>;
  name: string;
  token_hash: string; // sha256(明文) hex（64 字符）—— **鉴权唯一依据**（FR-94 后语义不变）
  token_enc: string | null; // FR-94：AES-256-GCM 密文 base64(nonce‖tag‖ciphertext)；存量行为 NULL（不可恢复）
  scope: string | null; // FR-103：'read' | 'write'（**只作用于资源**）；迁移把存量回填为 'write'，服务层把 NULL 视作 'write'
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface UsageEventsTable {
  id: Generated<number>;
  prompt_id: number;
  channel: string; // 'session' | 'token' | 'mcp'
  used_at: string;
  token_id: number | null; // FR-104：令牌取用记该令牌 id；cookie 会话取用记 NULL（可归因"谁取的"）
  /**
   * FR-114：事件类型（迁移 006）—— `view` 打开详情（留痕**不计数**）/ `copy` 复制·渲染（计数）/
   * `mcp` MCP 取用（计数）。可空：迁移已把存量行回填成 `copy`，服务层把 NULL 也视作 `copy`。
   */
  kind: string | null;
}

export interface PromptTagsTable {
  prompt_id: number;
  tag_id: number;
}

/**
 * FR-125 / D-57：远程同步配置（**单例表**，`id = 1` 恒为唯一行，迁移 007）。
 * `token_enc` 是 GitHub token 的 AES-256-GCM 密文（复用 token-crypto）——**表里没有明文**。
 */
export interface SyncConfigTable {
  id: number;
  repo: string; // 归一化后的 `owner/repo`
  instance: string; // 实例标识，仅 `[A-Za-z0-9._-]`
  path: string; // 目标文件路径，必须含 `promptmanager/` 且以 `<instance>.json` 收尾
  branch: string; // 缺省 `main`
  token_enc: string; // 密文 base64(nonce‖tag‖ciphertext)
  updated_at: string;
}

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  applied_at: string;
}

export interface PromptsFtsTable {
  rowid: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  login_attempts: LoginAttemptsTable;
  folders: FoldersTable;
  tags: TagsTable;
  prompts: PromptsTable;
  prompt_versions: PromptVersionsTable;
  prompt_tags: PromptTagsTable;
  prompts_fts: PromptsFtsTable;
  api_tokens: ApiTokensTable;
  usage_events: UsageEventsTable;
  sync_config: SyncConfigTable;
  schema_migrations: SchemaMigrationsTable;
}

export type PromptRow = Selectable<PromptsTable>;
export type FolderRow = Selectable<FoldersTable>;
export type TagRow = Selectable<TagsTable>;
export type UserRow = Selectable<UsersTable>;
