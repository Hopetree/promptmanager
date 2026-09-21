// 阶段 31 / FR-86（BRIEF v41 §4 + §8 AC-88）的**数据层**断言：每个 prompt 最多保留最近 10 个版本。
// 纪律要求：断言**直接查库**（`readDb` 拿 better-sqlite3 连接跑 `SELECT`），不能只看界面 / 只看接口回包。
// 运行时段（真实 HTTP + sqlite3 CLI 直查 + 回滚/导入/文案截图）见 tools/ac-stage31.sh 与 tools/ac-stage31-probe.mjs。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function createPrompt(fx: Fixture, cookie: string, payload: Record<string, unknown>): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function putPrompt(
  fx: Fixture,
  cookie: string,
  id: number,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: { cookie }, payload });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Record<string, unknown>;
}

/** 直查库：某个 prompt 的版本号列表（升序）。 */
function versionNos(fx: Fixture, promptId: number): number[] {
  return readDb(fx, (db) =>
    (db.prepare('SELECT version_no FROM prompt_versions WHERE prompt_id = ? ORDER BY version_no').all(promptId) as {
      version_no: number;
    }[]).map((row) => row.version_no),
  );
}

/** 直查库：某个 prompt 的 `version_no → user_prompt` 逐字对照表。 */
function versionContents(fx: Fixture, promptId: number): Array<[number, string]> {
  return readDb(fx, (db) =>
    (db
      .prepare('SELECT version_no, user_prompt FROM prompt_versions WHERE prompt_id = ? ORDER BY version_no')
      .all(promptId) as { version_no: number; user_prompt: string }[]).map(
      (row) => [row.version_no, row.user_prompt] as [number, string],
    ),
  );
}

function versionCount(fx: Fixture, promptId: number): number {
  return readDb(
    fx,
    (db) =>
      (db.prepare('SELECT COUNT(*) AS n FROM prompt_versions WHERE prompt_id = ?').get(promptId) as { n: number }).n,
  );
}

function currentVersionNo(fx: Fixture, promptId: number): number {
  return readDb(
    fx,
    (db) =>
      (db.prepare('SELECT version_no FROM prompts WHERE id = ?').get(promptId) as { version_no: number }).version_no,
  );
}

test('AC-88 ①：PUT 更新 15 次后，库里恰好剩 10 个版本（超出部分真删）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC88 十五次更新', user_prompt: '初始正文' });
    assert.deepEqual(versionNos(fx, id), [1], '新建即 v1（首版留档）');

    for (let i = 1; i <= 15; i += 1) {
      await putPrompt(fx, cookie, id, { user_prompt: `更新${String(i)}` });
    }

    // 数据层：1（首版）+ 15 次 PUT = v1..v16，保留最近的 10 个 ⇒ 7..16
    assert.equal(versionCount(fx, id), 10, 'COUNT(*) 必须恰好 10');
    assert.deepEqual(
      versionNos(fx, id),
      [7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      '保留的必须是**最新的 10 个连号**',
    );
    assert.equal(versionNos(fx, id).includes(1), false, '最旧的 v1 必须已不存在');
  } finally {
    await fx.close();
  }
});

test('AC-88 ②：建 + 14 次 PUT（共 15 版）⇒ 恰好保留 [6..15]（BRIEF 举例的形态）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC88 共十五版', user_prompt: '初始正文' });
    for (let i = 1; i <= 14; i += 1) {
      await putPrompt(fx, cookie, id, { user_prompt: `更新${String(i)}` });
    }
    assert.deepEqual(
      versionNos(fx, id),
      [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      '共 15 版 ⇒ 保留最新 10 个 = [6..15]，1..5 已删',
    );
  } finally {
    await fx.close();
  }
});

test('AC-88 ③④：当前版本在保留集内；裁剪只删行、不重编号（保留行逐字对照）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC88 不重编号', user_prompt: '初始正文' });

    // 先走到"恰好 10 行"（v1..v10），把逐字对照表存下来
    for (let i = 1; i <= 9; i += 1) {
      await putPrompt(fx, cookie, id, { user_prompt: `更新${String(i)}` });
    }
    assert.equal(versionCount(fx, id), 10, '9 次 PUT 后恰好 10 行（还没开始删）');
    const before = versionContents(fx, id);
    assert.deepEqual(before.map(([no]) => no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(before[0]?.[1], '初始正文');
    assert.equal(before[9]?.[1], '更新9');

    // 再 PUT 6 次 ⇒ v11..v16，v1..v6 应被删掉
    for (let i = 10; i <= 15; i += 1) {
      await putPrompt(fx, cookie, id, { user_prompt: `更新${String(i)}` });
    }
    const after = versionContents(fx, id);
    assert.deepEqual(after.map(([no]) => no), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    // ④ 不重编号：**逐字对照** —— 重叠的 v7..v10 在裁剪前后 (version_no, user_prompt) 完全一致
    const overlap = new Map(after.filter(([no]) => no <= 10));
    for (const [no, text] of before.filter(([n]) => n >= 7)) {
      assert.equal(overlap.get(no), text, `v${String(no)} 的正文在裁剪后必须一字不变（证明只删行、没重编号）`);
    }
    assert.deepEqual(
      before.filter(([no]) => no >= 7),
      after.filter(([no]) => no <= 10),
      '重叠区间的 (version_no, 正文) 列表必须逐字相等',
    );

    // ③ 当前版本在保留集合内
    const current = currentVersionNo(fx, id);
    assert.equal(current, 16);
    assert.ok(versionNos(fx, id).includes(current), `当前版本 v${String(current)} 必须在保留集合内`);
  } finally {
    await fx.close();
  }
});

test('AC-88 ⑤：回滚已存在的版本 → 生成新版本且仍 ≤10；回滚已被裁剪的版本 → 404', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC88 回滚两态', user_prompt: '初始正文' });
    for (let i = 1; i <= 15; i += 1) {
      await putPrompt(fx, cookie, id, { user_prompt: `更新${String(i)}` });
    }
    assert.deepEqual(versionNos(fx, id), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    // ① 回滚到**仍存在**的 v12 → 200 + 新版本 v17 + 仍恰好 10 行（v8..v17）
    const ok = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/12/rollback`,
      headers: { cookie },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((ok.json() as { version_no: number }).version_no, 17, '回滚要生成新版本');
    assert.equal(versionCount(fx, id), 10, '回滚后仍恰好 10 行');
    assert.deepEqual(versionNos(fx, id), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

    // ② 回滚到**已被裁剪掉**的 v1 → 404（既有语义不变）
    const gone = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/1/rollback`,
      headers: { cookie },
    });
    assert.equal(gone.statusCode, 404, gone.body);
    assert.deepEqual(versionNos(fx, id), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17], '404 那次不得改动版本表');
  } finally {
    await fx.close();
  }
});

test('AC-88 ⑥：导入含 15 个版本的文件 → 最终 ≤10（replace 与 merge 都裁）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const versions = Array.from({ length: 15 }, (_, index) => ({
      version_no: index + 1,
      title: 'AC88 导入夹具',
      user_prompt: `导入版${String(index + 1)}`,
      system_prompt: '',
      notes: '',
      created_at: '2026-09-21T00:00:00.000Z',
    }));
    const data = {
      app: 'promptmanager',
      schema_version: 1,
      exported_at: '2026-09-21T00:00:00.000Z',
      folders: [],
      tags: [],
      prompts: [
        {
          id: 42,
          title: 'AC88 导入夹具',
          user_prompt: '导入版15',
          system_prompt: '',
          notes: '',
          folder_id: null,
          tags: [],
          favorite: false,
          created_at: '2026-09-21T00:00:00.000Z',
          updated_at: '2026-09-21T00:00:00.000Z',
          versions,
        },
      ],
    };

    for (const mode of ['replace', 'merge'] as const) {
      const res = await fx.app.inject({ method: 'POST', url: '/api/import', headers: { cookie }, payload: { mode, data } });
      assert.equal(res.statusCode, 200, `${mode}: ${res.body}`);
      // replace 保留文件里的 id（=42）；merge 一律新建、分配新 id（取当前最大 id）
      const actualId =
        mode === 'replace'
          ? 42
          : readDb(
              fx,
              (db) => (db.prepare('SELECT MAX(id) AS id FROM prompts').get() as { id: number }).id,
            );
      assert.equal(versionCount(fx, actualId), 10, `${mode}：导入 15 个版本后必须恰好留 10 个`);
      assert.deepEqual(
        versionNos(fx, actualId),
        [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        `${mode}：保留最新 10 个（v1..v5 被裁）`,
      );
      assert.equal(currentVersionNo(fx, actualId), 15, `${mode}：prompts.version_no 仍指向文件里的最大版本号`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-88 ⑦：边界 —— 恰好 10 个不删；产生第 11 个时只删最旧的那一个', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC88 边界', user_prompt: '初始正文' });

    // 恰好 10 个：1（首版）+ 9 次 PUT ⇒ v1..v10
    for (let i = 1; i <= 9; i += 1) {
      await putPrompt(fx, cookie, id, { user_prompt: `更新${String(i)}` });
    }
    assert.equal(versionCount(fx, id), 10, '恰好 10 个时不得删除');
    assert.deepEqual(versionNos(fx, id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // 第 11 个 ⇒ 只删 v1
    await putPrompt(fx, cookie, id, { user_prompt: '更新10' });
    assert.equal(versionCount(fx, id), 10, '第 11 个版本后仍是 10 个');
    assert.deepEqual(versionNos(fx, id), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], '只删最旧的 v1');
  } finally {
    await fx.close();
  }
});

test('AC-88 回归：版本列表 / diff / 回滚 / 批量操作 都不产生"超过 10 个"的数据', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, { title: 'AC88 批量写入点', user_prompt: '初始正文' });

    // 批量收藏（FR-77）也是"产生新版本"的写入点 —— 走 12 次批量收藏，仍不得突破 10
    for (let i = 0; i < 12; i += 1) {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/prompts/bulk',
        headers: { cookie },
        payload: { action: 'favorite', ids: [id] },
      });
      assert.equal(res.statusCode, 200, res.body);
    }
    assert.equal(versionCount(fx, id), 10, '批量收藏 12 次后仍恰好 10 个版本');
    assert.equal(currentVersionNo(fx, id), 13, '首版 + 12 次批量 = v13');

    // 版本列表接口只回 ≤10 条，且是升序
    const list = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/versions`, headers: { cookie } });
    assert.equal(list.statusCode, 200, list.body);
    const items = (list.json() as { items: { version_no: number }[] }).items;
    assert.equal(items.length, 10);
    assert.deepEqual(items.map((item) => item.version_no), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

    // diff 仍可用（保留集内两版）
    const diff = await fx.app.inject({
      method: 'GET',
      url: `/api/prompts/${String(id)}/diff?from=4&to=13`,
      headers: { cookie },
    });
    assert.equal(diff.statusCode, 200, diff.body);
    assert.ok((diff.json() as { diff: string }).diff.length > 0);

    // 越界（已被裁剪的 v1）仍按既有语义 400
    const outOfRange = await fx.app.inject({
      method: 'GET',
      url: `/api/prompts/${String(id)}/diff?from=1&to=13`,
      headers: { cookie },
    });
    assert.equal(outOfRange.statusCode, 400, outOfRange.body);
  } finally {
    await fx.close();
  }
});
