# 更新日志（CHANGELOG）

> 本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构与
> [语义化版本](https://semver.org/lang/zh-CN/) 的编号规则；
> 版本管理细则（何时升哪一位、tag 约定、发版流程、`schema_version` 与项目版本的关系）见 [`docs/versioning.md`](docs/versioning.md)。

## [未发布]

- （无）

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
