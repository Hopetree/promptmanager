# promptmanager 容器化部署

> 面向：用 Docker 跑本服务的人（生产 / 测试都适用）。
> 另一条部署路径是 **systemd**（见 `deploy/README.md`）；两条路径**互不影响**，按部署机条件选一条。

## 1. 需要什么

| 项 | 要求 |
| --- | --- |
| Docker | ≥ 20.10（建议 24+）；Compose **v2**（`docker compose` 子命令形式） |
| 架构 | x86_64（镜像基于 `node:24-slim`） |
| 磁盘 | 镜像约 300MB + 数据目录（SQLite 单文件，随 prompt 量增长） |
| 网络 | **构建时**需能拉 `node:24-slim`；**运行时不需要外网**（不引 CDN、不发遥测、不调外部 API） |

## 2. 构建

```bash
docker build -t promptmanager:1.0.0 .
```

多阶段构建：builder 装全量依赖并跑 `npm run build`（`tsc` + `vite`）；runtime 只带**生产依赖**与 `dist/`。

> ⚠️ **不要换成 alpine 基础镜像**：`better-sqlite3` 是**原生模块**，官方预编译二进制面向 glibc；
> alpine 的 musl 需要现场编译（要装整条工具链，镜像更大更脆）。

## 3. 运行

### 3.1 用 compose（推荐）

```bash
# 按部署机改两处：端口映射的宿主地址、数据卷路径
vi docker-compose.yml
docker compose up -d --build
docker compose ps            # 等 healthcheck 变 healthy
```

### 3.2 用 docker run

```bash
docker run -d --name promptmanager   --restart unless-stopped   -p 8767:8767   -e HOST=0.0.0.0 -e PORT=8767 -e DATA_DIR=/data -e TZ=Asia/Shanghai   -v /data/promptmanager:/data   --memory 512m --cpus 1.0   promptmanager:1.0.0
```

## 4. 首次设置管理员口令（**关键一步**）

口令**不进环境变量、不进 compose 文件**（哈希后存库）：

```bash
docker compose exec promptmanager node bin/pm.mjs user set-password --username admin
# 非交互：
# printf '%s\n' '<口令>' | docker compose exec -T promptmanager node bin/pm.mjs user set-password --username admin
```

然后浏览器打开 `http://<宿主>:8767/` 登录。

## 5. 数据与备份

| 项 | 位置（容器内） |
| --- | --- |
| 数据库 | `/data/pm.db`（WAL 模式；同目录还有 `pm.db-wal` / `pm.db-shm`） |
| 媒体 | `/data/media/` |

**备份（两种任选）**：

```bash
# ① 拷文件（最直接；建议先停容器或确认无写入）
docker compose stop promptmanager
sudo cp -a /data/promptmanager/pm.db* /somewhere/
docker compose start promptmanager

# ② 用内置导出（在线、JSON、可跨版本迁移）
docker compose exec promptmanager node bin/pm.mjs export --out /data/backup-$(date +%F).json
```

## 6. 升级与回滚

```bash
# 升级：换源码 → 重建镜像 → 重启（数据在卷里，不受影响）
docker compose up -d --build

# 回滚：用旧 tag 的镜像（把 compose 里的 image 改成旧版本即可）
docker compose down && docker compose up -d
```

**迁移**：服务启动时**自动**跑幂等迁移（`migrations/*.sql`），升级无需手工步骤；
⚠️ 迁移**只向前**——回滚镜像前请先备份数据。

## 7. 与 systemd 部署的差异

| 项 | systemd（`deploy/README.md`） | 容器（本文件） |
| --- | --- | --- |
| 隔离 | 系统账号 + systemd 加固（`ProtectSystem=strict` 等） | 容器命名空间 + 只读镜像层 |
| 数据 | `/var/lib/promptmanager` | 卷（示例 `/data/promptmanager`） |
| 日志 | journald（`journalctl -u promptmanager`） | `docker compose logs -f` |
| 口令 | `node bin/pm.mjs user set-password` | 同上，在容器内执行 |
| 反代相关 | 同一套环境变量（`TRUST_PROXY` / `PUBLIC_ORIGIN` / `CORS_ORIGINS`） | 同 |

## 8. 已知限制

- 镜像**不含** `tests/`、`tools/`、`docs/`（见 `.dockerignore`）—— 生产镜像只带运行所需；
- 镜像里**没有** `curl`（健康检查用 node 内置 `fetch`）；
- 端口默认 **8767**（与 systemd 部署一致）；改端口要同步改 compose 的 `PORT` 与反代配置；
- **本服务不做 TLS**：公网形态请在前面放反向代理终结 HTTPS，并设 `TRUST_PROXY=1` + `PUBLIC_ORIGIN`。

## 9. 验证记录（host_manger 实测，2026-09-20，Docker 26.0.2 / Compose v2.26.1）

| 项 | 结果 |
| --- | --- |
| 构建 | `docker build -t promptmanager:1.0.0 .` **成功**（镜像 579MB） |
| 运行 | 容器起来，`Health=healthy`、`Restarts=0`、**非 root**（容器内 uid=1000 `node`） |
| 资源 | CPU 2.1% / 内存 **82.5 MiB**（限额 512 MiB 的 16%） |
| 跨机可达 | 从另一台机器访问 `http://<宿主>:<映射端口>/healthz` → `{"status":"ok","version":"1.0.0"}`；未认证 `/api/prompts` → **401** |
| 功能 | 登录 ✓ / 新建 prompt ✓ / 列表 ✓ / 变量渲染（`你好 {{名字}}` → `你好 世界`）✓ |
| 真实渲染 | headless chromium 打开首页 → 登录页**渲染出内容** ✅（不是白屏） |
| 迁移 | 容器内 `node bin/pm.mjs migrate` → `ok: schema at v3` ✅ |
| 数据持久化 | `docker restart` 后数据仍在 ✅ |
| 标签/TTL | 5 个 `greenhouse.*` 标签齐全（部署到本机容器环境时按本机规范填） ✅ |

**实测踩到的三个坑（已解决，写在这里省下一个人）**

1. **不要写 `# syntax=docker/dockerfile:1`**：该指令要求拉外部 frontend 镜像；registry mirror 不可用的环境会**直接构建失败**。
   多阶段构建用内置 frontend 即可，删掉这一行。
2. **`better-sqlite3` 需要编译**：它的 install 脚本走 `node-gyp rebuild`（**不是**纯预编译二进制分发）⇒
   **slim / alpine 镜像没有 python3 / make / g++ 会构建失败**。本 Dockerfile 的应对是：
   **builder 用完整 `node:24`（自带工具链）编译一次 → runtime 用 `node:24-slim` 拷贝 `node_modules`**，
   最终镜像不含工具链（这也是刻意不用 alpine 的原因之一）。
3. **属主映射**：容器内 `node` 是 **uid 1000**；宿主上 uid 1000 可能对应别的用户名。
   数据卷目录要 `chown 1000:1000`（或在 compose 里用 `user:` 指定），否则容器内**写不进数据目录**。
