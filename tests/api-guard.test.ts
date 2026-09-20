import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

test('AC-3：未认证访问 /api/* 一律 401（含未实现的端点）', async () => {
  const fx = await makeFixture();
  try {
    const prompts = await fx.app.inject({ method: 'GET', url: '/api/prompts' });
    const create = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    const exportRes = await fx.app.inject({ method: 'GET', url: '/api/export' });
    const me = await fx.app.inject({ method: 'GET', url: '/api/me' });
    const logout = await fx.app.inject({ method: 'POST', url: '/api/logout' });

    for (const res of [prompts, create, exportRes, me, logout]) {
      assert.equal(res.statusCode, 401, `期望 401，实际 ${res.statusCode}：${res.body}`);
      assert.deepEqual(res.json(), { error: 'unauthorized' });
    }
  } finally {
    await fx.close();
  }
});

test('AC-3：/healthz 无需认证；未实现的 /api/* 未认证 401、已认证 404', async () => {
  const fx = await makeFixture();
  try {
    const health = await fx.app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(health.statusCode, 200);

    const anon = await fx.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    assert.equal(anon.statusCode, 401);

    const jar = cookieOf(await login(fx.app));
    const authed = await fx.app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
      headers: { cookie: jar },
    });
    assert.equal(authed.statusCode, 404);
    assert.deepEqual(authed.json(), { error: 'not_found' });
  } finally {
    await fx.close();
  }
});

test('伪造/过期会话 cookie 一律 401', async () => {
  const fx = await makeFixture();
  try {
    const forged = await fx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'pm_sid=not-a-real-token' },
    });
    assert.equal(forged.statusCode, 401);
    assert.deepEqual(forged.json(), { error: 'unauthorized' });
  } finally {
    await fx.close();
  }
});
