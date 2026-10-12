-- 009_fts-update-when.sql — 阶段 68 / FR-140（来源：设计评审 F10）/ D-66 ①
--
-- 问题：001_init.sql 的 prompts_fts_au（AFTER UPDATE ON prompts）**没有 WHEN 子句** ⇒ 对 prompts 的
-- **任何** UPDATE 都会 delete + insert 整行 FTS ⇒ 改收藏 / 拖拽排序 / 切「记住变量值」/ 移动目录
-- 这些**不碰被索引列**的写入，也在无谓地重建全文索引。
--
-- 做法：新迁移里 DROP 旧触发器 + 重建**带 WHEN** 的版本 —— 只在这 4 个被索引列
-- （title / user_prompt / system_prompt / notes）**真的变化时**才重建。
-- ⚠️ 为什么不在 001_init.sql 里改：那是**已应用**的迁移（AGENTS.md 硬规矩：已应用的迁移不许改，
-- 改了会让两份库的 schema 悄悄分叉，而"迁移幂等由版本表保证"救不了这个）。
--
-- 用 `IS NOT`（而不是 `<>`）比较：语义上是"值不同"，且对 NULL 也成立 —— 本表这几列都是 NOT NULL，
-- 但 `IS NOT` 不依赖这个前提，列的可空性将来变了也不会静默失效。
--
-- 幂等：`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`（不带 IF NOT EXISTS）⇒ 同一段 SQL 重复执行
-- 结果相同（触发器恰好一个），AC-130 ⑤ 有实测用例。
--
-- 不改：_ai（INSERT）/ _ad（DELETE）两个触发器照旧（FR-140 ② 明确不做），检索实现（FTS5 trigram + LIKE 兜底）也不动。

DROP TRIGGER IF EXISTS prompts_fts_au;

CREATE TRIGGER prompts_fts_au AFTER UPDATE ON prompts
WHEN old.title IS NOT new.title
  OR old.user_prompt IS NOT new.user_prompt
  OR old.system_prompt IS NOT new.system_prompt
  OR old.notes IS NOT new.notes
BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, title, user_prompt, system_prompt, notes)
  VALUES ('delete', old.id, old.title, old.user_prompt, old.system_prompt, old.notes);
  INSERT INTO prompts_fts(rowid, title, user_prompt, system_prompt, notes)
  VALUES (new.id, new.title, new.user_prompt, new.system_prompt, new.notes);
END;
