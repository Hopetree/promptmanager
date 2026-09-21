# promptmanager 容器化部署

> 面向：用 Docker 跑本服务的人（生产 / 测试都适用）。
> 另一条部署路径是 **systemd**（见 `deploy/README.md`）；两条路径**互不影响**，按部署机条件选一条。

## 1. 需要什么

| 项 | 要求 |
| --- | --- |
| Docker | ≥ 20.10（建议 24+）；Compose **v2**（`docker compose` 子命令形式） |
| 架构 | x86_64（镜像基于 `node:24-slim`） |
| 磁盘 | 镜像 **约 0.6–1 GB**（实测 579MB @v1.0.0 / 959MB @v1.0.1，见 §9；随 Node 基础镜像与依赖变化）+ 数据目录（SQLite 单文件，随 prompt 量增长） |
| 网络 | **构建时**需能拉 `node:24-slim`；**运行时不需要外网**（不引 CDN、不发遥测、不调外部 API） |

## 2. 构建

### 2.1 本地构建（从源码）

```bash
docker build -t promptmanager:1.0.1 .
```

多阶段构建：builder 装全量依赖并跑 `npm run build`（`tsc` + `vite`）；runtime 只带**生产依赖**与 `dist/`。

> ⚠️ **不要换成 alpine 基础镜像**：`better-sqlite3` 是**原生模块**，官方预编译二进制面向 glibc；
> alpine 的 musl 需要现场编译（要装整条工具链，镜像更大更脆）。

### 2.2 镜像发布（Docker Hub，GitHub Actions）

镜像由 **GitHub Actions** 构建并推送到 Docker Hub，配置在 **`.github/workflows/docker.yml`**
（**与质量检查 `ci.yml` 相互独立**，互不影响）。

**触发方式**

| 触发 | 行为 |
| --- | --- |
| push tag `v*`（如 `v1.0.1`） | **构建并推送**（发版主路径） |
| push branch `main` | **只构建、不推送**（尽早发现 Dockerfile 被改坏；**不需要 secret 也能跑**） |
| 手动 `workflow_dispatch` | 按当前 ref 决定：tag 上 = 推送；分支上 = 只构建 |

**镜像坐标与 tag 规则**

- 镜像名：**`<DOCKERHUB_USERNAME>/promptmanager`** —— 命名空间**不写死在仓库里**，从 GitHub Secrets 取。
- 推 `v1.0.1` ⇒ 产出 **`1.0.1`** + **`1.0`** + **`latest`**（同一份镜像的三个别名）。
- 平台：**仅 `linux/amd64`**（与生产 106 一致）。**arm64 本期不做**（需要 QEMU/多平台，构建代价翻倍）。

**需要在 GitHub 仓库配置的 2 个 Secret**（`Settings → Secrets and variables → Actions → New repository secret`；
**只写名字，值由你在 Docker Hub 侧生成/保管，绝不进仓库、不进镜像**）：

| Secret 名 | 值是什么 |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub 用户名（同时也是镜像的命名空间） |
| `DOCKERHUB_TOKEN` | Docker Hub **Access Token**（建议只给 `Read & Write` 的仓库级 token，不要用账号口令） |

> **前提：先配 `DOCKERHUB_USERNAME`。** 镜像名由它拼出，缺了它镜像名不完整（会变成 `/promptmanager`），
> 「计算镜像 tag」这一步产出的 tag 不可用。配好**这一个** secret 后，`main` 分支构建即可正常跑通
> （只构建不推送，**用不到 token**）；`DOCKERHUB_TOKEN` **只在推 tag 时才需要**。
> 也就是说"镜像能不能构建"这件事，在配 token 之前就能靠 `main` 分支构建验证。

**失败时去哪里看日志**

1. GitHub 仓库页 → **Actions** → 左侧选 **`docker`** workflow → 点那次 run → 展开失败的 step（`登录 Docker Hub` /
   `构建并推送` 是最常见的两处）；
2. 常见原因：secret 名字拼错或未配（`登录 Docker Hub` 失败）、Docker Hub token 权限不足或过期、
   `Dockerfile` 被改坏（`构建并推送` 失败 —— 这类错误在 `main` 分支构建上就会提前暴露）。

**安全约定（硬性）**

- 凭据**只**出现在 `docker/login-action` 的 `with` 里；**任何 step 都不回显 secret**（无回显、不打开 shell 命令追踪）；
- 仓库里**不出现**任何用户名/token 明文（命名空间走 secret）；
- workflow 权限最小化：`permissions: contents: read`（Docker Hub 与 `GITHUB_TOKEN` 无关，**不需要** `packages: write`）。

**与"本机/106 上手工构建"的关系**

workflow 的构建参数与 `docker build -t promptmanager:<ver> .` **等价**：`context=.`、`file=Dockerfile`、
无自定义 `target`、平台 `linux/amd64`（见 `docs/dev-history/PROGRESS.md` 阶段 33 的对照表与实测记录）。
本地没有 Docker 的机器（如 228）**不需要**为了发版装 Docker —— 交给 Actions 即可。

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
docker run -d --name promptmanager   --restart unless-stopped   -p 8767:8767   -e HOST=0.0.0.0 -e PORT=8767 -e DATA_DIR=/data -e TZ=Asia/Shanghai   -v /data/promptmanager:/data   --memory 512m --cpus 1.0   promptmanager:1.0.1
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
