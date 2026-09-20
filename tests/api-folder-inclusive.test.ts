// 阶段 23 / FR-72 / D-29（BRIEF v30 §4 + §8 AC-72）：文件夹筛选 = **含全部后代**（与侧栏计数同口径）。
// 覆盖：三层 A>B>C 的 total/id 集合、组合 tag/q、分页、负例（不存在 id → 200 total=0；非法 → 400）、三种排序档。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function newFolder(fx: Fixture, cookie: string, name: string, parentId: number | null): Promise<number> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/folders',
    headers: { cookie },
    payload: { name, parent_id: parentId },
  });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function newPrompt(
  fx: Fixture,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function list(fx: Fixture, cookie: string, query: string) {
  const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?${query}`, headers: { cookie } });
  return { status: res.statusCode, body: res.json() as { total: number; items: Array<{ id: number }> } };
}

/** 三层夹具 A > B > C：A/B/C 各 1 条 + 1 条未归类；只有 B 里的那条带标签「T」。 */
async function threeLevelFixture() {
  const fx = await makeFixture();
  const cookie = cookieOf(await login(fx.app));
  const a = await newFolder(fx, cookie, 'A', null);
  const b = await newFolder(fx, cookie, 'B', a);
  const c = await newFolder(fx, cookie, 'C', b);
  const inA = await newPrompt(fx, cookie, { title: 'A 里的', user_prompt: '甲', folder_id: a });
  const inB = await newPrompt(fx, cookie, {
    title: 'B 里的',
    user_prompt: '乙',
    folder_id: b,
    tags: ['T'],
  });
  const inC = await newPrompt(fx, cookie, { title: 'C 里的', user_prompt: '丙', folder_id: c });
  const loose = await newPrompt(fx, cookie, { title: '未归类', user_prompt: '丁' });
  return { fx, cookie, a, b, c, inA, inB, inC, loose };
}

test('AC-72 ②③④：三层 A>B>C 的 folder_id 筛选含全部后代（total 与 items 一致）', async () => {
  const { fx, cookie, a, b, c, inA, inB, inC } = await threeLevelFixture();
  try {
    const root = await list(fx, cookie, `folder_id=${String(a)}&limit=200`);
    assert.equal(root.status, 200);
    assert.equal(root.body.total, 3, '父目录 A 应含 A/B/C 三条');
    assert.deepEqual(
      root.body.items.map((item) => item.id).sort((x, y) => x - y),
      [inA, inB, inC].sort((x, y) => x - y),
      'items 的 id 集合 = A/B/C 三条',
    );
    assert.equal(root.body.items.length, root.body.total, 'total 必须与实际 items 一致');

    const mid = await list(fx, cookie, `folder_id=${String(b)}&limit=200`);
    assert.equal(mid.body.total, 2, 'B 应含 B/C 两条');
    assert.deepEqual(mid.body.items.map((item) => item.id).sort((x, y) => x - y), [inB, inC].sort((x, y) => x - y));

    const leaf = await list(fx, cookie, `folder_id=${String(c)}&limit=200`);
    assert.equal(leaf.body.total, 1, 'C 只有自己那条');
    assert.deepEqual(leaf.body.items.map((item) => item.id), [inC]);

    // 缺省 / null = 全部（语义不变）
    const all = await list(fx, cookie, 'limit=200');
    assert.equal(all.body.total, 4);
    const loose = await list(fx, cookie, 'folder_id=null&limit=200');
    assert.equal(loose.status, 400, 'folder_id=null 仍是非法值（400），"全部"= 不传该参数');
  } finally {
    await fx.close();
  }
});

test('AC-72 ⑥⑦：组合 tag / q 同样 inclusive；分页 total 正确', async () => {
  const { fx, cookie, a, b } = await threeLevelFixture();
  try {
    const byTag = await list(fx, cookie, `folder_id=${String(a)}&tag=T&limit=200`);
    assert.equal(byTag.body.total, 1, 'A 视图 + tag=T 只命中 B 里那条（子目录也参与）');

    const byQ = await list(fx, cookie, `folder_id=${String(a)}&q=${encodeURIComponent('乙')}&limit=200`);
    assert.equal(byQ.body.total, 1, 'A 视图 + q=乙（<3 码点走 LIKE 兜底）命中 B 里那条');

    const byQLong = await list(fx, cookie, `folder_id=${String(a)}&q=${encodeURIComponent('B 里的')}&limit=200`);
    assert.equal(byQLong.body.total, 1, '≥3 码点走 FTS5 路径同样 inclusive');

    const page1 = await list(fx, cookie, `folder_id=${String(a)}&limit=2`);
    assert.equal(page1.body.items.length, 2);
    assert.equal(page1.body.total, 3, '分页时 total 仍是命中总数');
    const page2 = await list(fx, cookie, `folder_id=${String(a)}&limit=2&offset=2`);
    assert.equal(page2.body.items.length, 1, '第二页 1 条');

    // 三种排序档都照常生效（只断言"仍 inclusive"，排序细节由各档自己的测试覆盖）
    for (const sort of ['updated', 'recent_used', 'custom']) {
      const res = await list(fx, cookie, `folder_id=${String(b)}&sort=${sort}&limit=200`);
      assert.equal(res.body.total, 2, `sort=${sort} 时仍 inclusive`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-72 ⑧：负例 —— 不存在的 folder_id → 200 且 total=0（不 500）；非法值 → 400', async () => {
  const { fx, cookie } = await threeLevelFixture();
  try {
    const missing = await list(fx, cookie, 'folder_id=987654&limit=200');
    assert.equal(missing.status, 200, '不存在的文件夹不是错误，只是没有命中');
    assert.equal(missing.body.total, 0);
    assert.deepEqual(missing.body.items, []);

    for (const bad of ['folder_id=abc', 'folder_id=-1', 'folder_id=0']) {
      const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?${bad}`, headers: { cookie } });
      assert.equal(res.statusCode, 400, `${bad} 应 400`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-72：深层递归（5 层）也 inclusive，且不把无关分支算进来', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const l1 = await newFolder(fx, cookie, 'L1', null);
    const l2 = await newFolder(fx, cookie, 'L2', l1);
    const l3 = await newFolder(fx, cookie, 'L3', l2);
    const l4 = await newFolder(fx, cookie, 'L4', l3);
    const l5 = await newFolder(fx, cookie, 'L5', l4);
    const other = await newFolder(fx, cookie, 'Other', null);
    const deep = await newPrompt(fx, cookie, { title: '最深', user_prompt: '深', folder_id: l5 });
    await newPrompt(fx, cookie, { title: '别的分支', user_prompt: '别', folder_id: other });

    const res = await list(fx, cookie, `folder_id=${String(l1)}&limit=200`);
    assert.equal(res.body.total, 1);
    assert.deepEqual(res.body.items.map((item) => item.id), [deep]);

    const otherRes = await list(fx, cookie, `folder_id=${String(other)}&limit=200`);
    assert.equal(otherRes.body.total, 1, '无关分支不得被算进 L1');
  } finally {
    await fx.close();
  }
});
