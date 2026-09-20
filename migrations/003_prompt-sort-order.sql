-- 003_prompt-sort-order.sql —— 阶段 22 / FR-70 / D-28：prompts 增加自定义排序位
--
-- 背景：folders 早就有 sort_order（001_init.sql）并可复用；prompts 没有。
-- 本迁移新增 `prompts.sort_order` 并把**既有数据按当前默认顺序**（最近更新倒序）回填成 1..N，
-- 保证"升级后列表顺序不变"（若全部留在默认 0，自定义档会退化成按 id 排序、顺序会乱）。
--
-- 新条目的语义：`DEFAULT 0` ⇒ 新建的 prompt 排在既有 1..N 之前（与"最近更新"档下新条目置顶一致）。
-- 幂等：由 `schema_migrations` 记录版本号保证只执行一次（重复执行 = 空操作，不会改动已有 sort_order）。

ALTER TABLE prompts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE prompts
SET sort_order = (
  SELECT ranked.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY updated_at DESC, id DESC) AS rn
    FROM prompts
  ) AS ranked
  WHERE ranked.id = prompts.id
);

CREATE INDEX IF NOT EXISTS idx_prompts_sort ON prompts(sort_order, id);
