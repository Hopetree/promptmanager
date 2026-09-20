# promptmanager 进度（PROGRESS）

> **本文件只保留三样**：当前状态表 · 阶段索引表 · 归档指引。
> **完整过程记录（每条 AC 的命令、原样输出、逐张识图、决策与踩坑留痕）已归档到
> [`docs/dev-history/PROGRESS.md`](docs/dev-history/PROGRESS.md)**（阶段 1 – 阶段 25）。
> 归档是**移动**，内容一字未删；归档动作见「上线准备 P1」提交。

| 项 | 值 |
| --- | --- |
| 阶段 | **阶段 1–27 已全部完成**；已发布 **v1.0.0** |
| 状态 | 等 host_manger 最终验收（逐阶段验收记录见 `VERIFY.md`）；**阶段 27（FR-77~FR-81 / AC-78~AC-82）自检全过**（见本文件「阶段 27」） |
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

#### ⑨ commit（收尾 commit hash 单独标注）

| 单元 | 内容 | commit |
| --- | --- | --- |
| ① | 后端批量接口 `POST /api/prompts/bulk` + 单测 | 见下方「阶段 27 收尾」 |
| ② | 前端 FR-77 表格批量 + FR-78/79/80 详情页改造 + 被取代断言的修订 | 见下方「阶段 27 收尾」 |
| ③ | FR-81 VarsDialog 尺寸 + `tools/ac-stage27.*` + PROGRESS | 见下方「阶段 27 收尾」 |


## 归档与当前状态的关系

- **根目录 `PROGRESS.md`（本文件）** = 当前状态 + 阶段索引 —— 给"想快速了解项目现在到哪了"的人看。
- **`docs/dev-history/PROGRESS.md`** = 完整过程记录 —— 给"要复核某条 AC 怎么验的"人看（验收凭据）。
- 其它开发过程档案同在 `docs/dev-history/`：`QUESTIONS-history.md`（历史问答）、`design/`（阶段 10A 三套设计打样）、
  `shots/`（阶段 18–25 的分阶段验收截图）。
- **当前状态的界面证据** = `docs/shots/*.png`（顶层 53 张，`tools/ui-shots.sh` 产出）。
