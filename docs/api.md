# 接口 / CLI / MCP 参考

> 面向：**要对接本服务的开发者与脚本作者**（写脚本、接 MCP、用 CLI 取用 prompt）。
> 只想把服务跑起来用界面的话，看 [`../README.md`](../README.md) 就够了。

---

## 1. 认证

两种通道**并存**，任一即可：

| 通道 | 用途 | 形态 |
| --- | --- | --- |
| **会话 cookie** | 浏览器界面 | `POST /api/login` 成功后下发 `pm_sid`（`HttpOnly; SameSite=Lax; Path=/`）；库里只存 token 的 sha256 |
| **API Token（Bearer）** | 脚本 / CLI / MCP | 请求头 `Authorization: Bearer pm_…`；明文只在创建时返回一次，库里只存 sha256 |

**除 `/healthz` 与 `/api/login` 外，所有 `/api/*` 未认证一律 `401`。**

```bash
# 登录（拿 cookie）
curl -s -c /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的强口令"}' http://127.0.0.1:8767/api/login
# → {"ok":true,"username":"admin"} + Set-Cookie: pm_sid=…; Path=/; HttpOnly; SameSite=Lax
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/me                 # {"username":"admin"}
curl -s -b /tmp/pm-jar -X POST http://127.0.0.1:8767/api/logout     # 204，旧 cookie 立即失效

# 健康检查（无需认证；version 从 package.json 单一来源读取）
curl -s http://127.0.0.1:8767/healthz        # {"status":"ok","version":"1.0.2"}

# 内网另一台机器：把 127.0.0.1 换成服务所在主机的内网 IP（如 192.168.0.228）
```

**修改密码**（界面「⋯更多 → 修改密码」的接口形态）：成功 **204**，**保留当前会话、吊销该用户其它会话**。

```bash
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"old_password":"旧口令","new_password":"新口令至少8字符"}' \
  -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/password   # 204
```

- 当前口令错 → `400 {"error":"invalid_old_password"}`（**不是 401**，避免前端误判成"未登录"）；
- 新口令 <8 个 Unicode 码点或与当前相同 → `400 invalid_password` + `message`；
- 复用登录限流（5 次 / 60 秒 → `429`，成功即清零）。

> CLI 的 `user set-password` 语义**不同**：它吊销该用户**全部**会话（含当前）。见 §4。

---

## 2. 环境变量

默认值即"开箱可用"，全部可覆盖。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址（**不要**改成 `127.0.0.1`，内网就访问不到了） |
| `PORT` | `8767` | 监听端口 |
| `DATA_DIR` | `<项目>/data` | 数据目录，内含 `pm.db`（SQLite，WAL）与 `media/` |
| `CORS_ORIGINS` | 空（关闭） | CORS 精确白名单，逗号分隔（如 `https://prompt.home.local`）；**禁止 `*`**（写 `*` 启动即报错）；留空 = 完全没有 CORS 头 |
| `TRUST_PROXY` | 空（关闭） | **仅确有反代时**设 `1`：来源 IP 取 `X-Forwarded-For`。关闭时伪造 XFF **不影响**登录限流 |
| `PUBLIC_ORIGIN` | 空（不设） | **公网 HTTPS 形态**填公开地址（如 `https://prompt.example.com`）→ 会话 cookie 追加 `Secure`；**内网 HTTP 必须留空** |
| `SESSION_TTL_HOURS` | `720` | 会话有效期（服务端会话，过期即失效） |
| `LOGIN_MAX_FAILURES` | `5` | 登录失败阈值（窗口内按 `username + 来源 IP` 计；达阈值后第 6 次 `429` + `Retry-After`） |
| `LOGIN_WINDOW_SECONDS` | `60` | 登录失败统计窗口（窗口过期自动解锁；登录成功清除该键失败记录） |

> 另有**常量**（非环境变量）：`/api/login` 每 IP 30 次 / 60 秒的请求级洪泛保护；改密码接口复用同一套失败阈值。

---

## 3. HTTP 接口

### 3.1 prompt 增删改查

字段：`title` / `user_prompt` / `system_prompt` / `notes` / `folder_id` / `tags` / `favorite`。

```bash
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"title":"会话交接模板","user_prompt":"你好 {{姓名}}","tags":["交接"],"favorite":true}' \
  http://127.0.0.1:8767/api/prompts                  # 201，version_no=1
curl -s -b /tmp/pm-jar -X PUT -H 'Content-Type: application/json' -d '{"notes":"改过的备注"}' \
  http://127.0.0.1:8767/api/prompts/1                # 200，version_no 递增（自动留档）
curl -s -b /tmp/pm-jar -X DELETE http://127.0.0.1:8767/api/prompts/1   # 204
```

`PUT` 是**可写字段的子集**：只改传入的字段，其余保持不变；**每次 PUT 都产生一个新版本**（不区分值是否真的变了）。

### 3.2 列表 / 检索 / 筛选

```bash
# q 支持中文：≥3 个码点走 FTS5（trigram）相关性排序，<3（如两字词）走 LIKE 兜底
curl -s -b /tmp/pm-jar -G --data-urlencode 'q=会话交接' http://127.0.0.1:8767/api/prompts

# folder_id 是**含全部子目录**的筛选（与侧栏计数同口径）
# sort 支持 updated（默认）/ recent_used / custom；limit 超上限截断到 200
curl -s -b /tmp/pm-jar 'http://127.0.0.1:8767/api/prompts?folder_id=1&tag=交接&favorite=true&sort=custom&limit=20'
```

| 参数 | 说明 |
| --- | --- |
| `q` | 检索词（空/纯空白 = 不过滤） |
| `folder_id` | 目录筛选，**含全部后代** |
| `tag` | 标签筛选 |
| `favorite` | `true` 只看收藏 |
| `sort` | `updated`（默认）/ `recent_used`（从未取用的排最后）/ `custom`（拖拽出来的顺序） |
| `limit` / `offset` | 分页（`limit` 上限 200，超出截断） |

### 3.3 拖拽排序

```bash
# ids = 当前视图内的**完整新顺序**；服务端"槽位保持"（其它条目的 sort_order 不动、不产生重复）
curl -s -b /tmp/pm-jar -X PATCH -H 'Content-Type: application/json' \
  -d '{"ids":[3,1,2]}' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/api/prompts/order   # 204
# 非法（不存在 / 重复 / 空）→ 400 invalid_body

# 同层级文件夹重排
curl -s -b /tmp/pm-jar -X PATCH -H 'Content-Type: application/json' \
  -d '{"parent_id":null,"ids":[2,1]}' http://127.0.0.1:8767/api/folders/order
```

### 3.4 批量操作

```bash
# action = favorite | move | delete；delete 会连带删除版本历史（不可恢复）
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"action":"favorite","ids":[1,2,3]}' http://127.0.0.1:8767/api/prompts/bulk
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"action":"move","ids":[1,2],"folder_id":4}' http://127.0.0.1:8767/api/prompts/bulk
```

### 3.5 文件夹与标签

```bash
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' -d '{"name":"运维"}' http://127.0.0.1:8767/api/folders
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/folders
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/tags       # 含每个标签的 count
```

- `DELETE /api/folders/:id` 在有子文件夹**或**有 prompt 归属时返回 `409 folder_not_empty`；挂到自己或后代下被拒（`400`）；同一父下不允许重名。
- `POST /api/tags` 遇重名返回 `400`；`PUT /api/tags/:id` 改名到已存在的名字即**合并**。

### 3.6 版本历史

```bash
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/prompts/1/versions        # 升序、含首版
curl -s -b /tmp/pm-jar 'http://127.0.0.1:8767/api/prompts/1/diff?from=1&to=3'
curl -s -b /tmp/pm-jar -X POST http://127.0.0.1:8767/api/prompts/1/versions/1/rollback
```

- `diff` 是四段带标记的规范文本（`[title]`/`[user_prompt]`/`[system_prompt]`/`[notes]`）的 unified diff；
  缺参 / 非法 / 越界 → `400`，prompt 或版本不存在 → `404`。
- **回滚只回滚内容四字段**并生成**新版本**；标签 / 文件夹 / 收藏不在版本快照里。
- **版本保留上限：每个 prompt 最多保留最近 10 个版本**（`version_no` 最大的 10 行），超出的**真删**；
  当前版本永远在保留集合内；裁剪**只删行、不重编号**。触发点是每次产生新版本之后（新建 / 更新 / 回滚 / 导入 / 批量收藏·移动）。
  **不做一次性迁移**：历史遗留的多余版本在下一次产生新版本时被自然裁剪。
  推论：回滚到**已被裁剪掉**的版本会返回 **404**。

### 3.7 模板变量

提取范围 = `user_prompt` + `system_prompt`（按此顺序去重）；名字 1–64 字符、含中文、不含空白；`\{{name}}` 转义。

```bash
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/prompts/1/variables
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"values":{"姓名":"张三"}}' http://127.0.0.1:8767/api/prompts/1/render
# → {"user_prompt":"…","system_prompt":"…","missing":["未填的变量"]}
```

**未提供值的变量原样保留**并列入 `missing`（不会替换成空串）；**渲染不写库**。

### 3.8 Markdown 渲染

```bash
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d '{"markdown":"# 标题\n\n```js\nconst a = 1;\n```"}' http://127.0.0.1:8767/api/render/markdown
```

链路：`marked` → `highlight.js`（`lib/common`）→ `DOMPurify` 净化。除 `<script>` / `javascript:` / 事件属性外，
`style` 属性与 `style/form/input/button/math/mtext/link/meta/base` 标签也被**显式禁止**（防 UI 伪装 / CSS 注入）；
代码块超过 20000 字符时跳过自动识别语言；请求体上限 200000 字符。

### 3.9 API Token

```bash
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' -d '{"name":"cli"}' http://127.0.0.1:8767/api/tokens
# → 201 {"id":1,"name":"cli",…,"token":"pm_…"}   ← 明文仅此一次
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/tokens                 # 列表（不含明文）
curl -s -b /tmp/pm-jar -X DELETE http://127.0.0.1:8767/api/tokens/1     # 撤销（立即失效）
curl -s -H "Authorization: Bearer pm_…" http://127.0.0.1:8767/api/prompts   # 与 cookie 并存的第二条通道
```

明文 = `pm_` + 32 字节随机（base64url）。库里存两样东西：

| 列 | 用途 |
| --- | --- |
| `token_hash`（sha256 hex） | **鉴权唯一依据**（每次请求比对；撤销后立即失效） |
| `token_enc`（AES-256-GCM 密文，`base64(nonce‖tag‖ciphertext)`） | **仅供"随时查看/复制"**；密钥不进库 |

```bash
# 查看明文（FR-94）：**只允许 cookie 会话**（用 Bearer 调 → 403 session_required，避免 token 互相窥视）
curl -s -b /tmp/pm-jar -X POST http://127.0.0.1:8767/api/tokens/1/reveal     # → {"token":"pm_…"}
```

- 列表里每条带 **`revealable: boolean`**（= 库里存了密文，能再查看）；**响应里绝不含明文**。
- 迁移前创建的**旧 token** `revealable=false`，reveal → **409 `token_not_revealable`**（原明文从未落库、不可恢复）
  —— **它的鉴权照样可用**，建议撤销后重建。
- **加密密钥**：env `TOKEN_ENC_KEY`（32 字节 hex）优先；缺失时自动生成到 `<DATA_DIR>/token-enc.key`（600）。
  **密钥丢失不影响鉴权**，只是"看不了"；此时 reveal → **500 `token_enc_key_unavailable`**（附可读说明）。
  ⚠️ 权衡：库与密钥分开保管 ⇒ 只有库泄露拿不到 token；但把**整个数据目录**一起备份 = 钥匙与锁放一起（靠备份落点权限保护）。
- 可列出（不含明文）与撤销；记录 `last_used_at`；单用户下不做 scope 分层。

### 3.10 使用记录

**只记"取用"**：`GET /api/prompts/:id`、`POST /api/prompts/:id/render`，以及带 `X-PM-Channel: mcp` 的 Bearer 调用；
**列表与搜索不记**。写 usage **不产生版本、不改 `updated_at`**；**usage 不参与导入导出**。

```bash
curl -s -H "Authorization: Bearer pm_…" 'http://127.0.0.1:8767/api/usage/summary?days=7'
curl -s -H "Authorization: Bearer pm_…" 'http://127.0.0.1:8767/api/prompts?sort=recent_used'   # 最近使用在前
```

### 3.11 导出 / 导入

```bash
curl -s -b /tmp/pm-jar http://127.0.0.1:8767/api/export > backup.json
node bin/pm.mjs export --out backup.json          # 与上面的 API 同格式（CLI 备份，无需起服务）
curl -s -b /tmp/pm-jar -X POST -H 'Content-Type: application/json' \
  -d "{\"mode\":\"replace\",\"data\":$(cat backup.json)}" http://127.0.0.1:8767/api/import
# mode=merge 则不清库：同名文件夹/标签复用，prompt 一律新建
```

- 导出形状：`{app, schema_version:1, exported_at, folders, tags, prompts}`（prompt 内嵌 `versions`）；
  folders/tags/prompts 按 id 升序、versions 按 `version_no` 升序、tags 数组按名称升序，`exported_at` 是唯一非确定字段；
  **不含账号 / 会话**（只有内容）。
- 导入会校验 `app` / `schema_version`，并**拒绝缺 `title` 或 `user_prompt` 的 prompt 条目**；
  任何不合法 → `400 invalid_import` 且**不动任何数据**（校验全在事务之前），**单事务原子写入**。
- `replace`：清空内容表后按文件重建并**保留文件里的 id**；`merge`：不清库，同名同父文件夹与同名标签复用，prompt 一律新建并分配新 id。
- 单次导入请求体上限 **32MB**。
- ⚠️ **契约值 `app` 恒为小写 `promptmanager`** —— 改它会让已有导出文件全部导入失败。
- ⚠️ 若导出文件里某个 prompt 的版本**多于 10 个**，导入后只留最近 10 个（版本保留上限优先）⇒ "再导出"会比原文件少掉最旧的几版。

### 3.12 错误码速查

| 码 | 含义 |
| --- | --- |
| `400 invalid_body` | 请求体不合法（字段类型 / 引用不存在 / 排序 ids 非法等） |
| `400 invalid_import` | 导入文件不合法（`app` / `schema_version` / 形状），**数据未改动** |
| `400 invalid_old_password` / `invalid_password` | 改密码时当前口令错 / 新口令不合规 |
| `401` | 未认证（除 `/healthz`、`/api/login` 外的全部 `/api/*`） |
| `404` | prompt / 版本 / 令牌不存在（含"回滚到已被裁剪掉的版本"） |
| `409 folder_not_empty` | 删除仍有子目录或仍有 prompt 归属的文件夹 |
| `403 session_required` | 用 Bearer 调 `POST /api/tokens/:id/reveal`（只允许浏览器会话） |
| `409 token_not_revealable` | 该 token 是迁移前创建的（没有密文），明文不可恢复 |
| `500 token_enc_key_unavailable` | 加密密钥缺失/不匹配（**鉴权不受影响**，恢复密钥后可再查看） |
| `429` | 登录失败达阈值（含封锁期内口令正确）；带 `Retry-After` |

---

## 4. 使用侧 CLI（`bin/pm.mjs`）

`get` / `render` **一律经 HTTP API**，不直连数据库。退出码：`0` 成功 / `1` 运行时错误 / `2` 用法错误。

```bash
export PM_API_URL=http://127.0.0.1:8767
export PM_API_TOKEN=pm_…                     # 从 /api/tokens 或 `pm token create` 拿

node bin/pm.mjs get '会话交接' --json         # 检索（输出 JSON 数组）
node bin/pm.mjs get --id 3 --json            # 按 id 取单条
node bin/pm.mjs get --id 3                   # 人类可读
node bin/pm.mjs render --id 3 --set 姓名=张三  # 渲染变量 → stdout 就是成品文本
node bin/pm.mjs token list                   # 列出（不含明文）
node bin/pm.mjs token create --name cli      # 设了 PM_API_URL+PM_API_TOKEN 走 HTTP；都没设时是本机引导
```

服务端管理命令（**在服务所在主机上执行**）：

```bash
node bin/pm.mjs migrate                          # 幂等迁移 → ok: schema at v3（服务启动时也会自动迁移）
printf '%s\n' '你的强口令' | node bin/pm.mjs user set-password --username admin
                                                 # → ok: user admin password updated（绝不打印口令）
                                                 # 注意：该命令会吊销该用户**全部**会话（含当前）
node bin/pm.mjs export --out backup.json         # 全量导出（无需起服务）
```

---

## 5. MCP server（给 agent 取用）

工具面**恰好三个只读工具**：`prompt_search` / `prompt_get` / `prompt_render`，**没有任何写操作**；
数据只经本服务的 HTTP API + Bearer，**不直连数据库**。**两种传输共用同一份工具实现**：

### 5.1 Streamable HTTP（远程接入，推荐）

| 项 | 值 |
| --- | --- |
| 方法 / 路径 | **`POST /mcp`**（**顶层路径**，不在 `/api/` 下） |
| 必需头 | `Authorization: Bearer <API Token>`（与 `/api/*` 同一套 token）；`Content-Type: application/json` |
| 协议 | MCP **Streamable HTTP**，**无状态**（不生成/不校验 session id，不保留会话与消息历史）；POST 以 `application/json` 直接回 |
| 鉴权失败 | 无 token / 无效 / 已撤销 → **401 `{"error":"unauthorized"}`**，且**不会去调内部 API**；**不接受 cookie 会话** |
| 其它方法 | `GET /mcp`（SSE 流）与 `DELETE /mcp`（会话终止）在无状态模式下无意义 → **405 `method_not_allowed`** |
| 凭据透传 | **本次请求携带的 token 就是这次工具调用的凭据**（内部 `/api/*` 调用用它，而非服务端 env 的 `PM_API_TOKEN`）⇒ usage 归属正确、通道记为 `mcp` |

```bash
# 示例：一次 tools/call（无状态，直接 POST JSON-RPC）
curl -s -X POST http://127.0.0.1:8767/mcp \
  -H 'Authorization: Bearer pm_…' -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 用官方 Python 客户端（推荐：客户端里只填 url + Authorization 头）
#   url = http://<主机>:8767/mcp   headers = {"Authorization": "Bearer pm_…"}
```

> 反代形态：把 `/mcp` 一并转发到本服务，并**透传 `Authorization` 头**（见 `../deploy/container.md`）。

### 5.2 stdio（本地子进程）

`bin/pm-mcp.mjs` 走 **stdio**（由客户端拉起），**不监听任何端口**，凭据取 env `PM_API_URL` / `PM_API_TOKEN`。

```bash
# 直接拉起（stdio；stdout 是 JSON-RPC 通道，诊断在 stderr）
PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=pm_… node bin/pm-mcp.mjs

# 经 ssh 从别的机器拉起（把路径换成部署机上的实际路径）
ssh <部署机> 'sudo env PM_API_URL=http://<主机>:8767 PM_API_TOKEN=pm_… /usr/bin/node <部署路径>/bin/pm-mcp.mjs'

# 真实对端 smoke（官方 Python 客户端 mcp==1.30.0，协议 2025-11-25）
uv venv --python 3.14 .venv && uv pip install --python .venv/bin/python mcp==1.30.0
PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=pm_… .venv/bin/python tools/mcp-client-smoke.py '会话交接' 1
```

客户端注册片段示例见 [`../deploy/mcp-register.example.json`](../deploy/mcp-register.example.json)（token 用占位符）。
经 MCP 的 `prompt_get` / `prompt_render` 取用会计入使用记录（`by_channel.mcp`）。

**已知限制**：① 只支持 stdio；② 必须提供 `PM_API_TOKEN`；③ 服务停掉时工具返回连接错误（证明不直连 DB）；
④ 取用会计入 usage；⑤ 宿主注册由使用方自行完成。

---

## 6. 其它契约细节

- **CORS**：默认**完全关闭**（连 CORS 头都没有）；`CORS_ORIGINS` 必须写精确 origin（写 `*` 启动即报错）；
  永远不发 `Access-Control-Allow-Credentials`；CORS 只影响跨域可见性，**不放宽认证**。
- **会话与安全**：单用户；cookie `pm_sid`（`HttpOnly; SameSite=Lax; Path=/`）；
  登录失败达阈值后**封锁期内即使口令正确也返回 429**，直到窗口过期。服务**只应暴露在可信内网**（或由反代终结 HTTPS）。
- **不联网**：不引 CDN、不发遥测、不调外部 API。
- **Markdown 渲染的内存**：服务端净化需要 DOM（`jsdom` 模块加载时建一个复用 window）⇒ 起完整服务后
  `VmRSS ≈ 204 MB`（实测 2026-09-18）。单机自托管可接受。
- **检索规模**：`FTS5 trigram` 只支持 ≥3 个 Unicode 码点，<3 走 `LIKE '%…%'` 全表扫描兜底 —— 2000 行量级实测 0.2 ms，
  但数据量到 **10 万行量级需要重新评估**；`bm25` 在小语料可能同分，此时按 `updated_at` 倒序。

---

## 相关文档

- [`../README.md`](../README.md) —— 用户文档（部署 / 使用 / FAQ）
- [`development.md`](development.md) —— 开发者文档（构建 / 测试 / 项目结构 / 验收体系）
- [`dependencies.md`](dependencies.md) —— 依赖清单 + 协议 + 安全审计
- [`versioning.md`](versioning.md) —— 版本管理规划（semver / tag / 发版流程 / `schema_version` 解耦）
- [`search-zh.md`](search-zh.md) —— 中文检索方案实测报告
