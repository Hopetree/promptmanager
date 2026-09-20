import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_PW, FIXTURE_USER, cookieOf, login, makeFixture, readDb, setCookieHeader } from './helpers.ts';

test('AC-4：登录成功 → 200 + {"ok":true,"username"} + pm_sid cookie（HttpOnly/SameSite=Lax/Path=/）', async () => {
  const fx = await makeFixture();
  try {
    const res = await login(fx.app);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { ok: true, username: FIXTURE_USER });

    const header = setCookieHeader(res);
    assert.match(header, /pm_sid=/);
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    assert.match(header, /Path=\//i);
  } finally {
    await fx.close();
  }
});

test('AC-4：带会话 cookie 可访问受保护接口；不带则 401；/api/me 返回用户名', async () => {
  const fx = await makeFixture();
  try {
    const jar = cookieOf(await login(fx.app));

    const me = await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: jar } });
    assert.equal(me.statusCode, 200, me.body);
    assert.deepEqual(me.json(), { username: FIXTURE_USER });

    const anon = await fx.app.inject({ method: 'GET', url: '/api/me' });
    assert.equal(anon.statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('AC-4：错误口令 → 401 invalid_credentials；未知用户同样 401（不泄露用户是否存在）', async () => {
  const fx = await makeFixture();
  try {
    const wrong = await login(fx.app, 'definitely-wrong-password');
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(wrong.json(), { error: 'invalid_credentials' });

    const noUser = await login(fx.app, 'whatever-password', 'nobody');
    assert.equal(noUser.statusCode, 401);
    assert.deepEqual(noUser.json(), { error: 'invalid_credentials' });
  } finally {
    await fx.close();
  }
});

test('AC-4：连续 5 次错误口令后第 6 次 → 429 rate_limited + Retry-After', async () => {
  const fx = await makeFixture();
  try {
    for (let i = 1; i <= 5; i += 1) {
      const res = await login(fx.app, `wrong-${i}`);
      assert.equal(res.statusCode, 401, `第 ${i} 次失败应 401，实际 ${res.statusCode}`);
      assert.deepEqual(res.json(), { error: 'invalid_credentials' });
    }

    const blocked = await login(fx.app, 'wrong-6');
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.deepEqual(blocked.json(), { error: 'rate_limited' });
    const retryAfter = Number(blocked.headers['retry-after']);
    assert.ok(Number.isFinite(retryAfter) && retryAfter > 0, `Retry-After 应为正整数，实际 ${String(blocked.headers['retry-after'])}`);

    // 封锁期内即使口令正确也拒绝（AC-4 的最直接读法：第 6 次一律 429）
    const correctWhileBlocked = await login(fx.app, FIXTURE_PW);
    assert.equal(correctWhileBlocked.statusCode, 429);
  } finally {
    await fx.close();
  }
});

test('AC-4：窗口过期后自动解锁；登录成功会清除此前失败记录', async () => {
  const fx = await makeFixture({ LOGIN_WINDOW_SECONDS: '1' });
  try {
    for (let i = 1; i <= 5; i += 1) {
      assert.equal((await login(fx.app, `bad-${i}`)).statusCode, 401);
    }
    assert.equal((await login(fx.app, 'bad-6')).statusCode, 429);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const afterWindow = await login(fx.app);
    assert.equal(afterWindow.statusCode, 200, afterWindow.body);

    // 成功一次后，失败计数清零：再错 5 次仍应 401（若未清零会在第 6 次之前提前 429）
    for (let i = 1; i <= 5; i += 1) {
      assert.equal((await login(fx.app, `again-${i}`)).statusCode, 401);
    }
    assert.equal((await login(fx.app, 'again-6')).statusCode, 429);
  } finally {
    await fx.close();
  }
});

test('AC-4：登出 → 204，旧 cookie 立即失效；响应清空 cookie', async () => {
  const fx = await makeFixture();
  try {
    const jar = cookieOf(await login(fx.app));
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: jar } })).statusCode, 200);

    const logout = await fx.app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: jar } });
    assert.equal(logout.statusCode, 204);
    assert.equal(logout.body, '');

    const after = await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: jar } });
    assert.equal(after.statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('会话表只存 token 的哈希（cookie 里的原始 token 不落库）', async () => {
  const fx = await makeFixture();
  try {
    const jar = cookieOf(await login(fx.app));
    const token = jar.slice('pm_sid='.length);
    const ids = readDb(fx, (db) =>
      (db.prepare('select id from sessions').all() as Array<{ id: string }>).map((row) => row.id),
    );
    assert.ok(ids.length >= 1);
    assert.ok(!ids.includes(token), 'sessions.id 不应等于 cookie 里的原始 token');
  } finally {
    await fx.close();
  }
});

test('过期会话立即 401（且不再能通过校验）', async () => {
  const fx = await makeFixture();
  try {
    const jar = cookieOf(await login(fx.app));
    const past = new Date(Date.now() - 60_000).toISOString();
    readDb(fx, (db) => {
      db.prepare('update sessions set expires_at = ?').run(past);
    });
    const res = await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: jar } });
    assert.equal(res.statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('登录请求体缺字段 → 400 invalid_body（不 500）', async () => {
  const fx = await makeFixture();
  try {
    const res = await fx.app.inject({ method: 'POST', url: '/api/login', payload: { username: FIXTURE_USER } });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json() as { error: string; details: unknown[] };
    assert.equal(body.error, 'invalid_body');
    assert.ok(Array.isArray(body.details));
  } finally {
    await fx.close();
  }
});
