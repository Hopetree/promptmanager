#!/usr/bin/env node
// promptmanager MCP server 入口（BRIEF §7 名字固定）：stdio 传输，由 MCP 客户端（agent）拉起。
//
// ⚠️ stdin/stdout 是 JSON-RPC 通道：本文件**绝不**向 stdout 写日志/提示，诊断一律 stderr。
// 数据访问全部经本服务的 HTTP API + Bearer（PM_API_URL + PM_API_TOKEN），不直连数据库。
//
// 用法（示例）：
//   PM_API_URL=http://127.0.0.1:8767 PM_API_TOKEN=pm_… node bin/pm-mcp.mjs
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(projectRoot, 'dist', 'mcp', 'server.js');

if (!existsSync(entry)) {
  process.stderr.write(
    "error: 未找到构建产物 dist/mcp/server.js —— 请先执行 'npm run build'（或 'npm run build:server'）\n",
  );
  process.exit(1);
}

const { runMcpServer } = await import(pathToFileURL(entry).href);
await runMcpServer();
