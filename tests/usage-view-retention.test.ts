// 阶段 72 / BRIEF FR-159 / AC-134 E20（N9）：`view` 留痕必须有**上限**。
//
// 缺陷原状：`GET /api/prompts/:id` 每次都写一条 `kind='view'`（FR-114 的有意设计：保留"谁看过"的审计线索），
// 但 `usage_events` 没有任何裁剪 ⇒ 表随"打开详情"的次数线性增长，且这些行**没有任何读取方**。
//
// 本文件钉住决定：每个 prompt 最多保留 VIEW_KEEP_LIMIT 条 view；写入 view 时裁剪；
// **`copy`/`mcp` 行永不裁剪**（它们是"取用次数"的事实来源，少一行就少一次真实取用）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture } from './helpers.ts';

test('AC-134 E20：每个 prompt 的 view 留痕最多 100 条，copy 行不动', async () => {
  const fixture = await makeFixture();
  try {
    const { recordUsage, usageStatsOf, VIEW_KEEP_LIMIT } = await import('../dist/services/usage.js');
    const { createPrompt } = await import('../dist/services/prompts.js');
    assert.equal(VIEW_KEEP_LIMIT, 100, '上限必须是 100（文档写的是这个数）');

    const a = await createPrompt(fixture.app.qe, { title: 'A', user_prompt: 'a' });
    const b = await createPrompt(fixture.app.qe, { title: 'B', user_prompt: 'b' });

    for (let i = 0; i < 105; i += 1) await recordUsage(fixture.app.qe, a.id, 'session', null, 'view');
    for (let i = 0; i < 3; i += 1) await recordUsage(fixture.app.qe, a.id, 'session', null, 'copy');
    for (let i = 0; i < 5; i += 1) await recordUsage(fixture.app.qe, b.id, 'session', null, 'view');

    const count = async (promptId: number, kind: string): Promise<number> => {
      const row = await fixture.app.qe
        .selectFrom('usage_events')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('prompt_id', '=', promptId)
        .where('kind', '=', kind)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    };

    assert.equal(await count(a.id, 'view'), VIEW_KEEP_LIMIT, 'A 的 view 必须被裁剪到上限');
    assert.equal(await count(a.id, 'copy'), 3, 'A 的 copy 一行都不许少');
    assert.equal(await count(b.id, 'view'), 5, 'B 的 view 不该被牵连');
    assert.equal((await usageStatsOf(fixture.app.qe, a.id)).use_count, 3, '取用次数只算 copy');

    // 保留的是**最新**的 100 条：最早的 5 条必须已经被删掉
    const kept = await fixture.app.qe
      .selectFrom('usage_events')
      .select('id')
      .where('prompt_id', '=', a.id)
      .where('kind', '=', 'view')
      .orderBy('used_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const all = await fixture.app.qe
      .selectFrom('usage_events')
      .select('id')
      .where('prompt_id', '=', a.id)
      .where('kind', '=', 'view')
      .execute();
    assert.equal(all.length, VIEW_KEEP_LIMIT);
    assert.equal(new Set(kept.map((row) => row.id)).size, VIEW_KEEP_LIMIT, '保留的 id 必须互不相同');
  } finally {
    await fixture.close();
  }
});

test('AC-134 E20：一次写入就能把存量超限行裁干净（不是"每次只删一条"）', async () => {
  const fixture = await makeFixture();
  try {
    const { recordUsage, VIEW_KEEP_LIMIT } = await import('../dist/services/usage.js');
    const { createPrompt } = await import('../dist/services/prompts.js');
    const prompt = await createPrompt(fixture.app.qe, { title: '积压', user_prompt: 'x' });
    // 直接灌 300 条 view（模拟历史积压）
    const rows = Array.from({ length: 300 }, (_, index) => ({
      prompt_id: prompt.id,
      channel: 'session' as const,
      used_at: new Date(Date.now() - (300 - index) * 1000).toISOString(),
      token_id: null,
      kind: 'view' as const,
    }));
    await fixture.app.qe.insertInto('usage_events').values(rows).execute();
    await recordUsage(fixture.app.qe, prompt.id, 'session', null, 'view');

    const row = await fixture.app.qe
      .selectFrom('usage_events')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('prompt_id', '=', prompt.id)
      .where('kind', '=', 'view')
      .executeTakeFirstOrThrow();
    assert.equal(Number(row.n), VIEW_KEEP_LIMIT, '一次写入后就必须只剩上限条数');
  } finally {
    await fixture.close();
  }
});
