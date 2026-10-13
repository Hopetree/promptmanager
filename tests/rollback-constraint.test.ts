// 阶段 72 / BRIEF FR-158 / AC-134 D15·D17（N6）：`rollbackToVersion` 的**读-算-写同事务** + **约束分类**。
//
// 缺陷原状：`current`（version_no/updated_at/四字段）在事务**外**读，`nextVersionNo` 也在事务外算，
// 事务里才写 ⇒ 两个回滚并发时都算出同一个 `version_no`，后到者撞 `prompt_versions` 的唯一约束，
// 抛的是裸 `SqliteError: UNIQUE constraint failed: prompt_versions.prompt_id, prompt_versions.version_no`
// （HTTP 500）。而同一仓库的 `updatePrompt`（FR-135）早就用 `constraintKind()` 把这类冲突分派成
// **可分类的 4xx** —— 本文件钉住"同一套口径"。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource, stripSourceComments } from './source-text.ts';

test('AC-134 D15：回滚撞版本号唯一约束 ⇒ 可分类的 400（不是 500，也不带裸 SQLite 文本）', async () => {
  const fixture = await makeFixture();
  try {
    const { createPrompt, updatePrompt } = await import('../dist/services/prompts.js');
    const { rollbackToVersion } = await import('../dist/services/versions.js');
    const created = await createPrompt(fixture.app.qe, { title: '回滚夹具', user_prompt: 'v1 正文' });
    const updated = await updatePrompt(fixture.app.qe, created.id, { user_prompt: 'v2 正文' });
    assert.equal(updated.version_no, 2, '前置：应产生 v2');

    // 人为占掉"回滚将要写入的版本号"：模拟并发回滚里先到者的那次写入
    await fixture.app.qe
      .insertInto('prompt_versions')
      .values({
        prompt_id: created.id,
        version_no: 3,
        title: updated.title,
        user_prompt: '并发者的 v3',
        system_prompt: updated.system_prompt,
        notes: updated.notes,
        created_at: new Date().toISOString(),
      })
      .execute();

    // 服务层：必须是分类后的 InvalidBodyError（可重试），不是裸 SqliteError
    await assert.rejects(
      () => rollbackToVersion(fixture.app.qe, created.id, 1),
      (error: unknown) => {
        // InvalidBodyError 的 message 恒为 'invalid_body'，给用户看的文本在 details 里
        const details = error instanceof Error && 'details' in error ? JSON.stringify((error as { details: unknown }).details) : '';
        assert.equal(error instanceof Error ? error.constructor.name : '', 'InvalidBodyError', `实际：${details}`);
        assert.match(details, /重试/, '字段级说明要告诉用户"可以重试"');
        assert.doesNotMatch(details, /SQLITE|constraint failed|UNIQUE/i, `不许带裸 SQLite 文本：${details}`);
        return true;
      },
    );

    // 路由层：同一场景必须是 400 invalid_body（500 说明没分类）
    const cookie = cookieOf(await login(fixture.app));
    const response = await fixture.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(created.id)}/versions/1/rollback`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 400, `回滚冲突应是 400，实际 ${String(response.statusCode)}`);
    const body = response.json() as { error: string; details?: Array<{ message: string }> };
    assert.equal(body.error, 'invalid_body');
    assert.doesNotMatch(JSON.stringify(body), /SQLITE|constraint failed|UNIQUE/i, '响应体不许带裸 SQLite 文本');
  } finally {
    await fixture.close();
  }
});

test('AC-134 D15：回滚的读-算-写在同一个事务里（读码证据）', () => {
  const source = stripSourceComments(readSource('src/services/versions.ts'));
  const start = source.indexOf('export async function rollbackToVersion');
  const end = source.indexOf('const prompt = await getPrompt(qe, promptId);');
  assert.ok(start > 0 && end > start, '找不到 rollbackToVersion（源码结构变了？）');
  const block = source.slice(start, end);
  const transactionAt = block.indexOf('qe.transaction()');
  const readAt = block.indexOf(".selectFrom('prompts')");
  assert.ok(transactionAt > 0, '回滚必须开事务');
  assert.ok(readAt > 0, '回滚必须读当前行');
  assert.ok(
    readAt > transactionAt,
    '读当前行（version_no/内容）必须在事务内 —— 否则并发回滚会算出同一个 version_no',
  );
  assert.match(block, /constraintKind\(/, '冲突必须走既有 constraintKind 分类（不许另造一套）');
});

test('AC-134 D15：与 updatePrompt 用的是同一套分类设施（对照证据）', () => {
  const versions = stripSourceComments(readSource('src/services/versions.ts'));
  const prompts = stripSourceComments(readSource('src/services/prompts.ts'));
  for (const [name, source] of [
    ['versions.ts', versions],
    ['prompts.ts', prompts],
  ] as const) {
    assert.match(source, /import \{[^}]*constraintKind[^}]*\} from '\.\.\/errors\.js'/, `${name} 必须从 errors.js 引入 constraintKind`);
    assert.match(source, /constraintKind\(/, `${name} 必须真的调用它`);
  }
});
