// 阶段 20 / FR-67（BRIEF v27 §4 + §8 AC-67）：`POST /api/password` 的契约与会话语义。
// 覆盖：204 成功 / 旧密码错 400（**不得 401**）/ 新密码不合规 400 invalid_password / 未认证 401 /
//       复用登录限流（5 次/60s → 429，成功即清零）/ 保留当前会话 + 吊销其它会话 / 不回显任何明文密码。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_PW, cookieOf, login, makeFixture } from './helpers.ts';

const NEW_PW = 'ac-fixture-pw-20260920-new';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function postPassword(fx: Fixture, cookie: string | null, payload: Record<string, unknown>) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/password',
    ...(cookie === null ? {} : { headers: { cookie } }),
    payload,
  });
}

async function loginStatus(fx: Fixture, password: string): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  return res.statusCode;
}

test('AC-67 ①：未认证 → 401（沿用现有闸门）', async () => {
  const fx = await makeFixture();
  try {
    const res = await postPassword(fx, null, { old_password: FIXTURE_PW, new_password: NEW_PW });
    assert.equal(res.statusCode, 401);
    assert.equal((res.json() as { error: string }).error, 'unauthorized');
  } finally {
    await fx.close();
  }
});

test('AC-67 ②：成功改密码 → 204 无 body；新密码可登录、旧密码 401', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const res = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: NEW_PW });
    assert.equal(res.statusCode, 204, res.body);
    assert.equal(res.body, '', '204 不得带 body');
    assert.equal(await loginStatus(fx, NEW_PW), 200, '新密码必须能登录');
    assert.equal(await loginStatus(fx, FIXTURE_PW), 401, '旧密码必须失效');
  } finally {
    await fx.close();
  }
});

test('AC-67 ③：当前密码错误 → 400 invalid_old_password（**不是 401**），旧密码仍可登录', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const res = await postPassword(fx, cookie, { old_password: 'wrong-password-123', new_password: NEW_PW });
    assert.equal(res.statusCode, 400, `不得用 401（前端会误判会话失效）：${res.body}`);
    assert.equal((res.json() as { error: string }).error, 'invalid_old_password');
    assert.equal(await loginStatus(fx, FIXTURE_PW), 200, '失败不应改口令');
    assert.equal(await loginStatus(fx, NEW_PW), 401);
  } finally {
    await fx.close();
  }
});

test('AC-67 ④：新密码不合规（<8 码点 / 与当前相同）→ 400 invalid_password + message 说清规则', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));

    const short = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: '短密码七字' });
    assert.equal(short.statusCode, 400, short.body);
    const shortBody = short.json() as { error: string; message?: string };
    assert.equal(shortBody.error, 'invalid_password');
    assert.ok((shortBody.message ?? '').includes('8'), 'message 要说清 8 个字符的规则');

    const same = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: FIXTURE_PW });
    assert.equal(same.statusCode, 400, same.body);
    assert.equal((same.json() as { error: string }).error, 'invalid_password');

    assert.equal(await loginStatus(fx, FIXTURE_PW), 200, '不合规不应改口令');
  } finally {
    await fx.close();
  }
});

test('AC-67 ④补充：8 个 Unicode 码点即可（emoji 按码点算，不按 UTF-16 长度）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const seven = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: '密码密码密码密' }); // 7 码点
    assert.equal(seven.statusCode, 400, seven.body);
    const eight = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: '密码密码密码密码' }); // 8 码点
    assert.equal(eight.statusCode, 204, eight.body);
    assert.equal(await loginStatus(fx, '密码密码密码密码'), 200);
  } finally {
    await fx.close();
  }
});

test('AC-67 ⑤：改密码保留当前会话、吊销该用户其它所有会话', async () => {
  const fx = await makeFixture();
  try {
    const first = cookieOf(await login(fx.app));
    const second = cookieOf(await login(fx.app));
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first } })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: second } })).statusCode, 200);

    const res = await postPassword(fx, first, { old_password: FIXTURE_PW, new_password: NEW_PW });
    assert.equal(res.statusCode, 204, res.body);

    assert.equal(
      (await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first } })).statusCode,
      200,
      '发起修改的当前会话必须保留',
    );
    assert.equal(
      (await fx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: second } })).statusCode,
      401,
      '其它会话必须被吊销',
    );
  } finally {
    await fx.close();
  }
});

test('AC-67 ③：当前密码连续错 5 次 / 60s → 第 6 次 429（复用登录限流）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    for (let i = 1; i <= 5; i += 1) {
      const res = await postPassword(fx, cookie, { old_password: `wrong-${String(i)}`, new_password: NEW_PW });
      assert.equal(res.statusCode, 400, `第 ${String(i)} 次应为 400：${res.body}`);
    }
    const limited = await postPassword(fx, cookie, { old_password: 'wrong-6', new_password: NEW_PW });
    assert.equal(limited.statusCode, 429, `第 6 次应 429：${limited.body}`);
    assert.equal((limited.json() as { error: string }).error, 'rate_limited');
    assert.ok(limited.headers['retry-after'] !== undefined, '429 要带 Retry-After');
    // 被限流期间，即使当前密码正确也不放行（与登录限流的语义一致）
    const correctWhileLimited = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: NEW_PW });
    assert.equal(correctWhileLimited.statusCode, 429, correctWhileLimited.body);
  } finally {
    await fx.close();
  }
});

test('AC-67 ③补充：成功一次即清零（4 错 → 成功 → 再 4 错都还是 400，不是 429）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    for (let i = 1; i <= 4; i += 1) {
      const res = await postPassword(fx, cookie, { old_password: `wrong-${String(i)}`, new_password: NEW_PW });
      assert.equal(res.statusCode, 400, res.body);
    }
    const ok = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: NEW_PW });
    assert.equal(ok.statusCode, 204, ok.body);
    for (let i = 1; i <= 4; i += 1) {
      const res = await postPassword(fx, cookie, { old_password: `again-${String(i)}`, new_password: NEW_PW });
      assert.equal(res.statusCode, 400, `清零后再错第 ${String(i)} 次应为 400（否则说明计数没清零）：${res.body}`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-67 ⑥：响应体不回显任何明文密码、不含密码字段', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const wrong = await postPassword(fx, cookie, { old_password: 'plain-old-secret-1', new_password: 'plain-new-secret-1' });
    const bad = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: 'short' });
    const ok = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: 'plain-new-secret-2' });
    for (const res of [wrong, bad, ok]) {
      assert.equal(res.body.includes('plain-old-secret-1'), false, `响应体不得回显旧密码：${res.body}`);
      assert.equal(res.body.includes('plain-new-secret-1'), false, `响应体不得回显新密码：${res.body}`);
      assert.equal(res.body.includes('plain-new-secret-2'), false, `响应体不得回显新密码：${res.body}`);
      // 注意：错误码 `invalid_old_password` 本身含 old_password 字样，这里查的是"字段名回显"（带引号的键）
      assert.equal(res.body.includes('"old_password"'), false, `响应体不得回显密码字段：${res.body}`);
      assert.equal(res.body.includes('"new_password"'), false, `响应体不得回显密码字段：${res.body}`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-67：body 形状校验（缺字段 / 多字段 → 400 invalid_body）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const missing = await postPassword(fx, cookie, { old_password: FIXTURE_PW });
    assert.equal(missing.statusCode, 400);
    assert.equal((missing.json() as { error: string }).error, 'invalid_body');
    const extra = await postPassword(fx, cookie, { old_password: FIXTURE_PW, new_password: NEW_PW, extra: 1 });
    assert.equal(extra.statusCode, 400);
    assert.equal((extra.json() as { error: string }).error, 'invalid_body');
  } finally {
    await fx.close();
  }
});
