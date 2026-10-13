#
# promptmanager 容器镜像（多阶段构建）
#
# 构建（项目根目录）： docker build -t promptmanager:local .
# 运行：              见 deploy/container.md，或直接用 docker-compose.yml
#
# 设计要点：
#   · better-sqlite3 是原生模块，但**包内自带 prebuilds/**（8 个平台，含 linux-x64.node 与
#     linuxmusl-x64.node），且**没有 install 脚本**：npm 11 的 allow-scripts 策略会打印
#     `npm warn allow-scripts … (install: node-gyp rebuild)` 并跳过它，随后直接用 prebuilds
#     （2026-10-13 复核，本项目实测可用）。⇒ **工具链不是必需的**：builder 用完整 node:24 只是保险
#     （万一 prebuild 与目标平台不匹配还能现场编译），不是 slim 会构建失败。
#   · runtime 用 node:24-slim（镜像小），非 root 运行（镜像自带 node 用户，uid 1000）。
#   · 刻意**不用 alpine**：本仓库只在 glibc 的 node:24 上验证过（musl 预编译件虽在 tarball 里，但未实测）。
#   · 数据落在卷挂载点 /data（SQLite 单文件 + media/），容器重建不丢数据。
#   · 健康检查用 node 内置 fetch（slim 镜像不含 curl）。

FROM node:24 AS builder
WORKDIR /app

# 依赖层（单独一层，利用构建缓存）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 源码与构建配置
COPY tsconfig.json tsconfig.tests.json vite.config.ts ./
COPY src ./src
COPY web ./web
COPY bin ./bin
COPY migrations ./migrations
RUN npm run build

# 裁掉 devDependencies（保留已编译好的生产依赖，含 better-sqlite3 的 .node）
RUN npm prune --omit=dev

# ---------- 运行阶段 ----------
FROM node:24-slim AS runtime

ENV NODE_ENV=production     HOST=0.0.0.0     PORT=8767     DATA_DIR=/data

WORKDIR /app

# 直接拷贝 builder 里已安装的依赖（含 better-sqlite3 的 prebuild `.node`）—— runtime 无工具链也不需要编译
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/migrations ./migrations
COPY package.json package-lock.json ./

# 数据目录 + 属主（卷挂载后沿用宿主目录属主；首次创建时给 node 用户）
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 8767

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3   CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8767)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
