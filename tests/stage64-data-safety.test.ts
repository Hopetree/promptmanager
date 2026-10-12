// 阶段 64（FR-132 / FR-133 / FR-134 / FR-135 / AC-126 / D-62）：数据安全与口径。
//
// 四件事，来自设计评审 F4 / F5 / F6 / F9：
//   ① 导出 / 导入带上提示词的 `sort_order`（拖好的顺序在「导出→导入」与「从云端恢复」后不该归零）；
//   ② 取用口径收敛为**单一来源**（一个 SQL 片段工厂，`COUNTED_KINDS` 成为它的输入）；
//   ③ `replace` 导入**不静默**丢弃取用历史（如实回报去向 + 条数，且清空前留一份）；
//   ④ `updatePrompt` 的「读 existing + 算 version_no + 写主体 + 插版本行」收进**同一事务**，
//      约束错误按类型分派（只有真是 folder 问题才报 folder 文案）。
//
// 纪律：关键结论一律**直查库**（`readDb` 拿 better-sqlite3 连接跑 SELECT），不看接口回包猜 ——
// 「sort_order 到底落成几」「取用行还剩几条」「版本行有没有多一条」这几件事回包看不出来。
// 既有断言只按新语义**适配**（口径从"手写字面量"变成"调工厂"），不删不放松。
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, PROJECT_ROOT, readDb } from './helpers.ts';
import { usageHistoryNotice } from '../web/src/pure.ts';
import type { Fixture } from './helpers.ts';
import { readJson, readSource } from './source-text.ts';

const BASE = { title: '阶段64 夹具', user_prompt: '正文 v1', system_prompt: '', notes: '' };

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function createPrompt(fx: Fixture, cookie: string, payload: Record<string, unknown> = {}): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { ...BASE, ...payload },
  });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

interface ExportPromptShape {
  id: number;
  title: string;
  user_prompt: string;
  folder_id: number | null;
  sort_order?: number;
  versions: unknown[];
}

interface ExportShape {
  app: string;
  schema_version: number;
  /** 唯一不确定的字段；往返比对前会被删掉，所以是可选的。 */
  exported_at?: string;
  folders: Array<{ id: number; sort_order: number }>;
  tags: unknown[];
  prompts: ExportPromptShape[];
}

async function exportFile(fx: Fixture, cookie: string): Promise<ExportShape> {
  const res = await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as ExportShape;
}

/** 去掉唯一不确定的 `exported_at`（AC-10 的往返比对口径）。 */
function stripVolatile(file: ExportShape): ExportShape {
  const copy = structuredClone(file);
  delete copy.exported_at;
  return copy;
}

async function importFile(
  fx: Fixture,
  cookie: string,
  mode: 'replace' | 'merge',
  data: unknown,
): Promise<{ statusCode: number; body: string }> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/import', headers: { cookie }, payload: { mode, data } });
  return { statusCode: res.statusCode, body: res.body };
}

async function importOk(
  fx: Fixture,
  cookie: string,
  mode: 'replace' | 'merge',
  data: unknown,
): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/import', headers: { cookie }, payload: { mode, data } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Record<string, unknown>;
}

/** 直查库：prompt 的 id → sort_order。 */
function sortOrders(fx: Fixture): Map<number, number> {
  const rows = readDb(fx, (db) =>
    db.prepare('SELECT id, sort_order FROM prompts ORDER BY id').all() as Array<{ id: number; sort_order: number }>,
  );
  return new Map(rows.map((row) => [row.id, row.sort_order]));
}

function promptRow(fx: Fixture, id: number): { title: string; version_no: number; sort_order: number } | undefined {
  return readDb(fx, (db) =>
    db.prepare('SELECT title, version_no, sort_order FROM prompts WHERE id = ?').get(id),
  ) as { title: string; version_no: number; sort_order: number } | undefined;
}

function versionCount(fx: Fixture, id: number): number {
  const row = readDb(fx, (db) =>
    db.prepare('SELECT COUNT(*) AS n FROM prompt_versions WHERE prompt_id = ?').get(id),
  ) as { n: number };
  return row.n;
}

function usageCount(fx: Fixture): number {
  const row = readDb(fx, (db) => db.prepare('SELECT COUNT(*) AS n FROM usage_events').get()) as { n: number };
  return row.n;
}

/** 直插一条取用记录（绕过接口，用来构造"历史数据"）。 */
function insertUsage(fx: Fixture, promptId: number, channel: string, kind: string | null, usedAt: string): void {
  readDb(fx, (db) => {
    db.prepare('INSERT INTO usage_events (prompt_id, channel, used_at, kind) VALUES (?, ?, ?, ?)').run(
      promptId,
      channel,
      usedAt,
      kind,
    );
  });
}


function tsFilesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.ts')) out.push(abs);
    }
  };
  walk(path.join(PROJECT_ROOT, rel));
  return out;
}

const NOW = '2026-10-11T00:00:00.000Z';

// ════════════════ A 组：FR-132 排序随导出 / 导入往返 ════════════════

test('AC-126 ①：导出含每个 prompt 的 sort_order，且与库里的值逐条一致', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const a = await createPrompt(fx, cookie, { title: 'A' });
    const b = await createPrompt(fx, cookie, { title: 'B' });
    const c = await createPrompt(fx, cookie, { title: 'C' });

    // 拖成 C, A, B —— 走既有的 PATCH /api/prompts/order（槽位算法）
    const reorder = await fx.app.inject({
      method: 'PATCH',
      url: '/api/prompts/order',
      headers: { cookie },
      payload: { ids: [c, a, b] },
    });
    assert.equal(reorder.statusCode, 204, reorder.body);

    const db = sortOrders(fx);
    const file = await exportFile(fx, cookie);
    assert.equal(file.prompts.length, 3);
    for (const prompt of file.prompts) {
      assert.ok('sort_order' in prompt, 'FR-132：导出条目必须带 sort_order');
      assert.equal(prompt.sort_order, db.get(prompt.id), `prompt ${String(prompt.id)} 的 sort_order 必须与库里一致`);
    }
    // 顺序真的是 C(1) A(2) B(3)，不是全 0（否则这条用例等于没测）
    assert.equal(db.get(c), 1);
    assert.equal(db.get(a), 2);
    assert.equal(db.get(b), 3);
  } finally {
    await fx.close();
  }
});

test('AC-126 ②：replace 与 merge 导入都接受 sort_order 并落库（值不是 0 才算数）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const seed = await createPrompt(fx, cookie, { title: '种子' });
    const file = await exportFile(fx, cookie);
    file.prompts[0]!.sort_order = 42;
    delete file.exported_at;

    // replace：清库重建，保留文件里的 id
    await importOk(fx, cookie, 'replace', file);
    assert.equal(sortOrders(fx).get(seed), 42, 'replace 必须把文件里的 sort_order 写进库');

    // merge：新建 prompt（新 id），也要带上 sort_order
    const merged = await importOk(fx, cookie, 'merge', file);
    assert.equal((merged.imported as { prompts: number }).prompts, 1);
    const ids = [...sortOrders(fx).keys()].sort((x, y) => x - y);
    assert.equal(ids.length, 2);
    const newId = ids.find((id) => id !== seed);
    assert.ok(newId !== undefined, 'merge 必须新建一条');
    assert.equal(sortOrders(fx).get(newId), 42, 'merge 新建的 prompt 也要带上 sort_order');
  } finally {
    await fx.close();
  }
});

test('AC-126 ③：导出 → 导入（replace）→ 再导出，逐条逐字一致（含 sort_order）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const a = await createPrompt(fx, cookie, { title: 'A', user_prompt: '甲' });
    const b = await createPrompt(fx, cookie, { title: 'B', user_prompt: '乙' });
    await fx.app.inject({
      method: 'PATCH',
      url: '/api/prompts/order',
      headers: { cookie },
      payload: { ids: [b, a] },
    });

    const first = await exportFile(fx, cookie);
    await importOk(fx, cookie, 'replace', first);
    const second = await exportFile(fx, cookie);
    assert.deepEqual(stripVolatile(second), stripVolatile(first), '往返必须逐字一致（含 sort_order）');
  } finally {
    await fx.close();
  }
});

test('AC-126 ④：老导出文件（整段没有 sort_order）仍能导入，缺省 0，不报错', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const a = await createPrompt(fx, cookie, { title: 'A' });
    await createPrompt(fx, cookie, { title: 'B' });
    await fx.app.inject({
      method: 'PATCH',
      url: '/api/prompts/order',
      headers: { cookie },
      payload: { ids: [a] },
    });

    const file = await exportFile(fx, cookie);
    for (const prompt of file.prompts) delete prompt.sort_order;
    assert.equal(
      file.prompts.some((prompt) => 'sort_order' in prompt),
      false,
      '这条用例必须真的把字段整段删掉',
    );

    const res = await importOk(fx, cookie, 'replace', file);
    assert.equal((res.imported as { prompts: number }).prompts, 2);
    const orders = [...sortOrders(fx).values()];
    assert.deepEqual(orders, [0, 0], '缺字段 ⇒ 全部缺省 0（不是报错，也不是沿用旧值）');
  } finally {
    await fx.close();
  }
});

test('AC-126 ④（续）：sort_order 类型不对（字符串 / 小数）⇒ 400 invalid_import，库不动', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    await createPrompt(fx, cookie, { title: 'A' });
    const file = await exportFile(fx, cookie);

    for (const bad of ['7', 1.5]) {
      const copy = structuredClone(file);
      (copy.prompts[0] as { sort_order?: unknown }).sort_order = bad;
      const res = await importFile(fx, cookie, 'replace', copy);
      assert.equal(res.statusCode, 400, `sort_order=${JSON.stringify(bad)} 必须被拒`);
      assert.match(res.body, /invalid_import/);
      assert.match(res.body, /sort_order/);
    }
    assert.equal(sortOrders(fx).size, 1, '校验失败不得动库');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑥：导入落库的 sort_order 与既有槽位算法兼容（再拖一次仍能重排）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const a = await createPrompt(fx, cookie, { title: 'A' });
    const b = await createPrompt(fx, cookie, { title: 'B' });
    const file = await exportFile(fx, cookie);
    file.prompts.find((prompt) => prompt.id === a)!.sort_order = 100;
    file.prompts.find((prompt) => prompt.id === b)!.sort_order = 50;
    await importOk(fx, cookie, 'replace', file);
    assert.deepEqual([...sortOrders(fx).entries()].sort((x, y) => x[0] - y[0]), [
      [a, 100],
      [b, 50],
    ]);

    /**
     * 既有接口不回归：槽位算法把**新顺序**写回"这组 id 当前占据的 `sort_order` 槽位"
     * （`src/services/prompts.ts` 的 `reorderPrompts`，FR-70 / D-28）——
     * 所以这里断言的是"槽位集合不变 + 相对顺序按新顺序"，不是"值被重写成 1..N"。
     */
    const res = await fx.app.inject({
      method: 'PATCH',
      url: '/api/prompts/order',
      headers: { cookie },
      payload: { ids: [b, a] },
    });
    assert.equal(res.statusCode, 204, res.body);
    const after = sortOrders(fx);
    assert.deepEqual(
      [after.get(a), after.get(b)].sort((x, y) => (x ?? 0) - (y ?? 0)),
      [50, 100],
      '槽位集合必须原样保留（导入进来的 50 / 100 不该被算法抹平）',
    );
    assert.ok((after.get(b) ?? 0) < (after.get(a) ?? 0), 'B 被拖到 A 前面 ⇒ B 占更小的槽位');
  } finally {
    await fx.close();
  }
});

// ════════════════ B 组：FR-133 取用口径单一来源 ════════════════

test('AC-126 ⑦⑧：口径只有一处来源 —— 无手写字面量、四处过滤都调工厂、COUNTED_KINDS 不再是死声明', () => {
  // 拼出来而不是写死：否则这条用例自己的断言文案就会把它要禁的字面量带进仓库。
  const handwritten = ['in (', "'copy', 'mcp'", ')'].join('');
  const offenders: string[] = [];
  for (const rel of ['src', 'web/src']) {
    for (const abs of tsFilesUnder(rel)) {
      if (readSource(path.relative(PROJECT_ROOT, abs)).includes(handwritten)) offenders.push(path.relative(PROJECT_ROOT, abs));
    }
  }
  assert.deepEqual(offenders, [], `不得再出现手写的过滤字面量 ${handwritten}`);

  const usage = readSource('src/services/usage.ts');
  assert.match(usage, /export function countedKindsSql\(/, 'FR-133：必须有一个 SQL 片段工厂');
  assert.match(usage, /COUNTED_KINDS\.map\(/, '工厂的取值必须来自 COUNTED_KINDS（否则常量还是死声明）');
  assert.match(
    usage,
    /coalesce\(\$\{[^}]+\}, 'copy'\) in \(\$\{kinds\}\)/,
    '工厂仍要保留 NULL 视作 copy 的兜底，且过滤值来自 kinds（COUNTED_KINDS）',
  );

  // usage.ts 里：定义 1 处 + 调用 ≥3 处
  const callsInUsage = [...usage.matchAll(/countedKindsSql\(/g)].length;
  assert.ok(callsInUsage >= 4, `usage.ts 里至少要有一处定义 + 三处调用，实际 ${String(callsInUsage)}`);
  assert.match(usage, /countedKindsSql\('e'\)/, '带别名的聚合（top）也要用工厂，不能留手写副本');

  const queries = readSource('src/db/prompt-queries.ts');
  assert.match(queries, /countedKindsSql\(\)/, '列表 JOIN 也必须走同一工厂');

  // COUNTED_KINDS 至少被引用两次（定义 + 工厂输入）——"零引用死声明"是这次要修的病
  const kindsRefs = [...usage.matchAll(/COUNTED_KINDS/g)].length;
  assert.ok(kindsRefs >= 2, `COUNTED_KINDS 必须真的被用上，实际引用 ${String(kindsRefs)} 次`);
});

test('AC-126 ⑨：三种 kind 各记一次 —— 列表 use_count 与统计 total 数字一致（view 不计入）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 口径' });

    // view：打开详情（留痕不计数）
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    // copy：复制（计数）
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/copy`, headers: { cookie } });
    /**
     * mcp：MCP 取用（计数）。`x-pm-channel: mcp` **只对 Bearer 生效**（cookie 恒 session，
     * 见 `src/server/auth.ts` 的 `bearerChannel`）⇒ 必须像真 MCP 那样先开一个 read 令牌。
     */
    const tokenRes = await fx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie },
      payload: { name: 'AC126 mcp', scope: 'read' },
    });
    assert.equal(tokenRes.statusCode, 201, tokenRes.body);
    const mcpHeaders = { authorization: `Bearer ${(tokenRes.json() as { token: string }).token}`, 'x-pm-channel': 'mcp' };
    const render = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: mcpHeaders,
      payload: { values: {} },
    });
    assert.equal(render.statusCode, 200, render.body);

    const events = readDb(fx, (db) =>
      db.prepare('SELECT kind FROM usage_events WHERE prompt_id = ? ORDER BY id').all(id),
    ) as Array<{ kind: string }>;
    assert.deepEqual(
      events.map((row) => row.kind),
      ['view', 'copy', 'mcp'],
      '三种 kind 必须各记一次',
    );

    const list = await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=50', headers: { cookie } });
    const items = (list.json() as { items: Array<{ id: number; use_count: number }> }).items;
    const row = items.find((item) => item.id === id);
    assert.equal(row?.use_count, 2, '列表 use_count 只统计 copy + mcp');

    const summary = await fx.app.inject({ method: 'GET', url: '/api/usage/summary?days=1', headers: { cookie } });
    const body = summary.json() as { total: number; by_channel: Record<string, number>; top: Array<{ prompt_id: number; count: number }> };
    assert.equal(body.total, 2, '统计 total 必须与列表同口径（否则就是"页面 N 次、统计 M 次"）');
    assert.equal(body.by_channel.session, 1, 'by_channel 同口径：会话 copy 1 次');
    assert.equal(body.by_channel.mcp, 1, 'by_channel 同口径：mcp 1 次');
    assert.equal(body.top.find((entry) => entry.prompt_id === id)?.count, 2);
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑩：历史数据不重算 —— kind 为 NULL 的行按 copy 计入，view 行仍不计入', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 历史行' });
    /**
     * ⚠️ 既有缺陷（阶段 66 发现，与本次改动无关，在父提交 `3dc0352` 上同样红）：
     * 本用例原先用固定的 `NOW`（2026-10-11T00:00Z）灌行，却用 `days=1` 的**相对**窗口查统计 ⇒
     * 真实时钟走过 NOW + 24h 之后，这些行就落在窗口外（本仓库的机器时钟一到 2026-10-12T00:00 就红）。
     * 这里改成"刚刚"，语义不变：要验的是 `kind` 为 NULL 视作 copy、view 不计入，不是时间窗口。
     */
    const recent = new Date().toISOString();
    insertUsage(fx, id, 'session', null, recent);
    insertUsage(fx, id, 'session', 'view', recent);
    insertUsage(fx, id, 'token', 'copy', recent);

    const detail = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    // 注意：这一次 GET 自己也会写一条 view 行，但它不该被计入
    assert.equal((detail.json() as { use_count: number }).use_count, 2, 'NULL 视作 copy（1）+ 显式 copy（1）');

    const summary = await fx.app.inject({ method: 'GET', url: '/api/usage/summary?days=1', headers: { cookie } });
    assert.equal((summary.json() as { total: number }).total, 2);
    assert.equal(usageCount(fx), 4, '历史行本身不得被改写/删除（只读不重算）');
  } finally {
    await fx.close();
  }
});

// ════════════════ C 组：FR-134 replace 不静默丢取用历史 ════════════════

test('AC-126 ⑪⑫：replace 如实回报取用历史去向与条数，且清空前留一份（库外文件可读、0600）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 取用历史' });
    insertUsage(fx, id, 'session', 'copy', NOW);
    insertUsage(fx, id, 'mcp', 'mcp', NOW);
    insertUsage(fx, id, 'session', 'view', NOW);
    assert.equal(usageCount(fx), 3);

    const file = await exportFile(fx, cookie);
    const result = await importOk(fx, cookie, 'replace', file);

    const history = result.usage_history as { action: string; count: number; backup: string | null };
    assert.equal(history.action, 'cleared', 'replace 清空了取用历史就必须如实说 cleared');
    assert.equal(history.count, 3, '条数必须等于清库前的取用行数');
    assert.equal(usageCount(fx), 0, 'replace 确实清空了（这是有意的取舍，不是 bug）');

    assert.ok(typeof history.backup === 'string', '清空前必须留一份（落点由实现方定，但必须给出）');
    const backup = history.backup as string;
    assert.ok(backup.startsWith(fx.config.dataDir), `备份必须落在数据目录（库外可找）：${backup}`);
    assert.ok(existsSync(backup), `备份文件必须真的存在：${backup}`);
    assert.equal(statSync(backup).mode & 0o777, 0o600, '备份含取用痕迹，权限必须 0600');

    const dump = readJson(backup) as {
      count: number;
      rows: Array<{ prompt_id: number; channel: string; used_at: string; kind: string | null }>;
    };
    assert.equal(dump.count, 3);
    assert.equal(dump.rows.length, 3);
    assert.deepEqual(
      dump.rows.map((row) => row.channel).sort(),
      ['mcp', 'session', 'session'],
    );
    assert.ok(dump.rows.every((row) => typeof row.prompt_id === 'number' && typeof row.used_at === 'string'));
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑪（零条数）：库里没有取用历史时，replace 仍如实回报 count=0（不编造备份）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    await createPrompt(fx, cookie, { title: 'AC126 无取用' });
    const file = await exportFile(fx, cookie);
    const result = await importOk(fx, cookie, 'replace', file);
    const history = result.usage_history as { action: string; count: number; backup: string | null };
    assert.equal(history.action, 'cleared');
    assert.equal(history.count, 0);
    assert.equal(history.backup, null, '没有东西可留时不得凭空造一个文件');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑪（续 3）：replace 失败 ⇒ 不写「清空前留档」，也不挤掉旧备份（返工 ①）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 失败不留档' });
    const file = await exportFile(fx, cookie);
    const backupDir = fx.config.dataDir;
    const listBackups = (): string[] =>
      readdirSync(backupDir)
        .filter((name) => name.startsWith('pre-replace-usage-') && name.endsWith('.json'))
        .sort();

    // 攒满 3 份（replace 保留 prompt id ⇒ 每轮前补一条取用行即可反复触发备份）
    for (let round = 0; round < 3; round += 1) {
      insertUsage(fx, id, 'session', 'copy', NOW);
      await importOk(fx, cookie, 'replace', file);
    }
    const filled = listBackups();
    assert.equal(filled.length, 3, '先攒满 3 份，才看得出「失败导入」是否误触发轮换');

    // 一个必然失败的 replace：同一 prompt 的两条版本撞 UNIQUE(prompt_id, version_no) ⇒ 事务回滚
    const broken = structuredClone(file);
    const first = broken.prompts[0];
    assert.ok(first !== undefined, '导出文件里必须至少有一条 prompt');
    const version = first.versions[0];
    assert.ok(version !== undefined, '这条 prompt 至少有一个版本');
    first.versions.push(structuredClone(version));
    insertUsage(fx, id, 'session', 'copy', NOW);
    const before = usageCount(fx);
    const res = await importFile(fx, cookie, 'replace', broken);
    assert.equal(res.statusCode, 400, res.body);

    assert.deepEqual(
      listBackups(),
      filled,
      '失败的 replace 没有清库 ⇒ 不得新增「清空前留档」，更不得把一份真实历史备份挤出保留窗口',
    );
    assert.equal(usageCount(fx), before, '失败导入整体回滚，取用历史原样');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑭：merge 不回归 —— 取用历史保留，回报 action=kept 且条数不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 merge 保留' });
    insertUsage(fx, id, 'session', 'copy', NOW);
    const file = await exportFile(fx, cookie);

    const result = await importOk(fx, cookie, 'merge', file);
    const history = result.usage_history as { action: string; count: number; backup: string | null };
    assert.equal(history.action, 'kept', 'merge 不清库 ⇒ 取用历史必须原样保留');
    assert.equal(history.count, 1);
    assert.equal(history.backup, null, 'merge 不需要备份（没有东西被清掉）');
    assert.equal(usageCount(fx), 1, '取用行必须还在');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑬：取舍写进文档（docs/api.md 的导入章节 + docs/traps.md 各一条）', () => {
  const api = readSource('docs/api.md');
  assert.match(api, /usage_history/, 'docs/api.md 必须写明 replace 的取用历史去向字段');
  assert.match(api, /取用历史/, 'docs/api.md 必须用中文讲清这个取舍');
  assert.match(api, /merge/, 'merge 的行为也要写（保留）');

  const traps = readSource('docs/traps.md');
  assert.match(traps, /取用历史/, 'docs/traps.md 必须留一条坑：replace 会清空取用历史');
  assert.match(traps, /usage_events|usage_history/, 'traps 条目要点出受影响的表 / 字段');
});

// ════════════════ D 组：FR-135 事务边界与约束错误分派 ════════════════

test('AC-126 ⑮：读码可验 —— updatePrompt 的 existing 读、版本号计算与写入在同一个事务里', () => {
  const src = readSource('src/services/prompts.ts');
  const start = src.indexOf('export async function updatePrompt(');
  assert.ok(start > 0, '必须能定位 updatePrompt');
  const end = src.indexOf('export async function deletePrompt(', start);
  const body = src.slice(start, end > 0 ? end : undefined);

  assert.match(body, /await qe\.transaction\(\)\.execute\(async \(trx\) => \{/, '必须有事务');
  assert.match(
    body,
    /transaction\(\)\.execute\(async \(trx\) => \{[\s\S]*?trx\.selectFrom\('prompts'\)/,
    'FR-135：existing 必须在事务**内**读（否则并发 PUT 会撞 UNIQUE(prompt_id, version_no)）',
  );
  assert.equal(
    /const existing = await qe\.selectFrom\('prompts'\)/.test(body),
    false,
    '不得再在事务外读 existing',
  );
  assert.match(body, /trx\s*\.\s*insertInto\('prompt_versions'\)/, '版本行必须与主体写在同一个事务里');
});

test('AC-126 ⑯：唯一约束冲突不再被报成 folder 文案（构造版本号冲突）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 冲突' });
    const before = promptRow(fx, id);
    assert.equal(before?.version_no, 1);

    // 直插一条"下一个版本号"的版本行 ⇒ 本次内容变更必然撞 UNIQUE(prompt_id, version_no)
    readDb(fx, (db) => {
      db.prepare(
        'INSERT INTO prompt_versions (prompt_id, version_no, title, user_prompt, system_prompt, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, 2, '别的写入者', 'x', 'y', 'z', NOW);
    });

    const res = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(id)}`,
      headers: { cookie },
      payload: { title: '改一下' },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.body;
    assert.equal(
      body.includes('folder_id 引用了不存在的文件夹'),
      false,
      '唯一约束冲突必须与 folder 问题分开报（用户按 folder 提示永远查不到原因）',
    );
    assert.match(body, /invalid_body/);
    assert.match(body, /版本|冲突|重试/, `错误必须可理解：${body}`);

    // 失败不得半写：标题与版本号保持原样，版本行也没多
    const after = promptRow(fx, id);
    assert.equal(after?.title, before?.title, '事务回滚 ⇒ 标题不得被改掉');
    assert.equal(after?.version_no, 1, '事务回滚 ⇒ version_no 不得前进');
    assert.equal(versionCount(fx, id), 2, '直插的那条 + 原始那条，不得再多');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑰：真 folder 外键问题仍报 folder 文案（不许把既有语义改丢）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 folder FK' });
    const res = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(id)}`,
      headers: { cookie },
      payload: { folder_id: 999_999 },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /folder_id 引用了不存在的文件夹/, '只有真是 folder 问题才报 folder 文案');
    assert.equal(promptRow(fx, id)?.title, 'AC126 folder FK', '失败不得半写');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑱：并发两次 PUT 同一 prompt —— 要么串行成功、要么给可理解的错误（不得 500 / 不得 folder 文案）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 并发' });

    const put = (title: string): Promise<{ statusCode: number; body: string }> =>
      fx.app
        .inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: { cookie }, payload: { title } })
        .then((res) => ({ statusCode: res.statusCode, body: res.body }));

    const results = await Promise.all([put('并发 A'), put('并发 B')]);
    let succeeded = 0;
    for (const res of results) {
      assert.notEqual(res.statusCode, 500, `并发不得 500：${res.body}`);
      if (res.statusCode === 200) {
        succeeded += 1;
        continue;
      }
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(res.body.includes('folder_id 引用了不存在的文件夹'), false, '不得甩给用户一个错误的原因');
      assert.match(res.body, /版本|冲突|重试/, `错误必须可理解：${res.body}`);
    }
    assert.ok(succeeded >= 1, '至少一次写入必须成功');

    // 状态自洽：成功几次，版本号就前进几次、版本行就多几条
    assert.equal(promptRow(fx, id)?.version_no, 1 + succeeded, 'version_no 必须与成功次数一致');
    assert.equal(versionCount(fx, id), 1 + succeeded, '版本行数必须与成功次数一致');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑲：非内容字段往返（回归）—— 只改 folder / favorite / remember_variables 不动版本号', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC126 非内容' });
    const res = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(id)}`,
      headers: { cookie },
      payload: { favorite: true, remember_variables: false },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(promptRow(fx, id)?.version_no, 1, '非内容变更不得产生新版本（FR-129 不回归）');
    assert.equal(versionCount(fx, id), 1);
  } finally {
    await fx.close();
  }
});

// ════════════════ E 组：零迁移与现状 ════════════════

test('AC-126 ㉑：零迁移 —— migrations 仍是 8 个文件、schema 仍是 v8', async () => {
  const files = readdirSync(path.join(PROJECT_ROOT, 'migrations')).filter((name) => name.endsWith('.sql'));
  assert.equal(files.length, 9, '阶段 64 自己没新增迁移；阶段 68 起总数是 9（多出 009_fts-update-when.sql）');

  const fx = await makeFixture();
  try {
    const row = readDb(fx, (db) => db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()) as {
      version: number;
    };
    assert.equal(row.version, 9, 'schema 到 v9（阶段 68 起）');
  } finally {
    await fx.close();
  }
});

test('AC-126 ⑪（续）：界面上也「不静默」—— usageHistoryNotice 说清去向、条数与备份落点', () => {
  // FR-134 的措辞由 web/src/pure.ts 一处产出，导入弹窗与云端恢复弹窗共用
  assert.equal(usageHistoryNotice({ action: 'kept', count: 7, backup: null }), '取用历史：原样保留 7 条');
  assert.equal(usageHistoryNotice({ action: 'cleared', count: 0, backup: null }), '取用历史：本来就没有记录');
  const cleared = usageHistoryNotice({ action: 'cleared', count: 3, backup: '/data/pre-replace-usage-x.json' });
  assert.match(cleared, /已清空 3 条/);
  assert.match(cleared, /\/data\/pre-replace-usage-x\.json/, '有存档就必须把落点报出来（用户才知道去哪儿捞）');
  assert.equal(
    usageHistoryNotice({ action: 'cleared', count: 3, backup: null }).includes('已留档'),
    false,
    '没有备份时不得凭空说"已留档"',
  );
});

test('AC-126 ⑪（续 2，源码级）：两个弹窗都接了 usage_history，类型与后端字段同名', () => {
  const types = readSource('web/src/types.ts');
  assert.match(types, /export interface UsageHistoryReport \{/, '前端类型必须有 UsageHistoryReport');
  assert.match(types, /usage_history: UsageHistoryReport;/, 'ImportResult / SyncPullResult 必须带 usage_history');

  for (const rel of ['web/src/components/ImportExportModal.tsx', 'web/src/components/SyncModal.tsx']) {
    const src = readSource(rel);
    assert.match(src, /usageHistoryNotice\(/, `${rel} 必须把取用历史的去向告诉用户（不许静默）`);
    assert.match(src, /usage_history/, `${rel} 必须读响应里的 usage_history`);
  }
});
