-- 002_tokens-and-usage.sql —— 阶段 6：外部客户端凭据（API Token）与使用记录（usage）
-- 约定：时间一律 ISO 8601 UTC（Z 结尾、毫秒精度），由应用层写入。

-- API Token（FR-15 / D-13）：明文**只在创建时返回一次**，库里只存 sha256(明文) 的 hex。
CREATE TABLE IF NOT EXISTS api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,   -- sha256 hex（64 字符）
  created_at   TEXT    NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

-- 使用记录（FR-19 / D-17）：只记"取用"（打开详情 / render / MCP 取用），不记列表与搜索。
-- 不参与导入导出（§6.4 的 ExportFile 结构不变），写它也不得触碰 prompts 行。
CREATE TABLE IF NOT EXISTS usage_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  channel   TEXT    NOT NULL CHECK (channel IN ('session', 'token', 'mcp')),
  used_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_events_prompt ON usage_events(prompt_id, used_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_used_at ON usage_events(used_at);
