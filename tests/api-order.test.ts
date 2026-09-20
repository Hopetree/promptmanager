// 阶段 22 / FR-70（BRIEF v29 §4 + §8 AC-70 + §9 D-28）：
// 新增排序档 `sort=custom`（sort_order, id 升序）+ 两个落库接口
//   PATCH /api/prompts/order  body { ids: number[] }               —— 当前视图内的完整新顺序
//   PATCH /api/folders/order  body { parent_id: number|null, ids }—— 同一父级下重排
// 要求：非法（不存在 / 重复 / 空 / 跨父级）→ 400；幂等；只改 sort_order（不动 updated_at / 版本号）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function newPrompt(fx: Fixture, cookie: string, title: string): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/prompts',
    headers: { cookie },
    payload: { title, user_prompt: `正文 ${title}`, notes: `备注 ${title}` },
  });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function listIds(fx: Fixture, cookie: string, sort = 'custom'): Promise<number[]> {
  const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?sort=${sort}&limit=200`, headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { items: Array<{ id: number }> }).items.map((item) => item.id);
}

async function patchOrder(fx: Fixture, cookie: string, ids: unknown) {
  return fx.app.inject({ method: 'PATCH', url: '/api/prompts/order', headers: { cookie }, payload: { ids } });
}

test('AC-70：PATCH /api/prompts/order 按给定顺序落库，sort=custom 返回该顺序且刷新（重新查询）保持', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    const c = await newPrompt(fx, cookie, 'C');

    // 默认（updated）新条目在前 → custom 档下默认 sort_order 都是 0，按 id 升序
    assert.deepEqual(await listIds(fx, cookie), [a, b, c]);

    const reordered = [c, a, b];
    const res = await patchOrder(fx, cookie, reordered);
    assert.equal(res.statusCode, 204, res.body);
    assert.equal(res.body, '');
    assert.deepEqual(await listIds(fx, cookie), reordered, 'sort=custom 必须按 PATCH 给的顺序返回');

    // 幂等：同样顺序再来一次，结果不变
    assert.equal((await patchOrder(fx, cookie, reordered)).statusCode, 204);
    assert.deepEqual(await listIds(fx, cookie), reordered);

    // 只改 sort_order：updated_at / version_no 不动
    const before = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(a)}`, headers: { cookie } })).json() as {
      updated_at: string;
      version_no: number;
    };
    assert.equal((await patchOrder(fx, cookie, [b, c, a])).statusCode, 204);
    const after = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(a)}`, headers: { cookie } })).json() as {
      updated_at: string;
      version_no: number;
    };
    assert.equal(after.updated_at, before.updated_at, '拖拽不得改 updated_at');
    assert.equal(after.version_no, before.version_no, '拖拽不得产生新版本');
  } finally {
    await fx.close();
  }
});

test('AC-70 ⑥：非法 ids → 400（不存在的 id / 重复 id / 空数组），且不改动已有顺序', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const a = await newPrompt(fx, cookie, 'A');
    const b = await newPrompt(fx, cookie, 'B');
    assert.equal((await patchOrder(fx, cookie, [b, a])).statusCode, 204);
    const stable = await listIds(fx, cookie);
    assert.deepEqual(stable, [b, a]);

    const missing = await patchOrder(fx, cookie, [a, 999_999]);
    assert.equal(missing.statusCode, 400, missing.body);
    assert.equal((missing.json() as { error: string }).error, 'invalid_body');

    const duplicated = await patchOrder(fx, cookie, [a, a]);
    assert.equal(duplicated.statusCode, 400, duplicated.body);
    assert.equal((duplicated.json() as { error: string }).error, 'invalid_body');

    const empty = await patchOrder(fx, cookie, []);
    assert.equal(empty.statusCode, 400, empty.body);

    const wrongType = await patchOrder(fx, cookie, ['1', 2]);
    assert.equal(wrongType.statusCode, 400, wrongType.body);

    assert.deepEqual(await listIds(fx, cookie), stable, '非法请求不得改动顺序');
  } finally {
    await fx.close();
  }
});

test('AC-70：未认证访问 order 接口 → 401（沿用现有闸门）', async () => {
  const fx = await makeFixture();
  try {
    const res = await fx.app.inject({ method: 'PATCH', url: '/api/prompts/order', payload: { ids: [1] } });
    assert.equal(res.statusCode, 401);
    const folders = await fx.app.inject({
      method: 'PATCH',
      url: '/api/folders/order',
      payload: { parent_id: null, ids: [1] },
    });
    assert.equal(folders.statusCode, 401);
  } finally {
    await fx.close();
  }
});

test('AC-70 ⑤：PATCH /api/folders/order 同层级重排（持久、幂等）；跨父级 / 不存在 / 重复 → 400', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const create = async (name: string, parentId: number | null): Promise<number> => {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/folders',
        headers: { cookie },
        payload: { name, parent_id: parentId },
      });
      assert.equal(res.statusCode, 201, res.body);
      return Number((res.json() as { id: number }).id);
    };
    const f1 = await create('F1', null);
    const f2 = await create('F2', null);
    const child = await create('F1-子', f1);

    const order = async (): Promise<Array<[number, number]>> => {
      const res = await fx.app.inject({ method: 'GET', url: '/api/folders', headers: { cookie } });
      return (res.json() as { items: Array<{ id: number; sort_order: number; parent_id: number | null }> }).items
        .filter((item) => item.parent_id === null)
        .sort((x, y) => x.sort_order - y.sort_order || x.id - y.id)
        .map((item) => [item.id, item.sort_order]);
    };

    const patch = (parentId: number | null, ids: number[]) =>
      fx.app.inject({ method: 'PATCH', url: '/api/folders/order', headers: { cookie }, payload: { parent_id: parentId, ids } });

    assert.equal((await patch(null, [f2, f1])).statusCode, 204);
    assert.deepEqual((await order()).map(([id]) => id), [f2, f1]);
    assert.equal((await patch(null, [f2, f1])).statusCode, 204, '幂等');
    assert.deepEqual((await order()).map(([id]) => id), [f2, f1]);

    // 子级自己一层可以重排
    assert.equal((await patch(f1, [child])).statusCode, 204);

    // 跨父级（把子文件夹塞进根层级的 ids）→ 400
    const crossParent = await patch(null, [f2, child]);
    assert.equal(crossParent.statusCode, 400, crossParent.body);
    assert.equal((crossParent.json() as { error: string }).error, 'invalid_body');

    assert.equal((await patch(null, [f2, 999_999])).statusCode, 400);
    assert.equal((await patch(null, [f2, f2])).statusCode, 400);
    assert.deepEqual((await order()).map(([id]) => id), [f2, f1], '非法请求不得改动顺序');
  } finally {
    await fx.close();
  }
});

/** 直接读库拿全量 sort_order（AC-75 ④ 的"前后对照"要用真实槽位，接口对象里没有这个字段）。 */
function sortOrders(fx: Fixture): Array<{ id: number; folder_id: number | null; sort_order: number }> {
  return readDb(fx, (db) =>
    db
      .prepare('SELECT id, folder_id, sort_order FROM prompts ORDER BY sort_order ASC, id ASC')
      .all() as Array<{ id: number; folder_id: number | null; sort_order: number }>,
  );
}

test('AC-75 ④（FR-75 / D-30）：槽位保持 —— 目录内拖拽只在该组已占槽位间重排，其他条目 sort_order 完全不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const folderA = Number(
      (await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: 'A' } })).json().id,
    );
    const folderB = Number(
      (await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: 'B' } })).json().id,
    );
    const a1 = await newPrompt(fx, cookie, 'A1');
    const a2 = await newPrompt(fx, cookie, 'A2');
    const b1 = await newPrompt(fx, cookie, 'B1');
    const loose = await newPrompt(fx, cookie, 'L');
    // 归入目录 + 先给一个"非平凡"的全局顺序（模拟用户此前拖过）
    const setFolder = (id: number, folderId: number) =>
      fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: { cookie }, payload: { folder_id: folderId } });
    assert.equal((await setFolder(a1, folderA)).statusCode, 200);
    assert.equal((await setFolder(a2, folderA)).statusCode, 200);
    assert.equal((await setFolder(b1, folderB)).statusCode, 200);
    assert.equal((await patchOrder(fx, cookie, [b1, a1, loose, a2])).statusCode, 204);

    const before = sortOrders(fx);
    const slotsOfA = before.filter((row) => row.folder_id === folderA).map((row) => row.sort_order);
    assert.equal(slotsOfA.length, 2);

    // 在 A 目录视图里拖拽这 2 条（只提交 A 的 id）
    const res = await patchOrder(fx, cookie, [a2, a1]);
    assert.equal(res.statusCode, 204);

    const after = sortOrders(fx);
    const byId = (rows: typeof after, id: number) => rows.find((row) => row.id === id)?.sort_order;
    // ① 这 2 条只在原槽位之间交换
    assert.deepEqual(
      [byId(after, a1), byId(after, a2)].sort((x, y) => (x ?? 0) - (y ?? 0)),
      slotsOfA.slice().sort((x, y) => x - y),
      'A 组的两条必须仍占据原来那两个槽位',
    );
    assert.ok((byId(after, a2) ?? 0) < (byId(after, a1) ?? 0), '新顺序：A2 应在 A1 之前');
    // ② 其他条目完全不变
    for (const id of [b1, loose]) {
      assert.equal(byId(after, id), byId(before, id), `条目 ${String(id)}（不在 ids 里）的 sort_order 不得变化`);
    }
    // ③ 没有重复槽位
    const all = after.map((row) => row.sort_order);
    assert.equal(new Set(all).size, all.length, '不得产生重复 sort_order');
    // ④ 这 2 条没有被顶到全局最前（最前的仍是此前排第一的 b1）
    assert.equal(after[0]?.id, b1, 'A 组不得被挪到全局最前');
    // ⑤ 幂等
    assert.equal((await patchOrder(fx, cookie, [a2, a1])).statusCode, 204);
    assert.deepEqual(sortOrders(fx), after);
  } finally {
    await fx.close();
  }
});

test('AC-75 ④：全部视图下跨目录拖拽也总是生效（提交视图内完整顺序，槽位仍是全量 1..N）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const folderA = Number(
      (await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: 'A' } })).json().id,
    );
    const a1 = await newPrompt(fx, cookie, 'A1');
    const b1 = await newPrompt(fx, cookie, 'B1');
    const loose = await newPrompt(fx, cookie, 'L');
    await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(a1)}`, headers: { cookie }, payload: { folder_id: folderA } });
    assert.equal((await patchOrder(fx, cookie, [a1, b1, loose])).statusCode, 204);
    const before = sortOrders(fx);
    assert.deepEqual(before.map((row) => row.id), [a1, b1, loose]);

    // 跨目录：把未归类的 L 拖到 A1 之前（D-29 时代这是被禁的）
    assert.equal((await patchOrder(fx, cookie, [loose, a1, b1])).statusCode, 204);
    assert.deepEqual(sortOrders(fx).map((row) => row.id), [loose, a1, b1], '跨目录重排必须生效');
    assert.deepEqual(sortOrders(fx).map((row) => row.sort_order), [1, 2, 3]);
  } finally {
    await fx.close();
  }
});
