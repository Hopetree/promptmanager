-- 001_init.sql —— promptmanager 初始 schema（阶段 1 数据模型草案）
-- 约定：时间一律 ISO 8601 UTC（Z 结尾、毫秒精度），由应用层写入（BRIEF §6.1）。
-- journal_mode / foreign_keys 等 PRAGMA 由连接层设置（见 src/db/index.ts），不在迁移里改。

-- 单用户（FR-1）；口令只存哈希
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

-- 服务端会话（D-6）；cookie 里只放随机 sid，本表不含明文口令
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 登录失败计数窗口（FR-1 限流）
CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL,
  remote_addr  TEXT,
  succeeded    INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_window ON login_attempts(username, attempted_at);

-- 文件夹树（FR-4）：parent_id 为空表示根
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
-- 同一父下不允许重名（根目录的 parent_id 是 NULL，用表达式索引把 NULL 归一化后比较）
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name
  ON folders(COALESCE(parent_id, -1), name);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id, sort_order, id);

-- 标签（FR-5）：名字唯一，改名为已存在名字即"合并"
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

-- prompt 主体（FR-2）：version_no 指向 prompt_versions 中最新一版
CREATE TABLE IF NOT EXISTS prompts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL DEFAULT '',
  user_prompt   TEXT    NOT NULL DEFAULT '',
  system_prompt TEXT    NOT NULL DEFAULT '',
  notes         TEXT    NOT NULL DEFAULT '',
  folder_id     INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  favorite      INTEGER NOT NULL DEFAULT 0,
  version_no    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_updated_at ON prompts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_folder ON prompts(folder_id);

-- 版本历史（FR-7）：每次内容变更留档，升序 version_no，不删历史
CREATE TABLE IF NOT EXISTS prompt_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id     INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version_no    INTEGER NOT NULL,
  title         TEXT    NOT NULL DEFAULT '',
  user_prompt   TEXT    NOT NULL DEFAULT '',
  system_prompt TEXT    NOT NULL DEFAULT '',
  notes         TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  UNIQUE(prompt_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version_no);

-- prompt ↔ tag 多对多
CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_prompt_tags_tag ON prompt_tags(tag_id);

-- 全文检索（FR-6 / D-3）：FTS5 trigram 分词器，中文可用；
-- <3 字符的查询由应用层走 LIKE 兜底（trigram 对 <3 字符 0 命中，见 docs/search-zh.md）。
-- 采用 external content 表 + 触发器，保证索引随 prompts 增删改同步（BRIEF §6.6）。
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  title,
  user_prompt,
  system_prompt,
  notes,
  content='prompts',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS prompts_fts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, title, user_prompt, system_prompt, notes)
  VALUES (new.id, new.title, new.user_prompt, new.system_prompt, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, title, user_prompt, system_prompt, notes)
  VALUES ('delete', old.id, old.title, old.user_prompt, old.system_prompt, old.notes);
END;

CREATE TRIGGER IF NOT EXISTS prompts_fts_au AFTER UPDATE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, title, user_prompt, system_prompt, notes)
  VALUES ('delete', old.id, old.title, old.user_prompt, old.system_prompt, old.notes);
  INSERT INTO prompts_fts(rowid, title, user_prompt, system_prompt, notes)
  VALUES (new.id, new.title, new.user_prompt, new.system_prompt, new.notes);
END;
