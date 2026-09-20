// 阶段 27 / FR-77（BRIEF v34 §4 + §8 AC-78 ⑥⑨）：新增**批量接口** `POST /api/prompts/bulk`。
//
//   body = { action: 'favorite' | 'move' | 'delete', ids: number[], folder_id?: number | null }
//   200  → { action, affected }（受影响条数）
//   400  → invalid_body（空 ids / 重复 id / 不存在的 id / 未知 action / move 缺 folder_id / 目标文件夹不存在）
//   401  → 沿用现有认证闸门
//
// 落库口径（实现方选定，PROGRESS 记录理由）：**整批一个事务**；favorite/move 复用单条 PUT 的语义
// （写目标列 + `version_no` 递增 + 留一条版本快照 + 更新 `updated_at`），delete 走单条删除的级联清理。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function newPrompt(fx: Fixture, cookie: string, title: string): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { title, user_prompt: `正文 ${title}`, system_prompt: 'S', notes: `备注 ${title}` },
  });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function getPrompt(fx: Fixture, cookie: string, id: number) {
  const res = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as {
    id: number;
    favorite: boolean;
    folder_id: number | null;
    version_no: number;
    updated_at: string;
    title: string;
  };
}

async function bulk(fx: Fixture, cookie: string, payload: object) {
  return fx.app.inject({ method: 'POST', url: '/api/prompts/bulk', headers: { cookie }, payload });
}

async function total(fx: Fixture, cookie: string): Promise<number> {
  const res = await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=200', headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { total: number }).total;
}

test('AC-78 ④：POST /api/prompts/bulk action=favorite 把选中条目设为收藏（已收藏的保持）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    const c = await newPrompt(fx, cookie, 'C');
    // C 已是收藏（模拟"已是收藏的保持"）
    assert.equal(
      (await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(c)}`, headers: { cookie }, payload: { favorite: true } }))
        .statusCode,
      200,
    );

    const res = await bulk(fx, cookie, { action: 'favorite', ids: [a, b, c] });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { action: 'favorite', affected: 3 });

    assert.equal((await getPrompt(fx, cookie, a)).favorite, true);
    assert.equal((await getPrompt(fx, cookie, b)).favorite, true);
    assert.equal((await getPrompt(fx, cookie, c)).favorite, true);

    // 幂等：同样请求再来一次结果一致，且不重复产生副作用
    const again = await bulk(fx, cookie, { action: 'favorite', ids: [a, b, c] });
    assert.equal(again.statusCode, 200, again.body);
    assert.deepEqual(again.json(), { action: 'favorite', affected: 3 });
    assert.equal((await getPrompt(fx, cookie, a)).favorite, true);
  } finally {
    await fx.close();
  }
});

test('AC-78 ⑤：POST /api/prompts/bulk action=move 改 folder_id（含移回「未归类」）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const folder = Number(
      (await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '目标目录' } }))
        .json().id,
    );
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    const c = await newPrompt(fx, cookie, 'C');

    const moved = await bulk(fx, cookie, { action: 'move', ids: [a, b], folder_id: folder });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.deepEqual(moved.json(), { action: 'move', affected: 2 });
    assert.equal((await getPrompt(fx, cookie, a)).folder_id, folder);
    assert.equal((await getPrompt(fx, cookie, b)).folder_id, folder);
    assert.equal((await getPrompt(fx, cookie, c)).folder_id, null, '未选中的条目不得被移动');

    // 移回「未归类」
    const back = await bulk(fx, cookie, { action: 'move', ids: [a], folder_id: null });
    assert.equal(back.statusCode, 200, back.body);
    assert.equal((await getPrompt(fx, cookie, a)).folder_id, null);

    // 目标文件夹不存在 → 400（不得 500，也不得静默成功）
    const bad = await bulk(fx, cookie, { action: 'move', ids: [b], folder_id: 999_999 });
    assert.equal(bad.statusCode, 400, bad.body);
    assert.equal((bad.json() as { error: string }).error, 'invalid_body');
    assert.equal((await getPrompt(fx, cookie, b)).folder_id, folder, '非法请求不得改动数据');
  } finally {
    await fx.close();
  }
});

test('AC-78 ⑥：POST /api/prompts/bulk action=delete 删除选中条目（级联版本历史）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    const c = await newPrompt(fx, cookie, 'C');
    assert.equal(await total(fx, cookie), 3);

    const res = await bulk(fx, cookie, { action: 'delete', ids: [a, b] });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { action: 'delete', affected: 2 });
    assert.equal(await total(fx, cookie), 1);

    assert.equal(
      (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(a)}`, headers: { cookie } })).statusCode,
      404,
    );
    assert.equal(
      (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(c)}`, headers: { cookie } })).statusCode,
      200,
    );
    // 版本历史随外键级联清理
    const versions = readDb(fx, (db) =>
      db.prepare('SELECT COUNT(*) AS n FROM prompt_versions WHERE prompt_id IN (?, ?)').get(a, b),
    ) as { n: number };
    assert.equal(versions.n, 0, '被删 prompt 的版本历史必须一并清理');
  } finally {
    await fx.close();
  }
});

test('AC-78 ⑨：批量接口负例 → 400（空 ids / 重复 id / 不存在 id / 未知 action / move 缺 folder_id / 非法类型）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    const stableFavorite = (await getPrompt(fx, cookie, a)).favorite;

    const cases: Array<[string, object]> = [
      ['空 ids', { action: 'favorite', ids: [] }],
      ['重复 id', { action: 'favorite', ids: [a, a] }],
      ['不存在 id', { action: 'favorite', ids: [a, 999_999] }],
      ['未知 action', { action: 'archive', ids: [a] }],
      ['move 缺 folder_id', { action: 'move', ids: [a] }],
      ['ids 非数组', { action: 'favorite', ids: a }],
      ['ids 含非整数', { action: 'favorite', ids: ['1'] }],
      ['多余字段', { action: 'favorite', ids: [a], nope: 1 }],
    ];
    for (const [label, payload] of cases) {
      const res = await bulk(fx, cookie, payload);
      assert.equal(res.statusCode, 400, `${label}：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'invalid_body', `${label} 的 error 码`);
    }

    assert.equal((await getPrompt(fx, cookie, a)).favorite, stableFavorite, '非法请求不得改动数据');
    assert.equal(await total(fx, cookie), 2, '非法请求不得删除数据');
  } finally {
    await fx.close();
  }
});

test('AC-78：批量接口未认证 → 401（沿用现有闸门）', async () => {
  const fx = await makeFixture();
  try {
    const res = await fx.app.inject({ method: 'POST', url: '/api/prompts/bulk', payload: { action: 'delete', ids: [1] } });
    assert.equal(res.statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('AC-78 ⑧：批量操作不改动未选中的条目（同源一致：单条 GET / 列表读数一致）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    const before = await getPrompt(fx, cookie, b);

    const res = await bulk(fx, cookie, { action: 'favorite', ids: [a] });
    assert.equal(res.statusCode, 200, res.body);

    const after = await getPrompt(fx, cookie, b);
    assert.equal(after.updated_at, before.updated_at, '未选中条目的 updated_at 不得变化');
    assert.equal(after.version_no, before.version_no, '未选中条目不得产生新版本');
    assert.equal(after.favorite, before.favorite);

    // 选中条目：与单条 PUT 语义一致（版本递增 + updated_at 变化）
    const selected = await getPrompt(fx, cookie, a);
    assert.equal(selected.favorite, true);
    assert.ok(selected.version_no >= 2, '批量收藏与单条 PUT 一样留一条版本');
  } finally {
    await fx.close();
  }
});
