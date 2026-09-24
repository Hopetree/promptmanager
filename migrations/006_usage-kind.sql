-- 006_usage-kind.sql —— 阶段 50 / FR-114：取用语义修正（「打开详情」不算取用）
--
-- 背景（用户原话「打开详情不要算，只有真的复制才是使用」）：
-- 修复前有两个记账点 —— `GET /api/prompts/:id`（打开详情）与 `POST /api/prompts/:id/render`（渲染取用），
-- 而 `use_count` 是实时聚合 `usage_events` 算出来的 ⇒ "只是点开看了看"也会让「取用 N 次」+1。
-- 但 `usage_events` 当时没有"事件类型"字段 ⇒ 历史数据无法区分"打开"与"复制"。
--
-- 本迁移加一列 `kind`（取值 'view' / 'copy' / 'mcp'）：
--   · view = 打开详情（**留痕，但不计数**）
--   · copy = 复制 / 渲染取用（计数）
--   · mcp  = MCP 取用（计数）
--   · 缺省值 = 'copy'
--
-- **历史数据不重算**：存量行一律置 'copy' ⇒ 老数字不变、不丢数据、不改写历史。
-- （用户已明确接受"历史记录里混着一些打开记录"这个既成事实 —— 无法回溯区分。）
--
-- 幂等：由 schema_migrations 记录版本号保证只执行一次（与 001–005 同一机制）；
--       且 `UPDATE ... WHERE kind IS NULL` 本身也可重复执行（第二次是 no-op）。
-- 兼容：`kind` 可空，服务层把 NULL 视作 'copy'（与存量回填口径一致）。

ALTER TABLE usage_events ADD COLUMN kind TEXT;

UPDATE usage_events SET kind = 'copy' WHERE kind IS NULL;
