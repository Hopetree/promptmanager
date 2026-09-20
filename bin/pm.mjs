#!/usr/bin/env node
// promptmanager CLI 入口（BRIEF §6.2，名字固定）。
// 真正的实现在 src/server/cli.ts → dist/server/cli.js；首次使用需先 `npm run build:server`
// （`npm run migrate` 已自带构建，日常直接用脚本即可）。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(projectRoot, 'dist', 'server', 'cli.js');

if (!existsSync(entry)) {
  process.stderr.write(
    "error: 未找到构建产物 dist/server/cli.js —— 请先执行 'npm run build'（或 'npm run build:server'）\n",
  );
  process.exit(1);
}

const { runCli } = await import(pathToFileURL(entry).href);
process.exitCode = await runCli(process.argv.slice(2));
