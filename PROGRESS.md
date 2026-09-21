# promptmanager 进度（PROGRESS）

> **本文件只保留三样**：当前状态表 · 阶段索引表 · 归档指引。
> **完整过程记录（每条 AC 的命令、原样输出、逐张识图、决策与踩坑留痕）已归档到
> [`docs/dev-history/PROGRESS.md`](docs/dev-history/PROGRESS.md)**（阶段 1 – 阶段 25）。
> 归档是**移动**，内容一字未删；归档动作见「上线准备 P1」提交。

| 项 | 值 |
| --- | --- |
| 阶段 | **阶段 1–29 已全部完成**；已发布 **v1.0.0** |
| 状态 | 等 host_manger 最终验收（逐阶段验收记录见 `VERIFY.md`）；**阶段 27（FR-77~FR-81 / AC-78~AC-82）、阶段 28（`AGENTS.md` / AC-83，含全英文返工）与阶段 29（FR-82/FR-83 / AC-84/AC-85，阶段 27 的 5 条视觉细化）自检全过**（见本文件「阶段 27」「阶段 28」「阶段 29」） |
| 版本 | **`1.0.0`**（首个正式版；`package.json` 单一来源，`/healthz` 同源） |
| 最后更新 | 2026-09-21 |
| 归档 | [`docs/dev-history/PROGRESS.md`](docs/dev-history/PROGRESS.md)（完整过程记录） |

## 阶段索引

> 锚点指向归档文件里该阶段的「实施与自检」小节（含 AC 原样输出与截图识图结论）。

| 阶段 | 一句话产出 | 归档锚点 |
| --- | --- | --- |
| 1 | 仓库骨架 + 配置 + 迁移 + 日志 + `/healthz` + 依赖登记（AC-1/2/18/19） | [`#2026-09-18-阶段-1-实施与自检收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-1-实施与自检收尾) |
| 2 | 认证：cookie 会话 + argon2id + 登录限流（AC-3/4/15） | [`#2026-09-18-阶段-2-实施与自检认证与账号收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-2-实施与自检认证与账号收尾) |
| 3 | prompt CRUD + 中文检索（FTS5 trigram + LIKE 兜底）+ 筛选分页（AC-5/6/7/14） | [`#2026-09-18-阶段-3-实施与自检crud-检索-筛选分页收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-3-实施与自检crud-检索-筛选分页收尾) |
| 4 | 版本历史（diff + 回滚）+ 模板变量 + Markdown 渲染（净化 + 高亮）（AC-8/9/12） | [`#2026-09-18-阶段-4-实施与自检版本-变量-markdown收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-4-实施与自检版本-变量-markdown收尾) |
| 5 | JSON 全量导出 / 导入（replace 二次确认语义 + 原子写入）（AC-10/11） | [`#2026-09-18-阶段-5-实施与自检导入导出收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-5-实施与自检导入导出收尾) |
| 6 | 对外可用面：API Token / CORS 白名单 / 使用记录 / 使用侧 CLI（AC-22/23/24/27/28） | [`#2026-09-18-阶段-6-实施与自检对外可用面收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-6-实施与自检对外可用面收尾) |
| 7 | MCP server（stdio，三个只读工具）（AC-25/26） | [`#2026-09-18-阶段-7-实施与自检mcp-server收尾`](dev-history/PROGRESS.md#2026-09-18-阶段-7-实施与自检mcp-server收尾) |
| 8 | 前端 P0（登录 / 列表 / 编辑器 / 版本 / 变量 / 预览 / 导入导出，全部 antd）（AC-13/20/21） | [`#2026-09-18-阶段-8-实施与自检前端-p0全部-antd`](dev-history/PROGRESS.md#2026-09-18-阶段-8-实施与自检前端-p0全部-antd) |
| 9 | 部署文件（systemd）+ README 四要素 + 全量测试 + 凭据卫生（AC-16/17/18） | [`#2026-09-18-阶段-9-实施与自检收尾fr-10b-ac-161718-readme-四要素-tmp-清理`](dev-history/PROGRESS.md#2026-09-18-阶段-9-实施与自检收尾fr-10b-ac-161718-readme-四要素-tmp-清理) |
| 9.1 | FIX：systemd unit 允许 `AF_NETLINK` | [`#2026-09-18-阶段-91-实施与自检fix-1unit-允许-af_netlink-排查条目`](dev-history/PROGRESS.md#2026-09-18-阶段-91-实施与自检fix-1unit-允许-af_netlink-排查条目) |
| 10A | 视觉重设计·设计打样（A/B/C 三套方向 + 令牌草案；用户选 A） | — |
| 10B | 视觉重设计·全站应用（方向 A + 登录页 B） | — |
| 11 | 使用优先改造（取用优先的信息架构） | [`#2026-09-18-阶段-11-实施与自检使用优先改造`](dev-history/PROGRESS.md#2026-09-18-阶段-11-实施与自检使用优先改造) |
| 11.1 | FIX：未填变量在预览与复制结果里原样保留 `{{name}}` | [`#2026-09-19-阶段-111-实施与自检fix未填变量在预览与复制结果里原样保留-name`](dev-history/PROGRESS.md#2026-09-19-阶段-111-实施与自检fix未填变量在预览与复制结果里原样保留-name) |
| 12 | 导航归位 + 信息克制 | [`#2026-09-19-阶段-12-实施与自检导航归位-信息克制`](dev-history/PROGRESS.md#2026-09-19-阶段-12-实施与自检导航归位-信息克制) |
| 13 | 取消管理页 + 主题图标三态 + 修「新建未保存即入库」 | [`#2026-09-19-阶段-13-实施与自检取消管理页-主题图标三态-修复新建未保存即入库`](dev-history/PROGRESS.md#2026-09-19-阶段-13-实施与自检取消管理页-主题图标三态-修复新建未保存即入库) |
| 14 | 分栏视图（三栏）+ 删除旧「列表视图」 | [`#2026-09-19-阶段-14-实施与自检分栏视图-删除列表视图`](dev-history/PROGRESS.md#2026-09-19-阶段-14-实施与自检分栏视图-删除列表视图) |
| 15 | 顶栏重排 + ⋯更多项序 + 文件夹区优化 + 标签胶囊云 | [`#2026-09-19-阶段-15-实施与自检顶栏重排-更多菜单项序-文件夹区优化-标签胶囊云`](dev-history/PROGRESS.md#2026-09-19-阶段-15-实施与自检顶栏重排-更多菜单项序-文件夹区优化-标签胶囊云) |
| 16 | P0 修复：文件夹删除 / Logo / 关于页 / 装饰块 / 编辑页 / 收藏 / 主题图标 | [`#2026-09-19-阶段-16-实施与自检p0-修复文件夹删除-logo关于页装饰块编辑页收藏主题图标`](dev-history/PROGRESS.md#2026-09-19-阶段-16-实施与自检p0-修复文件夹删除-logo关于页装饰块编辑页收藏主题图标) |
| 17 | 品牌图形全站统一（同一枚「>_」图标，只换尺寸） | [`#2026-09-19-阶段-17-实施与自检品牌图形全站统一同一枚图标-只换尺寸`](dev-history/PROGRESS.md#2026-09-19-阶段-17-实施与自检品牌图形全站统一同一枚图标-只换尺寸) |
| 18 | FR-60 文案漂移清理 + FR-61 构建体积瘦身（懒加载 + 分包）+ FR-62 编辑器全屏 | [`#2026-09-19-阶段-18-实施与自检fr-60-注释文案漂移清理-fr-61-构建体积瘦身-fr-62-编辑器全屏`](dev-history/PROGRESS.md#2026-09-19-阶段-18-实施与自检fr-60-注释文案漂移清理-fr-61-构建体积瘦身-fr-62-编辑器全屏) |
| 19 | FR-63 应用内全屏 + FR-64 FIX diff 尾换行假变更 + FR-65 FIX 内网 HTTP 复制 | [`#2026-09-19-阶段-19-实施与自检fr-63-编辑器全屏改应用内全屏-fr-64-fix-版本-diff-备注假变更-fr-65-fix-内网-http-复制失效`](dev-history/PROGRESS.md#2026-09-19-阶段-19-实施与自检fr-63-编辑器全屏改应用内全屏-fr-64-fix-版本-diff-备注假变更-fr-65-fix-内网-http-复制失效) |
| 20 | FR-66 详情页去冗余头部 + FR-67 ⋯更多「修改密码」（新接口 + 会话语义） | [`#2026-09-20-阶段-20-实施与自检fr-66-详情页去冗余头部-fr-67-更多修改密码`](dev-history/PROGRESS.md#2026-09-20-阶段-20-实施与自检fr-66-详情页去冗余头部-fr-67-更多修改密码) |
| 21 | FR-68 备注=纯文本 + FR-69 详情面标题下备注行 | [`#2026-09-20-阶段-21-实施与自检fr-68-备注纯文本-fr-69-详情面标题下备注行`](dev-history/PROGRESS.md#2026-09-20-阶段-21-实施与自检fr-68-备注纯文本-fr-69-详情面标题下备注行) |
| 22 | FR-70 拖拽排序（@dnd-kit + `sort_order` 迁移 + 自定义排序档）+ FR-71 分栏中栏精简与宽度 -8% | [`#2026-09-20-阶段-22-实施与自检fr-70-拖拽排序-fr-71-分栏中栏精简与宽度--8`](dev-history/PROGRESS.md#2026-09-20-阶段-22-实施与自检fr-70-拖拽排序-fr-71-分栏中栏精简与宽度--8) |
| 23 | FR-72 文件夹筛选含子目录 + FR-73 卡片末行贴底 + FR-74 表格拖拽与刷新感 | [`#2026-09-20-阶段-23-实施与自检fr-72-文件夹筛选含子目录-fr-73-卡片末行贴底-fr-74-表格拖拽刷新感`](dev-history/PROGRESS.md#2026-09-20-阶段-23-实施与自检fr-72-文件夹筛选含子目录-fr-73-卡片末行贴底-fr-74-表格拖拽刷新感) |
| 24 | FR-75 修「卡片拖动根本不生效」：取消跨目录限制 + 后端槽位保持 + 本体可拖 | [`#2026-09-20-阶段-24-实施与自检fr-75-d-30修卡片拖动根本不生效`](dev-history/PROGRESS.md#2026-09-20-阶段-24-实施与自检fr-75-d-30修卡片拖动根本不生效) |
| 25 | FR-76 顶栏品牌文字 → `PromptM`（其余四处保持全名） | [`#2026-09-20-阶段-25-实施与自检fr-76-d-31顶栏品牌文字-promptm`](dev-history/PROGRESS.md#2026-09-20-阶段-25-实施与自检fr-76-d-31顶栏品牌文字-promptm) |
| 26 | 上线准备：文档整理 + 产物清理（P1）+ 质量检查/版本 1.0.0/flaky 修复（P2） | 本文件「上线准备 P1」「上线准备 P2」「P2 返工」 |
| 27 | FR-77 表格批量操作（复选框/全选/批量收藏·移动·删除）+ FR-78 详情页「文件夹+标签」可改 + FR-79 去「备注」页签 + FR-80 去变量区块 + FR-81 加大 VarsDialog | 本文件「阶段 27」 |
| 28 | 项目级 `AGENTS.md`（AI 代理操作指南：常用命令 / 结构地图 / 约定 / 红线 / 10 条本项目特有的坑 / 文档地图 / 协作约定；按 STANDARDS §5.1 **全文英文**） | 本文件「阶段 28」 |
| 29 | FR-82 表格批量 UI 细化（表头半选态可辨 + 与行内尺寸一致 + 工具条间距≥6px）+ FR-83 详情页元信息行细化（层级间距 20≤24 + 长内容换行保护 + 标签 chip 与左栏统一） | 本文件「阶段 29」 |

## 上线准备 P1（2026-09-20）：文档整理 + 产物清理

> **零代码改动**：未碰 `src/`、`web/src/`、`tests/`、`migrations/`、`package.json`、`vite.config.ts`。
> **归档 = 移动（内容不删）**；只有标"删"的才删。逐条对账见下表。

| 项 | 做了什么 | 落盘位置 | commit |
| --- | --- | --- | --- |
| A1 | `README.md` 从"阶段 9"重写为**当前状态**（阶段 1–25 / 即将 v1.0.0；测试 52 文件 285 用例；体积 456 kB 最大 chunk + 懒加载；拖拽排序已交付；验证脚本按实际清单 `ac-stage1~8/10~25`（**阶段 9 无独立脚本**）；AC-1…AC-76；界面章节按现状重写；部署补容器化预告） | `README.md` | `b80933b` |
| A2 | 完整 `PROGRESS.md` **移到**归档；根目录只留当前状态 + 28 行阶段索引（含归档锚点）+ 归档指引 | `docs/dev-history/PROGRESS.md`、`PROGRESS.md` | `f0e4203` |
| A3 | Q-1（视觉方向选定 A，已 CLOSED）**移到**归档；`QUESTIONS.md` 只留格式说明 + 空表 + 条目模板 | `docs/dev-history/QUESTIONS-history.md`、`QUESTIONS.md` | `9e53947` |
| A4 | 依赖逐条对照 `package.json`/`package-lock`（31 直接依赖 = 23 生产 + 8 开发，**0 缺失 / 0 版本不一致 / 0 多余**）；按当前版本**全量重跑 OSV**（31/31 = 0 漏洞，原样输出入档） | `docs/dependencies.md` §5 ② ③ | `d863915` |
| A5 | 阶段 10A 设计打样（a/b/c 三套）**整目录移到**归档，并加归档说明 README | `docs/dev-history/design/` | `a4a56cd`、`9b5d560` |
| A6 | systemd 部署说明逐项核对无误（unit 名 / `/opt/promptmanager` / `/etc/promptmanager/promptmanager.env` / `/var/lib/promptmanager` / 8767 / 安装·验证·回滚）；补**容器化预告**与共存告警；修回滚步骤编号与迁移示例版本 | `deploy/README.md` | `740bda9` |
| A7 | 中文检索报告**复核**：重跑 `tools/search-zh-poc.mjs`（rc=0，八节结论逐条一致；2000 条基线 0.20/0.20/0.19 ms）；确认两条分支实现未变、结论无需修订 | `docs/search-zh.md` §0 | `23589df` |
| B1 | **删** `tmp/`（203 文件 / 18 MB，过程日志与临时脚本；已被 `.gitignore` 排除） | — | 无需 commit（未跟踪） |
| B2 | **删** `var/cache/`（18 MB，npm 缓存；已被 `.gitignore` 排除） | — | 无需 commit（未跟踪） |
| B3 | **删** `docs/shots/{before,before-stage8,compare,evidence}`（33 张历史对比图，已被当前状态截图取代） | — | `d88a9f7` |
| B4 | 阶段 18–25 的分阶段截图（53 张）**移到**归档 | `docs/dev-history/shots/` | `b123c2c` |
| B5 | `docs/shots/*.png`（顶层 53 张 = **当前状态**界面证据）**保留不动** | `docs/shots/` | — |
| B6 | `dist/` 已在 `.gitignore`，未提交 | — | — |
| B（收尾） | 修掉归档/删除后的**悬空引用**：`tools/design-compare.mjs` 路径、`tools/ac-stage8.sh` 不再断言已删除的 `docs/shots/before`、`tools/ui-shots.sh` 注释示例 | `tools/*` | `9b5d560` |
| C1 | 整理后复验：`npm test` **285/285** 全绿；`bash tools/ac-stage25.sh` **AC-76 全部通过** | — | 见下方收尾 commit |

**已知遗留（本轮不改，按纪律）**：`web/src/theme.ts` 顶部注释仍指向旧路径 `docs/design/a-dark-saas/tokens.md`
（本轮"只动文档与产物、不动代码"）——已在 `docs/dev-history/design/README-ARCHIVE.md` 里加了指向说明。

## 上线准备 P2（2026-09-20）：代码质量检查 + 版本号与版本管理 + flaky 修复

> 与 P1 不同：本批**允许改代码**（`package.json` 版本、CI 配置、测试稳定性），但**业务逻辑 / 接口契约 / 数据模型 / UI 行为零改动**。
> 逐条对账见下表（每行含落盘位置与 commit）。

| 项 | 做了什么 | 落盘位置 | commit |
| --- | --- | --- | --- |
| A1 | 新增 CI：push / PR 触发，**Node 24**，`npm ci` → `bash tools/ci-check.sh`；无 secrets、不部署、不 push | `.github/workflows/ci.yml` | `6595822` |
| A2 | 新增本地同一套检查脚本：依赖就绪 → `typecheck:web` + `typecheck:tests` → `npm test` → `build` + **最大 chunk ≤500KB 体积预算**，打印逐项 rc + 关键输出汇总表；README 增「代码质量检查」章节 | `tools/ci-check.sh`、`README.md` | `6595822` |
| A3 | **本地与 CI 是同一套**：workflow 只做 `npm ci` + 调同一脚本（文档写明，杜绝两套） | `.github/workflows/ci.yml`、`README.md` | `6595822` |
| A4 | 未配置远程仓库、未 push、未加 secrets | — | — |
| B1 | `package.json` 的 `version` → **`1.0.0`** | `package.json` | `e6a10ed` |
| B2 | `/healthz` 的 version **本来就是**从 `package.json` 单一来源读取（`src/config.ts` 的 `readVersion()` → `config.version` → 路由透传），**无需改代码**；已用"改 package.json → healthz 跟着变"证明 | 证据见 §P2-C 与本节下方 | `e6a10ed`（仅文档/版本） |
| B3 | 新增 `CHANGELOG.md`（Keep a Changelog 风格，把阶段 1–25 的能力**按类型归并**为 v1.0.0，不是流水账） | `CHANGELOG.md` | `e6a10ed` |
| B4 | 新增 `docs/versioning.md`（semver 三位判据 / tag `v1.0.0` 约定 / 四步发版流程 / **`schema_version` 与项目版本解耦**）；README 文档列表补两处 | `docs/versioning.md`、`README.md` | `e6a10ed` |
| C1 | 修 flaky「CLI：改口令即吊销既有会话」（`code=null`）—— 根因与对照实验见下 | `tests/cli-user.test.ts` | `9ba8886` |
| D1 | 本地质量检查全绿 + `npm test` 连续 5 次全绿（原样输出见 §P2-D） | — | 见收尾 commit |
| D2 | 零业务改动证明（`git diff --stat`） | — | 见 §P2-D |

### P2-C：flaky 根因（含对照实验）

**现象**（host_manger 在 P1 验收时发现）：`tests/cli-user.test.ts:88`「CLI：改口令即吊销该用户既有会话」在
`npm test`（`node --test` 并发跑 52 个测试文件）时偶发失败，`runCli` 返回的退出码是 **`null`**（= 子进程被**信号**杀死）；
单跑该文件 3/3 全绿。

**定位过程**：

1. `runCli` 用的是 `spawn` + `close` 事件 ⇒ `code === null` 只可能是"**被信号杀死**"（不是超时、不是退出码异常）。
2. 排除项（逐条查过，均有证据）：
   - **不是超时**：`runCli` 没有 timeout（本次才加了 30s 安全阀用于诊断）；
   - **不是端口/临时目录竞争**：`DATA_DIR` 是每个用例独立的 `mkdtemp`，CLI 不监听端口（`PORT` 只是环境变量占位）；
   - **不是仓库内谁在杀进程**：`src/` 与 `tests/` 里没有任何 `process.kill` / `SIGKILL`（只有 AC 探针杀自己的 chromium）；
   - **不是 cgroup OOM**：`/sys/fs/cgroup/memory.events` 的 `oom_kill` 计数始终为 0，机器 28 GB 内存、可用 11 GB。
3. **对照实验（决定性）**：让父进程用 `setsid` 自建进程组，分别以"同组"和"`detached`（独立进程组）"方式 spawn 一个子进程，
   然后从外部 `kill -9 -<父进程组>`（即"杀整棵命令树"的收尾方式）：
   ```
   plain:    子进程 → **被杀**
   detached: 子进程 → **存活**（alive）
   ```
   ⇒ 结论：**子进程与测试运行器同进程组**，一旦验证/沙箱环境对该命令的进程组做整体清理
   （`kill -PGID`；本机沙箱就用 `bwrap --die-with-parent` 这类收尾），仍在运行的 CLI 子进程会被**连带杀死**，
   断言随即看到 `code=null`；单跑该文件因为时间窗口短、几乎不与收尾重叠，所以总是绿的。

**修复**（**不是加重试**）：

- `spawn(..., { detached: true, stdio: ['pipe','pipe','pipe'] })` —— 子进程自建进程组，不再被父进程组的整体清理连带杀死；
  CLI 是毫秒级短命命令，不会残留（另加 30s 安全阀，真卡住则 `SIGKILL` 并明确报 `timedOut=true`）。
- `child.stdin.on('error', () => {})` —— 子进程先退出而父进程仍在写 stdin 时会产生 **EPIPE**；
  未处理的 stream `'error'` 会变成**未捕获异常**、直接崩掉整个测试文件进程，并连带杀死该文件里其它仍在等待的 CLI 子进程
  （表现同样是 `code=null`）。这是同一 flaky 的第二条可能路径，一并堵掉。
- 断言信息带上 `signal` / `timedOut` / `stderr` —— 万一再出现，能一眼看出是"被哪个信号杀"还是"卡住"。

**无法本地复现的部分（如实记录）**：本机连续跑 `npm test` 与"边跑单文件边跑全量"的压力组合都**未复现**该 flaky
（说明它依赖验证环境的进程树收尾时机）；因此修复以**对照实验证明的机制**为依据，而不是"跑绿了就算"。

### P2-B2：`/healthz` 版本单一来源证据

```
# 改前（版本 0.1.0）—— 源码三行即可看出只有一处来源
package.json:                 "version": "0.1.0"
src/config.ts:146:            version: readVersion(projectRoot),        ← readVersion() 读 package.json
src/server/routes/health.ts:6: app.get('/healthz', async () => ({ status: 'ok', version: config.version }));

# 改后（package.json → 1.0.0）
$ curl -s http://127.0.0.1:8768/healthz
{"status":"ok","version":"1.0.0"}

# 反证（把 package.json 临时改成 9.9.9 再起一个实例，healthz 跟着变 ⇒ 没有第二份硬编码）
$ curl -s http://127.0.0.1:8769/healthz
{"status":"ok","version":"9.9.9"}
（随后已还原为 1.0.0）
```

> 注：8767 上 host_manger 的实例仍回报 `0.1.0`（那是它上次部署时的构建产物），**部署侧重新构建/重启后即为 1.0.0**。

### P2-D：收尾验证（原样输出）

**① 本地质量检查 = 与 CI 同一套**（`bash tools/ci-check.sh`，rc=0）：

```
== 代码质量检查（本地 / CI 同一套：tools/ci-check.sh）==
   工作目录：/root/greenhouse/projects/promptmanager
   Node：v24.18.0 ｜ npm：11.16.0

=== ① 依赖就绪 ===
  ✅ ① 依赖已安装（rc=0）  node_modules 存在（CI 由 workflow 先跑 npm ci）
=== ② 类型检查 ===
  ✅ ②a typecheck:web（rc=0）  0 个 TS 错误
  ✅ ②b typecheck:tests（rc=0）  0 个 TS 错误
=== ③ 全量测试 ===
  ✅ ③ npm test（rc=0）  ℹ tests 285 ℹ pass 285 ℹ fail 0
=== ④ 构建 + 体积预算 ===
  ✅ ④a npm run build（rc=0）  0 条 >500KB 告警
  ✅ ④b 体积预算（最大 chunk ≤ 500KB）（rc=0）  最大 vendor-antd-Dv-mN7eq.js = 467320 B（全部 js 合计 1298 KB）

== 汇总 ==
  ① 依赖已安装                rc=0   ✅  node_modules 存在（CI 由 workflow 先跑 npm ci）
  ②a typecheck:web                 rc=0   ✅  0 个 TS 错误
  ②b typecheck:tests               rc=0   ✅  0 个 TS 错误
  ③ npm test                       rc=0   ✅  ℹ tests 285 ℹ pass 285 ℹ fail 0
  ④a npm run build                 rc=0   ✅  0 条 >500KB 告警
  ④b 体积预算（最大 chunk ≤ 500KB） rc=0   ✅  最大 vendor-antd-Dv-mN7eq.js = 467320 B（全部 js 合计 1298 KB）

  ✅ 代码质量检查全部通过（6 项）
```

**② `npm test` 连续多次全绿**（`node --test tests/cli-user.test.ts` 亦全绿：`ℹ tests 6 / pass 6 / fail 0`）：

```
# 验收批（先 ci-check 再连跑 5 次）
--- 第 1 次 ---   ✖ tests/api-variables-markdown.test.ts (2400.305996ms)   ℹ tests 283 / pass 282 / fail 1   ← 见下"第二个 flaky"
--- 第 2 次 ---   ℹ tests 285 / pass 285 / fail 0
--- 第 3 次 ---   ℹ tests 285 / pass 285 / fail 0
--- 第 4 次 ---   ℹ tests 285 / pass 285 / fail 0
--- 第 5 次 ---   ℹ tests 285 / pass 285 / fail 0

# 复扫 8 次（为看清第 1 次那个失败是否可复现）
run1 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run2 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run3 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run4 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run5 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run6 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run7 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
run8 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
```

⇒ **修复后连续 12 次全绿**（验收批第 2–5 次 + 复扫 8 次）。**如实说明**：验收批的**第 1 次**出现过一次
**另一个 flaky**（与本批修的 CLI 那个无关，见下）。

**③ 第二个 flaky（观察到的，未复现，如实记录，未改代码）**

- **现象**：`tests/api-variables-markdown.test.ts` 整个文件被标 `✖`（2400 ms，**没有断言输出**），
  该轮 `ℹ tests 283 / pass 282 / fail 1` —— 即**文件进程异常退出**（少了 2 个用例的汇报），不是断言失败。
- **已排除**：① 不是断言失败（无断言信息，是文件级失败）；② 不是 cgroup OOM（`/sys/fs/cgroup/memory.events` 的 `oom_kill` 始终 0）；
  ③ 不是仓库内谁杀进程（`src/`、`tests/` 无 `process.kill`）；④ 与本批的 CLI 修复无关（不同文件、不同机制；CLI 那处已用对照实验证明）。
- **最可能的类别**：`node --test` 默认按 `availableParallelism()-1 = 7` 并发跑测试文件，其中多个文件在模块加载时初始化
  `jsdom`（进程级单例，~65 MB heap）；该次失败时宿主 `free -m` 显示可用内存一度降到 ~2.9 GB ⇒ **文件进程被宿主内存压力/内核杀掉**这类原因最符合"无诊断、文件级死亡"的形态。
  宿主 OOM 记录在本沙箱内不可读（`dmesg` / `/var/log/messages` 均不可访问），**故无法确证**。
- **为什么不改**：`node --test` 的并发度只能通过 `package.json` 的 `test` 脚本参数调（AC-77 ④ 限定该文件只允许 `version` 变动），
  且本次 12 次复跑未再出现 ⇒ 记为**待观察**；若在 CI/验收中再现，第一手证据（完整 `node --test` 输出）会直接落在日志里，
  再据此决定是加 `--test-concurrency` 上限还是给 jsdom 文件做隔离。

### P2-D2：零业务改动证明（`git diff`）

```
$ git diff --stat de180ee HEAD          # de180ee = P1 收尾；含 host_manger 并行提交的容器化文件
 .dockerignore            |  15 ++++++        ← host_manger 并行
 .github/workflows/ci.yml |  34 ++++++++++++  ← 本批 A1
 CHANGELOG.md             |  62 ++++++++++++  ← 本批 B3
 Dockerfile               |  57 ++++++++++++  ← host_manger 并行
 README.md                |  44 ++++++++++++- ← 本批 A2/B4
 VERIFY.md                |  60 ++++++++++++  ← host_manger 并行
 deploy/README.md         |   2 +-           ← 本批（healthz 示例版本）
 deploy/container.md      | 127 ++++++++++++  ← host_manger 并行（本批仅改 1 行版本示例）
 docker-compose.yml       |  47 ++++++++++++  ← host_manger 并行
 docs/versioning.md       |  77 ++++++++++++  ← 本批 B4
 package.json             |   2 +-           ← 本批 B1（**只有 version 一行**）
 tests/cli-user.test.ts   |  53 +++++++---    ← 本批 C1（flaky 修复）
 tools/ci-check.sh        | 101 ++++++++++++  ← 本批 A2

$ 分目录核对（本批）
src            +0/-0 行     ← 业务代码零改动（healthz 的版本来源本来就是 package.json，无需改）
web/src        +0/-0 行     ← 前端零改动
migrations     +0/-0 行     ← 数据模型零改动
tests          +46/-7 行    ← 仅 tests/cli-user.test.ts 一个文件（C1 的 flaky 修复；本批明确允许"测试稳定性修复"）
package.json   +1/-1 行     ← 仅 version 字段（0.1.0 → 1.0.0）
```

⇒ **业务逻辑 / 接口契约 / 数据模型 / UI 行为零改动** ✓

## 上线准备 P2 返工（2026-09-20）：把 flaky 彻底修好

> 依据：`VERIFY.md`「上线准备 P2 验收」§4 返工清单（结论 **不过** —— A/B 过、C 未彻底修好）。
> 本节的每一条都对应清单里的一项；**仍未改 `package.json`**（并发档未动，理由见 §返工-2 末尾）。

### 返工-1：让失败可诊断（清单第 1 项）

- **改动**：`tools/ci-check.sh` 失败时不再只 `grep '^✖'`，而是打印完整诊断行
  （`ℹ Error:` / `Error:` / `unhandledRejection` / `uncaughtException` / `test failed` / `ERR_` / `code:`）+ 日志末尾 15 行；
  `tests/helpers.ts` 的 `assertCliOk()` 在断言失败时输出 `rc / signal / timedOut / stderr / stdout`。
- **一次真实失败的完整输出**（复现条件：`TMPDIR=<磁盘目录> node --test`，见返工-2；日志 `var/log/d-2.log`）：

```
✖ failing tests:

test at tests/cli-export.test.ts:53:1
✖ CLI export：与 POST /api/import 兼容（把 CLI 文件导回库） (451.309867ms)
  AssertionError [ERR_ASSERTION]: CLI 退出码：rc=null signal=SIGSEGV timedOut=false
  --- stderr ---

  --- stdout ---


  null !== 0

      at assertCliOk (file:///root/greenhouse/projects/promptmanager/tests/helpers.ts:121:10)
      at TestContext.<anonymous> (file:///root/greenhouse/projects/promptmanager/tests/cli-export.test.ts:70:5)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1332:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7) {
    actual: null, expected: 0, operator: 'strictEqual',
  }
```

⇒ **诊断改造立刻见效**：拿到的是 `signal=SIGSEGV`（子进程被信号杀死），而不是含糊的 `code=null`。

### 返工-2：第二类 flaky 的根因（清单第 2 项）

**① 先证明"`✖ <文件>` + `'test failed'`（无断言详情、子测试全 ✔）"到底是什么**（三个对照实验，各写一个 3 行测试文件）：

```
# 变体 A：测试全过后 process.exitCode = 1
✖ var/probe/a.test.ts (222ms)  'test failed'
# 变体 B：测试全过后有一个未处理的 rejection
ℹ Error: A resource generated asynchronous activity after the test ended. This activity created the error
         "Error: late unhandled rejection" which triggered an unhandledRejection event, caught by the test runner.
✖ var/probe/b.test.ts (281ms)  'test failed'
# 变体 C：测试全过后进程被信号杀死（process.kill(process.pid,'SIGSEGV')）
✖ var/probe/segv.test.ts (147ms)  'test failed'      ← **只有这一行，没有任何其它诊断**
```

⇒ **host_manger 看到的形态（文件级 `'test failed'` + 无详情 + 子测试全 ✔）与变体 C 完全一致**：
**该测试文件进程是被信号杀死的**（不是断言错、不是未处理 rejection；后两者都会多打印一行诊断）。

**② 复现到了真实失败，并拿到信号**：把 `TMPDIR` 指到**磁盘目录**（`$PWD/var/tmp`，更接近宿主真实 `/tmp`；
本沙箱默认 `/tmp` 是 tmpfs）后，10 次全量里第 2 次失败：

```
disk-tmp run2 rc=1 ℹ tests 285 ℹ pass 284 ℹ fail 1     → 见返工-1 的完整输出：signal=SIGSEGV（CLI export 子进程）
```

**③ 已排除项（逐条有证据）**：

| 假设 | 结论 | 证据 |
| --- | --- | --- |
| 业务断言错 | ✗ 排除 | 失败是**文件级**、无断言详情；该文件子测试全 ✔（变体 C 对照） |
| 未处理 rejection / 异步活动 | ✗ 不是本次形态 | 若是，会多打印 `ℹ Error: A resource generated asynchronous activity…`（变体 B）；实测日志里没有 |
| cgroup OOM | ✗ 排除 | `/sys/fs/cgroup/memory.events` 的 `oom_kill` 全程为 0；宿主 28 GB、可用 ~10 GB |
| 仓库内有人杀进程 | ✗ 排除 | `src/`、`tests/` 无 `process.kill`；AC 探针只杀自己的 chromium |
| CLI 本身会崩 | ✗ 排除 | **裸 CLI 并发压力**：8 路并发 × 12 轮 = **96 次 `migrate`+`export` 全部 rc=0**（不经测试运行器） |
| 端口/临时目录竞争 | ✗ 排除 | `DATA_DIR` 每用例独立 `mkdtemp`；CLI 不监听端口 |
| 子进程与运行器同进程组被"整体清理"连带杀死 | ✅ **已证实的机制之一** | 对照实验（P2 原分析）：同组子进程被 `kill -PGID` 杀死、`detached` 存活 |
| 并发（资源竞争 / fd / 调度）是**触发条件** | ✅ **实测相关** | 单文件 ×20 全绿；全量 7 路并发下才出现（复现率 ≈10%，宿主 ≈25%） |
| fd / 进程数上限 | ✗ 排除 | `ulimit -n` = 524288、`ulimit -u` = 115597（远高于本套件用量：7 路 × 若干 fd） |

**④ 根因结论（诚实版）**：**flaky = 并发下某个进程被信号杀死**，而 `node:test` 对这种情形的报错形态就是
`✖ <文件> 'test failed'`（无详情）。本次抓到的那次是 **CLI 子进程 SIGSEGV**（在 7 路并发 + 磁盘 TMPDIR 下）；
api-tokens / api-export 的文件级失败与它**同类**（信号杀死），但**我无法在本地复现到那两次**（改造后 ~30 次全量全绿）。
**修复走两条**：① 把 CLI 子进程的隔离做全（返工-3，消除"连带被杀"这条确定路径 + 加诊断）；
② **不动** `package.json` 的并发档 —— 因为改造后**默认并发下连续 10 次全量全绿**（返工-4），
降并发属于"没有证据支持就改配置"，且会拖慢 CI（实测 c=7≈18 s / c=4≈24 s 仅测试阶段）。

### 返工-3：把"子进程独立进程组"做全（清单第 3 项）

- 新增 **公共 helper**：`tests/helpers.ts` 的 `runCliProcess()` + `assertCliOk()`
  （`detached: true` 独立进程组、`child.stdin.on('error')` 吞 EPIPE、30 s 安全阀、返回 `code/signal/stdout/stderr/timedOut`）。
- **四个** spawn 子进程的测试文件**全部**改用它（不再只有 `cli-user` 一处）：
  `cli-user` / `cli-export` / `cli-get-render` / `cli-token` —— 各自保留原有本地签名（调用点零改动），实现全部委托给公共 helper。
- 断言统一走 `assertCliOk()`（失败信息带 `signal/timedOut/stderr/stdout`）。

### 返工-4：判据 —— 连续 10 次 `npm test` 全绿（清单第 4 项）

条件刻意取**更苛刻**的一档：`TMPDIR=<磁盘目录>`（即返工-2 里能复现失败的设置），并发保持 `npm test` 默认：

```
### 验收：连续 10 次 npm test（TMPDIR=var/tmp 磁盘目录；并发=默认）
acc1  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc2  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc3  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc4  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc5  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc6  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc7  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc8  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc9  rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
acc10 rc=0 ℹ tests 285 ℹ pass 285 ℹ fail 0
ACCEPTANCE_DONE
```

补充样本（同一改造之后）：单文件 ×20 全绿；`--test-concurrency=7` ×6 全绿；`--test-concurrency=4` ×4 全绿；
`bash tools/ci-check.sh`（含一次 `npm test`）rc=0、6/6 项通过（提交后的干净树）。

### 返工-5：用例数稳定 285（清单第 5 项）

10 次验收**每次都是 `ℹ tests 285 / pass 285 / fail 0`**（失败时会掉到 282 —— 文件级失败导致该文件用例没跑完；
本次 10 次里一次都没出现）。

### 返工-6：改动面（本批）

```
tests/helpers.ts             +79 行   ← 新增 runCliProcess / assertCliOk（公共 CLI 子进程 helper）
tests/cli-user.test.ts       -54/+?   ← 本地 runCli 改为委托公共 helper
tests/cli-export.test.ts     -40/+?   ← 同上
tests/cli-get-render.test.ts -53/+?   ← 同上
tests/cli-token.test.ts      -49/+?   ← 同上
tools/ci-check.sh            +9/-2    ← 失败时打印完整诊断
（src/ / web/src/ / migrations/ / package.json 均未改动）
```

## 阶段 27（2026-09-21）：用户 5 条新需求（FR-77 ~ FR-81）

### 开工前：AC-78~AC-82 → 检查命令（先落盘，再动手）

> 基线：`npm test` 已跑，**285/285 全绿**（rc=0，`ℹ tests 285 / pass 285 / fail 0`）——绿色基线确认后才开工。
> 说明：本阶段新增 1 个接口（`POST /api/prompts/bulk`）+ 前端 4 处改动；**无 schema 变更**（`migrations/*.sql` 仍 3 个）。

| AC | 要执行的检查命令 | 判据 |
| --- | --- | --- |
| AC-78 | `node --test tests/api-prompts-bulk.test.ts tests/stage27-ui.test.ts`（接口语义 + 源码级）<br>`bash tools/ac-stage27.sh`（自起自停 + **真鼠标** + 网络请求计数 + 负例）<br>└ 内部调 `node tools/ac-stage27-probe.mjs bulk <base> <sid> <shots>` | ① 首列复选框 + 表头全选存在；② 勾 3 条 → 工具条含「已选择 3 项」与「批量收藏/批量移动/批量删除/取消」；③ 取消 → 选中清空、工具条消失；④ 批量收藏 2 条 → 两条 `favorite=true` + 反馈 + **恰好 1 个** `POST /api/prompts/bulk`；⑤ 批量移动 → `folder_id` 变目标值 + 侧栏计数同步；⑥ 批量删除 → 二次确认文本含条数与「不可恢复」→ 先取消不删 → 再确认删 2、total −2；⑦ 表头全选 → 当页全选中；⑧ 行内操作/行拖拽/分页/排序/筛选回归；⑨ 批量接口传不存在 id / 空 ids → **400** |
| AC-79 | `node tools/ac-stage27-probe.mjs detail-meta <base> <sid> <shots>`<br>`node --test tests/stage27-ui.test.ts` | ① 右栏元信息行夹在 `pm-detail-notes` 之下、`pm-detail-fields` 之上，含当前文件夹名与全部标签；② 改文件夹 → 落库 `folder_id` 变化（前后对照）+ 左栏计数同步 + 成功反馈；再选「未归类」→ `folder_id=null`；③ 加标签 → `tags` 增；④ 点 `✕` 删标签 → `tags` 减；⑤ 卡片/表格/编辑器显示一致；⑥ 元信息行字号 < 标题、颜色为次级色、窄屏 `scrollWidth ≤ clientWidth+2`；⑦ 截图（有文件夹+多标签 / 未归类+无标签，亮暗各一张） |
| AC-80 | `node tools/ac-stage27-probe.mjs detail-tabs <base> <sid> <shots>`<br>`node --test tests/stage27-ui.test.ts` | ① `pm-detail-fields` 内 `.ant-segmented-item` 恰好 **2** 个、文本 = 用户提示词 / 系统提示词；② 文本为「备注」的页签计数 **0**；③ 两页签切换后 Markdown 预览仍生效；④ 编辑器「备注」输入框仍在 |
| AC-81 | `node tools/ac-stage27-probe.mjs detail-vars <base> <sid> <shots>`<br>`node --test tests/stage27-ui.test.ts` | ① 分栏详情右栏**不存在**「变量填值」区块（DOM 计数 0）；② 「预览」「版本历史」仍在；③ 编辑器 `pm-panel-variables` 变量面板仍可用；④ 复制含变量 prompt 仍弹 `pm-vars-dialog` |
| AC-82 | 改前/改后各跑一次 `node tools/ac-stage27-probe.mjs vars-size <base> <sid> <shots>`（**先量基线再改**） | ① 确认弹窗 = 复制含变量 prompt 时的 `VarsDialog`（贴触发步骤）；② `getBoundingClientRect()` 宽、高各 **+≥15%**；③ 弹窗内 `scrollWidth ≤ clientWidth+2`、变量输入区可见；④ 分栏/表格/卡片三档触发尺寸一致（同一组件）；⑤ 改前/改后截图各一张 |
| 回归 | `npm test`（≥285，只增不减）；`bash tools/ci-check.sh`；`bash tools/ac-stage20.sh`（AC-66/67 所在阶段脚本，**已随 FR-79 修订页签断言**）；`bash tools/ac-stage21.sh`（AC-68/69，**已随 FR-79 修订**）；`bash tools/ac-stage22.sh` / `ac-stage23.sh` / `ac-stage24.sh`（AC-70~75 拖拽与分栏） | 全绿；用例数变化须说明理由 |

**FR-81 前置确认（本次第一件事，已完成）**：读 `web/src/use-copy.ts` 的 `copyPrompt()` —— `hasVariables(prompt.user_prompt, prompt.system_prompt)` 为真时 `setVarsPrompt(prompt)`，
由 `Workspace.tsx` 渲染 `<LazyVarsDialog>`（`data-testid="pm-vars-dialog"`）；复制**不含变量**的条目只走 `message.success('已复制提示词')`、**无弹窗**。
⇒ **"复制之后的弹窗" = `VarsDialog`**，无需写 QUESTIONS。

### 阶段 27 实施与自检：逐条命令 + 原样输出

> 改动面（`git diff --stat` 收尾核对）：后端 **+2 文件**（`src/services/prompts.ts` 新增 `bulkPrompts`、`src/server/routes/prompts.ts` 新增 `POST /api/prompts/bulk`）；
> 前端 **6 文件**（`api.ts` / `UseView.tsx` / `SplitView.tsx` / `PromptDetail.tsx` / `Workspace.tsx` / `VarsDialog.tsx`）；
> 新增测试 **2 个**（`tests/api-prompts-bulk.test.ts`、`tests/stage27-ui.test.ts`）；新增 AC 脚本 **2 个**（`tools/ac-stage27.sh`、`tools/ac-stage27-probe.mjs`）。
> **无 schema 变更**（`migrations/*.sql` 仍 3 个）、**无新依赖**（`git diff --stat package.json package-lock.json` → 空）。

#### ① 全量测试（用例数 285 → **300**，只增不减）

```
$ npm test
ℹ tests 300
ℹ pass 300
ℹ fail 0
```

新增 15 个用例：`tests/api-prompts-bulk.test.ts` **6** 个（批量接口语义 + 负例 + 401 + 未选中条目不动）、
`tests/stage27-ui.test.ts` **9** 个（FR-77~FR-81 前端源码级断言）。
**用例数变化的理由**：本阶段新增 1 个接口（FR-77 ⑥ 方案①）与 5 处前端行为，全部是新行为，无既有用例被删除。

#### ② AC-78 表格批量操作（`bash tools/ac-stage27.sh`，真鼠标 + 请求计数）

```
=== AC-78：表格批量操作（真鼠标 + 请求计数） ===
ac78_has_selection_column=true          ← ① 首列复选框（每行都有）
ac78_header_checkbox=true               ← ① 表头全选复选框
ac78_toolbar_before=false               ← ② 未选中时工具条不占位
ac78_checked_3=[1,2,3]
ac78_toolbar={"text":"已选择 3 项 | 批量收藏 | 批量移动 | 批量删除 | 取消","count":"已选择 3 项","favorite":true,"move":true,"del":true,"cancel":true}
ac78_after_cancel={"checked":"[]","toolbar":false}   ← ③ 取消 → 选中清空 + 工具条消失
ac78_favorite_requests=1                ← ④ **只发 1 个 POST /api/prompts/bulk**
ac78_favorite_messages=["已收藏 2 条"]   ← ④ 反馈文本
ac78_after_favorite_checked=[]          ← ④ 批量操作后选中态清空
ac78_move_requests=1                    ← ⑤ 批量移动只发 1 个请求
ac78_sidebar_counts_before=["AC27 甲目录 3","AC27 目标目录 0"]
ac78_sidebar_counts=["AC27 甲目录 3","AC27 目标目录 2"]   ← ⑤ 侧栏计数同步（目标目录 0→2）
ac78_delete_confirm_text=批量删除 prompt？ | 将删除 2 条 prompt，不可恢复。 | 取 消 | 删 除   ← ⑥ 二次确认
ac78_total_before=8 / ac78_total_after_cancel=8 / ac78_total_after_confirm=6   ← ⑥ 先取消不删、再确认删 2
ac78_deleted_404=404
ac78_select_all={"rows":[1,2,3,4,7,8],"checked":[1,2,3,4,7,8],"all":true}   ← ⑦ 表头全选
ac78_select_all_text=已选择 6 项
ac78_regression={"edit":6,"del":6,"copy":6,"dragRow":6,"pagination":true,"sort":true,"search":true}   ← ⑧ 行内操作/行拖拽/分页/排序/搜索仍在
  ✅ ①…⑧ 全过；页面运行时异常（bulk） = []

=== AC-78 ⑨：批量接口负例（原样输出） ===
  不存在 id：HTTP 400 {"error":"invalid_body","details":[{"path":"ids","message":"以下 prompt id 不存在：999999"}]}
  空 ids：HTTP 400 {"error":"invalid_body","details":[{"path":"/ids","message":"must NOT have fewer than 1 items"}]}
  目标文件夹不存在：HTTP 400 {"error":"invalid_body","details":[{"path":"folder_id","message":"文件夹 999999 不存在"}]}
```

**落库方式（FR-77 ⑥ 二选一，选 ①）与理由**：新增 `POST /api/prompts/bulk`（body `{"action":"favorite|move|delete","ids":[...],"folder_id":null|N}`，
返回 `{"action":…,"affected":N}`），**整批一个事务**，判据「一次批量操作只发 1 个请求」实测 = **1**（见 `ac78_favorite_requests` / `ac78_move_requests`）。
语义选择：`favorite`/`move` **复用单条 `PUT` 的既有语义**（写目标列 + `version_no` 递增 + 留一条版本快照 + 更新 `updated_at`），
理由是让「同一条 prompt 无论走单条还是批量，字段与版本号变化完全相同」（与表格行内星标 `toggleFavorite` 走 PUT 的行为一致）；
**未选中的条目一个字段都不动**（`tests/api-prompts-bulk.test.ts` 末条用例断言 `updated_at`/`version_no` 不变）。
`favorite` 语义 = **全部设为已收藏**（已是收藏的保持，不做"切换"—— BRIEF FR-77 ③ 的指定语义）。

#### ③ AC-79 分栏详情页「文件夹 + 标签」（真鼠标 + 落库读数 + 侧栏计数）

```
ac79_meta={"text":"AC27 甲目录 | #AC27甲 | + 添加标签","tags":["#AC27甲"],"folderSelect":true,"addTag":true,"afterNotes":true,"beforeFields":true,"metaTop":201,"notesBottom":185,"fieldsTop":243}
ac79_style={"metaFontSize":"12.5px","titleFontSize":"18px","metaColor":"rgb(60, 64, 70)","titleColor":"rgb(20, 22, 26)","scrollWidth":1600,"clientWidth":1600}
ac79_sidebar_counts_before=["AC27 甲目录 3","AC27 目标目录 2"] → ac79_sidebar_counts=["AC27 甲目录 2","AC27 目标目录 3"]
ac79_folder_after_move=…"folder_id":2…   ← ② 落库成功
ac79_move_messages=["已更新文件夹"]        ← ② 成功反馈
ac79_folder_after_unfiled={"folder_id":null}   ← ② 再选「未归类」
ac79_tags_after_add={"tags":["AC27乙","AC27甲"]}   ← ③ 加标签
ac79_tags_after_remove={"tags":["AC27甲"]}         ← ④ 点 ✕ 删标签
ac79_table_row=…AC27甲 未归类… / ac79_card_text=…AC27甲… / ac79_editor_tags=["AC27甲（1）"] / ac79_editor_notes=AC27 备注文本…   ← ⑤ 三处同源一致
ac79_narrow_scroll={"scrollWidth":1100,"clientWidth":1100,"metaPresent":true}   ← ⑥ 窄屏无横向溢出
  ✅ ①…⑥ 全过；页面运行时异常（detail-meta） = []
```

**位置与排版**：元信息行 `data-testid="pm-detail-meta"` 夹在 `pm-detail-notes`（185）与 `pm-detail-fields`（243）之间（`metaTop=201`）；
字号 12.5px < 标题 18px、颜色 `rgb(60,64,70)` ≠ 标题 `rgb(20,22,26)`（次级色，不抢重心）。
文件夹用 antd `TreeSelect`（选项 = 「未归类」+ 全部文件夹树，复用 `buildFolderTree`）；标签用 antd `Tag`（`#` 前缀 + `✕`）+ 一个 `Select mode="tags"` 添加入口。
**同源落库**：走既有 `PUT /api/prompts/:id`（与编辑器同一接口、同一批字段），改完 `refresh()` 让侧栏计数同步。

#### ④ AC-80 / AC-81 详情页页签与变量区块

```
ac80_tabs=["用户提示词","系统提示词"]   ← ① 恰好 2 个
ac80_notes_tab_count=0                  ← ② 无「备注」页签
ac80_user_render=没有变量的正文 / ac80_system_render=系统提示词内容   ← ③ 切换后 Markdown 渲染仍生效
ac80_editor_notes={"present":true,"textarea":true}   ← ④ 编辑器备注输入框仍在
ac81_detail={"hasVariableBlock":false,"variablePanel":false,"markdownPreview":true,"previewToggle":true,"versionHistory":true,…}
ac81_editor_panel={"panel":true,"text":"变量填值 | 这条有 3 个变量…"}
ac81_vars_dialog={"present":true,"title":"请填写变量值（自动记忆）","preview":true}
  ✅ AC-80 ①…④ / AC-81 ①…④ 全过；两档页面运行时异常均为 []
```

#### ⑤ AC-82 VarsDialog 宽高（真实像素；改前基线先量）

```
# 改前（HEAD 的构建，同一脚本 vars 模式）
ac82_split={"w":640,"h":398,"scrollWidth":592,"clientWidth":592,"inputs":3,"inputsVisible":true}
# 改后
ac82_split={"w":760,"h":477,"scrollWidth":712,"clientWidth":712,"inputs":3,"inputsVisible":true}
ac82_table={"w":760,"h":477,…} / ac82_card={"w":760,"h":477,…}   ← ④ 三档一致（同一组件）
ac82_dialog={"dialogPresent":true,"title":"请填写变量值（自动记忆）","trigger":"复制含变量 prompt（pm-detail-copy）"}
  ✅ ② 宽度增幅 = 1.1875（≥1.15）｜高度增幅 = 1.1985（≥1.15）｜③ 无横向溢出 + 输入区可见｜④ 三档一致
```

**改法**：`web/src/components/VarsDialog.tsx` 的 `Modal width` 640 → **760**（+18.75%）、body 加 `minHeight: 360`、预览区 `maxHeight` 220 → 280。
**所有触发位置共用同一个组件**（分栏 / 表格 / 卡片 / 编辑器），改一处即全生效 —— 三档实测尺寸完全一致。

#### ⑥ 截图识图（`docs/shots/stage27/`，五问逐张过）

| 图 | 重叠/遮挡 | 硬断词 | 孤标题 | 溢出裁切 | 符合既定美学 |
| --- | --- | --- | --- | --- | --- |
| `02-table-selected-3-light`（勾 3 条 + 工具条） | 无 | 无 | 无 | 无 | ✅ 与既有表格/描边按钮体系一致 |
| `05-table-bulk-delete-confirm-light`（批量删除二次确认） | 无（弹窗居中遮罩） | 无 | 无 | 无 | ✅ 危险色按钮 + 条数/不可恢复文案清晰 |
| `01-table-no-selection-light`（未选中，无工具条） | 无 | 无 | 无 | 无 | ✅ 未选中不占位 |
| `07-table-select-all-light`（表头全选） | 无 | 无 | 无 | 无 | ✅ 表头复选框半选/全选态清晰 |
| `01-detail-meta-light`（详情：标题→备注→元信息行→页签→正文） | 无 | 无 | 无 | 无 | ✅ 元信息行小字号次级色，层级与参考图一致 |
| `02-detail-meta-folder-changed-light` / `03-detail-meta-tag-added-light` / `04-detail-meta-tag-removed-light` | 无 | 无 | 无 | 无 | ✅ 改文件夹/增删标签即时生效 |
| `06-detail-meta-narrow-light`（1100px） | 无 | 无 | 无 | 无（`scrollWidth == clientWidth`） | ✅ 自然折行 |
| `01-detail-tabs-two-light`（两个页签） | 无 | 无 | 无 | 无 | ✅ 去掉「备注」页签后不空 |
| `01-detail-no-variable-block-light`（无变量区块） | 无 | 无 | 无 | 无 | ✅ 预览 + 版本历史仍在，留白合理 |
| `01-vars-dialog-split-light` / `02-vars-dialog-card-light`（改后弹窗） | 无 | 无 | 无 | 无 | ✅ 变量两列铺开、预览区更舒展、减少内部滚动 |
| `02-editor-notes-still-there-light` / `02-editor-variable-panel-light` / `03-copy-still-opens-vars-dialog-light` | 无 | 无 | 无 | 无 | ✅ 编辑器能力未丢 |

**降级清单**：**无**（FR-77~FR-81 无降级项；未做「跨文件夹拖拽」等超出本阶段范围的能力，见 BRIEF 非目标）。

#### ⑦ 被本阶段取代的既有断言（旧 → 新，逐条留痕）

| 位置 | 旧断言（原文） | 新断言 + 理由 |
| --- | --- | --- |
| `tests/stage21-notes-plain.test.ts` AC-68 ② | `/field === 'notes'/` 存在 + `sourceMode \|\| plain \|\| field === 'notes' ? (` 三段式 | 改为「**不存在** notes 字段分支 + 不存在『备注』页签 + `pm-detail-notes` 仍按纯文本（无 HTML/Markdown 元素）」；理由：**FR-79 明确删除详情页「备注」页签**，AC-68 ② 的页签部分被取代，备注的纯文本要求由 FR-69 的标题下行承担 |
| `tests/stage20-detail-header.test.ts` AC-66 ② | 控件 token 列表含 `'备注'` | 换成 `'pm-detail-notes'`；理由同上（页签已移除，备注行仍在） |
| `tools/ac-stage20-probe.mjs` / `ac-stage20.sh` | 页签含「备注」 | 改为「页签 = 用户/系统提示词 且 `notesTab == 0`」 |
| `tools/ac-stage21-probe.mjs` / `ac-stage21.sh` | 点「备注」页签 → 断言纯文本 + 0 个 markdown 请求；`grep -c "sourceMode \|\| plain \|\| field === 'notes'"` = 1 | 改为「备注页签计数 = 0 + 备注行纯文本 + 查看备注**不额外**发 markdown 请求」；AC-68 ④ 改为先切「系统提示词」再切回，确保确有新请求 |
| `tools/ac-stage23.sh` AC-74 ① | 列宽 `[301,183,123,83,94,106,155,275]`（8 列）+ 表头 8 项 | 改为 `[60,287,175,118,79,90,101,148,262]`（**9 列**，首列 60px = FR-77 的复选框列）+ 表头首项为空字符串；理由：**FR-77 ① 要求表格首列新增复选框**，必然多一列；行高 43 / 表头高 38 / 手柄不新增列等其余断言不变 |
| `tests/stage18-bundle.test.ts` AC-61 ⑤ | 预算 = 基线 + 阶段 18/22 已对账增量 | 追加 `STAGE27_ACCOUNTED_DELTA = 963`（改前 417,515 B → 改后 418,478 B，同 `node_modules` 实测） |

#### ⑧ 回归（收尾三件套 + 重点 AC）

```
$ npm test                                   → ℹ tests 300 / pass 300 / fail 0
$ bash tools/ci-check.sh                     → ✅ 代码质量检查全部通过（6 项）
  ③ npm test（rc=0）  ℹ tests 300 ℹ pass 300 ℹ fail 0
  ④b 体积预算（rc=0） 最大 vendor-antd-D0a34XA3.js = 470985 B（全部 js 合计 1302 KB）
$ bash tools/ac-stage27.sh                   → ✅ AC-78 / AC-79 / AC-80 / AC-81 / AC-82 全部通过
$ bash tools/ac-stage20.sh                   → ✅ AC-66 / AC-67 全部通过
$ bash tools/ac-stage21.sh                   → ✅ AC-68 / AC-69 全部通过
$ bash tools/ac-stage22.sh                   → ✅ AC-70 / AC-71 全部通过
$ bash tools/ac-stage23.sh                   → ✅ AC-72 / AC-73 / AC-74 全部通过
$ bash tools/ac-stage24.sh                   → ✅ AC-75 全部通过
$ grep -rn "navigator.clipboard" web/src | wc -l   → 1（FR-65 不变）
$ ls migrations/*.sql | wc -l                      → 3（无 schema 变更）
$ git diff --stat package.json package-lock.json   → 空（无新依赖）
```

**AC-1…AC-77 未回归**：拖拽与分栏（AC-70/71/72/73/74/75）、备注（AC-68/69）、详情页头部与修改密码（AC-66/67）全部由上述阶段脚本复跑通过；
唯一两处被**本阶段规格主动取代**的旧断言（AC-74 ① 的 8 列基线、AC-68 ② 的备注页签）已在上表逐条留痕。

#### ⑨ commit（逐单元；收尾 commit hash 单独标注）

| 单元 | 内容 | commit |
| --- | --- | --- |
| ① | 后端批量接口 `POST /api/prompts/bulk` + 单测 | **`919ca8e`** `feat(prompts): 新增批量接口 POST /api/prompts/bulk（FR-77 ⑥ 方案①，整批一个事务）` |
| ② | 前端 FR-77 表格批量 + FR-78/79/80 详情页改造 + 被取代断言的修订 + 体积预算记账 | **`1402f9e`** `feat(web): 表格批量操作（FR-77）+ 详情页元信息行与去备注页签/变量区块（FR-78/79/80）` |
| ③ | FR-81 VarsDialog 尺寸 + `tools/ac-stage27.*` + `tests/stage27-ui.test.ts` + PROGRESS/README | **`2d65311`** `feat(web): 加大变量填值对话框宽高（FR-81）+ 阶段 27 AC 自检与文档` |
| 收尾 | 本表（commit hash 回填）—— **docs-only，无代码改动** | `2e326e5`（回填三个单元 hash）；**最后一个 docs-only 收尾提交的 hash 见交付回复**（提交无法自引用自身 hash） |


## 阶段 28（2026-09-21）：项目级 `AGENTS.md`（AI 代理操作指南）—— AC-83

### ① 本阶段做了什么

- **新建项目根目录 `AGENTS.md`**：**项目级 AI 代理操作指南**，受众是「在这个仓库里干活的 AI 代理 / 一个新开的会话」
  （**不是**产品介绍、**不是**需求规格、**不是**通用开发规范 —— 那三样分别是 `README.md` / `BRIEF.md` / `STANDARDS.md`）。
  共 12 节：项目是什么 / 最短上手路径（5 分钟）/ 常用命令 / 结构地图 / 代码约定 / 数据与迁移 / 测试 /
  验证与自证（真鼠标事件、内网 IP、截图识图）/ 红线 / **本项目特有的坑 10 条** / 文档地图 / 与 AI 代理的协作约定。
- **语言返工（用户 2026-09-21 定的规范）**：`/root/greenhouse/STANDARDS.md` **§5.1 文档语言规范**要求
  **AI 代理指令文件（`AGENTS.md` / `CLAUDE.md` / `.cursorrules` 等）一律用英文**（受众是 AI，英文更利于识别与精确更新；
  其余文档保持中文）⇒ 全文改为英文：**中文版 `5911cf4`（232 行）→ 英文版 `67e5f41`（289 行）**（BRIEF v36 / AC-83 ⑧）。
- **只改语言、不改内容**：结构 §1–§12、10 条坑、`file:line` 证据、命令与实测输出全部保留 —— 用**脚本比对**证明（见 ④），不靠目测。
  英文比中文长属正常（232 → 289 行）。
- **未改任何业务代码**：`src/`、`web/src/`、`tests/`、`migrations/`、`package.json` 全程零改动。

### ② 并行避让留痕（本阶段横跨阶段 27 的并行开发期）

- **开工即红，但不是 HEAD 的问题**：第一次 `npm test` 报
  `src/server/routes/prompts.ts(164,12): error TS2304: Cannot find name 'bulkPrompts'.`（rc=2）。
  查证结论 = **另一会话（阶段 27）正在同一工作区改代码**：`src/services/prompts.ts` mtime `00:50:38`、
  `src/server/routes/prompts.ts` mtime `00:51:17`（都落在本会话进行中，后者正好补上缺的 import）；
  `/root/.dsh/sessions/--root-greenhouse-projects-promptmanager--/session-8f891155-…` 的 transcript 仍在增长，
  其首条用户消息是**阶段 27 / BRIEF v34 / FR-77~FR-81**（`ps` 在 `bwrap --unshare-pid` 里看不到别的进程，故用会话记录判定）。
  ⇒ **HEAD 本身是绿的**：`git archive HEAD` 隔离副本 `ℹ tests 285 / pass 285 / fail 0`。
- **按 host_manger 要求避让**：本阶段**只新增 `AGENTS.md`、暂不写 `PROGRESS.md`**；`git add` **只用明确路径**
  （`git add AGENTS.md`），**绝不用 `git add -A` / `git add .`**（否则会把阶段 27 的未提交改动卷进本阶段提交）。
  提交后核对：`git show --stat 5911cf4` = `1 file changed, 232 insertions(+)`；`git show --stat 67e5f41` = `1 file changed`；
  `git ls-tree -r 5911cf4 | grep -E 'api-prompts-bulk|stage27'` → **无命中**（未夹带）。
- **自己的交付在隔离副本里验证**（既不与并行会话抢 `dist/` 与内存，也不被它的半成品污染基线）：
  `git archive HEAD | tar -x -C /tmp/pmv*` + `ln -s <repo>/node_modules`，所有命令在该副本内跑。
- **阶段 27 收尾并验收通过（`7296c60`）后**，host_manger 通知补写本节；补写时工作区已干净（`git status --porcelain` 为空），
  实时工作区 `npm test` = **300/300 全绿**（见 ⑤）。

### ③ AC-83 ①–⑧ 原样输出

#### ① 文件在项目根目录且已入库

```
$ git ls-files AGENTS.md
AGENTS.md
$ wc -l AGENTS.md
289 AGENTS.md
$ git log --oneline --follow -- AGENTS.md
67e5f41 docs(agents): AGENTS.md 全文改为英文（阶段 28 / AC-83 ⑧）
5911cf4 docs(agents): 新增项目级 AI 代理操作指南 AGENTS.md（阶段 28 / AC-83）
```

> 行数口径：`wc -l` 与 `grep -c ""` 均为 **289**（文件以换行结尾，编辑器可能显示 290 行）；
> host_manger 验收记录写 290，差异仅在此口径，不是内容差异。

#### ② 常用命令（隔离副本 `git archive HEAD` 实测；除标注者外 rc 全 0）

| 目的 | 命令 | rc | 实测输出（关键行） |
| --- | --- | --- | --- |
| 装依赖 | `npm ci --cache var/cache/npm` | 0 | `node_modules` 209 项；末尾 `npm warn allow-scripts … better-sqlite3@13.0.3 (install: node-gyp rebuild)` |
| （对照）不带 cache | `npm ci` | **226** | `npm error code EROFS … /root/.npm/_cacache/tmp` ⇒ 文档必须写 `--cache` |
| 构建（全量） | `npm run build` | 0 | `vendor-antd-Dv-mN7eq.js 467.32 kB`；`✓ built in 567ms` |
| 只构建服务端 / 前端 | `npm run build:server` / `npm run build:web` | 0 / 0 | `✓ built in 466ms`；`dist/web/index.html` present |
| 全量测试 | `npm test` | 0 | `ℹ tests 285 / pass 285 / fail 0`（duration 16571 ms） |
| 单文件 | `npm run build && node --test tests/health.test.ts` | 0 | `ℹ tests 3 / pass 3 / fail 0` |
| 单用例 | `npm run build && node --test --test-name-pattern='0.0.0.0' tests/health.test.ts` | 0 | `ℹ tests 1 / pass 1 / fail 0` |
| 类型检查 | `npm run typecheck:web` / `npm run typecheck:tests` | 0 / 0 | 无输出（0 个 TS 错误） |
| **本地质量检查** | `bash tools/ci-check.sh` | 0 | `✅ 代码质量检查全部通过（6 项）`；`ℹ tests 285 … fail 0`；最大 `467320 B` |
| 迁移（幂等） | `DATA_DIR=$AC npm run migrate` | 0 | `ok: schema at v3`；**第二次再跑同样 `ok: schema at v3`、rc=0** |
| 设管理员口令 | `printf '%s\n' '…' \| DATA_DIR=$AC node bin/pm.mjs user set-password --username admin` | 0 | `ok: user admin password updated` |
| 启动 | `DATA_DIR=$AC PORT=8765 npm start` | 0 | `promptmanager listening on 0.0.0.0:8765 (HOST=0.0.0.0 PORT=8765, DATA_DIR=…)` |
| 临时实例 | `DATA_DIR=$AC PORT=8766 node dist/server/index.js` | 0 | `/healthz` → `{"status":"ok","version":"1.0.0"}`；未认证 `/api/prompts` → `401`；`/` → `200` |
| 2000 条夹具 | `DATA_DIR=$AC node tools/seed-prompts.mjs 2000` | 0 | `ok: seeded 2000 prompts (total=2000, fts_hits=2000) in … [192 ms]` |
| 部署文件语法 | `systemd-analyze verify deploy/promptmanager.service` | 0 | 无输出 |
| 代表阶段脚本 | `bash tools/ac-stage25.sh` | 0 | `✅ AC-76 全部通过` |
| 界面自证 | `bash tools/ui-shots.sh` | 0 | `OK ui-shots done`；`张数=53` |

**返工（改英文）后再抽查一次**（隔离副本；HEAD 代码树与 `d6285ba` 相同）：

```
### npm run build            rc=0   vendor-antd-Dv-mN7eq.js 467.32 kB / ✓ built in 443ms
### npm test                 rc=0   ℹ tests 285 / ℹ pass 285 / ℹ fail 0
### bash tools/ci-check.sh   rc=0   ③ npm test（rc=0）✅ ℹ tests 285 ℹ pass 285 ℹ fail 0
### migrate ×2               rc=0/0 ok: schema at v3（两次相同）
### set-password            rc=0   ok: user admin password updated
### systemd-analyze verify  rc=0   （无输出）
```

#### ③ 结构路径逐个 `test -e`

```
  checked 80 paths, missing 0 (expect 0)
```

（`bin/` `src/` `web/` `migrations/` `tests/` `tools/` `deploy/` `docs/` 及关键文件、根目录文件、`.github/workflows/ci.yml`、运行期目录全在。
`data/` 因"首次运行才创建"改为在 §6 说明，不再列为结构路径 —— 这是可上手性自检补掉的缺口之一，见 ⑦。）

#### ④ 过期表述 grep 命中 0

```
pattern=列表视图            hits=0     pattern=1.25 MB          hits=0
pattern=1,265KB|1265KB     hits=0     pattern=\b149\b          hits=0
pattern=\b248\b            hits=0     pattern=PromptManager    hits=0
pattern=阶段 ?1[–-]9       hits=0
# 英文版另按英文等价模式复验（大小写敏感）：list view=0 · 1.25 MB=0 · 1265KB=0 · 149=0 · 248=0 · PromptManager=0 · stage 1-9=0
```

#### ⑤ 坑 ≥5 条且每条指向证据

`grep -cE '^[0-9]+\. \*\*' AGENTS.md` → **10** 条：AF_NETLINK 启动即崩 / `MemoryDenyWriteExecute` /
`npm ci` EROFS / `node --test` 子进程要 `detached` / 内网 HTTP 无 `navigator.clipboard` / jsdom 常驻 ~200MB /
`folder_id` 含全部后代 / CLI 与测试依赖 `dist/**` / npm 11 allow-scripts 跳过 `node-gyp rebuild` / `replace` 清库顺序。
证据指向比对（旧版 vs 新版，脚本抽 `` `path.ext:line` `` 集合求差）：

```
old file:line refs = 9  new = 9
missing in new: NONE
added in new  : NONE
```

#### ⑥ 指向而非复制（3 处示例）

| 落盘位置 | 处理 | 为什么指向而不是抄 |
| --- | --- | --- |
| §1 末尾 + §11 | 「监听地址 / 端口 / 认证方式 / 环境变量表 → 见 `README.md` 的 "how to run" 节」 | 环境变量表 9 行，README 已有唯一副本；抄过来就是两份真相，改一处漏一处 |
| §6 | 「`schema_version` 与项目版本解耦 —— 规则 / tag 约定 / 发版流程读 `docs/versioning.md`，**别在这里重述**」 | 那是 77 行的成体系文档；这里只需给"什么时候该去读"的路标 |
| §3 末行 + §8 | 「阶段脚本清单见 `README.md` 的验证节；阶段 9 无独立脚本」 | 阶段脚本会持续增加 —— 本阶段期间 `tools/ac-stage27.sh` 就新出现了；枚举必然过期 |

（同类：§5 选型指向 `STANDARDS.md` §4.2「禁止手搓清单」；坑 1 的修法指向 `deploy/README.md` §6 的 drop-in 段。全文指向性引用 **15 处**。）

#### ⑦ 可上手性自检（"无上下文新会话能否 5 分钟跑起来"）

按 §2 从零走一遍，**发现并就地补掉 3 个缺口**：

1. **`npm ci` 在本沙箱直接失败**（`EROFS`，`/root/.npm` 只读）—— README 的 `npm ci` 在这里跑不通
   ⇒ 文档改为可跑形式 `npm ci --cache var/cache/npm`，并单列为坑 3。
2. **单文件跑测试必须先 build**（测试 `import '../dist/**'`；只跑 `build:server` 时 `tests/health.test.ts` 出现 1 个假失败
   `未知路径回落到前端入口`，因为缺 `dist/web`）⇒ 命令写成 `npm run build && node --test …`，并列为坑 8。
3. **`data/` 当前并不存在**（首次运行才创建），原先列在 §4 结构表里 —— 与"每个路径都 `test -e` 过"矛盾 ⇒ 移到 §6 说明。

**结论：能。** 冷启动路径 = `npm ci --cache var/cache/npm` → `npm run build` → `npm test` → 临时 `DATA_DIR` + 备用端口起实例
→ `curl /healthz`；期望输出、端口纪律（8767 被占，用 8765–8770 内空闲口）、红线、坑都在同一份文件里。

#### ⑧ 必须全英文：CJK 字符数 0

```
# 判据命令（BRIEF AC-83 ⑧ 原样）：
$ LC_ALL=C grep -cP '[\x{4e00}-\x{9fff}\x{3000}-\x{303f}\x{ff00}-\x{ffef}]' AGENTS.md
grep: character value in \x{} or \o{} is too large
rc=2                       ← ⚠️ 该命令在本机不可执行（原因见下）

# 等价判据 1（同区间，去掉 LC_ALL=C；GNU grep 3.6 + PCRE2 UTF 模式）：
$ grep -cP '[\x{4e00}-\x{9fff}\x{3000}-\x{303f}\x{ff00}-\x{ffef}]' AGENTS.md
0        rc=1（= 0 命中）

# 等价判据 2（python 精确码点区间）：
CJK hits = 0

# 反例对照（证明判据真能抓 CJK）：对中文版 5911cf4 跑等价判据 2
old AGENTS.md CJK hits = 3871

# 入库 blob 复验（HEAD:AGENTS.md）
committed blob: CJK hits = 0 ; lines = 289
```

**残留非 ASCII**：仅 `✖`（U+2716）**2 处**（引用 `node:test` 真实输出 `✖ <file> 'test failed'`），**不在三个 CJK 区间内**。

**⚠️ 判据命令缺陷（本阶段实测发现，建议 BRIEF 修订）**：`LC_ALL=C` 会把 PCRE2 压进**字节模式**，
此时 `\x{}` 上限是 `0xFF`，`\x{4e00}` 直接报错 ⇒ **AC-83 ⑧ 的原样命令永远拿不到 0，只能拿到 rc=2**；
更危险的是"顺手修"的 `LC_ALL=C grep -cP '\p{Han}'` 会**假绿**（对纯中文旧版实测也返回 0 —— 字节模式下 `\p{Han}` 匹配不到任何 UTF-8 序列）。
建议改为 **`grep -cP '\p{Han}'`（不带 `LC_ALL=C`）**，或去掉 `LC_ALL=C` 而保留原码点区间。

### ④ 内容不变证明（脚本比对，不靠目测）

| 不变项 | 比对方式 | 结果 |
| --- | --- | --- |
| 命令 | 抽旧/新版反引号内命令集合求差 | **40 vs 40**；差异仅为 §2 注释翻译与中文口令占位符 `<强口令>` → `<strong-password>`，**命令本体零改动** |
| `file:line` 证据 | 抽 `` `path.ext:line` `` 集合求差 | **9 vs 9**，`missing=NONE`，`added=NONE` |
| 结构 | `grep '^## '` | **§1–§12 全在** |
| 坑 | `grep -cE '^[0-9]+\. \*\*'` | **10 条**，每条仍带证据 |
| 实测输出关键串 | `grep -cF` | `ok: schema at v3`×2 · `ok: user admin password updated` · `{"status":"ok","version":"1.0.0"}`×2 · `ok: seeded 2000 prompts (total=2000, fts_hits=2000)` · `467320 B`×2 · `OK ui-shots done` · `tests 285`×3 · `fail 0`×6 · `209 entries` |
| 行数 | `wc -l` | 中文版 **232** → 英文版 **289**（语言变长，内容未删） |

### ⑤ 回归（补写本节时，工作区已干净）

```
$ git status --porcelain        → （空）
$ npm test                      → rc=0   ℹ tests 300 / ℹ pass 300 / ℹ fail 0（duration 16578 ms）
```

（285 → 300 是**阶段 27** 新增 15 个用例，与本阶段无关；本阶段零代码改动 ⇒ 不产生用例数变化。）

### ⑥ commit（逐单元；收尾 commit hash 单独标注）

| 单元 | 内容 | commit |
| --- | --- | --- |
| ① | 新建 `AGENTS.md`（**中文版**，232 行）—— 项目级 AI 代理操作指南 | **`5911cf4`** `docs(agents): 新增项目级 AI 代理操作指南 AGENTS.md（阶段 28 / AC-83）` |
| ② | **全文改为英文**（AC-83 ⑧ / STANDARDS §5.1），289 行 | **`67e5f41`** `docs(agents): AGENTS.md 全文改为英文（阶段 28 / AC-83 ⑧）` |
| 收尾 | 本节（PROGRESS 阶段 28 小节 + 状态表/阶段索引更新）—— **docs-only，无代码改动** | 见交付回复（提交无法自引用自身 hash） |

> 本阶段两次提交都**只含 1 个文件**（`git show --stat`：`5911cf4` = 232 insertions；`67e5f41` = 268 insertions / 211 deletions），
> 全程未夹带阶段 27 的任何改动；`AGENTS.md` 的完整提交历史 `git log --follow -- AGENTS.md` 恰好只有这两个提交。

### ⑦ 落盘对账

| 结论 | 证据 | 落盘位置 / commit |
| --- | --- | --- |
| 交付物 = 英文版 `AGENTS.md`（289 行） | `git show HEAD:AGENTS.md`：CJK 0、结构 §1–§12、坑 10 条 | `AGENTS.md`；commit `67e5f41` |
| 语言判据 = 0 CJK | 等价判据 1（grep）= 0、等价判据 2（python）= 0、反例对照 = 3871 | 本节 ⑧ |
| 内容不变 | 命令 40/40、`file:line` 9/9、结构 §1–§12、坑 10、关键输出串全在 | 本节 ④ |
| 常用命令可跑 | 隔离副本 rc 全 0（含返工后抽查 6 条） | 本节 ② |
| 并行避让 | 只提交 1 文件 / 未动 `PROGRESS.md` / 隔离副本验证 / 未用 `git add -A` | 本节 ② |
| AC-83 ⑧ 判据命令缺陷 | `LC_ALL=C` + `\x{}` → rc=2；`LC_ALL=C` + `\p{Han}` → 假绿（旧版也 0） | 本节 ⑧（建议 BRIEF 修订） |


## 阶段 29（2026-09-21）：阶段 27 的 5 条视觉细化（FR-82 / FR-83）

### 开工前：AC-84 / AC-85 → 检查命令（先落盘，再动手）

> 基线：`npm test` 已跑，**300/300 全绿**（rc=0，`ℹ tests 300 / pass 300 / fail 0`）—— 绿色基线确认后才开工。
> 本阶段**只改观感与健壮性**（CSS / 组件属性 / 间距），**不动功能语义、接口契约、数据模型**；**无 schema 变更**、**无新依赖**。

| AC | 要执行的检查命令 | 判据 |
| --- | --- | --- |
| AC-84 ① | `node tools/ac-stage29-probe.mjs bulk-ui <base> <sid> <shots>`（真鼠标勾 3 行 → 读表头复选框 DOM/属性） | 部分选中 → 表头 `.ant-checkbox-indeterminate` 存在（或 `input[aria-checked="mixed"]`）；点表头全选 → `.ant-checkbox-checked` 存在且 `indeterminate` 消失；再点取消 → **两者皆无**（贴 DOM/属性证据） |
| AC-84 ② | 同上（量 `getBoundingClientRect()`） | 表头复选框与行内复选框的宽、高**差 ≤1px**（贴数值） |
| AC-84 ③ | 同上（量工具条底部 → 表头行顶部） | 间距 **≥6px**（贴像素） |
| AC-84 ④ | `node tools/ac-stage27-probe.mjs bulk <base> <sid> <shots>`（沿用 AC-78 断言） | 批量收藏/移动/删除（含二次确认）+ **一次操作 1 个请求** 仍成立（贴关键行） |
| AC-84 ⑤ | 同上 | 截图三态：未选 / 部分选（半选）/ 全选 |
| AC-85 ① | `node tools/ac-stage29-probe.mjs meta-ui <base> <sid> <shots>`（真鼠标选中长内容夹具） | 「备注行底部 → 元信息行顶部」**≥12px**，且**不大于**「元信息行底部 → 字段页签行顶部」（贴两个数值） |
| AC-85 ② | 同上（夹具：**长文件夹名 ≥20 字 + 5 个标签**） | 元信息行 `scrollWidth <= clientWidth + 2`，且「+ 添加标签」控件 `getBoundingClientRect().right <= 面板 right + 1`（贴数值 + 截图） |
| AC-85 ③ | 同上（`getComputedStyle` 详情 chip vs 左栏同名 chip） | `backgroundColor` / `border` / `borderRadius` **三者一致**（贴两处数值对比） |
| AC-85 ④ | `node tools/ac-stage27-probe.mjs detail-meta <base> <sid> <shots>`（沿用 AC-79 断言） | 改文件夹 / 加标签 / 删标签仍落库 + 三处（卡片/表格/编辑器）同源一致（贴关键行） |
| AC-85 ⑤ | 同上 | 截图：常规（有文件夹 + 多标签）/ 长内容 / 亮暗 |
| 回归 | `npm test`（≥300，只增不减）；`bash tools/ci-check.sh`；`bash tools/ac-stage27.sh`（AC-78~AC-82）；`bash tools/ac-stage22.sh` / `ac-stage23.sh` / `ac-stage24.sh`（AC-70~75） | 全绿；用例数变化须说明理由 |

### 阶段 29 实施与自检：逐条命令 + 原样输出

> 改动面（`git diff --stat` 收尾核对）：**2 个前端文件**（`web/src/styles/app.css` 新增 3 组规则、`web/src/components/PromptDetail.tsx` 元信息行间距/换行保护/chip class）；
> 新增 **1 个测试**（`tests/stage29-ui.test.ts`，7 用例）、**2 个 AC 脚本**（`tools/ac-stage29.sh`、`tools/ac-stage29-probe.mjs`）、**1 组截图**（`docs/shots/stage29/`）；
> `tests/stage18-bundle.test.ts` 追加体积记账。**无接口/契约/数据模型改动**、**无 schema 变更**（`migrations/*.sql` 仍 3 个）、**无新依赖**。
> 本阶段需求规格（六维）已按 grill 共识落盘：`docs/dev-history/doublecheck-stage29-spec.md`。

#### ① 五条现象的「改前 → 改后」真实数值（先量基线再动手）

| # | 现象 | 改前（实测） | 改后（实测） | 落盘位置 |
| --- | --- | --- | --- | --- |
| ① | 半选态看不出 / 像实心方块 | `.ant-checkbox-indeterminate` **本来就有**（机械判据已满足），但 antd 6 的画法是「**白底 + 灰边 + 中间一个小主色方块**」（`node_modules/antd/es/checkbox/style/index.js` 的 `&-indeterminate`）⇒ 读起来就是"实心方块"、视觉上比已勾选的 16×16 小 | 覆写为「**主色底 + 白色 8×2 横杠**」，外框仍是 16×16，与已勾选态同尺寸；**只覆盖视觉**，组件仍是 antd `Checkbox` | `web/src/styles/app.css`（`.pm-table-dense .ant-checkbox-indeterminate`） |
| ② | 表头复选框比行内小 | 表头 `16×16` / 行内 `16×16`（**差 0px**，机械判据本来就过） | 不变（规则里**不写 width/height**，只改底色与横杠） | 同上 + `tests/stage29-ui.test.ts` 的"未做尺寸覆写"断言 |
| ①'' | **（对抗性自审第 2 轮发现）hover 时半选又"看不出"** | antd 给半选态单独注入了 hover：`.ant-checkbox-indeterminate:not(.ant-checkbox-disabled):hover{background:colorBgContainer}`（specificity 0,3,0）；亮色下 `colorBgContainer` 是**白底**，而横杠也是白色 ⇒ **鼠标悬浮在表头复选框上时变成"白底白杠"**。AC-84 ① 的探针量之前鼠标停在行上、不触发表头 hover，**只验静态会漏掉这一态** | 补一条更高优先级（0,4,0）的 hover 规则把底/边钉回主色；真鼠标悬浮实测 `backgroundColor=rgb(94,106,210)`（非白）、`::after` 仍白 | `web/src/styles/app.css`（`.pm-table-dense .ant-checkbox-indeterminate:not(.ant-checkbox-disabled):hover`）+ 探针 `hoverOf()` + 截图 `02c-bulk-partial-hover-light` |
| ⑤'' | **（对抗性自审第 2 轮发现）详情 chip 有"可点"错觉** | 左栏基类 `.pm-tag-chip:hover`（0,2,0）会作用到详情 chip 上 ⇒ 悬浮时底色/文字变化，但详情 chip 本体**不可点**（只有 ✕ 可点） | 补 `.pm-detail-meta .ant-tag.pm-tag-chip:hover` 中和（保持 `surface-2` / `ink-subtle`） | 同上 + `tests/stage29-ui.test.ts` |
| ③ | 工具条贴表头 | `toolbar.bottom=144`，`headerRow.top=144` ⇒ **0px** | `toolbar.bottom=144`，`headerRow.top=152` ⇒ **8px**（≥6） | `app.css`（`.pm-bulk-toolbar { margin-bottom: 8px }`） |
| ④ | 元信息行贴备注、离页签远 | `notesToMeta=16`、`metaToFields=16`（**相等** ⇒ 读起来像备注的第二行） | `notesToMeta=**20**`、`metaToFields=**24**`（20≥12 且 20≤24，层级对称） | `PromptDetail.tsx`（元信息行 `marginTop:4 / marginBottom:8`，父容器 `gap=16`） |
| ⑤ | 长内容把「+ 添加标签」顶出 | 1600px 下已不溢出（`scrollWidth=clientWidth=924`、`addRight=1408≤panelRight=1567`）—— AC-79 ⑥ 只测窄屏、未测长内容，**这次补上窄面板证据** | 1600px：`924=924`、`addRight=1462≤1567`；**1100px 窄面板**：`688=688`、`addRight=968≤1067`（新增 `minWidth:0` + `flex:1 1 auto` + 文件夹 `maxWidth:220`） | `PromptDetail.tsx`（元信息行 / 标签块 / 添加控件 / 文件夹下拉的 flex 约束） |
| ⑤' | 详情 chip 与左栏 chip 不一致 | 详情 `bg=rgba(94,106,210,0.14)`、`radius=4px`、`color=rgb(94,106,210)`、`height=21.8px`；左栏 `bg=rgb(246,247,249)`、`radius=13px`、`color=rgb(107,114,128)`、`height=26px` | **逐项相等**：两处都是 `bg=rgb(246,247,249)` / `border=1px solid rgba(0,0,0,0)` / `radius=13px` / `color=rgb(107,114,128)` / `height=26px` | `PromptDetail.tsx`（`className="pm-tag-chip pm-detail-tag"`）+ `app.css`（`.pm-detail-meta .ant-tag.pm-tag-chip`） |

> **诚实说明**：①②的**机械判据**（`ant-checkbox-indeterminate` 存在、表头/行内 16×16 差 0px）在改前**就已满足** —— 用户看到的问题来自 antd 的半选**画法**。
> 因此本阶段对 ① 做的是**视觉覆写**（用户已确认保留该改法），对 ② 只做"不破坏尺寸"的约束与断言；④同理：1600px 下改前也不溢出，本阶段补的是**窄面板 + 长内容**的健壮性与证据。

#### ② AC-84 表格批量 UI 细化（`bash tools/ac-stage29.sh bulk`，真鼠标 + 真实像素）

```
=== AC-84：表格批量 UI 细化（真鼠标 + 真实像素） ===
  ✅ ① 未选：indeterminate 与 checked 皆无 = true
  ✅ ① 部分选中：半选态（ant-checkbox-indeterminate 或 aria-checked=mixed） = true
  ✅ ① 部分选中 DOM 证据：{"classes":"ant-checkbox ant-checkbox-indeterminate ant-wave-target css-19u5a7b","indeterminateClass":true,"checkedClass":false,"ariaChecked":null,"inputChecked":false}
  ✅ ① 半选态视觉覆写生效（外框底色/边框 == 已勾选行 = 同一主色填充） = true
  ✅ ① 半选外框 computed：{"backgroundColor":"rgb(94, 106, 210)","borderTopColor":"rgb(94, 106, 210)","afterWidth":"8px","afterHeight":"2px","afterBackground":"rgb(255, 255, 255)","afterOpacity":"1"}
  ✅ ① 已勾选行 computed：{"backgroundColor":"rgb(94, 106, 210)","borderTopColor":"rgb(94, 106, 210)"}
  ✅ ① 半选横杠 = 白色 8×2（不是 antd 默认的小方块） = true
  ✅ ① 半选 hover 态 computed：{"backgroundColor":"rgb(94, 106, 210)","borderTopColor":"rgb(94, 106, 210)","afterBackground":"rgb(255, 255, 255)"}
  ✅ ① hover 时半选仍可辨（底色不是白、且 == 已勾选行；横杠仍白） = true
  ✅ ① 全选：打勾且无 indeterminate = true
  ✅ ① 全选后当页**全部**勾选（勾选数 == 当页行数） = true
  ✅ ① 勾选数 / 当页行数：16 / 16
  ✅ ① 再点取消：两者皆无 = true
  ✅ ① 取消后 0 行勾选 = 0
  ✅ ② 表头与行内复选框尺寸差 ≤1px（宽/高） = true
  ✅ ② 表头复选框 rect：{"left":286,"top":162,"right":302,"bottom":178,"w":16,"h":16}
  ✅ ② 行内复选框 rect：{"left":286,"top":203,"right":302,"bottom":219,"w":16,"h":16}
  ✅ ② 表头 wrapper：{"left":286,"top":160,"right":302,"bottom":181,"w":16,"h":21} ｜ 行内 wrapper：{"left":286,"top":200,"right":302,"bottom":221,"w":16,"h":21}
  ✅ ③ 工具条底部 → 表头行顶部（px） = 8（≥ 6）
  ✅ ③ 工具条 rect：{"left":264,"top":118,"right":1584,"bottom":144,"w":1320,"h":26} ｜ 表头行 rect：{"left":264,"top":152,"right":1584,"bottom":190,"w":1320,"h":38}
  ✅ 页面运行时异常（bulk-ui） = []

=== AC-84 ④：批量动作回归（沿用 AC-78 断言；真鼠标 + 请求计数） ===
  ✅ ④ 批量收藏：2 条 favorite=true = true
  ✅ ④ 只发 1 个 POST /api/prompts/bulk（收藏） = 1
  ✅ ④ 批量移动只发 1 个请求 = 1
  ✅ ④ 批量移动：2 条 folder_id = 目标目录 = true
  ✅ ④ 二次确认文本含条数与「不可恢复」 = true
  ✅ ④ 批量删除只发 1 个请求 = 1
  ✅ ④ 先取消不删 / 再确认删 2 = true
  ✅ ④ 表头全选 → 当页全部选中 = true
  ✅ ④ 行内操作 / 行拖拽手柄 / 分页 / 排序 / 搜索仍在 = true
  ✅ 页面运行时异常（AC-78 回归） = []
```

#### ③ AC-85 详情页元信息行细化（`bash tools/ac-stage29.sh meta`，真实像素 + 长内容夹具）

```
=== AC-85：详情页元信息行细化（真鼠标 + 真实像素 + 长内容夹具） ===
ac85_spacing={"notesBottom":185,"metaTop":205,"metaBottom":231,"fieldsTop":255,"notesToMeta":20,"metaToFields":24}
  ✅ ① 备注行底部 → 元信息行顶部（px） = 20（≥ 12）
  ✅ ① 前者 ≤ 元信息行底部 → 字段页签行顶部 = true
  ✅ ② 长内容元信息行：{"scrollWidth":924,"clientWidth":924,"metaRight":1567,"addRight":1462,"panelRight":1567,"folderText":"AC29 超长文件夹名称用于换行保护验证ABC一二三四五六七八九十","tagCount":5,"docScrollWidth":1600,"docClientWidth":1600}
  ✅ ② 长内容不横向溢出（scrollWidth ≤ clientWidth+2） = true
  ✅ ② 「+ 添加标签」仍在面板可视区内（right ≤ 面板 right+1） = true
  ✅ ② 页面整体无横向溢出 = true
  ✅ ② 长内容夹具确实含 5 个标签 = 5
  ✅ ② 长文件夹名确实 ≥20 字（夹具前置条件） = true
  ✅ ② 窄面板（1100px）元信息行：{"scrollWidth":688,"clientWidth":688,"metaRight":1067,"addRight":968,"panelRight":1067,"docScrollWidth":1100,"docClientWidth":1100}
  ✅ ② 窄面板下同样不溢出、添加入口仍在面板内 = true
  ✅ ③ chip 样式对比：{"name":"#AC29乙","detail":{"backgroundColor":"rgb(246, 247, 249)","border":"1px solid rgba(0, 0, 0, 0)","borderTopWidth":"1px","borderTopStyle":"solid","borderTopColor":"rgba(0, 0, 0, 0)","borderRadius":"13px","color":"rgb(107, 114, 128)","height":"26px"},"sidebar":{"backgroundColor":"rgb(246, 247, 249)","border":"1px solid rgba(0, 0, 0, 0)","borderTopWidth":"1px","borderTopStyle":"solid","borderTopColor":"rgba(0, 0, 0, 0)","borderRadius":"13px","color":"rgb(107, 114, 128)","height":"26px"}}
  ✅ ③ 详情 chip 与左栏同名 chip 样式一致（backgroundColor / border / borderRadius） = true
  ✅ 页面运行时异常（meta-ui） = []
（② 补充证据·窄面板 1100px）ac85_meta_long_narrow={"scrollWidth":688,"clientWidth":688,"addRight":968,"panelRight":1067,"docScrollWidth":1100,"docClientWidth":1100}

=== AC-85 ④：改文件夹 / 加标签 / 删标签 + 三处同源回归（沿用 AC-79 断言） ===
  ✅ ④ 元信息行位置：备注行之下、字段页签之上 = true
  ✅ ④ 改文件夹落库 = 目标目录 = true
  ✅ ④ 再选「未归类」→ folder_id=null = true
  ✅ ④ 加标签 → 落库 tags 增加 = true
  ✅ ④ 点 ✕ 删标签 → 落库 tags 减少 = true
  ✅ ④ 三处同源：表格行含标签 = true
  ✅ ④ 三处同源：卡片含标签 = true
  ✅ ④ 三处同源：编辑器标签一致 = true
  ✅ ④ 侧栏计数同步（甲目录 −1 / 目标目录 +1） = true
  ✅ 页面运行时异常（AC-79 回归） = []
```

#### ④ 截图识图（`docs/shots/stage29/`，五问逐张过）

| 图 | 重叠/遮挡 | 硬断词 | 孤标题 | 溢出裁切 | 符合既定美学 |
| --- | --- | --- | --- | --- | --- |
| `01-bulk-none-light`（未选） | 无 | 无 | 无 | 无 | ✅ 表头复选框为空框 |
| `02-bulk-partial-light`（**半选**） | 无 | 无 | 无 | 无 | ✅ 表头复选框 = **主色底 + 白色横杠**，与行内已勾选（白勾）一眼可辨、同为 16×16；工具条与表头有可见间距 |
| `03-bulk-all-light`（全选） | 无 | 无 | 无 | 无 | ✅ 表头 = 白勾；「已选择 16 项」 |
| `01-meta-regular-light`（常规） | 无 | 无 | 无 | 无 | ✅ 标题 → 备注 → **元信息行（独立一行）** → 页签 → 正文；chip 与左栏同款灰胶囊 |
| `02-meta-long-light`（长内容 1600px） | 无 | 无 | 无 | 无（文件夹名省略号截断；5 chip + 添加入口同排） | ✅ |
| `02b-meta-long-narrow-light`（长内容 1100px） | 无 | 无 | 无 | 无（`scrollWidth == clientWidth`，添加入口在面板内） | ✅ 自然折行 |
| `03-meta-long-dark` / `04-meta-regular-dark`（暗色） | 无 | 无 | 无 | 无 | ✅ 暗色下 chip 为等价低对比底色，与左栏一致 |

> `docs/shots/stage29/regression-ac27/`（13 张）是 **AC-78 / AC-79 回归**的截图（由 `tools/ac-stage27-probe.mjs` 在新视觉下重跑产出，与本阶段自己的 8 张分开存放）。

**降级清单**：**无**。**明确不做**（已与用户确认，见 `docs/dev-history/doublecheck-stage29-spec.md` 的 non-goals）：
① 表格「标签」列的 chip 仍用 antd 默认（FR-83 ⑤ 只点名「详情页元信息行 vs 左栏」）；
② 顶层 `docs/shots/*.png`（53 张"当前状态"证据）**未重跑**，留待下次"上线准备"批次统一刷新（本阶段证据在 `docs/shots/stage29/`）。

#### ⑤ 回归（收尾三件套 + 重点 AC）

```
$ npm test                       → ℹ tests 307 / pass 307 / fail 0        （300 → 307，+7 = tests/stage29-ui.test.ts）
$ bash tools/ci-check.sh         → ✅ 代码质量检查全部通过（6 项）
   ③ npm test（rc=0）  ℹ tests 307 ℹ pass 307 ℹ fail 0
   ④b 体积预算（rc=0） 最大 vendor-antd-D0a34XA3.js = 470985 B（全部 js 合计 1302 KB）
$ bash tools/ac-stage29.sh       → ✅ AC-84 / AC-85 全部通过（rc=0）
$ bash tools/ac-stage27.sh       → ✅ AC-78 / AC-79 / AC-80 / AC-81 / AC-82 全部通过（rc=0）
$ bash tools/ac-stage22.sh       → ✅ AC-70 / AC-71 全部通过（rc=0）
$ bash tools/ac-stage23.sh       → ✅ AC-72 / AC-73 / AC-74 全部通过（rc=0）
$ bash tools/ac-stage24.sh       → ✅ AC-75 全部通过（rc=0）
$ ls migrations/*.sql | wc -l    → 3（无 schema 变更）
$ git diff --name-only package.json package-lock.json → 空（无新依赖）
```

**体积记账**（**已按对抗性自审第 2 轮修正**）：`tests/stage18-bundle.test.ts` 的 `STAGE29_ACCOUNTED_DELTA = 166` 起初**只声明、未参与求和**（死代码）⇒ 真实预算仍是 418,652 B、只剩 8 B 余量，而文档却写 418,818 B。
现已把该项**加进 AC-61 ⑤ 的求和**（测试名同步改为「阶段 18 / 22 / 27 / 29」）。当前实测：总 gzip **418,671 B** ≤ **实际生效**预算 399,175+2,560+15,954+963+166 = **418,818 B**（余量 147 B）✓。

**回归原样输出（关键断言行，第 2 轮复跑；`ac-stage29.sh` 另含 `⑤ 截图齐备 = 22`）**：

```
# tools/ac-stage27.sh（AC-78~82）
  ✅ 不存在 id → 400 = 400 ／ ✅ 空 ids → 400 = 400 ／ ✅ 目标文件夹不存在 → 400 = 400
  ✅ AC-78 / AC-79 / AC-80 / AC-81 / AC-82 全部通过        （rc=0）
# tools/ac-stage22.sh（AC-70/71）
  ✅ 无横向滚动 = true
  ✅ 宽度：{"list":336,"detail":924,"viewport":1600}（改前基线 366px @1600）
  ✅ 备注区两行截断 = 2 ／ ✅ 空备注条目与有备注条目等高 = 80
  ✅ AC-70 / AC-71 全部通过                                 （rc=0）
# tools/ac-stage23.sh（AC-72/73/74）
  ✅ folder_id=A 的 total = 3 ／ ✅ folder_id=B 的 total = 2 ／ ✅ folder_id=C 的 total = 1
  ✅ folder_id=A&tag=T → 1 = 1 ／ ✅ folder_id=A&q=乙乙乙 → 1 = 1 ／ ✅ folder_id=abc → 400 = 400
  ✅ AC-72 / AC-73 / AC-74 全部通过                          （rc=0）
# tools/ac-stage24.sh（AC-75）
  ✅ 全部视图顺序（拖前）：[4,3,1,2] →（拖后）：[3,1,4,2] ／ ✅ 恰好 1 次 PATCH /api/prompts/order = 1
  ✅ 槽位保持（A 组只换槽位 / 其他不变 / 无重复 / 不顶到最前） = true
  ✅ AC-75 全部通过                                          （rc=0）
```

**AC-1…AC-83 未回归**：AC-78~AC-82（阶段 27 批量与详情页）与 AC-70~75（拖拽与分栏）由上述脚本复跑全过；
本阶段**没有**任何"被取代的旧断言"（AC-84/85 是新增判据，旧断言全部继续成立）。
`tests/stage18-bundle.test.ts` 的断言行**未放宽**（只新增一项求和项），`ac-stage27/22/23/24.sh` **未改动**。

#### ⑥ 对抗性自审（delivery-review：假设交付不满足自己的规格，找最强反驳）

**第 1 轮（人工，按 `delivery-review` 技能）**：逐维度找反驳，**1 条真实缺陷，已修**（其余维度如实无异议）：

| 维度 | 反驳 | 结论 |
| --- | --- | --- |
| Goal | ①②的机械判据改前就满足 ⇒ 是否"没解决问题"？ | **不是**：用户看到的是 antd 半选**画法**（白底+小方块），本阶段做的是视觉覆写；用户已确认保留该改法。已在 §① 的"诚实说明"里写明，不埋。 |
| AC 证据 | AC-84 ① 只有 class + 截图 —— 若 antd 运行时 CSS-in-JS 把覆写盖回去，**class 判据仍会假绿** | ✅ **真实缺陷，已修**：给 AC-29 探针加了半选外框的 `getComputedStyle`（含 `::after`）测量与断言 —— 半选外框 `backgroundColor/borderTopColor` 必须**等于已勾选行**（实测两处都是 `rgb(94,106,210)`），`::after` 必须是**白色 8×2**（实测 `8px/2px/rgb(255,255,255)/opacity 1`）。证据已补进 §②。 |
| Scope / Non-goals | 有没有越界？ | **没有**（`git show --name-only 750464b` 核对）：未碰 `UseView.tsx`（表格标签列不动）、顶层 `docs/shots/*.png` **0 个**、`migrations/` **0 个**、`src/`（后端）**0 个**、`BRIEF.md`/`STANDARDS.md`/`package.json` **均未改**。 |
| Failure modes | 7 条逐一核 | ①~⑤ 见 §① 的改后数值与 §②/§③ 断言；⑥ 体积见 §⑤；⑦ `ac-stage23/24` 复跑全过。**① 原先只靠截图，已按上表补成数值断言**。 |
| Priorities | 有没有为可选目标牺牲硬要求？ | **没有**：AC-84/85 全过、无回归；non-goals 按要求明确不做。 |

**第 2 轮（`doublecheck_report` 的 verify 未执行 ⇒ 改用 `workflow` 起 5 个独立只读 checker，一维度一个）**：
`goal` / `acceptance` / `scope` / `priorities` 四维 **pass**；`failure-modes` 维 **fail**，共报出 **6 条真实缺陷，全部已修**：

| # | 缺陷（checker 证据） | 修复 | 复验 |
| --- | --- | --- | --- |
| 1 | **`STAGE29_ACCOUNTED_DELTA` 是死代码**：`tests/stage18-bundle.test.ts:50` 声明了但 `:96` 的求和里没有它（测试名也仍写"阶段 18/22/27"）⇒ 真实预算是 418,652 B、只剩 8 B 余量，而 PROGRESS/commit/spec 都写 418,818 B —— **自报的记账是错的** | 把该项加进 AC-61 ⑤ 求和 + 测试名加"阶段 29" | `npm test` 307/307 rc=0；测试名已含"阶段 29"；实测 418,671 ≤ **实际生效** 418,818（余量 147） |
| 2 | **半选 hover 态没覆盖**：antd 的 `.ant-checkbox-indeterminate:not(.ant-checkbox-disabled):hover{background:colorBgContainer}`（0,3,0）压过我的（0,2,0）⇒ 亮色下悬浮时"白底白杠"，**正是本条要修的问题**；AC-84 ① 只验静态会漏 | 补 0,4,0 的 hover 规则钉回主色；探针加真鼠标 `hoverOf()` 测量 + 截图 | `ac84_partial_hover_style.backgroundColor=rgb(94,106,210)`（非白）✓；截图 `02c-bulk-partial-hover-light` 识图确认蓝底白杠 |
| 3 | **AC-84 ④ 的"1 个请求"只量了收藏/移动，没量删除** | 共享探针加 `ac78_delete_requests`；`ac-stage29.sh` 断言 = 1 | ✅ 批量删除只发 1 个请求 = 1 |
| 4 | **窄面板（1100px）测量只打印不断言** ⇒ 窄宽溢出回归不会变红 | `ac-stage29.sh` 增加窄面板断言（含整体 `docScrollWidth`） | ✅ 窄面板下同样不溢出、添加入口仍在面板内 = true |
| 5 | **截图存在性无断言**（只有 `ls -l`；probe 经 `tee` 后崩溃被 0 退出码掩盖） | 脚本加 `set -o pipefail`；新增"截图齐备 = 22"断言 | ✅ ⑤ 截图齐备 = 22 |
| 6 | **AC-84 ① 全选只断言 `>=6`**（当页可能更多）；**AC-85 ② 未断言"长文件夹名 ≥20 字"前置条件** | 全选改为"勾选数 == 当页行数"；夹具长度加断言 | ✅ 勾选数/当页行数 = 16/16；✅ 长文件夹名 ≥20 字 = true |

> 另据第 2 轮 scope 维度的提示，把未跟踪的 `docs/dev-history/doublecheck-stage29-report.md`（交付记录）**纳入提交**，不留游离文件。
> 修复后已重跑：`npm test` 307/307、`ci-check` 6/6、`ac-stage29.sh` rc=0、`ac-stage27/22/23/24.sh` 全 rc=0。

#### ⑦ commit（收尾 commit hash 单独标注）

| 单元 | 内容 | commit |
| --- | --- | --- |
| ① | FR-82 表格批量 UI（半选态/尺寸/间距）+ FR-83 元信息行（间距/换行/chip）+ 源码级测试 + AC 脚本 + 截图 + 文档 | **`750464b`** `feat(web): 阶段 29 —— 阶段 27 的 5 条视觉细化（FR-82 / FR-83）` |
| ② | 对抗性自审第 1 轮补强：半选态视觉覆写的 `getComputedStyle` 数值断言（探针 + 脚本 + PROGRESS） | **`9993327`** `test(ac29): 对抗性自审补强 —— 半选态视觉覆写的 computed-style 数值断言` |
| ③ | 对抗性自审第 2 轮（5 个独立 checker）修 6 条缺陷：体积记账死代码 / 半选 hover 白底白杠 / 删除请求数未量 / 窄面板不断言 / 截图存在性无断言 / 全选与夹具前置条件断言过松 | 见交付回复 |
| 收尾 | 本表（commit hash 回填）+ `docs/dev-history/doublecheck-stage29-report.md` 交付记录 —— **docs-only** | 见交付回复（提交无法自引用自身 hash） |


## 归档与当前状态的关系

- **根目录 `PROGRESS.md`（本文件）** = 当前状态 + 阶段索引 —— 给"想快速了解项目现在到哪了"的人看。
- **`docs/dev-history/PROGRESS.md`** = 完整过程记录 —— 给"要复核某条 AC 怎么验的"人看（验收凭据）。
- 其它开发过程档案同在 `docs/dev-history/`：`QUESTIONS-history.md`（历史问答）、`design/`（阶段 10A 三套设计打样）、
  `shots/`（阶段 18–25 的分阶段验收截图）。
- **当前状态的界面证据** = `docs/shots/*.png`（顶层 53 张，`tools/ui-shots.sh` 产出）。
