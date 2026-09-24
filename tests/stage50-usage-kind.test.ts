// 阶段 50 / FR-114（取用语义修正：「打开详情」不算取用）断言。
//
// 覆盖：迁移 006 的存在与口径、`kind` 的类型/缺省、**打开详情记 `view` 且不计入**、
// **render 与 MCP 计入**、三处聚合（详情 / 列表 / summary）**同一口径**、表结构与导出格式未变。
// 真实查库对账（含旧库实测迁移）在 tools/ac-stage50.sh。
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
const MIGRATION_FILES = [
  '001_init.sql',
  '002_tokens-and-usage.sql',
  '003_prompt-sort-order.sql',
  '004_token-enc.sql',
  '005_token-scope.sql',
];

/** 去掉注释后的源码（源码级断言只检查**真代码**）。 */
const strip = (src: string): string =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function makePrompt(fx: Fixture, cookie: string, title = 'AC115 夹具'): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title, user_prompt: '你好 {{姓名}}' } });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: number }).id;
}

/** 库内该 prompt 的记录（id 升序）。 */
function events(fx: Fixture, id: number): Array<{ channel: string; kind: string | null; token_id: number | null }> {
  return readDb(
    fx,
    (db) =>
      db.prepare('SELECT channel, kind, token_id FROM usage_events WHERE prompt_id = ? ORDER BY id').all(id) as Array<{
        channel: string;
        kind: string | null;
        token_id: number | null;
      }>,
  );
}

/**
 * **计入型**记录的最近一条（copy/mcp）。
 * ⚠️ 不能直接用 `events().at(-1)` —— `useCount()` 本身是一次 GET 详情，会追加一条 `view`。
 */
function lastCounted(fx: Fixture, id: number): { channel: string; kind: string | null; token_id: number | null } | undefined {
  return events(fx, id)
    .filter((row) => row.kind === 'copy' || row.kind === 'mcp')
    .at(-1);
}

function useCount(fx: Fixture, id: number, headers: Record<string, string>): Promise<number> {
  return fx.app
    .inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers })
    .then((res) => (res.json() as { use_count: number }).use_count);
}

test('AC-115 ⑨：迁移 006 存在且口径正确 —— 旧行一律填 copy、行数不变、幂等', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-kind6-'));
  try {
    const db = new Database(path.join(dir, 'pm.db'));
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
    for (const file of MIGRATION_FILES) {
      db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        Number.parseInt(file, 10),
        file,
        new Date().toISOString(),
      );
    }
    // 旧时代的记录：**没有 kind 列**
    db.prepare(
      "INSERT INTO prompts (id,title,user_prompt,system_prompt,notes,folder_id,favorite,sort_order,version_no,created_at,updated_at) VALUES (1,'旧','正文','','',NULL,0,0,1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
    ).run();
    const insert = db.prepare('INSERT INTO usage_events (prompt_id, channel, used_at, token_id) VALUES (1, ?, ?, ?)');
    insert.run('session', '2026-01-01T01:00:00.000Z', null);
    insert.run('mcp', '2026-01-01T02:00:00.000Z', null);
    insert.run('token', '2026-01-01T03:00:00.000Z', 7);
    const before = (db.prepare('SELECT COUNT(*) AS n FROM usage_events').get() as { n: number }).n;
    assert.equal(before, 3);

    const result = runMigrations(db);
    assert.equal(result.version, 6, '迁移必须到 v6');
    assert.ok(result.applied.includes('006_usage-kind.sql'), '006 应被应用');

    const columns = (db.prepare('PRAGMA table_info(usage_events)').all() as Array<{ name: string }>).map((r) => r.name);
    assert.ok(columns.includes('kind'), 'usage_events 必须有 kind 列');
    // **历史不重算**：条数不变、旧行全部 copy、不改写 channel/token_id
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM usage_events').get() as { n: number }).n, before, '迁移不得改变行数');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE kind = 'copy'").get() as { n: number }).n, before, '旧行必须全部回填 copy');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE kind IS NULL').get() as { n: number }).n, 0, '不得留下 NULL');
    assert.equal((db.prepare("SELECT token_id FROM usage_events WHERE channel = 'token'").get() as { token_id: number }).token_id, 7, 'token_id 不得被改写');
    db.close();

    // 幂等：再跑一遍，什么都不变
    const db2 = new Database(path.join(dir, 'pm.db'));
    const again = runMigrations(db2);
    assert.equal(again.applied.length, 0, '重复迁移不应再应用任何文件');
    assert.equal((db2.prepare('SELECT COUNT(*) AS n FROM usage_events').get() as { n: number }).n, before);
    assert.equal((db2.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE kind = 'copy'").get() as { n: number }).n, before);
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-115 ①：打开详情**留痕 view 但不计入** use_count', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await makePrompt(fx, cookie);
    assert.equal(await useCount(fx, id, { cookie }), 0, '刚建好应为 0');
    // 再"纯打开"两次
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });

    const rows = events(fx, id);
    assert.ok(rows.length >= 3, `每次打开都应留痕：${JSON.stringify(rows)}`);
    assert.ok(rows.every((row) => row.kind === 'view'), `打开详情只能记 view：${JSON.stringify(rows)}`);
    assert.equal(await useCount(fx, id, { cookie }), 0, '打开详情**不计入** use_count（FR-114）');

    // 列表里的 use_count 必须同一口径
    const list = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items: Array<{ id: number; use_count: number; last_used_at: string | null }>;
    };
    const row = list.items.find((item) => item.id === id);
    assert.equal(row?.use_count, 0, '列表 use_count 也必须只统计计入型');
    assert.equal(row?.last_used_at, null, '没有计入型记录 ⇒ last_used_at 为 null');

    // summary 也同一口径
    const s = (await fx.app.inject({ method: 'GET', url: '/api/usage/summary?days=1', headers: { cookie } })).json() as { total: number };
    assert.equal(s.total, 0, 'summary 的 total 也只统计计入型');
  } finally {
    await fx.close();
  }
});

test('AC-115 ②③④：render / 复制计入为 copy；MCP 的 render 计入为 mcp、get 只留痕', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await makePrompt(fx, cookie);

    // ③ 会话渲染取用 ⇒ copy、+1
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: { cookie }, payload: { values: { 姓名: '张三' } } });
    assert.equal(await useCount(fx, id, { cookie }), 1, '渲染取用计入');
    assert.equal(lastCounted(fx, id)?.kind, 'copy', '会话 render ⇒ copy');

    /**
     * MCP：`x-pm-channel: mcp` **只对 Bearer 生效**（cookie 恒为 session，见 `src/server/auth.ts` 的
     * `bearerChannel`）⇒ 这里必须像真 MCP 那样带令牌，否则 channel 会是 session。
     */
    const tokenRes = await fx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie },
      payload: { name: 'AC115 mcp', scope: 'read' },
    });
    const mcpToken = (tokenRes.json() as { token: string }).token;
    const mcpHeaders = { authorization: `Bearer ${mcpToken}`, 'x-pm-channel': 'mcp' };
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: mcpHeaders });
    assert.equal(events(fx, id).filter((row) => row.channel === 'mcp').at(-1)?.kind, 'view', 'MCP 的 get 等同打开详情 ⇒ view');
    assert.equal(await useCount(fx, id, { cookie }), 1, 'MCP 的 get 不计入');

    // ④ MCP：prompt_render ⇒ mcp、计入
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: mcpHeaders, payload: { values: {} } });
    const last = lastCounted(fx, id);
    assert.equal(last?.kind, 'mcp', 'MCP render ⇒ kind=mcp');
    assert.equal(last?.channel, 'mcp');
    assert.equal(await useCount(fx, id, { cookie }), 2, 'MCP render 计入');

    // 列表/搜索仍不记
    const before = events(fx, id).length;
    await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=5', headers: { cookie } });
    await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('AC115')}`, headers: { cookie } });
    assert.equal(events(fx, id).length, before, '列表 / 搜索不得写 usage');
  } finally {
    await fx.close();
  }
});

test('AC-115 ⑥⑦（源码级）：三处聚合与两个记账点的口径一致；kind 缺省 copy', () => {
  const usage = strip(readFileSync(path.join(PROJECT_ROOT, 'src', 'services', 'usage.ts'), 'utf8'));
  // 类型与计入集合
  assert.ok(/export type UsageKind = 'view' \| 'copy' \| 'mcp'/.test(usage), '必须定义 UsageKind 三值');
  assert.ok(/export const COUNTED_KINDS: readonly UsageKind\[\] = \['copy', 'mcp'\]/.test(usage), '计入集合必须是 copy+mcp');
  // recordUsage 的 kind 缺省 copy（漏传不会把"取用"记成不计数）
  assert.ok(/kind: UsageKind = 'copy'/.test(usage), "recordUsage 的 kind 缺省必须是 'copy'");
  // 三处聚合都过滤
  const filters = [...usage.matchAll(/coalesce\(.*?\) in \('copy', 'mcp'\)/g)].length;
  assert.ok(filters >= 3, `usage.ts 里至少三处聚合（stats/summary 的 total·channels·by_token·top）要过滤，实际 ${String(filters)}`);

  const queries = strip(readFileSync(path.join(PROJECT_ROOT, 'src', 'db', 'prompt-queries.ts'), 'utf8'));
  assert.ok(/coalesce\(kind, 'copy'\) in \('copy', 'mcp'\)/.test(queries), '列表 JOIN 也必须同一口径');

  const routes = strip(readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'routes', 'prompts.ts'), 'utf8'));
  assert.ok(/recordUsage\(app\.qe, id, principal\.channel, principal\.tokenId \?\? null, 'view'\)/.test(routes), "打开详情必须记 kind='view'");
  assert.ok(/kindForChannel\(renderPrincipal\.channel\)/.test(routes), 'render 的事件类型必须由通道推导');

  // kindForChannel：mcp ⇒ mcp，其余 ⇒ copy
  assert.ok(/export function kindForChannel\(channel: UsageChannel\): UsageKind \{\s*return channel === 'mcp' \? 'mcp' : 'copy';/.test(usage), 'kindForChannel 的映射必须正确');
});

test('AC-115 ⑩（源码级）：未改导出格式 / 未改 channel·token_id 语义 / 界面文案与列不变', () => {
  // 导出格式：schema_version 仍是 1
  const exp = strip(readFileSync(path.join(PROJECT_ROOT, 'src', 'services', 'export.ts'), 'utf8'));
  assert.ok(/schema_version: 1|SCHEMA_VERSION = 1/.test(exp), '导出 schema_version 不得变');
  // 通道取值集合不变
  const auth = strip(readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'auth.ts'), 'utf8'));
  assert.ok(/export type AuthChannel = 'session' \| 'token' \| 'mcp'/.test(auth), 'channel 三值不变');
  // 界面：仍是 7 列、文案仍是「取用 N 次」
  const drawer = strip(readFileSync(path.join(PROJECT_ROOT, 'web', 'src', 'components', 'TokenDrawer.tsx'), 'utf8'));
  const titles = [...drawer.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['名称', 'Token', '状态', '使用', '创建时间', '最近使用', '操作'], '令牌表列不得变');
  // 前端不感知 kind（语义在后端聚合）—— 避免"界面自己算一套"
  const webFiles = ['web/src/api.ts', 'web/src/types.ts'];
  for (const rel of webFiles) {
    const src = readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
    assert.equal(/\bkind\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), false, `${rel} 不应引入 kind（口径留在后端）`);
  }
});
