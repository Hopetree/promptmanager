# docs/ 目录索引

> **规则**（见 [`development.md`](development.md) §「文档通道」）：`docs/` **只放最终状态文档**；
> 过程产物一律进 `tmp/`（不入 git），历史过程记录进 [`dev-history/`](dev-history/README.md)。
> 本文件用来回答一个问题：**这个目录里的每个文件是什么、还算不算数。**

## 最终状态文档（会随版本更新，读它 = 读当前口径）

| 文件 | 角色 | 何时读 |
| --- | --- | --- |
| [`api.md`](api.md) | **HTTP API / CLI / MCP 接口参考**：认证、环境变量、端点、契约、错误码 | 写集成 / 调接口 / 改端点时 |
| [`development.md`](development.md) | **开发者文档**：环境搭建、常用命令、项目结构、验证脚本 | 上手开发时 |
| [`dependencies.md`](dependencies.md) | **依赖台账**：每个直接依赖的版本 / 协议 / 用途 + 未引入的包（有意为之） | 增删依赖时 |
| [`versioning.md`](versioning.md) | **版本管理细则**：semver 判据、tag 约定、发版流程与**发版检查单**、`schema_version` | 发版时 |
| [`search-zh.md`](search-zh.md) | **中文检索方案实测报告**（FTS5 trigram + LIKE 回退，2000 条基线）—— `BRIEF.md` 引为**权威记录** | 动检索实现前 |

## 历史 / 留档（不再更新，读它 = 读当时的口径）

| 文件 | 角色 | 说明 |
| --- | --- | --- |
| [`dev-history/`](dev-history/README.md) | **完整过程记录**：每条 AC 的命令与原样输出、逐张识图、决策与踩坑 | 有索引页 |
| [`ui-verification-report.md`](ui-verification-report.md) | **阶段 54 全面 UI 验证报告**（42 张截图逐张读图）| 当时验收的**固定交付物**，`VERIFY.md` 直接引用它 → **有意保留在此，不移入 dev-history** |
| [`brief-changelog.md`](brief-changelog.md) | `BRIEF.md` §12 变更记录的**外移存量**（**只覆盖 v1–v32**）| v33 及之后仍在 `BRIEF.md` §12 |
| [`shots/`](shots/) | 界面截图素材（README / 文档引用） | 低频更新 |

## 两条容易搞错的边界

1. **`docs/` 不是草稿区**。写过程记录、临时对账、探索笔记 → `tmp/`（`.gitignore` 已忽略，永不入库）。
2. **判"是不是最终状态"的标准是"还会不会变"**：接口参考、依赖台账、版本规则会随版本更新但**始终代表当前口径** ⇒ 属 `docs/`；
   阶段验收流水账、逐条 AC 输出 ⇒ 属 `dev-history/` 或 `tmp/`。
