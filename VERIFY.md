# promptmanager 验收报告（VERIFY）

> **完整验收记录已归档到 [`docs/dev-history/VERIFY.md`](docs/dev-history/VERIFY.md)** ——
> 那里有每次验收的**逐条 AC 实测输出、过程审查、缺口与风险、验收方失误留痕**（约 2700 行）。
> 本文件只保留**结论汇总**与**定位锚点**：要看细节，去归档文件里按标题检索（如搜「# 阶段 24 验收」）。
>
> 维护：host_manger（验收方）。

## 结论汇总

| # | 验收记录（归档里的标题） | 被验收 commit |
| --- | --- | --- |
| 1 | promptmanager 验收报告（VERIFY） | `2c82c9f`（dsh 阶段 1 收尾；验收时仓库 HEAD = `e61427c` = 我方 BRIEF v3，代码未变） |
| 2 | 我独立复现（自起服务 + 自截图） | — |
| 3 | 阶段 2 验收（认证与账号）— 结论：**过** | `02ec6bf`（阶段 2 收尾；本阶段共 7 次提交 `03f6db2`→`02ec6bf`） |
| 4 | 阶段 3 验收（prompt/folder/tag CRUD + 中文检索 + 列表筛选分页）— 结论：**过** | `b7eaf43`（阶段 3 收尾；本阶段 4 次提交 `0829b04`→`b7eaf43`，改动面 20 文件 / +2235 行） |
| 5 | 阶段 4 验收（版本历史 + 变量渲染 + Markdown 渲染与净化）— 结论：**过** | `d23c447`（阶段 4 收尾；4 次提交 `581e2b0`→`d23c447`，17 文件 / **+1952 −27**） |
| 6 | 阶段 5 验收（导入导出）— 结论：**过** | `181aa60`（阶段 5 收尾；本阶段提交 `fc25484`→`181aa60`，代码 HEAD 之上的 `cde2ef6`/`368 |
| 7 | 阶段 6 验收（对外可用面：Token / CORS / 使用侧 CLI / 使用记录 / 内外网部署形态）— 结论：**过** | `de3c93f`（阶段 6 收尾；本阶段 6 次提交 `6764efe`→`de3c93f`，三单元 6A/6B/6C） |
| 8 | 阶段 7 验收（MCP server，stdio 只读工具面）— 结论：**过** | `50d33c5`（阶段 7 收尾；本阶段 4 次提交 `04d7ec4`→`50d33c5`） |
| 9 | 阶段 8 验收（前端 P0：全 antd + 界面自证）— 结论：**过** | `b0cd81c`（阶段 8 收尾；本阶段 9 次提交 `27c82cf`→`b0cd81c`） |
| 10 | 阶段 9 验收（收尾：部署文件 / README 四要素 / 卫生 / FR-10b）— 结论：**过** | `6390ed2`（阶段 9 收尾；本阶段 5 次提交 `430543e`→`6390ed2`） |
| 11 | 项目总结论（P0 交付完成 · 2026-09-18） | — |
| 12 | 部署记录（host_manger 执行，2026-09-18） | — |
| 13 | 数据（如需彻底清除）：/var/lib/promptmanager（pm.db 等）——默认保留 | — |
| 14 | FIX-1 验收（unit 允许 AF_NETLINK）— 结论：**过**（2026-09-18 19:12） | `9aa5155`（`fix(deploy): FIX-1 — unit 允许 AF_NETLINK …`）+ 开工前 `026d64b` |
| 15 | 阶段 10B 验收（视觉重设计·全站应用，方向 A）— 结论：**过**，并**已上线** | `ff5aa35`（阶段 10B，5 次提交 `9716207`→`ff5aa35`） |
| 16 | 阶段 11 验收（使用优先改造）— 结论：**过**，并**已上线** | `1f9713b`（阶段 11；7 次提交 `5dfba25`→`1f9713b`，含一轮**自我识图修正**） |
| 17 | 阶段 11.1 验收（FIX-2：未填变量原样保留）— 结论：**过**，并**已上线** | `68ecb23`（`5f1fb0d` 实现 + `68ecb23` 收尾文档） |
| 18 | 阶段 12 验收（导航归位 + 信息克制）— 结论：**过**，并**已上线** | `7d92095`（`4c98d63` 实现 + `7d92095` 收尾文档） |
| 19 | 阶段 13 验收（取消管理页 + 主题图标 + 修新建自动入库）— 结论：**过**，并**已上线** | `1b2c6e7`（`9e3dfac` 实现 + `1b2c6e7` 收尾） |
| 20 | 阶段 14 验收（分栏视图 + 删除列表视图）— 结论：**过**，并**已上线** | `6c63d38`（`d5fc15b` 实现 + `6c63d38` 收尾） |
| 21 | 阶段 15 验收（顶栏重排 / 更多菜单 / 文件夹层级 / 标签胶囊云）— 结论：**过**，并**已上线** | `5574981`（`f3db85a` 实现 + `5574981` 收尾） |
| 22 | 阶段 16 验收（Logo/关于页/删装饰块/文件夹删除 FIX/编辑页返回/右栏排序/收藏/主题图标）— 结论：**过**，并**已上线** | `f74ede5`（`5a5e1d8` 实现 + `f74ede5` 收尾） |
| 23 | 阶段 17 验收（品牌图形全站统一：同一枚图标·多尺寸）— 结论：**过**，并**已上线** | `d9b6f13`（`49e5b32` 实现 + `d9b6f13` 收尾） |
| 24 | 阶段 18 验收（收尾清理 + 构建体积瘦身 + 编辑器全屏）— 结论：**过**，并**已上线** | `55712c9`（阶段 18 共 6 次提交：`6852a41` 清理 → `f112836` 瘦身 → `8873373` 全屏 → ` |
| 25 | 阶段 19 验收（编辑器全屏形态纠正 + 版本 diff 尾换行 + 复制兜底）— 结论：**过**，并**已同步到测试环境（8767）** | `dc7198f`（`7665228` 19B diff → `0a4c118` 19C 复制 → `9613acb` 19A 全屏 → ` |
| 26 | 阶段 20 验收（详情页去冗余头部 + ⋯更多「修改密码」）— 结论：**过**，并**已同步到测试环境（8767）** | `bce953d`（`feb83aa` 20B 后端 → `aad69cd` 20C 前端 → `a7452f5` 20D 自检 → `65 |
| 27 | 阶段 21 验收（备注=纯文本 + 详情页标题下备注）— 结论：**过**，并**已同步到测试环境（8767）** | `c1bedd7`（`6041aab` 实现 A+B → `342e4d1` 自检 → `c1bedd7` 收尾） |
| 28 | 阶段 22 验收（拖拽排序 + 分栏中栏精简）— 结论：**过**，并**已同步到测试环境（8767）** | `66d7345`（`30e25f0` feat(drag) → `e84e88a` test(ac) → `3e34961` test(r |
| 29 | 【事故与修复】阶段 22 上线后白屏（2026-09-20 15:2x，用户报"访问服务异常"） | — |
| 30 | 阶段 23 验收（文件夹筛选含子目录 + 卡片末行贴底 + 表格拖拽）— 结论：**过**，并**已同步到测试环境（8767）** | `74fdde2`（`2129bfd` feat(folder) → `35ba4e4` feat(ui) → `eac33e7` test |
| 31 | 阶段 24 验收（FR-75 修「卡片拖动根本不生效」+ 槽位保持）— 结论：**过**，并**已同步到测试环境（8767）** | `9a70f66`（`761faa1` 后端槽位保持 → `700f51b` 取消跨目录限制+本体可拖 → `5d7684d` AC 自检  |
| 32 | 阶段 25 验收（顶栏品牌文字 → `PromptM`）— 结论：**过**，并**已同步到测试环境（8767）** | `fadffde`（`5d9c995` 实现 → `16c2307` AC 自检 → `fadffde` 回归修订） |

## 说明

- 上表的「验收记录」= 归档文件里的一级标题；**结论都写在标题里**（`结论：过 / 不过`），细节在对应小节。
- **被验收 commit** = 该阶段最后一次实现方提交（收尾 commit）；**我的 VERIFY 提交**记录在对应小节内。
- 事故与修复类记录（如「阶段 22 上线后白屏」）也在上表中，按标题定位。
- **文件被整理过（2026-09-20 上线准备 P1）**：原 2741 行完整记录移入 `docs/dev-history/VERIFY.md`，未删任何内容。

---

# 上线准备 P1 验收（文档整理 + 产物清理）— 结论：**过**（2026-09-20，host_manger）

| 项 | 值 |
| --- | --- |
| 被验收 commit | `de180ee`（P1 收尾）—— 实现单元：`b80933b`(A1) / `f0e4203`(A2) / `9e53947`(A3) / `d863915`(A4) / `a4a56cd`+`9b5d560`(A5+悬空引用收尾) / `740bda9`(A6) / `23589df`(A7) / `d88a9f7`(B3) / `b123c2c`(B4) |
| 规格 | BRIEF **v33** 的 **AC-77 ①②**（文档整理 / 临时产物清理） |
| 结论 | **过**（另发现 1 个 **flaky 测试**，与本次无关，见 §4） |

## 1. 逐条核对（**我自己核，不采信它的对账表**）

```
① 零代码改动（对比 P1 前的 f90e3f9）：
   git diff --stat f90e3f9..HEAD -- src/ web/src/ tests/ migrations/ package.json  →  **空** ✅
② 归档完整性：
   docs/dev-history/PROGRESS.md  = 6822 行 / 45 个小节（与归档前一致）✅
   docs/dev-history/VERIFY.md    = 2741 行（与归档前一致）✅
   根目录 PROGRESS.md            = 82 行（精简版：当前状态 + 阶段索引 + 归档指引）✅
③ 删除项（应不存在）：tmp ✅ ／ var/cache ✅ ／ docs/shots/{before,before-stage8,compare,evidence} ✅ 全已删
④ 保留项（应存在）：docs/shots（顶层 **53 张 png**）✅ ／ dev-history/{PROGRESS.md,VERIFY.md,QUESTIONS-history.md,design,shots} ✅ 全在
⑤ README 关键项：含「阶段 1–25」✅ ／「52 个测试文件 / 285 个用例」✅ ／ 提到 `ac-stage25.sh` ✅ ／ 提到 `AC-76` ✅
⑥ 抽查「界面」章节：已按现状重写（顶栏 `PromptM` 简称 + 其余位置全名 / 默认分栏 + 三档 / 拖拽排序 / 文件夹筛选含子目录 /
   详情面备注行 + 修改密码）✅
```

## 2. 额外认可的处置（超出我的清单、但做对了）

- **主动修掉"归档/删除后的悬空引用"**（`9b5d560`）：`tools/design-compare.mjs` 的输入输出路径改到 `docs/dev-history/design/`、
  `tools/ac-stage8.sh` 不再断言已删除的 `docs/shots/before`、`tools/ui-shots.sh` 注释示例同步 —— **这是"归档"最容易漏的收尾**，它自己发现了。
- **如实留了 1 个它按纪律没改的遗留**：`web/src/theme.ts` 顶部注释仍指向旧路径（因"只动文档与产物、不动代码"），
  并在 `docs/dev-history/design/README-ARCHIVE.md` 里加了指向说明 —— **边界守得住、且留痕**。

## 3. `npm test`（我自己跑）

```
$ npm test → ℹ tests 285 / pass 284 / fail 1   （rc=1）
```
**失败项**：`tests/cli-user.test.ts:88`「CLI：改口令即吊销该用户既有会话」→ 断言 `null !== 0`（期望 `0`）。

## 4. ⚠️ 该失败是 **flaky**（不稳定），**与 P1 无关** —— 但上线前该修

**判定依据**：
- **与本次改动无关**：§1 ① 已证明 `src/`、`web/src/`、`tests/`、`migrations/`、`package.json` **零改动**；
- **单独重跑 3 次全绿**：`node --test tests/cli-user.test.ts` → **3/3 rc=0、6 个用例全过**；
- **失败形态**：`actual: null` —— `runCli` 返回的退出码为 `null` 意味着**子进程被信号终止**（不是断言逻辑错、不是业务错），
  只在 `npm test`（`node --test` **并发跑多个文件**）时偶发 ⇒ 典型的**并发资源竞争**（起子进程 / 端口 / 临时目录压力）。
- 它自己跑出的 285/285 全绿与我这跑的 284/285 不矛盾 —— **正是 flaky 的特征**。

**影响**：不阻塞 P1；但**"上线前的质量门"不该带 flaky**（CI 里会随机红、也会掩盖真回归）。
**建议**：放进 **P2**（CI + 版本号那批）一起处理 —— 让 dsh 查明并发冲突（或给该用例加隔离/串行标记），
并让**本地质量检查命令**在 CI 与本地跑出同一结果。

## 5. 缺口与建议

1. 上述 flaky（建议 P2 修）；
2. `.git` 体积仍 **100M**（历史里的截图 blob 还在）—— 这正是 **P4（git 重新初始化）**要解决的，属预期；
3. 我这份并行完成的：`BRIEF.md` v33（§12 变更历史外移到 `docs/brief-changelog.md`、§7 补全、AC-77、阶段 26）、
   `VERIFY.md` 归档（`f90e3f9`）、容器化文件（`7f1a05e`，P3，已实测）。

---

# 上线准备 P2 验收（CI 质量检查 + 版本号 1.0.0 + flaky 修复）— 结论：**不过**（A/B 全过，C 未彻底修好）

| 项 | 值 |
| --- | --- |
| 被验收 commit | `6bcb5c8`（P2 收尾）—— 实现单元：`e6a10ed`(B 版本+CHANGELOG) / `6595822`(A CI+本地脚本) / `9ba8886`(C flaky 修复) |
| 规格 | BRIEF **v33** 的 **AC-77 ③④**（质量与版本 / 零业务改动） |
| 结论 | **不过** —— **A（CI+本地同一套）过**、**B（版本与规划）过**、**C（flaky）未彻底修好** ⇒ 需返工一项 |

## 1. A（代码质量检查）— 过

```
✅ .github/workflows/ci.yml 存在：push/PR 触发、Node 24、`npm ci` → `bash tools/ci-check.sh`；**无 secrets、不部署、不 push**（A4 达成）
✅ tools/ci-check.sh 存在（101 行）：② typecheck:web + typecheck:tests → ③ npm test → ④ build + **体积预算（最大 chunk ≤500KB）**，
   逐项打印 rc 与关键输出并给汇总表 —— 与 workflow **同一脚本** ⇒ 「本地/CI 同一套」达成（A3）
✅ 我自己跑 `bash tools/ci-check.sh`：②a/②b/④a/④b **全绿**（typecheck 0 错误；build 无 >500KB 告警；最大 chunk 467,320 B）
❌ 唯一失败项是 ③ npm test（见 §3）
✅ README 新增「代码质量检查」章节（A2 的文档要求）
```

## 2. B（版本号与版本管理）— 过

```
✅ package.json version = **1.0.0**（B1）
✅ **healthz 版本单一来源**（B2）：源码核实 `src/config.ts:57 readVersion(projectRoot)` 读 `package.json` 的 `version` →
   `src/config.ts:146 version: readVersion(projectRoot)` → 路由 `{ status: 'ok', version: config.version }` ⇒ **确实无需改代码**，
   它的说法正确（并用"改 package.json → healthz 跟着变"做了证明）
✅ CHANGELOG.md 存在（62 行，Keep a Changelog 风格；按类型归并 v1.0.0，非流水账）
✅ docs/versioning.md 存在（77 行：semver 三位判据 / tag `v1.0.0` / 四步发版流程 / **schema_version 与项目版本解耦**）
```

## 3. C（flaky 修复）— **不过**（我的实测证据）

**它修好了一个**：`tests/cli-user.test.ts`（`spawn` 加 `detached: true` 独立进程组）—— **我跑的 8 次里它再没失败过** ✅

**但同类问题仍在，且根因比它分析的更广**：

| 我的实测 | 结果 |
| --- | --- |
| `bash tools/ci-check.sh`（我跑） | ❌ `npm test` 失败：**`tests/api-export.test.ts`** |
| `npm test` 连续 5 次（我跑） | 第 1/3/4/5 次全绿（285/285），**第 2 次失败**：**`tests/api-tokens.test.ts`**（282/281/1） |
| 再并发 2 次 + 串行 2 次 | 全绿 |
| **累计** | **并发 8 次中 2 次失败 ≈ 25%**，且**失败的文件每次不同** |

**失败形态（关键线索）**：`✖ tests/api-tokens.test.ts (1276ms)` + `'test failed'` —— **文件级失败、没有断言详情**；
而同一份日志里该文件的**子测试全是 ✔**。⇒ **不是业务断言错、不是子进程被杀**。

**⚠️ 它这次分析的边界**：它把根因锁定为"**子进程与测试运行器同进程组、被整体清理连带杀死**"（对照实验很漂亮），
但：
- 失败过的 **`api-export.test.ts` / `api-tokens.test.ts` 根本不 spawn 子进程**（文件里的 `child` 是"子文件夹"变量）；
- 而**真正 spawn 子进程**的四个文件里，**只有 `cli-user.test.ts` 加了 `detached`**（`cli-export` / `cli-get-render` / `cli-token` 没有）——
  这三者目前没被观察到失败，但**同类风险仍在**。
⇒ 结论：**它的修复只覆盖了"一类"flaky，而观测到的失败还有另一类（并发相关的文件级失败）没被解释。**

## 4. 返工清单（精确到文件 / 行为）

1. **让失败可诊断**（第一步，否则查不动）：现在失败只有 `'test failed'`，没有堆栈/断言。
   请让 `node --test` 在失败时输出**完整原因**（如 `--test-reporter=spec`，或捕获并打印该文件子进程的 stderr），
   并在 PROGRESS 里贴**一次真实失败**的完整输出（可临时降低并发把失败复现出来）。
2. **定位第二类 flaky 的根因**：已知线索 —— ① 文件级失败、无断言详情；② 子测试日志全 ✔；③ 失败文件每次不同；
   ④ **串行 2/2 绿、并发 25% 失败**（我实测）⇒ **强指向"并发"**（资源竞争 / 文件描述符 / SQLite 连接 / node:test 并发行为）。
   建议按此方向查：`--test-concurrency=1` 反复跑（我这边 2/2 绿）、`--test-concurrency=2/4` 找阈值、
   查测试进程的 fd/内存上限、查 `node:test` 并发下的已知问题。
3. **把"子进程独立进程组"的修复做全**：四个 spawn 子进程的测试文件（`cli-*`）统一加 `detached`（或抽成公共 helper），
   不要只改被点名的那一个。
4. **判据提高样本**：改完要给出 **连续 10 次 `npm test` 全绿**的原样输出（25% 失败率下，5 次全绿的概率≈24%，不足以证明修好；
   10 次全绿的概率≈5.6%，才有说服力）。**仍不许用重试糊过去。**
5. 顺带：`npm test` 的**用例数**在失败时会变成 282（文件级失败导致该文件用例没跑完）—— 修好后应稳定在 285。

## 5. 认可的部分（本批做对的事）

- **CI 设计正确**：workflow 只做 `npm ci` + 调**同一个** `tools/ci-check.sh` ⇒ 从机制上杜绝"CI 一套、本地一套"；
  无 secrets、不部署、不 push（A4 遵守）。
- **healthz 单一来源核实正确**（B2）—— 它没有为了"显得做了事"去改本来正确的代码，而是**核实 + 给证据**，这是对的。
- **`cli-user.test.ts` 的修复是真修**（`detached` + 对照实验证明），不是加重试；我 8 次跑下来它确实不再失败。
- **版本管理规划**（`docs/versioning.md`）写得完整，含"`schema_version` 与项目版本解耦"这条容易漏的点。
- **零业务改动**：`git diff bfca0f1..HEAD` 显示 `src/`、`web/src/`、`migrations/` **完全未动**；
  改动集中在 CI/文档/`package.json` 版本 1 行/`tests/cli-user.test.ts`/`tools/ci-check.sh`（含它顺手把我 `deploy/container.md` 里的 `0.1.0` 更新成 `1.0.0`，合理）。

---

# 上线准备 P2 复验（返工后）— 结论：**过**（2026-09-20，host_manger）

| 项 | 值 |
| --- | --- |
| 被验收 commit | `cbd6e59`（返工收尾）—— `68e2207`(公共 helper 统一四个 cli-*) / `92eab5a`(返工小节) / `cbd6e59`(补 fd·进程上限排除项) |
| 前次结论 | **不过**（见上一节「上线准备 P2 验收」） |
| 本次结论 | **过** |

## 1. 返工逐条核对（对应上次 VERIFY §4 的 5 条要求）

| # | 要求 | 它做了什么 | 判定 |
| --- | --- | --- | --- |
| 1 | 让失败可诊断 | `tools/ci-check.sh` 失败时打印完整诊断（`Error:` / `unhandledRejection` / `test failed` / `ERR_` / `code:`）+ 日志末尾 15 行；`assertCliOk()` 输出 `rc/signal/timedOut/stderr/stdout` ⇒ **拿到 `signal=SIGSEGV`**（不再是含糊的 `code=null`） | ✅ |
| 2 | 定位第二类 flaky 根因 | **三个对照实验**（A: `process.exitCode=1` / B: 未处理 rejection / C: 被信号杀死）证明：**"文件级 `'test failed'` + 无详情 + 子测试全 ✔" = 变体 C（进程被信号杀死）** —— **正好解释我观察到的形态**；逐条排除 9 个假设（含**裸 CLI 8 路 × 12 轮 = 96 次全 rc=0**、`ulimit -n/-u` 远高于用量、cgroup `oom_kill` 全程 0、非断言错、非未处理 rejection、非端口/临时目录竞争）；**诚实承认**"api-tokens/api-export 那两次无法本地复现" | ✅ |
| 3 | 隔离做全 | `tests/helpers.ts` 新增 `runCliProcess()` / `assertCliOk()`（`detached: true` + `stdin` EPIPE 吞掉 + 30s 安全阀 + 返回 `code/signal/stdout/stderr/timedOut`）；**四个** spawn 子进程的测试文件（`cli-user`/`cli-export`/`cli-get-render`/`cli-token`）**全部改用**（不再只有被点名的那一个） | ✅ |
| 4 | 判据提到连续 10 次 | **连续 10 次 `npm test` 全绿**，且条件**更苛刻**（`TMPDIR=<磁盘目录>` = 它能复现失败的设置）；补充样本：单文件 ×20、`--test-concurrency=7` ×6、`=4` ×4、`ci-check.sh` 6/6 | ✅ |
| 5 | 用例数稳定 285 | 10 次验收**每次都是 285/285/0**（不再出现 282） | ✅ |
| 6 | （额外）是否降并发 | **拒绝**：改造后默认并发 10 次全绿；降并发"没有证据支持就改配置"且拖慢 CI（c=7≈18s / c=4≈24s）—— **理由充分** | ✅ |

## 2. 我的独立复验（**跑一次 + 抽查证据**，不重复它的大样本）

```
① 我跑一次 npm test → rc=0 ｜ ℹ tests 285 / pass 285 / fail 0  ✅
② 抽查它的 10 次证据：var/log/acc-1.log … acc-10.log **真实存在**（23:45–23:49，各约 30KB），
   逐次都是 285/285/0 ✅；且**保留了修复前的失败样本** `d-2.log`（285/284/1）—— 时间线与"每次约 25s"吻合，可信 ✅
③ 零业务改动：改动面 = `tests/helpers.ts`(+79) + 四个 `cli-*`（改为委托）+ `tools/ci-check.sh`(+9/-2)；
   `src/` / `web/src/` / `migrations/` / `package.json` **均未动** ✅
```

## 3. 验收方记录（我的流程问题 —— 已固化进技能）

⚠️ 我一开始按"提高样本"的思路**自己从头跑了 10 次** `npm test` → **被用户当场叫停**：
「**不要跑那么多次，以后也不允许跑 10 次这种，dsh 都验证了 10 次，你跑一次就行**」。

**我的错**：把"独立复现"误解成"重复同样的次数"。**正确做法**：**跑一次确认当前状态 + 抽查它的大样本证据**
（是否真实存在 / 条件是否苛刻 / 有没有挑数据）—— 独立复现的价值在**用不同方法验同一结论**，不在重复次数；
重复跑是几十倍的时间浪费。
**已落盘**：`skills/greenhouse-kickoff/references/acceptance-gate.md` §1 第 2 步新增纪律「**验收方不重复实现方的大样本验证**」
（含本次实证与唯一例外：怀疑它挑数据时才加样本）。

---

# 上线准备 P4 执行记录（git 重新初始化）— **完成**（2026-09-20，host_manger）

| 项 | 值 |
| --- | --- |
| 授权 | 用户 2026-09-20 明确授权（回「A」） |
| 结果 | **完成** —— 新仓库首个提交 **`8efd440`**（`chore: 初始提交（v1.0.0）`），分支 `main`，提交总数 **1**（原 **208**） |

## 1. 三条护栏的执行情况（动手前承诺的）

| 护栏 | 执行结果 |
| --- | --- |
| ① **旧仓库离线备份**（放新仓库之外） | ✅ `/root/greenhouse/backups/promptmanager-git-history-20260920.tar.gz`（**93M / 2572 条目**；可解压验证通过；内含 HEAD `0262541`）；已登记到 `/root/greenhouse/backups/README.md`（**保留期 90 天**至 2026-12-19，到期**列清单问用户**再处置） |
| ② **首次提交前再扫一遍工作区** | ✅ `_env/` 0 命中、`data/` 0、`tmp/var/dist` 0、数据库/密钥文件 0（工作区里确有 `_env`/`var`/`dist`/`node_modules`，**均被 `.gitignore` 排除**） |
| ③ **重初始化后逐项核对** | ✅ 见下表 |

```
文件零丢失：逐文件比对 **旧 352 = 新 352，差异为空**（从备份解出旧 index 列表 vs 新仓库 `git ls-files`）
.git 体积：  **100M → 14M**
敏感路径命中：0  ｜ git status：干净  ｜ 分支：main
npm test：    rc=0 ｜ ℹ tests 285 / pass 285 / fail 0   （重初始化不影响代码）
提交者配置：  保留 `dsh <dsh@greenhouse.local>`（供实现方后续提交用）；首个提交作者显式指定为 host_manger
```

## 2. ⚠️ 副作用：**本文件在 2026-09-20 之前引用的 commit hash 已失效**

本次之前的所有记录（阶段 1–25 验收、上线准备 P1 / P2）里引用的 commit hash
（如 `74fdde2` / `fadffde` / `de180ee` / `bfca0f1` / `90dccae` …）**指向旧历史，新仓库中不存在**。
需要追溯时请用备份：
```bash
mkdir -p /tmp/oldgit && tar xzf /root/greenhouse/backups/promptmanager-git-history-20260920.tar.gz -C /tmp/oldgit
git --git-dir=/tmp/oldgit/.git log --oneline | head
```
**文件内容本身未变**（逐文件比对零差异）—— 受影响的只是"按 hash 定位历史提交"这一条路径。

---

# 远程仓库绑定与首次推送（2026-09-20）— **完成**（含一次「可见性」事件）

| 项 | 值 |
| --- | --- |
| 执行者 | host_manger（用户 2026-09-20 授权：给地址 + 「都使用 ops 的密钥」） |
| 结果 | 两个 remote 已配置、**首次推送成功**；随后发现 GitHub 仓库为 **public** → 用户改 **private** → 已验证止血 |

## 1. remote 配置与认证

| 远程 | 地址 | 说明 |
| --- | --- | --- |
| `origin` | `git@git.home.local:hopetree/promptmanager.git` | **内网**（ssh config: `git.home.local` → `192.168.0.203:222`） |
| `github` | `git@github.com:Hopetree/promptmanager.git` | **公网** |

**认证**：改用 **`ops@host_manger` 的密钥**（用户指定）—— 部署到 228 `/root/.ssh/ops-git`（600 root），
`git config core.sshCommand` 指向它（`IdentitiesOnly=yes` + `accept-new`）。
背景：228 root 自带的那把 key（`root@dsh-gitea`）在 GitHub 上 **`Permission denied (publickey)`**；
ops 这把**两个远程都通**（`ls-remote` 双 rc=0）。

**推送结果**：`git push -u origin main` + `git push -u github main` 均 `* [new branch] main -> main`，
两个远端 HEAD 均 = 本地 **`762f228`**。

## 2. ⚠️ 可见性事件（我漏查的一项）

```
推送后检查（无认证 API）：GET /repos/Hopetree/promptmanager → 200 + {"private": false, "visibility": "public"}
⇒ 352 个文件**一度对公众可见**；其中 7 个文件含内网 IP（192.168.0.x）、8 个文件含内网路径/主机名
  （/opt/promptmanager、/root/greenhouse、git.home.local）—— 命中文件：BRIEF.md / README.md / deploy/README.md /
  docs/dev-history/PROGRESS.md / docs/dev-history/VERIFY.md / tools/ac-stage19.sh 等
```

**缓解事实（两点，决定了它可控）**：
1. **凭据 0 泄露** —— 推送前已扫：`_env/`、`data/`、口令、密钥 **全部 0 命中**（`deploy/*.env.example` 是空值模板）；
   泄露的是**拓扑信息**（内网 IP / 路径 / 主机名），而 `192.168.0.x` 是私有地址、**公网无法直连**。
2. **仓库当天新建、无 fork** ⇒ **改 private 基本可止血**。

**处理与验证**：用户已将仓库改为 **private** ⇒ 我复验：
```
无认证 API：GET /repos/Hopetree/promptmanager → **404 Not Found**  ✅ 内容已对公众不可见
SSH key 仍有权限：git ls-remote github → 762f228…（内容完好、后续可正常推送）✅
```

## 3. 我的疏漏与固化

- **疏漏**：推送前我只查了「**内容里有没有敏感信息**」，**没查「目标仓库的可见性」** —— 后者是推送前的必查项。
  （"内容干净" ≠ "发布安全"：受众/可见性是另一半。）
- **固化**：`skills/greenhouse-kickoff/SKILL.md` §3.1 新增**条目 16「把内容推送到任何外部仓库/服务之前，先确认目标受众与可见性」**
  —— 含**推送前必查三样**：① 目标仓库可见性（GitHub 无认证 API：404 = private、`private: false` = public）；
  ② 内容里的内网信息（`git grep -lE '192\.168\.|/opt/|/root/|\.home\.local'`）；③ 内容里的凭据（`_env/`、`*.env`、口令字面量）。
  并记入 `CHANGELOG.md`。

---

# 阶段 28 验收（项目 `AGENTS.md`）— 结论：**过**（2026-09-21，host_manger）

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`5911cf4`**（`docs(agents): 新增项目级 AI 代理操作指南 AGENTS.md（阶段 28 / AC-83）`） |
| 规格 | BRIEF **v35**（§7 交付物 `AGENTS.md` + **AC-83** + 阶段 28） |
| 结论 | **过** |

## 0. 本轮特殊性：并行避让（我要求的）

另有会话（**阶段 27**）在同一工作区并行开发 ⇒ 我要求本会话「**只新增 `AGENTS.md`，暂不写 `PROGRESS.md`**」（避免两个会话争用同一文件）。
因此 **AC-83 第 ⑦ 条的"把自检过程写进 PROGRESS"暂缓**（待阶段 27 收尾后补写），其余各条照常验收。

## 1. AC-83 逐条（我核 —— 按纪律**抽查**，不重复它已做过的大样本）

| # | 要求 | 我的核验 | 判定 |
| --- | --- | --- | --- |
| ① | 根目录 + 已入库 | `AGENTS.md`（项目根，**232 行**）`git ls-files` 命中 | ✅ |
| ② | **常用命令真跑** | **它逐条实跑并把输出写进了文档**（§3 每条命令都带"实测输出/判据"：`node_modules` 209 项、chunk `467320 B`、`ok: schema at v3`、`tests 285/285`…）。我抽查其中**秒级、不干扰并行会话**的几条：`systemd-analyze verify` **rc=0** ✅、`grep -c MemoryDenyWriteExecute` = **0** ✅、`grep -c AF_NETLINK` = **2** ✅ —— **与文档所写逐条吻合** | ✅ |
| ③ | 结构路径逐个真查 | 我抽查 **10 个**：`src/server/index.ts`、`src/db/prompt-queries.ts`、`src/services/markdown.ts`、`web/src/clipboard.ts`、`tools/ci-check.sh`、`tests/helpers.ts`、`deploy/container.md`、`docs/versioning.md`、`migrations/003_*.sql`、`.github/workflows/ci.yml` → **全部存在** | ✅ |
| ④ | 禁过期表述 | `列表视图` / `1.25 MB` / `149 个用例` / `248 ` / `阶段 1–9` / `阶段 1-9` → **命中全 0** | ✅ |
| ⑤ | 坑 ≥5 条且指向证据 | **§10 共 10 条**，每条带 `文件:行号` 或文档章节（AF_NETLINK / `MemoryDenyWriteExecute` / `npm ci` EROFS / detached flaky / 内网 clipboard / jsdom 内存 / `folder_id` 含后代 / `dist` 依赖 / better-sqlite3 prebuilds / import FK RESTRICT） | ✅ |
| ⑥ | 指向而非复制 | 多处：`schema_version` → `docs/versioning.md`；备份 → `deploy/README.md §4`；选型与禁止手搓 → `STANDARDS.md §4.2`；监听/认证 → `README.md` | ✅ |
| ⑦ | 可上手性自检 | **以更硬的方式完成**：它在**隔离副本**（`git archive HEAD \| tar -x -C /tmp/pmci2`）里跑通全量验证 ⇒ 证明"仅凭本仓库 + AGENTS.md 能在干净环境跑起来"；「写进 PROGRESS」那一步按并行避让要求**暂缓**（待补） | ✅（暂缓项另记） |

## 2. 并行风险核验（本轮重点）— **全部规避** ✅

```
① 它的提交只含 1 个文件：git show --stat 5911cf4 = 1 file changed, 232 insertions(+)
   （它自己还做了 git ls-tree 逐文件比对 + grep -E 'api-prompts-bulk|stage27' → 无命中）
② 阶段 27 的未提交改动完好：工作区 14 个 M + 5 个未跟踪项仍在，未被卷走
③ PROGRESS.md 未被它碰：AGENTS / 阶段 28 命中 0
④ 无冲突标记（<<<<<<< 计数 0）
```
⇒ **用户选的 B 方案（写文件避让）达到了预期效果**，且它**主动加固**（提交隔离验证）。

## 3. 质量评价（超出 AC 的部分，值得记）

- **§3「常用命令」逐条带实测输出**（不是空泛命令表）—— 这正是"**真了解 vs 套模板**"的分水岭；
- **§10 十条坑全部有证据指向**，且**包含它自己踩出来的坑**（沙箱里 `npm ci` 会 EROFS ⇒ 必须 `--cache var/cache/npm`）；
- **§12 写入了「多会话并行」约定**（把本轮经验固化进文档，后来者可复用）；
- **它主动做了「提交隔离验证」**（未被要求）—— 在并行场景下防住了"卷走他人改动"的风险；
- **§2「最短上手路径（新会话 5 分钟）」** 直接对应 AC-83 的成功判据。

## 4. 缺口与待办

1. ⚠️ **PROGRESS 补写待办**：按并行避让要求，它**暂未写** `PROGRESS.md` 的阶段 28 小节
   ⇒ **阶段 27 收尾后需通知它补写**（我会提醒用户）。
2. ⚠️ **实时工作区当前是红的**（我核过）：`npm test` RC=1，根因是**阶段 27 的未跟踪新测试**
   `tests/api-prompts-bulk.test.ts` 有 **22 个 TS 错误**（该会话改到一半）—— **与阶段 28 无关**
   （它用隔离副本证明了自己的交付全绿）。待阶段 27 自己收敛，我会在阶段 27 验收时核。

---

# 阶段 27 验收（FR-77~FR-81 五条新需求）— 结论：**过**（附视觉改进建议，不阻塞）

| 项 | 值 |
| --- | --- |
| 被验收 commit | `7296c60`（收尾回填）—— 实现单元 `919ca8e`(后端批量接口) / `1402f9e`(表格批量+详情页改造) / `2d65311`(VarsDialog 尺寸+自检) |
| 规格 | BRIEF **v34**（FR-77~FR-81；AC-78~AC-82；阶段 27） |
| 结论 | **过** |

## 1. AC-78~AC-82 —— **我自己跑** `bash tools/ac-stage27.sh`：rc=0、**0 个 ❌**、五条 AC 全过

```
$ npm test                    → rc=0 ｜ ℹ tests 300 / pass 300 / fail 0   （285 → 300，+15 新用例，理由已说明）
$ bash tools/ac-stage27.sh    → rc=0 ｜ 0 个 ❌ ｜ ✅ AC-78 / AC-79 / AC-80 / AC-81 / AC-82 全部通过
```

**我复跑得到的关键数值**（与它自述一致）：

| AC | 我的实测 |
| --- | --- |
| AC-78 | 首列复选框 + 表头全选存在；勾 3 条 → 工具条 `已选择 3 项 \| 批量收藏 \| 批量移动 \| 批量删除 \| 取消`；取消 → `checked=[]` + 工具条消失；**批量收藏只发 1 个 `POST /api/prompts/bulk`**（`ac78_favorite_requests=1`）✅ |
| AC-79 | 元信息行位置：`notesBottom=185 < metaTop=201 < fieldsTop=243`（**夹在备注与页签之间**）✅；字号 12.5px < 标题 18px、色 `rgb(60,64,70)` ≠ 标题 `rgb(20,22,26)`；改文件夹 → 落库 + **侧栏计数同步**；标签可增删；卡片/表格/编辑器**三处同源一致** ✅ |
| AC-80 | `ac80_tabs=["用户提示词","系统提示词"]`（**恰好 2 个**）、`notes_tab_count=0` ✅；编辑器备注框仍在 ✅ |
| AC-81 | `hasVariableBlock=false`、`variablePanel=false`，但 `markdownPreview/previewToggle/versionHistory=true` ✅；编辑器变量面板仍在、复制含变量仍弹 `pm-vars-dialog` ✅ |
| AC-82 | **改前 640×398 → 改后 760×477**（宽 **+18.75%**、高 **+19.85%**，均 ≥15%）✅；**三档（分栏/表格/卡片）尺寸完全一致**（同一组件）✅ |

## 2. 独立核验（我自己做的）

- **提交范围**：三个实现提交分别 3 / 13 / 26 个文件，**未卷走阶段 28 的 `AGENTS.md`** ✅（阶段 28 的提交 `67e5f41` 独立、只含 `AGENTS.md`）；
- **过程审查**：系统侧未改（`find /etc` 空）｜历史未改写（reflog 全 commit）｜未碰别的项目｜**凭据 0 命中** ✅；
- **工作区**：我跑脚本后重生成的截图已 `git checkout` 恢复，现干净 ✅；
- **它的 FR-81 前置确认做对了**：**读源码**（`web/src/use-copy.ts` 的 `copyPrompt()`）确认"复制之后的弹窗 = `VarsDialog`"，**无需 QUESTIONS** —— 这正是我在提示词里要求的做法 ✅。

## 3. ⚠️ 视觉观察（我自己看图 —— 不阻塞，但建议列入下一批小改）

我逐张看了 `docs/shots/stage27/`（20 张）中的关键几张（**识图四问：无重叠/压字、无硬断词、无孤标题、无溢出裁切** ⇒ 四问全过）：

| # | 观察 | 我的判断 |
| --- | --- | --- |
| 1 | **表头复选框是实心方块、且比行内复选框小**；勾选 3 行（部分选中）时**看不到 indeterminate 横杠** | ⚠️ **建议修**：用户无法一眼区分"全选"与"部分选中"（疑似缺 `indeterminate` 属性） |
| 2 | **批量工具条与表头行之间零间距**（贴在一起） | ⚠️ 建议加 6–8px 间距（视觉拥挤） |
| 3 | **详情页元信息行与备注行间距偏小、与页签行间距偏大** ⇒ 读起来像"备注的第二行" | ⚠️ 建议微调间距（层级感） |
| 4 | **元信息行无换行保护**：更长的文件夹名或多个标签可能把「+ 添加标签」顶出面板 | ⚠️ **建议补测**（AC-79 ⑥ 只测了窄屏 1100px 无溢出，未测长内容） |
| 5 | 详情页标签 chip 样式（浅蓝无边框）与左栏标签（近白带边框）**不一致** | ⚠️ 建议统一（一致性） |
| — | ~~表头被横线穿过~~ | ❌ **误报**（我第一次识图的结论，第二次聚焦复看已澄清：无横线穿字） |

> 以上 5 条**均不阻塞本阶段验收**（AC 全过、识图四问全过、功能正确）；是否返工**由用户决定**，可作为下一批小改一并派发。

---

# 阶段 28 复验（`AGENTS.md` 全文改英文）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`67e5f41`**（`docs(agents): AGENTS.md 全文改为英文（阶段 28 / AC-83 ⑧）`） |
| 规格 | BRIEF **v36**（AC-83 第 ⑧ 条） + `STANDARDS.md` **§5.1 文档语言规范** |
| 结论 | **过** |

## 1. AC-83 ⑧ —— 过

```
$ python3 -c "…统计 CJK 字符…"        → AGENTS.md 290 行 ｜ **CJK 字符数: 0** ✅
   （含中文标点：\u4e00-\u9fff / \u3000-\u303f / \uff00-\uffef 全部为 0）
```

## 2. 内容未被顺手删减（我逐项核）

```
结构 §1–§12 全部在位（逐节 grep 命中各 1）✅
「本项目特有的坑」条目数 = **10**（与中文版一致，未删）✅
证据指向（file:line / 路径）保留 ✅
命令与实测输出保留（如 node_modules 209 项、chunk 467320 B、ok: schema at v3）✅
```

## 3. 英文质量（我读了 §1 与 §10 抽查）

**地道英文、非翻译腔** ✅ —— 例如：
`a lightweight, self-hosted, data-you-own prompt manager`、
`the upstream PromptHub is feature-rich but heavy, and AGPL-3.0`、
`A Node service unit must allow AF_NETLINK, or it crashes on startup.`
（imperative、concise，符合"给同事看的 runbook"口吻 —— 正是我在提示词里要求的。）

## 4. 并行纪律 —— 全部遵守

- 提交**只含 1 个文件**（`AGENTS.md`）✅；
- **未动 `PROGRESS.md`**（`AGENTS` / `阶段 28` 命中 0）—— 仍待阶段 27 收尾后补写 ✅（见下）；
- 它用**隔离副本**（`git archive HEAD | tar -x -C /tmp/...`）证明"自己的交付是绿的"，**没有**去碰阶段 27 的半成品 ✅。

## 5. ⚠️ 遗留待办（**需要通知它补写**）

- **`PROGRESS.md` 的阶段 28 小节仍未写**（按并行避让要求暂缓）⇒ **阶段 27 已收尾**，现在可以通知它补写了。

---

# 阶段 28 补写验收（`PROGRESS.md` 的阶段 28 小节）— 结论：**过**（含一次「实现方发现规格缺陷」）

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`fe83f70`**（`docs(progress): 补写阶段 28 小节（AGENTS.md / AC-83 ①–⑧ 自检 + 并行避让留痕 + 落盘对账）`） |
| 结论 | **过** |

## 1. 补写内容核对

```
① PROGRESS 结构 ✅：阶段 27 小节（第 380 行起）**未被覆盖**；阶段 28 小节（第 566 行起）已补；全文 782 行
② 提交范围 ✅：fe83f70 **只含 1 个文件**（PROGRESS.md）
③ 内容完整 ✅：① 本阶段做了什么 / ② 并行避让留痕 / ③ AC-83 ①–⑧ 原样输出 /
   ④ 内容不变证明（脚本比对）/ ⑤ 回归 / ⑥ commit 表 / ⑦ 落盘对账 —— 七节齐全
```

**质量亮点（超出要求）**：
- **② 并行避让留痕的证据链完整**：报错原文（`TS2304: Cannot find name 'bulkPrompts'`）+ 文件 mtime（`00:50:38`/`00:51:17`）+
  会话 transcript 判定（`session-8f891155` 首条消息是阶段 27 / BRIEF v34）+ **提交后 `git ls-tree -r | grep -E 'api-prompts-bulk|stage27'` 无命中**；
- **④「内容不变」用脚本比对**（不靠目测）：命令 `40 vs 40`、`file:line` 证据 `9 vs 9`（`missing=NONE`）、结构 §1–§12、坑 10 条、关键输出串全在；
- **⑦ 可上手性自检真的做了**，并**发现 + 就地补掉 3 个缺口**：`npm ci` 在本沙箱 EROFS（⇒ 改为 `--cache var/cache/npm` 并列为坑 3）、
  单文件测试必须先 `build`（否则缺 `dist/web` 出现假失败）、`data/` 首次运行才创建（原列在结构表里与"路径都 test -e 过"矛盾）；
- **② 的常用命令表带对照实验**（不带 `--cache` → **rc=226 EROFS**），**证明文档里的"坑 3"是真的**；
- **主动说明行数口径差异**（`wc -l` = 289 vs 编辑器显示 290），并解释与我的验收记录 290 的差异**只是口径**，不是内容差异。

## 2. ⚠️ 它发现了我写的一个规格缺陷（AC-83 ⑧ 的判据命令）—— 我已独立核实并修正

**它的报告**：`AC-83 ⑧` 的判据 `LC_ALL=C grep -cP '[\x{4e00}-…]'` **永远拿不到 0**（只得到 `rc=2`）；
且"顺手修"成 `LC_ALL=C grep -cP '\p{Han}'` 会**假绿**。

**我的独立复现（逐条实跑）**：

| 判据 | 英文版（HEAD `AGENTS.md`） | 中文版（`5911cf4:AGENTS.md`） |
| --- | --- | --- |
| ① 原判据（`LC_ALL=C` + 码点区间） | **rc=2（`character value in \x{} too large`）** ❌ | — |
| ② 去掉 `LC_ALL=C` 的同区间 | **0** ✅ | **192** ✅ |
| ③ `LC_ALL=C grep -cP '\p{Han}'` | 0 | **0（假绿！）** ❌ |
| ④ `grep -cP '\p{Han}'`（不带 `LC_ALL`） | **0** ✅ | **188** ✅ |

⇒ **BRIEF 已升 v37**：判据改为
`grep -cP '[\x{4e00}-\x{9fff}\x{3000}-\x{303f}\x{ff00}-\x{ffef}]' AGENTS.md` → **0**（**不加 `LC_ALL=C`**），并记入 §12 变更记录。
**这是「实现方发现规格缺陷 → 改规格而不是迎合」的正面案例**（与 v5/v6 的 FR-16 同类）。

## 3. 验收方自省（我的失误）

- ⚠️ **我写 AC-83 ⑧ 判据时没有在本机真跑**。更糟的是：**我在验收阶段 28 时也遇到了同一报错**
  （`grep: character value in \x{} or \o{} is too large`），当时我只是**换成 python 绕过**、继续得到"0"，
  **没有意识到"是 BRIEF 的判据本身有缺陷"** —— 若当时细究一步，就能更早发现并省下这一轮。
- **教训（已固化进技能）**：**写进 BRIEF 的每条判据命令，都要先在目标机上真跑一遍**（"能写出来" ≠ "能跑通"）；
  涉及 `grep -P` 与 locale 的组合（`LC_ALL=C` 会把 PCRE2 压进字节模式）尤其要小心。

---

# 阶段 29 验收（FR-82 / FR-83 —— 阶段 27 的 5 条视觉细化）— 结论：**过**（含一次「实现方对抗性自审」）

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`77a6497`**（收尾）—— 实现单元 `750464b`(30 文件) / `46b8ac2`(回填) / `9993327`(自审补强) / `0f75b4d`(自审第 2 轮修 6 缺陷) |
| 规格 | BRIEF **v38**（FR-82 / FR-83；AC-84 / AC-85；阶段 29） |
| 结论 | **过** |

## 1. 我自己跑（不采信它的自述）

```
$ npm test                    → rc=0 ｜ ℹ tests 307 / pass 307 / fail 0     （300 → 307，+7 新用例）
$ bash tools/ac-stage29.sh    → rc=0 ｜ 0 个 ❌ ｜ ✅ AC-84 / AC-85 全部通过
                                （⑤ 截图齐备：本阶段 9 张 + AC-78/79 回归 13 张 = 22）
```

## 2. 关键数值（我复跑，全部达标）

| 判据 | 我的实测 |
| --- | --- |
| AC-84 ① **三态可区分** | `none`（无 indeterminate / checked）／`partial`（`indeterminateClass: true`）／`all`（`checkedClass: true`）✅ |
| AC-84 ① 半选**静态**样式 | 背景 = 主色 `rgb(94,106,210)` + 横杠 `8×2px` ✅ |
| AC-84 ① 半选 **hover** 样式 | `rgb(94,106,210)` **非白** ✅（**正是它自审发现的盲区**） |
| AC-84 ② 尺寸一致 | 表头 `16×16` == 行内 `16×16`（**差 0**）✅ |
| AC-84 ③ 工具条间距 | 工具条 `bottom=144` → 表头 `top=152` = **8px**（≥6）✅ |
| AC-84 ④ 请求数 | 批量收藏 **1**、批量**删除也 1**（原先漏量删除）✅ |
| AC-85 ① 层级间距 | 备注→元信息 **20px**（≥12）且 ≤ 元信息→页签 **24px** ✅ |
| AC-85 ② 长内容 | 1600px：`924=924` / `1462≤1567`；1100px：`688=688` / `968≤1067`（**长文件夹名 33 字 + 5 标签**）✅ |
| AC-85 ③ chip 一致 | 与左栏同名 chip 的 `backgroundColor` / `border` / `borderRadius` 逐项相等 ✅ |
| 全选断言 | 勾选数 **16 == 当页行数 16**（原先只断言 ≥6）✅ |

## 3. 它的「对抗性自审」（超出要求，值得记）

它**自己 spawn 了 5 个只读 checker subagent**（会话标题 `You are an independent verification`），
留下 `docs/dev-history/doublecheck-stage29-report.md`（Verdict **green**、19 次通过 0 失败、逐条 failure-mode 分析），
**第 2 轮报出并修掉 6 条真缺陷** —— 其中**两条正是我写 AC 时的盲区**：

1. **体积预算虚报（严重）**：`STAGE29_ACCOUNTED_DELTA` 声明了却**没进 AC-61 ⑤ 的求和** ⇒ 实际只剩 **8 B** 余量，而文档写 418,818。
   **我抽查确认已修**（`tests/stage18-bundle.test.ts:97` 的求和已含 `STAGE29_ACCOUNTED_DELTA`）✅
2. **半选态 hover 盲区**：antd 注入的 hover 规则（specificity 0,3,0）压过本阶段覆写（0,2,0）⇒ 亮色下悬浮变"白底白杠"；
   **而我的 AC-84 ① 探针量的时候鼠标不在表头、测不到这一态**。它补了 **0,4,0** 规则 + 探针加**真鼠标 `hoverOf()`** 测量 ✅
3. 另 4 条：AC-84 ④ 漏量删除请求｜窄面板只打印不断言｜截图存在性无断言（probe 崩溃被 `tee` 掩盖 → 加 `set -o pipefail`）｜全选断言过松（≥6 → ==页行数）。

## 4. 过程审查 — 干净（含一处环境现象溯源）

```
系统侧 find /etc /usr/local/bin（09:00~11:40）命中 13 项 → **溯源：228 容器 09:33:35 重启**
  （命中项 mtime 全为该时刻；journalctl --list-boots 启动于 09:33:36；uptime = up 1:54）⇒ **与实现方无关** ✅
reflog「1 条非 commit」→ **我的 grep 误报**（`commit (initial):` 含括号，`grep -v 'commit:'` 匹配不到）⇒ **历史未改写** ✅
未碰别的项目 ✅ ｜ 凭据 0 命中（_env/ 与真实口令）✅ ｜ 提交对账 13 dsh + 10 host_manger ✅
工作区：我跑脚本重出的截图已 `git checkout` 恢复（22 → 0）✅
```

## 5. ⚠️ 一处分歧（如实记录，不阻塞）

**识图**说"表头复选框比行内**小**（14–16 vs 18–20px）、且行内更圆" —— **与我的探针数据矛盾**（`getBoundingClientRect` 两者均 `16×16`，差 0）。
**我的判断**：**采信探针数据**（精确测量 > 视觉估计；识图自己也用了 "roughly"）；可能识图把**选中态的波浪/圆角效果**误读成了尺寸差异。
⇒ 记为「识图与数据的分歧」；**若用户肉眼仍觉得小**，我再让实现方统一 checkbox wrapper 的尺寸并复测。

---

# 阶段 30（**非阶段** · 用户直接交办 dsh）验收 —— `docs/` 只放最终状态 — 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`a59a294`**（收尾）｜实施部分混在 `1e1e4a5`（见 §4 说明） |
| 规格 | BRIEF **v40**（FR-84 / AC-86）+ `/root/greenhouse/STANDARDS.md` **§5.2** |
| 结论 | **过** |

## 1. AC-86 逐条（**我自己核**）

```
① find docs -name '*.png' | wc -l          → **8**（改前 172）✅
② find docs -type d -name 'stage*'         → **0**（阶段截图目录已不在 docs/ 下）✅
③ tmp/shots-archive/ 存在                  → **24M / 251 张** ✅；`git ls-files tmp` → **0**（不入库）✅
④ tools/ui-shots.sh 已改成两种模式          → 默认（无参）= 自证 → `tmp/ui-shots/shots/`（53 张）；
                                              `--key` = 发版 → `docs/shots/`（8 张，旧的先归档到 `tmp/shots-archive/docs-shots/`）；
                                              注释里写明规范与判据 ✅
⑤ AGENTS.md 新增 §5.1（英文）               → `Where documentation and screenshots live: docs/ vs tmp/`（引 STANDARDS §5.2）+
                                              Rule of thumb + 两条清单 + **`git ls-files tmp` must always be `0`** ✅
⑥ git ls-files docs | grep -c '\.png$'     → **8**（改前 94）✅
⑦ 回归                                      → `npm test` **307/307** ✅ + `bash tools/ci-check.sh` **6/6** ✅ + `git status` 干净 ✅
```

## 2. 覆盖度（8 张 = 正好一套关键页面）

```
01-login  02-split  03-table  04-cards  05-editor  06-detail  07-mobile  08-dark
⇒ 登录 / 分栏 / 表格 / 卡片 / 编辑器 / 详情 / 移动端 / 暗色 —— **全覆盖**，命名清晰 ✅
```

## 3. 规范落地实测（**我亲自跑**）

```
$ bash tools/ui-shots.sh          # 默认（自证模式）
  → 53 张落 tmp/ui-shots/shots/ ✅ ｜ docs/shots 仍 **8** 张 ✅ ｜ git status **0 项** ✅
```
⇒ **「自证截图不进 git」这条规范真的生效了** —— 这正是它要解决的问题（此前每跑一次自证都会脏掉 `docs/`）。

## 4. ⚠️ 验收方失误：我的 v40 提交混进了实现方的改动（提交边界不干净）

**现象**：`1e1e4a5`（我提交的 `docs(brief): v40 口径澄清`）**含 195 个文件** —— 除 `BRIEF.md` 外，
还包含了实现方的 `docs/` 收敛（**251 张 png 的删除 + 8 张新增** + `AGENTS.md` / `README.md` / `PROGRESS.md` / `tools/**` 等）。

**根因**：实现方用 **`git mv`** 移动文件 ⇒ **自动进了暂存区**；我随后 `git add BRIEF.md` + `git commit` 时**没有先核暂存区**，
于是把它的改动一并提交了。

**影响**：**内容无错**（那些改动本来就要提交），但**提交边界混乱** —— 实现方的收尾提交 `a59a294` 因此只剩 3 个文件
（`AGENTS.md` / `PROGRESS.md` / `tools/ui-shots.sh`）。

**处理**：**不改写历史**（规范禁止，且内容无误）；如实记录于此。

**教训（已固化进技能）**：**每次 `commit` 前必须核 `git diff --cached --name-only`** ——
**尤其在"有并行会话 / 工作区里有他人改动"的场景**（`git mv` / `git add` 会悄悄把别人的改动放进暂存区）。
我在阶段 29 的 VERIFY 提交时核过这一点，这次漏了。

## 5. 产出与现状

`docs/` 现为：**4 个 md**（`brief-changelog` / `dependencies` / `search-zh` / `versioning`）+ **`shots/`（8 张关键展示图）** +
**`dev-history/`（文档类保留 —— 用户选 A：验收凭据）**。
`tmp/` 现为：`shots-archive/`（251 张归档）+ `ui-shots/`（自证产出 53 张 + DOM dump）—— **全部不入库** ✅

---

# 阶段 31 验收（FR-85 表格标签间距 + FR-86 版本保留策略）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`af486fb`**（收尾）—— 实现 `6cde241`(FR-86 数据层, 7 文件) / `78f34f7`(FR-85 UI, 2 文件) / `74cd3af`(自检脚本) / `c7ce55c`(收尾) / `af486fb`(修自造假红) |
| 规格 | BRIEF **v41**（FR-85 / FR-86；AC-87 / AC-88；阶段 31） |
| 结论 | **过** |

## 1. 我自己跑

```
$ npm test                  → rc=0 ｜ ℹ tests 319 / pass 319 / fail 0     （307 → 319，+12 新用例）
$ bash tools/ac-stage31.sh  → rc=0 ｜ 0 个 ❌ ｜ ✅ AC-87 / AC-88 全部通过
```

## 2. AC-87 标签间距（真实像素）

```
3 标签：gaps=[4,4] ｜ columnGap="4px" ｜ wrapped=false ｜ scrollWidth==clientWidth（无溢出）
7 标签：gaps=[4,4,4,4,4] ｜ wrapped=true ｜ lineCount=2 ｜ scrollWidth==clientWidth（**不溢出**）
单标签：gaps=[] ｜ 无标签：display=none
卡片视图对照：gaps=[4,4] ⇒ **与表格一致** ✅
行高：none/single/multi = 43 ｜ many = 65（换行后自然增高）✅ ｜ 文档级无横向溢出 ✅
```

## 3. AC-88 版本保留（**脚本按要求直接查库**，逐条核过）

| # | 断言 | 实际 |
| --- | --- | --- |
| ① | PUT 15 次 → `COUNT(*)` **恰好 10** | `10` ✅ |
| ② | 保留**最新连号**、最旧已不存在 | `[7..16]` ✅；`v1` 不存在 ✅（另一形态：建 + 14 PUT → `[6..15]`） |
| ③ | `prompts.version_no` 在保留集内 | `16` ∈ 集合 ✅ |
| ④ | **不重编号**（裁剪前后重叠版本逐字对照） | `v7..v10` 的 `version_no→正文` **逐字一致** ✅ |
| ⑤ | **回滚两态** | 回滚 `v12` → **200** + 仍 10 行 + 生成 `v17` + 只挤掉最旧 `v7` ✅；回滚**已被裁剪**的 `v1` → **404 且不改版本表** ✅ |
| ⑥ | **导入裁剪** | 导入含 15 版的文件 → 库里**恰好 10**、保留 `[6..15]`、`version_no` 仍 `15`、**全库不变式（无 prompt >10）** ✅ |
| ⑦ | **边界** | 恰好 10 **不删** ✅；第 11 个**只删最旧**（`[1..10]` → `[2..11]`）✅ |
| ⑧ | **文案** | 版本面板 DOM 可见「**最多保留最近 10 个版本（更早的版本会在产生新版本时自动清理）**」（11.5px 次级灰）✅ + `README.md` **3 处** ✅ |
| ⑨ | 回归 | `319/319` + `ci-check` + 版本面板（回滚入口 / 视图切换 / 行数）✅ |

## 4. 过程审查 — 干净

```
系统侧 find /etc /usr/local/bin（12:40~13:50）→ **0 项** ✅（228 未重启）
历史改写 0 ｜ 未碰别的项目 0 ｜ 凭据 0 命中（_env/ 与真实口令）✅
提交对账：**19 dsh + 15 host_manger** ✅ ｜ 阶段 31 的 5 个提交文件数 7/2/2/3/2（粒度合理）✅ ｜ 工作区 0 ✅
```

## 5. ✅ 阶段 30 的新规范**已被后续阶段遵守**

```
阶段 31 的截图落点：**tmp/shots/stage31/**（5 张：表格标签亮/暗、卡片对照、保留文案、版本表）+ **tmp/shots/stage31-before/**（改前对照）
**docs/shots/stage31 不存在** ✅
```
⇒ 阶段 30 建立的「**自证截图进 `tmp/`、`docs/` 只留最终状态**」**真的在生效**（这正是那条规范要解决的问题）。

## 6. 看图（我自己识图）

- `01-table-tags-light.png`：标签**有可见间隙、不融合** ✅；**7 标签换行 2 行、不溢出、不压列分隔线** ✅；无重叠 / 裁切 ✅
- `04-version-retention-note-light.png`：**保留策略文案存在且可见**（位于对比控件之上、版本列表区顶部；小号次级灰；无裁切/重叠）✅

**⚠️ 两条润色观察（不阻塞，供用户决定是否调整）**：
1. **标签间隙偏紧**：4px 是 FR-85 要求值、且与卡片视图一致 ⇒ **不算问题**；若觉得"呼吸感"不足可调 6px（一句话即可改）；
2. **版本保留文案偏弱**：识图评"readable but easy to miss"（浅灰小字）—— 若希望用户更容易注意到这条规则，可加强对比度或加 `tooltip`。

---

# 阶段 32 验收（FR-87 CI 干净环境必失败 + FR-88 登录页简化）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`608a929`**（收尾）—— 实现 `69a8d46`（FR-87：`ci-check.sh` 顺序 + `package.json` 前置 + 5 例单测，3 文件）/ `91e45e7`（FR-88：`LoginPage.tsx` 简化 + 5 例单测，2 文件）/ `431aca3`（AC 脚本 + 探针，2 文件）/ `3c53bb4`（文档，3 文件）/ `fbee2ea`（AC-89 ④ 如实说明，1 文件）/ `608a929`（收尾修正，1 文件） |
| 规格 | BRIEF **v42**（FR-87 / FR-88；AC-89 / AC-90；阶段 32） |
| 验收方 | host_manger（**独立复现**：自己起实例、自己跑探针、自己看图、自己查库/源码） |
| 结论 | **过** —— 唯一未独立核实项是 **AC-89 ④（GitHub Actions 结论）**，原因与等价证据见 §5 |

## 1. AC-89 —— **我自己跑**（不采信它的自述）

### ① 干净环境（先删 `dist`）跑全套质量检查

```
$ rm -rf dist && bash tools/ci-check.sh
=== ② 构建（必须先于类型检查） ===
  ✅ ② npm run build（rc=0）  0 条 >500KB 告警
=== ③ 类型检查（依赖 ② 的构建产物） ===
  ✅ ③a typecheck:web（rc=0）  0 个 TS 错误
  ✅ ③b typecheck:tests（rc=0）  0 个 TS 错误
=== ④ 全量测试 ===
  ✅ ④ npm test（rc=0）  ℹ tests 329 ℹ pass 329 ℹ fail 0
=== ⑤ 体积预算 ===
  ✅ ⑤ 体积预算（最大 chunk ≤ 500KB）（rc=0）  最大 vendor-antd-D0a34XA3.js = 470985 B（全部 js 合计 1302 KB）
== 汇总 ==（6 行全 ✅）
  ✅ 代码质量检查全部通过（6 项）

$ echo $?            → 0     ｜ ✅ 计数 13 ｜ ❌ 计数 0
```

### ② 顺序（构建必须在前）

```
$ grep -n 'npm run build\|npm run typecheck' tools/ci-check.sh
66:npm run build >"$LOG_DIR/build.log" 2>&1
72:npm run typecheck:web >"$LOG_DIR/typecheck-web.log" 2>&1
74:npm run typecheck:tests >"$LOG_DIR/typecheck-tests.log" 2>&1
⇒ 66 < 72 < 74 ✅（文件头 6–25 行注释写明"为什么必须先构建"，含 TS2307 与 rm -rf dist 复现命令）
```

### ③ 对照实验（裸跑 `typecheck:tests`）

```
$ node -p "require('./package.json').scripts['typecheck:tests']"
npm run build:server && tsc -p tsconfig.tests.json      ← 脚本自带构建前置（第二层防护）

$ rm -rf dist && npm run typecheck:tests
rc = 0 ｜ 错误数 = 0          （**改前 38** —— 我在派活前自己复现过：35 个 TS2307 + 3 个级联 TS7006）
```

> **判定**：BRIEF 只要求第一层（调顺序），实现方**多加了一层**（把前置写进 `typecheck:tests` 本身）——
> 我认这是**超出要求且正确**的做法：只调顺序时，"任何裸跑 `typecheck:tests` 的人/脚本"仍会撞 38 个 TS2307。

## 2. AC-90 —— **我自己跑**（自起临时实例 + 真鼠标探针）

我**没有**用它的实例，也没碰测试环境数据：**8768 + `/tmp/hm-acc32/data`** 起一个临时实例，自己设临时口令、
自己造 3 条夹具（`POST /api/prompts`），再跑它交付的探针（真鼠标 `Input.dispatchMouseEvent`）：

```
ac90_username_value={"value":"","placeholder":"用户名","autocomplete":"username","type":"text"}
ac90_scan={"needleInHtml":0,"needleInText":0,"noiseHits":{"SELF-HOSTED":0,"数据只在本机":0,"网页不提供注册":0,"未认证一律":0},
           "textSample":"PromptManager | 用户名 | 口令 | 登 录"}
ac90_keep={"brandArt":true,"brandArtSize":{"w":96,"h":96,"src":"/promptmanager-96.png"},"title":true,
           "usernameInput":true,"passwordInput":true,"submitButton":true,"submitText":"登 录"}
ac90_wrong_password={"alertText":"用户名或密码不正确","visible":true,"stillOnLogin":true}
ac90_mobile_overflow={"docScrollWidth":390,"docClientWidth":390,"loginWidth":390,"viewport":390}   ← 不横向溢出
ac90_mobile_username_value=""
ac90_dark_scan={…needleInHtml:0, needleInText:0, noise 全 0…}   ｜ ac90_dark_bg="rgb(1, 1, 2)"
ac90_after_login={"loginGone":true,"headerBrand":"PromptM","splitList":true,"cardOrTable":true}
ac32_runtime_errors=[]        服务端 5xx 计数 = 0
```

源码级（**我自己 grep**）：

```
grep -c 'admin' web/src/components/LoginPage.tsx      → 0      （含注释，大小写不敏感口径亦 0）
grep -c 'initialValues'  …LoginPage.tsx               → 0
四条噪音（SELF-HOSTED / 数据只在本机 / 网页不提供注册 / 未认证一律）→ 各 0
保留项：pm-brand-art-login → 1 ｜ PromptManager → 1 ｜ placeholder="用户名" → 1
```

**改前值的独立性**：`git show 91e45e7` 的 diff 显示改前确有 `initialValues={{ username: 'admin' }}` 与 `placeholder="admin"`
⇒ "改前 `value="admin"`" 与源码一致（**不依赖它的自述**）。

## 3. 看图（我自己识图）

| 图 | 我的结论 |
| --- | --- |
| `01-login-light` | 只剩 4 个可见元素：96px 品牌图 → `PromptManager` 大标题 → 用户名（**空**，占位「用户名」）→ 口令 → 黑色胶囊「登录」；**无任何噪音文案** ✅ |
| `02-login-error-light` | 红色 `Alert`「用户名或密码不正确」可见；框里的 `admin` 是**探针键入**的（`ac90_wrong_typed_user=admin`），不是预填 ✅ |
| `03-login-mobile` | 390×844 纵向排布、无横向溢出；⚠️ 标题**词中折行**（`PromptManage`/`r`）—— **既有问题**，见 §6 |
| `04-login-dark` | 近黑画布 + 浅色标题 + 白色胶囊按钮；用户名框空 ✅ |
| `05-after-login-light` | 真鼠标登录后进主界面：顶栏 `PromptM` + 「欢迎回来」提示 + 分栏列表（3 条夹具）+ 右栏详情（**顺带复验阶段 31 的「最多保留最近 10 个版本」文案仍在**）✅ |
| `8767-login`（部署后，见 §7） | 测试环境登录页同样**无预填、无噪音** ✅ |

## 4. 过程审查 — 干净（窗口：15:20–16:25，本阶段全部）

```
工具调用 122 次（bash 61 / edit 35 / read 13 / read_image 6 / write 5 / job_output 1 / web_fetch 1）
跑测试 14 次（含 npm test 全量 329）｜ 服务端 5xx 0
git 命令 8 条：全部 `git add <明确路径>` → **每次都先 `git diff --cached --name-only` 核暂存区** → commit（新纪律生效 ✅）
  · 提交边界干净：69a8d46(3) / 91e45e7(2) / 431aca3(2) / 3c53bb4(3) / fbee2ea(1) / 608a929(1) 文件
  系统包管理 0 ｜ 写系统路径 0 ｜ curl|bash 0 ｜ 全局安装 0 ｜ git add -A 0 ｜ 历史改写/强推 0 ｜ sudo 0
  rm -rf 真目标：只有 `dist` 与脚本内临时变量 `"$T"`
  未碰 BRIEF.md / STANDARDS.md（8860971..HEAD 改这两个文件的提交数 = **0/0**）✅
  三端一致：LOCAL = ORIGIN = GITHUB = **608a929** ｜ 工作区 0 ｜ `git ls-files tmp` = 0
  提交归属对账：**25 dsh + 17 host_manger**
  reflog 正常（无 reset/amend/rebase）｜ fsck 仅 dangling 对象（worktree 残留，正常）
  凭据：全历史出现 `_env/` 的文件数 **0**；当前树 `_env/` 0
  系统侧：`find /etc /usr/local/bin -newermt '09-21 15:20' ! -newermt '09-21 16:20'` → **0 项**（228 未重启、未装包）
  别的项目：同窗口 `find projects/ -maxdepth 2 … -not -path '*promptmanager*'` → **0 项** ✅
```

## 5. 回复对账 + **唯一未独立核实项**

它收尾回复里的每条结论都能在落盘位置找到对应（`PROGRESS.md` 阶段 32 的 ①–⑨ 小节、`tools/ci-check.sh`、
`package.json`、`web/src/components/LoginPage.tsx`、`tests/stage32-*.test.ts`、`tools/ac-stage32*`、
`README.md`、`AGENTS.md`）——**唯一的结构性例外是收尾 commit hash `608a929`**（不可能写进它自己那次提交），
已在本文件上方「被验收 commit」栏记录。

**AC-89 ④（GitHub Actions 实跑结论）—— 我同样拿不到，如实记录（不替它圆场）**：

```
仓库私有 ⇒ 未认证 api.github.com/repos/Hopetree/promptmanager 与 /actions/runs 都是 404
我这边也**没有任何可查凭据**：本容器与 228 均无 gh CLI；`_env/` 无 token；远端是 SSH 且无 credential helper
（我自己复核过：`command -v gh` 空、`grep -rl GITHUB_TOKEN _env/` 空）
⇒ 可核实的只有"推送已落地"（三端同 sha 608a929，workflow `on: push: branches: ['**']` ⇒ run 已触发）
⇒ **最强等价证据**：CI 跑的就是 `npm ci` + `bash tools/ci-check.sh`，而 AC-89 ① 已在**先删 `dist` 的干净环境**把同一脚本跑到 rc=0 / 6 项全绿
```

⇒ **待用户复核**：登录 <https://github.com/Hopetree/promptmanager/actions> 看 `608a929` 上 `ci` 的结论（**这是本次唯一需要人看一眼的项**）。

## 6. 未采纳的判断 + 两条既有缺陷（我已独立确认"既有"）

1. **它没有把四条技术说明搬进「关于」页** —— FR-88 的保留/删除清单是穷举的，未要求新增；我也认这个判断（避免与 FR-52「信息克制」冲突）。
   信息没丢：CLI 设口令在关于页「维护」段、`/healthz` 在「服务自检」段、401 规则在 `README`。**我同意不追加**。
2. **`README.md` 有重复两节**（`## 代码质量检查` / `## 怎么验证` 各 2 次，第 2 份是含 `ac-stage9.sh` 的陈旧副本）：
   我实测 `grep -c` = 2/2，且 `git log -S` 显示自 `8efd440` 起就有 ⇒ **既有**，非本阶段引入 → 记入 backlog **R-5**。
3. **登录页窄屏标题词中折行**：我按"标题元素与样式一字未动、只删了兄弟节点 ⇒ 可用宽度不变"判定 **既有** → 记入 backlog **R-6**。

## 7. 上线：测试环境（8767）已同步 ✅（2026-09-21 16:24）

> 本阶段**不含数据/契约变更**（CI 脚本 + 登录页展示层），按既有流程同一轮完成。**生产（106）未动**（见 §8）。

```
$ sudo bash /tmp/pm-deploy.sh        （我的脚本 projects/greenhouse/scripts/pm-deploy.sh，本轮新增 FR-88 冒烟）
  同步 → 权限 → npm install → 构建（✓ built in 501ms）→ systemctl restart promptmanager
  is-active=active ｜ NRestarts=0 ｜ enabled=enabled ｜ healthz={"status":"ok","version":"1.0.0"}
  未认证访问 /api/prompts = 401 ✅ ｜ 产物裸模块引用 = 0 ✅
  登录页真实渲染（>0 才算能渲染）= 1 ✅
  **FR-88 新增冒烟**：登录页 DOM 里账号名出现次数 = **0** ✅ ｜ 四条噪音合计 = **0** ✅
  数据：prompts=19（用户数据未被触碰）✅
  新 chunk：index-DgehR1MS.js（旧 index-Cpg5tUSj.js）⇒ 新代码已生效
$ 我自己再验：错口令 POST /api/login → **401** `{"error":"invalid_credentials"}` ✅（不碰用户账号）
$ 我自己再看图：8767 登录页 = 无预填、无噪音 ✅
```

**工具改进（防再犯，已落盘）**：`pm-deploy.sh` 增加 **FR-88 冒烟两项**（登录页 DOM 里账号名 = 0、四条噪音 = 0）——
理由：这是**用户可见的安全项**，若有人把预填加回来，必须在**部署当时**就红，而不是等用户打开页面发现账号名被暴露。

## 8. 验收方自省（我的失误与纪律）

1. **我的操作顺序曾制造一次"假红"**：我为跑 AC-89 ③ 执行了 `rm -rf dist && npm run typecheck:tests`
   （只构建服务端）⇒ **前端产物 `dist/web` 缺失**，随后第一次跑探针时 `GET / = 404`、探针超时、`splitList=false`。
   **这不是产品缺陷，是我的操作顺序**；`npm run build` 重建后一切正常。
   ⇒ **教训（值得写进技能）**：在**共享工作副本**里跑"删产物"类验收命令后，**必须先恢复到可运行状态**再跑运行时验收；
   并且 `splitList=false` 这类"少了一个元素"的结果**先怀疑夹具/环境**（我当时是空库 + 无前端产物，两个原因叠在一起）。
2. 验收命令是在 dsh **仍在回答用户追问**（turn 7）时跑的 —— 我只碰了 gitignore 的构建产物，但纪律上**应尽量选它停手时做**。
3. 阶段 32 的 AC-90 我**补了 3 条夹具**（它自测时只有 1 条）——夹具按真实数据分布构造这条纪律继续有效。

---

# 阶段 33 验收（FR-89 GitHub Actions 构建镜像并推送 Docker Hub）— 结论：**过**（含端到端实跑）

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`46c8a8a`**（收尾）—— 交付 `d2e1a34`（`docker.yml` + `ac-stage33.sh`）/ `8722955`（README + container.md + PROGRESS）/ `46c8a8a`（自查修正 container.md 的错误表述） |
| 规格 | BRIEF **v43**（FR-89 / AC-91 / D-32 / 阶段 33） |
| 验收方 | host_manger（**独立复现 AC-91 ①②③，并亲自跑通 ④ 的端到端发布**） |
| 结论 | **过** —— 四条判据全部由我复现；镜像已发布、可拉取、可运行 |

## 1. AC-91 ① YAML 静态断言（我自己跑，不采信它的脚本）

```
$ python3 -c "import yaml,io; d=yaml.safe_load(...)"     # 真解析（不是 grep 文本）
  解析成功: True | name = docker
  on = {'push': {'tags': ['v*'], 'branches': ['main']}, 'workflow_dispatch': None}
  permissions = {'contents': 'read'}
  steps = 5：actions/checkout@v4 · docker/setup-buildx-action@v3 · docker/login-action@v3
             · docker/metadata-action@v5 · docker/build-push-action@v6        ← 全部 pin 大版本 ✅
  build-push with = {context: '.', file: 'Dockerfile', platforms: 'linux/amd64',
                     push: "${{ startsWith(github.ref, 'refs/tags/v') }}"}
  metadata images = ${{ secrets.DOCKERHUB_USERNAME }}/promptmanager              ← 命名空间不硬编码 ✅
  login with = {username: <secret>, password: <secret>} | if = startsWith(github.ref, 'refs/tags/v')
  负向断言命中（须空）: []      ← 无 echo+secrets、无 set -x、无明文用户名/口令、无 pull_request_target、无凭据字面量
  引用 secrets 的行仅 4 处（1 处注释 + login 的 username/password + metadata 的 images）✅
```

> **如实记录我自己的失误**：第一版负向断言我用 `username:\s*(\S+)` 截断匹配，把 `${{ secrets...` 误判成"明文用户名"；
> 改成**整行判定**后通过。**是我的检查写得糙，不是它的问题。**

## 2. AC-91 ② 与 106 现行构建的一致性（我自己核）

| 项 | workflow | 106 上现行命令（已实测） |
| --- | --- | --- |
| context | `.`（仓库根） | `/opt/cloud/promptmanager/src` |
| Dockerfile | `Dockerfile`（仓库根） | 同 |
| 平台 | `linux/amd64` | amd64（实测 `Architecture=amd64`） |
| tag 方案 | `{{version}}` + `{{major}}.{{minor}}` + `latest` | 本地镜像名 `promptmanager:<ver>` |

**Dockerfile 本阶段未被改动**（`git log e6b7e37..HEAD -- Dockerfile` = **0** 提交）；`ci.yml` 亦未动（最近改动仍是 `8efd440`）。

## 3. AC-91 ③ 等价构建

```
本机（228）: command -v docker → 无 ⇒ 由 host_manger 在 106 产生该证据
106 实测（v1.0.1 时）: docker build -t promptmanager:1.0.1 . → rc=0、36 秒、镜像 959MB
⇒ workflow 的 build 参数与该命令等价（context=. / file=Dockerfile / 无自定义 target）
```

## 4. AC-91 ④ 端到端实跑 —— **我亲自跑的，且镜像真的能拉能跑**

**为什么必须发一个 tag**：`workflow_dispatch` 在**分支 ref** 上跑时 `push=false`（不推送），而 GitHub UI 的 dispatch 只能选分支
⇒ **唯一能触发"推送"路径的是推 `v*` tag**。所以我按项目自己的发版流程发了 **v1.0.2**：

```
228 上：package.json 1.0.1→1.0.2 + CHANGELOG 新增 [1.0.2] + docs/versioning.md §6 补行
        闸门：rm -rf dist && bash tools/ci-check.sh → rc=0、6 项全绿、npm test 329/329
        commit ea0125d → git tag -a v1.0.2 → main 与 tag 都推两远程（三端 ea0125d）
```

> **版本语义说明（我的决定，可被否决）**：v1.0.2 的**运行时行为与 1.0.1 完全一致**（只加 workflow 与文档）——
> 升版本的目的就是**让镜像有一个可引用的版本号**（工作流只在推 tag 时推送）。CHANGELOG 里已如实写明这一点。

**结果（Docker Hub 侧，我独立查到的）**：

```
$ curl https://dockerproxy.net/v2/hopetree/promptmanager/tags/list
{"name":"hopetree/promptmanager","tags":["1.0","1.0.2","latest"]}      ← 与 D-32 设计的三 tag 完全一致
```

**结果（我把它拉下来真跑，全程在 106、不碰生产容器）**：

```
$ bash /root/docker-pull-mirror.sh hopetree/promptmanager:1.0.2
  Digest: sha256:fda6d3b3d5a373ce6920f04e8d799df659300e3d6284c9e2427fc70a4daebde8
  架构=amd64 系统=linux 大小=165MB（压缩）/ 959MB（本地展开）
$ docker run -d -p 127.0.0.1:18767:8767 -e DATA_DIR=/data -v <临时目录>:/data hopetree/promptmanager:1.0.2
  /healthz → {"status":"ok","version":"1.0.2"} ✅
  数据目录自动初始化：media / pm.db / pm.db-wal / pm.db-shm ✅
  未认证 /api/prompts → 401 ✅
  镜像内前端 chunk：四条噪音 = 0、含「用户名」占位 ✅（= 阶段 32 的登录页修复确实在镜像里）
$ 收尾：临时容器与临时数据已删除；**生产容器 promptmanager(1.0.1) 未受影响、仍 healthy**
```

**镜像内容安全自查（我自己跑的 `docker run --rm --entrypoint sh`）**：

```
/app 顶层 = bin dist migrations node_modules package-lock.json package.json
无 web/src、无 .ts 源码、无 .env/_env、无 .git；以 node(uid 1000) 运行 ✅
```

## 5. 过程审查 — 干净（窗口 19:00–19:45）

```
工具调用 48 次（bash 22 / edit 17 / read 6 / write 2 / job_output 1）
跑测试：npm test 1 次（329/329）+ ac-stage33.sh 多次（其自检 rc=0、❌ 计数 0）
git：全部 `git add <明确路径>` + commit 前核暂存区；提交边界 2/3/3 文件
未碰部署/系统/别的机器（无 /opt、无 systemctl、无 8767、无 106 操作）；未改 BRIEF/STANDARDS/ci.yml
三端一致 46c8a8a（随后被我发版推进到 ea0125d）
```

## 6. 缺口与观察（不阻塞）

1. **106 生产仍跑 `1.0.1` 镜像**（v1.0.2 无运行时变化）。⚠️ **106 不能直连 Docker Hub**（只配了腾讯官方镜像站 `mirror.ccs.tencentyun.com`，
   实测 `hub.docker.com` / `registry-1.docker.io` 全部超时；可用的是 `dockerproxy.net` / `docker.1panel.live` 这类代理）
   ⇒ 若要让 106 改成"拉 Docker Hub 镜像"，需要额外配镜像站/代理，**收益不大**（106 本地构建只要 36 秒）。
   **建议维持现状**：Docker Hub 镜像主要服务"别的机器/别人"。
2. **私有仓库的 Actions run 我仍看不到**（无凭据）——但"镜像已出现在 Docker Hub、且能拉能跑"本身就是**推送成功**的直接证据（比看日志更强）。
3. 228 测试环境（8767）已同步到 **1.0.2**（与仓库版本一致）。

## 7. 验收方自省

1. **我第一次起容器失败（exit=1、写不进 `/data/media`）——是我自己的错**：漏了**文档已经写明**的
   `chown 1000:1000`（`README.md` 第 233 行、`deploy/container.md` §属主映射 都写了）。
   ⇒ **教训：跑"交付物文档里的命令"要逐条照抄（含注释里的前提）；失败先怀疑自己漏前提，别先怀疑交付物。**
   （我先查了文档才下结论 —— 这一步做对了，避免了把"我的操作错误"写成"它的文档缺陷"。）
2. 我的负向断言正则第一次误报（截断式 `\S+`）——**写检查也要严谨**，已修正后重跑。

---

# 阶段 34 验收（FR-90 分栏手机端撑满 + FR-91 README 用户化 + FR-92 移动端档位顺序）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`a44858f`**（收尾）—— 交付 `b3a23e8`（FR-90 + FR-92 实现 + 3 个测试文件）/ `ef8d0da`（FR-91：README 重写 + `docs/development.md` + `docs/api.md` + AGENTS.md 英文指引）/ `b37210e`（AC 工具 `ac-stage34.sh` + 探针）/ `d93931c`（PROGRESS 阶段 34）/ `a44858f`（补记 AC-91 ④ 状态） |
| 规格 | BRIEF **v45**（FR-90 / FR-91 / FR-92；AC-92 / AC-93 / AC-94〔+ AC-45 ①② 按断点修正〕；D-33 / D-34；阶段 34） |
| 验收方 | host_manger（**独立探针量数 + 自己出界面证据 + 亲自在 106 按 README 跑 Docker 路径**） |
| 结论 | **过** |

## 1. AC-92 分栏中栏在手机端撑满（**我自己量**，独立探针）

```
移动端 390×844（split）：
  .pm-split-list  w=358 / left=16 / right=374   ← 与容器同宽，ratio = 1.000
  容器 pm-view-split w=358 / left=16 / right=374
  detailCard(右栏) = false（单栏降级保留）｜ docScrollWidth = 390（无横向溢出）
  **改前（我上午同一方法实测）：w=276 / right=292 ⇒ 右侧空 82px**
同视口三档对照（我量的）：分栏 358/374 ｜ 卡片 358/374 ｜ 表格 358/374  ← 三者一致 ✅

桌面 1600×900（split）：
  .pm-split-list w=350 / left=264 / right=614   ← **与我改前实测值逐字相同（350 / 264 / 614）⇒ 零回归**
  右栏 pm-split-detail 存在 ✅ ｜ docScrollWidth = 1600
```

**我自己的界面证据（3 张，390×844，我逐张看过）**：`m2-split-light` 里**列表卡的右边缘与搜索框右边缘在同一条竖线上**（改前右侧空 82px）、档位显示「卡片 表格 分栏」且分栏高亮；`m3-split-dark` 同样撑满；`m1-default-card` 是**清空偏好后的落地**（= 卡片，见 §2）。三张均无溢出、无错位。

## 2. AC-94 移动端档位顺序与默认档位（**我自己跑**）

| 判据 | 移动 390×844 | 桌面 1600×900 |
| --- | --- | --- |
| ①/② 档位文本顺序 | **`["卡片","表格","分栏"]`** ✅ | **`["分栏","表格","卡片"]`** ✅（不得回归 → 未回归） |
| ③ 清空 `localStorage` 后默认 | 视图 `pm-view-card`、`stored='card'` ✅ | 视图 `pm-view-split`、`stored='split'` ✅ |
| ④ 预置 `pm-view-mode='table'` | 视图 `pm-view-table`、`stored='table'`（**不被覆盖**）✅ | 同左 ✅ |
| ⑤ 真鼠标依次点三档 | `pm-view-card` → `pm-view-table` → `pm-view-split`；`scrollWidth` 恒 **390** ✅ | — |

⇒ 用户要的"移动端顺序 = 卡片/表格/分栏"**已生效**，且**桌面一字未变**、**已有偏好不被覆盖**。

## 3. AC-93 README 用户化 + 两种部署方式（**我自己跑 + Docker 半我亲自实跑**）

**① 结构（我跑）**：README **249 行**（原 492）；`## 代码质量检查` = **0**、`## 怎么验证` = **0**、
`AC-[0-9]|FR-[0-9]|阶段 [0-9]+` = **0**、`ac-stage9` = **0**；`## ` 标题**无重复**；
`## 部署方式 A：Docker（推荐）` 与 `## 部署方式 B：源码运行` **都在**。⇒ **backlog R-5（重复两节）彻底消除**。

**③ 链接（我跑）**：16 个相对链接，**失效 0**。

**④ 迁移落点（我核）**：`docs/development.md`（176 行：项目结构 / 构建与测试 / 代码质量检查 / 验收体系 / 依赖与发版 / 文档归属）、
`docs/api.md`（310 行：认证 / 环境变量 / 12 组 HTTP 接口 + **31 处 curl** / CLI / MCP）；
`AGENTS.md` 有**英文**指引（`Developer docs live in docs/development.md …`）且**中文字符数 = 0**（`STANDARDS §5.1` 合规）。

**② Docker 方式 —— 我在 106 上按 README 原样跑（这是 BRIEF 分给我的那半）**：

```
① docker pull hopetree/promptmanager:1.0.2        → **失败**（106 到 Docker Hub 不通：hub.docker.com/registry-1.docker.io 超时）
   ⇒ 改用本机既有的多站脚本 bash /root/docker-pull-mirror.sh hopetree/promptmanager:1.0.2 → OK（dockerproxy.net）
② docker run -d --name pm-readme-test -p 127.0.0.1:18767:8767 -e HOST/PORT/DATA_DIR/TZ -v /tmp/hm-readme/data:/data
     --memory 512m --cpus 1.0 hopetree/promptmanager:1.0.2     （**只改 名字/端口/数据目录 以免碰生产**）
③ printf '<临时口令>' | docker exec -i pm-readme-test node bin/pm.mjs user set-password --username admin → ok
④ curl /healthz → {"status":"ok","version":"1.0.2"} ✅ ｜ POST /api/login → **200** ✅ ｜ 数据目录自动初始化 ✅
   收尾：临时容器与临时数据已删；**生产容器 promptmanager(1.0.2) 未受影响**
```

**② 源码方式（实现方实跑，我核对落盘）**：临时目录 `npm ci → build → migrate（ok: schema at v3）→ 设口令 → 起服 → /healthz 200`，
收尾清理；**它如实声明"Docker 半不由我验证"**（不冒领）✅。

## 4. 过程审查 — 干净（窗口 20:35–21:30）

```
工具调用 99 次（bash 52 / edit 18 / read 18 / write 6 / read_image 2）；跑测试与 AC **25 次**
git：全部 `git add <明确路径>` + **每次 commit 前核 `git diff --cached --name-only`**；提交边界 5 / 4 / 2 / 1 / 1 文件
**未触碰部署 / 系统 / 别的机器**（无 /opt、无 systemctl、无 8767、无 106、无 ssh）✅
未改 BRIEF / STANDARDS / ci.yml / docker.yml ✅ ｜ 三端一致 a44858f ｜ 工作区干净
```

## 5. 回复对账 + **一处我自己的规格措辞缺陷（已修）**

- 它的收尾结论逐条都能在落盘位置找到；**结构性例外只有收尾 commit hash**（已记在本文件上方）。
- ⚠️ **我的失误：AC-92 ④ 措辞把两个不同元素混成一个判据**（写成"中栏 350、中栏/可用宽 比值 0.90–0.94"）——
  实际 **350 是 `.pm-split-list`（Card，clamp 上限）**，而 FR-71 的比值口径是 **内层 `[data-testid="pm-split-list"]` 336 / 改前基线 366 = 0.918**。
  **实现方主动澄清了这一点**（PROGRESS 阶段 34 ① 的「口径澄清」段），并复跑 `ac-stage22.sh` 得 `rc=0`。
  ⇒ 我已在 BRIEF v45 里**修正 AC-92 ④ 的措辞**（一个判据只量一个元素）。**教训值得写进技能：AC 里别把"元素宽度"与"比值"混写。**
- 无「只存在于会话、未落盘」的结论。

## 6. 缺口与观察（不阻塞）

1. **README 未提「国内网络拉 Docker Hub 需要镜像站/代理」** —— 我在 106 上**按原样跑 `docker pull` 确实失败**。
   对自部署用户（尤其国内）这是必然会踩的坑 → 登记 backlog **R-8**（建议在「部署方式 A」或 FAQ 加一行）。
2. 桌面 1600 下中栏 350 / 内层 336 —— 与阶段 22 / 31 口径一致（我逐字对照了改前值）。

## 7. 验收方自省

- **派活前把"改前值"量死（276/292）**，实现方交付后我能量到同一个数（358/374）⇒ 本轮**零返工**，这条做法值得继续。
- 但我的 **AC 措辞**给了实现方一个含糊判据（见 §5）——**"判据要能一眼看出量的是哪个元素"**。

---

# 阶段 35 验收（FR-93 MCP Streamable HTTP 传输 + FR-94 Token 可随时查看）— 结论：**过**（两条独立，都过）

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`6fe0fd5`**（收尾）—— 交付 `008338e`（FR-93 MCP HTTP + 凭据透传 + 5 例单测）/ `162614d`（FR-94 Token 加密可查看 + 迁移 004 + CLI + UI + 10 例单测）/ `b74a3ce`（AC 工具 + 真客户端脚本）/ `6fe0fd5`（文档 + PROGRESS） |
| 规格 | BRIEF **v46**（FR-93 / FR-94；AC-95 / AC-96；D-35；阶段 35） |
| 验收方 | host_manger（**用官方 Python MCP 客户端独立握手 + 自己起临时实例 + 自己点 UI 读剪贴板 + 自己查库**） |
| 结论 | **过** |

## 1. AC-95 MCP Streamable HTTP —— **我用官方客户端（`mcp==1.30.0`）自己跑**

```
① 正向（带有效 token，打 http://192.168.0.228:8768/mcp）：
   initialize → serverInfo = promptmanager 1.0.2 ｜ protocolVersion = 2025-11-25
   tools/list → prompt_search, prompt_get, prompt_render
   tools/call prompt_search → 命中夹具 2 条；prompt_get(1) → 返回正文
② 负向：不带 Authorization → 401（客户端 HTTPStatusError 401 + curl `{"error":"unauthorized"}`）
        错 token           → 401（同上）
   **精确复验**：只发这两次负向请求，内部 `/api/` 请求数 **8 → 8（未触碰内部 API）** ✅
③ 凭据透传（硬证据）：**服务进程 env 里 `PM_API_TOKEN` 出现次数 = 0**，而上面 /mcp 的工具调用成功
   ⇒ 只可能用的是**请求头里的 token**（若回退 env 必失败）；`usage_events` 记 `channel='mcp'` ✅
④ stdio 不回归：`bin/pm-mcp.mjs` + env 方式握手 → 三工具 ✅
⑤ 文档（我逐处核）：`docs/api.md` §5.1（方法/必需头/401/无状态/透传）、`README.md`「远程 MCP 接入」（**内部术语 = 0**）、
   `AGENTS.md` 英文段、`deploy/container.md` §7.1（反代 `/mcp` + 透传 `Authorization`）✅
⑥ 不泄密：服务日志里 token 明文 **0** 次 ✅
```

> ⚠️ **一处口径如实记录**：`usage_events` 表**只有 `channel`，没有 `token_id` 列**（我独立查了表结构）——
> 所以"该次取用归属 token A"**无法直接查证**，只能用上面 ③ 的两条间接证据（env 无凭据 + 调用成功）。
> 实现方**主动登记了这一点**并说明"如需直接归因请另下指令"。**我认可**（不阻塞本阶段；AC 里那句"归属 token A"是我写宽了）。

## 2. AC-96 Token 可随时查看 —— **我自己跑**

| # | 判据 | 我的实测 |
| --- | --- | --- |
| ① | 迁移 | `ok: schema at v4`；`api_tokens` 含 `token_enc`；`schema_migrations=[1,2,3,4]` ✅ |
| ② | 新建可查看 | `POST /api/tokens/:id/reveal`（会话）→ **200**，明文与创建时**逐字相同**；列表 `revealable=true/false` 正确且**响应不含 `pm_`** ✅ |
| ③ | 旧 token 两态 | 我把 `token_enc` 置 NULL 模拟迁移前旧 token → reveal **409 `token_not_revealable`**；**该 token 打 `/api/prompts` 仍 200** ✅ |
| ④ | 权限 | 用 **Bearer** 调 reveal → **403 `session_required`**（消息明说"只允许浏览器会话"）✅ |
| ⑤ | 密文与密钥 | `token_enc` = 100 字节、**不含 `pm_` 前缀**；密钥文件 **600 root**；**重启后 reveal 仍成功且明文一致** ✅ |
| ⑥ | UI（真鼠标 + 剪贴板） | 真鼠标点 `⋯更多 → API 令牌` → 点 `pm-token-copy-1` → **剪贴板 sha256 与期望 token 完全一致**（长度 46）；旧 token 行有 `pm-token-unrevealable-2`；无 JS 异常 ✅ |
| ⑦ | 密钥缺失/恢复 | 移走密钥 → **500 `token_enc_key_unavailable`**（错误体不含明文、**服务不崩**、**鉴权仍 200**）；恢复后 reveal 恢复 ✅ |
| ⑧ | 不泄密 | 应用日志里明文 **0** 次 ✅ |

## 3. 过程审查 — 干净（窗口 22:40–00:30）

```
工具调用 85 次（bash 59 / write 10 / read 7 / edit 5 / job_output 2 / read_image 2）
git：4 个提交，全部 `git add <明确路径>` + **commit 前核暂存区**；提交边界 6 / 12 / 3 / 5 文件
跑测试/AC/MCP 相关 37 次（含它自建 .venv 用官方 Python 客户端做真客户端验证）
**未触碰部署/系统/别的机器**（临时实例用 `mktemp -d` 目录，未用 8767/106）✅ ｜ 三端一致 `6fe0fd5`
回归：`npm test` **348/348**（我复核）+ `ci-check` 先删 dist 全绿（它跑）
```

## 4. 回复对账 + **它自己登记并修掉的两处**（值得记）

1. **断言假红**：首版用 `token_enc LIKE '%pm_%'` 判"密文不是明文" —— base64 字符集含 `p`/`m`/`_`，**偶然命中是正常的**
   （它实测 id=1 就命中了）⇒ 判据改为"**不以 `pm_` 前缀开头**" + "≠ 明文" + "长度符合 base64"。**我认可这个修正**（我的检查本来就用的是"不含 `pm_` 前缀"口径）。
2. **它自己识图发现的观感回归**：新增「令牌」列后 720px 抽屉把名称挤成 `A...` ⇒ 抽屉 **720 → 880** + 名称列 `width: 200`，重跑探针确认。

⇒ 两处都是**主动自查 + 修正 + 登记**，不是被我抓出来的。

## 5. 缺口与观察（不阻塞）

1. `usage_events` **无 `token_id` 列** ⇒ 无法按 token 直接归因（如需，另行派活）。
2. **远程 MCP 目前只在仓库与测试环境可用**：**106 生产仍是 `1.0.2`**（既没有 `/mcp`，也没有 token 可查看）——
   用户此前明确"不用发 tag"，故本轮**未动生产**。要让 QwenPaw 的远程 MCP 指向生产，需要一次发版。

## 6. 验收方自省

- 我 AC-95 ③ 写了"usage 记录里该次取用**归属 token A**"，而该字段**根本不存在** —— 实现方发现并如实登记。
  ⇒ **教训（与阶段 34 的 AC-92 ④ 同源）：写 AC 前先把目标表结构/字段查清，判据只能落在真实存在的东西上。**
- 本轮我坚持"派活前把可验证的锚点钉死"（临时实例 + 官方客户端 + 查库 + 真鼠标），**零返工**。

---

# 阶段 36 验收（FR-95 同步复制 + FR-96 撤销态可删除 + FR-97 去创建弹窗）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`ad0d6f2`**（收尾）—— `f8558db`（FR-95 剪贴板修复）/ `0b95ac2`（FR-96 + FR-97）/ `3473aa7`（单测 + AC 工具）/ `ad0d6f2`（文档 + PROGRESS） |
| 规格 | BRIEF **v47**（FR-95 / FR-96 / FR-97；AC-97 / AC-98 / AC-99；D-36；阶段 36） |
| 验收方 | host_manger（**在内网 IP 的非安全上下文下真鼠标 + 真粘贴**，并用真浏览器读回剪贴板） |
| 结论 | **过** |

## 1. AC-97 同步复制 —— 关键就在"**用内网 IP 验**"

| # | 判据 | 我的实测 |
| --- | --- | --- |
| ① | 环境 | `http://192.168.0.228:8768`：`isSecureContext = false`、`typeof navigator.clipboard = undefined` ✅ |
| ② | **点「复制」→ 剪贴板里真有明文** | **真鼠标点「复制」→ 真 Ctrl+V 粘贴读回**：长度 **46**、sha256 **与期望明文逐字一致** ✅ |
| ③ | **同步**（点击时不再取明文） | 抽屉打开前 `reveal(id=2)` 计数 **4** → 点「复制」后 **5**（**增量 1 = 打开抽屉时的预取**；**点击时 0 次请求**）✅ |
| ④ | 兜底入口存在且指向真实 | `pm-token-show-<id>` 真「显示」入口存在；点击后**明文出现在页面**且元素 `computed user-select = text`（可选中）；失败文案已改为「浏览器不允许自动复制：**点「显示」后手动选中复制（Ctrl/Cmd+C）**」——**指向真实存在的操作** ✅ |
| ⑤ | 明文不落持久存储 / 关抽屉即清 | `localStorage`/`sessionStorage`/URL 搜 `pm_` **全空**；**关闭抽屉后页面里搜不到明文** ✅ |
| ⑥ | 回归 | 有效 Bearer 调 reveal → **403 `session_required`**（同一 Bearer 调 `/api/prompts` = 200，证明 token 有效、403 是"仅会话"规则）✅ |

> **对照实验**：安全上下文（`127.0.0.1`）同样能复制 —— 但**只有内网 IP 才代表用户环境**；上一轮就是漏了这一点。

## 2. AC-98 撤销态可删除（闭环）

```
UI（真鼠标）：有效行**没有**「删除」；撤销 id=1 + 确认 → 该行只剩 `pm-token-delete-1`（复制/显示/撤销都不再出现）
             点「删除」→ 二次确认文案：「永久删除这个 token？／永久删除、不可恢复：整行会被真删（审计记录一并消失）。」
             确认 → **该行消失** ✅
接口三态：有效 → **409 `token_not_revoked`** ｜ 不存在 → **404** ｜ 标准序列：撤销 204 → 硬删 **204** → 重复 **404** ✅
真删：删后列表无该行，**直接查库 `SELECT count(*)` = 0** ✅
回归：该 token 的明文调 API → **401** ✅ ｜ 文档：`docs/api.md` 有 `permanent`（2 处）与 `token_not_revoked` ✅
```

## 3. AC-99 去掉创建时的明文弹窗

```
真鼠标创建 → **页面上 `modalCount = 0`、无任何明文 Modal**；提示 =「已创建；点列表里的「复制」取明文」（源码核）✅
新行「复制」→ **真粘贴读回 sha256 与该 token 真实明文完全一致** ✅
回归：`POST /api/tokens` 响应仍含明文一次；新行 `revealable = true` ✅
```

## 4. 实现方对规格的一处**偏离**（它主动登记，我认可）

- 我的 FR-95 写了「**不改** `web/src/clipboard.ts` 兜底」，但实现方指出：**只做同步化修不好** ——
  真正的**第二个根因**是**抽屉的焦点陷阱**把焦点抢回按钮，而旧兜底「隐藏 textarea + `select()`」复制的是**焦点元素**的选区
  ⇒ `execCommand('copy')` **返回 true 但剪贴板长度 0**（它用埋点实测：选区 0–46 正确、`document.activeElement` 仍是 `BUTTON`）。
  ⇒ 改为 **Selection API**（`Range` 选中隐藏 `span` → 复制**文档选区**），**不受焦点影响**。
  **它在 commit message 与 PROGRESS 里都登记了这处偏离与理由** —— 我的规格确实写窄了，**这个偏离是对的**。
- 另一处自查：「显示」的元素需要显式 `user-select: text`（antd 6 Typography 默认 `user-select: none` 且无 `selectable` prop）——它实测发现并修。

## 5. 我自己这轮的验收教训（记在案）

- 我第一次用「真粘贴」读剪贴板**连读两次都是空**，一度以为修复无效 —— 根因是**我的工具**：
  粘贴靶子用了**抽屉外**的搜索框，被抽屉的**焦点陷阱**抢走焦点（**正是它诊断出的那个机制**）。
  改用**抽屉内**的输入框（`pm-token-name`）后**立刻读出明文**。
  ⇒ **教训：验收工具本身要先做对照（安全上下文/抽屉内 vs 抽屉外）再下结论**——否则会把自己的工具缺陷误判成交付物缺陷。

## 6. 上线状态

- 228 测试环境（**8767**）**已同步**：用户可直接在**自己的浏览器**里复验「复制」是否进剪贴板（原报障场景）。
- **106 生产未动**（仍是 `1.0.2`；用户此前明确"不用发 tag"，本阶段也**未动生产**）。

---

# 阶段 37 验收（FR-98 令牌列表折叠排版）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`bd9b6c8`**（收尾）—— `eea8369`（`TokenDrawer` 折叠排版）/ `7358da6`（单测 + AC 工具）/ `bd9b6c8`（PROGRESS） |
| 规格 | BRIEF **v48**（FR-98；AC-100；D-37；阶段 37） |
| 验收方 | host_manger（**内网 IP 非安全上下文 + 真鼠标 + 真粘贴 + 自己看图**） |
| 结论 | **过** |

## 1. 改前 / 改后：宽度与横向滚动（改前数我自己从 git 历史算）

```
改前（commit 5ef532e 的 TokenDrawer）：6 列固定宽 200+90+150+150+250+150 = **990** ｜ 抽屉 **880** ⇒ 溢出 **110**、必须横向滑动
改后（HEAD）：抽屉 **620**（≤640）｜ 表格 **scrollWidth 580 / clientWidth 580 ⇒ 无横向滚动** ✅
             名称列**完整显示**（`ac37-active` / `ac37-revoked`，无 `A…` 截断）✅
```

## 2. 折叠态列头（我自己跑）

```
["", "名称", "状态", "创建时间", "使用"]     （首项空 = 展开列）
⇒ **恰好** 名称 / 状态 / 创建时间 / 使用，**无「最近使用」「操作」列头** ✅（顺序断言）
```

## 3. 「使用」列 + 展开区（内网 IP + 真鼠标 + 真粘贴）

| 判据 | 实测 |
| --- | --- |
| 点「复制」→ 剪贴板 | **真 Ctrl+V 粘贴读回**：长度 **46**、sha256 **`754bad171946ee516ef9dbd8` == 期望明文** ✅（FR-95 同步复制不回归） |
| 点「显示」→ 展开 | 展开区出现 ✅、**明文可见**且元素 `computed user-select = text`（可选中）✅ |
| 再点一次 → 收起 | 展开区**离开 DOM**（`pm-token-details-1` 不存在）✅ |
| 有效行展开区内容 | 按钮 = `["撤 销"]`（**没有「删除」**）✅ ｜ 最近使用 = `—`（该 token 从未使用）✅ |
| **已撤销行**能否展开 | **点 `pm-token-expand-2`（行展开按钮）→ 展开** ✅ ⇒ **「删除」可达**（这正是我补的那条必需设计） |
| 已撤销行展开区内容 | 按钮 = `["删 除"]`、**没有「撤销」** ✅ ｜ 有效行**没有** `pm-token-delete-1` ✅ |
| 删除闭环（真鼠标） | 点「删除」→ 二次确认 `["取 消","永久删除"]` → 确认 → **该行消失**；**直查库 `id=2` 行数 = 0**（真删）✅ |
| 关抽屉 | 页面里搜不到明文 ✅ |

## 4. 视觉证据（我自己截图并看图）

亮 / 暗各一张（`tokens-light.png` / `tokens-dark.png`）：4 列排布清晰、**每行都有展开箭头**、「使用」列两按钮对齐、
**无挤压 / 无重叠 / 无横向滚动条**、名称完整显示；说明文案已更新为「…点「显示」后可手动选中复制」✅

## 5. 过程审查 + 回归

```
工具调用 50 次（bash 35 / read 5 / job_output 3 / write 3 / read_image 3 / edit 1）
git：提交信息走 tmp 文件、`git add <明确路径>`、推送两远程；**未触碰部署 / 系统 / 别的机器** ✅ ｜ 三端一致 `bd9b6c8`
`npm test` = **362/362**（我复核：355 + 7 新例）｜ `ci-check`（**先删 dist**）rc=0 ✅
```

## 6. 我的验收工具教训（继续记在案）

- 第一次点不开「已撤销行」的展开按钮 → 原因是**我用了 antd 默认 class 选择器**，而实现方把展开按钮**自定义**为
  带 `data-testid="pm-token-expand-<id>"` 的 Button ⇒ 换成 testid 后一次通过。
  （**它给自定义控件留了稳定 testid，这点做得好**；我的选择器要跟上它的实现。）

## 7. 上线状态

- **8767 测试环境已同步**（用户可直接在浏览器里看新排版 + 试折叠）。
- **106 生产未动**（仍 `1.0.2`；用户此前"不用发 tag"，本阶段亦未动）。

---

# 阶段 38 验收（FR-99 令牌列表改固定 6 列、去掉折叠）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`f36200c`**（收尾）—— `627f8ce`（`TokenDrawer` + `pure.ts`：6 列 / 截断 / 脱敏）/ `144519c`（单测改 6 列口径 + AC 工具）/ `f36200c`（PROGRESS） |
| 规格 | BRIEF **v49**（FR-99；AC-101；**AC-100 作废**；D-38） |
| 验收方 | host_manger（**内网 IP 非安全上下文 + 真鼠标 + 真粘贴 + 自己造长名/旧 token 数据 + 自己看图**） |
| 结论 | **过** |

## 1. 列头与「无折叠」（我自己跑）

```
列头按顺序 = ["名称","Token","状态","使用","最近使用","操作"]          ✅ 恰好 6 列、顺序正确
折叠残留（须全 0）：pm-token-expand-* = 0 ｜ pm-token-details-* = 0 ｜ pm-token-lastused-* = 0 ｜ .ant-table-row-expand-icon = 0  ✅
行内实际 testid = pm-token-name-* / pm-token-mask-* / pm-token-copy-1 / pm-token-revoke-* / pm-token-delete-2
```

## 2. 名称截断 + Token 脱敏（我自己造数据验）

```
长名 `ac38-very-long-token-name-abcdef`（32 字符）→ 单元格文本 = `ac38-very-long-token…`（**前 20 字符 + 省略号**）✅
                                                     该单元格 `title` = **完整名** ✅
Token 单元格 = `pm_pA...kCfM` == **前 5 位 + `...` + 后 4 位**（与期望明文逐字对照）✅
**页面里不出现完整明文**（46 字符 `pm_…` 命中 **0**）✅
取不到明文的行（已撤销行 / 我模拟的"迁移前旧 token"）Token 列 = `—` ✅
```

## 3. 使用 / 最近使用 / 操作（真鼠标 + 真粘贴）

```
点「复制」→ **真 Ctrl+V 粘贴读回**：长度 46、sha256 `0de23b088f87ec75f3b90eab` == 期望明文 ✅
   （在 `http://192.168.0.228:8768` **非安全上下文**下做的）
最近使用 = `2026/09/22 10:39`（我给它做了一次取用）｜ 从未使用 = `—` ✅
操作列：**有效行只有「撤销」**（无删除）｜ **已撤销行只有「删除」**（无撤销）✅
真鼠标删除已撤销行 → 二次确认 → 行消失 ｜ **直查库 id=2 行数 = 0** ✅
```

## 4. 宽度与视觉

```
抽屉宽度 = **640** ｜ 表格 scrollWidth/clientWidth = **600/600 ⇒ 无横向滚动** ✅
亮 / 暗两张截图我自己看过：列序与用户给的表一致、名称省略号、掩码列居中、无挤压 / 无重叠 / 无横向滚动条 ✅
```

## 5. 回归与"测试口径"

```
`npm test` = **371/371**（我复跑；362 + 9 新例）｜ `ci-check`（先删 dist）rc=0 ✅
阶段 37 那批旧断言是**改写**而不是删除：我核了残留的 3 处匹配，全是**负向断言**
（断言 `expandable` / `pm-token-expand-` / `pm-token-details-` / `pm-token-show-` **必须不存在**）✅ —— 正是我要的口径
过程审查：31 次工具调用、提交边界 2 / 5 / 1 文件、**未触碰部署/系统/别的机器**、三端一致 `f36200c` ✅
```

## 6. 一处与 D-38 的小偏差（无影响，我认）

- D-38 我写「抽屉维持 **620**」，实现方定为 **640**（理由：`tableLayout=fixed` 下"最近使用"列会被压扁、时间被裁 —— 它写进了 PROGRESS）。
  AC-101 的判据是 **≤640 且无横向滚动** ⇒ **通过**；640 = 表格 600 + 内边距，比 620 **更贴合实际列宽**，**我认这个选择**。

## 7. 上线状态

- **8767 测试环境已同步**（用户可直接刷新看新表格）。
- **106 生产未动**（仍 `1.0.2`）。

---

# 阶段 39 验收（FR-100 撤销后的 token 仍显示值并支持复制）— 结论：**过**

| 项 | 值 |
| --- | --- |
| 被验收 commit | **`e716ac3`**（收尾）—— `9ac90e8`（`TokenDrawer` 两处改动）/ `0a3934b`（单测按 FR-100 口径更新 + AC 工具）/ `e716ac3`（PROGRESS） |
| 规格 | BRIEF **v50**（FR-100；AC-102；D-39；阶段 39） |
| 验收方 | host_manger（**内网 IP 非安全上下文 + 真鼠标 + 真粘贴 + 自己造"已撤销/无密文"两种行**） |
| 结论 | **过** |

## 1. 我造的三行数据 + 实测表格（原样）

```
[["ac39-active",       "pm_Lr...44Wc", "有效",   "复制", "—", "撤销"],
 ["ac39-revoked",      "pm_MC...AP8M", "已撤销", "复制", "—", "删除"],   ← 本阶段的主角
 ["ac39-legacy-noenc", "—",            "有效",   "—",    "—", "撤销"]]

列头 = ["名称","Token","状态","使用","最近使用","操作"]   ✅ 6 列不变
```

- ① **撤销行的 Token 列 = 掩码** `pm_MC...AP8M`，**与我在建 token 时算出的期望掩码逐字一致** ✅（不再是 `—`）
- ② **撤销行有「复制」**（`pm-token-copy-2`）→ **真鼠标点击 → 真 Ctrl+V 粘贴读回**：
  长度 46、sha256 **`cb06524e25172725350de441` == token2 的期望 sha256** ✅（在**非安全上下文**下做的）
- ③ **精确量"点击是否发请求"**（只开一次抽屉、只点一次）：
  `reveal(id=4)` 计数 **0 → 1** ⇒ 那 1 次是**抽屉打开时的预取**，**点击本身 0 次请求** ✅（同步写成立）
- ④ **无密文的旧 token**：Token 列 `—`，且带 `title` = 「**迁移前创建的令牌没有保存可恢复的密文，无法查看；可撤销后重建**」 ✅（不报错、不留空白）
- ⑤ **页面里不出现完整明文**（46 字符 `pm_…` 命中 **0**）✅
- ⑥ **操作列不变**：`revoke-1`（有效）｜`delete-2`（已撤销）｜`revoke-3`（有效）⇒ 只有已撤销行给「删除」✅；
  真鼠标删除 → 二次确认 → 行消失 + **直查库 id=2 行数 = 0** ✅
- ⑦ **回归**：列头 6 列顺序不变；抽屉 **640**、表格 **600/600 无横向滚动**；**关抽屉后页面里没有完整明文**；
  `localStorage` 无长串；`npm test` **379/379**（我复跑，371 + 8 新例）；`ci-check`（先删 dist）**rc=0** ✅
- ⑧ **视觉**：亮 / 暗截图我自己看过 —— **撤销行的掩码与「复制」按钮确实可见**，与有效行视觉一致（只有状态标签与操作按钮不同）✅

## 2. 过程审查

```
工具调用 32 次（bash 19 / read 4 / job_output 3 / write 3 / read_image 2 / edit 1）
跑测试与 AC 9 次 ｜ **commit 前核 `git diff --cached --name-only` 3 次**（3 个提交，纪律在位）
**未触碰部署 / 系统 / 别的机器** ✅ ｜ 提交边界 1 / 5 / 1 文件（单用途、干净）｜ 三端一致 `e716ac3`
```

## 3. 口径说明（写进 D-39，我认同）

- **撤销 = 立即失效，不是销毁**：密文仍在库、`revealable` 仍为 true ⇒ 列表继续显示掩码并可复制；
  这正是用户要的语义（"撤销的 token 可能还在别处用着，需要核对值"）。
- **服务端一行未改**（`revealToken()` 本来就不看 `revoked_at`）⇒ 纯前端两处：**预取过滤** + **「使用」列判断**。
- **安全影响如实记录**：能拿到浏览器会话的人本来就能看/复制**有效** token，让**已撤销**的也可见**没有扩大攻击面**；
  明文仍只在内存、关抽屉即清、不落任何持久存储。

## 4. 上线状态

- **8767 测试环境已同步**（用户可直接刷新看到撤销行的掩码与「复制」）。
- **106 生产未动**（仍 `1.0.2`）。
