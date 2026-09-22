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

## 4. 发版流程（四步）

```bash
# 1) 改版本号（唯一一处）
#    package.json: "version": "1.1.0"（按 §1 判据决定升哪一位）

# 2) 更新 CHANGELOG.md：把「未发布」段固化为「## [1.1.0] — YYYY-MM-DD」并补链接

# 3) 本地质量检查（与 CI 同一套），必须全绿
bash tools/ci-check.sh          # 类型检查 → 全量测试 → 构建 → 体积预算 ≤500KB

# 4) 打附注 tag（推送远程与绑定仓库由 host_manger/用户另行安排，dsh 不 push）
git tag -a v1.1.0 -m "promptmanager v1.1.0"
```

发版后复核：

```bash
# 部署侧（由 host_manger 执行）：重新构建并重启后，健康检查必须回报新版本
curl -s http://127.0.0.1:8767/healthz     # {"status":"ok","version":"1.1.0"}
```

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
| `1.1.0` | 2026-09-22 | **新增** MCP 远程接入（`POST /mcp` Streamable HTTP）+ API Token 可查看/复制（加密存储）+ 撤销行仍可查看/复制 + 删除已撤销 token；**变更** 令牌列表改固定 6 列、README 用户化、移动端体验两处；**修复** 内网 HTTP 下复制失效 |
| `1.0.2` | 2026-09-21 | 新增镜像发布流水线（GitHub Actions → Docker Hub，`linux/amd64`）+ 拉取/发布文档；**运行时行为与 1.0.1 一致** |
| `1.0.1` | 2026-09-21 | 修复 CI 干净环境必失败（`typecheck:tests` 前置）；登录页去掉默认账号名预填与四条噪音文案（阶段 32） |
| `1.0.0` | 2026-09-20 | **首个正式版**（阶段 1–25 的全部能力冻结；见 `CHANGELOG.md`） |
| `0.1.0` | 2026-09-18 起 | 开发期版本号（阶段 1–25 期间未逐阶段发版） |
