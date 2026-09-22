import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fixture } from './helpers.ts';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

interface TokenRow {
  id: number;
  name: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

async function createToken(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  name = 'ac',
): Promise<{ statusCode: number; body: any }> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name } });
  return { statusCode: res.statusCode, body: res.json() };
}

/** FR-103：带权限建令牌（测试里要"能写"的令牌时必须显式要 write —— 缺省是只读）。 */
async function createTokenWithScope(
  fx: Fixture,
  cookie: string,
  name: string,
  scope: 'read' | 'write',
): Promise<{ statusCode: number; body: any }> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name, scope } });
  return { statusCode: res.statusCode, body: res.json() };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

test('AC-22：创建时明文只返回一次、库里只存 sha256 hex(64)，Bearer 可访问受保护接口', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const created = await createToken(fx, cookie);
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const token = created.body.token as string;
    assert.match(token, /^pm_[A-Za-z0-9_-]{40,}$/, `明文应形如 pm_…：${token}`);
    assert.equal(created.body.name, 'ac');

    // 库里只存 sha256 hex(64)，且不存明文
    const rows = readDb(fx, (db) => db.prepare('select * from api_tokens').all() as TokenRow[]);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.token_hash.length, 64, 'token_hash 必须是 64 字符（sha256 hex）');
    assert.notEqual(row.token_hash, token);
    assert.ok(!JSON.stringify(rows).includes(token), '库里不得出现明文 token');
    assert.equal(row.last_used_at, null);
    assert.equal(row.revoked_at, null);

    // Bearer 访问
    const ok = await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(token) });
    assert.equal(ok.statusCode, 200, ok.body);
    const me = await fx.app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { username: string }).username, 'admin');

    // last_used_at 被记录
    const after = readDb(fx, (db) => db.prepare('select last_used_at from api_tokens where id = ?').get(row.id) as { last_used_at: string | null });
    assert.ok(after.last_used_at !== null && after.last_used_at.endsWith('Z'), 'last_used_at 应被记录');

    // 错误/缺失凭据
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer('wrong-token') })).statusCode, 401);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts' })).statusCode, 401);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer('') })).statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('AC-22：撤销后立即失效；列表不含明文；cookie 路径不回归', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const first = await createToken(fx, cookie, '演示');
    const token = first.body.token as string;

    const list = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    assert.equal(list.statusCode, 200);
    const listBody = list.json() as { items: TokenRow[] };
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0]?.name, '演示');
    assert.ok(!JSON.stringify(listBody).includes(token), '列表响应不得包含明文 token');
    assert.ok(!('token' in (listBody.items[0] ?? {})), '列表项不应有 token 字段');
    // 列表也不该回显 token_hash
    assert.ok(!JSON.stringify(listBody).includes(listBody.items[0]!.token_hash));

    const revoked = await fx.app.inject({ method: 'DELETE', url: `/api/tokens/${String(first.body.id)}`, headers: { cookie } });
    assert.equal(revoked.statusCode, 204, revoked.body);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(token) })).statusCode, 401, '撤销后必须立即失效');

    const row = readDb(fx, (db) => db.prepare('select revoked_at from api_tokens where id = ?').get(first.body.id) as { revoked_at: string | null });
    assert.ok(row.revoked_at !== null, '撤销应记录 revoked_at（保留行便于审计）');

    // cookie 路径不回归
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).statusCode, 200);
    // 令牌与 cookie 并存：另一个未撤销的 token 仍可用
    const second = await createToken(fx, cookie, '另一个');
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/export', headers: bearer(second.body.token as string) })).statusCode, 200);
  } finally {
    await fx.close();
  }
});

test('Token 接口的 400/404/401 与 logout 语义', async () => {
  const fx = await makeFixture();
  try {
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/tokens' })).statusCode, 401, '未认证 401');
    assert.equal((await fx.app.inject({ method: 'POST', url: '/api/tokens', payload: { name: 'x' } })).statusCode, 401);

    const cookie = cookieOf(await login(fx.app));
    const noName = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: {} });
    assert.equal(noName.statusCode, 400, noName.body);
    const badName = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 42 } });
    assert.equal(badName.statusCode, 400);
    const emptyName = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: '  ' } });
    assert.equal(emptyName.statusCode, 400);

    assert.equal((await fx.app.inject({ method: 'DELETE', url: '/api/tokens/999999', headers: { cookie } })).statusCode, 404);
    assert.equal((await fx.app.inject({ method: 'DELETE', url: '/api/tokens/not-a-number', headers: { cookie } })).statusCode, 404);

    /**
     * FR-103（v53）变更：登出属于"**不属于资源**"的类别 ⇒ 令牌**一律不可**，且错误码统一为
     * **403 `session_required`**（不再是 401）—— 401 是"没认证"，403 是"认证了但这条通道不该调这个端点"。
     * 断言语义不变（Bearer 依然不能登出 cookie 会话），只更新错误码与理由。
     */
    const created = await createToken(fx, cookie, 'logout-测试');
    const logoutWithToken = await fx.app.inject({
      method: 'POST',
      url: '/api/logout',
      headers: bearer(created.body.token as string),
    });
    assert.equal(logoutWithToken.statusCode, 403, 'Bearer 不能用来登出 cookie 会话');
    assert.equal((logoutWithToken.json() as { error: string }).error, 'session_required');

    // FR-103：令牌管理端点（列表 / 新建 / 撤销 / 硬删 / reveal）同样一律仅会话
    const writeToken = (await createTokenWithScope(fx, cookie, 'write-测试', 'write')).body.token as string;
    for (const [method, url] of [
      ['GET', '/api/tokens'],
      ['POST', '/api/tokens'],
      ['DELETE', '/api/tokens/1'],
      ['DELETE', '/api/tokens/1/permanent'],
      ['POST', '/api/tokens/1/reveal'],
    ] as const) {
      const res = await fx.app.inject({
        method,
        url,
        headers: bearer(writeToken),
        ...(method === 'POST' && url === '/api/tokens' ? { payload: { name: '自繁殖尝试' } } : {}),
      });
      assert.equal(res.statusCode, 403, `${method} ${url} 必须仅会话`);
      assert.equal((res.json() as { error: string }).error, 'session_required', `${method} ${url} 错误码`);
    }

    // 会话 cookie 登出仍然 204
    assert.equal((await fx.app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } })).statusCode, 204);
  } finally {
    await fx.close();
  }
});

test('Bearer 与 cookie 都是"必须有认证"的一部分：/healthz 与 /api/login 仍免认证', async () => {
  const fx = await makeFixture();
  try {
    assert.equal((await fx.app.inject({ method: 'GET', url: '/healthz' })).statusCode, 200);
    const loginRes = await login(fx.app);
    assert.equal(loginRes.statusCode, 200);
  } finally {
    await fx.close();
  }
});
