# 中文检索方案实测报告（S0，阶段 1 产出）

> 对应：BRIEF §6.6 检索语义契约、D-3、FR-6；验收 AC-6 / AC-7（在阶段 3 逐条验收）。
> 复现命令：`node tools/search-zh-poc.mjs`（本报告输出即该脚本的原样输出）。
> 复现环境：228 / CentOS Stream 9 / Node v24.18.0 / better-sqlite3 13.0.3（SQLite 3.53.4）。
> 复现时间：2026-09-18；**复核时间：2026-09-20（上线准备 P1）**。

## 0. 复核记录（2026-09-20，上线准备 P1）

- **重跑**：`node tools/search-zh-poc.mjs` → **rc=0**，八节输出与 2026-09-18 首跑**逐条同结论**；
  2000 条规模基线本次为 `MATCH 0.20 ms / LIKE 0.20 ms / LIKE(2 码点) 0.19 ms`（首跑 0.22/0.22/0.21 —— 同一量级，差异是测量噪声）。
- **实现未变**：两条分支（FTS5 `trigram` + `<3` 码点 `LIKE` 兜底）仍是当前代码形态
  （`src/db/search.ts` 的 `isFtsQuery` / `ftsMatchExpression` / `likePattern`；`src/db/prompt-queries.ts` 的两条路径），
  阶段 6/22/23 只在这两条路径上叠加了 JOIN 与筛选（使用统计 / 排序档 / 目录含子项），**没有改检索语义**。
- **结论仍然有效**，无需修订；HTTP 端到端（AC-7：2000 条语料 `?q=会话交接` 三次 `time_total < 0.5 s` 且 `total=2000`）
  由 `bash tools/ac-stage3.sh` 复跑（最近一次全量回归中为 ✅）。

## 1. 结论（先行）

1. **必须用 FTS5 `trigram` 分词器**：默认 `unicode61` 只在**分词边界**偶然命中，
   无法做中文子串检索（`交接文档`、`上下文`、`交接` 全部 0 命中）。
2. **`trigram` 有硬性长度下限：查询 < 3 个 Unicode 码点必然 0 命中**（`交接`/`会话`/`AI` 全 0）。
   中文两字词极常见 ⇒ **必须**有 `<3 码点走 `LIKE '%q%'` 兜底`** 的分支（BRIEF §6.6 已定）。
3. **长度归一化必须按 Unicode 码点计数**：`[...q].length`，不能用 `q.length`
   （`"👍👍"` 的 `length` 是 4、码点是 2；把 emoji 查询误判为 ≥3 会静默 0 命中）。
4. **特殊字符不构成风险**：把查询词整体当**字面短语**（外层加 `"`、内部 `"` 双写转义）后，
   `"` `*` `-` `a-b` `C++` `100%` `(` `)` `_` `%` 等全部返回 0 命中且**不抛错**。
5. **性能可用**：2000 条中文记录下，`MATCH` 与 `LIKE` 兜底的最短耗时均在 **0.2 ms 量级**。
6. **英文大小写不敏感**：`rebase` 与 `REBASE` 同样命中；`bm25` 能把高频命中的记录排在前面。

## 2. 与 BRIEF §6.8 的实测差异（如实记录）

BRIEF §6.8 记录「`unicode61` 对照：`会话交接`/`交接`/`上下文` 全部 0 命中」。
本次复测结果**不完全一致**：`unicode61` 下 `会话交接` = **1 命中**，`交接文档`/`上下文` = 0。

**原因**（可复核）：语料 `会话交接：把工作上下文交给下一个同学` 里的全角冒号 `：` 是分词分隔符，
`unicode61` 把冒号前的 `会话交接` 切成了一个**完整 token**，于是整词查询恰好命中。
这属于"在分隔符边界偶然命中"，**不是子串检索能力**：换个上下文（`交接文档`、`上下文`）立刻 0 命中。

**对决策的影响：无。** 结论仍然是"默认分词器对中文不可用，必须 trigram + LIKE 兜底"（D-3 不变）。
本报告以本次实测为准，BRIEF §6.8 该行的数字在 host_manger 复核时可据此更新。

## 3. 原样输出

```
=== 1. 环境 ===
sqlite_version = 3.53.4
node           = v24.18.0
better-sqlite3 = 13.0.3

=== 2. 中文语料：trigram vs unicode61（对照） ===
query			trigram	unicode61
会话交接			1	1
会话			0	0
交接文档			1	0
交接			0	0
上下文			2	0
rebase			1	1
FTS5			1	1
无关词汇			0	0

=== 3. trigram 的长度下限（<3 字符） ===
MATCH "交接" → 0 命中   (码点数 = 2)
MATCH "会话" → 0 命中   (码点数 = 2)
MATCH "上下文" → 2 命中   (码点数 = 3)
MATCH "AI" → 0 命中   (码点数 = 2)

=== 4. LIKE 兜底（同一语料） ===
LIKE '%交接%' → 2 命中
LIKE '%会话%' → 1 命中
LIKE '%上下文%' → 2 命中
LIKE '%AI%' → 1 命中

=== 5. 特殊字符作为 MATCH 短语（必须不报错） ===
MATCH "\"" → 0 命中
MATCH "*" → 0 命中
MATCH "-" → 0 命中
MATCH "a-b" → 0 命中
MATCH "C++" → 0 命中
MATCH "100%" → 0 命中
MATCH "(" → 0 命中
MATCH ")" → 0 命中
MATCH "_" → 0 命中
MATCH "%" → 0 命中
MATCH "\"unclosed" → 0 命中
MATCH "it's" → 0 命中

=== 6. 2000 条中文记录规模基线 ===
MATCH "会话交接"   → 2000 命中 / 最短 0.22 ms
LIKE  '%会话交接%' → 2000 命中 / 最短 0.22 ms
LIKE  '%交接%'     → 2000 命中 / 最短 0.21 ms

=== 7. 长度归一化必须按 Unicode 码点（JS 里用 [...s].length，不是 s.length） ===
"交接" → s.length=2  码点数=2
"session" → s.length=7  码点数=7
"café" → s.length=4  码点数=4
"👍👍" → s.length=4  码点数=2

=== 8. 英文大小写不敏感 + bm25 相关性排序（trigram） ===
MATCH "rebase" → 1 命中；MATCH "REBASE" → 1 命中
bm25 排序（SQLite 返回负分，越负越相关；升序即相关性降序）：rowid=52(4.551)  rowid=1(4.209)  rowid=53(3.398)

=== 结论 ===
trigram：中文 ≥3 码点可用；<3 码点 0 命中 → 必须 LIKE 兜底
unicode61：只在分词边界偶然命中（"："、"、" 等分隔符处），中文子串检索不可用
特殊字符加引号 + 内部引号转义后全部不报错
英文大小写不敏感（rebase / REBASE 同命中）；bm25 可把高频命中排前
2000 条规模下 MATCH 与 LIKE 均在亚毫秒级
```

## 4. 已落地的实现（阶段 1）

**schema（`migrations/001_init.sql`）**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  title, user_prompt, system_prompt, notes,
  content='prompts', content_rowid='id',
  tokenize='trigram'
);
```

- 用 **external content** 表（索引不重复存正文，省空间），配 `AFTER INSERT/UPDATE/DELETE` 三个触发器，
  保证索引随 `prompts` 增删改同步（BRIEF §6.6 要求"索引必须随增删改同步维护"；回滚与导入写的是 `prompts`，因此同样被覆盖）。
- 迁移已由 `tests/migrate.test.ts` 验证：trigram 对 `会话交接` 命中、对 `交接`（2 码点）0 命中、
  `LIKE` 兜底命中、`foreign_keys` 生效。

**查询层（阶段 3 实现，契约先定死）**

| 分支 | 触发条件 | SQL 形态 | 排序 |
| --- | --- | --- | --- |
| FTS5 | `[...q.trim()].length >= 3` | `prompts_fts MATCH '"<q，内部 " 双写>"'` | `bm25(prompts_fts)` 升序，同级 `updated_at DESC` |
| LIKE 兜底 | `[...q.trim()].length < 3` | `(title LIKE ? ESCAPE '\' OR user_prompt LIKE ? …)`，`%`/`_`/`\` 转义 | `updated_at DESC` |
| 空查询 | `q` 缺省/空 | 无 WHERE | `updated_at DESC` |

**注意点**

- `bm25` 在小语料（如 2~3 行）里会出现**同分**，此时必须靠 `updated_at DESC` 决出稳定顺序——AC-7 观测的是规模语料（2000 条），不受影响。
- `LIKE '%…%'` 是**全表扫描**：2000 行 0.2 ms 完全够用；若将来数据量到 10 万行量级需要重新评估
  （届时可考虑把 2 码点查询也拆成两个 trigram 前缀/或用外部分词器），已在"已知限制"里留档。

## 5. 待阶段 3 验收的对应项

- AC-6：三种长度（≥3 / 2 / 0 命中）+ 特殊字符不 500。
- AC-7：2000 条语料下 `?q=会话交接` 三次 `time_total` 均 < 0.5 s 且 `total=2000`。
