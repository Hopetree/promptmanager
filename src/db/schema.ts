import type { Generated, Selectable } from 'kysely';

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

export interface PromptsTable {
  id: Generated<number>;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  favorite: number; // 0/1
  version_no: number;
  /**
   * FR-70 / D-28：自定义排序位。列上有 `NOT NULL DEFAULT 0`（迁移 003），故插入可省略
   * （新建的 prompt 落在 0 → 排在既有 1..N 之前，与"最近更新"档下新条目置顶一致）。
   */
  sort_order: Generated<number>;
  created_at: string;
  updated_at: string;
}

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
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface UsageEventsTable {
  id: Generated<number>;
  prompt_id: number;
  channel: string; // 'session' | 'token' | 'mcp'
  used_at: string;
}

export interface PromptTagsTable {
  prompt_id: number;
  tag_id: number;
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
  schema_migrations: SchemaMigrationsTable;
}

export type PromptRow = Selectable<PromptsTable>;
export type FolderRow = Selectable<FoldersTable>;
export type TagRow = Selectable<TagsTable>;
export type UserRow = Selectable<UsersTable>;
