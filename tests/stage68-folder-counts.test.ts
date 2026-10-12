// 阶段 68 / FR-141（AC-130 ⑥⑦⑧）：文件夹计数从「N+1 次请求」变成「跟着列表一次带回」。
//
// 口径的硬要求（D-66 ③）：**数字必须逐个文件夹与改前相同**。改前的数字 = 前端对每个文件夹各发一次
// `GET /api/prompts?folder_id=N&limit=1` 取回来的 `total`（而 `listPrompts` 会把 folderId 展开成
// 「自身 + 全部后代」）⇒ 这里就**照旧口径把那 N 次请求真的发一遍**，再与新接口的 `folder_counts` 逐项比对。
//
// 失败注入（AC-130 ⑧）：把 `folders` 表删掉，让计数 SQL 报错 —— 列表仍必须 200，`folder_counts` 是 `null`
// （前端据此保留上一次的数字，筛选不被阻塞）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

interface PromptLite {
  id: number;
}

function makePrompt(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    title: '计数夹具',
    user_prompt: '正文',
    system_prompt: '',
    notes: '',
    folder_id: null,
    tags: [],
    ...payload,
  };
}

test('AC-130 ⑥⑦：一次请求带回全部文件夹的条目数，且逐个与旧口径（?folder_id=N 的 total）相同', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));

    const create = async (url: string, payload: Record<string, unknown>): Promise<number> => {
      const response = await fx.app.inject({ method: 'POST', url, headers: { cookie }, payload });
      assert.equal(response.statusCode, 201, `${url} 应 201（实测 ${String(response.statusCode)}）`);
      return (response.json() as { id: number }).id;
    };

    // 三层文件夹：根 → 子 → 孙；另一个独立的根
    const root = await create('/api/folders', { name: '根甲' });
    const child = await create('/api/folders', { name: '子甲', parent_id: root });
    const grand = await create('/api/folders', { name: '孙甲', parent_id: child });
    const other = await create('/api/folders', { name: '根乙' });

    // 根 3 条（自己 1 + 子 1 + 孙 1）、子 2 条、孙 1 条、根乙 0 条、未归类 2 条
    await create('/api/prompts', makePrompt({ title: '根直挂', folder_id: root }));
    await create('/api/prompts', makePrompt({ title: '子直挂', folder_id: child }));
    await create('/api/prompts', makePrompt({ title: '孙直挂', folder_id: grand }));
    await create('/api/prompts', makePrompt({ title: '未归类一' }));
    await create('/api/prompts', makePrompt({ title: '未归类二' }));

    const listOnce = await fx.app.inject({
      method: 'GET',
      url: '/api/prompts?limit=1&include=folder_counts',
      headers: { cookie },
    });
    assert.equal(listOnce.statusCode, 200);
    const body = listOnce.json() as { total: number; folder_counts?: Record<string, number> | null };
    assert.equal(body.total, 5, '列表只取 limit=1，但 total 仍是全部 5 条');
    assert.notEqual(body.folder_counts, undefined, '请求里带了 include=folder_counts ⇒ 响应必须有这个键');

    // 旧口径：对每个文件夹各发一次 ?folder_id=N&limit=1，只取 total
    const legacy: Record<string, number> = {};
    for (const id of [root, child, grand, other]) {
      const one = await fx.app.inject({
        method: 'GET',
        url: `/api/prompts?folder_id=${String(id)}&limit=1`,
        headers: { cookie },
      });
      assert.equal(one.statusCode, 200);
      legacy[String(id)] = (one.json() as { total: number }).total;
    }

    assert.deepEqual(body.folder_counts, { [String(root)]: 3, [String(child)]: 2, [String(grand)]: 1, [String(other)]: 0 });
    assert.deepEqual(body.folder_counts, legacy, '新接口的数字必须与旧的 N 次请求逐个相同（AC-130 ⑦）');

    // 不请求就不带这个键（对老客户端响应形状一字不变）
    const plain = await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } });
    assert.equal(plain.statusCode, 200);
    assert.equal('folder_counts' in (plain.json() as object), false, '没带 include ⇒ 响应不得多出 folder_counts');
    assert.equal(
      (plain.json() as { total: number }).total,
      5,
      '不带 include 的列表照旧可用（items/total/limit/offset 一字不变）',
    );
  } finally {
    await fx.close();
  }
});

test('AC-130 ⑧：计数失败（folders 表没了）仍返回 200、folder_counts 为 null，列表内容不受影响', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: makePrompt({ title: '失败注入夹具' }),
    });
    assert.equal(created.statusCode, 201);

    // 把计数依赖的表删掉 ⇒ countPromptsByFolder 必然报错（模拟"计数这一步坏了"）
    readDb(fx, (db) => {
      db.exec('DROP TABLE folders');
    });

    const response = await fx.app.inject({
      method: 'GET',
      url: '/api/prompts?include=folder_counts',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, '计数失败不得把列表也搞成 500（既有行为：不阻塞筛选）');
    const body = response.json() as { total: number; items: PromptLite[]; folder_counts?: unknown };
    assert.equal(body.folder_counts, null, '计数失败 ⇒ folder_counts 是 null（前端保留旧数字）');
    assert.equal(body.total, 1, '列表本身照常返回');
    assert.equal(body.items.length, 1);
  } finally {
    await fx.close();
  }
});
