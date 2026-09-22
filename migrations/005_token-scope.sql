-- 005_token-scope.sql —— 阶段 42 / FR-103（令牌权限两档）+ FR-104（取用归因）：两处加列，同一个迁移
--
-- 背景（用户定调「token 做成只读/读写两种，并且都只针对资源」）：
-- 修复前 Bearer 令牌是**全权** —— 除 reveal 外，枚举令牌、新建令牌（响应还带明文 ⇒ 可自我繁殖）、撤销/硬删、
-- 甚至改口令都能用令牌调。一处泄漏 = 永久全权，且攻击者能再造新钥匙。
--
-- 本迁移做两件事：
--   ① `api_tokens.scope`（取值 'read' / 'write'）：
--      · **存量行一律置 'write'** —— 迁移不能把已经在用的 MCP / 技能令牌悄悄降权（否则它们的写操作会突然 403）；
--      · **新建由代码显式写入，缺省 'read'**（最小权限）—— 见 `src/services/tokens.ts` 的 `createToken`。
--   ② `usage_events.token_id`（nullable）：
--      · 令牌取用记该令牌 id；cookie 会话取用记 NULL（会话没有"令牌"可言）；
--      · 让"谁取的"可归因（此前只有 channel，出事后查不出是哪把令牌）。
--
-- 幂等：由 schema_migrations 记录版本号保证只执行一次（与 001–004 同一机制）。
-- 兼容：`scope` 可空，服务层把 NULL 视作 'write'（与存量回填口径一致），避免历史数据被误降权。

ALTER TABLE api_tokens ADD COLUMN scope TEXT;

UPDATE api_tokens SET scope = 'write' WHERE scope IS NULL;

ALTER TABLE usage_events ADD COLUMN token_id INTEGER;
