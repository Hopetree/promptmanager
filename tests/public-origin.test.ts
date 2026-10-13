// 阶段 72 / BRIEF FR-156 / AC-134 B（N2）：PUBLIC_ORIGIN 只能有一套判据。
//
// 缺陷原状：`src/config.ts` 的正则允许 `http://`，而 cookie 的 `secure` 只判断"设了没设"，
// HSTS 又自己写了一遍 `startsWith('https://')` —— 于是 `PUBLIC_ORIGIN=http://…` 时
// **登录返回 200、浏览器却不会回传 cookie**（Secure cookie 走 http 被丢弃）⇒「登录成功但会话不保持」。
//
// 本文件钉住：①http 直接在配置层被拒（报错要能指导运维）②https 场景登录后会话确实保持
// ③三处判据（配置校验 / cookie secure / HSTS）走同一个 `isHttpsOrigin`。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource, stripSourceComments } from './source-text.ts';

test('AC-134 B7：PUBLIC_ORIGIN=http://… 在配置层被拒，报错给出可操作指引', async () => {
  const { loadConfig } = await import('../dist/config.js');
  assert.throws(
    () => loadConfig({ PUBLIC_ORIGIN: 'http://192.168.0.228:8766' }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /PUBLIC_ORIGIN/, `报错必须点名变量：${message}`);
      assert.match(message, /https:\/\//, `报错必须说明只接受 https：${message}`);
      assert.match(message, /留空/, `报错必须告诉运维内网 HTTP 该怎么做：${message}`);
      return true;
    },
  );
  // 合法形态仍然通过
  assert.equal(loadConfig({ PUBLIC_ORIGIN: 'https://prompt.home.local' }).publicOrigin, 'https://prompt.home.local');
  assert.equal(loadConfig({ PUBLIC_ORIGIN: 'https://prompt.home.local:8443' }).publicOrigin, 'https://prompt.home.local:8443');
  assert.equal(loadConfig({}).publicOrigin, undefined);
});

test('AC-134 B9：https 场景「登录 200 且会话保持」（cookie 带 Secure 并被回传）', async () => {
  const fixture = await makeFixture({ PUBLIC_ORIGIN: 'https://prompt.invalid.local' });
  try {
    const response = await login(fixture.app);
    assert.equal(response.statusCode, 200, '登录应当成功');
    const setCookie = String(response.headers['set-cookie'] ?? '');
    assert.match(setCookie, /;\s*Secure/i, `https 下 cookie 必须带 Secure：${setCookie}`);
    const authed = await fixture.app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { cookie: cookieOf(response) },
    });
    assert.equal(authed.statusCode, 200, '会话必须保持（不是 401）');
  } finally {
    await fixture.close();
  }
});

test('AC-134 B8：配置校验 / cookie secure / HSTS 三处共用 isHttpsOrigin（唯一判据）', async () => {
  const config = stripSourceComments(readSource('src/config.ts'));
  assert.match(config, /export function isHttpsOrigin\(/, 'config.ts 必须导出唯一判据 isHttpsOrigin');
  for (const file of ['src/server/app.ts', 'src/server/routes/auth.ts']) {
    const source = stripSourceComments(readSource(file));
    assert.match(source, /isHttpsOrigin\(/, `${file} 必须调用 isHttpsOrigin（不许自己判 scheme）`);
    assert.doesNotMatch(source, /startsWith\(['"]https:\/\//, `${file} 不许自己写 https 判定`);
  }
});

test('AC-134 B8 补充：isHttpsOrigin 的取值口径（未设 = 否；只有 https 才是）', async () => {
  const { isHttpsOrigin } = await import('../dist/config.js');
  assert.equal(isHttpsOrigin(undefined), false, '未设 PUBLIC_ORIGIN 不得当作 https');
  assert.equal(isHttpsOrigin('https://prompt.home.local'), true);
  assert.equal(isHttpsOrigin('http://prompt.home.local'), false);
  // 分工：本判据只看 scheme；"不带路径 / 不带空白"由 readPublicOrigin 把关（B7 已断言 http 被拒，
  // 路径形态由 tests/api-deploy-shape.test.ts 的配置解析用例钉住）。
  assert.equal(isHttpsOrigin('https://prompt.home.local/path'), true);
});

test('AC-134 B7 补充：未设 PUBLIC_ORIGIN 时内网 HTTP 登录仍然可用（能力未受损）', async () => {
  const fixture = await makeFixture();
  try {
    const response = await login(fixture.app);
    assert.equal(response.statusCode, 200);
    const setCookie = String(response.headers['set-cookie'] ?? '');
    assert.ok(!/;\s*Secure/i.test(setCookie), `未设 PUBLIC_ORIGIN 时不得加 Secure：${setCookie}`);
    const authed = await fixture.app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { cookie: cookieOf(response) },
    });
    assert.equal(authed.statusCode, 200, '内网 HTTP（留空）必须会话保持');
  } finally {
    await fixture.close();
  }
});
