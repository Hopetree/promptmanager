# promptmanager

**轻量、自托管、数据自持的 Prompt 管理器。** 一个进程、一个端口、一个数据库文件，浏览器打开就能用；
数据全在你自己机器的 `pm.db` 里，**备份 = 拷文件**，不联网、不发遥测。

- **你的 prompt 归你**：单文件 SQLite，随写随存；想备份就拷走，想迁走就导出 JSON。
- **轻**：不用 Docker 也能跑（一个 Node 进程）；用了 Docker 就一条 `docker run`。
- **中文可用**：全文检索对中文做了专门处理（≥3 字走 FTS5，两字词走兜底），不是"英文能搜、中文靠运气"。

---

## 能做什么

| 能力 | 说明 |
| --- | --- |
| **结构化保存** | 标题 / 用户提示词 / 系统提示词 / 备注 / 文件夹 / 标签 / 收藏 |
| **中文全文检索** | 标题、正文、备注一起搜；支持标签与文件夹筛选、只看收藏 |
| **三种浏览方式** | **分栏**（左筛选 + 中列表 + 右详情，桌面默认）/ **表格**（信息密度高，支持批量操作）/ **卡片**（移动端默认，观感最好） |
| **一键复制** | 列表、卡片、详情、编辑器里都能直接复制成品提示词 |
| **模板变量** | 自动识别 `{{变量名}}`（支持中文）→ 填值 → 渲染成品；没填的变量**原样保留**，不会被悄悄吞掉 |
| **Markdown 预览** | 服务端渲染 + XSS 净化 + 代码高亮，粘贴 Markdown 直接看效果 |
| **版本历史** | 每次保存自动留档；任选两版看差异（红删绿增）、一键回滚（回滚也生成新版本，不覆盖历史）。**每个 prompt 最多保留最近 10 个版本**，更早的自动清理 |
| **拖拽排序** | 卡片、分栏列表、表格、文件夹树都能拖动重排，顺序会被记住 |
| **批量操作** | 表格视图里勾选多条 → 批量收藏 / 移动 / 删除（删除有二次确认） |
| **导入导出** | 全量 JSON 导出/导入，可当备份、可跨机迁移；导入有"会新增 N 条"预览，`replace` 模式会二次确认 |
| **文件夹与标签** | 文件夹树（可嵌套、可改名、可拖拽排序）；标签自动计数；文件夹筛选**含全部子目录** |
| **使用统计** | 谁在什么时候取用过哪条（详情 / 渲染 / agent 取用），按渠道统计 |
| **给脚本与 agent 用** | API Token + 使用侧 CLI（`pm get` / `pm render`）+ MCP（stdio，只读），详见 [接口参考](docs/api.md) |
| **移动端与暗色** | 手机浏览器可用（单栏 + 抽屉）；亮/暗跟随系统，也可手动三态切换 |

---

## 部署方式 A：Docker（推荐）

> 需要 Docker ≥ 20.10（建议 24+）。镜像由 CI 在推版本 tag 时构建并发布到 Docker Hub。

```bash
# ① 拉取（把 1.0.2 换成你要的版本；也可用 1.0 或 latest）
docker pull <命名空间>/promptmanager:1.0.2

# ② 运行（数据落在宿主目录，容器重建不丢）
mkdir -p /data/promptmanager
docker run -d --name promptmanager \
  --restart unless-stopped \
  -p 8767:8767 \
  -e HOST=0.0.0.0 -e PORT=8767 -e DATA_DIR=/data -e TZ=Asia/Shanghai \
  -v /data/promptmanager:/data \
  --memory 512m --cpus 1.0 \
  <命名空间>/promptmanager:1.0.2

# ③ 首次设置管理员口令（口令只从 stdin 进库，不进环境变量、不进镜像）
printf '%s\n' '你的强口令' | docker exec -i promptmanager node bin/pm.mjs user set-password --username admin

# ④ 自检 → 应返回 {"status":"ok","version":"1.0.2"}
curl -s http://127.0.0.1:8767/healthz
```

然后浏览器打开 **`http://<主机IP>:8767/`**，用 `admin` + 刚设的口令登录。

**用 compose 更省事**（仓库里带了一份，按部署机改两处：端口映射的宿主地址、数据卷路径）：

```bash
vi docker-compose.yml      # 改 ports 与 volumes
docker compose up -d --build
docker compose ps          # 等 healthcheck 变 healthy
```

**两个注意点**：

- **数据卷属主**：容器内以 `node`（uid **1000**）运行。宿主目录要可写，否则容器写不进数据：
  `chown 1000:1000 /data/promptmanager`。
- **端口**：容器内固定 `8767`；对外映射到哪个宿主端口由 `-p` 决定（例如 `-p 18767:8767`）。

更多细节（构建、备份、升级回滚、实测踩坑）见 [`deploy/container.md`](deploy/container.md)。

---

## 部署方式 B：源码运行

> 需要 **Node 24**（本机自带即可，不必装 nvm）与 npm；不需要外部数据库/缓存。

```bash
# ① 装依赖（按 package-lock.json 冷装；无需编译器，预编译二进制随包分发）
npm ci

# ② 构建（服务端 tsc + 前端 vite）
npm run build

# ③ 初始化数据库（幂等；服务启动时也会自动迁移）
npm run migrate                      # → ok: schema at v3

# ④ 设置管理员口令（唯一入口；口令从 stdin 读、哈希后入库，绝不打印/不落日志）
printf '%s\n' '你的强口令' | node bin/pm.mjs user set-password --username admin

# ⑤ 启动（默认 0.0.0.0:8767，内网可达）
npm start

# ⑥ 自检
curl -s http://127.0.0.1:8767/healthz     # {"status":"ok","version":"1.0.2"}
```

**临时换端口 / 换数据目录**（不动生产文件）：

```bash
DATA_DIR=$(mktemp -d) PORT=8768 npm start
```

**开机常驻（systemd）**：仓库的 [`deploy/`](deploy/) 里有现成的 unit 文件、环境变量模板与安装/验证/回滚三步说明
（[`deploy/README.md`](deploy/README.md)）。要点：

- 用**非 root** 用户运行，`WorkingDirectory` 指到项目目录，`EnvironmentFile` 指向 env 文件（口令类值留空）；
- 数据目录（`StateDirectory`）要能被该用户写入；
- 反代形态见 [`deploy/reverse-proxy.example.conf`](deploy/reverse-proxy.example.conf) 与下方 FAQ。

---

## 怎么用

### 登录与界面

浏览器打开 `http://<主机>:8767/` → 用户名 `admin` + 口令登录。顶栏有 `＋新建`、`⋯更多`
（使用统计 / API 令牌 / 导入导出 / 关于 / 修改密码 / 登出）与主题切换（跟随系统 / 亮 / 暗）。

### 三种视图

- **分栏**（桌面默认）：左栏筛文件夹与标签，中栏是提示词列表，右栏是详情（可直接改文件夹与标签、看版本历史）。
- **表格**：信息密度最高，支持行内编辑/删除/复制，以及**勾选多条批量操作**。
- **卡片**（移动端默认）：一条一张卡，看正文摘要最直观；手机上体验最好。

手机上自动降级为**单栏**：点条目打开详情抽屉，不会挤成两栏。

### 常用操作

| 想做的事 | 怎么做 |
| --- | --- |
| 新建 | 顶栏 `＋新建`（未保存前不会入库） |
| 复制成品 | 列表 / 卡片 / 详情 / 编辑器里的「复制」按钮；手机上是长按友好的大按钮 |
| 填变量再复制 | 打开详情或编辑器 → 变量面板填值 → 预览 → 复制（渲染不会改动库里内容） |
| 看历史 / 回滚 | 详情或编辑器里的版本面板：选两版看差异，或一键回滚（会生成一个新版本） |
| 改文件夹 / 标签 | 详情页标题下的元信息行：文件夹下拉直接改，标签可增删（即时生效） |
| 排序 | 直接拖动卡片 / 列表项 / 表格行 / 文件夹（排序方式选「自定义」时按你的顺序） |
| 批量处理 | 切到表格视图 → 勾选 → 顶部工具条里批量收藏 / 移动 / 删除 |
| 导入导出 | `⋯更多 → 导入 / 导出`；导出会下载一个 JSON，导入前会告诉你将新增多少条 |
| 换口令 | `⋯更多 → 修改密码`（改完当前会话保持登录，其它设备上的会话会被登出） |
| 给脚本发令牌 | `⋯更多 → API 令牌`（明文只显示一次） |

**快捷键**：`/` 聚焦搜索框，`Ctrl/Cmd + K` 同样聚焦搜索，`Esc` 关闭当前浮层/抽屉。

### 备份与升级

- **备份**：把数据目录里的 `pm.db`（WAL 模式连同 `-wal`、`-shm`）拷走即可；也可以在 `⋯更多 → 导入 / 导出` 里
  导出全部 JSON（含版本历史）。**本项目不做自动备份** —— 需要的话自己挂个定时任务。
- **升级（Docker）**：`docker pull` 新版本 → 停旧容器 → 用同一个数据卷起新容器（数据在卷里，不受影响）。
- **升级（源码）**：拉新代码 → `npm ci && npm run build` → 重启进程；启动时会自动跑数据库迁移。
- **回滚**：Docker 用旧 tag 的镜像起容器；源码 `git checkout` 到上一个提交后重新 `npm run build`。
  数据库迁移是**向前兼容**的（新增迁移不会破坏旧数据），回滚应用版本一般无需动数据。

---

## 常见问题（FAQ）

**忘记管理员口令了怎么办？**
在服务所在主机上重设（覆盖式，不需要旧口令）：

```bash
# 源码运行
printf '%s\n' '新口令' | node bin/pm.mjs user set-password --username admin
# Docker 运行
printf '%s\n' '新口令' | docker exec -i promptmanager node bin/pm.mjs user set-password --username admin
```

注意：这会**吊销该用户全部已登录会话**（包括你当前浏览器里的），需要重新登录。

**数据存在哪？**
`DATA_DIR` 目录下的 `pm.db`（SQLite 单文件，WAL 模式）+ `media/`。Docker 形态下 `DATA_DIR=/data`，
对应你挂载的宿主目录；源码形态默认是项目下的 `data/`。

**端口被占了怎么办？**
换一个端口启动（源码：`PORT=8768 npm start`；Docker：改 `-p` 的宿主端口，容器内保持 `8767`）。
如果你要长期换端口，记得同步改反代配置。

**放在反向代理后面要注意什么？**
两个环境变量，**只在确有反代时**才设：

```bash
TRUST_PROXY=1                              # 让来源 IP 取 X-Forwarded-For（登录限流按真实来源计）
PUBLIC_ORIGIN=https://prompt.example.com   # 会话 cookie 追加 Secure（HTTPS 形态）
```

**内网 HTTP 直连时**这两个都**留空** —— 设了 `PUBLIC_ORIGIN` 会让 cookie 带 `Secure`，HTTP 下反而登录不上。
另外服务本身**不做 TLS**：要公网访问，请在前面放反代终结 HTTPS。样例见
[`deploy/reverse-proxy.example.conf`](deploy/reverse-proxy.example.conf)。

**复制按钮点了没反应 / 提示手动复制？**
内网用 `http://`（非 HTTPS）访问时，浏览器不允许网页直接写剪贴板，程序会自动退回兼容方式；
若仍被浏览器拦住，界面会提示你手动复制。这是浏览器的安全策略，不是服务故障。

**升级后数据会不兼容吗？**
不会。数据库迁移是幂等的、只增不删；导入导出的 JSON 格式带 `schema_version`，导入时会校验并拒绝不兼容的文件。
唯一要注意的是：**每个 prompt 最多保留最近 10 个版本**，超出上限的旧版本会在下次保存时自动清理。

**忘记某个变量名怎么写？**
在正文里写 `{{变量名}}`（支持中文，不能有空格）；想输出字面量 `{{...}}` 用 `\{{转义}}`。
变量名以服务端返回的清单为准，详情/编辑器里的变量面板会自动列出。

**能让 agent / 脚本取用 prompt 吗？**
能。`⋯更多 → API 令牌` 建一个 token，然后用使用侧 CLI 或 MCP：

```bash
export PM_API_URL=http://127.0.0.1:8767
export PM_API_TOKEN=pm_…
node bin/pm.mjs get '会话交接' --json
node bin/pm.mjs render --id 3 --set 姓名=张三
```

完整接口与 MCP 用法见 [接口参考](docs/api.md)。

---

## 已知限制

- **单用户**：一套账号口令，没有多用户与权限分层；请只暴露在可信内网，或由反代加一层访问控制。
- **服务不做 TLS**：公网形态必须由反代终结 HTTPS。
- **没有 URL 深链**：界面是应用内视图状态，刷新会回到列表，浏览器前进/后退不参与导航。
- **搜索是"提交后查询"**：输入有约 300ms 防抖，不是逐字符即时搜索。
- **中文检索的边界**：≥3 个字的查询走全文索引；**两个字**的词走全表兜底（2000 条量级实测 0.2ms，
  数据量到十万级需要重新评估）。
- **版本只留最近 10 个**：更早的版本会被真删（不是隐藏），因此回滚到已清理的旧版本会提示"版本不存在"。
- **变量填值不持久化**：渲染结果不会写库，切换条目会清空已填的值。
- **没有自动备份**：请自行定期拷 `pm.db` 或用导出功能。
- **不含**：RAG / 向量检索 / AI 调用、多语言界面、桌面或移动 App、对象存储/外部同步。
- **内存占用**：Markdown 预览需要服务端 DOM，起完整服务后常驻约 200MB 内存 —— 单机自托管够用。

---

## 文档索引

| 想看什么 | 看哪份 |
| --- | --- |
| 部署与使用（本文件） | `README.md` |
| 接口 / CLI / MCP 参考 | [`docs/api.md`](docs/api.md) |
| 容器部署细节（构建 / 镜像发布 / 备份 / 排错） | [`deploy/container.md`](deploy/container.md) |
| systemd 部署（安装 / 验证 / 回滚） | [`deploy/README.md`](deploy/README.md) |
| 更新日志 | [`CHANGELOG.md`](CHANGELOG.md) |
| 版本管理与发版规则 | [`docs/versioning.md`](docs/versioning.md) |
| 依赖清单与许可证 | [`docs/dependencies.md`](docs/dependencies.md) |
| 界面截图（关键页面一套） | [`docs/shots/`](docs/shots/) |
| 开发者文档（构建 / 测试 / 项目结构 / 验收） | [`docs/development.md`](docs/development.md) |
| AI 代理操作指南 | [`AGENTS.md`](AGENTS.md) |
