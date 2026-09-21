# promptmanager

> 轻量、自托管、数据自持的 Prompt 管理器：单进程 · 单端口 · 单文件数据库（Node 24 + Fastify + SQLite + React 19/antd 6）。

## 是什么

- **给谁用**：想要"轻量、自托管、数据自持"的 prompt 管理工具的开发者（第一用户 = 项目所有者，目前用 203 上的 PromptHub）。
- **解决什么**：上游 PromptHub 功能全但**很重**（五端共享、四个非 prompt 模块缠绕）且是 **AGPL-3.0**；
  本项目 clean-room 只做 **prompt 管理**这一块，并把许可与数据都留在自己手里。
- **形态**：一个 Node 进程同时提供 **API 与前端**（单端口），数据落在本机一个 SQLite 文件里，**备份 = 拷文件**。
- **能力**：结构化 prompt（标题/用户提示词/系统提示词/备注/文件夹/标签/收藏）、**中文可用的全文检索**、
  版本历史（diff + 回滚）、模板变量填值、Markdown 预览（服务端渲染 + XSS 净化 + 高亮）、JSON 导入导出、带认证的管理后台、
  **拖拽排序（自定义顺序）**、API Token / MCP（agent 取用）、使用记录。

> **当前进度：阶段 1–31 已全部完成，已发布 v1.0.0**（P0 + 后续演进全部交付；实际部署仍单独立项）。
> 服务端：认证（cookie + **API Token / Bearer 双通道**）、prompt 增删改查、列表筛选分页、**中文全文检索**、
> 文件夹树（筛选**含全部子目录**，与侧栏计数同口径）与标签、**版本列表 + unified diff + 回滚**、
> **模板变量提取与渲染**、**Markdown 渲染（XSS 净化 + 高亮）**、**JSON 全量导出 / 导入**、
> **CORS 精确白名单**、**使用侧 CLI（`pm get` / `pm render`，纯 HTTP）**、**使用记录（谁在取用）**、
> **自定义排序（`PATCH /api/prompts/order`，槽位保持）**、**修改密码**、**内网直连 / 公网反代两种部署形态**。
> 另有 **MCP server（stdio，只读工具面）**：dsh 等 agent 可直接取用 prompt。
> **浏览器管理后台**也已交付（全部用 Ant Design 组件库）：登录页 / **分栏视图（默认）· 表格 · 卡片三档** /
> 编辑器（双提示词 + 备注 + 文件夹 + 标签 + 收藏 + **应用内全屏**）/ 版本面板（diff + 回滚）/ 变量填值面板 /
> Markdown 预览 / 导入导出（`replace` 二次确认）/ **拖拽排序**（卡片 · 分栏 · 表格 · 文件夹树）/ 修改密码 /
> **表格批量操作**（复选框 + 全选 + 批量收藏/移动/删除 + 二次确认）/ 详情面**元信息行**（文件夹 + 标签可改）/
> 响应式 + 亮暗跟随系统。
> 需求与验收标准见 `BRIEF.md` 第 8 节（**AC-1 … AC-88**）；逐条实测输出见 `PROGRESS.md`（当前状态 + 阶段索引）
> 与 `docs/dev-history/PROGRESS.md`（完整过程记录），验收结论见 `VERIFY.md`。
> ⚠️ **交付 ≠ 已部署**：`deploy/` 里的 systemd unit / env 模板 / 反代样例 / 部署说明是**交付物**，
> 实际安装、开机自启、反代与对外暴露**只在用户明确要求时由 host_manger 执行**。

## 怎么跑

**环境要求**：228 上的 **Node 24.18.0** 与 **npm 11.16.0**（系统自带，不要换 Node 版本、不要装 nvm）；
无需 Docker、无需外部数据库/缓存（SQLite 单文件）。依赖安装**只落在项目内** `node_modules`。

```bash
npm ci                 # 按 package-lock.json 冷装（无需编译器：预编译二进制随包分发）
npm run build          # 服务端编译（tsc）+ 前端构建（vite）→ dist/server、dist/web
npm run migrate        # 幂等迁移，输出 ok: schema at v3（服务启动时也会自动迁移）

# 设置管理口令（唯一入口；口令从 stdin 读，哈希后入库，绝不打印/不落日志/不进环境文件）
printf '%s\n' '你的强口令' | node bin/pm.mjs user set-password --username admin

npm start              # 启动服务（默认 0.0.0.0:8767）
```

**默认监听：`0.0.0.0:8767`**（内网可达，不是 127.0.0.1 —— 只绑回环等于白做）。
端口来自台账分配范围 **8765–8770**；当前 8767 为实测空闲（`ss -ltn` 证据见 `docs/dev-history/PROGRESS.md`）。

```bash
# 临时换端口/数据目录（不动生产文件）
DATA_DIR=$(mktemp -d) PORT=8767 npm start
curl -s http://127.0.0.1:8767/healthz        # {"status":"ok","version":"1.0.0"}（无需认证）

# 认证：除 /healthz 与 /api/login 外，所有 /api/* 未认证一律 401
curl -s -c /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的强口令"}' http://127.0.0.1:8767/api/login
# → {"ok":true,"username":"admin"} + Set-Cookie: pm_sid=…; Path=/; HttpOnly; SameSite=Lax
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/me          # {"username":"admin"}
curl -s -b /tmp/pm-jar -X POST http://127.0.0.1:8767/api/logout   # 204，旧 cookie 立即失效

# 修改密码（界面「⋯更多 → 修改密码」的接口形态）：成功 204，保留当前会话、吊销其它会话
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"old_password":"旧口令","new_password":"新口令至少8字符"}' \
  -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/password   # 204
# 当前口令错 → 400 {"error":"invalid_old_password"}（**不是 401**）；不合规 → 400 invalid_password；限流 → 429

# prompt CRUD（字段：title / user_prompt / system_prompt / notes / folder_id / tags / favorite）
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"title":"会话交接模板","user_prompt":"你好 {{姓名}}","tags":["交接"],"favorite":true}' \
  http://127.0.0.1:8767/api/prompts                  # 201，version_no=1
curl -s -b /tmp/pm-jar -X PUT -H 'Content-Type: application/json' -d '{"notes":"改过的备注"}' \
  http://127.0.0.1:8767/api/prompts/1                # 200，version_no 递增（自动留档）
curl -s -b /tmp/pm-jar -X DELETE http://127.0.0.1:8767/api/prompts/1   # 204

# 列表 / 检索 / 筛选（q 支持中文：≥3 字走 FTS5 相关性排序，两字词走 LIKE 兜底）
curl -s -b /tmp/pm-jar -G --data-urlencode 'q=会话交接' http://127.0.0.1:8767/api/prompts
# folder_id 是**含全部子目录**的筛选（与侧栏计数同口径）；sort 支持 updated / recent_used / custom
curl -s -b /tmp/pm-jar 'http://127.0.0.1:8767/api/prompts?folder_id=1&tag=交接&favorite=true&sort=custom&limit=20'

# 自定义排序（拖拽落库）：ids = 当前视图内的完整新顺序；槽位保持（其他条目不动、不产生重复）
curl -s -b /tmp/pm-jar -X PATCH -H 'Content-Type: application/json' \
  -d '{"ids":[3,1,2]}' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/prompts/order   # 204
# 非法（不存在 / 重复 / 空）→ 400 invalid_body
curl -s -b /tmp/pm-jar -X PATCH -H 'Content-Type: application/json' \
  -d '{"parent_id":null,"ids":[2,1]}' http://127.0.0.1:8767/api/folders/order    # 同层级文件夹重排

# 文件夹（树形：parent_id）与标签（PUT 改名到已存在名字 = 合并）
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' -d '{"name":"运维"}' http://127.0.0.1:8767/api/folders
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/folders
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/tags       # 含每个标签的 count

# 版本历史：每次 PUT 自动留档；可看列表、看 diff、回滚（回滚 = 生成新版本；每个 prompt 最多保留最近 10 个版本）
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/prompts/1/versions
curl -s -b /tmp/pm-jar 'http://127.0.0.1:8767/api/prompts/1/diff?from=1&to=3'
curl -s -b /tmp/pm-jar -X POST http://127.0.0.1:8767/api/prompts/1/versions/1/rollback

# 模板变量：{{变量名}}（支持中文；\{{转义}} 按字面处理）——提取变量、填值渲染（不写库）
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/prompts/1/variables
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"values":{"姓名":"张三"}}' http://127.0.0.1:8767/api/prompts/1/render
# → {"user_prompt":"…","system_prompt":"…","missing":["未填的变量"]}

# Markdown → 净化 HTML（服务端 XSS 净化 + 代码高亮；style 属性与 style/form/input/… 标签被显式禁掉）
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"markdown":"# 标题\n\n```js\nconst a = 1;\n```"}' http://127.0.0.1:8767/api/render/markdown

# API Token：给外部客户端（CLI / MCP / 脚本）用；明文只在创建时返回一次，库里只存 sha256
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' -d '{"name":"cli"}' http://127.0.0.1:8767/api/tokens
# → 201 {"id":1,"name":"cli",…,"token":"pm_…"}   ← 明文仅此一次
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/tokens                 # 列表（不含明文）
curl -s -b /tmp/pm-jar -X DELETE http://127.0.0.1:8767/api/tokens/1     # 撤销（立即失效）
curl -s -H "Authorization: Bearer pm_…" http://127.0.0.1:8767/api/prompts   # 与 cookie 并存的第二条通道

# 使用记录：谁在取用（只记"详情/渲染/MCP 取用"，列表与搜索不记）
curl -s -H "Authorization: Bearer pm_…" 'http://127.0.0.1:8767/api/usage/summary?days=7'
curl -s -H "Authorization: Bearer pm_…" 'http://127.0.0.1:8767/api/prompts?sort=recent_used'   # 最近使用在前

# 备份 / 恢复：全量 JSON 导出（导入导出用于备份与迁移，schema_version 目前为 1）
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/export > backup.json
node bin/pm.mjs export --out backup.json          # 与上面的 API 同格式（CLI 备份，无需起服务）
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d "{\"mode\":\"replace\",\"data\":$(cat backup.json)}" http://127.0.0.1:8767/api/import
# mode=merge 则不清库：同名文件夹/标签复用，prompt 一律新建

# 内网另一台机器：把 127.0.0.1 换成 192.168.0.228
```

**使用侧 CLI（`pm get` / `pm render` / `pm token`）** —— `get`/`render` **一律经 HTTP API**，不直连数据库：

```bash
# token 子命令：设了 PM_API_URL+PM_API_TOKEN 就走 HTTP；都没设时是本机引导（创建第一个 token 用）
export PM_API_URL=http://127.0.0.1:8767
export PM_API_TOKEN=pm_…                     # 从上面 /api/tokens 或 `pm token create` 拿

node bin/pm.mjs token list                   # 列出（不含明文）
node bin/pm.mjs get '会话交接' --json         # 检索（输出 JSON 数组）
node bin/pm.mjs get --id 3 --json            # 按 id 取单条
node bin/pm.mjs render --id 3 --set 姓名=张三  # 渲染变量 → stdout 就是成品文本
node bin/pm.mjs get --id 3                   # 人类可读
```

**部署形态**：内网直连（HTTP）与公网反代（HTTPS 终结）都要支持，见 `deploy/README.md` §2.7 与
`deploy/reverse-proxy.example.conf`（占位符模板）。三个开关：`TRUST_PROXY`（默认关）、`PUBLIC_ORIGIN`、`CORS_ORIGINS`。

**MCP server（stdio，给 agent 取用）** —— 三个**只读**工具：`prompt_search` / `prompt_get` / `prompt_render`；
**不监听任何端口**，数据只经本服务的 HTTP API + Bearer（`PM_API_URL` + `PM_API_TOKEN`），不直连数据库：

```bash
# 直接拉起（stdio；stdout 是 JSON-RPC 通道，诊断在 stderr）
PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=pm_… node bin/pm-mcp.mjs

# 经 ssh 从别的机器拉起（228 的 node = /usr/bin/node）
ssh 228 'sudo env PM_API_URL=http://192.168.0.228:8767 PM_API_TOKEN=pm_… /usr/bin/node /opt/promptmanager/bin/pm-mcp.mjs'

# 真实对端 smoke（官方 Python 客户端 mcp==1.30.0，协议 2025-11-25）
uv venv --python 3.14 .venv && uv pip install --python .venv/bin/python mcp==1.30.0
PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=pm_… .venv/bin/python tools/mcp-client-smoke.py '会话交接' 1
```

客户端注册片段示例见 `deploy/mcp-register.example.json`（token 用占位符）。
经 MCP 的 `prompt_get` / `prompt_render` 取用会计入使用记录（`by_channel.mcp`）。

**环境变量**（默认值即"开箱可用"，全部可覆盖）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址（**不要**改成 127.0.0.1，内网就访问不到了） |
| `PORT` | `8767` | 监听端口（只从 8765–8770 里选） |
| `DATA_DIR` | `<项目>/data` | 数据目录，内含 `pm.db`（SQLite，WAL）与 `media/` |
| `CORS_ORIGINS` | 空（关闭） | CORS 精确白名单，逗号分隔（如 `https://prompt.home.local`）；**禁止 `*`**；留空 = 完全没有 CORS 头 |
| `TRUST_PROXY` | 空（关闭） | 仅确有反代时设 `1`：来源 IP 取 `X-Forwarded-For`。关闭时伪造 XFF **不影响**登录限流 |
| `PUBLIC_ORIGIN` | 空（不设） | 公网 HTTPS 形态填公开地址（如 `https://prompt.example.com`）→ 会话 cookie 追加 `Secure`；内网 HTTP 必须留空 |
| `SESSION_TTL_HOURS` | `720` | 会话有效期（服务端会话，过期即失效） |
| `LOGIN_MAX_FAILURES` | `5` | 登录失败阈值（窗口内，按 `username + 来源 IP` 计；达阈值后第 6 次 429 + `Retry-After`） |
| `LOGIN_WINDOW_SECONDS` | `60` | 登录失败统计窗口（窗口过期自动解锁；登录成功清除该键失败记录） |

> 另有常量（非环境变量，BRIEF §6.3 的环境变量表是固定契约、不外扩）：`/api/login` 每 IP 30 次/60 秒的
> 请求级洪泛保护（`src/server/routes/auth.ts`）；**改密码接口复用同一套失败阈值**（`login_attempts`）。

**CLI**（`bin/pm.mjs`；退出码 0 成功 / 1 运行时错误 / 2 用法错误）

```bash
node bin/pm.mjs migrate                          # 幂等迁移 → ok: schema at v3
printf '%s\n' '你的强口令' | node bin/pm.mjs user set-password --username admin
                                                 # → ok: user admin password updated（绝不打印口令）
                                                 # 口令轮换会吊销该用户全部既有会话（与界面「修改密码」不同：
                                                 # 界面路径保留当前会话、只吊销其它会话）
node bin/pm.mjs export --out backup.json             # 全量导出
```

**部署**：本项目跑在 228 上，当前部署形态是 **systemd**（非容器）。
交付物在 `deploy/`：`promptmanager.service`（非 root、`EnvironmentFile`、`Restart=always`、
不开与 V8 JIT 冲突的内存写执行加固）+ `promptmanager.env.example`（口令类值留空）+ `deploy/README.md`（安装/验证/回滚三步）。
语法自检：`systemd-analyze verify deploy/promptmanager.service`（退出码 0）。
**即将新增容器化部署**（`Dockerfile` + `docker-compose.yml`，由 **host_manger** 交付；本仓库暂不含容器文件）。
**交付 ≠ 已部署**：实际安装/开机自启/反代只在用户明确要求时由 host_manger 执行。

## 界面（前端）

前端与 API **由同一个进程、同一个端口**提供（FR-12）：浏览器打开 `http://<主机>:8767/` 即是管理后台。

**顶栏**：品牌（「>_」图标 + 文字 **`PromptM`**，阶段 25 起顶栏用简称；浏览器标签页 / 登录页 / 关于页 / 错误文案仍是全名 `PromptManager`）
· `＋新建` · `⋯更多`（使用统计 → API 令牌 → 导入 / 导出 → 关于 → **修改密码** → 登出）· 主题图标（三态循环：跟随系统 / 亮 / 暗）· 登出。
**默认落「分栏视图」**（左栏筛选 + 中栏列表 + 右栏详情；旧「列表视图」已在阶段 14 删除），另有 **表格** 与 **卡片** 两档。

| 页面 / 面板 | 能做什么 | 用到的接口 |
| --- | --- | --- |
| 登录页 | 用户名 + 口令登录（会话 cookie）；失败/限流有可读提示 | `POST /api/login`、`GET /api/me` |
| 分栏 · 中栏 | 每条 = **标题 + 备注（固定两行）**；单击切换右栏；可拖拽排序；**默认三档视图** | `GET /api/prompts?q=&folder_id=&tag=&favorite=&sort=&limit=&offset=` |
| 表格 · 卡片 | 表格：行内编辑/删除/收藏/复制 + **行拖拽排序** + **批量操作**（首列复选框 + 表头全选 → 工具条「已选择 N 项」+ 批量收藏/移动/删除 + 取消；删除二次确认）+「标签」列内多个标签**间隙 4px、超出列宽自动换行**（阶段 31）；卡片：正文摘要 + 标签 + 元信息 + **卡片本体可拖** | 同上、`POST /api/prompts/bulk` |
| 左栏 | 文件夹树（增/改名/删 + 点击筛选 + **同层级拖拽排序**；筛选**含全部子目录**，与计数同口径）、标签列表（含计数） | `/api/folders`、`/api/tags` |
| 详情面（右栏） | 标题 + **标题下备注行**（纯文本，不解析 Markdown）+ **元信息行**（文件夹下拉可改含「未归类」+ 标签胶囊 `#`/`✕` 可增删，即时落库）+ 字段页签（**只有 用户提示词 / 系统提示词**，阶段 27 起无「备注」页签）+ 预览/源码 + 显示纯文本 + **应用内全屏** + 版本历史（阶段 27 起**不再有变量填值区块**） | `GET /api/prompts/:id`、`PUT /api/prompts/:id` |
| 编辑器 | 标题 / 用户提示词 / 系统提示词 / 备注 / 文件夹 / 标签 / 收藏；保存即产生新版本；**应用内全屏** | `POST/PUT /api/prompts` |
| 版本历史 | 版本列表、任选两版看 unified diff（红删绿增）、回滚（生成新版本；**最多保留最近 10 个版本**，面板上有可见文案） | `/versions`、`/diff`、`/versions/:n/rollback` |
| 变量填值 | 自动提取 `{{变量}}` → 填值 → 渲染成品，一键复制（渲染不写库） | `/variables`、`/render` |
| Markdown 预览 | 直接把文本交给服务端渲染（净化 + 高亮都在服务端，前端不重写） | `POST /api/render/markdown` |
| 导入 / 导出 | 全量 JSON 导出下载；导入前本地解析出"将新增 N 条"；**`replace` 必须二次确认并明示会清空什么**（FR-11b） | `GET /api/export`、`POST /api/import` |
| ⋯更多 → 修改密码 | 当前 / 新 / 确认三个口令框；前端校验（≥8 码点、不得与当前相同、两次一致）→ `POST /api/password` | `POST /api/password` |
| ⋯更多 → 使用统计 / API 令牌 / 关于 | 使用统计（FR-19）、令牌管理（明文只显示一次）、关于本服务（含 `/healthz` 自检） | `/api/usage/summary`、`/api/tokens` |

- **UI 一律来自 Ant Design 组件库**（`antd@6.6.4` + `@ant-design/icons@6.3.4`，均 MIT）；
  **没有自建基础组件、没有第二套样式体系（不引 Tailwind）、没有 CDN**（组件库与样式随构建本地打包）。
- **拖拽排序**用 `@dnd-kit`（MIT，阶段 22 引入）：卡片 / 分栏 / 表格 / 文件夹树四处，**同层级重排**，
  落库走 `PATCH /api/prompts/order`（**槽位保持**：只在这些条目已占的 `sort_order` 槽位间重排，其他条目不受影响），
  拖后自动切到「自定义」排序档并持久化；手柄常显、`cursor: grab`，条目本体也可拖（单击/双击不受影响）。
- **亮/暗主题**：`ConfigProvider` + `theme.algorithm`，顶栏主题图标三态循环（跟随系统 / 强制亮 / 强制暗）；
  界面文案用 antd 内置 `zh_CN`。
- **响应式**：`Grid.useBreakpoint()` 断点切换——手机（<768px）时左栏收进抽屉、列表换卡片式、顶栏只留图标与操作。
- **首屏瘦身（阶段 18）**：10 处重组件走 `React.lazy` + 动态 `import()`（编辑器 / Markdown 预览 / 版本 diff /
  导入导出 / 使用统计 / 令牌 / 修改密码 / 关于 / 变量面板 / 变量对话框），并按 vendor（react / antd / rc / misc）分包。
- **界面自证（AC-13）**：`bash tools/ui-shots.sh` 会**自起自停**一个临时实例（临时 `DATA_DIR`、真实登录 cookie、
  零安装 headless chromium）。**自证截图默认落 `tmp/ui-shots/shots/`（不入库）**；只有发版/交付前用
  `bash tools/ui-shots.sh --key` 产一套**关键页面展示图（8 张）**到 `docs/shots/`（旧的先归档到 `tmp/shots-archive/`），
  并 dump 渲染后 DOM 供 AC-21 统计 `ant-*` 类名；逐张识图结论记在 `docs/dev-history/PROGRESS.md` 各阶段一节。
  规范见 `STANDARDS.md` §5.2（`docs/` 只放最终状态、过程产物进 `tmp/`）。

## 代码质量检查（本地与 CI 同一套）

```bash
npm ci                    # 首次（CI 里也由 workflow 先跑这一步）
bash tools/ci-check.sh    # ← 本地与 CI 跑的是**同一个脚本**
```

`tools/ci-check.sh` 依次跑四步并打印**逐项 rc + 关键输出行**的汇总表：

| 步骤 | 命令 | 判据 |
| --- | --- | --- |
| ① 依赖就绪 | 检查 `node_modules` | 缺则提示先 `npm ci` 并停 |
| ② 类型检查 | `npm run typecheck:web` + `npm run typecheck:tests` | 两个都 rc=0、0 个 TS 错误 |
| ③ 全量测试 | `npm test`（自带构建与类型检查） | `fail 0`（当前 **319/319**） |
| ④ 构建 + 体积预算 | `npm run build` + 量 `dist/web/assets/*.js` | 无 `larger than 500 kB` 告警，且**最大 chunk ≤ 500 KB** |

CI 侧：`.github/workflows/ci.yml`（push / PR 触发）**只做 `npm ci` + 调 `tools/ci-check.sh`** ——
所以"CI 一套、本地另一套"不会发生；workflow 用 **Node 24**（与生产一致），**不需要任何 secrets**，
也不做部署/发布（远程仓库绑定与 push 由用户另行安排）。

## 怎么验证

```bash
npm test                       # 全量测试（node:test；57 个测试文件 / 319 个用例，自带构建与类型检查）
bash tools/ac-stage1.sh        # 阶段 1：AC-1 / AC-2 / AC-16（部分）/ AC-18 / AC-19（+ AC-20/21 预览）
bash tools/ac-stage2.sh        # 阶段 2：AC-3 / AC-4 / AC-15
bash tools/ac-stage3.sh        # 阶段 3：AC-5 / AC-6 / AC-7 / AC-14
bash tools/ac-stage4.sh        # 阶段 4：AC-8 / AC-9 / AC-12
bash tools/ac-stage5.sh        # 阶段 5：AC-10 / AC-11
bash tools/ac-stage6.sh        # 阶段 6：AC-22 / AC-23 / AC-24 / AC-27 / AC-28
bash tools/ac-stage7.sh        # 阶段 7：AC-25 / AC-26（真实 Python MCP 客户端）
bash tools/ac-stage8.sh        # 阶段 8：AC-13 / AC-20 / AC-21（截图 + 组件库机械证据）
bash tools/ac-stage10.sh       # 阶段 10：AC-13（结构侧）/ AC-20 / AC-21 / AC-29 / AC-30 / AC-31
bash tools/ac-stage11.sh       # 阶段 11：AC-33 / AC-33b / AC-33c / AC-35 / AC-36（AC-34 已作废）
bash tools/ac-stage12.sh       # 阶段 12：AC-37 / AC-39 / AC-40（AC-38 已由 AC-41 修订取代）
bash tools/ac-stage13.sh       # 阶段 13：AC-41 / AC-42 / AC-43
bash tools/ac-stage14.sh       # 阶段 14：AC-44 / AC-45 / AC-46
bash tools/ac-stage15.sh       # 阶段 15：AC-47 / AC-48 / AC-49 / AC-50
bash tools/ac-stage16.sh       # 阶段 16：AC-51 / AC-52 / AC-53 / AC-54 / AC-55 / AC-56 / AC-57 / AC-58
bash tools/ac-stage17.sh       # 阶段 17：AC-59
bash tools/ac-stage18.sh       # 阶段 18：AC-60 / AC-61（懒加载 + 体积预算；AC-62 形态已由 AC-63 取代）
bash tools/ac-stage19.sh       # 阶段 19：AC-63 / AC-64 / AC-65（应用内全屏 / diff 尾换行 / 内网复制）
bash tools/ac-stage20.sh       # 阶段 20：AC-66 / AC-67（详情页去冗余头部 / 修改密码）
bash tools/ac-stage21.sh       # 阶段 21：AC-68 / AC-69（备注纯文本 / 标题下备注行）
bash tools/ac-stage22.sh       # 阶段 22：AC-70 / AC-71（拖拽排序 / 分栏中栏精简）
bash tools/ac-stage23.sh       # 阶段 23：AC-72 / AC-73 / AC-74（目录含子项 / 卡片贴底 / 表格拖拽）
bash tools/ac-stage24.sh       # 阶段 24：AC-75（拖拽在全部视图生效 + 槽位保持）
bash tools/ac-stage25.sh       # 阶段 25：AC-76（顶栏品牌文字 PromptM；另含 AC-47 / AC-51 回归）
bash tools/ac-stage27.sh       # 阶段 27：AC-78 / AC-79 / AC-80 / AC-81 / AC-82（表格批量 / 详情元信息行 / 两页签 / 去变量区块 / 弹窗尺寸）
bash tools/ac-stage29.sh       # 阶段 29：AC-84 / AC-85（表格批量 UI 半选态·尺寸·间距 / 详情元信息行间距·换行·chip 统一）
bash tools/ac-stage31.sh       # 阶段 31：AC-87 / AC-88（表格「标签」列间距真实像素 / 版本最多保留最近 10 个·直查库）
bash tools/ui-shots.sh         # 界面自证：全套 → tmp/ui-shots/shots/（默认，不入库）；--key = 关键展示图 8 张 → docs/shots/
# 该脚本会**自起自停**一个临时实例（临时 `DATA_DIR`、真实登录 cookie、零安装 headless chromium），
# 并 dump 渲染后 DOM 供 AC-21 统计 `ant-*` 类名；逐张识图结论记在 `docs/dev-history/PROGRESS.md` 各阶段一节。

## 代码质量检查（本地与 CI 同一套）

```bash
npm ci                    # 首次（CI 里也由 workflow 先跑这一步）
bash tools/ci-check.sh    # ← 本地与 CI 跑的是**同一个脚本**
```

`tools/ci-check.sh` 依次跑四步并打印**逐项 rc + 关键输出行**的汇总表：

| 步骤 | 命令 | 判据 |
| --- | --- | --- |
| ① 依赖就绪 | 检查 `node_modules` | 缺则提示先 `npm ci` 并停 |
| ② 类型检查 | `npm run typecheck:web` + `npm run typecheck:tests` | 两个都 rc=0、0 个 TS 错误 |
| ③ 全量测试 | `npm test`（自带构建与类型检查） | `fail 0`（当前 **319/319**） |
| ④ 构建 + 体积预算 | `npm run build` + 量 `dist/web/assets/*.js` | 无 `larger than 500 kB` 告警，且**最大 chunk ≤ 500 KB** |

CI 侧：`.github/workflows/ci.yml`（push / PR 触发）**只做 `npm ci` + 调 `tools/ci-check.sh`** ——
所以"CI 一套、本地另一套"不会发生；workflow 用 **Node 24**（与生产一致），**不需要任何 secrets**，
也不做部署/发布（远程仓库绑定与 push 由用户另行安排）。

## 怎么验证

```bash
npm test                       # 全量测试（node:test；57 个测试文件 / 319 个用例，自带构建与类型检查）
bash tools/ac-stage1.sh        # 阶段 1：AC-1 / AC-2 / AC-17 / AC-18 / AC-19
bash tools/ac-stage2.sh        # 阶段 2：AC-3 / AC-4 / AC-15
bash tools/ac-stage3.sh        # 阶段 3：AC-5 / AC-6 / AC-7 / AC-14
bash tools/ac-stage4.sh        # 阶段 4：AC-8 / AC-9 / AC-12
bash tools/ac-stage5.sh        # 阶段 5：AC-10 / AC-11
bash tools/ac-stage6.sh        # 阶段 6：AC-22 / AC-23 / AC-24 / AC-27 / AC-28
bash tools/ac-stage7.sh        # 阶段 7：AC-25 / AC-26（真实 Python MCP 客户端）
bash tools/ac-stage8.sh        # 阶段 8：AC-13 / AC-20 / AC-21（截图 + 组件库机械证据）
bash tools/ac-stage9.sh        # 阶段 9：CLI / MCP 补充面
bash tools/ac-stage10.sh       # 阶段 10：AC-29 / AC-31 / AC-13（结构侧）/ AC-20 / AC-21
bash tools/ac-stage11.sh       # 阶段 11：AC-33 / AC-33b / AC-33c / AC-35 / AC-36
bash tools/ac-stage12.sh       # 阶段 12：AC-37 / AC-39 / AC-40
bash tools/ac-stage13.sh       # 阶段 13：AC-41 / AC-42 / AC-43
bash tools/ac-stage14.sh       # 阶段 14：AC-44 / AC-45 / AC-46
bash tools/ac-stage15.sh       # 阶段 15：AC-47 / AC-48 / AC-49 / AC-50
bash tools/ac-stage16.sh       # 阶段 16：AC-51 … AC-58
bash tools/ac-stage17.sh       # 阶段 17：AC-59
bash tools/ac-stage18.sh       # 阶段 18：AC-60 / AC-61（懒加载 + 体积预算）
bash tools/ac-stage19.sh       # 阶段 19：AC-63 / AC-64 / AC-65（应用内全屏 / diff 尾换行 / 内网复制）
bash tools/ac-stage20.sh       # 阶段 20：AC-66 / AC-67（详情页去冗余头部 / 修改密码）
bash tools/ac-stage21.sh       # 阶段 21：AC-68 / AC-69（备注纯文本 / 标题下备注行）
bash tools/ac-stage22.sh       # 阶段 22：AC-70 / AC-71（拖拽排序 / 分栏中栏精简）
bash tools/ac-stage23.sh       # 阶段 23：AC-72 / AC-73 / AC-74（目录含子项 / 卡片贴底 / 表格拖拽）
bash tools/ac-stage24.sh       # 阶段 24：AC-75（拖拽在全部视图生效 + 槽位保持）
bash tools/ac-stage25.sh       # 阶段 25：AC-76（顶栏品牌文字 PromptM + 其余四处保持全名）
bash tools/ac-stage27.sh       # 阶段 27：AC-78 / AC-79 / AC-80 / AC-81 / AC-82
bash tools/ac-stage29.sh       # 阶段 29：AC-84 / AC-85（表格批量 UI / 详情元信息行 视觉细化）
bash tools/ac-stage31.sh       # 阶段 31：AC-87 / AC-88（标签列间距 / 版本保留上限 10）
bash tools/ui-shots.sh         # 界面自证：全套截图 → tmp/ui-shots/shots/（默认，不入库）
bash tools/ui-shots.sh --key   # 发版/交付：关键页面展示图 8 张 → docs/shots/（旧的先归档到 tmp/）
DATA_DIR=$(mktemp -d) node tools/seed-prompts.mjs 2000   # AC-7 的 2000 条中文夹具（直接写库，触发器同步 FTS）
bash -c 'systemd-analyze verify deploy/promptmanager.service; echo rc=$?'   # 部署文件语法
```

- **阶段 9 没有独立脚本**（`tools/ac-stage9.sh` 不存在）：它的 AC-16（全量测试）/ AC-17（凭据与产物卫生）/ AC-18（部署文件语法）
  分别由 `npm test`、`git check-ignore` + `git grep` 凭据扫描、`systemd-analyze verify` 覆盖（`ac-stage1.sh` 里另有一段 AC-16 的抽查）。
- 逐条 **验收标准（AC-1 … AC-88）** 见 `BRIEF.md` 第 8 节；每条的实际命令与**原样输出**记录在
  `docs/dev-history/PROGRESS.md`（完整过程）与根目录 `PROGRESS.md`（当前状态 + 阶段索引）。
- 中文检索方案（本项目的最大风险点）有独立实测报告：`docs/search-zh.md`（含 2000 条规模基线与特殊字符安全性）。
- 依赖、版本、协议与安全审计证据：`docs/dependencies.md`。

## 已知限制

- **阶段边界**：阶段 1–31 已全部交付（P0 + 后续演进）；v1.0.0。
- **前端已知限制**：
  ① **没有 URL 路由/深链**——列表 ↔ 编辑器是应用内视图状态（覆盖式浮层 + `Tabs`），刷新会回到列表、不能用浏览器前进/后退；
  ② 未做**快捷键面板**（表格**批量操作**已在阶段 27 交付：首列复选框 + 表头全选 + 批量收藏/移动/删除 + 二次确认；
     拖拽排序已在阶段 22/24 交付：卡片 · 分栏 · 表格 · 文件夹树，同层级重排）；
  ③ 搜索是「提交后查询 + 300ms 防抖」（`Input.Search`），没有真正的输入即搜；
  ④ **bundle 体积（阶段 18 瘦身后，阶段 31 复测）**：最大单 chunk = `vendor-antd` **460 kB**（470,985 B / gzip 137 kB），
     首屏入口 `index` **53 kB**（54,321 B / gzip 17 kB），其余重组件走懒加载（`app-lazy` 112 kB / 用时才取）；
     全量 js+css 合计 raw ≈ **1.3 MB**（1,342,418 B）/ gzip ≈ **409 kB**（418,757 B）。构建**无** `larger than 500 kB` 告警；
     体积预算由 `tests/stage18-bundle.test.ts` 守住（含各阶段已对账增量：阶段 18 / 22 / 27 / 29 / 31）；
  ⑤ 变量面板的填值不做持久化（渲染不写库，符合 FR-8 契约）；切换 prompt 会清空填值。
- **导入导出语义**：`GET /api/export` 输出 `{app,schema_version:1,exported_at,folders,tags,prompts}`（prompt 内嵌 `versions`；
  folders/tags/prompts 按 id 升序、versions 按 version_no 升序、tags 数组按名称升序，`exported_at` 是唯一非确定字段）。
  `POST /api/import` 校验 `app`/`schema_version`，并**拒绝缺 `title` 或 `user_prompt` 的 prompt 条目**（FR-10b）；
  任何不合法 → `400 invalid_import` 且**不动任何数据**（校验全在事务之前），**单事务原子写入**；
  `replace` 清空内容表后按文件重建并**保留文件里的 id**，`merge` 不清库、同名同父文件夹与同名标签复用、**prompt 一律新建并分配新 id**。
  单次导入请求体上限 **32MB**；导出不含账号/会话（只有内容）。
  ⚠️ **契约值 `app` 恒为小写 `promptmanager`**（显示名与顶栏简称 `PromptM` 都不影响它 —— 改它会让你已有的导出文件全部导入失败）。
- **Markdown 净化硬化**：除 `<script>`/`javascript:`/事件属性外，`style` 属性与
  `style/form/input/button/math/mtext/link/meta/base` 标签也被显式禁止（防 UI 伪装 / CSS 注入）。
- **API Token**：明文 `pm_` + 32 字节随机（base64url），**只在创建响应里出现一次**；库里只存 `sha256` hex(64)；
  可列出（不含明文）与撤销（**撤销立即失效**）；记录 `last_used_at`；与 cookie 会话并存、单用户下不做 scope 分层。
- **修改密码（界面路径）**：成功 **204 无 body**；当前口令错 → `400 invalid_old_password`（**不是 401**，避免前端误判成"未登录"）；
  新口令 <8 个 Unicode 码点或与当前相同 → `400 invalid_password` + `message`；复用登录限流（5 次 / 60 秒 → 429，成功即清零）；
  **成功后保留当前会话、吊销该用户其它会话**（CLI `user set-password` 则吊销**全部**会话，语义不同、已文档化）。
- **CORS**：默认**完全关闭**（连 CORS 头都没有）；`CORS_ORIGINS` 必须写精确 origin（写 `*` 启动即报错）；
  永远不发 `Access-Control-Allow-Credentials`；CORS 只影响跨域可见性，**不放宽认证**。
- **使用记录**：只记"取用"——`GET /api/prompts/:id`、`POST /api/prompts/:id/render`，以及带
  `X-PM-Channel: mcp` 的 Bearer 调用；**列表/搜索不记**。写 usage **不产生版本、不改 `updated_at`**；
  `?sort=recent_used` 把从未用过的排在最后；**usage 不参与导入导出**。
- **MCP server**：`bin/pm-mcp.mjs` 走 **stdio**（由客户端拉起），**不监听端口**；工具面**恰好三个只读工具**
  （`prompt_search` / `prompt_get` / `prompt_render`），**没有任何写操作**；数据只经 HTTP API + Bearer。
  协议版本与官方 TS SDK 的 `LATEST_PROTOCOL_VERSION = 2025-11-25` 一致（与真实对端 Python `mcp` 1.30.0 实测协商成功）。
  **已知限制**：① 只支持 stdio；② 必须提供 `PM_API_TOKEN`；③ 服务停掉时工具返回连接错误（证明不直连 DB）；
  ④ 取用会计入 usage（`mcp` 通道）；⑤ 宿主注册由使用方自行完成。
- **两种部署形态**：服务**不做 TLS**；公网形态由反代终结 HTTPS 并把 `X-Forwarded-For`/`-Proto` 转给服务，
  此时才设 `TRUST_PROXY=1` 与 `PUBLIC_ORIGIN`。内网直连形态两者都留空。
- **版本与回滚语义**：`PUT` 每次产生新版本；`GET /versions` 升序含首版；`diff` 是四段带标记的规范文本
  （`[title]`/`[user_prompt]`/`[system_prompt]`/`[notes]`）的 unified diff；**回滚只回滚内容四字段**并生成新版本；
  标签/文件夹/收藏不在版本快照里。`diff` 缺参/非法/越界 → `400`，prompt 或版本不存在 → `404`。
  **版本保留上限（FR-86）**：每个 prompt 在 `prompt_versions` 里**最多保留最近 10 个版本**（`version_no` 最大的 10 行），
  超出的**从表中真删**（不是隐藏）；**当前版本永远在保留集合内**，裁剪**只删行、不重编号**。
  触发点是**每次产生新版本之后**（新建 / 更新 PUT / 回滚 / 导入 / 批量收藏·移动），与写入同事务完成。
  **存量数据不做一次性迁移**：历史遗留的多余版本在**下一次产生新版本**时被自然裁剪。
  ⚠️ **已知张力（BRIEF v41 FR-86 明确以该 FR 为准）**：这条上限优先于"`replace` 模式保留文件里的 id /
  导出→导入→再导出应逐字一致"——若导出文件里某个 prompt 的版本**多于 10 个**，导入后只留最近 10 个，
  于是"再导出"会比原文件少掉最旧的几版（其余内容、id、标签、文件夹仍逐字一致）。
  ⚠️ 另一个推论：回滚到**已被裁剪掉**的版本会返回 **404**（该版本确实不在库里了），而回滚到仍在保留集合内的版本照常生成新版本。
- **变量语义**：提取范围 = `user_prompt` + `system_prompt`（按此顺序去重）；名字 1–64 字符、含中文、不含空白；
  `\{{name}}` 转义；未提供值的变量**原样保留**并列入 `missing`；**渲染不写库**。
- **Markdown**：`marked` → `highlight.js`（`lib/common`）→ `DOMPurify` 净化；代码块超过 20000 字符时跳过自动识别语言；
  请求体上限 200000 字符。⚠️ 服务端净化需要 DOM（`jsdom` 模块加载时建一个复用 window）：起完整服务后
  `VmRSS ≈ 204 MB`（实测 2026-09-18）——单机自托管可接受。
- **文件夹**：`DELETE /api/folders/:id` 在有子文件夹**或**有 prompt 归属时返回 `409 folder_not_empty`；
  挂到自己或后代下会被拒（`400`）；同一父下不允许重名。`GET /api/prompts?folder_id=X` 是**含全部后代**的筛选。
- **标签**：`POST /api/tags` 遇重名返回 `400`；`PUT /api/tags/:id` 改名到已存在的名字即**合并**。
- **会话与安全**：单用户；cookie `pm_sid`（`HttpOnly; SameSite=Lax; Path=/`，库里只存 token 的 sha256）；
  登录失败达阈值后**封锁期内即使口令正确也返回 429**，直到窗口过期。服务仍**只应暴露在可信内网**。
- **不做**：RAG / 向量检索 / AI 调用、Skill/MCP/rules 管理、桌面与移动壳、媒体上传（P1）、
  外部同步（WebDAV/S3）、多视图与图谱、i18n 多语言、PromptHub 数据迁移。
- **检索**：`FTS5 trigram` 只支持 **≥3 个 Unicode 码点**的查询，`<3`（如中文两字词）走 `LIKE '%…%'` 全表扫描兜底
  ——2000 行量级实测 0.2 ms，但数据量到 **10 万行量级需要重新评估**。`bm25` 在小语料可能同分，此时按 `updated_at` 倒序；
  `limit` 超上限**截断**到 200。
- **运行时不联网**：不引 CDN、不发遥测、不调外部 API（组件库与样式随构建本地打包）。
- **备份不默认做**：`DATA_DIR/pm.db`（WAL 模式连同 `-wal`/`-shm`）自己拷走即可；托管备份只在用户要求时由 host_manger 配置。

## 文档

- `BRIEF.md` —— 需求合同与逐条验收标准（唯一需求来源，只读；AC-1 … AC-88）
- `PROGRESS.md` —— **当前状态 + 阶段索引**（完整过程记录见 `docs/dev-history/PROGRESS.md`）
- `QUESTIONS.md` —— 待决问题模板（历史问答见 `docs/dev-history/QUESTIONS-history.md`）
- `VERIFY.md` —— 验收报告（host_manger 写）
- `docs/search-zh.md` —— 中文检索方案实测报告
- `CHANGELOG.md` —— 更新日志（Keep a Changelog 风格）
- `docs/versioning.md` —— 版本管理规划（semver 规则 / tag 约定 / 发版流程 / `schema_version` 解耦）
- `docs/dependencies.md` —— 依赖清单 + 协议 + 安全审计
- `deploy/README.md` —— systemd 安装 / 验证 / 回滚
- `docs/dev-history/` —— 开发过程档案（完整 PROGRESS、历史 QUESTIONS、阶段 10A 的设计打样、各阶段验收截图）
