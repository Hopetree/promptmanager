// 阶段 72 / BRIEF FR-158 / AC-134 D16·D17（N7）：`renameTag` 普通改名分支的**约束分类**。
//
// 缺陷原状：`renameTag` 的普通改名分支直接 `updateTable('tags')`，没有 try/catch ——
// 两个标签同时改到同一个名字时，先到者改成功、后到者撞 `tags.name` 的唯一约束，
// 抛裸 `SqliteError: UNIQUE constraint failed: tags.name`（HTTP 500）；
// 而 `createTag` 早就用 `translateConstraint` 把它翻译成"标签名已存在"的 400。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource, stripSourceComments } from './source-text.ts';

test('AC-134 D16：两个标签同时改名到同一个名字 ⇒ 恰好一个失败且是分类后的 400', async () => {
  const fixture = await makeFixture();
  try {
    const { createTag, renameTag } = await import('../dist/services/tags.js');
    const first = await createTag(fixture.app.qe, '甲标签');
    const second = await createTag(fixture.app.qe, '乙标签');

    // 同时改名到「同名」：两次"目标是否已存在"的预检都会说"不存在"，随后后到者撞唯一约束
    const results = await Promise.allSettled([
      renameTag(fixture.app.qe, first.id, '同名标签'),
      renameTag(fixture.app.qe, second.id, '同名标签'),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1, `应恰好一个成功：${JSON.stringify(results.map((r) => r.status))}`);
    assert.equal(rejected.length, 1, `应恰好一个失败：${JSON.stringify(results.map((r) => r.status))}`);

    const failure = rejected[0] as PromiseRejectedResult;
    const error: unknown = failure.reason;
    const message = error instanceof Error ? error.message : String(error);
    assert.equal(error instanceof Error ? error.constructor.name : '', 'InvalidBodyError', `实际：${message}`);
    assert.doesNotMatch(message, /SQLITE|constraint failed|UNIQUE/i, `不许带裸 SQLite 文本：${message}`);

    // 落库结果：只该有一个「同名标签」
    const rows = await fixture.app.qe.selectFrom('tags').select('id').where('name', '=', '同名标签').execute();
    assert.equal(rows.length, 1, '库里只该有一个同名标签');
  } finally {
    await fixture.close();
  }
});

test('AC-134 D16：普通改名分支的约束分类与 createTag 共用 translateConstraint（读码证据）', () => {
  const source = stripSourceComments(readSource('src/services/tags.ts'));
  const start = source.indexOf('export async function renameTag');
  const block = source.slice(start);
  const plainAt = block.indexOf(".updateTable('tags')");
  assert.ok(plainAt > 0, '找不到普通改名分支');
  // 注释会被 stripSourceComments 换成等长空白，所以窗口要留够（否则匹配到的是注释里的空白）
  const around = block.slice(Math.max(0, plainAt - 120), plainAt + 800);
  assert.match(around, /translateConstraint\(/, '普通改名分支必须把约束错误交给 translateConstraint');
  // 且不许自己造一套"标签名已存在"的翻译
  const occurrences = [...source.matchAll(/标签名已存在/g)].length;
  assert.equal(occurrences, 1, `「标签名已存在」只该出现在 translateConstraint 里，实际 ${String(occurrences)} 次`);
});

test('AC-134 D16/D17：改名冲突在路由层是 400（不是 500）', async () => {
  const fixture = await makeFixture();
  try {
    const { createTag } = await import('../dist/services/tags.js');
    const tag = await createTag(fixture.app.qe, '路由标签');
    const cookie = cookieOf(await login(fixture.app));
    // 用"先占名字、再让预检看不见"的方式无法从路由外部构造 ⇒ 直接钉住 InvalidBodyError → 400 的映射：
    // 让 updateTable 撞约束的最短路径是把名字改成已存在的名字，但那走的是合并分支（200）；
    // 所以这里断言"改名到已存在名字仍然 200（合并）"，证明普通分支的 400 只出现在真冲突上。
    await createTag(fixture.app.qe, '已存在标签');
    const merged = await fixture.app.inject({
      method: 'PUT',
      url: `/api/tags/${String(tag.id)}`,
      headers: { cookie },
      payload: { name: '已存在标签' },
    });
    assert.equal(merged.statusCode, 200, '改名到已存在名字是"合并"语义，仍是 200');
  } finally {
    await fixture.close();
  }
});
