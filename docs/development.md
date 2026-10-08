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
| `migrations/` | `001_init.sql` … `007_sync-config.sql`（**共 7 个**；**已应用的不要改**，新增走**下一个编号** —— 当前是 `008_*.sql`，以目录里最大号为准） |
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
npm run migrate           # 幂等迁移 → ok: schema at v7
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

`tools/ci-check.sh` 依次跑五步并打印**逐项 rc + 关键输出行**的汇总表：

| 步骤 | 命令 | 判据 |
| --- | --- | --- |
| ① 依赖就绪 | 检查 `node_modules` | 缺则提示先 `npm ci` 并停 |
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
