# 更新日志（CHANGELOG）

> 本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构与
> [语义化版本](https://semver.org/lang/zh-CN/) 的编号规则；
> 版本管理细则（何时升哪一位、tag 约定、发版流程、`schema_version` 与项目版本的关系）见 [`docs/versioning.md`](docs/versioning.md)。

## [未发布]

- （无）

## [1.2.0] — 2026-09-22

**功能版**：**令牌权限两档（只读 / 读写，只作用于资源）** + **令牌权限可改** + **取用归因**；
另修一个"编辑保存后返回详情看不到新版本"的问题。tag `v1.2.0`（阶段 41–43）。

### 新增（Added）

- **令牌权限两档（只读 / 读写）**：新增 `api_tokens.scope`（**只作用于资源**）——
  **只读**令牌可搜索 / 查看 / 渲染；**读写**令牌才能新建 / 修改 / 删除提示词、文件夹与标签。
  权限不足返回 **403 `insufficient_scope`**。**新建令牌默认"只读"**（最小权限）；**存量令牌一律保持"读写"**（迁移不降权）。
- **令牌管理与账号操作一律"仅会话"**：`GET/POST/DELETE /api/tokens*`、`PATCH /api/tokens/:id`、`POST /api/password`、`POST /api/logout`
  用令牌调用一律 **403 `session_required`** ⇒ 令牌**不能自我繁殖、不能互相撤销、不能改口令**（此前这些用令牌都能调）。
- **可以修改已有令牌的权限**：`PATCH /api/tokens/:id`（只收 `scope`；**仅会话**；有效令牌**立即生效**、已撤销 → **409 `token_revoked`**、不存在 → 404）。
  界面里**点「状态」列的权限文本即可切换**（**不用重建令牌**）；CLI 新增 `pm token set-scope <id> <read|write>`。
- **取用归因**：`usage_events.token_id` —— 令牌取用记该令牌 id、会话取用记 `NULL`；`GET /api/usage/summary` 增加 **`by_token`** 聚合。
- **MCP 远程接入**（`POST /mcp`）沿用同一套权限：**只读令牌即可使用全部三个只读工具**（`prompt_search` / `prompt_get` / `prompt_render`）。

### 变更（Changed）

- **令牌列表**：「状态」列显示 `有效 · 只读` / `有效 · 读写`（**不新增列**，保持 6 列布局）。
- 令牌说明文案更新：写明"只读 / 读写"的能力差异与"权限可在界面切换"。

### 修复（Fixed）

- **编辑保存后返回详情，版本历史即时刷新**：此前要**刷新页面**才出现新版本 —— 根因是版本面板的刷新信号**只在"回滚"时**触发；
  现改为以 `prompt.version_no` 变化为刷新信号（覆盖"保存后回详情 / 回滚 / 移动端重拉"三条路径，且无关操作不触发多余请求）。
- **版本表改为最新在最上**：接口按版本号**升序**返回，此前新版本被压在最下面（观感上"看不到新版本"）；现只翻转表格显示顺序，
  内部仍保持升序供「对比版本」（旧→新）与「详情默认选最新」使用。

### 迁移与注意

- 迁移 **005**：`api_tokens` 加 `scope`（**存量一律置 `write`**）、`usage_events` 加 `token_id` ⇒ `ok: schema at v5`。
- ⚠️ **新建令牌默认只读**：脚本类用途（要写入）请在创建时选/传 **读写**，否则写操作会 403。
- ⚠️ 权限**建后可在界面改**（有效令牌）；已撤销的令牌权限无意义（改会 409）。

## [1.1.1] — 2026-09-22

**修复版**：用 CLI 创建的 token 现在也会加密保存（界面可见值、`pm token reveal` 可用）。无接口/数据模型变化。

### 修复（Fixed）

- **用 CLI 创建的 token 现在也有加密密文**（`pm.mjs token create` / `pm token create --name …`）：
  此前 CLI 路径漏传了加密器，导致这类 token 在界面上 **Token 列显示 `—`**、`pm token reveal <id>` 报
  **`token_not_revealable`** —— 即"随时查看/复制"对 CLI 建的 token 不生效（而 CLI 正是文档里的引导路径）。
  现在 CLI 与界面（HTTP 接口）**行为一致**：新建即可查看/复制。
  密钥不可用时（`TOKEN_ENC_KEY` 写错或密钥文件读不到）**创建仍然成功**，只是那条 token 之后看不了，并在 stderr 给出提示。
  ⚠️ **修复前用 CLI 建的 token 没有保存密文，无法回填/恢复**——需要看值请**撤销后重建**
  （撤销行仍可查看与复制：撤销 = 立即失效，不是销毁）。

## [1.1.0] — 2026-09-22

**功能版**：**MCP 远程接入**（Streamable HTTP）+ **API Token 可随时查看/复制**（加密存储），
外加令牌管理界面重排、移动端两处体验修正与一个内网 HTTP 下的复制修复。tag `v1.1.0`（阶段 34–39）。

### 新增（Added）

- **MCP 远程接入（Streamable HTTP）**：新增 **`POST /mcp`**（顶层路径、**无状态**、**Bearer 鉴权**、**请求 token 透传**给内部 API 调用），
  与既有 **stdio** 入口（`bin/pm-mcp.mjs`）**共用同一份工具实现**；AI 客户端只填 **URL + `Authorization` 头**即可远程接入，
  **不需要在客户端机器上放任何副本或启动器**。
- **API Token 可随时查看/复制**：明文以 **AES-256-GCM 加密**落库（新列 `token_enc`；**sha256 仍保留用于鉴权** ⇒ 密钥丢失也不影响使用）；
  `POST /api/tokens/:id/reveal`（**只允许浏览器会话**）取明文；界面令牌列表可直接**「复制」**（点击**同步**写剪贴板，不发请求）。
- **撤销后的 token 仍可查看与复制**：**撤销 = 立即失效，不是销毁** —— 撤销行的 Token 列继续显示脱敏值、并保留「复制」
  （用于核对"这个已撤销的凭据还在哪里被用着"）。
- **删除已撤销的 token**：`DELETE /api/tokens/:id/permanent`（**仅限已撤销行**；真删行，审计一并消失）—— 与"撤销"两步分离，避免误删活动凭据。
- **密钥来源**：`TOKEN_ENC_KEY`（32 字节 hex）**环境变量优先**；未提供时自动生成并落 `<DATA_DIR>/token-enc.key`（600）。

### 变更（Changed）

- **令牌管理界面重排**：固定 **6 列**（**名称 / Token / 状态 / 使用 / 最近使用 / 操作**）；名称超过 **20 字符**以省略号截断（悬停 `title` 看全名）、
  **Token 脱敏显示 `前 5 + ... + 后 4`**；抽屉宽度收窄到 **640** 且**不再需要横向滚动**。
- **README 重写为"给人看的"用户文档**（249 行，原 492）：部署方式分 **Docker** 与 **源码运行** 两条；
  开发者文档与接口参考分别迁到 **`docs/development.md`** 与 **`docs/api.md`**（`AGENTS.md` 保持英文、只加指引）。
- **移动端体验**：分栏视图的提示词列表**撑满宽度**（原先右侧空 82px）；视图档位在手机上按 **卡片 / 表格 / 分栏** 排列、
  **默认落在卡片**（桌面顺序与默认值不变）。

### 修复（Fixed）

- **内网 HTTP 下 token「复制」不进剪贴板**（真实环境 `http://<内网IP>:8767`；`navigator.clipboard` 在非安全上下文不存在）：
  改为**抽屉打开时预取明文 + 点击时同步写剪贴板**（兜底改用 Selection API 复制文档选区，不受抽屉焦点陷阱影响），**点击不再触发任何请求**。
- **创建 token 后不再弹出"只显示一次"的明文弹窗**（值可随时复制）。
- 复制失败的提示文案改为指向**真实存在**的操作（不再指向已移除的按钮）。

### 迁移与注意

- 数据库迁移 **004**：`api_tokens` 新增 `token_enc` 列（幂等）⇒ `ok: schema at v4`。
- ⚠️ **升级前已存在的 token 无法查看明文**（当时只存了 sha256）—— 列表里显示 `—`；需要"能看到值"的话，**撤销后重建**一个即可。
- ⚠️ **`TOKEN_ENC_KEY` 一旦用于加密就不要更换**：换钥匙会导致既有密文解不开（列表仍可用、只是看不了）。

## [1.0.2] — 2026-09-21

**发布版**：新增**容器镜像发布**（GitHub Actions 构建并推送到 Docker Hub）。**运行时行为与 `1.0.1` 完全一致**
（无代码、接口、数据模型变化；本版本的作用是让镜像有一个可引用的版本号，并让 `latest` 指向当前稳定版）。

### 新增（Added）

- **镜像发布流水线**：新增 `.github/workflows/docker.yml` —— 推 `v*` tag 时构建 `linux/amd64` 镜像并推送到 Docker Hub
  （产出 `<semver>` + `<major.minor>` + `latest` 三个 tag）；`main` 分支推送**只构建、不推送**（尽早发现 Dockerfile 被改坏）；
  也支持手动 `workflow_dispatch`。凭据**只**从 GitHub Secrets 取（`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`），
  任何 step 都不回显 secret；镜像名**不硬编码**命名空间。与质量检查 `ci.yml` 相互独立。
- **文档**：`README.md` 增「从镜像运行」（`docker pull` + `docker run` + 首次设口令 + 自检，含 `TRUST_PROXY`/`PUBLIC_ORIGIN` 的使用条件）；
  `deploy/container.md` 增「镜像发布（Docker Hub）」（触发方式、tag 规则、需要配置哪两个 secret、失败看哪里）。

## [1.0.1] — 2026-09-21

**修复版**：CI 在干净环境必失败 + 登录页不再暴露账号名、去掉噪音信息。tag `v1.0.1`（阶段 32）。

### 修复（Fixed）

- **CI 在干净环境必失败（GitHub Actions 报红）**：`tools/ci-check.sh` 里 `typecheck:tests` 跑在构建**之前**，
  而测试文件 `import` 的是**构建产物** `../dist/**` ⇒ 干净环境（CI 的 checkout 里没有 `dist/`）得到
  **38 个 `TS2307`**；本地因已有历史 `dist/` 看不出。修法两层：① 步骤重排为
  **① 依赖就绪 → ② 构建 → ③ `typecheck:web` + `typecheck:tests` → ④ 全量测试 → ⑤ 体积预算**（仍是 6 项汇总）；
  ② `typecheck:tests` 自带 `npm run build:server` 前置 ⇒ **裸跑**该脚本也不再撞 38 个 `TS2307`。
  判据：**先删 `dist`** 再跑 `bash tools/ci-check.sh` → rc=0、6 项全绿。

### 变更（Changed）

- **登录页简化（含安全项）**：**去掉表单的默认账号名预填**（原先页面加载即出现账号名，向未认证访客
  **暴露账号名**）与 `placeholder` 里的账号名，用户名框初始为空；并删除四条技术噪音文案
  （`SELF-HOSTED · 单进程单端口` / 副标题 / 「口令由本机 CLI 设置…」/「除 /healthz…未认证一律 401」），
  登录页只留**品牌图形 + `PromptManager` 标题 + 用户名 / 口令 / 登录按钮**。

### 内部

- 新增 10 例单测（CI 步骤顺序 5 例 + 登录页 5 例）；`npm test` **319 → 329**。
- 逐条 AC 与实测输出见 `docs/dev-history/PROGRESS.md` 的阶段 32 小节与根目录 `VERIFY.md`。

## [1.0.0] — 2026-09-20

**首个正式版**：一个进程、一个端口、一个 SQLite 文件，自带浏览器管理后台 + 对外 API + agent（MCP）取用面。
以下按能力类型归并（不含逐阶段流水账；逐条 AC 与实测输出见 `docs/dev-history/PROGRESS.md`）。

### 新增（Added）· 核心

- **Prompt 管理**：标题 / 用户提示词 / 系统提示词 / 备注 / 文件夹 / 标签 / 收藏；增删改查 + 列表筛选分页。
- **中文全文检索**：FTS5 `trigram`（≥3 码点，bm25 相关性）+ `<3` 码点 `LIKE` 兜底；查询按字面短语处理，
  特殊字符（`"` `*` `-` `%` `(` `_` …）不报错（方案与 2000 条规模实测见 `docs/search-zh.md`）。
- **版本历史**：每次保存自动留档；版本列表 + unified diff（红删绿增）+ 回滚（生成新版本，历史永不删）。
- **模板变量**：`{{变量名}}`（支持中文、`\{{转义}}`）提取 + 填值渲染（渲染不写库）+ 缺失变量提示。
- **Markdown 预览**：服务端渲染（`marked` → `highlight.js` → `DOMPurify` 净化 + 高亮），前端不重写。
- **导入 / 导出**：全量 JSON（`{app,schema_version,exported_at,folders,tags,prompts}`），`replace` 二次确认、
  `merge` 复用同名文件夹/标签；校验失败**不动任何数据**、单事务原子写入。
- **认证与安全**：cookie 会话（`pm_sid`，库里只存 sha256）+ **API Token / Bearer** 双通道；
  Argon2id 口令哈希；登录失败限流（按 `username + IP`，达阈值 429 + `Retry-After`）；
  **界面「修改密码」**（保留当前会话、吊销其它会话）；CORS 精确白名单（默认关闭）。
- **使用记录**：记录"取用"（详情 / 渲染 / MCP），列表与搜索不记；`?sort=recent_used`。
- **对外取用面**：使用侧 CLI（`pm get` / `pm render` / `pm token`，纯 HTTP）+ **MCP server**（stdio，三个只读工具）。

### 新增（Added）· 浏览器管理后台（Ant Design 组件库）

- **三档视图**：**分栏（默认）** / 表格 / 卡片；移动端响应式降级（左栏进抽屉、卡片列表）。
- **拖拽排序**：卡片 · 分栏中栏 · 表格行 · 文件夹树**同层级重排**（`@dnd-kit`），
  拖后自动切「**自定义**」排序档并持久化；后端**槽位保持**（只在这些条目已占的 `sort_order` 槽位间重排）。
- **详情面**：标题行 + 标题下备注行 + 字段页签（用户/系统提示词、备注；备注按**纯文本**原样显示）+
  预览/源码 + 显示纯文本 + **应用内全屏**；版本面板（diff / 回滚）；变量填值面板。
- **编辑器**：双提示词 + 备注 + 文件夹 + 标签 + 收藏 + 应用内全屏；`＋新建` 只开内存草稿（不落库）。
- **左栏**：文件夹树（增/改名/删 + 筛选**含全部子目录**，与计数同口径 + 拖拽排序）、标签胶囊云。
- **顶栏**：品牌（「>_」图标 + **`PromptM`**）· 新建 · ⋯更多（使用统计 / API 令牌 / 导入导出 / 关于 / **修改密码** / 登出）·
  主题图标三态（跟随系统 / 亮 / 暗）。
- **性能**：重组件懒加载（10 处 `React.lazy`）+ vendor 分包；构建无 `>500KB` 告警（最大 chunk 456 kB，gzip 136 kB）。

### 新增（Added）· 运维

- **部署**：单进程单端口；systemd unit + env 模板 + 反代样例 + 安装/验证/回滚说明（`deploy/`）；
  内网直连与公网反代（HTTPS 终结）两种形态；`/healthz` 无需认证。
- **数据**：SQLite 单文件（WAL）+ 幂等迁移；备份 = 拷文件。
- **CLI 运维**：`pm migrate` / `pm user set-password` / `pm export`。

### 工程（Engineering）

- TypeScript strict + ESM（Node 24）；kysely + better-sqlite3；React 19 + antd 6 + Vite。
- **测试**：`node:test`，52 个测试文件 / **285 个用例**（含接口、迁移、前端源码级断言）。
- **验收自检**：`tools/ac-stage*.sh` 逐阶段可复跑（AC-1 … AC-76，含真鼠标与真实像素断言）。
- **代码质量检查**：`.github/workflows/ci.yml` + `tools/ci-check.sh`（**本地与 CI 同一套**：类型检查 → 全量测试 →
  构建 → 体积预算 ≤500KB）。
- **依赖治理**：全部 pin 精确版本 + 登记 `docs/dependencies.md`（协议 + OSV 逐包查询）。

[未发布]: https://example.invalid/promptmanager/compare/v1.0.0...HEAD
[1.0.0]: https://example.invalid/promptmanager/releases/tag/v1.0.0
