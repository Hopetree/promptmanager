import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CliResult } from './helpers.ts';
import {
  PROJECT_ROOT,
  assertCliOk,
  cookieOf,
  login,
  makeFixture,
  makeTempDir,
  removeTempDir,
  runCliProcess,
} from './helpers.ts';

const runCli = (args: string[], env: Record<string, string>): Promise<CliResult> => runCliProcess(args, { env });

/** 起一个真实监听的服务 + 建好 token，返回 CLI 需要的 env。 */
async function fixtureWithToken() {
  const dir = makeTempDir('pm-cli-get-');
  const fx = await makeFixture({}, { dir });
  const cookie = cookieOf(await login(fx.app));
  const created = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'cli' } });
  assert.equal(created.statusCode, 201, created.body);
  const token = (created.json() as { token: string }).token;

  const prompt = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { title: '会话交接模板', user_prompt: '你好 {{姓名}}，交给下一位 {{var-b}}', tags: ['交接'] },
  });
  const id = (prompt.json() as { id: number }).id;
  await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '无关记录' } });

  const base = (await fx.app.listen({ host: '127.0.0.1', port: 0 })).replace(/\/$/, '');
  return {
    fx,
    dir,
    id,
    base,
    env: { PM_API_URL: base, PM_API_TOKEN: token },
    cleanup: async () => {
      await fx.close();
      removeTempDir(dir);
    },
  };
}

test('AC-24：pm get 检索（--json 输出数组）/ 按 id 取单条 / 不存在 → 退出码 1', async () => {
  const ctx = await fixtureWithToken();
  try {
    const search = await runCli(['get', '会话交接', '--json'], ctx.env);
    assertCliOk(search, 'CLI 退出码');
    const items = JSON.parse(search.stdout) as Array<{ id: number; title: string }>;
    assert.ok(Array.isArray(items), '应输出 JSON 数组');
    assert.equal(items.length, 1, '夹具里只有 1 条命中');
    assert.equal(items[0]?.title, '会话交接模板');

    const single = await runCli(['get', '--id', String(ctx.id), '--json'], ctx.env);
    assertCliOk(single, 'CLI 退出码');
    const one = JSON.parse(single.stdout) as { id: number; user_prompt: string };
    assert.equal(one.id, ctx.id);
    assert.equal(one.user_prompt, '你好 {{姓名}}，交给下一位 {{var-b}}');
    assert.ok(!Array.isArray(one), '--id 应输出单条对象');

    const missing = await runCli(['get', '--id', '99999'], ctx.env);
    assert.equal(missing.code, 1, `不存在的 id 必须非 0：stdout=${missing.stdout}`);
    assert.match(missing.stderr, /error:/);

    // 人类可读模式（无 --json）也要能列出
    const pretty = await runCli(['get', '会话交接'], ctx.env);
    assertCliOk(pretty, 'CLI 退出码');
    assert.match(pretty.stdout, /会话交接模板/);
  } finally {
    await ctx.cleanup();
  }
});

test('AC-24：pm render 输出与 /api/render 的 user_prompt 逐字符一致', async () => {
  const ctx = await fixtureWithToken();
  try {
    const api = await ctx.fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(ctx.id)}/render`,
      headers: { authorization: `Bearer ${ctx.env.PM_API_TOKEN ?? ''}` },
      payload: { values: { 姓名: '张三' } },
    });
    assert.equal(api.statusCode, 200, api.body);
    const expected = (api.json() as { user_prompt: string }).user_prompt;
    assert.equal(expected, '你好 张三，交给下一位 {{var-b}}');

    const cli = await runCli(['render', '--id', String(ctx.id), '--set', '姓名=张三'], ctx.env);
    assertCliOk(cli, 'CLI 退出码');
    assert.equal(cli.stdout, expected, 'stdout 必须与 /api/render 的 user_prompt 逐字符一致（不加额外换行）');

    const json = await runCli(['render', '--id', String(ctx.id), '--set', '姓名=张三', '--json'], ctx.env);
    assertCliOk(json, 'CLI 退出码');
    const body = JSON.parse(json.stdout) as { user_prompt: string; missing: string[] };
    assert.equal(body.user_prompt, expected);
    assert.deepEqual(body.missing, ['var-b']);

    // 多个 --set（含值里带 = 的情况）
    const multi = await runCli(['render', '--id', String(ctx.id), '--set', '姓名=李四', '--set', 'var-b=a=b'], ctx.env);
    assertCliOk(multi, 'CLI 退出码');
    assert.equal(multi.stdout, '你好 李四，交给下一位 a=b');

    // 缺变量时保持原样并列入 missing
    const partial = await runCli(['render', '--id', String(ctx.id), '--json'], ctx.env);
    const partialBody = JSON.parse(partial.stdout) as { user_prompt: string; missing: string[] };
    assert.equal(partialBody.user_prompt, '你好 {{姓名}}，交给下一位 {{var-b}}');
    assert.deepEqual(partialBody.missing, ['姓名', 'var-b']);
  } finally {
    await ctx.cleanup();
  }
});

test('AC-24：用法错误 → 退出码 2；连不上 → 非 0（不得静默回退直连 DB）', async () => {
  const ctx = await fixtureWithToken();
  try {
    const cases: Array<[string[], RegExp]> = [
      [['get'], /关键词|--id/],
      [['get', '--id', 'abc'], /id/],
      [['get', 'a', 'b'], /参数/],
      [['get', 'x', '--nope'], /nope/],
      [['render'], /--id/],
      [['render', '--id', '1', '--set', 'bad'], /=/],
      [['render', '--id', '1', '--set', '=v'], /空/],
      [['render', '--id', 'abc'], /id/],
    ];
    for (const [args, hint] of cases) {
      const res = await runCli(args, ctx.env);
      assert.equal(res.code, 2, `${args.join(' ')} 应为用法错误：${res.stderr}`);
      assert.match(res.stderr, hint);
    }

    // 没有 PM_API_TOKEN → 必须报错（不允许"悄悄地"用本地库）
    const noToken = await runCli(['get', '会话交接'], { PM_API_URL: ctx.base });
    assert.equal(noToken.code, 2, `缺 PM_API_TOKEN 应报错：stdout=${noToken.stdout}`);
    assert.equal(noToken.stdout, '', '不得回退直连 DB 输出数据');

    // 服务器不可达 → 非 0
    const dead = await runCli(['get', '会话交接'], { PM_API_URL: 'http://127.0.0.1:1', PM_API_TOKEN: ctx.env.PM_API_TOKEN ?? 'x' });
    assert.notEqual(dead.code, 0);
    assert.equal(dead.stdout, '');
    assert.match(dead.stderr, /无法连接|error:/);

    // 错 token → 401 → 非 0
    const badToken = await runCli(['get', '会话交接'], { PM_API_URL: ctx.base, PM_API_TOKEN: 'pm_wrong' });
    assert.equal(badToken.code, 1, badToken.stderr);
    assert.match(badToken.stderr, /401/);
  } finally {
    await ctx.cleanup();
  }
});
