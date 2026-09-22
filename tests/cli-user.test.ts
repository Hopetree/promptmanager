import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import type { CliResult } from './helpers.ts';
import {
  PROJECT_ROOT,
  assertCliOk,
  makeTempDir,
  removeTempDir,
  runCliProcess,
} from './helpers.ts';

/** CLI 子进程的本地安全阀（真卡住时给出明确诊断；**不是重试**）。 */
const CLI_TIMEOUT_MS = 30_000;

/**
 * 跑一次 CLI（子进程）。
 *
 * ⚠️ **`detached: true` 是修 flaky 的关键**（2026-09-20，上线准备 P2）：
 * 之前子进程与测试运行器**同进程组**，一旦验证/沙箱环境对该命令的进程组做整体清理（`kill -PGID`，
 * 例如 `bwrap --die-with-parent` 或任何"杀整棵命令树"的收尾），仍在运行的 CLI 子进程会被连带杀死 ⇒
 * `runCli` 收到 `code === null`（被信号杀死），断言随机失败；单跑该文件因为窗口更短而总是绿的。
 * 已用对照实验确认：同组子进程被杀、`detached` 子进程存活（见 PROGRESS 阶段 26 §C）。
 * 子进程是短命命令（毫秒级），独立进程组不会残留。
 */
const runCli = (args: string[], dataDir: string, input = ''): Promise<CliResult> =>
  runCliProcess(args, { dataDir, input });

/** CLI 断言辅助：失败信息里带上 signal 与 stderr，便于定位"退出码 null（被信号杀死）"这类并发问题。 */
function cliOk(res: CliResult, label: string): void {
  assert.equal(
    res.code,
    0,
    `${label}：rc=${String(res.code)} signal=${String(res.signal)} timedOut=${String(res.timedOut)}\n--- stderr ---\n${res.stderr}\n--- stdout ---\n${res.stdout}`,
  );
}

const PW = 'cli-fixture-pw-20260918';

test('CLI：user set-password 成功 → 输出固定文案、rc=0、stdout/stderr 不含口令明文', async () => {
  const dir = makeTempDir('pm-cli-');
  try {
    const res = await runCli(['user', 'set-password', '--username', 'admin'], dir, `${PW}\n`);
    assert.equal(res.code, 0, `stderr=${res.stderr}`);
    assert.equal(res.stdout, 'ok: user admin password updated\n');
    assert.equal(res.stderr, '');
    assert.ok(!res.stdout.includes(PW) && !res.stderr.includes(PW), '绝不打印口令');
    assert.ok(existsSync(`${dir}/pm.db`), '应自动迁移建库');
  } finally {
    removeTempDir(dir);
  }
});

test('CLI：设置的口令可用于 HTTP 登录；重设后旧口令失效', async () => {
  const dir = makeTempDir('pm-cli-');
  const { loadConfig } = await import('../dist/config.js');
  const { buildApp } = await import('../dist/server/app.js');
  try {
    const first = await runCli(['user', 'set-password', '--username', 'admin'], dir, `${PW}\n`);
    cliOk(first, '第一次 migrate');

    const config = loadConfig({ DATA_DIR: dir, PORT: '8767' });
    const app = await buildApp(config);
    try {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: 'admin', password: PW },
      });
      assert.equal(ok.statusCode, 200, ok.body);
    } finally {
      await app.close();
    }

    const rotated = 'cli-fixture-pw-rotated-20260918';
    const second = await runCli(['user', 'set-password', '--username', 'admin'], dir, `${rotated}\n`);
    cliOk(second, '第二次 migrate');

    const app2 = await buildApp(loadConfig({ DATA_DIR: dir, PORT: '8767' }));
    try {
      const oldPw = await app2.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } });
      assert.equal(oldPw.statusCode, 401, '旧口令必须失效');
      const newPw = await app2.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: rotated } });
      assert.equal(newPw.statusCode, 200, newPw.body);
    } finally {
      await app2.close();
    }
  } finally {
    removeTempDir(dir);
  }
});

test('CLI：改口令即吊销该用户既有会话', async () => {
  const dir = makeTempDir('pm-cli-');
  const { loadConfig } = await import('../dist/config.js');
  const { buildApp } = await import('../dist/server/app.js');
  try {
    cliOk(await runCli(['user', 'set-password', '--username', 'admin'], dir, `${PW}\n`), 'CLI 退出码');
    const app = await buildApp(loadConfig({ DATA_DIR: dir, PORT: '8767' }));
    let cookie = '';
    try {
      const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } });
      assert.equal(res.statusCode, 200);
      const raw = res.headers['set-cookie'];
      cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
      assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode, 200);
    } finally {
      await app.close();
    }

    cliOk(await runCli(['user', 'set-password', '--username', 'admin'], dir, `${PW}-2\n`), 'CLI 退出码');

    const app2 = await buildApp(loadConfig({ DATA_DIR: dir, PORT: '8767' }));
    try {
      const res = await app2.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      assert.equal(res.statusCode, 401, '改口令后旧会话应失效');
    } finally {
      await app2.close();
    }
  } finally {
    removeTempDir(dir);
  }
});

test('CLI：用法错误一律 rc=2（缺 --username / 空口令 / 未知选项 / 未知子命令 / 未知命令）', async () => {
  const dir = makeTempDir('pm-cli-');
  try {
    const cases: Array<{ args: string[]; input?: string; hint: RegExp }> = [
      { args: ['user', 'set-password'], hint: /username/ },
      { args: ['user', 'set-password', '--username', 'admin'], input: '', hint: /口令/ },
      { args: ['user', 'set-password', '--username', 'admin', '--extra'], input: `${PW}\n`, hint: /--extra/ },
      { args: ['user', 'frobnicate'], hint: /frobnicate/ },
      { args: ['definitely-not-a-command'], hint: /definitely-not-a-command/ },
    ];
    for (const item of cases) {
      const res = await runCli(item.args, dir, item.input ?? '');
      assert.equal(res.code, 2, `args=${item.args.join(' ')} stderr=${res.stderr}`);
      assert.match(res.stderr, item.hint);
      assert.ok(!res.stderr.includes(PW), '用法错误也不能回显口令');
    }
  } finally {
    removeTempDir(dir);
  }
});

test('CLI：migrate 幂等 → 两次都输出 ok: schema at v5，rc=0', async () => {
  const dir = makeTempDir('pm-cli-');
  try {
    const first = await runCli(['migrate'], dir);
    cliOk(first, '第一次 migrate');
    // v5 = 001 初始 + 002（阶段 6 token/usage）+ 003（阶段 22 prompts.sort_order）+ 004（阶段 35 token_enc）
    //      + 005（阶段 42 token scope / usage token_id）
    assert.equal(first.stdout, 'ok: schema at v5\n');

    const second = await runCli(['migrate'], dir);
    cliOk(second, '第二次 migrate');
    assert.equal(second.stdout, 'ok: schema at v5\n');
  } finally {
    removeTempDir(dir);
  }
});

test('CLI：无参数 / --help 的退出码语义（用法错误 2、帮助 0）', async () => {
  const dir = makeTempDir('pm-cli-');
  try {
    const none = await runCli([], dir);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /用法/);

    const help = await runCli(['--help'], dir);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /migrate/);
  } finally {
    removeTempDir(dir);
  }
});
