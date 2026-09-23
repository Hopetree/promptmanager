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
| `migrations/` | `001_init.sql`、`002_tokens-and-usage.sql`、`003_prompt-sort-order.sql`（**已应用的不要改**，新增走 `004_*.sql`） |
| `tests/` | `node:test` 用例（`*.test.ts`）+ 共享夹具 `helpers.ts` |
| `tools/` | `ci-check.sh`（本地 = CI 的质量门禁）、`ui-shots.sh` + `ui-shot.mjs`（界面自证）、`ac-stage<N>.sh` + `ac-stage<N>-probe.mjs`（分阶段验收自检）、`seed-prompts.mjs`、`search-zh-poc.mjs`、`mcp-client-smoke.py` |
| `deploy/` | 交付物（**本仓库不部署它们**）：systemd unit / env 模板 / 部署说明 / 反代样例 / 容器说明 |
| `docs/` | **最终状态文档**：`api.md`（接口参考）、`development.md`（本文件）、`dependencies.md`、`versioning.md`、`search-zh.md`、`brief-changelog.md`、`shots/`（关键页面展示图一套）、`dev-history/`（过程档案：完整 PROGRESS / VERIFY / 历史问答 / 设计打样） |
| 根目录 | `BRIEF.md`（需求与验收标准，**只读**）、`README.md`（用户文档）、`PROGRESS.md`（当前状态 + 阶段索引）、`VERIFY.md`（验收报告）、`QUESTIONS.md`、`CHANGELOG.md`、`AGENTS.md`（AI 指南，英文） |

**技术栈**：Node 24 + TypeScript（strict，ESM）+ Fastify 5 + SQLite（`better-sqlite3` + `kysely`）+ React 19 + antd 6 + Vite 8。
**形态**：一个进程、一个端口、一个数据库文件；同一进程既供 API 也托管前端产物。

---

## 2. 构建与测试命令

```bash
npm ci                    # 冷装（按 package-lock.json；本沙箱 /root/.npm 只读 ⇒ 用 npm ci --cache var/cache/npm）
npm run build             # 服务端 tsc → dist/server，前端 vite → dist/web
npm run build:server      # 只构建服务端
npm run build:web         # 只构建前端
npm test                  # 全量测试（自带构建 + 类型检查；当前 329 个用例）
npm run typecheck:web     # 前端类型检查
npm run typecheck:tests   # 测试类型检查（**自带 build:server 前置**，见 §3）
npm run migrate           # 幂等迁移 → ok: schema at v3
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
| `.github/workflows/docker.yml` | push tag `v*` / push `main` / 手动 | 构建容器镜像；tag `v*` 时推送到 Docker Hub，`main` **只构建不推送** |

两个 workflow **互相独立**：`docker.yml` 不跑任何质量检查，`ci.yml` 不碰镜像。
镜像发布需要仓库里配 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` 两个 secret（**只写名字，值不进仓库**），
细节见 [`../deploy/container.md`](../deploy/container.md) §2.2。

---

## 4. 验收体系

- **需求与验收标准的唯一来源**是 `BRIEF.md`（第 4 节 FR / 第 8 节 AC / 第 9 节已定决策 / 第 11 节阶段表，**只读**）。
- **每个 AC 都必须能翻译成一条命令 + 期望输出**；收尾时把**原样输出**贴进 `PROGRESS.md`。
- **分阶段自检脚本**：`tools/ac-stage<N>.sh`（自起自停临时实例、临时 `DATA_DIR`、不碰生产文件）；
  需要真实浏览器/真鼠标/真实像素的用同目录的 `ac-stage<N>-probe.mjs`（CDP，零安装 `chrome-headless-shell`）。
- **交互类 AC 必须用真鼠标**（CDP `Input.dispatchMouseEvent` 的 moved/pressed/released），**禁止 JS `.click()`**。
- **界面类 AC 必须自己截图并识图**（五问口径），截图落 `tmp/`（**不入库**）。
- **收尾三件套全绿**：`npm test`、`bash tools/ci-check.sh`、本阶段的 `tools/ac-stage<N>.sh`。
- **过程记录**：根目录 `PROGRESS.md` = 当前状态 + 阶段索引；完整过程（每条 AC 的命令与原样输出、逐张识图、
  决策与踩坑）在 `docs/dev-history/PROGRESS.md`。验收结论由 host_manger 写在 `VERIFY.md`。
- **文档通道**：`BRIEF.md` / `PROGRESS.md` / `QUESTIONS.md` / `VERIFY.md` 的写作规范见
  `/root/greenhouse/STANDARDS.md` §5；`docs/` 只放**最终状态**文档，过程产物一律进 `tmp/`（同规范 §5.2）。

### 验证脚本清单

```bash
npm test                       # 全量测试（node:test；自带构建与类型检查）
bash tools/ac-stage1.sh        # 认证前的基础面 / 部署文件语法 / 凭据与产物卫生
bash tools/ac-stage2.sh        # 未认证一律拒绝 / 登录·会话·限流 / 重启数据持久
bash tools/ac-stage3.sh        # CRUD / 中文检索 / 筛选分页
bash tools/ac-stage4.sh        # 变量提取与渲染 / 版本列表·diff·回滚 / Markdown 净化与高亮
bash tools/ac-stage5.sh        # 导出 → 导入(replace) → 再导出 一致性 / 非法导入不动数据
bash tools/ac-stage6.sh        # API Token / CORS 白名单 / 使用记录 / 使用侧 CLI
bash tools/ac-stage7.sh        # MCP server（真实 Python 客户端）
bash tools/ac-stage8.sh        # 前端 P0：截图 + 组件库机械证据
bash tools/ac-stage10.sh       # 视觉重设计：结构侧 + 主题定制 + 响应式
bash tools/ac-stage11.sh       # 使用优先改造：一键复制 / 快捷 / 移动端
bash tools/ac-stage12.sh       # 导航归位 + 信息克制
bash tools/ac-stage13.sh       # 取消管理页 + 主题图标三态
bash tools/ac-stage14.sh       # 分栏视图 + 删除「列表」档
bash tools/ac-stage15.sh       # 顶栏重排 + 文件夹区 + 标签胶囊云
bash tools/ac-stage16.sh       # P0 修复（文件夹删除 / Logo / 关于页 / 编辑页 / 收藏 / 主题图标）
bash tools/ac-stage17.sh       # 品牌图形全站统一
bash tools/ac-stage18.sh       # 懒加载 + 体积预算 + 编辑器全屏
bash tools/ac-stage19.sh       # 应用内全屏 / diff 尾换行 / 内网 HTTP 复制
bash tools/ac-stage20.sh       # 详情页去冗余头部 / 修改密码
bash tools/ac-stage21.sh       # 备注纯文本 / 标题下备注行
bash tools/ac-stage22.sh       # 拖拽排序 / 分栏中栏精简
bash tools/ac-stage23.sh       # 目录含子项 / 卡片贴底 / 表格拖拽
bash tools/ac-stage24.sh       # 拖拽在全部视图生效 + 槽位保持
bash tools/ac-stage25.sh       # 顶栏品牌文字 PromptM
bash tools/ac-stage27.sh       # 表格批量操作 / 详情元信息行 / 去「备注」页签 / 去变量区块 / 弹窗尺寸
bash tools/ac-stage29.sh       # 表格批量 UI 与详情元信息行的视觉细化
bash tools/ac-stage31.sh       # 表格「标签」列间距 / 版本保留上限
bash tools/ac-stage32.sh       # 干净环境跑质量门禁 / 登录页去预填与噪音
bash tools/ac-stage33.sh       # 镜像构建 workflow 的静态断言（不需要 Docker）
bash tools/ac-stage34.sh       # 分栏中栏手机端撑满 / README 用户化（Docker+源码两条部署）/ 移动端档位顺序
bash tools/ac-stage35.sh       # MCP Streamable HTTP（POST /mcp，真实 Python 客户端）/ Token 加密可查看（reveal）
bash tools/ac-stage36.sh       # 内网 IP 非安全上下文下的 token「复制」（真鼠标 + 真粘贴）/ 撤销态硬删除 / 去创建弹窗
bash tools/ac-stage37.sh       # （已作废）令牌列表折叠排版 —— 保留 FR-98 的"无横向滚动 + 名称不被挤压"两目标
bash tools/ac-stage38.sh       # 令牌列表固定 6 列（名称截断 20 + Token 脱敏前5…后4）
bash tools/ac-stage39.sh       # 撤销后的 token 仍显示值并可复制（撤销 ≠ 销毁）
bash tools/ac-stage40.sh       # CLI 建的 token 也有密文（界面可见值 / pm token reveal 可用）
bash tools/ac-stage41.sh       # 编辑保存后返回详情，版本历史即时更新（真浏览器，不刷新页面）
bash tools/ac-stage42.sh       # 令牌权限两档 read/write（逐端点实测）/ 取用归因 token_id（真实令牌 + 官方 MCP 客户端）
bash tools/ac-stage43.sh       # 改已有令牌的权限 PATCH /api/tokens/:id（防自我提权 / 立即生效 / 409·400·404 / 真鼠标改且不刷新 / CLI set-scope）
bash tools/ac-stage44.sh       # 移动端令牌页可用（真视口 390×844 与 1600×900：表格可横滚且两端列可达 / 表单 ≥120px / 桌面零回归）
bash tools/ac-stage45.sh       # 移动端令牌表不丢列（逐列宽度全 >0、名称列 ≥60px、表头首列是「名称」；等抽屉动画结束再量）
bash tools/ac-stage46.sh       # 登录页无纵向溢出（双视口几何 + 视觉不变 ±2px + 主界面冒烟）+ README 镜像指引可检索
bash tools/ac-stage47.sh       # 版本对比默认「上一版 ↔ 最新」（3 版/单版两场景 + 手动改 + 视图切换）+ 令牌页「创建时间」列（双视口 7 列 + PC 无横滚 + 改权限不回归）
bash tools/ac-stage48.sh       # 令牌「状态」列配色（亮/暗双主题 backgroundColor 两两不等 + 真鼠标改权限时文字与底色同步变）
bash tools/ui-shots.sh         # 界面自证：全套截图 → tmp/ui-shots/shots/（默认，不入库）
bash tools/ui-shots.sh --key   # 发版/交付：关键页面展示图 8 张 → docs/shots/（旧的先归档到 tmp/）
DATA_DIR=$(mktemp -d) node tools/seed-prompts.mjs 2000   # 2000 条中文夹具（直接写库，触发器同步 FTS）
bash -c 'systemd-analyze verify deploy/promptmanager.service; echo rc=$?'   # 部署文件语法
```

> **没有 `ac-stage9.sh`**：阶段 9 的验收项（全量测试 / 凭据与产物卫生 / 部署文件语法）分别由
> `npm test`、`git check-ignore` + 凭据扫描、`systemd-analyze verify` 覆盖（`ac-stage1.sh` 里另有一段抽查）。
> 部分阶段（如 26 / 28 / 30 / 34）没有独立脚本，其验收证据在 `PROGRESS.md` 对应小节。

---

## 5. 依赖、版本与发版

- **依赖与协议**：[`dependencies.md`](dependencies.md)（含选型理由与 OSV/CVE 审计证据）。新增依赖前要查 CVE + 看协议 + **pin 精确版本** + 登记。
- **版本管理与发版**：[`versioning.md`](versioning.md)（semver 规则 / tag 约定 / 发版四步 / `schema_version` 与项目版本解耦）。
- **更新日志**：[`../CHANGELOG.md`](../CHANGELOG.md)（Keep a Changelog 风格）。
- **需求变更史**：[`brief-changelog.md`](brief-changelog.md)。
- **中文检索方案**（本项目的最大技术风险点）：[`search-zh.md`](search-zh.md)（含 2000 条规模基线与特殊字符安全性）。

---

## 6. 文档归属（谁写什么、谁看什么）

| 文档 | 受众 | 内容 |
| --- | --- | --- |
| [`../README.md`](../README.md) | **使用者 / 自部署者** | 是什么 / 能做什么 / 两种部署方式 / 怎么用 / 备份升级 / FAQ / 已知限制 |
| [`api.md`](api.md) | 对接方（脚本 / MCP / CLI） | 认证 / 环境变量 / HTTP 接口 / CLI / MCP / 契约细节 |
| **本文件** | 改代码的人 | 项目结构 / 构建测试 / 质量门禁 / 验收体系 / 验证脚本清单 / 依赖与发版 |
| [`../AGENTS.md`](../AGENTS.md) | **AI 代理**（英文，政策要求） | 仓库操作指南：常用命令 / 结构地图 / 约定 / 红线 / 项目特有的坑 |
| `../BRIEF.md` | 实现方 + 验收方 | 需求合同与逐条验收标准（**只读**） |
| `../PROGRESS.md` | 实现方 + 验收方 | 当前状态 + 阶段索引（完整过程在 `dev-history/`） |
| `../VERIFY.md` | 验收方 | 逐条验收结论与返工清单 |
| [`../deploy/README.md`](../deploy/README.md) | 运维 | systemd 安装 / 验证 / 回滚 / 排错 |
| [`../deploy/container.md`](../deploy/container.md) | 运维 | 容器构建 / 运行 / 镜像发布 / 备份 / 实测踩坑 |
