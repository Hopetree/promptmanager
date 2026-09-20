// 测试夹具（非 *.test.ts，AC-16 的文件计数只数 *.test.*）。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../dist/config.js';
import { openDatabase, prepareDatabase } from '../dist/db/index.js';
import { setUserPassword } from '../dist/services/auth.js';
import { buildApp } from '../dist/server/app.js';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_PW = 'ac-fixture-pw-20260918';
export const FIXTURE_USER = 'admin';

export interface Fixture {
  app: FastifyInstance;
  dir: string;
  config: ReturnType<typeof loadConfig>;
  close: () => Promise<void>;
}

/** 起一个临时 DATA_DIR 的应用实例（默认已建好 admin 用户）。
 *  传入 options.dir 可复用既有数据目录（用于"重启后仍持久"的用例；此时 close() 不删目录）。 */
export async function makeFixture(
  env: Record<string, string> = {},
  options: { withUser?: boolean; dir?: string } = {},
): Promise<Fixture> {
  const ownDir = options.dir === undefined;
  const dir = options.dir ?? mkdtempSync(path.join(tmpdir(), 'pm-api-'));
  const config = loadConfig({ DATA_DIR: dir, PORT: '8767', HOST: '0.0.0.0', ...env });
  if (options.withUser !== false) {
    const { qe } = prepareDatabase(config);
    await setUserPassword(qe, FIXTURE_USER, FIXTURE_PW);
    await qe.destroy();
  }
  const app = await buildApp(config);
  return {
    app,
    dir,
    config,
    close: async () => {
      await app.close();
      if (ownDir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------- CLI 子进程

export interface CliResult {
  code: number | null;
  /** 子进程收到的信号（`code === null` 时非空 —— 诊断"被信号杀死"用） */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** 是否撞上本地安全阀（真卡住时才是 true；不是"并发下偶发被杀"） */
  timedOut: boolean;
}

/** CLI 子进程的本地安全阀（真卡住时给出明确诊断；**不是重试**）。 */
export const CLI_TIMEOUT_MS = 30_000;

/**
 * 跑一次 CLI（子进程）—— **四个 cli-*.test.ts 共用这一份**。
 *
 * ⚠️ `detached: true` 是关键（2026-09-20，上线准备 P2 返工）：
 * 若子进程与测试运行器**同进程组**，一旦验证/沙箱环境对该命令的进程组做整体清理（`kill -PGID`，
 * 例如 `bwrap --die-with-parent` 或任何"杀整棵命令树"的收尾），仍在运行的 CLI 子进程会被**连带杀死** ⇒
 * 断言看到 `code === null`（被信号杀死）。已用对照实验确认：同组子进程被杀、`detached` 子进程存活。
 * 子进程是毫秒级短命命令，独立进程组不会残留（另有 30s 安全阀兜底）。
 *
 * ⚠️ `child.stdin.on('error')` 同样必要：子进程先退出而父进程仍在写 stdin 会产生 **EPIPE**，
 * 未处理的 stream `'error'` 会变成未捕获异常、崩掉整个测试文件进程（并连带杀死同文件里其它待完成的子进程）。
 */
export function runCliProcess(
  args: string[],
  options: { dataDir?: string; env?: Record<string, string>; input?: string } = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/pm.mjs', ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: '8767',
        ...(options.dataDir === undefined ? {} : { DATA_DIR: options.dataDir }),
        ...options.env,
      },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.stdin.on('error', () => {
      /* EPIPE：子进程先退出时忽略，绝不让它变成未捕获异常 */
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CLI_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.stdin.end(options.input ?? '');
  });
}

/** CLI 断言辅助：失败信息里带上 signal / timedOut / stderr / stdout，便于定位偶发失败。 */
export function assertCliOk(res: CliResult, label: string): void {
  assert.equal(
    res.code,
    0,
    `${label}：rc=${String(res.code)} signal=${String(res.signal)} timedOut=${String(res.timedOut)}\n--- stderr ---\n${res.stderr}\n--- stdout ---\n${res.stdout}`,
  );
}

export function makeTempDir(prefix = 'pm-api-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function login(app: FastifyInstance, password: string = FIXTURE_PW, username: string = FIXTURE_USER) {
  return app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
}

/** 从响应里取出 "pm_sid=…" 这一段，供后续请求的 Cookie 头使用。 */
export function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return value.split(';')[0] ?? '';
}

export function setCookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(String).join(' | ') : String(raw);
}

/** 直接读库断言（WAL 模式下可与应用进程并存）。 */
export function readDb<T>(fixture: Fixture, fn: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase(fixture.config);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
