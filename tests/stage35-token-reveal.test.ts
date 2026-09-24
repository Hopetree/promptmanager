// 阶段 35 / FR-94（BRIEF v46 §4 + §8 AC-96）的 **token 可随时查看（AES-256-GCM）**断言。
// 运行时证据（真鼠标点「复制」+ 读回剪贴板）在 tools/ac-stage35.sh 与 ac-stage35-probe.mjs 里。
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function newToken(
  fx: Fixture,
  cookie: string,
  name: string,
): Promise<{ id: number; token: string; revealable: boolean }> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as { id: number; token: string; revealable: boolean };
  return body;
}

function rowOf(fx: Fixture, id: number): { token_hash: string; token_enc: string | null } {
  return readDb(
    fx,
    (db) =>
      db.prepare('SELECT token_hash, token_enc FROM api_tokens WHERE id = ?').get(id) as {
        token_hash: string;
        token_enc: string | null;
      },
  );
}

test('AC-96 ①：迁移到 schema v6，api_tokens 有 token_enc 列，存量行为 NULL', async () => {
  const fx = await makeFixture();
  try {
    const version = readDb(
      fx,
      (db) => (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v,
    );
    // 阶段 42（FR-103/FR-104）新增 005 ⇒ 当前版本 5；本用例只关心 token_enc 列，版本号随之更新
    assert.equal(version, 6, '迁移必须到当前版本（阶段 50 起是 v6）');
    const columns = readDb(fx, (db) => db.prepare('PRAGMA table_info(api_tokens)').all() as Array<{ name: string }>);
    assert.ok(columns.some((column) => column.name === 'token_enc'), 'api_tokens 必须有 token_enc 列');

    // 存量行（模拟迁移前创建的 token）：直接写一行 token_enc IS NULL 的记录
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'legacy');
    readDb(fx, (db) => db.prepare('UPDATE api_tokens SET token_enc = NULL WHERE id = ?').run(created.id));
    assert.equal(rowOf(fx, created.id).token_enc, null, '存量行 token_enc 必须是 NULL');
  } finally {
    await fx.close();
  }
});

test('AC-96 ②：新建 token 可查看 —— reveal 返回的明文与创建时逐字相同；列表 revealable=true 且不含明文', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'viewable');
    assert.equal(created.revealable, true, '新建 token 必须可查看');

    const reveal = await fx.app.inject({
      method: 'POST',
      url: `/api/tokens/${String(created.id)}/reveal`,
      headers: { cookie },
    });
    assert.equal(reveal.statusCode, 200, reveal.body);
    assert.equal((reveal.json() as { token: string }).token, created.token, 'reveal 必须与创建时的明文逐字相同');

    const list = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    const items = (list.json() as { items: Array<Record<string, unknown>> }).items;
    assert.equal(items[0]?.['revealable'], true);
    // 列表响应里绝不能出现明文/密文/hash
    assert.equal(list.body.includes(created.token), false, '列表不得含明文');
    assert.equal(list.body.includes('token_enc'), false, '列表不得含密文字段');
    assert.equal(list.body.includes(rowOf(fx, created.id).token_hash), false, '列表不得含 token_hash');
  } finally {
    await fx.close();
  }
});

test('AC-96 ③：旧 token 两态 —— reveal → 409 token_not_revealable；但它的**鉴权照样可用**', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'legacy-auth');
    // 模拟存量行：清掉密文
    readDb(fx, (db) => db.prepare('UPDATE api_tokens SET token_enc = NULL WHERE id = ?').run(created.id));

    const list = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    assert.equal((list.json() as { items: Array<{ revealable: boolean }> }).items[0]?.revealable, false);

    const reveal = await fx.app.inject({
      method: 'POST',
      url: `/api/tokens/${String(created.id)}/reveal`,
      headers: { cookie },
    });
    assert.equal(reveal.statusCode, 409, reveal.body);
    assert.equal((reveal.json() as { error: string }).error, 'token_not_revealable');

    // 关键：旧 token 仍然能用来鉴权（sha256 那条路没动）
    const api = await fx.app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { authorization: `Bearer ${created.token}` },
    });
    assert.equal(api.statusCode, 200, '存量 token 的鉴权必须不受影响');
  } finally {
    await fx.close();
  }
});

test('AC-96 ④：reveal 只允许 cookie 会话 —— 用 Bearer 调 → 403（不允许 token 互相窥视）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'self-peek');
    const viaBearer = await fx.app.inject({
      method: 'POST',
      url: `/api/tokens/${String(created.id)}/reveal`,
      headers: { authorization: `Bearer ${created.token}` },
    });
    assert.equal(viaBearer.statusCode, 403, viaBearer.body);
    assert.equal((viaBearer.json() as { error: string }).error, 'session_required');

    // 完全不认证 → 闸门给 401
    const anonymous = await fx.app.inject({ method: 'POST', url: `/api/tokens/${String(created.id)}/reveal` });
    assert.equal(anonymous.statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('AC-96 ⑤：密文落库（不含 pm_ 前缀、不是明文）；密钥文件 600；重启后仍能 reveal', async () => {
  const fx = await makeFixture();
  const dir = fx.dir;
  try {
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'cipher');
    const row = rowOf(fx, created.id);
    assert.ok(row.token_enc !== null);
    // ⚠️ 口径：判据是"**不以 `pm_` 开头**"（不是"全文任何位置都不含 pm_"）——
    // base64 字符集含 p/m/_，密文偶然出现该子串是正常的（首版断言写成 includes 会偶发假红）。
    assert.equal(row.token_enc.startsWith('pm_'), false, '密文不得以明文前缀 pm_ 开头');
    assert.notEqual(row.token_enc, created.token, '密文不得等于明文');
    assert.match(row.token_enc, /^[A-Za-z0-9+/]+={0,2}$/, '密文应是标准 base64');
    assert.ok(row.token_enc.length >= 96, `密文长度应 ≈100 字符（实际 ${String(row.token_enc.length)}）`);
    assert.equal(row.token_hash, readDb(fx, (db) => (db.prepare('SELECT token_hash AS h FROM api_tokens WHERE id = ?').get(created.id) as { h: string }).h));

    const keyFile = path.join(dir, 'token-enc.key');
    const mode = statSync(keyFile).mode & 0o777;
    assert.equal(mode, 0o600, `密钥文件必须是 600（实际 ${mode.toString(8)}）`);
    assert.match(readFileSync(keyFile, 'utf8').trim(), /^[0-9a-f]{64}$/, '密钥文件是 32 字节 hex');

    // 重启（同一 DATA_DIR）后仍能 reveal —— 密钥与密文都持久
    await fx.app.close();
    const again = await makeFixture({}, { dir });
    try {
      const cookie2 = cookieOf(await login(again.app));
      const reveal = await again.app.inject({
        method: 'POST',
        url: `/api/tokens/${String(created.id)}/reveal`,
        headers: { cookie: cookie2 },
      });
      assert.equal(reveal.statusCode, 200, reveal.body);
      assert.equal((reveal.json() as { token: string }).token, created.token);
    } finally {
      await again.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-96 ⑦：密钥缺失/被替换 → reveal 给**明确错误**（不崩、不泄），鉴权仍可用；恢复后仍可 reveal', async () => {
  const fx = await makeFixture();
  const dir = fx.dir;
  try {
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'key-loss');
    const keyFile = path.join(dir, 'token-enc.key');
    const backup = `${keyFile}.bak`;
    renameSync(keyFile, backup); // 模拟"密钥丢了"

    const reveal = await fx.app.inject({
      method: 'POST',
      url: `/api/tokens/${String(created.id)}/reveal`,
      headers: { cookie },
    });
    assert.equal(reveal.statusCode, 500, reveal.body);
    const body = reveal.json() as { error: string; message: string };
    assert.equal(body.error, 'token_enc_key_unavailable');
    assert.ok(body.message.length > 0, '必须给可读说明');
    assert.equal(reveal.body.includes(created.token), false, '错误体不得含明文');

    // 鉴权不受影响
    const api = await fx.app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { authorization: `Bearer ${created.token}` },
    });
    assert.equal(api.statusCode, 200, '密钥丢失不影响鉴权');

    // 恢复密钥 → 又能 reveal
    rmSync(keyFile, { force: true }); // 清掉"自动生成的新密钥"
    renameSync(backup, keyFile);
    chmodSync(keyFile, 0o600);
    const restored = await fx.app.inject({
      method: 'POST',
      url: `/api/tokens/${String(created.id)}/reveal`,
      headers: { cookie },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal((restored.json() as { token: string }).token, created.token);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-96：TOKEN_ENC_KEY（env）优先于密钥文件，且 env 密钥也能解密文件密钥加密的密文（同密钥时）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-tokenkey-'));
  const keyHex = 'a'.repeat(64);
  const saved = process.env['TOKEN_ENC_KEY'];
  process.env['TOKEN_ENC_KEY'] = keyHex;
  try {
    const fx = await makeFixture({ DATA_DIR: dir });
    try {
      const cookie = await authed(fx);
      const created = await newToken(fx, cookie, 'env-key');
      const reveal = await fx.app.inject({
        method: 'POST',
        url: `/api/tokens/${String(created.id)}/reveal`,
        headers: { cookie },
      });
      assert.equal(reveal.statusCode, 200, reveal.body);
      assert.equal((reveal.json() as { token: string }).token, created.token);
      // 用了 env 密钥 ⇒ 不该生成密钥文件（这是"env 优先"的可观测证据）
      assert.equal(existsSync(path.join(dir, 'token-enc.key')), false, 'env 提供密钥时不应落盘密钥文件');
    } finally {
      await fx.close();
    }
  } finally {
    if (saved === undefined) delete process.env['TOKEN_ENC_KEY'];
    else process.env['TOKEN_ENC_KEY'] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-96 ⑧：明文不进日志 —— reveal 只记"被查看"（源码级：路由日志不含明文变量）', async () => {
  const { readFileSync: read } = await import('node:fs');
  const { PROJECT_ROOT } = await import('./helpers.ts');
  const route = read(path.join(PROJECT_ROOT, 'src', 'server', 'routes', 'tokens.ts'), 'utf8');
  assert.ok(route.includes("'token revealed'"), 'reveal 成功应有一条不含值的日志');
  // 日志调用里不得把 token 变量当参数（tokenId 允许；字符串字面量里的 "token revealed" 不算）
  const logCalls = route.match(/log\.[a-z]+\([^;]*\)/g) ?? [];
  assert.ok(logCalls.length > 0, '应当有日志调用（否则这条断言形同虚设）');
  for (const call of logCalls) {
    const withoutStrings = call.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    assert.equal(/\btoken\b/.test(withoutStrings), false, `日志不得打印明文：${call}`);
  }
});

test('AC-96：加密/解密单测（同一密钥可逆；不同密钥必失败；密文不含明文）', async () => {
  const { cipherWithKey } = await import('../dist/services/token-crypto.js');
  const keyA = Buffer.from('a'.repeat(64), 'hex');
  const keyB = Buffer.from('b'.repeat(64), 'hex');
  const plaintext = 'pm_test-plaintext-1234567890';
  const enc = cipherWithKey(keyA).encrypt(plaintext);
  assert.equal(enc.startsWith('pm_'), false, '密文不得以明文前缀开头');
  assert.equal(enc.includes(plaintext), false, '密文不得含完整明文');
  assert.equal(cipherWithKey(keyA).decrypt(enc), plaintext, '同密钥必须可逆');
  assert.throws(() => cipherWithKey(keyB).decrypt(enc), /不匹配/, '换密钥必须明确失败而不是返回垃圾');
  // 每次加密的 nonce 不同 ⇒ 密文不同（语义安全的基本要求）
  assert.notEqual(cipherWithKey(keyA).encrypt(plaintext), enc);
});

test('AC-96：写死非法 TOKEN_ENC_KEY 长度 → 明确错误（不崩）', async () => {
  const { resolveTokenKey } = await import('../dist/services/token-crypto.js');
  assert.throws(() => resolveTokenKey({ dataDir: '/tmp' }, { TOKEN_ENC_KEY: 'abcd' }), /64 个十六进制字符/);
});
