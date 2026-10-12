// 阶段 62（FR-129 / AC-124）：**版本号只记「内容变更」**。
// 纪律要求：断言**直接查库**（`readDb` 拿 better-sqlite3 连接跑 SELECT），不能只看接口回包 ——
// 「版本行有没有多一条」「updated_at 动没动」这两件事，接口回包看不出来。
//
// 内容字段固定为 `prompt_versions` 装得下、且回滚能恢复的那 4 个：
// `title` / `user_prompt` / `system_prompt` / `notes`（BRIEF FR-129 ① / D-60 ③）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';
import { readSource } from './source-text.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const BASE = {
  title: '阶段62 版本号',
  user_prompt: '正文 v1',
  system_prompt: '系统 v1',
  notes: '备注 v1',
};

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function createPrompt(fx: Fixture, cookie: string, payload: Record<string, unknown> = BASE): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function put(
  fx: Fixture,
  cookie: string,
  id: number,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: { cookie }, payload });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Record<string, unknown>;
}

async function get(fx: Fixture, cookie: string, id: number): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Record<string, unknown>;
}

interface VersionRow {
  version_no: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  created_at: string;
}

/** 直查库：某个 prompt 的版本行（按 version_no 升序）。 */
function versionRows(fx: Fixture, promptId: number): VersionRow[] {
  return readDb(fx, (db) =>
    db
      .prepare(
        'SELECT version_no, title, user_prompt, system_prompt, notes, created_at FROM prompt_versions WHERE prompt_id = ? ORDER BY version_no',
      )
      .all(promptId) as VersionRow[],
  );
}

interface PromptRow {
  version_no: number;
  updated_at: string;
  created_at: string;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  favorite: number;
  folder_id: number | null;
  remember_variables: number;
}

/** 直查库：prompts 主体那一行（版本号 / updated_at 的**唯一真相源**）。 */
function promptRow(fx: Fixture, promptId: number): PromptRow {
  const row = readDb(fx, (db) =>
    db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId),
  ) as PromptRow | undefined;
  assert.ok(row !== undefined, `prompts 里找不到 id=${String(promptId)}`);
  return row;
}

async function newFolder(fx: Fixture, cookie: string, name: string): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// A. 内容变更 ⇒ 产生新版本
// ---------------------------------------------------------------------------

test('AC-124 ①：PUT 改 user_prompt（新值 ≠ 旧值）⇒ version_no +1、新增一条版本行、4 个内容字段 == 更新后的主体', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const before = promptRow(fx, id);
    assert.equal(before.version_no, 1);
    assert.equal(versionRows(fx, id).length, 1, '新建写 v1');

    await sleep(3);
    const body = await put(fx, cookie, id, { user_prompt: '正文 v2' });
    assert.equal(body.version_no, 2);

    const after = promptRow(fx, id);
    assert.equal(after.version_no, 2, '主体 version_no 必须 +1');
    assert.equal(after.user_prompt, '正文 v2');
    const rows = versionRows(fx, id);
    assert.equal(rows.length, 2, '版本行数必须 +1');
    const latest = rows.at(-1);
    assert.ok(latest !== undefined);
    assert.equal(latest.version_no, 2);
    for (const field of ['title', 'user_prompt', 'system_prompt', 'notes'] as const) {
      assert.equal(latest[field], after[field], `新版本行的 ${field} 必须等于更新后的主体`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-124 ②：title / system_prompt / notes 各自单独改（值真的变了）⇒ 各自 +1 且新增一行', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['title', { title: '阶段62 改过的标题' }],
    ['system_prompt', { system_prompt: '系统 v2' }],
    ['notes', { notes: '备注 v2' }],
  ];
  for (const [field, patch] of cases) {
    const fx = await makeFixture();
    try {
      const cookie = await authed(fx);
      const id = await createPrompt(fx, cookie);
      await sleep(3);
      await put(fx, cookie, id, patch);
      const after = promptRow(fx, id);
      assert.equal(after.version_no, 2, `${field} 改了 ⇒ version_no 必须 +1`);
      assert.equal(versionRows(fx, id).length, 2, `${field} 改了 ⇒ 必须新增一条版本行`);
      assert.equal(after[field as 'title'], patch[field], `${field} 必须落库`);
    } finally {
      await fx.close();
    }
  }
});

test('AC-124 ③：新版本行的 created_at == 主体的 updated_at', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    await sleep(3);
    await put(fx, cookie, id, { user_prompt: '正文 v2' });
    const after = promptRow(fx, id);
    const latest = versionRows(fx, id).at(-1);
    assert.ok(latest !== undefined);
    assert.equal(latest.created_at, after.updated_at, '两者必须是同一次 nowIso()');
    assert.notEqual(after.updated_at, after.created_at, '内容变了 ⇒ updated_at 必须离开 created_at');
  } finally {
    await fx.close();
  }
});

test('AC-124 ④：一次 PUT 同时改多个内容字段 ⇒ 只 +1（不是每个字段各 +1）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    await sleep(3);
    await put(fx, cookie, id, {
      title: '阶段62 新标题',
      user_prompt: '正文 v2',
      system_prompt: '系统 v2',
      notes: '备注 v2',
    });
    const after = promptRow(fx, id);
    assert.equal(after.version_no, 2, '4 个字段一起改也只 +1');
    assert.equal(versionRows(fx, id).length, 2);
  } finally {
    await fx.close();
  }
});

// ---------------------------------------------------------------------------
// B. 非内容变更 ⇒ 不产生新版本、updated_at 也不动
// ---------------------------------------------------------------------------

test('AC-124 ⑤：PUT {favorite}（true↔false 往返）⇒ version_no / updated_at 都不动、版本行数不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    await put(fx, cookie, id, { favorite: true });
    const on = promptRow(fx, id);
    assert.equal(on.favorite, 1, '收藏必须真的生效');
    assert.equal(on.version_no, before.version_no, '收藏不得改 version_no');
    assert.equal(on.updated_at, before.updated_at, '收藏不得改 updated_at');
    assert.equal(versionRows(fx, id).length, rowsBefore, '收藏不得新增版本行');

    await put(fx, cookie, id, { favorite: false });
    const off = promptRow(fx, id);
    assert.equal(off.favorite, 0);
    assert.equal(off.version_no, before.version_no);
    assert.equal(off.updated_at, before.updated_at);
    assert.equal(versionRows(fx, id).length, rowsBefore);
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑥：PUT {folder_id}（null ↔ 有值往返）⇒ 同上', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const folder = await newFolder(fx, cookie, '阶段62 目录');
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    await put(fx, cookie, id, { folder_id: folder });
    const moved = promptRow(fx, id);
    assert.equal(moved.folder_id, folder, '移动必须真的生效');
    assert.equal(moved.version_no, before.version_no, '移动目录不得改 version_no');
    assert.equal(moved.updated_at, before.updated_at, '移动目录不得改 updated_at');
    assert.equal(versionRows(fx, id).length, rowsBefore, '移动目录不得新增版本行');

    await put(fx, cookie, id, { folder_id: null });
    const out = promptRow(fx, id);
    assert.equal(out.folder_id, null);
    assert.equal(out.version_no, before.version_no);
    assert.equal(out.updated_at, before.updated_at);
    assert.equal(versionRows(fx, id).length, rowsBefore);
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑦：PUT {remember_variables}（true↔false 往返）⇒ 同上', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const before = promptRow(fx, id);
    assert.equal(before.remember_variables, 1, '新建默认「记住」');
    const rowsBefore = versionRows(fx, id).length;

    await put(fx, cookie, id, { remember_variables: false });
    const off = promptRow(fx, id);
    assert.equal(off.remember_variables, 0, '开关必须真的生效');
    assert.equal(off.version_no, before.version_no, '切开关不得改 version_no');
    assert.equal(off.updated_at, before.updated_at, '切开关不得改 updated_at');
    assert.equal(versionRows(fx, id).length, rowsBefore, '切开关不得新增版本行');

    await put(fx, cookie, id, { remember_variables: true });
    const on = promptRow(fx, id);
    assert.equal(on.remember_variables, 1);
    assert.equal(on.version_no, before.version_no);
    assert.equal(on.updated_at, before.updated_at);
    assert.equal(versionRows(fx, id).length, rowsBefore);
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑧：PUT {tags}（标签集合确实变了）⇒ 标签生效，但 version_no / updated_at 不动、版本行数不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { ...BASE, tags: ['甲'] });
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    const body = await put(fx, cookie, id, { tags: ['乙', '丙'] });
    // 标签返回顺序由标签表决定，两边都排序后比较
    assert.deepEqual([...(body.tags as string[])].sort(), ['乙', '丙'].sort(), '标签必须真的换掉');
    const after = promptRow(fx, id);
    assert.equal(after.version_no, before.version_no, '改标签不得改 version_no');
    assert.equal(after.updated_at, before.updated_at, '改标签不得改 updated_at');
    assert.equal(versionRows(fx, id).length, rowsBefore, '改标签不得新增版本行');
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑨：POST /api/prompts/bulk 的 favorite / move（≥2 条，含"有的变、有的没变"的混合批）⇒ 同上', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const folder = await newFolder(fx, cookie, '阶段62 批量目录');
    const a = await createPrompt(fx, cookie, { ...BASE, title: 'A' });
    const b = await createPrompt(fx, cookie, { ...BASE, title: 'B' });
    const c = await createPrompt(fx, cookie, { ...BASE, title: 'C', favorite: true, folder_id: folder });
    const beforeA = promptRow(fx, a);
    const beforeB = promptRow(fx, b);
    const beforeC = promptRow(fx, c);
    const rowsBefore = [a, b, c].map((id) => versionRows(fx, id).length);

    // favorite：A/B 会变，C 已经是收藏 ⇒ 不变（混合批）
    const fav = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts/bulk',
      headers: { cookie },
      payload: { action: 'favorite', ids: [a, b, c] },
    });
    assert.equal(fav.statusCode, 200, fav.body);
    assert.equal(promptRow(fx, a).favorite, 1);
    assert.equal(promptRow(fx, b).favorite, 1);
    assert.equal(promptRow(fx, c).favorite, 1, '已是收藏的保持');

    // move：A/B 会变，C 已经在该目录 ⇒ 不变（混合批）
    const move = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts/bulk',
      headers: { cookie },
      payload: { action: 'move', ids: [a, b, c], folder_id: folder },
    });
    assert.equal(move.statusCode, 200, move.body);
    assert.equal(promptRow(fx, a).folder_id, folder);
    assert.equal(promptRow(fx, b).folder_id, folder);

    const after = [promptRow(fx, a), promptRow(fx, b), promptRow(fx, c)];
    const before = [beforeA, beforeB, beforeC];
    for (const [index, row] of after.entries()) {
      assert.equal(row.version_no, before[index]?.version_no, `第 ${String(index)} 条：批量操作不得改 version_no`);
      assert.equal(row.updated_at, before[index]?.updated_at, `第 ${String(index)} 条：批量操作不得改 updated_at`);
      assert.equal(
        versionRows(fx, row === after[0] ? a : row === after[1] ? b : c).length,
        rowsBefore[index],
        `第 ${String(index)} 条：批量操作不得新增版本行`,
      );
    }
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑩：PATCH /api/prompts/order ⇒ 不动 version_no / updated_at / 版本行（现状，不得回归）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const a = await createPrompt(fx, cookie, { ...BASE, title: 'A' });
    const b = await createPrompt(fx, cookie, { ...BASE, title: 'B' });
    const beforeA = promptRow(fx, a);
    const beforeB = promptRow(fx, b);
    const rowsA = versionRows(fx, a).length;
    const rowsB = versionRows(fx, b).length;

    const res = await fx.app.inject({
      method: 'PATCH',
      url: '/api/prompts/order',
      headers: { cookie },
      payload: { ids: [b, a] },
    });
    assert.equal(res.statusCode, 204, res.body);

    for (const [id, before, rows] of [
      [a, beforeA, rowsA],
      [b, beforeB, rowsB],
    ] as const) {
      const after = promptRow(fx, id);
      assert.equal(after.version_no, before.version_no, '拖拽排序不得改 version_no');
      assert.equal(after.updated_at, before.updated_at, '拖拽排序不得改 updated_at');
      assert.equal(versionRows(fx, id).length, rows, '拖拽排序不得新增版本行');
    }
  } finally {
    await fx.close();
  }
});

// ---------------------------------------------------------------------------
// C. 值没真变 ⇒ 不产生新版本
// ---------------------------------------------------------------------------

test('AC-124 ⑪：PUT 传 title 但新值 == 旧值 ⇒ 不 +1、不写版本、updated_at 不动', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    const body = await put(fx, cookie, id, { title: BASE.title });
    assert.equal(body.version_no, before.version_no, '值没变 ⇒ 不得 +1');
    const after = promptRow(fx, id);
    assert.equal(after.version_no, before.version_no);
    assert.equal(after.updated_at, before.updated_at, '值没变 ⇒ updated_at 不动');
    assert.equal(versionRows(fx, id).length, rowsBefore, '值没变 ⇒ 不得新增版本行');
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑫：PUT 传全部 4 个内容字段且都与旧值相同 ⇒ 同上', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    await put(fx, cookie, id, { ...BASE });
    const after = promptRow(fx, id);
    assert.equal(after.version_no, before.version_no, '4 个字段全同值 ⇒ 不得 +1');
    assert.equal(after.updated_at, before.updated_at);
    assert.equal(versionRows(fx, id).length, rowsBefore);
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑬：PUT 空对象 {} ⇒ 不动 version_no / updated_at（也不写版本行）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    await put(fx, cookie, id, {});
    const after = promptRow(fx, id);
    assert.equal(after.version_no, before.version_no);
    assert.equal(after.updated_at, before.updated_at);
    assert.equal(versionRows(fx, id).length, rowsBefore);
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑭：回滚到与当前内容完全相同的那一版 ⇒ 不 +1、不写新版本、updated_at 不动', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    // 先做一次真内容变更，这样 v1 与当前内容不同；再回滚到 v2（== 当前）
    await sleep(3);
    await put(fx, cookie, id, { user_prompt: '正文 v2' });
    const before = promptRow(fx, id);
    assert.equal(before.version_no, 2);
    const rowsBefore = versionRows(fx, id).length;

    const res = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/2/rollback`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200, res.body);

    const after = promptRow(fx, id);
    assert.equal(after.version_no, before.version_no, '回滚到相同内容 ⇒ 不得 +1');
    assert.equal(after.updated_at, before.updated_at, '回滚到相同内容 ⇒ updated_at 不动');
    assert.equal(versionRows(fx, id).length, rowsBefore, '回滚到相同内容 ⇒ 不得新增版本行');
  } finally {
    await fx.close();
  }
});

// ---------------------------------------------------------------------------
// D. 回滚与既有能力不回归
// ---------------------------------------------------------------------------

test('AC-124 ⑮：回滚到内容不同的历史版 ⇒ +1、写新版本、updated_at 更新，且只恢复 4 个内容字段', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const folder = await newFolder(fx, cookie, '阶段62 回滚目录');
    const id = await createPrompt(fx, cookie, { ...BASE, tags: ['甲'], favorite: true, folder_id: folder });
    await sleep(3);
    await put(fx, cookie, id, { user_prompt: '正文 v2', title: '阶段62 标题 v2' });
    const before = promptRow(fx, id);
    assert.equal(before.version_no, 2);
    const rowsBefore = versionRows(fx, id).length;

    await sleep(3);
    const res = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/1/rollback`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200, res.body);

    const after = promptRow(fx, id);
    assert.equal(after.version_no, 3, '回滚到不同内容 ⇒ +1');
    assert.equal(after.user_prompt, BASE.user_prompt, '正文必须恢复');
    assert.equal(after.title, BASE.title, '标题必须恢复');
    assert.equal(versionRows(fx, id).length, rowsBefore + 1, '必须新增一条版本行');
    const latest = versionRows(fx, id).at(-1);
    assert.ok(latest !== undefined);
    assert.equal(latest.created_at, after.updated_at, '新版本行 created_at == updated_at');
    assert.equal(latest.user_prompt, BASE.user_prompt);

    // 只恢复 4 个内容字段：非内容字段不受影响
    assert.equal(after.favorite, 1, '收藏不受回滚影响');
    assert.equal(after.folder_id, folder, '目录不受回滚影响');
    assert.equal(after.remember_variables, 1, '「记住变量值」不受回滚影响');
    const tags = (await get(fx, cookie, id)).tags;
    assert.deepEqual(tags, ['甲'], '标签不受回滚影响');
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑯：FR-86「只留最近 10 版」仍生效 —— 连续 12 次内容变更 ⇒ 版本行数 ≤ 10', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    for (let i = 2; i <= 12; i += 1) {
      await put(fx, cookie, id, { user_prompt: `正文 v${String(i)}` });
    }
    const after = promptRow(fx, id);
    assert.equal(after.version_no, 12, '12 次真内容变更 ⇒ version_no = 12');
    const rows = versionRows(fx, id);
    assert.ok(rows.length <= 10, `版本行数必须 ≤ 10，实际 ${String(rows.length)}`);
    assert.equal(rows.at(-1)?.version_no, 12, '保留的必须是最近的（含当前版本）');
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑰：取用记账不回归 —— /render、/api/prompts/:id/copy 不产生新版本', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { ...BASE, user_prompt: '你好 {{姓名}}' });
    const before = promptRow(fx, id);
    const rowsBefore = versionRows(fx, id).length;

    const rendered = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { cookie },
      payload: { values: { 姓名: '甲' } },
    });
    assert.equal(rendered.statusCode, 200, rendered.body);

    const copied = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/copy`,
      headers: { cookie },
    });
    assert.equal(copied.statusCode, 204, copied.body);

    const after = promptRow(fx, id);
    assert.equal(after.version_no, before.version_no, '取用不得改 version_no');
    assert.equal(after.updated_at, before.updated_at, '取用不得改 updated_at');
    assert.equal(versionRows(fx, id).length, rowsBefore, '取用不得新增版本行');
  } finally {
    await fx.close();
  }
});

test('AC-124 ⑱：导入（replace）保留文件里的版本行，不被本改动影响', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    await sleep(3);
    await put(fx, cookie, id, { user_prompt: '正文 v2' });
    await sleep(3);
    await put(fx, cookie, id, { user_prompt: '正文 v3' });
    const exported = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as {
      prompts: Array<{ versions: VersionRow[]; user_prompt: string }>;
    };
    const sourceVersions = exported.prompts[0]?.versions ?? [];
    assert.equal(sourceVersions.length, 3, '导出必须带 3 个版本行');

    // 清库后 replace 导入
    const replaced = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'replace', data: exported },
    });
    assert.equal(replaced.statusCode, 200, replaced.body);

    const restored = readDb(fx, (db) =>
      db.prepare('SELECT version_no, user_prompt FROM prompt_versions ORDER BY version_no').all(),
    ) as Array<{ version_no: number; user_prompt: string }>;
    assert.deepEqual(
      restored.map((row) => [row.version_no, row.user_prompt]),
      sourceVersions.map((row) => [row.version_no, row.user_prompt]),
      '导入后版本行必须与文件逐字一致（本改动不碰导入路径）',
    );
  } finally {
    await fx.close();
  }
});

// ---------------------------------------------------------------------------
// E. 界面与文档
// ---------------------------------------------------------------------------

test('AC-124 ⑲：版本历史接口在非内容操作后条目数不变、内容编辑后 +1', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    const listVersions = async () => {
      const res = await fx.app.inject({
        method: 'GET',
        url: `/api/prompts/${String(id)}/versions`,
        headers: { cookie },
      });
      assert.equal(res.statusCode, 200, res.body);
      return (res.json() as { items: Array<{ version_no: number }> }).items;
    };
    assert.equal((await listVersions()).length, 1);

    await put(fx, cookie, id, { favorite: true });
    await put(fx, cookie, id, { remember_variables: false });
    await put(fx, cookie, id, { tags: ['甲'] });
    assert.equal((await listVersions()).length, 1, '收藏 / 切开关 / 改标签后版本面板一条都不新增');

    await sleep(3);
    await put(fx, cookie, id, { user_prompt: '正文 v2' });
    const items = await listVersions();
    assert.equal(items.length, 2, '正文编辑后新增一条');
    assert.equal(items.at(-1)?.version_no, 2);
  } finally {
    await fx.close();
  }
});

test('AC-124 ㉑：docs/versioning.md 与 CHANGELOG 记明这是行为契约变更（MINOR）', () => {
  const versioning = readSource('docs/versioning.md');
  assert.match(versioning, /内容变更/, 'versioning.md 必须写明「只有内容变更才产生新版本」');
  assert.match(versioning, /updated_at/, 'versioning.md 必须写明 updated_at 的新口径');

  const changelog = readSource('CHANGELOG.md');
  assert.match(changelog, /MINOR/, 'CHANGELOG 必须标为 MINOR（行为契约变更）');
  assert.match(changelog, /版本号|version_no/, 'CHANGELOG 必须点名版本号语义的变化');
});

// ---------------------------------------------------------------------------
// 返工 ①（2026-10-10，独立对抗性复核 finding 1）
//
// 复核结论：回滚到「内容与当前相同」的版本时服务端**不产生新版本**（AC-124 ⑭），但
// `VersionPanel` 的确认弹窗与成功提示**无条件**宣称"会生成一个新版本 / 已生成新版本"
// ⇒ 用户看到提示变了却什么都没变，会以为回滚失败或以为多了一版而反复操作。
//
// 修法：文案提成纯函数 `rollbackNotice(target, before, after)`，由组件按服务端返回的
// `version_no` 分支调用。**纯函数是为了能被这里机械验证** —— 组件里的 `message.xxx(...)`
// 没法直接断言，只断言源码字符串是"假绿"（阶段 61 复核 finding 2 的教训）。
// ---------------------------------------------------------------------------

test('返工① a：rollbackNotice 只在 version_no 真的前进时才说「已生成新版本」', async () => {
  const { rollbackNotice } = await import('../web/src/pure.ts');

  // 内容没变 ⇒ 服务端不产生新版本（before === after）⇒ 必须是 info 且**不许**出现"已生成新版本"
  const same = rollbackNotice(1, 1, 1);
  assert.equal(same.kind, 'info', '内容与当前相同时必须用 message.info，不能用 success');
  assert.equal(same.text, '已回滚到 v1（内容与当前相同，未生成新版本）');
  assert.doesNotMatch(same.text, /已生成新版本/, '不许再宣称"已生成新版本"');
  assert.match(same.text, /未生成新版本/);

  // 一般形态：点的是旧版本、当前是 v6 ⇒ 回滚后变 v7（内容不同）
  const changed = rollbackNotice(3, 6, 7);
  assert.equal(changed.kind, 'success');
  assert.equal(changed.text, '已回滚到 v3（已生成新版本）');

  // 边界：只有一版时点回滚（target === before === after）
  assert.equal(rollbackNotice(1, 1, 1).kind, 'info');

  // 反向断言：after 只要和 before 不同就必须是 success（哪怕只是 +1）
  assert.equal(rollbackNotice(2, 4, 5).kind, 'success');
});

test('返工① b：VersionPanel 按服务端返回值分支，弹窗不再无条件宣称会生成新版本', () => {
  const src = readSource('web/src/components/VersionPanel.tsx');
  assert.match(src, /rollbackNotice\(/, 'VersionPanel 必须调用 rollbackNotice 而不是写死文案');
  assert.match(src, /const updated = await api\.rollback\(/, '必须接住回滚接口的返回值');
  assert.match(src, /updated\.version_no/, '必须用服务端返回的 version_no 做分支');
  assert.doesNotMatch(
    src,
    /description="会生成一个新版本/,
    '弹窗描述不许再无条件宣称"会生成一个新版本"',
  );
  assert.match(src, /内容与当前不同时会生成一个新版本/, '弹窗描述必须写明"内容不同时"才生成新版本');
  assert.equal(
    src.match(/内容与当前不同时会生成一个新版本/g)?.length,
    2,
    '表格行与详情页两个回滚入口都要改到',
  );
  // 同类残留：表格视图顶部那条 Alert 原来写「回滚会生成新版本」（没有"不同内容"限定），
  // 与 FR-129 的真实行为不符 —— 用户看到的每一处回滚说明都必须带上"内容不同"这个条件。
  assert.doesNotMatch(
    src,
    /回滚会生成新版本/,
    '表格视图的 Alert 也不许再无条件宣称"回滚会生成新版本"',
  );
  assert.match(
    src,
    /回滚到不同内容时会生成新版本/,
    'Alert 必须写成"回滚到不同内容时会生成新版本"',
  );
});

test('返工① c：接口层实证 —— 回滚到与当前相同的版本不产生新版本，回滚到不同内容才 +1', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie);
    await put(fx, cookie, id, { user_prompt: '正文 v2' });
    assert.equal((await get(fx, cookie, id)).version_no, 2);

    // 回滚到 v2（内容与当前完全相同）⇒ 200、版本号不动、版本行不增
    const same = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/2/rollback`,
      headers: { cookie },
    });
    assert.equal(same.statusCode, 200, same.body);
    assert.equal((same.json() as { version_no: number }).version_no, 2, '内容相同 ⇒ 不产生新版本');
    assert.equal(versionRows(fx, id).length, 2, '版本行数也不许增加');

    // 回滚到 v1（内容不同）⇒ +1，且提示该说"已生成新版本"
    const changed = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/1/rollback`,
      headers: { cookie },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    const after = (changed.json() as { version_no: number }).version_no;
    assert.equal(after, 3);
    const { rollbackNotice } = await import('../web/src/pure.ts');
    assert.equal(rollbackNotice(1, 2, after).kind, 'success');
  } finally {
    await fx.close();
  }
});
