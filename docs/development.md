# 开发者文档

> 面向：**改这个项目代码的人**（实现者 / 维护者 / 验收方）。
> 只部署和使用的话看 [`../README.md`](../README.md)；只对接接口看 [`api.md`](api.md)。
> AI 代理的操作指南（英文）在 [`../AGENTS.md`](../AGENTS.md)。

---

## 1. 项目结构

| 路径 | 职责 / 关键文件 |
| --- | --- |
| `bin/` | 两个入口：`pm.mjs`（CLI，转调 `dist/server/cli.js`）与 `pm-mcp.mjs`（MCP stdio 入口） |
| `src/config.ts` | 运行期配置（`HOST` / `PORT` / `DATA_DIR` … 的默认值与校验） |
| `src/server/` | HTTP 层：`index.ts`（进程入口、监听与优雅退出）、`app.ts`（装配 Fastify、挂路由与静态托管）、`cli.ts`、`auth.ts`（会话 / Bearer 闸门）、`params.ts`、`routes/*.ts` |
| `src/services/` | 领域逻辑：`prompts` / `folders` / `tags` / `versions` / `variables` / `markdown` / `export` / `import` / `tokens` / `usage` / `auth` |
| `src/db/` | 数据层：`index.ts`（连接 / QueryEngine）、`migrate.ts`、`schema.ts`（kysely 表类型）、`prompt-queries.ts`、`prompt-versions.ts`、`search.ts`（FTS5 trigram + LIKE 兜底） |
| `src/mcp/` | MCP 工具面（`server.ts`，三个只读工具） |
| `src/client/pm-api.ts` | 使用侧 CLI 走的 HTTP 客户端 |
| `web/` | 前端：`index.html`、`src/main.tsx`、`src/App.tsx`、`src/components/*.tsx`、`src/api.ts`、`src/pure.ts`（纯逻辑，单测直接 import）、`src/theme.ts`、`src/styles/*.css` |
| `migrations/` | `001_init.sql` … `010_migration-checksums.sql`（**共 10 个**；**已应用的不要改**，新增走**下一个编号**，以目录里最大号为准） |
| `tests/` | `node:test` 用例（`*.test.ts`）+ 共享夹具 `helpers.ts` |
| `tools/` | `ci-check.sh`（本地 = CI 的质量门禁）、`ui-shots.sh` + `ui-shot.mjs`（界面截图）、`seed-prompts.mjs` / `seed-demo.mjs`（夹具）、`search-zh-poc.mjs`（检索 PoC）、`mcp-*-smoke.py`（MCP 冒烟）、`pm-dev-data-reset.sh` |
| `deploy/` | 交付物（**本仓库不部署它们**）：systemd unit / env 模板 / 部署说明 / 反代样例 / 容器说明 |
| `docs/` | **最终状态文档**：`README.md`（本目录说明）、`api.md`（接口参考）、`development.md`（本文件）、`traps.md`（为什么代码长这样）、`dependencies.md`、`versioning.md`、`search-zh.md`、`shots/`（关键页截图一套 8 张） |
| 根目录 | `README.md`（用户文档）、`AGENTS.md`（AI 代理指南，英文）、`CHANGELOG.md`、`LICENSE`、`SECURITY.md`、`CONTRIBUTING.md`、构建配置。**需求 / 进度 / 验收文件不在这里**（本地 `tmp/dev-process/`） |

**技术栈**：Node 24 + TypeScript（strict，ESM）+ Fastify 5 + SQLite（`better-sqlite3` + `kysely`）+ React 19 + antd 6 + Vite 8。
**形态**：一个进程、一个端口、一个数据库文件；同一进程既供 API 也托管前端产物。

---

## 2. 构建与测试命令

```bash
npm ci                    # 冷装（按 package-lock.json；本沙箱 /root/.npm 只读 ⇒ 用 npm ci --cache var/cache/npm）
npm run build             # 服务端 tsc → dist/server，前端 vite → dist/web
npm run build:server      # 只构建服务端
npm run build:web         # 只构建前端
npm test                  # 全量测试（自带构建 + 类型检查；用例数只增不减，以 CI 输出为准）
npm run typecheck:web     # 前端类型检查
npm run typecheck:tests   # 测试类型检查（**自带 build:server 前置**，见 §3）
npm run migrate           # 幂等迁移 → ok: schema at v10
npm start                 # 启动服务（默认 0.0.0.0:8767）
```

单个用例 / 单个文件（**必须先构建**：测试 import 的是 `../dist/**`）：

```bash
npm run build && node --test tests/health.test.ts
npm run build && node --test --test-name-pattern='0.0.0.0' tests/health.test.ts
```

> ⚠️ `bin/pm.mjs` 与 `node --test` 都从 `dist/**` 加载 ⇒ **改了 `src/` 不重新构建，测的就是旧代码**。

---

## 3. 代码质量检查（本地与 CI 同一套）

```bash
npm ci                    # 首次（CI 里也由 workflow 先跑这一步）
bash tools/ci-check.sh    # ← 本地与 CI 跑的是**同一个脚本**
```

`tools/ci-check.sh` 依次跑**九步**并打印**逐项 rc + 关键输出行**的汇总表：

| 步骤 | 命令 | 判据 |
| --- | --- | --- |
| ⓪ 文档体积预算 | 量 `AGENTS.md`（含 `Instructions from:` 段头）的 UTF-8 字节 | ≤ **40000 B** 红线（65536 B 预算的 61%）；> 36000 B 预警 |
| ① 依赖就绪 | 检查 `node_modules` | 缺则提示先 `npm ci` 并停 |
| ①b 静态检查 | `npm run lint`（oxlint） | 0 个 error |
| ①c 依赖台账一致性 | `node tools/check-deps-ledger.mjs` | `package.json` 的每个直接依赖都在 `docs/dependencies.md` 里有对应版本行 |
| ①d 文档路径引用 | `node tools/check-doc-paths.mjs` | 文档 / 测试注释里引用的**仓库内**路径都存在（库外 `tmp/` 与含 `*` 的通配写法豁免） |
| ② 构建 | `npm run build` | 无 `larger than 500 kB` 告警 |
| ③ 类型检查 | `npm run typecheck:web` + `npm run typecheck:tests` | 两个都 rc=0、0 个 TS 错误 |
| ④ 全量测试 | `npm test`（自带构建与类型检查） | `fail 0` |
| ⑤ 体积预算 | 量 `dist/web/assets/*.js` | **最大 chunk ≤ 500 KB** |

> ⚠️ **② 构建必须排在 ③ 类型检查之前**：`tests/**/*.test.ts` 里 `import` 的是**构建产物** `../dist/**`，
> 干净环境（CI 的 checkout 没有 `dist/`）先跑 `typecheck:tests` 会得到 **38 个 `TS2307: Cannot find module '../dist/…'`**
> ⇒ CI 必红（本地因留有历史 `dist/` 而看不出来）。
> 复现对照：`rm -rf dist && npm run typecheck:tests` → 修前 **38** 个错误 / 修后 **0** 个。
> 两层防护：ci-check 的步骤顺序 + `typecheck:tests` 脚本自带 `npm run build:server &&` 前缀
> （于是"裸跑"也不再有未声明的前置条件）。

**CI 侧**：

| workflow | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | 只做 `npm ci` + 调 `tools/ci-check.sh`（Node 24，无 secrets，不部署） |
| `.github/workflows/docker.yml` | push tag `v*` / 手动（**分支推送不触发**） | 构建容器镜像；**仅正式版** tag（无 `-beta.` 等预发布后缀）时推送到 Docker Hub，`main` **只构建不推送** |

两个 workflow **互相独立**：`docker.yml` 不跑任何质量检查，`ci.yml` 不碰镜像。
镜像发布需要仓库里配 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` 两个 secret（**只写名字，值不进仓库**），
细节见 [`../deploy/container.md`](../deploy/container.md) §2.2。

---

## 4. 验收体系

- **需求与验收标准的唯一来源是本地需求合同**（`tmp/dev-process/BRIEF.md`：FR / 验收标准 / 已定决策 / 任务表，
  **只读**）。它**不在仓库里** —— 本仓库只放交付态内容，见 [`../AGENTS.md`](../AGENTS.md) 第 13 节。
- **每条验收标准都必须能翻译成一条命令 + 期望输出**；收尾时把**原样输出**贴进本地进度日志
  （`tmp/dev-process/PROGRESS.md`）。
- **交互类验收必须用真鼠标**（CDP `Input.dispatchMouseEvent` 的 moved/pressed/released），**禁止 JS `.click()`**
  —— 后者绕过指针事件，暴露不出拖拽/多选/拖拽手柄的真 bug。
- **界面类验收必须自己截图并逐张识图**；截图落 `tmp/`（**不入库**）。关键页截图只有一套，在 `docs/shots/`。
- **依赖安全上下文的验收必须走内网 IP**（`http://<LAN-IP>:<port>`）：`127.0.0.1` 算安全上下文，会**掩盖**
  只在明文 HTTP 下出现的 bug（剪贴板、`isSecureContext`）。
- **收尾三件套全绿、原样输出已贴**：`npm test`、`bash tools/ci-check.sh`、以及一次针对临时实例的真端到端运行
  （改动是视觉的就要真浏览器）。
- **过程记录一律不入库**：需求、进度、验收结论、逐阶段验收脚本都在本地 `tmp/dev-process/`
  （镜像本仓库布局）。**不要把它们提交回仓库。**

### 常用的一次性验证命令

```bash
npm test                                                  # 全量测试（node:test；自带构建与类型检查）
bash tools/ci-check.sh                                    # 质量门禁（本地 = CI 同一套）
DATA_DIR=$(mktemp -d) PORT=8766 node dist/server/index.js  # 起临时实例（先 npm run build）
DATA_DIR=$(mktemp -d) node tools/seed-prompts.mjs 2000     # 2000 条中文夹具（直接写库，触发器同步 FTS）
bash tools/ui-shots.sh                                     # 界面截图（缺省写 tmp/，--key 才写 docs/shots/）
bash -c 'systemd-analyze verify deploy/promptmanager.service; echo rc=$?'   # 部署文件语法
```

## 5. 依赖、版本与发版

- **依赖与协议**：[`dependencies.md`](dependencies.md)（含选型理由与 OSV/CVE 审计证据）。新增依赖前要查 CVE + 看协议 + **pin 精确版本** + 登记。
- **版本管理与发版**：[`versioning.md`](versioning.md)（semver 规则 / tag 约定 / 发版四步 / `schema_version` 与项目版本解耦）。
- **更新日志**：[`../CHANGELOG.md`](../CHANGELOG.md)（Keep a Changelog 风格）。
- **中文检索方案**（本项目的最大技术风险点）：[`search-zh.md`](search-zh.md)（含 2000 条规模基线与特殊字符安全性）。

---

## 6. 文档归属（谁写什么、谁看什么）

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [`../README.md`](../README.md) | **使用者 / 自部署者** | 是什么 / 能做什么 / 两种部署方式 / 怎么用 / 备份升级 / FAQ / 已知限制 |
| [`api.md`](api.md) | 对接方（脚本 / MCP / CLI） | 认证 / 环境变量 / HTTP 接口 / CLI / MCP / 契约细节 |
| **本文件** | 改代码的人 | 项目结构 / 构建测试 / 质量门禁 / 验收体系 / 验证脚本清单 / 依赖与发版 |
| [`../AGENTS.md`](../AGENTS.md) | **AI 代理**（英文，政策要求） | 仓库操作指南：常用命令 / 结构地图 / 约定 / 红线 / 项目特有的坑 |
| [`traps.md`](traps.md) | 改代码的人 | 每条红线的根因与当时实测值（"为什么代码长这样"） |
| `../SECURITY.md` / `../CONTRIBUTING.md` | 报告漏洞的人 / 贡献者 | 漏洞报告渠道 / 环境与质量门 / 提交规矩 |
| [`../deploy/README.md`](../deploy/README.md) | 运维 | systemd 安装 / 验证 / 回滚 / 排错 |
| [`../deploy/container.md`](../deploy/container.md) | 运维 | 容器构建 / 运行 / 镜像发布 / 备份 / 实测踩坑 |

---

## 7.1 加一个迁移该动哪里（阶段 69 / FR-145）

**一处绊线，其余派生。** 迁移数与当前 schema 版本**只在一个地方手写**：

| 位置 | 内容 |
| --- | --- |
| `tests/migrations.ts` | `CURRENT_SCHEMA_VERSION` —— **唯一手写的数字**（绊线）；`MIGRATION_FILES` / `MIGRATION_COUNT` / `LATEST_MIGRATION` 全部从 `migrations/` 目录派生 |

**加一个迁移的步骤**：① `migrations/` 新建下一个编号的 `.sql`（编号 = 目录里最大号 + 1，**已应用的不要改**）；
② 把 `tests/migrations.ts` 的 `CURRENT_SCHEMA_VERSION` 改成新版本号（**只此一处**）；
③ 同步下面 5 处文档里的数字（都有测试盯着，漏改会红）。

| 文档 | 要改什么 |
| --- | --- |
| `AGENTS.md` §3 命令表 | `ok: schema at vN` |
| `AGENTS.md` §4 布局表 | `migrations/` 行的文件数与末位文件名 |
| `AGENTS.md` §6 | 文件数、`001` … `NNN`、`ok: schema at vN` |
| `docs/development.md` §1 结构表 | `migrations/` 行的文件数与末位文件名 |
| `docs/development.md` §2 命令块 | `ok: schema at vN` |

**校验的边界（阶段 69 返工 ① 明确写下）**：运行器用 `schema_migrations.checksum`（sha256 of 文件原始字节）
检测"已应用的迁移被改 / 被改名 / 被删"。两处**它管不到**的窗口要知道：

- **存量库第一次升级**：升级前应用的迁移没有历史 hash，补记用的是**当前磁盘字节**的 hash ⇒
  如果某个迁移是在这次升级**之前**就被篡改的，篡改会被一并补记、此后永久受信。
  补记只是把老库**拉进**受校验状态，**不追溯升级前的改动**（详见 `docs/traps.md` §19.1）。
- **大小写扩展名**：`011_x.SQL` 会被当成不合规文件名**报错**（不是静默忽略）；写迁移请用 `.sql`。

**实测收益**（口径：加一个迁移时必须跟着改的**测试文件数**；详见 `tmp/dev-process/PROGRESS.md` 阶段 69 §9.4）：

- 改前（`cb62293`，schema v9）：**11 个测试文件**（9 个写死 `version, 9` / `schema at v9`，
  4 个写死迁移数，1 个字面量列出完整清单，去重后 11 个）
- 改后：**1 个**（`tests/migrations.ts` 的绊线）

**绊线仍在**（双向验证过）：删掉一个迁移文件、或把 `CURRENT_SCHEMA_VERSION` 改大，`tests/stage69-mechanical-accounting.test.ts`
都会红；改动**已应用**的迁移（哪怕一个字节、一个注释）则由 `tests/stage69-migration-checksums.test.ts`
的冻结指纹与运行器的 checksum 校验一起盯住。

---

## 7. 加一个 Prompt 字段该动哪里（字段集单一来源）

Prompt 的字段集**只有一处声明**：[`../src/prompt-columns.ts`](../src/prompt-columns.ts) 里的
`PROMPT_COLUMNS`（`as const` 的列清单，每列带 `sql` / `generated` / `api` / `exported` / `writable`
/ `content` 与各自的 `default`、JSON Schema 片段）。DB 表类型、服务层实体类型、前端类型、导出/导入映射、
HTTP 校验 schema、内容字段分类全部由它**派生** —— "漏一处就静默出错"（校验放行但落库忽略、导出静默丢字段）
在**合同 / 导出 / 导入**这条路径上被堵住了（唯一例外是界面写路径，见第 5 步）。

**加一个字段，按这个顺序做：**

1. **写进列清单** —— 在 `src/prompt-columns.ts` 的 `PROMPT_COLUMNS` 里加一条，7 个键按需填。
   契约字段名、DB 类型、能不能写、随不随导出走、算不算内容字段、缺省值、JSON Schema，都在这一条里。
2. **加迁移** —— `migrations/` 里新建下一个编号的 `.sql`（编号 = 目录里最大号 + 1）。
   这一步**无法派生**：列必须真的存在。**已应用的迁移不要改。**
3. **跑类型检查，让编译器点名剩下的地方**（本阶段的核心收益：从"靠人记住"变成"编译器点名"）。
   ⚠️ 必须跑**下面四条原始命令**，不要只跑 `npm run typecheck:tests`：那个脚本是
   `build:server && tsc -p tsconfig.tests.json && tsc -p tsconfig.render-tests.json`，
   **第一条失败就短路**，会把后面几条的错误全部藏起来（实测：加了 `pinned` 后它只报
   `src/services/import.ts` 一条，看起来"就这一处"，其实还有 12 条没显示）。

   ```bash
   npm run typecheck:web                     # web/tsconfig.json
   npm run build:server                      # tsc -p tsconfig.json（服务端 emit 顺带做）
   npx tsc -p tsconfig.tests.json            # tests/**（含本阶段自己的等价性自证）
   npx tsc -p tsconfig.render-tests.json     # tests/render/**
   ```

   实测（阶段 66 的加字段演练，字段名 `pinned`，可写 + 随导出走）**编译器一共点名 5 个文件**：

   | 文件 | 条数 | 为什么必须改 |
   | --- | --- | --- |
   | `web/src/components/Workspace.tsx` | 1 | `EMPTY_DRAFT` 字面量（新建草稿的缺省值） |
   | `src/services/import.ts` | 1 | 导出文件的解析/归一化 —— 新字段必须从文件里读出来，否则导入会静默丢掉它 |
   | `tests/stage66-field-source.test.ts` | 10 | 本阶段自己的等价性自证：`Equals` 断言与新列清单不符（**这条会红是设计如此**） |
   | `tests/render/smoke.test.ts` | 1 | 渲染级夹具里的 `makePrompt()` 字面量 |
   | `tests/render/stage65-frontend-state.test.ts` | 1 | 同上 |

4. **别把"编译器点名的 5 个"当成全部** —— 真加一个字段，今天仍然要动 **21 个文件**
   （阶段 61 加 `remember_variables` 时是 **27** 个）。实测口径（同一次演练：列清单加 `pinned` +
   新建一个迁移（演练用的编号是 `009_pinned`，本阶段不留文件），再逐项修到全绿）：

   | 类别 | 数量 | 明细 |
   | --- | --- | --- |
   | 单一来源自身 | 1 | `src/prompt-columns.ts` |
   | 迁移 | 1 | `migrations/` 里新建的那一个（列必须真的存在，无法派生） |
   | 编译器点名 | 4 | 上表 5 个里扣掉自证用例（它算在下一类） |
   | 守卫测试 | 13 | 把"迁移数 / schema 版本 / 导出键集合"写死的用例：`api-export`、`api-usage`、`cli-user`、`migrate`、`migrate-prompt-order`、`stage35-token-reveal`、`stage42-token-scope`、`stage50-usage-kind`、`stage60-variable-defaults`、`stage61-remember-variables`、`stage63-doc-alignment`、`stage64-data-safety`、`stage66-field-source` |
   | 文档 | 2 | `AGENTS.md` §6 的迁移数 / schema 版本行、本文件的迁移行（两处都有测试盯着） |

   也就是说：这次收敛**消除的是"静默漂移"**（漏改会编译失败，而不是悄悄丢字段），
   **不是改动面** —— 那 13 个守卫测试与迁移计数本来就是**故意写死的绊线**，红了按新值更新即可，
   不是维护负担。

5. **界面** —— 这个字段若要能在界面上改，界面本身仍是产品工作（表单控件 + 保存 payload）。
   ⚠️ 这是本阶段**唯一没被编译器保护**的写路径：`web/src/components/PromptEditor.tsx` 的
   `EditorForm` 与保存 payload 仍是手写的，而 `PromptWritable` 的字段全是**可选**的 ⇒
   新加一个**可写**列时界面会**静默不发送它**（编译通过、校验通过、值永远是缺省）。
   已用 `tests/stage66-field-source.test.ts` 的「保存 payload 必须覆盖全部可写列」用例把它变成红灯。

**不需要再手改的地方**（改前要一处一处跟着改，现在自动跟着走）：`src/db/schema.ts`（表类型）、
`src/services/prompts.ts`（实体类型 / create 缺省 / PUT 子集）、`src/services/export.ts`（导出字段与映射）、
`src/server/routes/prompts.ts`（`POST` / `PUT` 的 JSON Schema，且两者是**同一份**）、`web/src/types.ts`（前端类型）。

**两处有意保留的例外**（都在同一份清单里声明，不是第二份字段表）：

- kysely 的 `Generated<>` 包装层（`id` / `sort_order` 这两个有 `DEFAULT` 的列）留在 `src/db/schema.ts` ——
  它套的是列清单给出的类型，`generated` 标记仍来自清单。
- `tags`（关联表）与 `use_count` / `last_used_at`（取用聚合）**不是列**，在清单里单独声明。

> 演练实测（阶段 66 / AC-128 ④⑤）：加一个"可写 + 随导出走"的布尔字段 —— 编译器点名 **5 个文件**，
> 但真加一个字段今天仍要动 **21 个文件**（对照阶段 61 加 `remember_variables` 的 **27 个**）。
> 收敛消除的是**静默漂移**（漏改会编译失败，而不是悄悄丢字段），不是改动面；那 13 个把"迁移数 /
> schema 版本 / 导出键集合"写死的**守卫测试**是故意留的绊线，红了按新值更新即可。原样输出见库外进度日志
> `tmp/dev-process/PROGRESS.md`。
