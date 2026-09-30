// 2026-09-30 项目体检整改（第三批）：HTTP 层加固的自动化断言。
//   · P1-1 安全响应头（不引 helmet，用 onSend 钩子）
//   · P2-2 非预期状态码不再一律误标 `unauthorized`
//   · P2-8 全局异常处理器
//   · P2-9② 同步客户端：不跟重定向 + 有界读取
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createGitHubClient } from '../dist/services/sync-github.js';
import { cookieOf, login, makeFixture, PROJECT_ROOT } from './helpers.ts';

// ─────────────────────────── P1-1 安全响应头 ───────────────────────────

test('P1-1：安全响应头在 HTML 与 API 两条路径上都下发', async () => {
  const fx = await makeFixture();
  try {
    for (const url of ['/', '/healthz']) {
      const res = await fx.app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, `${url} 应 200`);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
    }
  } finally {
    await fx.close();
  }
});

test('P1-1：CSP 取值是刻意的 —— script 只 self（禁内联/禁 eval）、style 必须放行内联（antd 是 CSS-in-JS）', async () => {
  const fx = await makeFixture();
  try {
    const csp = String((await fx.app.inject({ method: 'GET', url: '/healthz' })).headers['content-security-policy']);
    assert.match(csp, /script-src 'self'(?:;|$)/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/, 'antd 需要内联 style，去掉会让整个界面丢样式');
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
  } finally {
    await fx.close();
  }
});

test('P1-1：HSTS 只在 PUBLIC_ORIGIN 为 https 时下发（内网 HTTP 加了会把 http 也强制跳 https）', async () => {
  const plain = await makeFixture();
  try {
    const res = await plain.app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.headers['strict-transport-security'], undefined);
  } finally {
    await plain.close();
  }

  const secure = await makeFixture({ PUBLIC_ORIGIN: 'https://prompt.example.com' });
  try {
    const res = await secure.app.inject({ method: 'GET', url: '/healthz' });
    assert.match(String(res.headers['strict-transport-security']), /^max-age=\d+/);
  } finally {
    await secure.close();
  }
});

// ─────────────────────────── P2-2 状态码映射 ───────────────────────────

test('P2-2：请求体超限回 413 payload_too_large（此前误标 unauthorized）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie, 'content-type': 'application/json' },
      payload: 'x'.repeat(2 * 1024 * 1024),
    });
    assert.equal(res.statusCode, 413);
    assert.deepEqual(res.json(), { error: 'payload_too_large' });
  } finally {
    await fx.close();
  }
});

test('P2-2：既有的 400 / 401 / 404 契约逐字不变（改动不能伤到老行为）', async () => {
  const fx = await makeFixture();
  try {
    const unauth = await fx.app.inject({ method: 'GET', url: '/api/prompts' });
    assert.equal(unauth.statusCode, 401);
    assert.deepEqual(unauth.json(), { error: 'unauthorized' });

    const cookie = cookieOf(await login(fx.app));

    const missing = await fx.app.inject({ method: 'GET', url: '/api/nope', headers: { cookie } });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: 'not_found' });

    const bad = await fx.app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { name: 123 },
    });
    assert.equal(bad.statusCode, 400);
    assert.equal((bad.json() as { error: string }).error, 'invalid_body');
  } finally {
    await fx.close();
  }
});

// ─────────────────────────── P2-8 全局异常处理器 ───────────────────────────

test('P2-8：index.ts 注册了 unhandledRejection / uncaughtException，且是「记日志 + 优雅关库后退出」', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, 'src/server/index.ts'), 'utf8');
  assert.match(src, /process\.on\('unhandledRejection'/);
  assert.match(src, /process\.on\('uncaughtException'/);
  assert.match(src, /app\.log\.error/, '必须记日志，不能静默');
  assert.match(src, /app\.close\(\)/, '必须先优雅关库再退');
  assert.match(src, /process\.exit\(1\)/, '不能吞掉异常继续跑');
});

// ─────────────────────────── P2-9② 同步客户端加固 ───────────────────────────

/** 起一个只监听 127.0.0.1 的桩，行为由 handler 决定。 */
async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('P2-9②：上游声明超大 content-length 时立刻中止（不把内存泵满）', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(999 * 1024 * 1024) });
      res.write('{"default_branch":"main"}');
    },
    async (baseUrl) => {
      const client = createGitHubClient({ baseUrl, token: 'stub-token' });
      await assert.rejects(
        () => client.getRepo('a/b'),
        (error: Error) => /过大/.test(error.message),
      );
    },
  );
});

test('P2-9②：上游回重定向时拒绝跟随（基地址来自管理员配置，跟重定向等于把带 token 的请求引到别处）', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    },
    async (baseUrl) => {
      const client = createGitHubClient({ baseUrl, token: 'stub-token' });
      await assert.rejects(() => client.getRepo('a/b'));
    },
  );
});
