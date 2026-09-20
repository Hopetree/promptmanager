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
