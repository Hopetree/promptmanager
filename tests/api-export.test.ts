import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

/** 造一份有代表性的数据：2 个文件夹（父子）、2 个标签、2 条 prompt（其中一条多版本）。 */
async function seed(fx: Awaited<ReturnType<typeof makeFixture>>, cookie: string) {
  const parent = (
    await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } })
  ).json() as { id: number };
  const child = (
    await fx.app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: '交接', parent_id: parent.id, sort_order: 7 },
    })
  ).json() as { id: number };
  await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '交接' } });
  await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '运维' } });

  const p1 = (
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: {
        title: '导出夹具甲',
        user_prompt: '会话交接 {{变量A}}',
        system_prompt: 'sys-甲',
        notes: 'notes-甲',
        folder_id: child.id,
        tags: ['运维', '交接'],
        favorite: true,
      },
    })
  ).json() as { id: number };
  await fx.app.inject({
    method: 'PUT',
    url: `/api/prompts/${String(p1.id)}`,
    headers: { cookie },
    payload: { user_prompt: '会话交接 {{变量A}} 第二版' },
  });

  const p2 = (
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '导出夹具乙', user_prompt: '没有标签与文件夹' },
    })
  ).json() as { id: number };

  return { parent, child, p1, p2 };
}

export function stripVolatile(file: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(file);
  delete clone.exported_at;
  return clone;
}

test('导出：结构符合 §6.4（字段名、确定性排序、布尔 favorite、versions 升序）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const seeded = await seed(fx, cookie);

    const res = await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
    assert.equal(res.statusCode, 200, res.body);
    const file = res.json() as Record<string, any>;

    assert.equal(file.app, 'promptmanager');
    assert.equal(file.schema_version, 1);
    assert.match(String(file.exported_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    assert.deepEqual(Object.keys(file).sort(), ['app', 'exported_at', 'folders', 'prompts', 'schema_version', 'tags']);

    // folders：id 升序 + 四个字段
    assert.deepEqual(
      file.folders.map((f: { id: number }) => f.id),
      [seeded.parent.id, seeded.child.id],
    );
    for (const folder of file.folders) {
      assert.deepEqual(Object.keys(folder).sort(), ['id', 'name', 'parent_id', 'sort_order']);
    }
    assert.equal(file.folders[1].parent_id, seeded.parent.id);
    assert.equal(file.folders[1].sort_order, 7);

    // tags：id 升序 + 只有 id/name（不含 count）
    for (const tag of file.tags) {
      assert.deepEqual(Object.keys(tag).sort(), ['id', 'name']);
    }
    assert.deepEqual(
      file.tags.map((t: { id: number }) => t.id),
      [...file.tags.map((t: { id: number }) => t.id)].sort((a: number, b: number) => a - b),
    );

    // prompts：id 升序 + 字段齐备 + tags 名称升序 + versions 按 version_no 升序
    assert.deepEqual(
      file.prompts.map((p: { id: number }) => p.id),
      [seeded.p1.id, seeded.p2.id],
    );
    const first = file.prompts[0];
    assert.deepEqual(
      Object.keys(first).sort(),
      [
        'created_at',
        'favorite',
        'folder_id',
        'id',
        'notes',
        'system_prompt',
        'tags',
        'title',
        'updated_at',
        'user_prompt',
        'versions',
      ],
    );
    assert.deepEqual(first.tags, ['交接', '运维'], 'tags 数组按名称升序');
    assert.equal(first.favorite, true);
    assert.equal(first.folder_id, seeded.child.id);
    assert.notEqual(first.created_at, first.updated_at, '被 PUT 改过的 prompt：updated_at 应晚于 created_at');
    assert.ok(String(first.updated_at) > String(first.created_at));
    assert.equal(
      file.prompts[1].created_at,
      file.prompts[1].updated_at,
      '从未改过的 prompt：created_at 与 updated_at 相同',
    );
    assert.deepEqual(
      first.versions.map((v: { version_no: number }) => v.version_no),
      [1, 2],
      'versions 升序含首版',
    );
    for (const version of first.versions) {
      assert.deepEqual(
        Object.keys(version).sort(),
        ['created_at', 'notes', 'system_prompt', 'title', 'user_prompt', 'version_no'],
      );
    }
    assert.equal(file.prompts[1].favorite, false);
    assert.equal(file.prompts[1].folder_id, null);
    assert.deepEqual(file.prompts[1].tags, []);
  } finally {
    await fx.close();
  }
});

test('导出：两次导出除 exported_at 外完全一致（确定性）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    await seed(fx, cookie);

    const a = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as Record<string, unknown>;
    const b = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as Record<string, unknown>;
    assert.deepEqual(stripVolatile(a), stripVolatile(b));
  } finally {
    await fx.close();
  }
});

test('导出：空库也给出合法结构；未认证 → 401', async () => {
  const fx = await makeFixture();
  try {
    assert.equal((await fx.app.inject({ method: 'GET', url: '/api/export' })).statusCode, 401);

    const cookie = await authed(fx);
    const file = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as Record<string, unknown>;
    assert.equal(file.app, 'promptmanager');
    assert.equal(file.schema_version, 1);
    assert.deepEqual(file.folders, []);
    assert.deepEqual(file.tags, []);
    assert.deepEqual(file.prompts, []);
  } finally {
    await fx.close();
  }
});
