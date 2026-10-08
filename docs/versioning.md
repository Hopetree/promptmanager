# 版本管理（versioning）

> 适用范围：本项目（promptmanager）的**项目版本号**、**git tag**、**发版流程**，以及它与
> **导出文件格式版本 `schema_version`** 的关系。
> 相关：`package.json` 的 `version`、`CHANGELOG.md`、`/healthz` 返回的 `version`。

## 1. 版本号规则：语义化版本（semver）

版本号形如 **`MAJOR.MINOR.PATCH`**（如 `1.0.0`），含义与"该升哪一位"的判据：

| 位 | 什么时候升 | 本项目里的例子 |
| --- | --- | --- |
| **MAJOR** | **破坏性变更**：接口契约不兼容（删/改字段、改语义、改状态码）、**数据模型**不兼容、**导出文件格式**不兼容、部署形态强制变化 | 若将来把 `PATCH /api/prompts/order` 的 body 从 `{ids}` 改成别的形状；若 `prompts` 表要做不兼容重建 |
| **MINOR** | **新增功能**（向后兼容）：新接口、新字段（可缺省）、新界面能力、新排序档 | `1.0.0 → 1.1.0`：新增"批量操作"、新增排序档、新增 MCP 工具 |
| **PATCH** | **修复**（向后兼容）：bug 修复、文案/样式修正、性能优化、依赖安全升级、纯内部重构 | `1.0.0 → 1.0.1`：修一个拖拽失效、修一个 diff 假变更 |

补充约定：

- **纯文档 / 注释 / 测试改动**不升版本（改 `CHANGELOG` 的"未发布"段即可）。
- **只加不改**（例如给响应**新增**一个可选字段）算 MINOR；**改语义**（例如 `folder_id` 从"精确匹配"改成"含子目录"）
  虽然字段没变，但**行为契约变了** ⇒ 按 **MINOR** 处理，并在 `CHANGELOG` 的"变更（Changed）"里写明（本项目
  `0.x → 1.0.0` 期间这类变更随首个正式版一并冻结）。
- **1.0.0 之前**（本项目历史阶段 1–25 都在 `0.1.0` 上开发）不承诺兼容；**自 `1.0.0` 起**严格按上表执行。

## 2. 单一版本来源

- **唯一真源 = `package.json` 的 `version`**。
- `/healthz` 返回的 `version` 由 `src/config.ts` 的 `readVersion()` **读 `package.json`** 得到
  （`src/server/routes/health.ts` 只透传 `config.version`）⇒ **不存在第二份手写版本号**。
- 任何"改版本号"的动作都只改 `package.json` 一处；改完必须复核 `curl /healthz` 的输出。

## 3. git tag 约定

- 格式：**`v` + 语义化版本**，例如 **`v1.0.0`**（与 `CHANGELOG.md` 的标题一一对应）。
- **附注 tag**（`git tag -a v1.0.0 -m "..."`），tag 消息写一句该版本的主题。
- 一个 tag 对应一次 `CHANGELOG` 的发布段落；**不打"移动 tag"**（不覆盖已发布的 tag）。

### 3.1 预发布 tag 与「镜像只发正式版」（2026-09-26 用户定的规范）

- **正式版**：`vX.Y.Z`，**没有**任何后缀 —— 可归档、可直接上生产的版本。
- **总则（先记这条）**：**`package.json` 的 `version` 必须与 tag 一致**，无论正式版还是预发布（见下方「版本号必须与 tag 一致」）。
- **预发布**：`vX.Y.Z-<预发布标识>.<序号>`，例如 **`v2.2.2-beta.1`**、`v2.0.0-rc.1`、`v3.0.0-alpha.2`。
  **必须**用下列后缀之一（CI 按这些字面量判定，**新增后缀要同步改 `.github/workflows/docker.yml`**）：
  `-alpha.` `-beta.` `-rc.` `-pre.` `-dev.` `-nightly.` `-next.` `-canary.`
- **⛔ 只有正式版才推送镜像到 Docker Hub**：
  - 正式版 tag ⇒ 推送，产出 `X.Y.Z` + `X.Y` + **`latest`** 三个别名；
  - 预发布 tag ⇒ **只构建、不推送**（仍跑 CI 验证 Dockerfile 没坏，但 Docker Hub 上不出现该版本）；
  - `workflow_dispatch` ⇒ 只构建。
  - **分支推送不触发镜像构建**（2026-09-30 用户要求：不让 CI 再检查这个镜像）——
    镜像构建改由发布/部署侧负责：正式版走 CI 推送，预发布走 106 本地构建（§3.2）。
  ⇒ 这样 **`latest` 与各 `X.Y.Z` 永远指向正式版**，不会把测试版顶成「最新」。
- **版本号必须与 tag 一致（含预发布）** —— 口径「**一致优先**」（用户 2026-09-26 拍板）：

  > 打任何 tag 之前，**先改 `package.json` 的 `version` 使其与 tag 完全一致**，
  > 包括预发布：打 `v2.2.2-beta.1` ⇒ `package.json` 写 **`2.2.2-beta.1`**。

  - **判据（可核对）**：`curl /healthz` 的 `version` 与 **关于页显示的版本** 都必须**逐字等于** tag 去掉 `v` 的部分。
    两者同源（关于页 `fetch('/healthz')` ⇒ `/healthz` 读 `package.json`），**改一处即两处同步**。
  - **预发布同样写 CHANGELOG**（标题 `## [2.2.2-beta.1] — YYYY-MM-DD`）。
  - **⚠️ 已废弃的旧口径**：曾写「预发布**不改** `package.json`、只在 tag 与 CHANGELOG 体现」——
    该口径与「版本号跟 tag 一致」冲突，**已作废**，以本节为准。
- 预发布转正式：该版本验收通过后，打正式版 tag `vX.Y.Z` 并把 `package.json` 同步为 `X.Y.Z`，
  CHANGELOG 把预发布段并入正式段或保留两条。

### 3.2 生产部署：正式版走 Hub，预发布走本地构建（用户 2026-09-26 定的规范）

**两条路，按 tag 种类分：**

| tag 种类 | 镜像从哪来 | 生产上跑什么 |
| --- | --- | --- |
| **正式版** `vX.Y.Z` | **Docker Hub**（CI 已推送，经镜像站拉回）| `hopetree/promptmanager:X.Y.Z` |
| **预发布** `vX.Y.Z-beta.N` 等 | **106 本地构建**（Hub 上没有）| **`promptmanager:<tag>`**（本地专用名，不带 Hub 命名空间 —— 一眼可辨是本地货）|

**预发布本地构建部署**（脚本 `/root/pm-deploy-local.sh`，用户拍板三选项「常驻裸仓库 + 本地专用名 + 数据库快照」）：

```bash
sudo bash /root/pm-deploy-local.sh v2.2.2-beta.1          # 真部署
sudo bash /root/pm-deploy-local.sh v2.2.2-beta.1 --dry-run # 只预演
```

脚本六步：**① 取源码 checkout tag → ② 校验 `package.json` 与 tag 一致（不一致直接拒绝构建）
→ ③ 备份 compose + 数据卷 + **数据库快照** → ④ 本地 `docker build -t promptmanager:<tag>`
→ ⑤ 切 compose 并重建 → ⑥ 部署完整性自检（容器状态 / `/healthz` 版本 == tag）**。

**源码怎么上 106（常驻裸仓库，一次建好、以后增量）：**

- 裸仓库 `/opt/promptmanager-src/repo.git`、构建工作副本 `/opt/promptmanager-src/work`。
- 首次（或仓库损坏时）重建：
  ```bash
  # 228：导出全量
  git bundle create /tmp/pm-src.bundle --all
  # 传到 106 后：建裸仓库 + 工作副本
  git clone --bare /tmp/pm-src.bundle /opt/promptmanager-src/repo.git
  git clone /opt/promptmanager-src/repo.git /opt/promptmanager-src/work
  ```
- **日常（有新 tag 要部署时）**：把新 tag 推给裸仓库即可 —— 裸仓库是普通 git 仓库，可直接 `push`：
  ```bash
  # 228（或从我的工作机，走已验证的通路）
  git push /path/to/repo.git main --tags
  ```
  脚本第 ① 步会 `git fetch --tags` 自动同步，**不需要每次传全量**。
- 106 环境前提（已实测）：`node:24-slim` 镜像在本地、到 `registry.npmjs.org` 与 `registry.npmmirror.com` 均 **HTTP 200**。

**⚠️ 预发布上生产的两个风险点与对策：**

1. **回滚点**：脚本每次部署前自动备份 compose + 数据卷（`/root/backups/promptmanager/<TS>-local-<tag>/`）。
2. **数据迁移不兼容**（**关键**）：预发布若带 schema 迁移，**回滚到旧镜像时迁移已执行、schema 回不去**。
   ⇒ 脚本**额外取 `/data/pm.db` 快照**（`pm-snapshot.db`）。
   ⇒ 真回滚数据：**停容器 → 用快照覆盖 `/data/pm.db` → 起容器**（仅当新版跑了不兼容迁移才需要）。

## 4. 发版流程（四步）

```bash
# 1) 改版本号（唯一一处）
#    package.json: "version": "1.1.0"（按 §1 判据决定升哪一位）

# 2) 更新 CHANGELOG.md：把「未发布」段固化为「## [1.1.0] — YYYY-MM-DD」并补链接

# 3) 本地质量检查（与 CI 同一套），必须全绿
bash tools/ci-check.sh          # 类型检查 → 全量测试 → 构建 → 体积预算 ≤500KB

# 4) 打附注 tag（推送远程由维护者另行安排）
git tag -a v1.1.0 -m "promptmanager v1.1.0"
```

发版后复核：

```bash
# 部署侧：重新构建并重启后，健康检查必须回报新版本
curl -s http://127.0.0.1:8767/healthz     # {"status":"ok","version":"1.1.0"}
```

### 4.1 发版检查单（每次发版逐条过）

> **由来**：2026-09-30 体检发现多处「文档落后于实际」（`AGENTS.md` 的版本号与用例数停在 1.0.2/348、`docs/api.md` 整个 sync 章节缺失、`CHANGELOG` 与本文件把 sync 端点误记为 6 个）。根因是**发版只改了 `package.json` 与 `CHANGELOG`**。把"文档同步"固化成发版动作，避免再犯。

- [ ] `package.json` 版本号（唯一来源）已改，且**与 tag 去 `v` 一致**（§3.1「一致优先」）
- [ ] `CHANGELOG.md`：`[未发布]` 段固化为 `## [x.y.z] — YYYY-MM-DD`
- [ ] 本文件 §6 版本历史补一行
- [ ] **`docs/api.md` 已同步**：本版新增 / 变更的**端点、环境变量、错误码**都写进去了
- [ ] **`AGENTS.md` / `docs/development.md` 已同步**：迁移文件清单与「下一个编号」、schema 版本、用例数（**写"以 CI 为准"，不要写死会腐化的数字**）
- [ ] **`README.md` 已同步**：新功能章节 + `/healthz` 示例版本号
- [ ] **版本串自查**：`grep -rnE '[0-9]+\.[0-9]+\.[0-9]+' README.md docker-compose.yml Dockerfile` 无陈旧版本
- [ ] 部署形态确认：**正式版 → Hub 镜像**；**预发布 → 本地构建**（§3.2）

## 5. `schema_version`（导出文件格式）与项目版本**解耦**

- **导出文件**的字段 `schema_version` 描述的是**文件格式**，定义在
  `web/src/pure.ts` 的 `SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 }`
  （服务端同名校验见 `src/services/export.ts` / `import.ts`）。
- **规则**：**只有导出/导入文件的结构发生不兼容变化时才动 `schema_version`**（例如把 `prompts[].versions`
  从内嵌改成独立数组、改字段名/类型）。它与 `MAJOR.MINOR.PATCH` **不是同一个号**，也不随发版自动递增。
- 项目版本升级**不必**改 `schema_version`；反之，改 `schema_version` **必然**是一次 MAJOR 级变更
  （因为旧文件可能导不进来），需在 `CHANGELOG` 的"破坏性变更"里写明并提供迁移说明。
- ⚠️ **显示名 ≠ 契约值**：顶栏品牌文字是 `PromptM`、页面标题是 `PromptManager`，而 `app` 恒为**小写 `promptmanager`**；
  改它会让用户已有的导出文件全部导入失败（`400 invalid_import`）。

## 6. 版本历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| `1.6.0-beta.1` | 2026-09-30 | **新增** 安全响应头（CSP / X-Frame-Options / nosniff / Referrer-Policy，HSTS 仅 `PUBLIC_ORIGIN` 为 https 时）；**变更** 413 → `payload_too_large`、405 → `method_not_allowed`、未枚举 4xx → `request_error`（**不再一律误标 `unauthorized`**，行为契约变更 ⇒ 按 MINOR）；**修复** 同步子系统（解密失败不再裸 500 / 不跟重定向 + 上游响应体 10MB 上限 / 快照与导出改 0600）、补全局异常处理器；**依赖** vite 8.3.1 / marked 18.0.14 / `@modelcontextprotocol/sdk` 1.30.1（OSV 均 0）；**工程** 质量门 6 → 9 项（文档体积预算 / oxlint 全仓 / 依赖台账一致性）|**预发布**：不推镜像到 Docker Hub（§3.1）；生产用 106 本地构建部署 |
| `1.5.0` | 2026-09-30 | **新增** 远程数据同步（FR-125）：配置 5 项（仓库 / 实例名 / 分支 / 仓库内路径 / 令牌）+ 手动三动作（测试连接 / 立即上传 / 从云端恢复），上传前二次确认（明示条数与"含正文全文"）、`replace` 前自动快照、云端路径强制 `promptmanager/<实例>.json`、令牌加密落库只回掩码；新接口 5 个 `/api/sync/*`（**仅会话可用**）；迁移 `007_sync-config.sql`（schema 6→7）；顶栏新「同步」入口 |**修复** 主题「跟随系统」图标改回电脑图标（含 `1.4.1-beta.1` 的内容）；**明确不做** 自动/定时上传、删除传播 |
| `1.4.1-beta.1` | 2026-09-29 | **修复** 主题「跟随系统」图标改回电脑图标（反转 FR-58；用户反馈并排小图标认不出是在切主题）；连带删除 `.pm-theme-icon-both` 及两条 CSS；AC-58 反向 |**预发布**：不推镜像到 Docker Hub（§3.1）；生产用本地构建部署 |
| `1.4.0` | 2026-09-26 | **新增** 关于页「出处与去向」区（代码仓库 / Docker 镜像 / 文档 / 反馈 / 许可证 共 5 链接）+「身份区」（定位 / 技术标签 / 访问地址），项目元信息改为构建期从 `package.json` 注入；新增 MIT LICENSE；移动端关于弹窗使用·维护默认折叠 |**变更** 关于页取消「服务区」（访问地址移入身份区）；**修复** 访问地址协议写死 http（R-9）、使用统计口径文案与实现矛盾、空态主标题误导（搜索无匹配时也称「还没有可用的 prompt」）、分隔符对比度 1.70:1 → 3.26:1(亮)/3.51:1(暗)、Token 掩码折行、移动端表格文件夹列折行；**文档** README 353→204 行 |
| `1.3.0` | 2026-09-24 | **新增** 卡片视图底部显示「所属目录」（带图标·最前·仅目录名，无目录显示「未分组」）+ **可见「·」分隔符**（间距 10→6px）；**变更** 取用语义：**「打开详情」不再计入使用次数**（新增 `usage_events.kind`：`view` 留痕不计数 / `copy`·`mcp` 计数；历史一律置 `copy` 不重算）+ 卡片底部只留 目录·版本·变量数（去取用数与日期）；**修复** 复制一次被记两次、不含变量复制不计数 |
| `1.2.1` | 2026-09-23 | **修复** 移动端令牌表无法横滚且丢「名称」列（`scroll.x` 改按各列 `minWidth` 求和）；版本历史「对比」默认改为「上一版 ↔ 最新」；登录页恒多 96px 纵向溢出（`content-box`→`border-box`）；README 补官方镜像地址 `hopetree/promptmanager` 与国内拉取失败指引；**变更** 令牌列表新增「创建时间」列 + 桌面抽屉 640→720px + 状态列只读/读写用不同背景色 |
| `1.2.0` | 2026-09-22 | **新增** 令牌权限两档（只读/读写，只作用于资源；新建默认只读、存量保持读写）+ **令牌管理/改口令一律仅会话** + **可改已有令牌权限**（`PATCH /api/tokens/:id`，界面点状态列切换）+ **取用归因**（`usage_events.token_id`）；**修复** 编辑保存后返回详情版本历史不刷新（并让版本表最新在最上） |
| `1.1.1` | 2026-09-22 | **修复**：用 CLI（`pm.mjs token create`）创建的 token 此前没有保存密文 ⇒ 界面看不到值、`pm token reveal` 报 `token_not_revealable`；现已与界面路径一致（AES-256-GCM 落库） |
| `1.1.0` | 2026-09-22 | **新增** MCP 远程接入（`POST /mcp` Streamable HTTP）+ API Token 可查看/复制（加密存储）+ 撤销行仍可查看/复制 + 删除已撤销 token；**变更** 令牌列表改固定 6 列、README 用户化、移动端体验两处；**修复** 内网 HTTP 下复制失效 |
| `1.0.2` | 2026-09-21 | 新增镜像发布流水线（GitHub Actions → Docker Hub，`linux/amd64`）+ 拉取/发布文档；**运行时行为与 1.0.1 一致** |
| `1.0.1` | 2026-09-21 | 修复 CI 干净环境必失败（`typecheck:tests` 前置）；登录页去掉默认账号名预填与四条噪音文案（阶段 32） |
| `1.0.0` | 2026-09-20 | **首个正式版**（阶段 1–25 的全部能力冻结；见 `CHANGELOG.md`） |
| `0.1.0` | 2026-09-18 起 | 开发期版本号（阶段 1–25 期间未逐阶段发版） |
