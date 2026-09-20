import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { makeFixture } from './helpers.ts';

const ALLOWED = 'https://prompt.home.local';

function corsHeader(response: { headers: Record<string, unknown> }, name: string): string | undefined {
  const value = response.headers[name];
  return value === undefined ? undefined : String(value);
}

test('AC-23 ①：未配置 CORS_ORIGINS → 完全没有 CORS 头（默认关闭）', async () => {
  const fx = await makeFixture();
  try {
    const res = await fx.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.example' } });
    assert.equal(res.statusCode, 200);
    assert.equal(corsHeader(res, 'access-control-allow-origin'), undefined, '默认不得出现 allow-origin');
    assert.equal(corsHeader(res, 'access-control-allow-credentials'), undefined);

    const preflight = await fx.app.inject({
      method: 'OPTIONS',
      url: '/api/prompts',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    assert.equal(corsHeader(preflight, 'access-control-allow-origin'), undefined, '未配置时预检也不得放行');
  } finally {
    await fx.close();
  }
});

test('AC-23 ②③④：白名单精确 origin、白名单外无头、预检含 allow-headers、绝无 allow-credentials', async () => {
  const fx = await makeFixture({ CORS_ORIGINS: ALLOWED });
  try {
    const allowed = await fx.app.inject({ method: 'GET', url: '/healthz', headers: { origin: ALLOWED } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(corsHeader(allowed, 'access-control-allow-origin'), ALLOWED, '必须是精确 origin，而不是 *');
    assert.notEqual(corsHeader(allowed, 'access-control-allow-origin'), '*');
    assert.equal(corsHeader(allowed, 'access-control-allow-credentials'), undefined, '不得使用 Allow-Credentials');

    const other = await fx.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.example' } });
    assert.equal(corsHeader(other, 'access-control-allow-origin'), undefined, '白名单外不得回 allow-origin');
    assert.equal(corsHeader(other, 'access-control-allow-credentials'), undefined);

    const noOrigin = await fx.app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(corsHeader(noOrigin, 'access-control-allow-origin'), undefined, '无 Origin 头就不该有 CORS 头');

    // 预检（带 Authorization 请求头声明）
    const preflight = await fx.app.inject({
      method: 'OPTIONS',
      url: '/api/prompts',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.ok(preflight.statusCode === 204 || preflight.statusCode === 200, `预检应成功，实际 ${preflight.statusCode}`);
    assert.equal(corsHeader(preflight, 'access-control-allow-origin'), ALLOWED);
    const allowHeaders = (corsHeader(preflight, 'access-control-allow-headers') ?? '').toLowerCase();
    assert.ok(allowHeaders.length > 0, '预检必须给出 access-control-allow-headers');
    assert.ok(allowHeaders.includes('authorization'), `allow-headers 应含 authorization：${allowHeaders}`);
    assert.equal(corsHeader(preflight, 'access-control-allow-credentials'), undefined);

    // 预检若来自白名单外 → 不放行
    const badPreflight = await fx.app.inject({
      method: 'OPTIONS',
      url: '/api/prompts',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    assert.equal(corsHeader(badPreflight, 'access-control-allow-origin'), undefined);
  } finally {
    await fx.close();
  }
});

test('CORS_ORIGINS 支持多个 origin（逗号分隔 + 空格容错）', async () => {
  const fx = await makeFixture({ CORS_ORIGINS: ` ${ALLOWED} , https://second.example , ` });
  try {
    const first = await fx.app.inject({ method: 'GET', url: '/healthz', headers: { origin: ALLOWED } });
    assert.equal(corsHeader(first, 'access-control-allow-origin'), ALLOWED);
    const second = await fx.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://second.example' } });
    assert.equal(corsHeader(second, 'access-control-allow-origin'), 'https://second.example');
    const third = await fx.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://third.example' } });
    assert.equal(corsHeader(third, 'access-control-allow-origin'), undefined);
  } finally {
    await fx.close();
  }
});

test('CORS_ORIGINS 里出现 * → 配置错误（启动即失败，不静默忽略）', () => {
  assert.throws(() => loadConfig({ CORS_ORIGINS: '*' }), /CORS_ORIGINS/);
  assert.throws(() => loadConfig({ CORS_ORIGINS: `https://ok.example,*` }), /CORS_ORIGINS/);
});

test('未认证的 /api/* 在开启 CORS 后仍是 401（CORS 不放宽认证）', async () => {
  const fx = await makeFixture({ CORS_ORIGINS: ALLOWED });
  try {
    const res = await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { origin: ALLOWED } });
    assert.equal(res.statusCode, 401, 'CORS 只管跨域可见性，不放宽认证');
  } finally {
    await fx.close();
  }
});
