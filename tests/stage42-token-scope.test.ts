// 阶段 42 / FR-103（令牌权限两档，**只作用于资源**）+ FR-104（取用归因）断言。
//
// 覆盖：迁移 v5 与两列、三类边界的**逐端点 HTTP 码**、只读令牌的渲染类 POST 仍可用、
// 默认只读、存量 NULL 视作 write（迁移回填口径）、usage 的 token_id 归因。
// 真实令牌打真端点的**原样输出**在 tools/ac-stage42.sh（含官方 Python MCP 客户端握手 / 界面真鼠标）。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { InjectOptions } from 'fastify';
import { runMigrations } from '../dist/db/migrate.js';
import type { Fixture } from './helpers.ts';
import { cookieOf, login, makeFixture, PROJECT_ROOT, readDb } from './helpers.ts';

const MIGRATIONS = path.join(PROJECT_ROOT, 'migrations');

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

/** 会话建令牌（可指定权限）。 */
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

async function newPrompt(fx: Fixture, cookie: string, title = 'AC105 夹具'): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { title, user_prompt: '你好 {{姓名}}' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: number }).id;
}

test('AC-105 ①：迁移到 v5；api_tokens 有 scope、usage_events 有 token_id；存量行回填 write', async () => {
  // ① 真跑"从 004 升到 005"的路径：手工建一个只跑到 004 的库并插入一行"存量令牌"
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-scope-legacy-'));
  try {
    const db = new Database(path.join(dir, 'pm.db'));
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
    for (const file of ['001_init.sql', '002_tokens-and-usage.sql', '003_prompt-sort-order.sql', '004_token-enc.sql']) {
      db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        Number.parseInt(file, 10),
        file,
        new Date().toISOString(),
      );
    }
    db.prepare(
      `INSERT INTO api_tokens (name, token_hash, token_enc, created_at, last_used_at, revoked_at)
       VALUES ('legacy-token', ?, NULL, '2026-01-01T00:00:00.000Z', NULL, NULL)`,
    ).run('a'.repeat(64));

    const result = runMigrations(db);
    assert.equal(result.version, 5, '迁移必须到 v5');
    assert.ok(result.applied.includes('005_token-scope.sql'));
    const columns = (db.prepare('PRAGMA table_info(api_tokens)').all() as Array<{ name: string }>).map((r) => r.name);
    assert.ok(columns.includes('scope'), 'api_tokens 必须有 scope 列');
    const usageColumns = (db.prepare('PRAGMA table_info(usage_events)').all() as Array<{ name: string }>).map((r) => r.name);
    assert.ok(usageColumns.includes('token_id'), 'usage_events 必须有 token_id 列');
    // **存量行必须被回填成 write**（否则在用的 MCP / 技能令牌会突然 403）
    const legacy = db.prepare("SELECT scope FROM api_tokens WHERE name = 'legacy-token'").get() as { scope: string };
    assert.equal(legacy.scope, 'write', '存量令牌必须回填为 write（保持既有令牌可用）');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ② 新建库：scope 列存在，且服务层把 NULL 视作 write（与回填口径一致的兜底）
  const fx = await makeFixture();
  try {
    const { normalizeScope } = await import('../dist/services/tokens.js');
    assert.equal(normalizeScope(null), 'write', 'NULL scope 视作 write（兼容存量/手工插入）');
    assert.equal(normalizeScope('read'), 'read');
    assert.equal(normalizeScope('bogus'), 'write');
    const cookie = await authed(fx);
    const created = await makeToken(fx, cookie, 'ac105-scope');
    assert.equal(created.scope, 'read', '缺省必须是只读（最小权限）');
    readDb(fx, (db) => db.prepare('UPDATE api_tokens SET scope = NULL WHERE id = ?').run(created.id));
    // NULL 的令牌仍可写（口径 = write），证明兜底生效
    const id = await newPrompt(fx, cookie, 'NULL scope 兜底');
    void id;
    const res = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(id)}`,
      headers: bearer(created.token),
      payload: { title: 'NULL scope 可写' },
    });
    assert.equal(res.statusCode, 200, `NULL scope 必须按 write 处理：${res.body}`);
  } finally {
    await fx.close();
  }
});

test('AC-105 ②：只读令牌 —— 读 200；六类资源写各 403 insufficient_scope', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const read = await makeToken(fx, cookie, 'ro', 'read');
    const id = await newPrompt(fx, cookie);

    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(read.token) })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer(read.token) })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/folders', headers: bearer(read.token) })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/tags', headers: bearer(read.token) })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/export', headers: bearer(read.token) })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/usage/summary', headers: bearer(read.token) })).statusCode, 200);

    const writes: Array<[string, string, unknown?]> = [
      ['POST', '/api/prompts', { title: 'x' }],
      ['PUT', `/api/prompts/${String(id)}`, { title: 'y' }],
      ['DELETE', `/api/prompts/${String(id)}`, undefined],
      ['PATCH', '/api/prompts/order', { ids: [id] }],
      ['POST', '/api/folders', { name: 'f' }],
      ['POST', '/api/tags', { name: 't' }],
    ];
    for (const [method, url, payload] of writes) {
      // 显式构造 options（用展开式会让 TS 推出联合类型、inject 的重载匹配不上）
      const options: InjectOptions = {
        method: method as 'POST',
        url,
        headers: bearer(read.token),
      };
      if (payload !== undefined && payload !== null) options.payload = payload as InjectOptions['payload'];
      const res = await fx.app.inject(options);
      assert.equal(res.statusCode, 403, `${method} ${url} 必须 403：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'insufficient_scope', `${method} ${url} 错误码`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-105 ③：渲染类 POST **对只读令牌必须可用**（否则 MCP 的 prompt_render 会被误伤）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const read = await makeToken(fx, cookie, 'ro-render', 'read');
    const id = await newPrompt(fx, cookie);

    const rendered = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: bearer(read.token),
      payload: { values: { 姓名: '张三' } },
    });
    assert.equal(rendered.statusCode, 200, rendered.body);
    assert.equal((rendered.json() as { user_prompt: string }).user_prompt, '你好 张三');

    const markdown = await fx.app.inject({
      method: 'POST',
      url: '/api/render/markdown',
      headers: bearer(read.token),
      payload: { markdown: '# 标题' },
    });
    assert.equal(markdown.statusCode, 200, markdown.body);
  } finally {
    await fx.close();
  }
});

test('AC-105 ④：读写令牌 —— 读 200 + 写（建 201 / 改 200 / 删 204）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const write = await makeToken(fx, cookie, 'rw', 'write');
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(write.token) })).statusCode, 200);
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: bearer(write.token),
      payload: { title: 'rw 建的' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = (created.json() as { id: number }).id;
    assert.equal(
      (await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: bearer(write.token), payload: { title: 'rw 改的' } })).statusCode,
      200,
    );
    assert.equal((await fx.app.inject({ method: 'DELETE', url: `/api/prompts/${String(id)}`, headers: bearer(write.token) })).statusCode, 204);
  } finally {
    await fx.close();
  }
});

test('AC-105 ⑤：令牌管理与改口令/登出 —— **读写令牌也一律 403 session_required**', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const write = await makeToken(fx, cookie, 'rw-session', 'write');
    const victim = await makeToken(fx, cookie, 'victim');
    const cases: Array<[string, string, unknown?]> = [
      ['GET', '/api/tokens', undefined],
      ['POST', '/api/tokens', { name: '自我繁殖' }],
      ['DELETE', `/api/tokens/${String(victim.id)}`, undefined],
      ['DELETE', `/api/tokens/${String(victim.id)}/permanent`, undefined],
      ['POST', `/api/tokens/${String(victim.id)}/reveal`, undefined],
      ['POST', '/api/password', { old_password: 'x', new_password: 'yyyyyyyy' }],
      ['POST', '/api/logout', undefined],
    ];
    for (const [method, url, payload] of cases) {
      const options: InjectOptions = {
        method: method as 'GET',
        url,
        headers: bearer(write.token),
      };
      if (payload !== undefined && payload !== null) options.payload = payload as InjectOptions['payload'];
      const res = await fx.app.inject(options);
      assert.equal(res.statusCode, 403, `${method} ${url} 必须 403：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'session_required', `${method} ${url} 错误码`);
    }
    // 会话路径不受影响（令牌仍然有效、可读）
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } })).statusCode, 200);
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(write.token) })).statusCode, 200);
  } finally {
    await fx.close();
  }
});

test('AC-105 ⑦：默认只读 —— 不带 scope 建令牌 = read（HTTP 与 CLI 同口径）；显式非法值 400', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await makeToken(fx, cookie, 'default-ro');
    assert.equal(created.scope, 'read', 'HTTP 缺省必须 read');
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: bearer(created.token),
      payload: { title: 'x' },
    });
    assert.equal(res.statusCode, 403, '默认只读令牌不得能写');

    const bad = await fx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie },
      payload: { name: 'bad-scope', scope: 'admin' },
    });
    assert.equal(bad.statusCode, 400, '非法 scope 必须 400（不静默降级）');
    assert.equal((bad.json() as { error: string }).error, 'invalid_body');
  } finally {
    await fx.close();
  }
});

test('AC-105 ⑧（源码级）：界面有权限选择（默认只读）、状态列显示权限、**列数仍是 6**', () => {
  const raw = readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8');
  const drawer = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '最近使用', '操作'], '不得新增列（仍是 6 列）');
  assert.ok(/data-testid="pm-token-scope"/.test(drawer), '新建处必须有权限选择控件');
  assert.ok(/initialValue="read"/.test(drawer), '权限选择必须**默认只读**');
  assert.ok(/value: 'read', label: '只读'/.test(drawer) && /value: 'write', label: '读写'/.test(drawer), '两个档位的文案');
  assert.ok(/有效 · \{scopeText\}/.test(drawer) && /已撤销 · \{scopeText\}/.test(drawer), '状态列必须显示 有效/已撤销 · 只读/读写');
  assert.ok(/token\.scope === 'write' \? '读写' : '只读'/.test(drawer), 'scope → 文案映射');
  assert.ok(/api\.createToken\(values\.name, values\.scope\)/.test(drawer), '创建时必须把 scope 传给接口');
});

test('AC-105 ⑧（源码级）：CLI 支持 --scope（缺省 read）并回显/list 显示权限', () => {
  const cli = readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'cli.ts'), 'utf8');
  assert.ok(/arg === '--scope'/.test(cli) && /startsWith\('--scope='\)/.test(cli), '必须支持 --scope 与 --scope=');
  assert.ok(/scope=\$\{summary\.scope\}/.test(cli), '创建输出必须回显权限');
  assert.ok(/scope=\$\{item\.scope\}/.test(cli), 'list 必须显示权限');
  assert.ok(/--scope 只能是 read 或 write/.test(cli), '非法值给用法错误（不静默降级）');
});

test('AC-106 ②③④⑤：取用归因 —— 令牌取用记 token_id、会话记 NULL、列表/搜索不记、summary 带 by_token', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const read = await makeToken(fx, cookie, 'usage-ro', 'read');
    const id = await newPrompt(fx, cookie, 'AC106 夹具');

    // ② 只读令牌取用 → token_id = 该令牌 id
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: bearer(read.token) })).statusCode, 200);
    const rows = readDb(
      fx,
      (db) =>
        db.prepare('SELECT channel, token_id FROM usage_events WHERE prompt_id = ? ORDER BY id').all(id) as Array<{
          channel: string;
          token_id: number | null;
        }>,
    );
    assert.equal(rows.length, 1, 'GET 详情应记一条取用');
    assert.equal(rows[0]?.token_id, read.id, '令牌取用必须记该令牌 id');
    assert.equal(rows[0]?.channel, 'token');

    // ③ 会话（cookie）取用 → token_id 为 NULL
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } })).statusCode, 200);
    const afterSession = readDb(
      fx,
      (db) =>
        db.prepare('SELECT channel, token_id FROM usage_events WHERE prompt_id = ? ORDER BY id').all(id) as Array<{
          channel: string;
          token_id: number | null;
        }>,
    );
    assert.equal(afterSession.length, 2);
    assert.equal(afterSession[1]?.channel, 'session');
    assert.equal(afterSession[1]?.token_id, null, '会话取用的 token_id 必须是 NULL');

    // ④ 列表 / 搜索不记（既有语义不变）
    await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: bearer(read.token) });
    await fx.app.inject({ method: 'GET', url: '/api/prompts?q=AC106', headers: bearer(read.token) });
    const count = readDb(fx, (db) => (db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE prompt_id = ?').get(id) as { n: number }).n);
    assert.equal(count, 2, '列表 / 搜索不得记取用');

    // ⑤ GET /api/usage/summary 带 token_id 归因
    const summary = await fx.app.inject({ method: 'GET', url: '/api/usage/summary?days=1', headers: { cookie } });
    assert.equal(summary.statusCode, 200, summary.body);
    const body = summary.json() as { by_token: Array<{ token_id: number | null; count: number }> };
    assert.ok(Array.isArray(body.by_token), 'summary 必须带 by_token');
    const mine = body.by_token.find((entry) => entry.token_id === read.id);
    assert.ok(mine !== undefined && mine.count >= 1, `by_token 里应能查出该令牌的取用：${JSON.stringify(body.by_token)}`);
    assert.ok(body.by_token.some((entry) => entry.token_id === null), 'by_token 里应有会话取用（token_id = null）');
  } finally {
    await fx.close();
  }
});
