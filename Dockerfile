#
# promptmanager 容器镜像（多阶段构建）
#
# 构建（项目根目录）： docker build -t promptmanager:1.0.0 .
# 运行：              见 deploy/container.md，或直接用 docker-compose.yml
#
# 设计要点：
#   · **builder 用完整 node:24（自带 python3/make/g++）**：better-sqlite3 是原生模块，
#     其 install 脚本走 `node-gyp rebuild`（从源码编译）；slim 镜像没有工具链会编译失败。
#     在 builder 里编译一次，runtime 直接拷贝 —— runtime 因此不需要工具链。
#   · runtime 用 node:24-slim（镜像小），非 root 运行（镜像自带 node 用户，uid 1000）。
#   · 刻意**不用 alpine**：musl 与 better-sqlite3 的预编译二进制/编译产物兼容性更差。
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

# 直接拷贝 builder 里**已安装/已编译**的依赖 —— 避免在无工具链的 runtime 里重新编译原生模块
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
