import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { PROJECT_ROOT, login, makeFixture } from './helpers.ts';

const FIXTURE_PW = 'ac-fixture-pw-20260918';

async function wrongLogins(fx: Awaited<ReturnType<typeof makeFixture>>, xff: string): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { 'x-forwarded-for': xff },
    payload: { username: 'admin', password: 'definitely-wrong' },
  });
  return res.statusCode;
}

test('AC-28 ①：未设 TRUST_PROXY（默认）→ 伪造 X-Forwarded-For 不能绕过限流', async () => {
  const fx = await makeFixture();
  try {
    for (let i = 1; i <= 5; i += 1) {
      assert.equal(await wrongLogins(fx, `203.0.113.${String(i)}`), 401, `第 ${String(i)} 次失败应 401`);
    }
    assert.equal(await wrongLogins(fx, '203.0.113.99'), 429, '每 次换一个 XFF 也必须被同一把锁拦住（按真实来源 IP 计）');
  } finally {
    await fx.close();
  }
});

test('AC-28 ②（行为面）：设了 TRUST_PROXY → X-Forwarded-For 才算真实来源（不同 XFF 各自成键）', async () => {
  const fx = await makeFixture({ TRUST_PROXY: '1' });
  try {
    for (let i = 1; i <= 5; i += 1) {
      assert.equal(await wrongLogins(fx, '198.51.100.7'), 401, `第 ${String(i)} 次失败应 401`);
    }
    assert.equal(await wrongLogins(fx, '198.51.100.7'), 429, '同一个 XFF 的第 6 次应 429');
    assert.equal(await wrongLogins(fx, '198.51.100.8'), 401, '换一个 XFF 就是另一个来源 → 不受前者的锁影响');
  } finally {
    await fx.close();
  }
});

test('AC-28 ③：PUBLIC_ORIGIN 控制 cookie 的 Secure（未设不得加、设了必须加）', async () => {
  const plain = await makeFixture();
  try {
    const res = await login(plain.app);
    const header = String(res.headers['set-cookie']);
    assert.ok(header.includes('HttpOnly'));
    assert.ok(header.includes('SameSite=Lax'));
    assert.ok(!/;\s*Secure/i.test(header), `未设 PUBLIC_ORIGIN 时不得加 Secure：${header}`);
  } finally {
    await plain.close();
  }

  const secure = await makeFixture({ PUBLIC_ORIGIN: 'https://prompt.invalid.local' });
  try {
    const res = await login(secure.app);
    const header = String(res.headers['set-cookie']);
    assert.ok(/;\s*Secure/i.test(header), `设了 PUBLIC_ORIGIN 必须加 Secure：${header}`);
  } finally {
    await secure.close();
  }
});

test('配置解析：TRUST_PROXY / PUBLIC_ORIGIN 的合法值与非法值', () => {
  assert.equal(loadConfig({}).trustProxy, false, '默认关闭');
  for (const truthy of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.equal(loadConfig({ TRUST_PROXY: truthy }).trustProxy, true, `${truthy} 应视为开启`);
  }
  for (const falsy of ['0', 'false', 'no', 'off']) {
    assert.equal(loadConfig({ TRUST_PROXY: falsy }).trustProxy, false, `${falsy} 应视为关闭`);
  }
  assert.throws(() => loadConfig({ TRUST_PROXY: 'maybe' }), /TRUST_PROXY/);

  assert.equal(loadConfig({}).publicOrigin, undefined, '默认不设');
  assert.equal(loadConfig({ PUBLIC_ORIGIN: 'https://prompt.home.local' }).publicOrigin, 'https://prompt.home.local');
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'prompt.home.local' }), /PUBLIC_ORIGIN/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'https://x.local/path' }), /PUBLIC_ORIGIN/);
});

test('AC-28 ④⑤：反代样例与双形态部署文档（占位符、覆盖内网/公网/回滚）', () => {
  const confPath = path.join(PROJECT_ROOT, 'deploy', 'reverse-proxy.example.conf');
  assert.ok(existsSync(confPath), 'deploy/reverse-proxy.example.conf 必须存在');
  const conf = readFileSync(confPath, 'utf8');
  assert.match(conf, /X-Forwarded-For/i, '必须转发 X-Forwarded-For');
  assert.match(conf, /X-Forwarded-Proto/i, '必须转发 X-Forwarded-Proto');
  assert.match(conf, /ssl_certificate|listen\s+443/i, '必须体现 HTTPS 终结');
  assert.ok(!conf.includes('prompt.example.com'), '不得含真实域名（占位符）');
  assert.ok(!conf.includes('/etc/letsencrypt'), '不得含真实证书路径（占位符）');

  const readme = readFileSync(path.join(PROJECT_ROOT, 'deploy', 'README.md'), 'utf8');
  for (const keyword of ['内网', '公网', '反代', '回滚']) {
    assert.ok(readme.includes(keyword), `deploy/README.md 必须覆盖「${keyword}」`);
  }
  assert.match(readme, /TRUST_PROXY/);
  assert.match(readme, /PUBLIC_ORIGIN/);
  assert.match(readme, /CORS_ORIGINS/);

  const env = readFileSync(path.join(PROJECT_ROOT, 'deploy', 'promptmanager.env.example'), 'utf8');
  assert.match(env, /^CORS_ORIGINS=/m);
  assert.match(env, /^TRUST_PROXY=/m);
  assert.match(env, /^PUBLIC_ORIGIN=/m);
});

test('AC-28 ⑥：默认监听地址/端口未变（0.0.0.0:8767，且本阶段不新增监听）', async () => {
  const cfg = loadConfig({});
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.port, 8767);

  const fx = await makeFixture();
  try {
    await fx.app.listen({ host: cfg.host, port: 0 });
    const address = fx.app.server.address() as { address: string };
    assert.equal(address.address, '0.0.0.0');
  } finally {
    await fx.close();
  }
});
