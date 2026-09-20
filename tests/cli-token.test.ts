import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { CliResult } from './helpers.ts';
import {
  PROJECT_ROOT,
  assertCliOk,
  cookieOf,
  login,
  makeFixture,
  makeTempDir,
  readDb,
  removeTempDir,
  runCliProcess,
} from './helpers.ts';

const runCli = (args: string[], dataDir: string, env: Record<string, string> = {}): Promise<CliResult> =>
  runCliProcess(args, { dataDir, env });

test('AC-22 ①：pm token create 输出形如 pm_… 的明文（最后一行），库里存 sha256 hex', async () => {
  const dir = makeTempDir('pm-cli-token-');
  try {
    const res = await runCli(['token', 'create', '--name', 'ac'], dir);
    assertCliOk(res, 'CLI 退出码');
    const lines = res.stdout.trimEnd().split('\n');
    const token = lines[lines.length - 1] ?? '';
    assert.match(token, /^pm_[A-Za-z0-9_-]{40,}$/, `最后一行应是明文 token，实际：${JSON.stringify(token)}`);
    assert.equal(lines.length, 1, 'stdout 只应输出明文 token 一行（人类可读信息走 stderr）');
    assert.match(res.stderr, /bootstrap|local/i, '本地引导路径应显式提示所用通道（不静默）');

    const { openDatabase } = await import('../dist/db/index.js');
    const db = openDatabase({ dataDir: dir });
    const row = db.prepare('select id, name, token_hash, length(token_hash) as len from api_tokens').get() as {
      id: number;
      name: string;
      token_hash: string;
      len: number;
    };
    db.close();
    assert.equal(row.name, 'ac');
    assert.equal(row.len, 64, 'token_hash 必须是 sha256 hex（64）');
    assert.notEqual(row.token_hash, token);
  } finally {
    removeTempDir(dir);
  }
});

test('AC-22 ⑤：pm token list 不含明文；pm token revoke <id> 后 Bearer 立即 401', async () => {
  const dir = makeTempDir('pm-cli-token-');
  const fx = await makeFixture({}, { dir });
  try {
    const created = await runCli(['token', 'create', '--name', 'ac'], dir);
    const token = created.stdout.trimEnd().split('\n').pop() ?? '';

    const listed = await runCli(['token', 'list'], dir);
    assertCliOk(listed, 'CLI 退出码');
    assert.match(listed.stdout, /ac/, '列表应包含名字');
    assert.match(listed.stdout, /id=1/);
    assert.ok(!listed.stdout.includes(token), 'list 不得回显明文 token');
    assert.ok(!listed.stderr.includes(token), 'list 的 stderr 也不得回显明文');

    // 用 CLI 建出来的 token 直接访问运行中的服务
    assert.equal(
      (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { authorization: `Bearer ${token}` } })).statusCode,
      200,
    );

    const revoked = await runCli(['token', 'revoke', '1'], dir);
    assertCliOk(revoked, 'CLI 退出码');
    assert.match(revoked.stdout, /revoked/);
    assert.equal(
      (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { authorization: `Bearer ${token}` } })).statusCode,
      401,
      '撤销后必须立即 401',
    );
  } finally {
    await fx.close();
    removeTempDir(dir);
  }
});

test('pm token 的用法错误 → rc=2；撤销不存在的 id → rc=1', async () => {
  const dir = makeTempDir('pm-cli-token-');
  try {
    assert.equal((await runCli(['token'], dir)).code, 2, '缺子命令');
    assert.equal((await runCli(['token', 'create'], dir)).code, 2, '缺 --name');
    assert.equal((await runCli(['token', 'frobnicate'], dir)).code, 2, '未知子命令');
    assert.equal((await runCli(['token', 'revoke'], dir)).code, 2, '缺 id');
    assert.equal((await runCli(['token', 'create', '--name', 'x', '--nope'], dir)).code, 2, '未知选项');
    assert.equal((await runCli(['token', 'revoke', '999'], dir)).code, 1, '不存在的 id → 运行时错误');
    assert.equal((await runCli(['token', 'revoke', 'abc'], dir)).code, 2, '非数字 id → 用法错误');
  } finally {
    removeTempDir(dir);
  }
});

test('Token 子命令：配了 PM_API_URL + PM_API_TOKEN 就走 HTTP，且连不上时绝不回退直连 DB', async () => {
  const dir = makeTempDir('pm-cli-token-');
  const fx = await makeFixture({}, { dir });
  try {
    const cookie = cookieOf(await login(fx.app));
    const created = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'http-路径' } });
    assert.equal(created.statusCode, 201, created.body);
    const token = (created.json() as { token: string }).token;
    assert.match(token, /^pm_/);

    const server = await fx.app.listen({ host: '127.0.0.1', port: 0 });
    const base = server.replace(/\/$/, '');

    const overHttp = await runCli(['token', 'list'], dir, { PM_API_URL: base, PM_API_TOKEN: token });
    assertCliOk(overHttp, 'CLI 退出码');
    assert.match(overHttp.stdout, /http-路径/, '应通过 HTTP 列出 token');
    assert.match(overHttp.stderr, /http/i, '应显式提示走了 HTTP 通道');

    // 关键：配了 PM_API_URL 但服务不可达 → 必须报错，不许静默读本地库
    const dead = await runCli(['token', 'list'], dir, { PM_API_URL: 'http://127.0.0.1:1', PM_API_TOKEN: token });
    assert.equal(dead.code, 1, `连不上必须非 0 退出（不得回退直连 DB）：stdout=${dead.stdout}`);
    assert.match(dead.stderr, /error:/);
    assert.ok(!dead.stdout.includes('http-路径'), '不得回退直连 DB 后把本地 token 列出来');

    // 没有凭据但配了地址 → 也报错（不能既走 HTTP 又不需要认证）
    const noCred = await runCli(['token', 'list'], dir, { PM_API_URL: base });
    assert.equal(noCred.code, 2, '缺 PM_API_TOKEN → 用法错误');
  } finally {
    await fx.close();
    removeTempDir(dir);
  }
});
