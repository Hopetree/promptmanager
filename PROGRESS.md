# promptmanager 进度（PROGRESS）

> **本文件只保留三样**：当前状态表 · 阶段索引表 · 归档指引。
> **完整过程记录（每条 AC 的命令、原样输出、逐张识图、决策与踩坑留痕）已归档到
> [`docs/dev-history/PROGRESS.md`](docs/dev-history/PROGRESS.md)**（阶段 1 – 阶段 25）。
> 归档是**移动**，内容一字未删；归档动作见「上线准备 P1」提交。

| 项 | 值 |
| --- | --- |
| 阶段 | **阶段 1–25 已全部完成**；即将发布 **v1.0.0** |
| 状态 | 等 host_manger 最终验收（逐阶段验收记录见 `VERIFY.md`）；**上线准备 P1（文档整理 + 产物清理）✅**、**P2（质量检查 + 版本管理 + flaky 修复）✅** |
| 版本 | **`1.0.0`**（首个正式版；`package.json` 单一来源，`/healthz` 同源） |
| 最后更新 | 2026-09-20 |
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

## 归档与当前状态的关系

- **根目录 `PROGRESS.md`（本文件）** = 当前状态 + 阶段索引 —— 给"想快速了解项目现在到哪了"的人看。
- **`docs/dev-history/PROGRESS.md`** = 完整过程记录 —— 给"要复核某条 AC 怎么验的"人看（验收凭据）。
- 其它开发过程档案同在 `docs/dev-history/`：`QUESTIONS-history.md`（历史问答）、`design/`（阶段 10A 三套设计打样）、
  `shots/`（阶段 18–25 的分阶段验收截图）。
- **当前状态的界面证据** = `docs/shots/*.png`（顶层 53 张，`tools/ui-shots.sh` 产出）。
