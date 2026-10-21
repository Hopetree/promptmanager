# 更新日志（CHANGELOG）

> 本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构与
> [语义化版本](https://semver.org/lang/zh-CN/) 的编号规则；
> 版本管理细则（何时升哪一位、tag 约定、发版流程、`schema_version` 与项目版本的关系）见 [`docs/versioning.md`](docs/versioning.md)。

## [未发布]

### 变更（Changed）

- **依赖升级（阶段 75，落地 5 个 Dependabot PR）**：`marked` 18.0.14 → **18.1.0**（minor，Markdown 渲染器）、
  `zod` 4.6.5 → 4.6.6、`@fastify/cookie` 11.1.2 → 11.1.3、`@fastify/static` 10.1.5 → 10.1.6、
  `@vitejs/plugin-react` 6.1.1 → 6.1.2、`oxlint` 1.86.0 → 1.87.0、`vite` 8.3.2 → 8.3.4。
  台账三处同步（`docs/dependencies.md` §2.1/§2.2 表格、§4.6/§4.11 正文内联、§5④ **按新版本重跑**的 OSV 表：32 个
  直接依赖 `osv_vulns=0`）；`.github/dependabot.yml` 增加**生产依赖分组**，减少以后逐包 PR 的往返
  （CI 的「台账逐字相等」门禁仍是最终闸门）。**零代码改动、零迁移**。

## [1.8.0] — 2026-10-13

**正式版**：`1.8.0` 线的首个正式版，**包含 `1.8.0-beta.1` ~ `1.8.0-beta.3` 的全部内容**（各预发布段的明细见下）。本段记录的是**最后一个 beta 之后**的改动。

**1.8.0 线要点**：两轮设计评审（`F1–F24` + `N1–N41`）逐条整改收口 · 远程数据同步 · 变量语法单一实现与前端结构拆分 · 鉴权分类同源 · 迁移内容校验与体积记账 · **复制源码**（模板原文）· `/api` 命名空间 fail-closed 加固 · **迁移 009 + 010**（schema 8 → 10，向后兼容）。

### 新增（Added）

- **复制源码（模板原文）**（FR-165 / AC-136，阶段 74）：详情页**正文区工具行**与编辑器字段标题旁
  各新增一个「复制源码」入口 —— 复制的是**当前字段的模板原文**（`{{变量}}` 原样保留），
  与「复制提示词」**位置不同、等级更低**（`type="text"` 次要形态）。
  它是**纯本地动作**：不发任何请求、**不计入 `use_count`**（"搬运模板"不等于"使用提示词"）。
  含变量的提示词因此终于能拿到带 `{{变量}}` 的原文（此前「复制提示词」只会给渲染结果）。
  编辑器原来的字段复制是无文字图标按钮，现在带可见文字（只改可发现性，语义不变）。
  列表 / 卡片**不加**这个入口。

### 修复（Fixed）

- **离开编辑器的两条快捷键漏了未保存保护**（第三轮项目审视 M1，阶段 71 返工②）：
  编辑器里有未保存改动、**焦点不在输入框**时按 `Ctrl/Cmd+K` 或 `/` ⇒ 编辑器**直接消失**、
  没有「放弃未保存的修改？」确认、正文不可恢复（`editingId` 仍非空 ⇒ 列表停在半编辑态）。
  现在这两条路径与「返回列表 / 返回详情 / Esc」走**同一道闸门**（`leaveEditorThen`）。
  常驻测试 `tests/render/keyboard-shortcuts.test.ts`（修复前 5 条红、修复后 6 条绿）。
- **分栏视图 `↑↓` / `Enter` 取的不是界面显示的那条**（第三轮项目审视 M2，阶段 71 返工②）：
  分栏的高亮与右栏取自 `selectedId`，而 `↑↓` 只改 `activeIndex`、`Enter` 取 `list[activeIndex]`
  ⇒ 点第 2 条后按 Enter 复制到的是**看不见的第 1 条**，并给第 1 条记一次**假取用**
  （违反「取用 = 真实使用」）；`↑↓` 按了也没有任何可见反馈。
  现在 `↑↓` 与高亮**同源**（分栏同步 `selectedId`），`Enter` 复制**界面显示的那条**
  （分栏跟 `selectedId`、表格/卡片跟 `activeIndex`）。
  端到端对账 `tools/acceptance/ac-stage71-rework2.sh`：接口层 `use_count` 被复制那条 +1、另一条仍 0。
- 同一轮把两处**过弱的源码级断言**钉紧（`tests/stage21-detail-notes.test.ts` /
  `tests/stage22-split-item.test.ts`：原来只查"出现过某段代码"，现在查它在正确的**子位置**上），
  并把 `tests/render/**` 的文件数 / 用例数下界从 15 / 53 抬到 **17 / 64**。

## [1.8.0-beta.3] — 2026-10-13

**预发布（beta）**：设计评审 F1–F24 的逐条整改收尾（阶段 63–70）。**含迁移 009 / 010（schema 8 → 10）**。

### 变更（Changed）

- **变量语法单一实现**（FR-147 / AC-132 A，阶段 70）：
  - 占位符正则与 `default(...)` 解析原本在 `src/services/variables.ts` 与前端变量模块
    各写一份（逐字相同的两份字面量，靠人肉同步）—— 现在**只有一处**：新增
    **`src/variable-syntax.ts`**（前后端共用的纯函数模块，**零 import**，能被 Vite 打进前端），
    导出 `PLACEHOLDER` / `parseDefaultText` / `scanVariableTexts` / `renderVariableText`。
    服务端 `src/services/variables.ts` 成为门面（对外 API 一字未变），前端 `web/src/vars.ts`
    改为引用共享模块。
  - **「预览 = 剪贴板」由结构保证**：前端 `previewRender` 直接调用与服务端同一个
    `renderVariableText`，不再各写一份渲染循环。
  - 可机械验证：全仓恰一处正则字面量定义（`tests/stage70-variable-syntax.test.ts` 的 A1/A2
    扫描 `src/**` 与 `web/src/**`），条列表变量数与 `GET /api/prompts/:id/variables` 对
    「含变量 / 不含变量 / 含默认值」三条样本逐条一致（A3），语法行为五例不回归（A5）。
  - **语法语义一个字都没改**（`{{ 名字 | default(x) }}`、`\{{…}}` 转义、"没填=用默认值 /
    显式空串渲染成空 / 不认识的写法按字面"全部原样）；parity 测试仍在且全绿。
  - 实现细节：前端跨根引用共享模块用 `../../src/variable-syntax.ts`（Node 类型擦除与 Vite 都能解析），
    因此 `web/tsconfig.json` 增加 `allowImportingTsExtensions`；前端纯逻辑由 589 行的单文件
    拆成 9 个按关注点划分的模块（见下文 FR-148）。
  - `tests/stage60-variable-defaults.test.ts` 的 AC-122 ⑭ 按新规格**加强**改写：原来是"两份字面量
    逐字一致"，现在是"**根本不允许有第二份**，两侧都必须引用共享模块"。

- **鉴权分类与路由注册同源 + 机械检查**（FR-149 / AC-132 C，阶段 70）：
  - 分类判定**只有一处入口** `classifyApiRequest(method, path)`（`src/server/auth.ts`），认证闸门的
    `onRequest` 调它，不再自己手写路径判断。
  - 新增 `declaredCategory(method, path)`：回答"这个路由被四张声明表**明确**覆盖了吗"（未覆盖 ⇒ `null`）——
    它与 `classifyApiRequest` 用同一套表、同一分支顺序，二者的一致性由 `tests/stage70-auth-classification.test.ts`
    的 C10 逐条比对钉住（41 条路由全部 `declaredCategory === classifyApiRequest`）。
    `registerAuthGate` 用 `onRoute` 收集所有 `/api/*` 路由、在 `onReady` 断言**每个都被四张声明表覆盖** ——
    新开一个没被任何表覆盖的 `/api/*` 命名空间，服务**起不来**并点名 `METHOD /path`（改前：分类表与
    注册表两处人肉同步，新端点悄悄落进 fail-closed 兜底，没人分得清"故意要 write"还是"忘了声明"）。
    ⚠️ 三张表是**前缀**表，所以已声明命名空间下的**新子路径**（如 `GET /api/prompts/admin-dump`）会被该
    命名空间覆盖、不触发红；这道检查盯的是「新命名空间」，比改前更严（改前连新命名空间都不拦）。
    提交 `4b2d6c4` 标题里"每个 /api 路由必须显式声明"是**过宽**的说法，以本段为准（提交信息不改写历史，
    更正记录见 `tmp/dev-process/PROGRESS.md` §9.14）。
  - 实测：收集 **41** 条 `/api/*` 路由、未声明 **0** 条；`addHook('onRoute'|'onReady')` +
    分类 API 的出现次数 **0 → 10**；裸 Fastify 注册 `GET /api/undeclared-probe` ⇒
    `认证分类缺失（FR-149 / AC-132 C10）：GET /api/undeclared-probe`。
  - **兜底一点没动**：`classifyApiRequest` 最后一条仍是 fail-closed 的 `resource_write`，鉴权语义
    （401 / `session_required` / `insufficient_scope`）逐条实测未变；权限矩阵四类在
    `tests/stage70-auth-classification.test.ts` 里真发请求逐条钉住。
  - `/mcp` 不在 `/api/*` 闸门内这一条写进 `docs/traps.md` 第 20 节：它自己做 Bearer 鉴权，
    401 响应体与 `/api/*` **同形**（`{"error":"unauthorized"}`），差异只有"不收 cookie / 无状态"。
  - 读档 POST 白名单改为同时认数字 id 与路由模式 `:id`（机械检查看到的是 `:id`）——
    否则 `POST /api/prompts/:id/render` 会被误判成资源写。

- **CLI 两条通道显式分层**（FR-150 / AC-132 D，阶段 70）：
  - `src/server/cli.ts` 原本两条通道（直连 SQLite 的 `openCliDatabase()` 与走 HTTP 的
    `apiRequest()`）的**决策散在各命令实现里**：`token()` 判 `api.explicit`、`get`/`render`
    各自 `requireApiToken()`。现在通道由一张**显式声明表** `COMMAND_TRANSPORTS` 定死
    （`migrate` / `user` / `export` = `local-db`，`get` / `render` = `http`，`token` = `dual`），
    **决策点只有一处** `resolveTransport(command, api)`：`local-db` / `http` 命令忽略环境，
    只有 `dual` 按 `PM_API_URL` 是否显式设置定型。
  - **为什么不是"并成一条"**：`migrate` / `user set-password` 必须在服务启动**之前**能跑
    （建库、引导口令）、`export` 是本地备份（服务器挂着也要能导出）、`token reveal`/`set-scope`
    的 HTTP 面刻意只允许浏览器 cookie 会话 —— 硬并成一条会砍掉这些能力（AC-132 D16 要求保留）。
    完整理由写进 `docs/traps.md` 第 21 节。
  - **机械检查**（`tests/stage70-cli-transport.test.ts`）：声明表的键集合必须等于 `runCli` 的
    `switch` 集合；`local-db` 命令体不许出现 `apiRequest(`、`http` 命令体不许出现
    `openCliDatabase(`（按顶层函数机械切片）。
  - **CLI 行为逐条不变**（真跑）：`migrate` → `ok: schema at v10`、`user set-password` →
    `ok: user admin password updated`、`token create/list/revoke`、`export` → `ok: exported …`、
    `get` / `render` 经 HTTP；没有服务时 `migrate` / `export` 照常可用。
  - ⚠️ **已知矛盾（只记录、不改行为）**：`/api/tokens*` 自 FR-105 起是 session-only ⇒ CLI 的
    HTTP token 通道事实上不可用（用令牌调一律 `403 session_required`，退出码 1），真正可用的是
    本机管理路径；改它要动退出码或放松会话要求，都超出"结构改造"的范围。
  - 接口 / 命令名 / 参数 / 输出格式 / 退出码一个字都没改；**零新增依赖**。

- **前端纯逻辑按关注点拆分**（FR-148 / AC-132 B，阶段 70）：
  - 原来的前端纯逻辑入口是**一个 589 行 / 49 个 export** 的文件，混装十类关注点（列表查询串、文件夹树、
    导出文件解析、diff 分类、时间与摘要、变量、变量记忆、视图档位、令牌显示、提示文案）。现在按关注点
    拆成 **9 个模块**，每个模块职责单一：
    `list-query`(2) / `folders-util`(5) / `import-file`(7) / `diff-lines`(3) / `format`(4) /
    `vars`(16) / `view-mode`(4) / `token-display`(5) / `notices`(3)，export 总数仍是 49。
  - **纯搬迁**：函数体一行未改，调用方只改 import 路径（13 个前端文件 + 14 个测试文件）。
    唯一的内容级调整是 `tests/stage60-variable-defaults.test.ts` 的 AC-122 ⑭（属 FR-147，见上）。
  - 5 处**读源码**的断言按新位置改路径、断言本身逐字保留（`import-file.ts` 的导出契约与错误文案、
    `vars.ts` 的 `missingVariables`、`list-query.ts` 的 `sort=custom`、`format.ts` 的 `orderPrompts` 签名）。
  - 体积：9 个模块比单文件多 **60 B** gzip（模块边界），已按 FR-146 的口径记进
    `tests/bundle-budget.json`（`node tools/bundle-budget.mjs --record 70`）。

- **机械记账三项**（FR-144 ~ FR-146 / D-67，阶段 69）：
  - **迁移有了内容校验**（FR-144）：新增迁移 **`010_migration-checksums.sql`** 给 `schema_migrations`
    加 `checksum` 列（`ALTER TABLE ... ADD COLUMN`，**不改已应用的 `001`–`009`**）。运行器
    （`src/db/migrate.ts`）在应用前逐个校验：**已应用的迁移被改动一个字节** ⇒ 抛
    `已应用的迁移文件被改动过：<file>`；**被改名** ⇒ 抛"文件名与记录不符"；**文件名不符合
    `NNN_*.sql`** ⇒ 抛错并点名（改前是**静默跳过**）。存量库（升级前没有 checksum）**首次见到时补记**，
    所以老库照常启动。checksum 对**文件原始字节**取（含注释与换行），口径有测试钉住。
  - **「加一个迁移」的机械成本 11 → 1**（FR-145）：schema 版本与迁移数改成**一处绊线，其余派生** ——
    唯一手写的数字是 `tests/migrations.ts` 的 `CURRENT_SCHEMA_VERSION`，其余从 `migrations/` 目录读；
    改前有 11 个测试文件写死版本号 / 迁移数 / 完整清单。**绊线仍在**（删掉一个迁移文件、或改大版本号，
    测试都会红 —— 双向验证过）。
  - **体积预算有下界、账本改为工具生成**（FR-146）：预算从「`BASELINE_TOTAL_GZIP` + 20 个手工累加的
    `ACCOUNTED_DELTA` 常量」搬到 `tests/bundle-budget.json`（由 `node tools/bundle-budget.mjs --record`
    按**实测值**写入，delta 可为负 ⇒ 体积下降会回收预算），判定是纯函数
    `evaluateBundleBudget`，**上界与下界都查**（低于预算 95% ⇒ 提示账本该回收）。测试标题里的阶段清单
    也从账本派生（改前标题与常量已对不上）。
  - **接口 / 导出格式 / DB 行为未变**（只是新增一列校验列）、**零新增依赖**；`500 KB` 体积红线
    **一个字都没动**；测试文件数 **94 → 96**、用例数 **639 → 653**（schema 9 → **10**）。
  - **返工 ①**（独立对抗性复核）：① 补上**删除已应用迁移**的检测 —— 记录里有、目录里没有 ⇒ 明确报错
    （改前静默放过；只查"目录最大版本号以内"的洞，库比代码新的降级场景不拦）；
    ② 大写扩展名 `011_x.SQL` 从"静默跳过"改成**报错点名**（扩展名判定改为大小写不敏感）；
    ③ 复核确认的**残余局限**写进 `docs/traps.md` §19.1 与 `docs/development.md` §7.1：存量库首次升级时
    补记的是"当前文件"的 hash，升级**之前**就被篡改的迁移会被补记洗白 —— 补记只是把老库拉进受校验状态，
    不追溯升级前的改动；
    ④ `tests/stage60-variable-defaults.test.ts` 里一条**恒真**断言（拿"读目录的结果"与"同一份读目录的结果"
    比）改成对唯一手写的 `CURRENT_SCHEMA_VERSION` 断言；
    ⑤ `tools/bundle-budget.mjs --record` 加**缩水护栏**：一次记账把预算压掉超过 5% 会被拒绝（要 `--force`），
    防止对着半成品构建记账把预算永久压扁。

- **性能与本地残留四项**（FR-140 ~ FR-143 / D-66，阶段 68）：
  - **FTS 触发器只在内容真的变了时才重建索引**（FR-140）：`prompts` 的 `AFTER UPDATE` 触发器原先没有
    `WHEN`，改收藏 / 拖拽排序 / 切「记住变量值」/ 移动目录都会重建整行全文索引。新增迁移
    **`009_fts-update-when.sql`**（`DROP TRIGGER IF EXISTS` + 重建带 `WHEN old.X IS NOT new.X` 的版本，
    **不改已应用的 `001_init.sql`**，幂等）。可观测口径 = `total_changes()`：改非索引列 **1** 行、
    改内容列 **9** 行（对照：装回旧触发器后改收藏也变 **9**）。schema 8 → **9**。
  - **侧栏目录计数不再 N+1**（FR-141）：`GET /api/prompts` 新增可选参数 `include=folder_counts`，
    一次请求带回全部目录的**子树计数**（与 `?folder_id=X` 的 `total` 同口径）。单次刷新的请求数
    **目录数 + 1 → 1**（实测 4 → 1），数字与改前逐个相同；计数失败 ⇒ `folder_counts: null` 且列表仍 `200`。
  - **Token 抽屉不再反复全量预取明文**（FR-142）：明文只补缓存里没有的行 ⇒ 打开 / 创建 / 撤销的
    `reveal` 累计次数 **3 / 7 / 11 → 3 / 4 / 4**（列表请求 1 / 2 / 3 不变）。明文仍**只留内存**
    （不写 Web Storage、不落库、不进日志），`revealable === false` 仍显示 `—`、已撤销行仍预取明文。
  - **关掉「记住变量值」清掉本地残留**（FR-143）：编辑页保存与填值弹窗取消勾选**两条入口**都删除
    `localStorage` 的 `pm-vars:<id>`；保持"记住"时不得误删。
  - **接口只加不改**（`folder_counts` 是新可选字段，不传则响应逐字不变）、导出 / 导入格式未变、
    **零新增依赖**；测试文件数 **92 → 94**、用例数 **633 → 639**（另加 `tests/render/` 渲染级
    3 个文件 / 12 条，渲染级总数 14 → 26）。
  - **返工 ①**（独立对抗性复核 `sound` 后的收口）：给 Token 抽屉加**会话代号**闸门 —— 关闭（或重开）
    抽屉会让在途的预取作废，避免"关掉之后明文又被写回内存"的既有竞态（明文始终只留内存，但仍应
    在关闭时真正丢弃）；配一条渲染级用例（关闭时卡住 reveal ⇒ 重开必须重新取明文）。

- **测试断言从「源码文本」转向「行为」**（FR-139 / D-65，阶段 67）：新增统一入口
  `tests/source-text.ts`（读源码并**剥注释**），测试里的 `readFileSync` 调用点从 **56 个文件 / 172 行**
  降到 **0 / 0**（此后新增用例一律走 `tests/source-text.ts` 这个入口；确需未剥注释文本时用 `readRaw` 并写明理由）；锁死「书写形式 / 文本位置」的断言改成**渲染级**断言
  （新增 `tests/render/stage67-render-behavior.test.ts`，渲染级用例 **7 → 14**）；
  `tests/web-ui.test.ts` 的 `assertSomewhere()`（任意文件命中即过）改成**指名文件**断言。
  **产品代码零改动**（`src/` 与 `web/src/` 未动）、接口 / 导出格式 / DB schema 未变、**零迁移**、
  **零新增依赖**。属纯测试重构 ⇒ 按 [`docs/versioning.md`](docs/versioning.md) §1 为 **PATCH 级**，
  并入尚未正式发布的 `1.8.0`。
  - **返工 ①（独立对抗性复核的产物）**：修掉 `tests/source-text.ts` 的三处剥注释缺陷，并新增守卫用例
    `tests/stage67-source-text.test.ts`（9 条）—— ① JSX 外壳只认**紧贴**的 `{/*`（对象字面量里的
    `{\n  /** JSDoc */` 与 `catch { /* 隐私模式忽略 */ }` 的开括号不再被误擦）；② SQL 只在**引号外**
    识别 `--` / `/* */`（`'read'` / `'view'` 这类字面量不再被当注释吃掉）；③ YAML / shell 的**行内** `#`
    注释也剥（引号内的 `#` 与 `${VAR#x}` 保留）。守卫用例在旧版剥注释器下 **9 条里 4 条红**。
    测试文件数 **91 → 92**、用例数 **624 → 633**。

- **Prompt 字段集收敛为单一来源**（FR-138 / D-64，阶段 66）：新建 `src/prompt-columns.ts`，把
  「Prompt 有哪些字段、每个字段的 SQL 类型 / 契约类型 / 是否可写 / 是否随导出走 / 算不算内容字段 /
  JSON Schema」写成**一张 `as const` 列清单**，DB 表类型（`PromptsTable`）、服务层实体（`PromptObject`）、
  前端类型（`Prompt` / `PromptWritable`）、导出 / 导入映射、HTTP 校验 schema（create 与 update 合成一份）
  与内容字段分类（`CONTENT_FIELDS`）**全部由它派生**；改前 7 处各自手写的字段表（含版本留档分类）
  不再存在（`src/services/import.ts` 的归一化字面量仍在，但被 `NormalizedPrompt` 类型强制完整，
  不会静默漂移）。
  - **加一个字段要动哪些地方**：**编译器点名 5 个文件**，但真加一个字段今天仍要动 **21 个文件**
    （阶段 61 加 `remember_variables` 时是 27 个）。这 21 个里 13 个是把"迁移数 / schema 版本 /
    导出键集合"写死的**守卫测试**，2 个是文档里的迁移行 —— 收敛**消除的是"静默漂移"**
    （漏改会编译失败，而不是悄悄丢字段），**不是改动面**。完整口径见 `docs/development.md` §7。
  - ⚠️ **界面写路径是唯一没被编译器保护的地方**：`web/src/components/PromptEditor.tsx` 的表单与保存
    payload 仍手写，而 `PromptWritable` 字段全可选 ⇒ 新加**可写**列时界面会静默不发送它；
    已由 `tests/stage66-field-source.test.ts` 的一条用例变成红灯。
  - **接口形状、导出 / 导入文件格式、DB schema、界面行为一律未变**（`docs/api.md` 一字未改）；
    **零迁移**、**零新增依赖**。属纯内部重构 ⇒ 按 [`docs/versioning.md`](docs/versioning.md) §1 为
    **PATCH 级**；因 `1.8.0` 尚未正式发布，并入同一个 `1.8.0`。
  - 唯一可观察差异：导出的 JSON 与 HTTP 响应里**字段键顺序**随派生顺序变化（字段集合与取值逐字段等价，
    键顺序不是契约，仓库内无断言依赖它）。

## [1.8.0-beta.2] — 2026-10-11

**预发布（beta）**：版本号语义收窄为「只记内容变更」—— 非内容字段的更新不再产生新版本。
本改动属**行为契约变更**（[`docs/versioning.md`](docs/versioning.md) §1：字段没变但契约变了 ⇒ MINOR 级）；
因 `1.8.0` **尚未正式发布**，它**并入同一个 `1.8.0`**（不改 MINOR 号）⇒ 本预发布即 `1.8.0-beta.2`。**零迁移**。

### 变更（Changed）

- **版本号只记「内容变更」**（FR-129 / D-60）：`version_no` 与 `updated_at` 从此只在
  **内容字段**（`title` / `user_prompt` / `system_prompt` / `notes`）的值**真的变了**时才动。
  - 收藏 / 取消收藏、移动目录（含批量）、切「记住变量值」、改标签、拖拽排序 ⇒ **不产生新版本、
    不写版本快照、`updated_at` 也不碰**（此前这些都会让 `version_no + 1` 并留一条内容完全相同的快照）。
  - 判据是「值真的变了」，不是「请求里带了这个字段」：`PUT` 传了但值与当前逐字相同 ⇒ 同样不动；`PUT {}` 同理。
  - **回滚**同样按此判据：恢复到与当前不同的内容 ⇒ 照旧 +1；恢复到**完全相同**的内容 ⇒ 不产生新版本。
  - **`updated_at` 语义收窄为「内容最后变更时间」**（不再是"记录被写过的时间"）⇒ 「最近更新」排序不再被
    "点了个收藏"污染。想置顶请用 `favorite`。
  - **存量数据一个字节都不动**：历史遗留的 90 行内容重复版本、3 条顶到 10 版上限的记录**不清理、不重编号**
    （`version_no` 一旦产生绝不重编号）。「每个提示词只留最近 10 版」规则不变。
  - **不改**版本表结构、取用记账口径、导入 / 导出 / 云同步的文件格式与恢复方式。**零迁移**。

### 文档（Documentation）

- `docs/api.md`（`PUT` 的版本 / `updated_at` 语义）、`docs/traps.md` 新增 **§15**（三个坑：`updated_at`
  语义变了 / 判据是"值真的变了" / 内容字段固定 4 个不许顺手加），并把 §14.1 里"切开关会消耗版本历史"
  那条标为**已由 FR-129 修掉**。

## [1.8.0-beta.1] — 2026-10-10

**预发布（beta）**：变量记忆可控 + 填值弹窗一键清空。**含迁移 008**（`prompts` 表新增一列）。

### 新增（Added）

- **变量记忆可控**（FR-127）：每个提示词一个「是否记住变量值」开关。
  - **开关存服务端**（`prompts` 表新增列，**迁移 008**）⇒ 换浏览器 / 换设备一致，且**随导出 / 导入 / 远程同步一起走**。
  - **默认 = 记住** ⇒ 存量提示词与既有行为**一字不变**。
  - **两处入口**：填值弹窗里的勾选框 + 提示词编辑页的开关，**读写同一字段**。
  - **取消勾选即时生效**（不必点「复制结果」）：打开弹窗**不预填**、点复制**不写入**、并把**已存的那批值删掉**。
  - 弹窗标题：记住时沿用「请填写变量值（自动记忆）」；**不记住时去掉「（自动记忆）」**。
- **填值弹窗一键清空**（FR-128）：一次点击清空所有已填变量值 —— 清表单**且删掉该提示词的记忆**（**彻底重置**）。
  - **不做二次确认**；按钮文案明确到「清空」；**所有输入框本来就为空时按钮置灰**。

### 变更（Changed）

- **切开关走 `PUT` ⇒ `version_no + 1`**（与既有 `favorite` 同一行为；用户拍板保持现状，已记 `docs/traps.md` §14.1）。

### 迁移（Migration）

- **`008_remember-variables.sql`**：`ALTER TABLE prompts ADD COLUMN remember_variables INTEGER NOT NULL DEFAULT 1
  CHECK (remember_variables IN (0,1))`。**纯增量**（带默认值 ⇒ 存量行一律填 1），但**迁移执行后 schema 回不到 v7**
  —— 回滚需用部署时取的数据库快照（见 `docs/versioning.md` §3.2）。

### 文档（Documentation）

- `README.md` / `docs/api.md` 补该字段与「不记住」的说明；`docs/traps.md` 新增 **§14**（为什么开关放服务端、
  变量值仍留本地）与 **§14.1**（已知设计后果，非待修 bug）。

- （无）

## [1.7.0] — 2026-10-09

**功能版**：提示词变量支持**默认值**（Jinja 系 `{{ 名字 | default(默认值) }}`）。

### 新增（Added）

- **变量默认值**（FR-126）：`{{ 名字 | default(默认值) }}` —— 填值时**留空就用默认值**，不必每次重打。
  - **只支持 `default` 这一个过滤器**：`{{ x | upper }}`、`{{ x | default }}`（无括号）、`{{ x | Default(y) }}`
    等**不认**的写法一律**按字面文本原样输出** —— 宁可不生效，也不静默给错值（与本项目「不做模板引擎」的口径一致）。
  - 竖线也可写成**转义形式**（反斜杠 + 竖线）—— Markdown 表格单元格里必须这么写。
  - 默认值是**字面文本**（内部 `{{…}}` 不再解析）；两端成对引号会被剥掉（`default('y')` ⇒ `y`）；`default()` = 空串。
  - **接口只加不改**：`GET /api/prompts/:id/variables` 的 `variables` 形状不变（仍是字符串数组），
    **新增平行字段 `defaults`**（只有写了默认值的变量才在里面）；`POST …/render` **请求体不变**
    ⇒ **默认值对 API 调用方透明**。MCP `prompt_get` 顺带带出 `defaults`；CLI `pm render` 不传 `--set` 时用默认值。
  - **零迁移**：默认值只存在于正文文本里（正文是唯一真相源）⇒ 复制 / 导出 / 导入 / 云同步天然带上它。

### 变更（Changed）

- **取默认值的口径是「全篇」的**：同一变量名在 `user_prompt` 与 `system_prompt` 两段默认值不同时，
  取**首次出现**那个、两段一致；`/variables` 报的默认值与 `/render` 实际替换进去的值**保证同一张表**。
- **界面**：有默认值的输入框把默认值显示成**占位提示**并标「可留空」；「还有 N 个没填」**只统计无默认值**的变量。

### 文档（Documentation）

- `docs/api.md` 补变量默认值语法与 `defaults` 字段；`docs/traps.md` 新增**第 13 节**
  （为什么只支持 `default` 一个过滤器、以及竖线在 Markdown 表格里要转义）。

### 文档（Documentation）

- **README 优化缩减（266 → 212 行 / 15233 → 12305 B，-19%）**（用户 2026-09-30 要求）：
  - **删掉「拉取镜像很慢或失败？」整段 FAQ（14 行）与三处指向它的提示**（用户原话：「关于容器拉取的问题，
    这个不应该写到里面」）。这是**对 FR-109 的反转** —— 该需求原要求「README 部署章节与 FAQ 解释镜像站办法」，
    现按用户要求移出（理由：那是**用户自己的网络问题**，不是本项目的交付内容，且让 README 读起来像运维笔记）。
  - ⚠️ **FR-109 被编码进了测试**：`tests/stage46-login-overflow.test.ts` 的 **3 条 AC-110 ⑤ 断言**
    要求 README 讲镜像站办法 —— 移出后它们全红。已把这 3 条**反转**（改为守护「README 不得再出现
    镜像站 / 加速站内容」），而不是删掉：既留住需求历史，也守住新状态。
    保留的正面要求不变：官方镜像地址必须写死在 README 且可直接复制。
  - 约束的落点变化：`AGENTS.md` 里**没有** FR-109 红线（§1 瘦身时 FR 详情已移出）；
    该口径现由 `tests/stage46-login-overflow.test.ts` 的断言守护。
  - **删掉发版内部细节**：原「镜像由 CI 在推正式版 tag 时构建发布 / 预发布只构建不推送」一段
    —— 属于 `docs/versioning.md` 的读者（发版者），不是 README 的读者（使用者）。
  - **删掉硬编码版本号**：`/healthz` 示例里的 `1.5.0` → `<版本号>`（避免每版都要改，且已过期一次）。
  - 删掉 3 处冗余：「其它能力见下方怎么用」的空指针、「看一眼」的截图规格说明（2880×1800 那段）、
    首屏与徽章重复的「MIT 许可 · 镜像 … · Node ≥ 24」一行；「远程数据同步」由 30 行压到 18 行
    （契约细节已在 `docs/api.md` §3.12）；文档索引删掉 3 行（含自我引用的「部署与使用（本文件）」）。
  - 全部 15 个相对链接复核可达；章节结构不变。

### 文档（Documentation）
- **README「看一眼」的截图改为竖排**（用户 2026-09-30 反馈：3 张图横排在三列表格里，每张只剩约 300px 宽、
  看不清界面细节）。截图本身是 **2880×1800（2×）** 出图，竖排后每张吃满内容宽度（GitHub 默认约 880px）
  ⇒ **显示面积约 3 倍**。每张图配一行小标题，并把「全部 8 张见 `docs/shots/`」的指引移到段首。

## [1.6.0] — 2026-09-30

> 本版曾以 `1.6.0-beta.1` 预发布（2026-09-30），预发布段已并入本段；两个 tag 指向的**运行时代码相同**。

### 修复（Fixed）· 依赖台账同步 + 新增台账门禁

- **修掉 dependabot 合并造成的台账过期**（2026-09-30）。`#5 / #8 / #9` 合入后 `package.json` 变成
  vite `8.3.1` / marked `18.0.14` / `@modelcontextprotocol/sdk` `1.30.1`，而 `docs/dependencies.md`
  仍写着旧版本（**9 处**）—— 台账与实际不符，且没有任何东西会发现。
  - 已按项目规矩「**OSV 结论只对表中列出的版本有效**」对三个新版本**重跑 OSV 审计**（均 `osv_vulns=0`，
    结论成立），并更新台账全部 9 处（§2.1/§2.2 表格行、§4.11 小节标题、两段审计列表）。
  - ⚠️ **Python 的 `mcp==1.30.0`**（MCP 冒烟用的官方 Python 客户端）是**另一个包**，未改动。
- **修掉一处 pin 违规**：`oxlint` 被 `npm install` 默认写成 `^1.86.0`（范围而非精确版本），
  违反项目「**pin 精确版本**」的规矩 ⇒ 已改为精确 `1.86.0`。**32 个直接依赖现已 100% 精确 pin。**
- **新增台账一致性门禁**（`tools/ci-check.sh` 步骤 **①c** + 新脚本 `tools/check-deps-ledger.mjs`）：
  断言 `package.json` 的**每个直接依赖**都在 `docs/dependencies.md` 里有版本逐字相符的一行，
  不符即 CI 红灯 —— 把「台账静默过期」变成提交时就报错。质量门 8 项 → **9 项**。

### 变更（Changed）· 仓库瘦身：只保留交付态内容

- **把过程态全部移出仓库**（2026-09-30）。移出的内容**没有删除**，而是搬到**本地** `tmp/dev-process/`
  （镜像本仓库布局；`tmp/` 已 gitignore、可随时整体删除；移出前的完整内容仍在 git 历史里）：
  - 需求合同 `tmp/dev-process/BRIEF.md`、进度日志 `tmp/dev-process/PROGRESS.md`、验收记录 `tmp/dev-process/VERIFY.md`、提问模板 `tmp/dev-process/QUESTIONS.md`；
  - `tmp/dev-process/docs/dev-history/`（早期过程记录 + 设计打样归档）、`tmp/dev-process/docs/brief-changelog.md`、`tmp/dev-process/docs/ui-verification-report.md`；
  - `tmp/dev-process/tools/` 下 **101 个**一次性验收脚本（`ac-stage*.sh` / `*-probe.mjs`）与 `design-compare.mjs`。
  - **`tools/` 现在只剩可复用工具**（质量门禁、界面截图、夹具、检索 PoC、MCP 冒烟、开发数据重置），
    因此 `npm run lint` 的范围从「排除 `tools/`」变成**全仓**（`oxlint .`；169 个文件 **0 告警**）。
- **`AGENTS.md` 瘦身 21%**（43332 → **34082 B**，指令预算占用 **70.6% → 52%**）：
  - §1 从「逐条 FR 详情」压成**红线清单**（契约 / 安全 / 顺序与环境陷阱三类，每条 ≤3 行）；
    被移出的**根因与实测值**进新文档 [`docs/traps.md`](docs/traps.md)。
  - 新增 **§13「本地工作文件」**：说明需求 / 进度 / 验收文件在哪（**不在仓库里**）。
  - §11 文档地图、§5.1 落点规则、§4 结构表按新的仓库形态重写；页头加了「保持简短」的说明。
  - 去掉全部内部痕迹：阶段号、内部角色名、沙箱路径、指向已移出文件的引用。
- **新增文档体积门禁**（`tools/ci-check.sh` 步骤 **⓪**，跑在最前、快速失败）：按**渲染后**字节
  （文件本身 + `Instructions from:` 段头）对照 AI 代理的注入预算 **65536 B** —— **预警 55%（36000 B）、
  红线 61%（40000 B）**。超红线即 CI 红灯，避免"新会话静默丢约束"。
- **新增 [`docs/traps.md`](docs/traps.md)**：12 节，承接所有「为什么代码长这样」的根因与实测值
  （令牌权限、抽屉与 0 宽列、登录页溢出、取用计数、卡片元信息、状态列配色、中文检索、版本上限、
  导入清理顺序、内网剪贴板、沙箱环境、文档落点）。**新规则：红线进 `AGENTS.md`（≤3 行），证据进这里。**
- 顺带：`docs/README.md` 重写（目录索引 + 边界）、`docs/development.md` 删掉整段「验证脚本清单」、
  `deploy/README.md` 里的内部角色名改为「部署方」、**43 个测试文件**里指向已移出脚本的注释改成中性说法。

### 新增（Added）

- **引入静态检查（lint）并挂进质量门**（2026-09-30 体检 P2-15）：
  - 新增 devDependency **`oxlint@1.86.0`**（MIT；Rust 实现，全仓 200+ 文件毫秒级，零配置）与 `npm run lint`，
    已作为 **`tools/ci-check.sh` 的 ①b 步骤**接入（本地与 CI 同一套，质量门 6 项 → **7 项**）。
  - **顺带清掉 30 处既有告警**（`no-unused-vars` × 29、`no-useless-escape` × 1）：删掉未使用的导入与死变量
    （含 `web/src` 里 5 个组件、`src/` 2 个未用类型、`tests/` 一批未用导入）；测试里"**故意创建但不用**"的夹具
    （`neverUsed` / `b` / `tokenB`）**保留调用、只去掉赋值** —— 行为零变化。`src` / `web/src` / `tests` 现为 **0 告警**。

### 修复 / 加固（Fixed · Security）

- **HTTP 层加固**（2026-09-30 项目体检**第三批**，对应报告 P1-1 / P2-2 / P2-8 / P2-9 / P1-2）：

  - **P1-1 补上安全响应头**（此前**一个都没有**）：所有响应现在带 `X-Content-Type-Options: nosniff`、
    `X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin` 与一条 CSP。
    **不引 helmet** —— 用 Fastify 的 `onSend` 钩子几行写完（项目规矩「依赖只减不增」）。
    CSP 取值刻意保守：`script-src 'self'`（构建产物无内联脚本）、`object-src 'none'`、`frame-ancestors 'none'`；
    **`style-src` 保留 `'unsafe-inline'`** —— antd 是 CSS-in-JS，收掉会让整个界面丢样式。
    `Strict-Transport-Security` **只在 `PUBLIC_ORIGIN` 为 `https://` 时**下发（内网 HTTP 加了会把 http 也强制跳 https）。
    **真 chromium 实测：0 条 CSP 违规、0 个页面错误、界面样式完整。**
  - **P2-2 非预期状态码不再一律误标 `unauthorized`**：413 → `payload_too_large`、405 → `method_not_allowed`、
    未枚举的 4xx → `request_error`；**400 / 401 / 404 的既有契约逐字不变**（已加回归断言）。
    实测：认证下 2 MB body → `413 {"error":"payload_too_large"}`（此前是 `unauthorized`）。
  - **P2-8 补全局异常处理器**：`unhandledRejection` / `uncaughtException` 记日志后**优雅关库再退出**
    （此前只注册了 SIGINT/SIGTERM，漏 await 的 promise 会裸崩、上下文丢失）。**不吞异常继续跑** ——
    状态可能已不一致，带病运行比退出更危险。
  - **P2-9 同步子系统四处硬伤**：
    ① `clientFor` 的解密失败（密钥变更 / 密文损坏）此前抛裸 500 ⇒ 现映射为 `500 token_enc_key_unavailable` + 中文可执行提示；
    ② 同步客户端**不跟随重定向**（`redirect: 'error'`）+ 上游响应体读取加 **10 MB 上限**（此前 `response.text()` 无界，被劫持/被重定向的上游可把内存泵满）；
    ③ 快照（`pre-restore-*.json`）与 `pm export --out` 导出文件改按 **0600** 落盘（此前默认 0644，而它们含提示词正文全文；对照 `token-enc.key` 本就是 0600）。
    （报告提的第 ④ 条「默认实例名取自 `Host` 头」经复核**不改**：已有字符白名单，且它只是表单默认值、管理员保存前可见，风险可忽略。）
  - **P1-2 CI 补依赖漏洞扫描**：新增 `npm audit --omit=dev` 步骤（**report-only，不阻断** —— 否则上游冒出一个新 CVE 会卡住所有无关 PR；要收紧去掉 `|| true` 即可）。
    必须显式指定官方 registry，默认的 npmmirror 不实现 audit 端点。
  - **P2-16（部分）CI 去重**：加 `concurrency` 组（同分支 push + PR 只跑最新一次）与 `timeout-minutes: 15`。
  - 新增 **`.github/dependabot.yml`**：npm / docker / github-actions 三生态每周自动开 PR（只开 PR 不自动合并，每个都要过 CI）。

- 新增 **8 条测试**（`tests/http-hardening.test.ts`）：安全头在 HTML/API 两条路径、CSP 取值断言（含"不许出现 `unsafe-inline` 的 script-src"）、
  HSTS 的有/无两态、413 映射、400/401/404 回归、异常处理器源文本断言、上游超大响应与重定向两态。
  **用例总数 489 → 497。**

### 新增（Added）

- **开源社区文件**（2026-09-30 项目体检第二批，纯文档）：

  - **`SECURITY.md`**：私密报告渠道（**GitHub Security Advisories**，不开公开 issue）、支持版本、响应节奏、**范围界定**（哪些算本项目的问题、哪些请自行处理），以及一节「**已知的安全设计**」—— 把 argon2id、令牌只存 sha256、同步令牌 AES-256-GCM、仅会话端点等**有意为之**的设计讲清楚，避免被当成漏洞报上来。
  - **`CONTRIBUTING.md`**：环境要求（Node ≥24 + `engine-strict`）、**质量门**（`rm -rf dist && bash tools/ci-check.sh`）、五条硬规矩（**不改已应用的迁移**、迁移必须幂等、依赖只减不增、`docs/` 只放最终状态、改接口要同步 `api.md`）、commit 规范、PR 与 issue 各要带什么。
  - `README.md`：**加 4 个徽章**（CI / License / Docker Pulls / Node）、**内嵌 3 张截图**（分栏 / 卡片 / 暗色，其余 5 张仍在 `docs/shots/`）、文档索引补 `CONTRIBUTING` / `SECURITY` / `docs/README.md`、新增「**参与**」段。

### 文档（Documentation）

- **一轮「文档与实现对齐」整改**（2026-09-30 项目体检，**纯文档、零代码改动** —— 未碰 `src/`、`web/`、`tests/`、`migrations/`、`package.json`）：

  - `AGENTS.md` / `docs/development.md`：**机器可核对的数字全部对齐实际** —— 版本号 `1.0.2`→**`1.5.0`**；schema 版本 `v6`/`v4`/`v3`→**`v7`**；迁移清单补齐 **005–007**，「新增走 `005_xxx.sql`」→「走**下一个编号**（当前 **008**，以目录最大号为准）」；用例数 `348`/`329`→**`489`**，并**改为"以 CI 输出为准"、不再写死会腐化的数字**；`62 files`→**`82`**；补 sync 子系统进项目结构表。**（原文档照做会创建撞号的迁移文件。）**
  - `docs/api.md`：**补上整个「远程数据同步」章节**（`### 3.12`，5 个 `/api/sync/*` 端点 + 契约要点 + 错误码），原「错误码速查」顺延为 `### 3.13`；环境变量表补 **`SYNC_GITHUB_API_BASE`**；「仅会话可用」的两处清单补 `/api/sync/*`。
  - `CHANGELOG.md` / `docs/versioning.md`：**修正 `[1.5.0]` 条目里我自己写错的数字** —— 端点 `6`→**`5`**（并删掉**不存在的** `GET /api/sync/status`）、配置项 `4`→**`5`**。
  - `docs/dependencies.md`：修掉与 `package.json` **直接冲突**的两处「无 zod / `zod` 已决定不引入」（zod 实为 `@modelcontextprotocol/sdk` 的 peerDependency，只在依赖树里）；§6 去掉停在「阶段 8/9」的陈旧描述。
  - `deploy/promptmanager.env.example`：把**全库零引用的死变量** `ADMIN_PASSWORD` / `SESSION_SECRET` 注释掉并写明原因（避免自架者设了以为生效）。
  - `README.md` / `docker-compose.yml` / `Dockerfile`：陈旧版本串 —— healthz 示例 `1.3.0`→当前版本；本地构建镜像 tag `promptmanager:1.0.0`→中性 **`promptmanager:local`**。
  - `CHANGELOG.md`：`[1.0.0]` 日期 `2026-09-20`→**`2026-09-21`**（与 tag `v1.0.0` 一致）。
  - `docs/versioning.md`：新增 **§4.1 发版检查单**，把「`api.md` / `AGENTS.md` / README 同步」固化成**发版动作**，防止同类过期再犯。
  - 新增 `docs/README.md`（`docs/` 目录索引 + 两条边界说明）、`.nvmrc`（24）、`.npmrc`（`engine-strict=true`）。

### 变更（Changed）

- **生产镜像基础改回 Node 24（LTS），并停止 CI 对镜像的构建检查**（2026-09-30 用户要求）：
  - **`Dockerfile` 改回 `node:24` / `node:24-slim`**。dependabot 曾把基础镜像合到 `node:25`，
    而 **Node 25 是非 LTS 的 current 线**（实测 nodejs.org：24 = LTS「Krypton」，25/26 均非 LTS），
    且与 `ci.yml`（`node-version: '24'`，注释写明「与生产一致」）、`engines >=24`、
    `@types/node 24`（文档口径「对齐运行时大版本 24」）、开发机（v24.18.0）**全部不一致**
    —— 即 `ci.yml` 那句「与生产一致」当时是假的。现已恢复一致。
  - **`docker.yml` 去掉 `push: branches: [main]` 触发**（用户要求「不让 CI 再检查这个镜像」）：
    分支推送**不再**触发镜像构建；保留 `push tags: ['v*']`（正式版推送 / 预发布只构建）与
    `workflow_dispatch`。顺带清掉只为分支构建服务的死配置（`type=ref,event=branch` 标签规则）。
    ⇒ 影响：**「镜像能不能构建」不再由 CI 在每次 push 时验证**，只在打 tag 时（或本地 / 106 手工 `docker build`）验证。
    文档同步：`docs/versioning.md` §3.1、`docs/development.md`、`deploy/container.md`。


## [1.5.0] — 2026-09-30

**功能版**：新增「**远程数据同步**」—— 把全量快照**手动**推 / 拉到自己的 GitHub 私有仓库。
本版**同时包含** `1.4.1-beta.1` 的那条修复（主题「跟随系统」图标改回电脑图标）—— 那个 beta 已被本正式版取代。

### 新增（Added）

- **远程数据同步**（FR-125）：在「⋯更多 → 同步」里配置一次（仓库 / 实例标识 / 云端路径 / 令牌 / 分支），
  之后三个动作全部**手动触发**：**测试连接** / **立即上传**（覆盖云端快照）/ **从云端恢复**（`merge` 或 `replace`）。
  - **上传前必须二次确认**，确认框明示「将推送 N 条 prompt / M 个目录 + 解析后的完整路径」，
    并**加粗提示"快照包含提示词正文全文"** —— 避免无意中把内容推到远端。
  - **`replace` 恢复会清空本地内容表** ⇒ 必须先写本地快照（`<DATA_DIR>/pre-restore-<ts>.json`，保留最近 3 份）
    且需显式 `confirm`。
  - **云端路径有强制规则**：必须含 `promptmanager/` 且以 `<实例名>.json` 收尾 —— 防止多个实例用同一路径**静默互相覆盖**。
  - **令牌加密落库**（复用既有 `token-crypto`）；读取接口**只回「已设置」+ 尾 4 位**，永不回明文。
- 新接口 **5 个**：`GET /api/sync/config`、`PUT /api/sync/config`、`POST /api/sync/test`、
  `POST /api/sync/push`（支持 `dry_run`）、`POST /api/sync/pull`（`mode` = `merge`/`replace`）。
- 新增迁移 **`007_sync-config.sql`**（`sync_config` 表；schema 6 → 7）。
- 顶栏「⋯更多」新增「同步」入口（懒加载，不进主包）。

### 变更（Changed）

- `/api/sync` 并入「**仅会话可用**」前缀集合：用 API 令牌调 `push` / `pull` ⇒ `403 session_required`
  （它能清空数据，与「令牌管理 / 改口令」同级）。

### 修复（Fixed）

- **主题「跟随系统」图标改回电脑图标**（`DesktopOutlined`）：该态原用「太阳 + 月亮并排」的小图标，
  反馈认不出是在切主题。三态现为亮 = 太阳 / 暗 = 月亮 / **跟随系统 = 电脑图标**；
  并删除只服务并排图标的 `.pm-theme-icon-both` 与配套 CSS。（即 `1.4.1-beta.1` 的内容。）

### 明确不做（README 已写明）

- **不做自动 / 定时上传** —— 每一次出网都由用户点击触发。
- **删除不会传播到云端**（上传覆盖 + 恢复合并的语义组合），界面与 README 都写明了这条限制。

### 说明

- 本功能**不替代自动备份**：它依赖你想起来点。自动备份链路的接入是另一件事。
- 注意一件事：本版含**迁移 007**，部署后 schema 会从 v6 升到 v7（纯新增表，向后兼容）。


## [1.4.1-beta.1] — 2026-09-29

**预发布**（PATCH 级）：主题「跟随系统」图标改回电脑图标。**本版不推送镜像到 Docker Hub**
（按 `docs/versioning.md` §3.1：只有正式版 tag 才发镜像）。

### 修复（Fixed）

- **主题「跟随系统」态的图标改回电脑图标**（`DesktopOutlined`）：该态原用「太阳 + 月亮并排」的小图标，
  用户反馈**认不出是在切主题**，要求换回电脑图标。三态现为：亮 = 太阳、暗 = 月亮、**跟随系统 = 电脑图标**；
  循环顺序、点击行为、tooltip 文案均未改动。
  - 连带删除只服务并排图标的 `.pm-theme-icon-both` 及其两条 CSS 规则。
  - 测试口径同步反向：`AC-58` 现要求跟随系统态**必须**出现 `anticon-desktop`、**不得**出现 `pm-theme-icon-both`。

> ⚠️ 本版**反转**了 FR-58（2026-09-19 曾要求把电脑图标换成并排图标）；详见 `BRIEF.md` FR-58 与 §12 v69。


## [1.4.0] — 2026-09-26

**功能版**：关于页改为**开源项目形态**（新增出处与去向区），并修一批 UI 细节。
tag `v1.4.0`（阶段 53–56）。

### 新增（Added）

- **关于页新增「出处与去向」区**：代码仓库、Docker 镜像（可复制）、文档说明、问题反馈、许可证，
  共 **5 个链接**，一律新标签打开且带 `rel="noopener noreferrer"`。
- **关于页新增「身份区」**：项目一句话定位（取自 `package.json` 的 `description`）、技术关键词标签，
  以及**访问地址**（由原「服务区」移入）。
- 上述**项目元信息改为构建期从 `package.json` 注入**（新增 `web/src/pm-meta.ts` 作为唯一读取入口），
  前端不再硬编码 —— 仓库改了、重新构建即同步，不会像 README 里的版本号那样留下旧值。
- 新增 `MIT` 许可证文件，并在 `package.json` 补齐 `license` / `author` / `homepage` /
  `repository` / `bugs` / `keywords`。

### 变更（Changed）

- **关于页取消「服务区」**：原「版本 / 状态 / 访问地址 / 数据文件 / 备份方式」一区移除；
  其中「访问地址」移入身份区继续展示，「数据文件」「备份方式」不再在关于页呈现。
- 移动端（≤440 宽）关于弹窗的「使用 / 维护」区**默认折叠**，避免内容被裁切。

### 修复（Fixed）

- **「访问地址」协议错**（R-9）：原先把协议**硬编码为 `http://`**，经 HTTPS 反代访问时也显示 `http://`，
  且复制按钮会把错误协议发给用户。改为取 `window.location.origin` —— 随实际访问协议变化，
  **HTTP 直连与 HTTPS 反代都正确**，显示内容与复制内容天然一致。
- **「使用统计」口径文案与实现矛盾**：文案称「打开详情」计入，而实际只计复制与 MCP 取用
  （`COUNTED_KINDS = ['copy','mcp']`）。两处文案已改为与实现一致（**口径本身未动**）。
- **空态主标题误导**：搜索无结果时也显示「还没有可用的 prompt」，使用户误以为库是空的、进而重复新建。
  现按「是否因搜索/筛选而变空」区分两种空态。
- **卡片底部分隔符「·」对比度不足**：实测仅 **1.70:1**（WCAG AA 需 4.5:1），
  正常视距几乎不可见。现为 **3.26:1（亮）/ 3.51:1（暗）**，仍明显浅于正文。
- **Token 掩码折行**：掩码在表格里折成两行，现单行显示；
  同时保证移动端 7 列宽度均 > 0、「名称」列非 0、可横滚且末列按钮可达。
- **移动端表格「文件夹」列过窄致折行**：改为给足 `minWidth`。

### 文档

- **README 重写**：353 行精简到 **204 行（-44%）**，删除全部占位符与重复段落，
  修正「备份 = 拷文件」等被事实推翻的说法；镜像可用版本改用 `latest`（随 CI 规则），
  命令里的版本一律占位符，从此不再随时效过时。


## [1.3.0] — 2026-09-24

**功能版**：**取用语义修正**（"打开详情"不再算使用）+ **卡片底部信息重排**。tag `v1.3.0`（阶段 49–52）。

### 新增（Added）

- **卡片视图底部显示「所属目录」**：带文件夹图标、**排在最前**、只显示目录名；**无目录显示「未分组」**。
  底部这一行同时**加了可见的「·」分隔符**（不进复制/可选中内容），并把项间距由 10px 收窄到 **6px**。

### 变更（Changed）

- **取用语义：「打开详情」不再计入使用次数**。新增 `usage_events.kind`（`view` / `copy` / `mcp`）——
  **打开详情**只留痕 `view`、**不计数**；**复制 / 渲染取用 / MCP 取用**才计入（`kind` 为 `copy` / `mcp`）。
  **历史数据不重算**：迁移时既有记录一律置 `copy` ⇒ 老数字不变、不丢数据。
  MCP 三个工具里只有 **`prompt_render` 计入**；`prompt_get` 与 `prompt_search` 不计。
- **卡片视图底部只留三项**：所属目录 · 版本 · 变量数（**去掉取用数与日期**）；表格视图与分栏视图**不变**。

### 修复（Fixed）

- **复制一次被记两次**（含变量复制走"取正文 + 渲染"两条路，重复计一次）⇒ 复制路径不再额外记账。
- **不含变量的提示词点「复制」不计数**（本地复制不发请求 ⇒ 后端无从记账）⇒ 新增 `POST /api/prompts/:id/copy`
  仅记账不返回正文；复制成功后记一条 `copy`。


## [1.2.1] — 2026-09-23

**修复版**：修 4 个使用中发现的毛病 + 1 处易用性改动（阶段 44–48）。tag `v1.2.1`。

### 修复（Fixed）

- **移动端令牌表无法横向滑动、且丢了「名称」列**：① `Table` 改为**按各列 `minWidth` 求和**得出 `scroll.x`
  （此前写死 `x=419`，小于 6 列实际需求 ⇒ `fixed` 布局把「名称」列压成 **0 宽**、整列看不见）；
  ② 名称列给定宽下限 **≥60px** 并加省略号；③ 移动端抽屉里创建表单改竖排、名称输入框不再被挤成 80px。
  **实测**：390 宽下 **6 列宽度全部 > 0**、表头首列是「名称」、横向可滚；桌面 640 不回归。
- **版本历史「对比」默认选错版本**：此前默认拿**最早版本**和最新版比（`--- v1 / +++ v3`），
  现在默认 **倒数第二个版本 ↔ 最新版本**（"这次比上次改了什么"）；**只有 1 个版本时**仍退化为 v1 ↔ v1（不报错、不空白）。
- **登录页恒多一条纵向滚动条**：该容器此前是 `content-box`，`minHeight:100vh` 之外又加了上下 `48px` padding
  ⇒ **任何视口下都多出 96px**。改为 `border-box` 后占用恰好等于视口高，**不再出现纵向滚动**；视觉（居中/留白）不变。
- **README 未交代镜像来源与国内拉取失败怎么办**：补「官方镜像地址 **`hopetree/promptmanager`**（Docker Hub，public）」+
  FAQ 新增「拉取镜像很慢或者失败怎么办」（教**换镜像站后 `tag` 回规范名**的方法，**不绑定具体加速站**）。

### 变更（Changed）

- **令牌列表新增「创建时间」列**（格式与「最近使用」一致），**桌面端抽屉由 640px 加宽到 720px**
  以便 7 列无需横向滚动；**移动端仍可横向滚动、7 列宽度全部 > 0**（不回归）。**无需迁移**（`api_tokens.created_at` 本就有）。
- **令牌「状态」列：只读 / 读写 用不同背景色**（**只读 = 绿**、**读写 = 金（琥珀）**、已撤销 = 中性紫灰），
  三态背景色两两不同 ⇒ **不需逐字读也能一眼分辨权限**；亮/暗两主题都可分辨；点状态列改权限的交互不变。


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
- 逐条 AC 与实测输出见**库外**过程记录：`tmp/dev-process/PROGRESS.md` 的阶段 32 小节与 `tmp/dev-process/VERIFY.md`。

## [1.0.0] — 2026-09-21

**首个正式版**：一个进程、一个端口、一个 SQLite 文件，自带浏览器管理后台 + 对外 API + agent（MCP）取用面。
以下按能力类型归并（不含逐阶段流水账；逐条 AC 与实测输出见**库外** `tmp/dev-process/PROGRESS.md`）。

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
- **测试**：`node:test`，114 个测试文件 / **724 个用例**（含接口、迁移、前端源码级断言；数字以 `ls tests/*.test.ts | wc -l` 与 `grep -h '^test(' tests/*.test.ts | wc -l` 现场实测为准）。
- **验收自检**：逐阶段验收脚本（AC-1 … AC-135，含真鼠标与真实像素断言）随仓库交付，见 `tools/acceptance/`
  —— `bash tools/acceptance/run.sh --list` 看清单、`run.sh <阶段>` 重跑该阶段全部（FR-164）。
- **代码质量检查**：`.github/workflows/ci.yml` + `tools/ci-check.sh`（**本地与 CI 同一套**；步骤清单与顺序**以脚本文件头为准**，
  含文档体积预算、依赖台账一致性、双端类型检查、全量测试与 500KB 体积预算）。
- **依赖治理**：全部 pin 精确版本 + 登记 `docs/dependencies.md`（协议 + OSV 逐包查询）。

[未发布]: https://example.invalid/promptmanager/compare/v1.0.0...HEAD
[1.0.0]: https://example.invalid/promptmanager/releases/tag/v1.0.0
