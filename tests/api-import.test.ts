import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function exportFile(fx: Awaited<ReturnType<typeof makeFixture>>, cookie: string): Promise<Record<string, any>> {
  const res = await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Record<string, any>;
}

function strip(file: Record<string, unknown>): string {
  const clone = structuredClone(file);
  delete clone.exported_at;
  return JSON.stringify(clone);
}

async function importFile(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  mode: string,
  data: unknown,
): Promise<{ statusCode: number; body: any }> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/import', headers: { cookie }, payload: { mode, data } });
  return { statusCode: res.statusCode, body: res.json() };
}

async function promptTitles(fx: Awaited<ReturnType<typeof makeFixture>>, cookie: string): Promise<string[]> {
  const res = await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=200', headers: { cookie } });
  return (res.json() as { items: Array<{ title: string }> }).items.map((p) => p.title).sort();
}

/** 构造一份小的合法文件（含父子文件夹、2 标签、2 prompt、其中一个 2 版本）。 */
function fixtureFile(): Record<string, any> {
  return {
    app: 'promptmanager',
    schema_version: 1,
    exported_at: '2026-09-18T00:00:00.000Z',
    folders: [
      { id: 10, name: '运维', parent_id: null, sort_order: 0 },
      { id: 11, name: '交接', parent_id: 10, sort_order: 3 },
    ],
    tags: [
      { id: 20, name: '交接' },
      { id: 21, name: '运维' },
    ],
    prompts: [
      {
        id: 30,
        title: '导入夹具甲',
        user_prompt: '会话交接 {{变量A}}',
        system_prompt: 'sys-甲',
        notes: 'notes-甲',
        folder_id: 11,
        tags: ['交接', '运维'],
        favorite: true,
        created_at: '2026-09-01T01:02:03.004Z',
        updated_at: '2026-09-02T01:02:03.004Z',
        versions: [
          { version_no: 1, title: '导入夹具甲', user_prompt: '会话交接 {{变量A}}', system_prompt: 'sys-甲', notes: 'notes-甲', created_at: '2026-09-01T01:02:03.004Z' },
          { version_no: 2, title: '导入夹具甲', user_prompt: '会话交接 {{变量A}} 改', system_prompt: 'sys-甲', notes: 'notes-甲', created_at: '2026-09-02T01:02:03.004Z' },
        ],
      },
      {
        id: 31,
        title: '导入夹具乙',
        user_prompt: '独有词乙',
        system_prompt: '',
        notes: '',
        folder_id: null,
        tags: [],
        favorite: false,
        created_at: '2026-09-03T01:02:03.004Z',
        updated_at: '2026-09-03T01:02:03.004Z',
        versions: [
          { version_no: 1, title: '导入夹具乙', user_prompt: '独有词乙', system_prompt: '', notes: '', created_at: '2026-09-03T01:02:03.004Z' },
        ],
      },
    ],
  };
}

test('AC-10：导出 → 导入(replace) → 再导出：除 exported_at 外完全一致，且保留文件里的 id', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const before = await exportFile(fx, cookie);
    // 快照之后再往里写一条：replace 导入后它必须消失（证明真的"清空重建"而不是合并）
    await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '快照之后才加的' } });
    const imported = await importFile(fx, cookie, 'replace', before);
    assert.equal(imported.statusCode, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.mode, 'replace');
    assert.equal(imported.body.imported.prompts, before.prompts.length, 'imported.prompts 应等于导出的 prompt 数');
    assert.equal(imported.body.imported.folders, before.folders.length);
    assert.equal(imported.body.imported.tags, before.tags.length);

    const after = await exportFile(fx, cookie);
    assert.equal(strip(after), strip(before), 'replace 往返应除 exported_at 外完全一致');
    assert.deepEqual(
      after.prompts.map((p: { id: number }) => p.id),
      before.prompts.map((p: { id: number }) => p.id),
      'replace 必须保留文件里的 id',
    );
    assert.ok(
      !(await promptTitles(fx, cookie)).includes('快照之后才加的'),
      'replace 必须清掉"不在文件里"的数据（真清空重建）',
    );
  } finally {
    await fx.close();
  }
});

test('回归：库里已存在父子文件夹时，replace 仍能清空重建（自引用外键 ON DELETE RESTRICT 的坑）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    // 库里已有父子文件夹 + prompt（AC-10 脚本的真实场景；早期用例的空库夹具测不出这个坑）
    const parent = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } })
    ).json() as { id: number };
    await fx.app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: '交接', parent_id: parent.id },
    });
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '占位', folder_id: parent.id },
    });

    const before = await exportFile(fx, cookie);
    const imported = await importFile(fx, cookie, 'replace', before);
    assert.equal(imported.statusCode, 200, `库里已有父子文件夹时 replace 必须成功：${JSON.stringify(imported.body)}`);
    assert.equal(imported.body.imported.folders, before.folders.length);

    const after = await exportFile(fx, cookie);
    assert.equal(strip(after), strip(before), '有既有文件夹树时也要往返 EQUAL');
  } finally {
    await fx.close();
  }
});

test('AC-10 补充：导入后 FTS 索引同步（导入的词能搜到，旧数据的词搜不到）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '旧词独有甲', user_prompt: '旧词独有甲' } });

    const file = fixtureFile();
    assert.equal((await importFile(fx, cookie, 'replace', file)).statusCode, 200);

    const hit = await fx.app.inject({
      method: 'GET',
      url: `/api/prompts?q=${encodeURIComponent('会话交接')}`,
      headers: { cookie },
    });
    assert.equal((hit.json() as { total: number }).total, 1, '导入的新词必须能被检索到（FTS 同步）');

    const short = await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('独有')}`, headers: { cookie } });
    assert.equal((short.json() as { total: number }).total, 1, '两字词走 LIKE 兜底也应命中导入的数据');

    const gone = await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('旧词独有甲')}`, headers: { cookie } });
    assert.equal((gone.json() as { total: number }).total, 0, 'replace 后旧数据的索引必须清掉');
  } finally {
    await fx.close();
  }
});

test('AC-11：非法文件一律 400 invalid_import，且不得改动任何数据', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const seeded = fixtureFile();
    assert.equal((await importFile(fx, cookie, 'replace', seeded)).statusCode, 200);

    const before = await exportFile(fx, cookie);
    const beforeTitles = await promptTitles(fx, cookie);

    const invalidCases: Array<[string, unknown]> = [
      ['app 不对', { app: 'other', schema_version: 1 }],
      ['app 缺失', { schema_version: 1, folders: [], tags: [], prompts: [] }],
      ['schema_version 过新', { app: 'promptmanager', schema_version: 99, folders: [], tags: [], prompts: [] }],
      ['schema_version 非数字', { app: 'promptmanager', schema_version: 'x', folders: [], tags: [], prompts: [] }],
      ['缺数组', { app: 'promptmanager', schema_version: 1 }],
      ['prompts 不是数组', { app: 'promptmanager', schema_version: 1, folders: [], tags: [], prompts: 'no' }],
      ['prompt 缺 id', { app: 'promptmanager', schema_version: 1, folders: [], tags: [], prompts: [{ title: 'x' }] }],
      ['文件夹父不存在', { app: 'promptmanager', schema_version: 1, folders: [{ id: 1, name: 'a', parent_id: 999, sort_order: 0 }], tags: [], prompts: [] }],
      ['文件夹成环', {
        app: 'promptmanager',
        schema_version: 1,
        folders: [
          { id: 1, name: 'a', parent_id: 2, sort_order: 0 },
          { id: 2, name: 'b', parent_id: 1, sort_order: 0 },
        ],
        tags: [],
        prompts: [],
      }],
      ['prompt 引用不存在的文件夹', {
        app: 'promptmanager',
        schema_version: 1,
        folders: [],
        tags: [],
        prompts: [
          {
            id: 1,
            title: 'x',
            user_prompt: '',
            system_prompt: '',
            notes: '',
            folder_id: 42,
            tags: [],
            favorite: false,
            created_at: '2026-09-01T00:00:00.000Z',
            updated_at: '2026-09-01T00:00:00.000Z',
            versions: [{ version_no: 1, title: 'x', user_prompt: '', system_prompt: '', notes: '', created_at: '2026-09-01T00:00:00.000Z' }],
          },
        ],
      }],
    ];
    // 注：`{app:'promptmanager',schema_version:1,folders:[],tags:[],prompts:[]}` 是**合法**文件
    // （空导入 = 清空全部内容），不属于非法用例，故不列在这里；非法 mode 由下面的 badMode 单独覆盖。

    for (const [label, data] of invalidCases) {
      const result = await importFile(fx, cookie, 'replace', data);
      assert.equal(result.statusCode, 400, `${label} 应 400，实际 ${result.statusCode}：${JSON.stringify(result.body)}`);
      assert.equal(result.body.error, 'invalid_import', `${label} 的 error 应为 invalid_import`);
      assert.ok(Array.isArray(result.body.details), `${label} 应带 details 数组`);
    }

    const badMode = await importFile(fx, cookie, 'truncate', seeded);
    assert.equal(badMode.statusCode, 400);
    assert.equal(badMode.body.error, 'invalid_import');

    // 数据必须一个字节都没动
    const after = await exportFile(fx, cookie);
    assert.equal(strip(after), strip(before), '非法导入后数据必须与导入前完全一致');
    assert.deepEqual(await promptTitles(fx, cookie), beforeTitles);
  } finally {
    await fx.close();
  }
});

test('导入原子性：事务中途失败（重复 id）→ 400 且整库回滚到导入前', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    assert.equal((await importFile(fx, cookie, 'replace', fixtureFile())).statusCode, 200);
    const before = strip(await exportFile(fx, cookie));

    const broken = fixtureFile();
    broken.prompts = [broken.prompts[0], { ...broken.prompts[1], id: 30 }]; // 重复 id → 主键冲突
    const result = await importFile(fx, cookie, 'replace', broken);
    assert.equal(result.statusCode, 400, JSON.stringify(result.body));
    assert.equal(result.body.error, 'invalid_import');

    assert.equal(strip(await exportFile(fx, cookie)), before, '失败导入必须整体回滚（含已插入的 folders/tags）');
  } finally {
    await fx.close();
  }
});

test('merge 模式：不清库、同名 folder/tag 复用、prompt 一律新建并重新分配 id', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const file = fixtureFile();
    assert.equal((await importFile(fx, cookie, 'replace', file)).statusCode, 200);
    const firstExport = await exportFile(fx, cookie);

    const merged = await importFile(fx, cookie, 'merge', file);
    assert.equal(merged.statusCode, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.mode, 'merge');
    assert.equal(merged.body.imported.prompts, 2, 'prompt 一律新建');
    assert.equal(merged.body.imported.folders, 0, '同名同父的文件夹应复用，不新建');
    assert.equal(merged.body.imported.tags, 0, '同名标签应复用，不新建');

    const after = await exportFile(fx, cookie);
    assert.equal(after.prompts.length, firstExport.prompts.length * 2, 'prompt 数量翻倍');
    assert.equal(after.folders.length, firstExport.folders.length, '文件夹不重复');
    assert.equal(after.tags.length, firstExport.tags.length, '标签不重复');

    const oldIds = new Set<number>(firstExport.prompts.map((p: { id: number }) => p.id));
    const newIds = after.prompts.map((p: { id: number }) => p.id).filter((id: number) => !oldIds.has(id));
    assert.equal(newIds.length, 2, 'merge 进来的 prompt 必须拿到新 id');
    assert.ok(Math.min(...newIds) > Math.max(...firstExport.prompts.map((p: { id: number }) => p.id)));

    // merge 进来那条仍保留 tags/folder/versions 语义
    const mergedCopy = after.prompts.find((p: { id: number }) => p.id === newIds[0]);
    assert.deepEqual(mergedCopy.tags, ['交接', '运维']);
    assert.equal(mergedCopy.folder_id, after.folders.find((f: { name: string }) => f.name === '交接')?.id);
    assert.deepEqual(
      mergedCopy.versions.map((v: { version_no: number }) => v.version_no),
      [1, 2],
    );
    assert.equal(mergedCopy.created_at, '2026-09-01T01:02:03.004Z', 'merge 保留文件里的时间戳');
  } finally {
    await fx.close();
  }
});

test('merge 模式：同一名字挂在不同父下 → 视为不同文件夹（新建）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const root = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '根' } })
    ).json() as { id: number };

    const file = {
      app: 'promptmanager',
      schema_version: 1,
      exported_at: '2026-09-18T00:00:00.000Z',
      folders: [
        { id: 1, name: '根', parent_id: null, sort_order: 0 },
        { id: 2, name: '子', parent_id: 1, sort_order: 0 },
      ],
      tags: [],
      prompts: [],
    };
    const result = await importFile(fx, cookie, 'merge', file);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.imported.folders, 1, '同名"根"复用（0 新建）+"子"新建（1）');

    const folders = (await fx.app.inject({ method: 'GET', url: '/api/folders', headers: { cookie } })).json() as {
      items: Array<{ id: number; name: string; parent_id: number | null }>;
    };
    assert.equal(folders.items.filter((f) => f.name === '根').length, 1, '"根"不应重复');
    const child = folders.items.find((f) => f.name === '子');
    assert.equal(child?.parent_id, root.id, '"子"应挂在复用到的"根"下');
  } finally {
    await fx.close();
  }
});

test('导入需要认证（401）；非法 mode 的类型错误也不 500', async () => {
  const fx = await makeFixture();
  try {
    const anon = await fx.app.inject({ method: 'POST', url: '/api/import', payload: { mode: 'replace', data: fixtureFile() } });
    assert.equal(anon.statusCode, 401);

    const cookie = await authed(fx);
    const res = await fx.app.inject({ method: 'POST', url: '/api/import', headers: { cookie }, payload: { mode: 42, data: {} } });
    assert.ok(res.statusCode === 400, `应 400，实际 ${res.statusCode}`);
  } finally {
    await fx.close();
  }
});

test('FR-10b：缺 title / user_prompt 的 prompt 条目 → 400 invalid_import，且拒绝后数据指纹不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    // 基线：先用合法文件 replace 导入（replace 是破坏性模式 —— 校验一旦失效就会清库，指纹断言能直接抓到）
    assert.equal((await importFile(fx, cookie, 'replace', fixtureFile())).statusCode, 200);
    const beforeFingerprint = strip(await exportFile(fx, cookie));
    const beforeTitles = await promptTitles(fx, cookie);

    const base = fixtureFile().prompts[0] as Record<string, unknown>;
    const missingTitle = structuredClone(base);
    delete missingTitle.title;
    const missingUserPrompt = structuredClone(base);
    delete missingUserPrompt.user_prompt;

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['缺 title', missingTitle, 'data.prompts[].title'],
      ['缺 user_prompt', missingUserPrompt, 'data.prompts[].user_prompt'],
    ];

    for (const [label, prompt, path] of cases) {
      const file = fixtureFile();
      file.prompts = [prompt];
      const result = await importFile(fx, cookie, 'replace', file);
      assert.equal(result.statusCode, 400, `${label} 必须 400，实际 ${result.statusCode}：${JSON.stringify(result.body)}`);
      assert.equal(result.body.error, 'invalid_import', `${label} 的 error 必须是 invalid_import`);
      assert.ok(
        (result.body.details as Array<{ path?: string }>).some((detail) => String(detail.path).includes(path)),
        `${label} 的 details 应指向 ${path}：${JSON.stringify(result.body.details)}`,
      );
      assert.equal(strip(await exportFile(fx, cookie)), beforeFingerprint, `${label} 被拒后数据必须逐字节不变`);
      assert.deepEqual(await promptTitles(fx, cookie), beforeTitles, `${label} 被拒后标题列表必须不变`);
    }

    // 反向保护（AC-10）：显式空串仍是合法值 —— 库里允许空标题，导出必然写出 "title": ""，
    // 若把空串也判非法，"导出 → 导入(replace) → 再导出 EQUAL"会被自己库里的合法数据打破。
    const emptyOk = fixtureFile();
    emptyOk.prompts = [{ ...(fixtureFile().prompts[1] as Record<string, unknown>), title: '', user_prompt: '' }];
    const ok = await importFile(fx, cookie, 'replace', emptyOk);
    assert.equal(ok.statusCode, 200, `显式空串必须仍被接受（AC-10 往返）：${JSON.stringify(ok.body)}`);
  } finally {
    await fx.close();
  }
});
