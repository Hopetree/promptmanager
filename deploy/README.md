# promptmanager 部署 / 回滚说明（systemd）

> **交付 ≠ 已部署。** 本目录是**交付物**（BRIEF §5、§7；STANDARDS §3.6）：
> 只提供 unit / 环境变量模板 / 本文档，**dsh 不执行安装**。
> **实际部署（装到系统、开机自启、反代、对外暴露）是单独立项，只在用户明确要求时由 host_manger 执行**；
> 备份同样不默认做。

| 交付物 | 说明 |
| --- | --- |
| `promptmanager.service` | systemd unit（`User`/`Group` 非 root、`WorkingDirectory`、`EnvironmentFile`、`Restart` 齐备） |
| `promptmanager.env.example` | 环境变量模板（**口令/密钥类值一律留空**） |
| `README.md` | 本文件：安装 / 验证 / 回滚三步 |

语法自检（228 已实测可用，systemd 250）：`systemd-analyze verify deploy/promptmanager.service` → 无输出、退出码 0。

---

## 0. 部署形态与前置假设

| 项 | 值 | 说明 |
| --- | --- | --- |
| 主机 | 228（CentOS Stream 9） | **当前无 Docker**，本服务是**非容器**形态；⚠️ **即将新增容器化部署**（`Dockerfile` + `docker-compose.yml`，由 **host_manger** 交付，见 §5） |
| Node | `/usr/bin/node`（v24.18.0） | 系统自带，不换版本、不装 nvm |
| 代码目录 | `/opt/promptmanager` | unit 的 `WorkingDirectory` |
| 环境文件 | `/etc/promptmanager/promptmanager.env` | unit 的 `EnvironmentFile`（**600**） |
| 数据目录 | `/var/lib/promptmanager` | unit 的 `StateDirectory=promptmanager` 自动创建并 chown；`pm.db` + `media/` 落在这里 |
| 服务账号 | `promptmanager`（系统账号，非 root） | 需在部署时创建 |
| 监听 | `0.0.0.0:8767` | 内网可达；**有认证**（除 `/healthz` 与登录接口外全部 401） |
| 日志 | journald | `journalctl -u promptmanager -f` |

> 若 host_manger 决定换路径/换端口：三处必须同步改 —— unit（`WorkingDirectory`/`ExecStart`/`ReadWritePaths`）、
> `promptmanager.env`（`PORT`/`DATA_DIR`）、项目 `README.md` 与合集端口台账。

---

## 1. 安装（三步）

```bash
# 1.1 建服务账号与目录（非 root；systemd 会创建 /var/lib/promptmanager 并 chown 给该账号）
sudo useradd --system --home-dir /opt/promptmanager --shell /sbin/nologin promptmanager || true
sudo install -d -o promptmanager -g promptmanager -m 755 /opt/promptmanager

# 1.2 投放代码并构建（在项目目录里构建，再同步到 /opt，或直接在 /opt/promptmanager 里构建）
sudo -u promptmanager git -C /opt/promptmanager pull   # 或 rsync 项目目录（不含 node_modules/dist/data）
cd /opt/promptmanager
sudo -u promptmanager npm ci --omit=dev=false          # 含 devDependencies（构建需要 vite/typescript）
sudo -u promptmanager npm run build                     # 服务端编译 + 前端构建
sudo -u promptmanager npm run migrate                   # 幂等迁移，输出 ok: schema at v3（当前版本号）

# 1.3 设置管理员口令（口令从 stdin 读，只落库、绝不进日志/git/环境文件）
printf '%s\n' '<你的强口令>' | sudo -u promptmanager node bin/pm.mjs user set-password --username admin

# 1.4 装 unit 与环境文件（systemd 相关操作只在部署阶段由 host_manger 执行）
sudo install -d -m 755 /etc/promptmanager
sudo install -m 600 deploy/promptmanager.env.example /etc/promptmanager/promptmanager.env
sudo cp deploy/promptmanager.service /etc/systemd/system/promptmanager.service
sudo systemctl daemon-reload
sudo systemctl enable --now promptmanager
```

**unit 关键约定**（验收项，见 AC-18）

- `User=promptmanager` / `Group=promptmanager`（**非 root**）、`WorkingDirectory=/opt/promptmanager`、
  `EnvironmentFile=/etc/promptmanager/promptmanager.env`、`Restart=always` 齐备。
- **刻意不启用内存写执行（Memory\*）类加固**：与 Node V8 的 JIT 冲突会导致服务反复崩溃
  （STANDARDS §7.5 故障表）。其余加固（`ProtectSystem=strict`、`NoNewPrivileges`、`PrivateTmp`…）均已启用。
- `ProtectSystem=strict` 下唯一的可写目录是 `StateDirectory`（`/var/lib/promptmanager`，即 `DATA_DIR`）。

---

## 2. 验证（部署后逐条跑）

```bash
# 2.1 单元状态（应为 active (running)，无 restart 循环）
systemctl status promptmanager --no-pager

# 2.2 监听地址必须是 0.0.0.0:8767，不是 127.0.0.1
ss -ltnp | grep ':8767'

# 2.3 健康检查（无需认证）
curl -s http://127.0.0.1:8767/healthz          # {"status":"ok","version":"1.0.0"}

# 2.4 从内网另一台机器访问（把 192.168.0.228 换成实际地址）
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.228:8767/healthz   # 200

# 2.5 认证生效（负向验证）：未登录访问业务接口必须 401
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.228:8767/api/prompts   # 401
```

> 228 无 firewalld / iptables 规则，绑上 `0.0.0.0` 即内网可达；**不要**做端口转发 / NAT / 公网映射
> （这些只由 host_manger 在用户明确要求时处理，STANDARDS §3.3）。

### 2.6 口令与会话运维（阶段 2 起）

```bash
# 轮换管理口令（口令从 stdin 读；哈希入库；会**吊销该用户全部既有会话**）
printf '%s\n' '<新口令>' | sudo -u promptmanager node bin/pm.mjs user set-password --username admin

# 观察登录失败/限流（默认 5 次失败 / 60 秒窗口，按 username+来源 IP 计）
grep -E 'LOGIN_MAX_FAILURES|LOGIN_WINDOW_SECONDS|SESSION_TTL_HOURS' /etc/promptmanager/promptmanager.env

# 会话与服务端数据都在同一个 SQLite 文件里；会话过期自动失效（默认 720 小时）
sqlite3 /var/lib/promptmanager/pm.db 'select count(*) from sessions;'   # 可选，228 有 sqlite3
```

- 口令**绝不写进** `promptmanager.env`（模板里对应变量值留空）；服务日志只打印监听地址与请求日志，不含口令。
- 库中 `sessions.id` 存的是 token 的 `sha256`（cookie 里才是原始 token）→ 数据库被读走也无法直接冒用会话。
- 达失败阈值后**封锁期内即使口令正确也返回 429**（`Retry-After` 给出剩余秒数），窗口过期自动解锁。

---

## 2.7 两种部署形态：内网直连 与 公网反代（D-18 / AC-28）

服务本身**不做 TLS**（由反代终结），默认监听 `0.0.0.0:8767` 不变；两种形态用**三个环境变量**切换：

| 变量 | 内网直连（默认） | 公网反代 | 说明 |
| --- | --- | --- | --- |
| `TRUST_PROXY` | 留空（= 关闭） | `1` | 关闭时来源 IP 取 socket 地址，**伪造 `X-Forwarded-For` 不影响登录限流**；开启后来源 IP 取 XFF（限流按真实客户端计） |
| `PUBLIC_ORIGIN` | 留空 | `https://<你的公网域名>` | 设置后会话 cookie 追加 `Secure`；**留空时不得加**（否则内网 HTTP 登录不上） |
| `CORS_ORIGINS` | 留空（同源） | 需要跨域时填精确 origin，逗号分隔 | **禁止 `*`**；不写 `Access-Control-Allow-Credentials`；留空时完全没有 CORS 头 |

### 3.1 内网直连（HTTP，最简单）

```bash
# /etc/promptmanager/promptmanager.env 里保持三个变量都留空/不设
HOST=0.0.0.0
PORT=8767
DATA_DIR=/var/lib/promptmanager
# TRUST_PROXY / PUBLIC_ORIGIN / CORS_ORIGINS 留空
sudo systemctl restart promptmanager
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.228:8767/healthz   # 200
```

### 3.2 公网反代（HTTPS 终结在反代）

```bash
# 1) 服务端：确有其反代（同机 nginx）才开启这两个开关
sudo sed -i 's/^TRUST_PROXY=$/TRUST_PROXY=1/; s|^PUBLIC_ORIGIN=$|PUBLIC_ORIGIN=https://<你的公网域名>|' \
  /etc/promptmanager/promptmanager.env
sudo systemctl restart promptmanager

# 2) 反代：参考 deploy/reverse-proxy.example.conf（占位符要替换；证书路径/域名不入库）
sudo cp deploy/reverse-proxy.example.conf /etc/nginx/conf.d/promptmanager.conf   # 部署时由 host_manger 执行
sudo nginx -t && sudo systemctl reload nginx

# 3) 验证：证书 + 转发头 + cookie 带 Secure
curl -sI https://<你的公网域名>/healthz | head -3
curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<口令>"}' https://<你的公网域名>/api/login | grep -i '^set-cookie'
```

> ⚠️ **公网暴露动作（反代/证书/防火墙/DNS）属于安全红线，只由 host_manger 在用户授权后执行**；
> 本项目只交付配置样例与文档。服务仍必须带认证（cookie + Bearer 双通道），`/healthz` 与 `/api/login` 之外一律 401。

### 3.4 MCP server（stdio，给 agent 取用；不占端口）

MCP 不是常驻服务，而是**由 MCP 客户端按需拉起的子进程**（stdio），所以**不需要 systemd unit、不监听端口**：

```bash
# 1) 先给 MCP 建一个 token（明文只显示一次；仅在服务端执行）
sudo -u promptmanager bash -c 'DATA_DIR=/var/lib/promptmanager node /opt/promptmanager/bin/pm.mjs token create --name mcp'

# 2) 在 MCP 客户端里注册（示例见 deploy/mcp-register.example.json，token 用占位符）
#    命令形如：/usr/bin/node /opt/promptmanager/bin/pm-mcp.mjs
#    环境变量：PM_API_URL=http://127.0.0.1:8767（或 LAN 地址） PM_API_TOKEN=pm_…
#    从别的机器经 ssh 拉起也是允许的（服务端只需可被 API 访问）：
#      ssh <host> 'sudo env PM_API_URL=http://<host>:8767 PM_API_TOKEN=pm_… /usr/bin/node /opt/promptmanager/bin/pm-mcp.mjs'
```

- 三个**只读**工具：`prompt_search` / `prompt_get` / `prompt_render`；**不得**注册任何写操作。
- 撤销该 token 即让 MCP 立刻失效：`bin/pm.mjs token revoke <id>`（或 `DELETE /api/tokens/:id`）。
- 排查：MCP 的日志在 **stderr**（stdout 是 JSON-RPC 协议流，任何 `console.log` 都会污染它）；
  报 `缺少 PM_API_TOKEN` 就是环境变量没传进去；报 `无法连接 <url>` 就是 `PM_API_URL` 不通或服务没起。
- **本项目不代注册到任何宿主**：注册动作由使用方（agent/客户端配置）自行完成。

### 3.3 回滚（两种形态通用）

```bash
# 形态回滚：把开关改回内网直连，重启服务即可（不需要动代码）
sudo sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=/; s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=|' /etc/promptmanager/promptmanager.env
sudo systemctl restart promptmanager
# 反代侧回滚：移走 /etc/nginx/conf.d/promptmanager.conf 后 nginx -t && systemctl reload nginx
# 代码/数据回滚见下面第 4 节
```

---

## 4. 回滚（代码与数据）

```bash
# 4.1 停服务并取消开机自启（数据保留在 /var/lib/promptmanager）
sudo systemctl stop promptmanager
sudo systemctl disable promptmanager

# 4.2 若只是坏了一个版本：切回上一份代码目录后重建（发布时建议保留 /opt/promptmanager.prev）
sudo rm -rf /opt/promptmanager.bad && sudo mv /opt/promptmanager /opt/promptmanager.bad
sudo mv /opt/promptmanager.prev /opt/promptmanager
cd /opt/promptmanager && sudo -u promptmanager npm ci && sudo -u promptmanager npm run build
sudo systemctl start promptmanager

# 3.3 若要连数据一起回退：先停服务，再把备份的 pm.db（含 -wal/-shm）整体换回
sudo systemctl stop promptmanager
sudo -u promptmanager cp -a /var/lib/promptmanager/pm.db      /var/lib/promptmanager/pm.db.bad
sudo -u promptmanager cp -a /path/to/backup/pm.db             /var/lib/promptmanager/pm.db
sudo -u promptmanager cp -a /path/to/backup/pm.db-wal         /var/lib/promptmanager/pm.db-wal 2>/dev/null || true
sudo systemctl start promptmanager
```

- **备份 = 拷文件**：`DATA_DIR/pm.db`（WAL 模式下连同 `pm.db-wal`/`pm.db-shm` 一起拷，或先停服务再拷）。
- **备份 = 导出 JSON（可选、逻辑级）**：`sudo -u promptmanager node bin/pm.mjs export --out /path/backup.json`；
  恢复用 `POST /api/import`（`mode=replace` 清空重建 / `mode=merge` 合并且 prompt 新建，单事务原子、失败不改数据）。
  ⚠️ **本项目不默认做备份**：以上只是可用机制，是否接备份任务由用户在需要时单独提出、由 host_manger 执行。
- 迁移是**幂等**的（`schema_migrations` 记录已应用版本）；回滚代码到旧版本时，若旧版本 schema 更旧，
  它会按自己的 `migrations/` 重新判断——**不要手工改 `schema_migrations`**。

---

## 5. 只交付、不部署的边界（复核用）

- dsh **没有**在本文件之外做任何系统改动：没有 `systemctl` 调用、没有创建账号/目录、没有改防火墙。
- 本地验收时服务是**临时进程**或"AC 自起自停"（`DATA_DIR=$(mktemp -d) PORT=8767 npm start`），验收后即杀。
- `deploy/` 三件套是**文件交付物**；AC-18 只核"文件齐备 + 语法/约定正确"，**不代表已部署**。
- 若真要部署：**由用户点名、由 host_manger 执行**（含反代/证书/防火墙/DNS），dsh 不碰系统配置。
- ⚠️ **即将新增容器化部署**：`Dockerfile` + `docker-compose.yml`（含数据卷 `DATA_DIR` 挂载、端口 8767 映射、健康检查）
  **由 host_manger 交付**；本仓库**当前不含**任何容器文件，本节的三步 systemd 流程仍是唯一已交付形态。
  容器形态落地后，本节需补一节"容器安装/验证/回滚"，两套形态共用同一个 `pm.db`（不要同时起两份进程写同一数据目录）。

---

## 6. 排查：systemd 下**启动即崩**（`uv_interface_addresses` / `errno 97`）

> 这是 2026-09-18 首次真实部署踩到的坑，已写进 BRIEF v10 §5 与 AC-18 第 ⑤ 条。
> ⚠️ **`systemd-analyze verify` 拦不住它**：实测 verify 全绿（0 error），服务却在 systemd 下启动即崩 —— **语法正确 ≠ 能起来**。

**症状**（journald 原始报错，`journalctl -u promptmanager -n 50 --no-pager`）：

```
SystemError [ERR_SYSTEM_ERROR]: A system error occurred: uv_interface_addresses returned Unknown system error 97 (EAFNOSUPPORT)
    at Object.networkInterfaces (node:os:218:16)
    at getAddresses (/opt/promptmanager/node_modules/fastify/lib/server.js:365:29)
    at Object.logServerAddress (...:381)
→ 服务 exited status=1/FAILURE，Restart 循环（`systemctl status promptmanager` 见 NRestarts 不断增长）
```

**根因**：Linux 上 `os.networkInterfaces()` 走 libuv 的 `uv_interface_addresses()`，它要开一个
**`AF_NETLINK`** socket；而 unit 的 `RestrictAddressFamilies` 只允许了 `AF_INET AF_INET6 AF_UNIX` →
`socket()` 被拒 → `errno 97 (EAFNOSUPPORT)`。Fastify 启动时会调用它来打印监听地址，于是**启动阶段就崩**。

**修法（二选一）**

1. **交付的 unit 已经是修好的**（`deploy/promptmanager.service`，v10 起）：
   ```ini
   RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
   ```
   重新投放 unit 后 `sudo systemctl daemon-reload && sudo systemctl restart promptmanager` 即可。
2. **存量部署用 drop-in 覆盖**（不必改 unit 原文）：
   ```bash
   sudo mkdir -p /etc/systemd/system/promptmanager.service.d
   sudo tee /etc/systemd/system/promptmanager.service.d/10-allow-netlink.conf >/dev/null <<'EOF'
   [Service]
   RestrictAddressFamilies=
   RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
   EOF
   sudo systemctl daemon-reload
   sudo systemctl restart promptmanager
   ```
   - ⚠️ drop-in **必须带 `[Service]` 段头**，否则 systemd 不认（会报未知段/指令，且不生效）；
   - 第一条 `RestrictAddressFamilies=`（空值）是**先清空**：列表型指令在 drop-in 里是**覆盖**语义，
     写空再写全量值，避免依赖默认列表的顺序假设（VERIFY 部署记录里的 drop-in 就是这么写的）。

**确认生效值**（不要只看文件写了什么）：

```bash
systemctl show -p RestrictAddressFamilies --value promptmanager
# 期望输出：AF_INET AF_INET6 AF_NETLINK AF_UNIX
sudo systemctl status promptmanager --no-pager | head -5     # 期望 active (running) 且 NRestarts 不再增长
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/healthz   # 期望 200
```

> 边界：本节只涉及**本项目自己的** unit / drop-in / 服务重启，不涉及防火墙、NAT、内核参数等系统配置
> （那些只由 host_manger 在部署时处理）。
