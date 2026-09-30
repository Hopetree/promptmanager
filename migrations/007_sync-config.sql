-- 007_sync-config.sql —— 阶段 59 / FR-125 / D-57：远程数据同步（手动推 / 拉全量快照到 GitHub 私有仓库）
--
-- 背景（用户 2026-09-29 原话「我需要给我们的提示词项目添加远程数据同步功能，手动触发即可，
-- 也就是实现配置，触发即可」）：
-- 给库一个「用户自己控制的、带 commit 历史的异地副本」—— 需要时手动推上去、手动取回来。
--
-- 本迁移只建**一张单例配置表**（`id = 1` 恒为唯一行），存 4 项必填 + 1 项可选：
--   · repo     —— 归一化后的 `owner/repo`
--   · instance —— 实例标识（仅 `[A-Za-z0-9._-]`），参与拼路径
--   · path     —— 目标文件路径（必须含 `promptmanager/` 且以 `<instance>.json` 收尾）
--   · branch   —— 缺省 `main`
--   · token_enc —— **GitHub token 的密文**（AES-256-GCM，复用 `src/services/token-crypto.ts`
--                 的 `<DATA_DIR>/token-enc.key`；**绝不存明文、不进 env** —— 见 D-57 ②：
--                 env 不便在界面改、改动要重启）
--
-- 为什么是单例表而不是 key-value 表：配置项固定且一体读写（PUT 全量覆盖），
-- `CHECK (id = 1)` 让"只能有一行"成为**数据库层**的约束，而不是只靠应用层自觉。
--
-- 表里**不含**任何加密密钥/凭据明文；`token_enc` 即使被读走，没有 `<DATA_DIR>/token-enc.key`
-- 也解不开（与 api_tokens.token_enc 同一套机制）。
--
-- 幂等：由 schema_migrations 记录版本号保证只执行一次（与 001–006 同一机制），
--       且 `CREATE TABLE IF NOT EXISTS` 本身也可重复执行。

CREATE TABLE IF NOT EXISTS sync_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  repo TEXT NOT NULL,
  instance TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
