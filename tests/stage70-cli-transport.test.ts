import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { ApiEnv } from '../src/client/pm-api.js';
import {
  assertCliOk,
  cookieOf,
  login,
  makeFixture,
  makeTempDir,
  removeTempDir,
  runCliProcess,
} from './helpers.ts';
import { CURRENT_SCHEMA_VERSION } from './migrations.ts';
import { readSource } from './source-text.ts';

/**
 * AC-132 D 组（阶段 70 / FR-150）：`src/server/cli.ts` 的两条通道（直连 DB / HTTP）
 * **显式分层并由表声明**，决策点只有 `resolveTransport` 一处，且 CLI 行为逐条不变。
 *
 * 命令行真实运行全部走 `runCliProcess()`（AGENTS.md §7 pitfall 4）。
 */

const CLI_SOURCE = 'src/server/cli.ts';

/** 环境只用来定型 `dual` 命令：`explicit` = 设了 PM_API_URL。 */
const api = (explicit: boolean): ApiEnv => ({ explicit, token: explicit ? 'pm_fixture' : undefined }) as ApiEnv;

/** 把源码按顶层函数切开：名字 → 函数体（用于「某类命令不许碰另一条通道」的机械切片）。 */
function functionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const heads = [...source.matchAll(/\n(?:export )?(?:async )?function (\w+)\s*\(/g)];
  for (let index = 0; index < heads.length; index += 1) {
    const name = heads[index]?.[1];
    const start = heads[index]?.index;
    if (name === undefined || start === undefined) continue;
    const end = index + 1 < heads.length ? (heads[index + 1]?.index ?? source.length) : source.length;
    bodies.set(name, source.slice(start, end));
  }
  return bodies;
}

test('AC-132 D14 ①：runCli 分派的每条命令都在 COMMAND_TRANSPORTS 里被声明，通道取值合法', async () => {
  const cli = await import('../dist/server/cli.js');
  const declared = cli.COMMAND_TRANSPORTS as Record<string, string>;

  const source = readSource(CLI_SOURCE);
  const runCliAt = source.indexOf('export async function runCli');
  assert.ok(runCliAt > 0, 'runCli 必须是顶层导出函数');
  const dispatched = [...source.slice(runCliAt).matchAll(/case '([a-z-]+)':/g)].map((match) => match[1] ?? '');
  assert.ok(dispatched.length >= 6, `runCli 的 switch 至少 6 条，实测 ${String(dispatched.length)}`);

  assert.deepEqual(
    [...dispatched].sort(),
    Object.keys(declared).sort(),
    '每条被分派的命令都必须有一行通道声明，反之声明里也不许有不存在于 switch 的命令',
  );
  for (const [command, transport] of Object.entries(declared)) {
    assert.ok(
      transport === 'local-db' || transport === 'http' || transport === 'dual',
      `${command} 的通道取值必须是 local-db / http / dual，实测 ${transport}`,
    );
  }
});

test('AC-132 D14 ②：resolveTransport 是唯一的通道决策点（local-db / http 忽略环境，dual 按 PM_API_URL 定型）', async () => {
  const cli = await import('../dist/server/cli.js');
  const resolveTransport = cli.resolveTransport as (command: string, env: ApiEnv) => string;

  assert.equal(resolveTransport('migrate', api(false)), 'local-db');
  assert.equal(resolveTransport('migrate', api(true)), 'local-db', 'migrate 没有第二条路');
  assert.equal(resolveTransport('user', api(true)), 'local-db', 'user set-password 是引导路径');
  assert.equal(resolveTransport('export', api(true)), 'local-db', 'export 是本地备份，不走 HTTP');
  assert.equal(resolveTransport('get', api(false)), 'http', 'get 是纯客户端命令，与 PM_API_URL 无关');
  assert.equal(resolveTransport('render', api(true)), 'http');
  assert.equal(resolveTransport('token', api(false)), 'local-db', '没设 PM_API_URL ⇒ 本机引导路径');
  assert.equal(resolveTransport('token', api(true)), 'http', '设了 PM_API_URL ⇒ 走 HTTP（不回退直连）');

  const source = readSource(CLI_SOURCE);
  const callSites = source.match(/resolveTransport\('token', api\)/g) ?? [];
  assert.equal(callSites.length, 1, 'token() 里必须只有一处通道判定（决策点唯一）');
  assert.match(source, /export const COMMAND_TRANSPORTS = \{/, '通道必须由表声明');
});

test('AC-132 D14 ③：local-db 命令体不碰 HTTP，HTTP 命令体不碰数据库（机械切片）', () => {
  const bodies = functionBodies(readSource(CLI_SOURCE));
  const localDb = ['migrate', 'exportCommand', 'userSetPassword', 'tokenLocal'];
  const http = ['tokenOverHttp', 'getCommand', 'renderCommand'];

  for (const name of localDb) {
    const body = bodies.get(name);
    assert.ok(body !== undefined, `${name} 必须是顶层函数`);
    assert.equal(body.includes('apiRequest('), false, `${name} 属于 local-db 通道，不得调用 apiRequest(`);
  }
  for (const name of http) {
    const body = bodies.get(name);
    assert.ok(body !== undefined, `${name} 必须是顶层函数`);
    assert.equal(body.includes('openCliDatabase('), false, `${name} 属于 http 通道，不得直连数据库`);
  }
  // 直连 DB 只有一个入口；HTTP 只有一个入口（都靠导入名唯一来保证）
  const source = readSource(CLI_SOURCE);
  assert.equal((source.match(/function openCliDatabase\(/g) ?? []).length, 1, '直连 DB 的入口必须唯一');
});

test('AC-132 D15 / D16：真跑 migrate / user set-password / token create·list·revoke / export，退出码与输出逐条不变', async () => {
  const dir = makeTempDir('pm-cli-transport-');
  const runCli = (args: string[], input?: string) => runCliProcess(args, { dataDir: dir, input });

  try {
    // D16：migrate 必须在**没有服务**的情况下建库（引导能力不能砍）
    const migrated = await runCli(['migrate']);
    assertCliOk(migrated, 'migrate');
    assert.equal(
      migrated.stdout,
      `ok: schema at v${String(CURRENT_SCHEMA_VERSION)}\n`,
      '迁移输出必须逐字节不变（版本号从 tests/migrations.ts 派生，别处不许手写）',
    );
    assert.ok(existsSync(path.join(dir, 'pm.db')), 'migrate 必须真的把库建出来（不经 HTTP）');

    const password = await runCli(['user', 'set-password', '--username', 'admin'], 'pw-123456\n');
    assertCliOk(password, 'user set-password');
    assert.equal(password.stdout, 'ok: user admin password updated\n');

    const created = await runCli(['token', 'create', '--name', 'ac-transport']);
    assertCliOk(created, 'token create');
    const plaintext = created.stdout.trimEnd().split('\n').at(-1) ?? '';
    assert.match(plaintext, /^pm_[A-Za-z0-9_-]{40,}$/, '明文只在最后一行');

    const listed = await runCli(['token', 'list']);
    assertCliOk(listed, 'token list');
    assert.match(listed.stdout, /name=ac-transport/);
    assert.equal(listed.stdout.includes(plaintext), false, '列表不得含明文');
    const id = /id=(\d+)/.exec(listed.stdout)?.[1];
    assert.ok(id !== undefined, '列表里应有 id=');

    const revoked = await runCli(['token', 'revoke', id]);
    assertCliOk(revoked, 'token revoke');
    assert.equal(revoked.stdout, `ok: token ${id} revoked\n`);

    const out = path.join(dir, 'backup.json');
    const exported = await runCli(['export', '--out', out]);
    assertCliOk(exported, 'export');
    assert.match(exported.stdout, /^ok: exported \d+ folders \/ \d+ tags \/ \d+ prompts -> /, '导出输出格式不变');
    assert.ok(existsSync(out), '导出必须在没有服务时也能写文件');

    // 用法错误的退出码不变：缺命令 = 2
    const noCommand = await runCli([]);
    assert.equal(noCommand.code, 2, '缺命令仍是用法错误（2）');
    const help = await runCli(['--help']);
    assertCliOk(help, '--help');
    assert.match(help.stdout, /^用法：node bin\/pm\.mjs/);
  } finally {
    removeTempDir(dir);
  }
});

test('AC-132 D15 ②：get / render 走 HTTP；token 在设了 PM_API_URL 时走 HTTP（不回退直连）', async () => {
  const dir = makeTempDir('pm-cli-transport-http-');
  const fx = await makeFixture({}, { dir });
  try {
    const cookie = cookieOf(await login(fx.app));
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie },
      payload: { name: 'transport' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const token = (created.json() as { token: string }).token;
    const prompt = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '通道夹具', user_prompt: '你好 {{姓名}}' },
    });
    const id = (prompt.json() as { id: number }).id;
    const base = (await fx.app.listen({ host: '127.0.0.1', port: 0 })).replace(/\/$/, '');
    const env = { PM_API_URL: base, PM_API_TOKEN: token };

    const got = await runCliProcess(['get', '--id', String(id), '--json'], { env });
    assertCliOk(got, 'get 走 HTTP');
    assert.equal((JSON.parse(got.stdout) as { id: number }).id, id);

    const rendered = await runCliProcess(['render', '--id', String(id), '--set', '姓名=甲'], { env });
    assertCliOk(rendered, 'render 走 HTTP');
    assert.equal(rendered.stdout, '你好 甲');

    // dual：设了 PM_API_URL ⇒ 走 HTTP（stderr 不得出现本机引导提示，也不得回退直连本机库）。
    // ⚠️ 已知矛盾（阶段 70 复核记录，不在本阶段改行为）：`/api/tokens*` 自 FR-105 起是
    // **session-only**，任何令牌调都是 `403 session_required` ⇒ CLI 的 HTTP token 通道事实上
    // 只对 create/list/revoke 尝试后失败（rc=1），真正可用的是本机管理路径。
    const overHttp = await runCliProcess(['token', 'list'], { env });
    assert.equal(overHttp.code, 1, 'HTTP token 通道的现状：服务器 403 session_required ⇒ rc=1');
    assert.match(overHttp.stderr, /403 session_required/, '必须原样透出服务器的 403，不得假装成功');
    assert.equal(overHttp.stderr.includes('bootstrap'), false, '设了 PM_API_URL 不得退化成本机路径');
    assert.equal(overHttp.stdout.trim(), '', 'HTTP 失败不得写出任何结果');

    // 同一个 token 子命令在没设 PM_API_URL 时走本机库（dual 的另一半）
    const localList = await runCliProcess(['token', 'list'], { dataDir: dir });
    assertCliOk(localList, 'token list 走本机库');
    assert.match(localList.stderr, /bootstrap|local/i, '本机路径必须显式提示通道');
  } finally {
    await fx.close();
    removeTempDir(dir);
  }
});
