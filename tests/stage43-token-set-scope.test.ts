// 阶段 43 / FR-105（允许修改「已有令牌」的权限）断言。
//
// 覆盖：**防自我提权**（只读令牌改自己 → 403 session_required 且库里仍是 read）、
// 改权限**立即生效**（同一个令牌紧接着就能/不能再写，没有重建、没有重新登录）、
// 已撤销 → 409 `token_revoked`、入参校验（additionalProperties:false）、404、
// 阶段 42 的三类边界不回归、界面/CLI 的源码级判据。
// 真令牌打真端点的**原样输出**在 tools/ac-stage43.sh（含真鼠标改权限 + 服务端日志 grep）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import type { Fixture } from './helpers.ts';
import { cookieOf, login, makeFixture, PROJECT_ROOT, readDb } from './helpers.ts';

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function makeToken(
  fx: Fixture,
  cookie: string,
  name: string,
  scope?: 'read' | 'write',
): Promise<{ id: number; token: string; scope: string }> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { cookie },
    payload: scope === undefined ? { name } : { name, scope },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: number; token: string; scope: string };
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

/** 会话调 PATCH（唯一被允许的通道）。 */
async function patchScope(fx: Fixture, cookie: string, id: number, payload: unknown) {
  return fx.app.inject({ method: 'PATCH', url: `/api/tokens/${String(id)}`, headers: { cookie }, payload: payload as never });
}

/** 用令牌调 PATCH（**必须**被闸门拦成 403 session_required）。 */
async function patchWithToken(fx: Fixture, token: string, id: number, payload: unknown) {
  const options: InjectOptions = { method: 'PATCH', url: `/api/tokens/${String(id)}`, headers: bearer(token) };
  options.payload = payload as InjectOptions['payload'];
  return fx.app.inject(options);
}

function scopeInDb(fx: Fixture, id: number): string {
  return readDb(
    fx,
    (db) => (db.prepare('SELECT scope FROM api_tokens WHERE id = ?').get(id) as { scope: string } | undefined)?.scope ?? '<missing>',
  );
}

async function canWrite(fx: Fixture, token: string): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: bearer(token),
    payload: { title: `写于 ${new Date().toISOString()}` },
  });
  return res.statusCode;
}

test('AC-107 ①：**防自我提权** —— 只读令牌改自己/别人、读写令牌改自己/别人，一律 403 session_required 且库里不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const read = await makeToken(fx, cookie, 'ro-self', 'read');
    const other = await makeToken(fx, cookie, 'ro-other', 'read');
    const write = await makeToken(fx, cookie, 'rw-self', 'write');

    // 只读令牌改**自己**（最关键的一条：能改就等于能把自己变成读写 ⇒ 阶段 42 的边界整体失效）
    const selfEscalate = await patchWithToken(fx, read.token, read.id, { scope: 'write' });
    assert.equal(selfEscalate.statusCode, 403, `只读令牌改自己必须 403：${selfEscalate.body}`);
    assert.equal((selfEscalate.json() as { error: string }).error, 'session_required', '必须是 session_required（不是 insufficient_scope）');
    assert.equal(scopeInDb(fx, read.id), 'read', '被拒后库里必须仍是 read');
    assert.equal(await canWrite(fx, read.token), 403, '被拒后它写资源仍必须 403（没有被提权）');

    // 只读令牌改**别人** → 同样 403（令牌不能碰令牌管理）
    assert.equal((await patchWithToken(fx, read.token, other.id, { scope: 'write' })).statusCode, 403);
    // 读写令牌改**自己** / 改**别人** → 同样 403（读写 ≠ 能管令牌）
    assert.equal((await patchWithToken(fx, write.token, write.id, { scope: 'read' })).statusCode, 403);
    assert.equal((await patchWithToken(fx, write.token, other.id, { scope: 'write' })).statusCode, 403);
    assert.equal(scopeInDb(fx, other.id), 'read', '令牌通道一次也没能改动库');
    assert.equal(scopeInDb(fx, write.id), 'write');

    // 会话仍是唯一通道
    assert.equal((await patchScope(fx, cookie, other.id, { scope: 'write' })).statusCode, 200);
  } finally {
    await fx.close();
  }
});

test('AC-107 ②③：改权限**立即生效** —— 只读→读写后同一个令牌就能写；改回只读立刻不能再写', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await makeToken(fx, cookie, 'flip', 'read');
    assert.equal(await canWrite(fx, token.token), 403, '改之前只读 ⇒ 写 403');

    // ② 只读 → 读写
    const up = await patchScope(fx, cookie, token.id, { scope: 'write' });
    assert.equal(up.statusCode, 200, up.body);
    assert.equal((up.json() as { scope: string }).scope, 'write', 'PATCH 响应必须回带新权限');
    assert.equal(scopeInDb(fx, token.id), 'write', '库里必须立刻是 write');
    // **同一个令牌**（没有重建、没有重新登录）紧接着就能写
    assert.equal(await canWrite(fx, token.token), 201, '改权限后同一个令牌必须立刻能写（201）');
    const listed = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    const row = (listed.json() as { items: Array<{ id: number; scope: string }> }).items.find((item) => item.id === token.id);
    assert.equal(row?.scope, 'write', 'GET /api/tokens 里该行也必须是 write');

    // ③ 读写 → 只读（同法改回，同样立即生效）
    const down = await patchScope(fx, cookie, token.id, { scope: 'read' });
    assert.equal(down.statusCode, 200, down.body);
    assert.equal(scopeInDb(fx, token.id), 'read');
    const writeAttempt = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: bearer(token.token),
      payload: { title: '改回只读后不该成功' },
    });
    assert.equal(writeAttempt.statusCode, 403, '改回只读后必须立刻 403');
    assert.equal((writeAttempt.json() as { error: string }).error, 'insufficient_scope', '错误码必须是 insufficient_scope（资源写）');
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(token.token) })).statusCode, 200, '只读仍能读');

    // 幂等：再改成 read 仍 200（不是 409）
    assert.equal((await patchScope(fx, cookie, token.id, { scope: 'read' })).statusCode, 200);
  } finally {
    await fx.close();
  }
});

test('AC-107 ④：已撤销的令牌 → 409 token_revoked（带可读说明，且不回改库）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await makeToken(fx, cookie, 'revoked-target', 'write');
    assert.equal((await fx.app.inject({ method: 'DELETE', url: `/api/tokens/${String(token.id)}`, headers: { cookie } })).statusCode, 204);

    const res = await patchScope(fx, cookie, token.id, { scope: 'read' });
    assert.equal(res.statusCode, 409, `已撤销的令牌改权限必须 409：${res.body}`);
    const body = res.json() as { error: string; message?: string };
    assert.equal(body.error, 'token_revoked');
    assert.ok(/已撤销/.test(body.message ?? ''), '消息必须讲清"已撤销的令牌权限没有意义"');
    assert.ok(/重建/.test(body.message ?? ''), '消息必须给出出路（重建一个）');
    assert.equal(scopeInDb(fx, token.id), 'write', '409 不得改动库');

    // 既有 409 的响应体**逐字不变**（只有带 detail 的 409 才多 message）
    const other = await makeToken(fx, cookie, 'still-active', 'read');
    const notRevoked = await fx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${String(other.id)}/permanent`,
      headers: { cookie },
    });
    assert.equal(notRevoked.statusCode, 409);
    assert.deepEqual(notRevoked.json(), { error: 'token_not_revoked' }, '既有 409 形状不得被 FR-105 改动');
  } finally {
    await fx.close();
  }
});

test('AC-107 ⑤：入参校验 —— 只收 scope（additionalProperties:false）；非法值/空体/多传字段 400；不存在 404', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await makeToken(fx, cookie, 'validate', 'read');

    for (const [label, payload] of [
      ['scope=admin', { scope: 'admin' }],
      ['空体', {}],
      ['多传 name（本阶段不做改名）', { name: 'x' }],
      ['多传 scope + name', { scope: 'write', name: 'x' }],
    ] as Array<[string, unknown]>) {
      const res = await patchScope(fx, cookie, token.id, payload);
      assert.equal(res.statusCode, 400, `${label} 必须 400：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'invalid_body', `${label} 错误码`);
    }
    assert.equal(scopeInDb(fx, token.id), 'read', '被拒的请求不得改动库');
    assert.equal((await patchScope(fx, cookie, 999_999, { scope: 'write' })).statusCode, 404, '不存在的 id → 404');
    assert.equal((await patchScope(fx, cookie, 0, { scope: 'write' })).statusCode, 404, '非正整数 id 按不存在处理（既有口径）');
  } finally {
    await fx.close();
  }
});

test('AC-107 ⑧：阶段 42 的边界不回归 —— 只读的 6 个写端点仍 403 insufficient_scope；令牌管理含 PATCH 仍 403 session_required；渲染 POST 仍 200', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const read = await makeToken(fx, cookie, 'regress-ro', 'read');
    const created = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '回归夹具' } });
    const id = (created.json() as { id: number }).id;

    const writes: Array<[string, string, unknown?]> = [
      ['POST', '/api/prompts', { title: 'x' }],
      ['PUT', `/api/prompts/${String(id)}`, { title: 'y' }],
      ['DELETE', `/api/prompts/${String(id)}`, undefined],
      ['PATCH', '/api/prompts/order', { ids: [id] }],
      ['POST', '/api/folders', { name: 'f' }],
      ['POST', '/api/tags', { name: 't' }],
    ];
    for (const [method, url, payload] of writes) {
      const options: InjectOptions = { method: method as 'POST', url, headers: bearer(read.token) };
      if (payload !== undefined && payload !== null) options.payload = payload as InjectOptions['payload'];
      const res = await fx.app.inject(options);
      assert.equal(res.statusCode, 403, `${method} ${url} 必须仍 403：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'insufficient_scope', `${method} ${url} 错误码`);
    }

    // 令牌管理（**含本阶段的 PATCH**）与改口令：任何令牌都不可
    const sessionOnly: Array<[string, string, unknown?]> = [
      ['GET', '/api/tokens', undefined],
      ['POST', '/api/tokens', { name: '自我繁殖' }],
      ['PATCH', `/api/tokens/${String(read.id)}`, { scope: 'write' }],
      ['DELETE', `/api/tokens/${String(read.id)}`, undefined],
      ['DELETE', `/api/tokens/${String(read.id)}/permanent`, undefined],
      ['POST', `/api/tokens/${String(read.id)}/reveal`, undefined],
      ['POST', '/api/password', { old_password: 'x', new_password: 'yyyyyyyy' }],
      ['POST', '/api/logout', undefined],
    ];
    for (const [method, url, payload] of sessionOnly) {
      const options: InjectOptions = { method: method as 'PATCH', url, headers: bearer(read.token) };
      if (payload !== undefined && payload !== null) options.payload = payload as InjectOptions['payload'];
      const res = await fx.app.inject(options);
      assert.equal(res.statusCode, 403, `${method} ${url} 必须 403 session_required：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'session_required', `${method} ${url} 错误码`);
    }

    // 渲染类 POST 归"读"：只读令牌仍必须可用（MCP 的 prompt_render 不能被误伤）
    const rendered = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: bearer(read.token),
      payload: { values: {} },
    });
    assert.equal(rendered.statusCode, 200, rendered.body);
    assert.equal(
      (await fx.app.inject({ method: 'POST', url: '/api/render/markdown', headers: bearer(read.token), payload: { markdown: '# t' } })).statusCode,
      200,
    );
  } finally {
    await fx.close();
  }
});

test('AC-107 ⑨（源码级）：改权限只在会话通道，且日志行不含明文', async () => {
  const raw = readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'routes', 'tokens.ts'), 'utf8');
  const route = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/app\.patch\('\/api\/tokens\/:id'/.test(route), '必须有 PATCH /api/tokens/:id');
  assert.ok(/additionalProperties: false/.test(route), 'body schema 必须 additionalProperties:false');
  assert.ok(/required: \['scope'\]/.test(route), 'scope 必填（空体 400）');
  assert.ok(
    /request\.log\.info\(\{ tokenId: id, from: previousScope, to: summary\.scope \}, 'token scope changed'\)/.test(route),
    '成功必须记一条日志：只有 id 与两档权限',
  );
  // 日志**字段**里不得出现任何令牌值（消息文案本身含 "token scope changed"，只查 `{…}` 里的字段）
  const logLine = /request\.log\.info\([^;]*'token scope changed'\);/.exec(route)?.[0] ?? '';
  assert.ok(logLine !== '', '必须能定位到改权限的日志调用');
  const fields = /\{([^}]*)\}/.exec(logLine)?.[1] ?? '';
  assert.ok(fields !== '', '必须能定位到日志字段');
  assert.ok(!/token(_hash|_enc)?\b/.test(fields), `日志字段里不得出现令牌值：${fields}`);
  // 闸门未改动：/api/tokens 前缀仍是"仅会话"（防自我提权的唯一依赖点）
  const auth = readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'auth.ts'), 'utf8');
  assert.ok(/SESSION_ONLY_PREFIXES = \['\/api\/tokens'\]/.test(auth), '令牌管理必须仍是仅会话（含 PATCH）');
});

test('AC-107 ⑥（源码级）：状态列权限文本可点击（Dropdown 两项、手型、title 提示），**仍是 6 列**，已撤销行无入口', () => {
  const raw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8');
  const drawer = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  /** v58（FR-111）：用户要求新增「创建时间」⇒ 6 列 → 7 列（原意是"不得擅自改列"，同步为 7 列）。 */
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '创建时间', '最近使用', '操作'], '列必须恰好这 7 列且顺序正确');
  assert.ok(/<Dropdown/.test(drawer), '有效行的权限文本必须可点击（antd Dropdown，不手搓）');
  assert.ok(/trigger=\{\['click'\]\}/.test(drawer), '点击触发');
  assert.ok(/\{ key: 'read', label: '只读' \}/.test(drawer) && /\{ key: 'write', label: '读写' \}/.test(drawer), '菜单两项');
  assert.ok(/cursor: 'pointer'/.test(drawer), '指针必须变手型');
  assert.ok(/title="点击切换：只读 ↔ 读写"/.test(drawer), '必须有悬停提示');
  assert.ok(/data-scope-editable="1"/.test(drawer), '有效行需可被探针识别');
  assert.ok(/api\.setTokenScope\(id, scope\)/.test(drawer), '必须调 PATCH 接口');
  assert.ok(/setTokens\(\(previous\) => previous\.map/.test(drawer), '成功后只更新该行（不整表刷新、不重载页面）');
  assert.ok(/await load\(\);\n\s*message\.success\(updated\.scope/.test(drawer) === false, 'changeScope 里不得调用 load()（会重新预取全部明文）');
  // 已撤销行：纯 Tag，没有 Dropdown / 手型 / 可编辑标记
  const revokedBranch = /已撤销 · \{scopeText\}[\s\S]*?\);\s*\}/.exec(drawer)?.[0] ?? '';
  assert.ok(revokedBranch !== '', '必须能定位已撤销行分支');
  assert.ok(!/<Dropdown/.test(revokedBranch) && !/cursor: 'pointer'/.test(revokedBranch), '已撤销行不得有改权限入口');
});

test('AC-107 ⑦（源码级）：CLI 有 token set-scope（本机管理路径），非法值给用法错误', () => {
  const cli = readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'cli.ts'), 'utf8');
  assert.ok(/sub !== 'set-scope'/.test(cli), 'set-scope 必须在允许的子命令里');
  assert.ok(/token set-scope <id> <read\|write>/.test(cli), '用法说明必须列出 set-scope');
  assert.ok(/tokens\.setTokenScope\(handle\.qe, Number\(rawId\), scope\)/.test(cli), '必须直接开库改（本机管理路径）');
  assert.ok(/ok: token \$\{String\(summary\.id\)\} scope: \$\{previousScope\} → \$\{summary\.scope\}/.test(cli), '必须回显结果');
  assert.ok(/token set-scope 只支持本机管理路径/.test(cli), '设了 PM_API_URL 时必须明确拒绝（不回退直连数据库）');
  assert.ok(/if \(!\/\^\[0-9\]\+\$\/\.test\(rawId\)\) return usage/.test(cli), 'id 必须校验');
});
