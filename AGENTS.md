# AGENTS.md —— 在这个仓库里干活的 AI 代理操作指南

> **受众**：在本仓库工作的 AI 代理 / 新开会话。**不是**产品介绍、**不是**需求规格、**不是**通用开发规范 ——
> 那三样分别是 `README.md`、`BRIEF.md`、`/root/greenhouse/STANDARDS.md`（**优先级最高**，冲突时以它为准）。
>
> 本文件只写"**怎么在这个仓库里干活**"。每条命令都在 2026-09-21 于本机实跑（HEAD `d6285ba`），
> 每个路径都逐个 `test -e` 查过；与既有文档重叠的内容**一律指向、不复制**（避免两份真相）。

---

## 1. 项目是什么

- **定位**：轻量、自托管、**数据自持**的 Prompt 管理器。clean-room 只做 prompt 管理这一块
  （上游 PromptHub 功能全但重、且是 AGPL-3.0）；不做 RAG/向量检索/AI 调用。
- **技术栈**：Node 24 + TypeScript（ESM、strict）+ Fastify 5 + SQLite（`better-sqlite3` + `kysely`）
  + React 19 + **antd 6** + Vite 8。
- **形态**：**单进程 · 单端口 · 单文件数据库** —— 同一个进程既提供 HTTP API 也托管前端构建产物；
  数据落在 `DATA_DIR/pm.db`（WAL），**备份 = 拷文件**。
- **当前版本**：`1.0.0`（唯一真源是 `package.json`，`/healthz` 同源读取）。
- **部署形态**：跑在 228 上是 **systemd**（`deploy/` 三件套）；仓库里另有 host_manger 交付的容器化文件
  （`Dockerfile` / `docker-compose.yml` / `deploy/container.md`）。**交付 ≠ 已部署**。
- 监听地址/端口/认证方式/环境变量表 → 见 `README.md`「怎么跑」（默认 `0.0.0.0:8767`，
  除 `/healthz` 与 `/api/login` 外所有 `/api/*` 未认证一律 401）。

## 2. 最短上手路径（新会话 5 分钟）

```bash
cd /root/greenhouse/projects/promptmanager
npm ci --cache var/cache/npm     # ⚠️ 沙箱里 /root/.npm 只读，必须把 cache 放进仓库（见 §3、§9-坑3）
npm run build                    # tsc → dist/server，vite → dist/web
npm test                         # 期望 ℹ tests 285 / pass 285 / fail 0（约 17s）

# 起一个临时实例（不动生产数据、不占 8767）
AC=$(mktemp -d)
printf '%s\n' 'dev-pw-123456' | DATA_DIR=$AC node bin/pm.mjs user set-password --username admin
DATA_DIR=$AC PORT=8766 node dist/server/index.js &   # 浏览器开 http://<本机内网IP>:8766
curl -s http://127.0.0.1:8766/healthz                # {"status":"ok","version":"1.0.0"}
```

改完代码后**必须**跑 `npm test` + `bash tools/ci-check.sh` 再提交（见 §7）。

## 3. 常用命令（全部实跑过）

| 目的 | 命令 | 实测输出 / 判据 |
| --- | --- | --- |
| 装依赖 | `npm ci --cache var/cache/npm` | rc=0；`node_modules` 209 项。**不带 `--cache` 会 EROFS 失败**（见 §9-坑3）。末尾有 `npm warn allow-scripts … better-sqlite3@13.0.3 (install: node-gyp rebuild)`，**属正常**（见 §9-坑9） |
| 构建（全量） | `npm run build` | rc=0 → `dist/server` + `dist/web`；最大 chunk `vendor-antd-*.js` = 467320 B（无 >500KB 告警） |
| 只构建服务端 | `npm run build:server` | rc=0（CLI 与 `node --test` 依赖 `dist/**`，见 §9-坑8） |
| 只构建前端 | `npm run build:web` | rc=0 |
| 跑全量测试 | `npm test` | rc=0；`ℹ tests 285 / pass 285 / fail 0`（= build + typecheck:tests + `node --test "tests/**/*.test.ts"`） |
| 跑单个测试文件 | `npm run build && node --test tests/health.test.ts` | rc=0；`ℹ tests 3 / pass 3 / fail 0`。**必须先 build**：测试 import 的是 `../dist/**`，且部分用例需要 `dist/web` |
| 跑单个用例 | `npm run build && node --test --test-name-pattern='0.0.0.0' tests/health.test.ts` | rc=0；`ℹ tests 1 / pass 1 / fail 0` |
| 类型检查 | `npm run typecheck:web` / `npm run typecheck:tests` | 两者 rc=0、`0 个 TS 错误`（无输出即通过） |
| **本地质量检查（= CI 同一套）** | `bash tools/ci-check.sh` | rc=0；`✅ 代码质量检查全部通过（6 项）`（依赖就绪 / 2×typecheck / npm test / build / 体积预算 ≤500KB） |
| 迁移（幂等） | `DATA_DIR=$AC npm run migrate` | rc=0；输出 **`ok: schema at v3`**；重复跑同样输出、同样 rc=0 |
| 设管理员口令 | `printf '%s\n' '<强口令>' \| DATA_DIR=$AC node bin/pm.mjs user set-password --username admin` | rc=0；输出 **`ok: user admin password updated`**（口令从 stdin 读，**绝不打印**） |
| 启动（默认 8767） | `npm start` | rc=0；日志 `promptmanager listening on 0.0.0.0:<PORT> (HOST=0.0.0.0 PORT=<PORT>, DATA_DIR=…)`（实测用 `PORT=8765` 跑通；**8767 当前被测试环境占用**） |
| **启动临时实例** | `DATA_DIR=$(mktemp -d) PORT=8766 node dist/server/index.js` | 日志 `listening on 0.0.0.0:8766`；`/healthz` → `{"status":"ok","version":"1.0.0"}`；未认证 `/api/prompts` → `401`；`/` → `200` |
| 大夹具（2000 条） | `DATA_DIR=$AC node tools/seed-prompts.mjs 2000` | rc=0；`ok: seeded 2000 prompts (total=2000, fts_hits=2000) in … [192 ms]` |
| 部署文件语法 | `systemd-analyze verify deploy/promptmanager.service` | rc=0、**无输出**（注意：它拦不住"能起来但崩"的坑，见 §9-坑1） |
| 界面自证截图 | `bash tools/ui-shots.sh` | 自起自停临时实例 + headless chromium，产出 53 张到 `docs/shots/` |
| 代表阶段 AC 脚本 | `bash tools/ac-stage25.sh` | rc=0；`✅ AC-76 全部通过`（阶段脚本清单见 `README.md`「怎么验证」；阶段 9 无独立脚本） |

**端口纪律**：临时实例**不要**用 8767 —— 它已被 host_manger 的测试环境占用（`ss -ltn` 实测在听）。
在台账范围 **8765–8770** 里挑空闲的（先 `ss -ltn`），全被占 → 写 `QUESTIONS.md` 停手，不许扩范围。

## 4. 项目结构（目录地图）

| 路径 | 职责 / 关键文件 |
| --- | --- |
| `bin/` | 两个入口：`pm.mjs`（CLI，转发到 `dist/server/cli.js`）、`pm-mcp.mjs`（MCP stdio 入口） |
| `src/config.ts` | 运行时配置（`HOST`/`PORT`/`DATA_DIR`/… 的默认值与校验）；`findProjectRoot()` 靠 `package.json` 的 name 定位项目根 |
| `src/server/` | HTTP 层：`index.ts`（**进程入口**，listen + 优雅退出）、`app.ts`（组装 Fastify、挂路由与静态托管）、`cli.ts`（CLI 实现）、`auth.ts`（会话/Bearer 闸门）、`params.ts`、`routes/*.ts`（auth / prompts / folders / tags / export / render / tokens / usage / health） |
| `src/services/` | 领域逻辑：`prompts.ts`、`folders.ts`、`tags.ts`、`versions.ts`、`variables.ts`、`markdown.ts`、`export.ts`、`import.ts`、`tokens.ts`、`usage.ts`、`auth.ts` |
| `src/db/` | 数据层：`index.ts`（连接/QueryEngine）、`migrate.ts`（跑 `migrations/*.sql`）、`schema.ts`（kysely 表类型）、`prompt-queries.ts`、`prompt-versions.ts`、`search.ts`（FTS5 trigram + LIKE 兜底） |
| `src/mcp/` | MCP 工具面（`server.ts`，三个只读工具） |
| `src/client/pm-api.ts` | 使用侧 CLI 用的 HTTP 客户端（`pm get`/`render` 经它走 API） |
| `web/` | 前端：`index.html`、`src/main.tsx`（挂载）、`src/App.tsx`、`src/components/*.tsx`（`Workspace` / `SplitView` / `PromptEditor` / `VersionPanel` / `VariablePanel` / `VarsDialog` / …）、`src/api.ts`、`src/clipboard.ts`、`src/theme.ts`、`src/types.ts`、`src/styles/*.css` |
| `migrations/` | `001_init.sql`、`002_tokens-and-usage.sql`、`003_prompt-sort-order.sql` |
| `tests/` | `node:test` 用例（52 个 `*.test.ts`）+ 公共夹具 `helpers.ts` |
| `tools/` | `ci-check.sh`（本地=CI 的质量门）、`ui-shots.sh` + `ui-shot.mjs`（界面自证）、`ac-stage<N>.sh` + `ac-stage<N>-probe.mjs`（逐阶段 AC 自检）、`seed-prompts.mjs`、`search-zh-poc.mjs`、`mcp-client-smoke.py` |
| `deploy/` | 交付物（**不由本仓库部署**）：`promptmanager.service`、`promptmanager.env.example`、`README.md`（安装/验证/回滚/排查）、`reverse-proxy.example.conf`、`mcp-register.example.json`、`container.md` |
| `docs/` | `dependencies.md`（依赖+协议+CVE）、`versioning.md`、`search-zh.md`、`brief-changelog.md`、`shots/`（当前界面证据）、`dev-history/`（过程档案：完整 PROGRESS/VERIFY、历史 QUESTIONS、设计打样、分阶段截图） |
| 根目录文件 | `BRIEF.md`（需求+AC，**只读**）、`README.md`、`PROGRESS.md`、`VERIFY.md`、`QUESTIONS.md`、`CHANGELOG.md`、`package.json`/`package-lock.json`、`tsconfig*.json`、`vite.config.ts`、`.gitignore`、`Dockerfile`/`docker-compose.yml`/`.dockerignore`、`.github/workflows/ci.yml` |
| 运行期（**不入库**） | `tmp/`、`var/`（日志与缓存）、`dist/`（构建产物）、`node_modules/`、`_env/`（凭据，700，只读用）；默认数据目录 `data/` 在**首次运行后**出现（见 §6） |

## 5. 代码约定

- **语言/模块**：TypeScript strict + **ESM**。服务端 `src/**` 编译到 `dist/**`，**import 必须带 `.js` 后缀**
  （`../config.js`，即使源文件是 `.ts`）；前端 `web/src/**` 由 Vite 打包，组件用 `.tsx`。
- **命名**：文件/目录小写连字符（`prompt-queries.ts`、`ac-stage25.sh`）。**HTTP JSON 字段与数据库列一律
  snake_case**（`user_prompt` / `folder_id` / `sort_order`）——这是 `BRIEF.md` §6.1 的契约，**不要改成 camelCase**。
- **前端一律用 antd 组件库**（`antd@6.6.4` + `@ant-design/icons@6.3.4`，均 MIT）：按钮/表单/表格/分页/树/弹窗/
  抽屉/标签页/通知/图标**全部用组件库**；**禁自建基础组件**、**禁第二套样式体系**（不引 Tailwind）、**禁 CDN**。
  "把组件库源码复制进仓库再改"也算自建。交互元素带 `data-testid="pm-*"`（AC 探针按它定位）。
- **拖拽一律用 `@dnd-kit`**（禁手写拖拽引擎）；图表/表格渲染/HTTP 框架/ORM/迁移/测试框架等基础设施同理 ——
  选型与"禁止手搓清单"见 `STANDARDS.md` §4.2。
- **依赖纪律**：新增依赖 → ① 查 CVE/OSV ② 看协议（MIT/Apache/BSD/ISC 直接用；MPL/LGPL 可用；
  GPL/AGPL/无协议 → 先写 `QUESTIONS.md`）③ **pin 精确版本**（禁 `^`、`latest`）④ 登记到 `docs/dependencies.md`
  （包名/版本/协议/用途）。包管理器固定 **npm**（`package-lock.json` 入库），**不用 pnpm**。
- 请求校验用 Fastify 自带 JSON Schema（ajv），MCP 工具入参用 `zod`；不额外引校验库。
- 注释写"**为什么**"（尤其绕过某个坑的原因），别复述代码。

## 6. 数据与迁移

- **数据目录**：`DATA_DIR`（默认 `<repo>/data`，首次运行创建）。内含 `pm.db`（SQLite，WAL）+ `media/`。
  生产路径是 `/var/lib/promptmanager`（unit 的 `StateDirectory`）。
- **迁移**：`migrations/NNN_*.sql`，由 `src/db/migrate.ts` 按序执行，`schema_migrations` 记录已应用版本 →
  当前 3 个文件 ⇒ 输出 `ok: schema at v3`。**服务启动时也会自动跑一次**，所以迁移必须**幂等**。
- **加迁移的规矩**：新建 `004_xxx.sql`，**不要改已应用的 `001~003`**；纯 SQL、重复执行不报错；
  改完 `DATA_DIR=$(mktemp -d) npm run migrate` 验证（期望 `ok: schema at vN`）。
- `schema_version`（**导出文件格式**，当前 1）与项目版本 `MAJOR.MINOR.PATCH` **解耦** ——
  规则、tag 约定、发版流程见 `docs/versioning.md`（**别在这里重述**）。
- 备份/恢复/回滚：拷 `pm.db`（WAL 连 `-wal`/`-shm`），或 `node bin/pm.mjs export --out backup.json`；
  详见 `deploy/README.md` §4。**本项目不默认做备份。**

## 7. 测试

- **位置与规模**：`tests/**/*.test.ts`（52 个文件 / **285** 个用例）。跑法见 §3。
  用例数**只增不减**；判据是 `fail 0`，数字变大是新增用例、变小或 `fail>0` 才是回归。
- **写法**：Node 内置 `node:test` + `node:assert/strict`（**无第三方测试框架**）。
  公共夹具在 `tests/helpers.ts`（`makeFixture` / `login` / `cookieOf` / `readDb` / `runCliProcess` / `assertCliOk`）。
  每个用例**自造临时 `DATA_DIR`**（`mkdtemp`），**绝不碰 `data/` 与 8767**。
- **CLI 子进程**一律用 `runCliProcess()`，不要自己 `spawn` —— 原因见 §9-坑4。
- 前端有一部分是**源码级断言**（`tests/stage*.test.ts` 读 `web/src/**` 文本/结构）与**DOM 级断言**（jsdom 渲染组件），
  不依赖真实浏览器；真浏览器验证走 §8 的 AC 脚本。
- **看到 `✖ <文件> 'test failed'`（无断言详情）先别改业务代码**：这形态几乎都是**该文件进程被信号杀死**，
  不是断言失败；`bash tools/ci-check.sh` 失败时会打印完整诊断（`signal` / `Error:` / 日志末尾）。

## 8. 验证与自证（本项目特有，别照搬通用做法）

- **AC → 可执行命令**：每条 AC 都必须能翻译成命令 + 期望输出，收尾时**原样贴输出**进 `PROGRESS.md`。
  逐阶段的现成脚本是 `bash tools/ac-stage<N>.sh`（自起自停临时实例、临时 `DATA_DIR`、不改生产文件）。
- **交互类 AC 必须用真鼠标事件**：CDP `Input.dispatchMouseEvent` 的
  `mouseMoved` → `mousePressed` → `mouseReleased`；**禁止 JS `.click()`**（它绕过 pointer 事件，
  测不出拖拽/多选/拖拽手柄的真问题）。
- **界面类 AC 必须自己截图并识图**：`bash tools/ui-shots.sh`（自起自停 + 零安装 headless chromium，
  产出 53 张到 `docs/shots/`，并 dump 渲染后 DOM 供 `ant-*` 类名统计）；结论写进 PROGRESS 的逐张识图段。
- **依赖"安全上下文"的能力必须用内网 IP 验收**：`http://192.168.0.228:<port>`。
  `127.0.0.1` 是安全上下文，会**掩盖**内网 HTTP 的真实 bug（见 §9-坑5）。
- **只读/无副作用**要有可执行证据（`ss -ltn`、`git status --porcelain`、DOM 计数、`grep -c`）。
- 收尾三件套全绿并贴原始输出：`npm test`、`bash tools/ci-check.sh`、本阶段 `tools/ac-stage<N>.sh`。

## 9. 红线（违反即返工）

- 只在本项目目录内写文件；**不改 `BRIEF.md` / `STANDARDS.md`**（含"顺手优化措辞"）。
- **不碰** `/opt/promptmanager`、systemd unit、8767 测试环境、防火墙/NAT/内核参数 —— 那些归 host_manger；
  部署/反代/备份**只在用户明确要求时由 host_manger 执行**。
- **凭据不入库**：`_env/`（700、gitignored）只读用，不复制；口令只从 stdin 进库，**绝不打印/写日志/写 `.env`**；
  `deploy/*.env.example` 的口令类值留空。
- 不引 CDN、不装全局包（`npm i -g` / 系统 `pip install`）、不对外发布（推公网仓库、发帖）。
- 不用 `rm -rf` 清理不确定路径；`data/ tmp/ var/ dist/ node_modules/ _env/` 都不入库。
- **`git add` 只用明确路径**（如 `git add AGENTS.md`）——**禁止 `git add -A` / `git add .`**：
  工作区可能有**别的会话**的未提交改动，`-A` 会把它们卷进你的提交。
- 不为"跑通"放宽安全：关鉴权、关校验、跳过测试、`--insecure` 都算违规。

## 10. 本项目特有的坑（每条都有证据）

1. **Node 服务 unit 必须允许 `AF_NETLINK`，否则启动即崩。** `os.networkInterfaces()`（Fastify 启动打印
   监听地址时会调）要开 AF_NETLINK socket，缺了报 `uv_interface_addresses … errno 97 (EAFNOSUPPORT)`
   → `status=1/FAILURE` + Restart 循环。⚠️ **`systemd-analyze verify` 拦不住**（语法全绿照样崩）。
   证据：`deploy/promptmanager.service:52`、`deploy/README.md` §6、`docs/dev-history/PROGRESS.md` §阶段 9.1。
2. **Node 服务不得开 `MemoryDenyWriteExecute`**（与 V8 JIT 的可写可执行页冲突 → `status=5/TRAP`）。
   本仓库 unit 里该指令**计数为 0**（`grep -c MemoryDenyWriteExecute deploy/promptmanager.service` → `0`）。
   证据：`deploy/README.md` §1「unit 关键约定」、`STANDARDS.md` §7.5 故障表。
3. **沙箱里 `npm ci` 会 EROFS**：`npm error code EROFS … /root/.npm/_cacache/tmp` —— `/root/.npm` 只读。
   解法：把 cache 放进仓库 → **`npm ci --cache var/cache/npm`**（实测 rc=0；`var/` 已 gitignore）。
   任何会写 npm 缓存的命令同理。
4. **`node --test` 并发下 CLI 子进程必须 `detached: true`，否则 flaky。** 子进程与测试运行器同进程组，
   被环境整体清理（`kill -PGID` / `bwrap --die-with-parent`）连带杀死 → 断言看到 `code=null`，
   加诊断后抓到是 `signal=SIGSEGV`；`node:test` 对这种情形**只报文件级 `✖ <file> 'test failed'`（无详情）**。
   修法是公共 helper（`tests/helpers.ts` 的 `runCliProcess()`：`detached` + 吞 EPIPE + 30s 安全阀），
   **不是加重试**。证据：`tests/helpers.ts:69-113`、`PROGRESS.md` §P2-C 与「P2 返工」、`VERIFY.md` P2 返工验收。
5. **内网 HTTP 下 `navigator.clipboard` 根本不存在。** `http://192.168.x.x:<port>` 是非安全上下文
   （`window.isSecureContext === false`），复制必须兜底到 `document.execCommand('copy')`；
   用 `127.0.0.1` 验收会掩盖这个 bug。证据：`web/src/clipboard.ts:6-32`、
   `tests/clipboard-fallback.test.ts`、`docs/dev-history/PROGRESS.md` AC-65（`ac65_clipboard_type=undefined`）。
6. **Markdown 渲染的 `jsdom` 是模块级单例，常驻 ~200MB RSS。** `src/services/markdown.ts:12` 在模块加载时
   `new JSDOM('')`；起完整服务后 VmRSS ≈ 204MB。并发跑测试时多个文件同时加载 jsdom 会形成内存压力，
   表现为**文件级 `test failed`**（不是断言错）。证据：`src/services/markdown.ts:12`、`README.md`「已知限制」、
   `PROGRESS.md` §P2「第二个 flaky」。
7. **`folder_id` 筛选含全部后代，不是精确匹配。** `GET /api/prompts?folder_id=X` 返回 X 及其所有子孙
   文件夹里的 prompt（与侧栏计数同口径）；这是**有意为之**，不是 bug。
   证据：`src/db/prompt-queries.ts:16,44`（`descendantFolderIds`）、`tests/api-folder-inclusive.test.ts`、
   `README.md`「已知限制」文件夹条。
8. **`bin/pm.mjs` 与 `node --test` 依赖 `dist/**`**：没先 `npm run build`（或 `build:server`）就调用 CLI 会
   `error: 未找到构建产物 dist/server/cli.js` 并退出 1；**改了 `src/` 不 build 就是在测旧代码**
   （测试 import 的是 `../dist/**`）。证据：`bin/pm.mjs:9-17`、`tests/health.test.ts:6-7`。
9. **`npm ci` 会跳过 better-sqlite3 的 install 脚本**（npm 11 allow-scripts 策略，打印
   `npm warn allow-scripts … better-sqlite3@13.0.3 (install: node-gyp rebuild)`）—— **不影响使用**：
   该包 `prebuilds/` 自带各平台二进制，**部署机无需 gcc/node-gyp**。实测：冷装后
   `require('better-sqlite3')` 建表/读写 + `fts5(x, tokenize='trigram')` 全部 OK。
   证据：`docs/dependencies.md:123-125`、`docs/dev-history/PROGRESS.md` AC-1。
10. **导入 `replace` 不能一把清库**：`folders.parent_id` 是自引用外键 `ON DELETE RESTRICT`
    （`migrations/001_init.sql:37`），必须**叶子优先反复删**。
    证据：`docs/dev-history/PROGRESS.md` 阶段 5「replace 的清空顺序」。

## 11. 文档地图（哪份管什么、什么时候读）

| 文档 | 管什么 | 什么时候读 |
| --- | --- | --- |
| `/root/greenhouse/STANDARDS.md` | 开发规范（**优先级最高**）、红线、端口/依赖/文档/提交/验收规范 | 开工前；与 `BRIEF.md` 冲突时 |
| `BRIEF.md` | **唯一需求来源**：FR、技术约束、接口契约、**逐条 AC**、阶段表（只读） | 开工前读本阶段相关节：§4 FR、§5 约束、§6 契约、§8 AC、§11 阶段表 |
| `README.md` | 是什么 / 怎么跑 / 怎么验证 / 已知限制；环境变量表、界面说明、验证脚本清单 | 要跑起来、要知道"怎么验"、要查已知限制时 |
| `PROGRESS.md` | **当前状态 + 阶段索引**（根目录版，精简） | 想知道"现在到哪了 / 下一步做什么" |
| `docs/dev-history/PROGRESS.md` | **完整过程记录**：每条 AC 的命令与原样输出、逐张识图、决策与踩坑 | 要复核某条 AC、要挖历史坑、要写"为什么当初这么做" |
| `VERIFY.md` / `docs/dev-history/VERIFY.md` | 验收结论汇总 / 完整验收记录（含返工清单，host_manger 写） | 想知道"上一阶段过没过、有没有返工项" |
| `docs/versioning.md` | semver 判据、tag 约定、发版四步、`schema_version` 与项目版本解耦 | 要改版本号 / 发版 / 动导出格式时 |
| `docs/dependencies.md` | 依赖清单 + 协议 + 选型理由 + OSV/CVE 审计证据 | 要加依赖、要审计依赖、要查"为什么选它" |
| `docs/search-zh.md` | 中文检索方案实测报告（FTS5 trigram + LIKE 兜底、2000 条规模基线） | 要动检索逻辑时 |
| `docs/brief-changelog.md` | BRIEF v1–v32 的变更历史（已从 `BRIEF.md` 外移） | 想知道某条需求是什么时候、为什么加的 |
| `CHANGELOG.md` | 人可读的版本变更（Keep a Changelog 风格） | 发版时、想知道某版本有什么 |
| `deploy/README.md` | systemd 安装/验证/回滚 + **排查**（AF_NETLINK 等） | 碰部署文件或排查线上启动失败时 |
| `deploy/container.md` | 容器化形态（host_manger 交付） | 需要容器形态时 |
| `docs/shots/` · `docs/dev-history/shots/` | 当前状态界面证据（53 张） · 分阶段历史截图 | 做界面 AC 对照时 |
| `QUESTIONS.md` | 停手提问模板（历史问答见 `docs/dev-history/QUESTIONS-history.md`） | 规格未覆盖且影响交付时（见 §12） |

## 12. 与 AI 代理的协作约定

- **提交粒度**：一个**可验收单元**一次 commit，message 形如 `<type>(<scope>): <描述>`
  （type ∈ `feat|fix|refactor|test|docs|chore`）；不提交半成品；在 `main` 上线性提交，
  **不 force push、不改写已有历史**。
- **落盘对账式回复**：每条结论都要标注**落盘位置**（文件路径 + 章节/行号，或 commit hash）；
  **只在聊天里说的不算交付**。说"做了什么"必须给命令 + 输出 + commit。
- **规格未覆盖且影响交付 → 写 `QUESTIONS.md`（2–3 个候选 + 建议）并停手**，不要自己拍板；
  同一条 AC 连续 3 次不过、发现需求自相矛盾、需要越界操作、需要 `_env/` 里没有的凭据 —— 同样停手。
  停手时保持工作区可编译，把已完成的部分先提交。
- **新会话 / 上下文压缩后**：重读 `BRIEF.md` 的 §4（本阶段 FR）、§5（技术约束）、§8（本阶段 AC）、
  §11（阶段表），再读 `PROGRESS.md` 的当前状态表与阶段索引；**不要凭记忆改代码**。
- **多会话并行时**：确认自己要写的文件不与他人重叠；`git add` 用明确路径（§9）；
  跑 `npm test` / `npm run build` 前先看有没有别的会话在跑，避免互相干扰跑出假结果。
- **阶段边界**：只宣称本阶段该交付的东西；顺手做的跨阶段实现写进 `PROGRESS.md` 备查，**不据此宣称后续阶段完成**。
