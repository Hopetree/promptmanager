// 阶段 72 / BRIEF FR-157 / AC-134 C11-C12（N5）：merge 的真实语义 + 文档/界面必须如实告知。
//
// 现状：`docs/api.md` 承诺 merge「只新增 / 更新」，但 `mergeImport` **一律新建**（不按内容去重、
// 也不按 id 更新）⇒ 同一个文件导入两次就产生两份条目，用户按文档理解会以为第二次是"更新"。
// D-70 ③ 定的口径：本阶段**不做**真更新（那要先定义匹配键与冲突处理，属行为变更），
// 而是把文档与界面改成如实描述「只新增 + 重复导入会产生重复条目」，并保留计数提示。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource } from './source-text.ts';

function exportFile(): Record<string, unknown> {
  return {
    app: 'promptmanager',
    schema_version: 1,
    folders: [{ id: 1, name: '重复导入夹具夹', parent_id: null, sort_order: 0 }],
    tags: [{ id: 1, name: '重复导入夹具签' }],
    prompts: [
      {
        id: 1,
        title: '重复导入夹具',
        user_prompt: '正文',
        system_prompt: '',
        notes: '',
        folder_id: 1,
        sort_order: 0,
        tags: ['重复导入夹具签'],
        favorite: false,
        remember_variables: true,
        created_at: '2026-10-13T00:00:00.000Z',
        updated_at: '2026-10-13T00:00:00.000Z',
        versions: [
          {
            version_no: 1,
            title: '重复导入夹具',
            user_prompt: '正文',
            system_prompt: '',
            notes: '',
            created_at: '2026-10-13T00:00:00.000Z',
          },
        ],
      },
    ],
  };
}

test('AC-134 C11/C12：merge 的真实语义是「纯追加、不去重」，计数如实回报', async () => {
  const fixture = await makeFixture();
  try {
    const cookie = cookieOf(await login(fixture.app));
    const data = exportFile();

    const first = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data },
    });
    assert.equal(first.statusCode, 200, '第一次 merge 应成功');
    const firstBody = first.json() as { imported: { prompts: number; folders: number; tags: number } };
    assert.equal(firstBody.imported.prompts, 1, '第一次 merge 新增 1 条 prompt');
    assert.equal(firstBody.imported.folders, 1, '第一次 merge 新增 1 个文件夹');
    assert.equal(firstBody.imported.tags, 1, '第一次 merge 新增 1 个标签');

    const second = await fixture.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'merge', data },
    });
    assert.equal(second.statusCode, 200, '第二次 merge 同样成功');
    const secondBody = second.json() as { imported: { prompts: number; folders: number; tags: number } };
    assert.equal(secondBody.imported.prompts, 1, '第二次 merge 又新增 1 条（prompt 一律新建、不去重）');
    assert.equal(secondBody.imported.folders, 0, '同名同父文件夹复用 ⇒ 不再新增');
    assert.equal(secondBody.imported.tags, 0, '同名标签复用 ⇒ 不再新增');

    const listed = await fixture.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } });
    assert.equal((listed.json() as { total: number }).total, 2, '同一个文件导入两次 ⇒ 库里 2 条（文档必须如实写）');
  } finally {
    await fixture.close();
  }
});

test('AC-134 C11/C12：文档与界面必须如实告知「重复导入会产生重复条目」', () => {
  const api = readSource('docs/api.md');
  assert.doesNotMatch(api, /只新增 \/ 更新/, '文档不许再承诺"更新"（merge 只追加，不按 id 更新）');
  assert.match(api, /不按内容去重/, '文档要写明 merge 不按内容去重');
  assert.match(api, /重复条目/, '文档要写明重复导入会产生重复条目');

  const modal = readSource('web/src/components/ImportExportModal.tsx');
  assert.match(modal, /重复条目/, '导入弹窗的 merge 说明要提示会产生重复条目');

  const sync = readSource('web/src/components/SyncModal.tsx');
  assert.match(sync, /重复拉取/, '同步弹窗的 merge 提示要说明重复拉取会产生重复条目');
});
