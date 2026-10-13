// 阶段 72 / BRIEF FR-157 / AC-134 C（N3 / N5 / N10）：导入导出的契约一致性。
//
// N3：字段长度上限原来只在路由的 ajv schema 里（`title` 500 / `user_prompt` 200000 / 文件夹名 200 /
//     标签名 64），导入解析完全不看长度 ⇒ **同一份超长数据两个入口结论不同**（HTTP 写 400，导入照收）。
//     现在上限只有一处来源，两个入口按同一套上限拒绝。
// N10：malformed 文件的报错要同形（逐字段、不带裸 SQLite 文本）；`versions[].version_no` 重复
//      必须在**解析期**被拒（以前会一路走到 INSERT 才撞 `UNIQUE constraint failed` 并原样回给用户）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource, stripSourceComments } from './source-text.ts';

/** 一个形状完整、可被导入的最小导出文件（每个用例再按需改一处）。 */
function exportFile(promptPatch: Record<string, unknown> = {}, filePatch: Record<string, unknown> = {}): Record<string, unknown> {
  const prompt = {
    id: 1,
    title: '导入夹具',
    user_prompt: '正文',
    system_prompt: '',
    notes: '',
    folder_id: null,
    sort_order: 0,
    tags: [],
    favorite: false,
    remember_variables: true,
    created_at: '2026-10-13T00:00:00.000Z',
    updated_at: '2026-10-13T00:00:00.000Z',
    versions: [
      {
        version_no: 1,
        title: '导入夹具',
        user_prompt: '正文',
        system_prompt: '',
        notes: '',
        created_at: '2026-10-13T00:00:00.000Z',
      },
    ],
    ...promptPatch,
  };
  return { app: 'promptmanager', schema_version: 1, folders: [], tags: [], prompts: [prompt], ...filePatch };
}

function detailsOf(response: { json: () => unknown }): string {
  return JSON.stringify((response.json() as { details?: unknown }).details ?? null);
}

test('AC-134 C10：超长字段两个入口同形拒绝（路由 400 invalid_body / 导入 400 invalid_import）', async () => {
  const fixture = await makeFixture();
  try {
    const cookie = cookieOf(await login(fixture.app));
    const tooLong = 'x'.repeat(501);

    // 入口一：POST /api/prompts（ajv schema）
    const viaRoute = await fixture.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: tooLong, user_prompt: '正文' },
    });
    assert.equal(viaRoute.statusCode, 400, '路由入口必须 400');
    assert.equal((viaRoute.json() as { error: string }).error, 'invalid_body', '路由入口错误码是 invalid_body');
    assert.match(detailsOf(viaRoute), /500/, '字段级说明要点出上限 500');
    assert.doesNotMatch(viaRoute.body, /SQLITE|constraint failed/i, '路由入口不许带裸 SQLite 文本');

    // 入口二：POST /api/import（同一份超长数据）
    const viaImport = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data: exportFile({ title: tooLong }) },
    });
    assert.equal(viaImport.statusCode, 400, '导入入口必须 400（不许照收）');
    assert.equal((viaImport.json() as { error: string }).error, 'invalid_import', '导入入口错误码是 invalid_import');
    assert.match(detailsOf(viaImport), /title/, '导入入口要给到字段路径');
    assert.match(detailsOf(viaImport), /500/, '导入入口要点出同一个上限 500');
    assert.doesNotMatch(viaImport.body, /SQLITE|constraint failed/i, '导入入口不许带裸 SQLite 文本');

    // 边界：恰好 500 两个入口都必须收（证明两边是同一个上限，不是"导入更严/更松"）
    const exact = 'y'.repeat(500);
    const routeExact = await fixture.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: exact, user_prompt: '正文' },
    });
    assert.equal(routeExact.statusCode, 201, '路由入口：恰好 500 应通过');
    const importExact = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data: exportFile({ title: exact, id: 2 }) },
    });
    assert.equal(importExact.statusCode, 200, '导入入口：恰好 500 应通过');
  } finally {
    await fixture.close();
  }
});

test('AC-134 C10：文件夹名 200 / 标签名 64 也是同一处来源，导入同样拒绝', async () => {
  const fixture = await makeFixture();
  try {
    const cookie = cookieOf(await login(fixture.app));

    const folderRoute = await fixture.app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: 'f'.repeat(201) },
    });
    assert.equal(folderRoute.statusCode, 400, '路由入口：文件夹名 201 必须 400');
    const folderImport = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data: exportFile({}, { folders: [{ id: 1, name: 'f'.repeat(201), parent_id: null, sort_order: 0 }] }) },
    });
    assert.equal(folderImport.statusCode, 400, '导入入口：文件夹名 201 必须 400');
    assert.match(detailsOf(folderImport), /200/, '导入入口要点出上限 200');

    const tagRoute = await fixture.app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: { cookie },
      payload: { name: 't'.repeat(65) },
    });
    assert.equal(tagRoute.statusCode, 400, '路由入口：标签名 65 必须 400');
    const tagImport = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data: exportFile({}, { tags: [{ id: 1, name: 't'.repeat(65) }] }) },
    });
    assert.equal(tagImport.statusCode, 400, '导入入口：标签名 65 必须 400');
    assert.match(detailsOf(tagImport), /64/, '导入入口要点出上限 64');
  } finally {
    await fixture.close();
  }
});

test('AC-134 C13：versions[].version_no 重复在解析期被拒，且不带裸 SQLite 文本', async () => {
  const fixture = await makeFixture();
  try {
    const cookie = cookieOf(await login(fixture.app));
    const duplicated = exportFile({
      versions: [
        { version_no: 1, title: 'v1', user_prompt: 'a', system_prompt: '', notes: '', created_at: '2026-10-13T00:00:00.000Z' },
        { version_no: 1, title: 'v1-again', user_prompt: 'b', system_prompt: '', notes: '', created_at: '2026-10-13T00:00:00.000Z' },
      ],
    });
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data: duplicated },
    });
    assert.equal(response.statusCode, 400, '重复 version_no 必须 400');
    assert.equal((response.json() as { error: string }).error, 'invalid_import', '错误码仍是 invalid_import');
    const details = detailsOf(response);
    assert.match(details, /versions\[\]\.version_no/, `要点出字段路径，实际：${details}`);
    assert.match(details, /重复/, `要说清是重复，实际：${details}`);
    assert.doesNotMatch(response.body, /SQLITE|constraint failed|UNIQUE/i, `不许带裸 SQLite 文本：${response.body}`);

    // 解析期被拒 ⇒ 一个字节都没落库
    const listed = await fixture.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } });
    assert.equal((listed.json() as { total: number }).total, 0, '解析期拒绝不得落库');
  } finally {
    await fixture.close();
  }
});

test('AC-134 C10/C13：长度上限与约束分类都只有一处来源（读码证据）', () => {
  const columns = stripSourceComments(readSource('src/prompt-columns.ts'));
  assert.match(columns, /export function maxLengthOf\(/, 'prompt-columns.ts 必须导出 maxLengthOf（上限的唯一来源）');

  const importSource = stripSourceComments(readSource('src/services/import.ts'));
  assert.match(importSource, /maxLengthOf\(/, '导入解析必须从 maxLengthOf 取上限');
  assert.match(importSource, /FOLDER_NAME_MAX_LENGTH/, '导入解析必须复用文件夹名上限常量');
  assert.match(importSource, /TAG_NAME_MAX_LENGTH/, '导入解析必须复用标签名上限常量');

  const limits = stripSourceComments(readSource('src/field-limits.ts'));
  assert.match(limits, /export const FOLDER_NAME_MAX_LENGTH = 200;/, '文件夹名上限只在这里定义');
  assert.match(columns, /export const TAG_NAME_MAX_LENGTH = 64;/, '标签名上限属于字段集，定义在 prompt-columns.ts');
  for (const route of ['src/server/routes/folders.ts', 'src/server/routes/tags.ts']) {
    const source = stripSourceComments(readSource(route));
    assert.match(source, /from '\.\.\/\.\.\/field-limits\.js'/, `${route} 必须从 field-limits 取上限`);
    assert.doesNotMatch(source, /maxLength: \d+/, `${route} 不许再写死 maxLength 字面量`);
  }

  // 约束错误必须走阶段 64 的分类设施，不许把 error.message（裸 SQLite 文本）直接回给用户
  const catchBlock = importSource.slice(importSource.indexOf('if (isConstraintError(error))'));
  assert.match(catchBlock, /constraintKind\(/, '导入的约束错误必须走 constraintKind 分类');
  assert.doesNotMatch(catchBlock, /\$\{message\}/, '不许把裸 error.message 拼进用户可见文案');
});
