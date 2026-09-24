import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, readDb } from './helpers.ts';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

const SUBMITTED = {
  title: '会话交接模板',
  user_prompt: '你好 {{姓名}}，请把上下文交给下一位同学',
  system_prompt: '你是严谨的交接助手',
  notes: '备注：含 emoji ✅ 与 "引号"',
  tags: ['交接'],
  favorite: true,
};

test('AC-5①：POST 全字段 + 1 个标签 → 201 version_no=1，GET 逐字段一致', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: SUBMITTED,
    });
    assert.equal(created.statusCode, 201, created.body);
    const body = created.json() as Record<string, unknown>;
    assert.equal(body.version_no, 1);
    assert.equal(typeof body.id, 'number');

    const got = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(body.id)}`, headers: { cookie } });
    assert.equal(got.statusCode, 200);
    const fetched = got.json() as Record<string, unknown>;

    // 逐字段比对（AC-5 的 python3 逐字段比对在 tools/ac-stage3.sh 里；这里是同等断言）
    const comparisons: Array<[string, unknown, unknown]> = [
      ['title', fetched.title, SUBMITTED.title],
      ['user_prompt', fetched.user_prompt, SUBMITTED.user_prompt],
      ['system_prompt', fetched.system_prompt, SUBMITTED.system_prompt],
      ['notes', fetched.notes, SUBMITTED.notes],
      ['tags', fetched.tags, SUBMITTED.tags],
      ['favorite', fetched.favorite, SUBMITTED.favorite],
      ['folder_id', fetched.folder_id, null],
    ];
    for (const [field, actual, expected] of comparisons) {
      assert.deepEqual(actual, expected, `字段 ${field} 不一致`);
    }
    /**
     * ⚠️ **v61（FR-114）改写**：原为"GET 详情算一次取用 ⇒ use_count 比创建响应多 1"。
     * 用户拍板「打开详情不要算，只有真的复制才是使用」⇒ 打开详情现在**只留痕 kind='view'**、
     * **不计入 use_count** ⇒ 这里应当是 0（与创建响应一致），其余字段仍必须完全一致。
     * 覆盖没有减弱：真正"计入"的路径由 api-usage / stage50 的 render·复制·MCP 用例守着。
     */
    assert.equal(fetched.use_count, 0, '打开详情**不计入**取用（FR-114）');
    assert.equal(body.use_count, 0, '创建响应里还没有取用记录');
    // v61（FR-114）：打开详情既不计数、也不产生"计入型"记录 ⇒ last_used_at 仍为 null
    assert.equal(fetched.last_used_at, null, '未被真正取用过 ⇒ last_used_at 为 null');
    const withoutUsage = (obj: Record<string, unknown>) => {
      const clone = { ...obj };
      delete clone.use_count;
      delete clone.last_used_at;
      return clone;
    };
    assert.deepEqual(withoutUsage(fetched), withoutUsage(body), '除 usage 字段外 GET 单个应与创建返回完全一致');
  } finally {
    await fx.close();
  }
});

test('AC-5②：PUT 改 notes → 200 且 version_no=2，其余字段不变；版本行留档', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: SUBMITTED })
    ).json() as Record<string, unknown>;
    const id = Number(created.id);

    const updated = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(id)}`,
      headers: { cookie },
      payload: { notes: '改过的备注' },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    const body = updated.json() as Record<string, unknown>;
    assert.equal(body.version_no, 2, 'PUT 必须产生新版本');
    assert.equal(body.notes, '改过的备注');
    assert.equal(body.title, SUBMITTED.title);
    assert.equal(body.user_prompt, SUBMITTED.user_prompt);
    assert.equal(body.system_prompt, SUBMITTED.system_prompt);
    assert.deepEqual(body.tags, SUBMITTED.tags);
    assert.equal(body.favorite, true);
    assert.ok(String(body.updated_at) >= String(created.updated_at), 'updated_at 不应回退');

    const versions = readDb(fx, (db) =>
      db.prepare('select version_no, notes from prompt_versions where prompt_id = ? order by version_no').all(id) as Array<{
        version_no: number;
        notes: string;
      }>,
    );
    assert.deepEqual(
      versions.map((v) => v.version_no),
      [1, 2],
      'v1/v2 都要留档',
    );
    assert.equal(versions[0]?.notes, SUBMITTED.notes);
    assert.equal(versions[1]?.notes, '改过的备注');
  } finally {
    await fx.close();
  }
});

test('PUT 的语义：提供 tags 时整体替换；folder_id/favorite 可改；未提供字段不动', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const folder = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } })
    ).json() as { id: number };
    const created = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '原文', notes: '原备注', tags: ['甲', '乙'] },
      })
    ).json() as Record<string, unknown>;
    const id = Number(created.id);

    const replaced = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(id)}`,
      headers: { cookie },
      payload: { tags: ['丙'], folder_id: folder.id, favorite: true },
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    const body = replaced.json() as Record<string, unknown>;
    assert.deepEqual(body.tags, ['丙'], 'tags 整体替换');
    assert.equal(body.folder_id, folder.id);
    assert.equal(body.favorite, true);
    assert.equal(body.title, '原文', '未提供的字段保持不变');
    assert.equal(body.notes, '原备注');
    assert.equal(body.version_no, 2);
  } finally {
    await fx.close();
  }
});

test('AC-5③：DELETE → 204，再 GET → 404；重复 DELETE → 404；版本与标签关联级联清理', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: SUBMITTED })
    ).json() as Record<string, unknown>;
    const id = Number(created.id);

    const deleted = await fx.app.inject({ method: 'DELETE', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.equal(deleted.statusCode, 204);
    assert.equal(deleted.body, '');

    const after = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.equal(after.statusCode, 404);
    assert.deepEqual(after.json(), { error: 'not_found' });

    const again = await fx.app.inject({ method: 'DELETE', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.equal(again.statusCode, 404);

    const leftovers = readDb(fx, (db) => ({
      versions: (db.prepare('select count(*) as n from prompt_versions where prompt_id = ?').get(id) as { n: number }).n,
      links: (db.prepare('select count(*) as n from prompt_tags where prompt_id = ?').get(id) as { n: number }).n,
      fts: (db.prepare("select count(*) as n from prompts_fts where prompts_fts match ?").get('"会话交接"') as { n: number }).n,
    }));
    assert.equal(leftovers.versions, 0, '版本应级联删除');
    assert.equal(leftovers.links, 0, '标签关联应级联删除');
    assert.equal(leftovers.fts, 0, 'FTS 索引应同步删除');
  } finally {
    await fx.close();
  }
});

test('PUT / DELETE 的 404 与 400：不存在的 id、非法 body、非法 folder_id', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const missing = await fx.app.inject({
      method: 'PUT',
      url: '/api/prompts/999999',
      headers: { cookie },
      payload: { notes: 'x' },
    });
    assert.equal(missing.statusCode, 404);

    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: 'x' } })
    ).json() as { id: number };

    const badType = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(created.id)}`,
      headers: { cookie },
      payload: { title: 42 },
    });
    assert.equal(badType.statusCode, 400, badType.body);
    assert.equal((badType.json() as { error: string }).error, 'invalid_body');

    const badFolder = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(created.id)}`,
      headers: { cookie },
      payload: { folder_id: 987654 },
    });
    assert.equal(badFolder.statusCode, 400, badFolder.body);

    const unknownField = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(created.id)}`,
      headers: { cookie },
      payload: { nope: 1 },
    });
    assert.equal(unknownField.statusCode, 400);
  } finally {
    await fx.close();
  }
});

test('GET /api/prompts 列表：默认分页 + folder_id/tag/favorite 过滤 + limit 上限截断', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const folder = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '归类' } })
    ).json() as { id: number };
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '甲', tags: ['标签甲'], favorite: true, folder_id: folder.id },
    });
    await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '乙', tags: ['标签乙'] } });

    const list = (
      await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })
    ).json() as { total: number; limit: number; offset: number; items: unknown[] };
    assert.equal(list.total, 2);
    assert.equal(list.limit, 50);
    assert.equal(list.offset, 0);
    assert.equal(list.items.length, 2);

    const byFolder = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts?folder_id=${String(folder.id)}`, headers: { cookie } })
    ).json() as { total: number; items: Array<{ title: string }> };
    assert.equal(byFolder.total, 1);
    assert.equal(byFolder.items[0]?.title, '甲');

    const byTag = (
      await fx.app.inject({ method: 'GET', url: '/api/prompts?tag=%E6%A0%87%E7%AD%BE%E4%B9%99', headers: { cookie } })
    ).json() as { total: number; items: Array<{ title: string }> };
    assert.equal(byTag.total, 1);
    assert.equal(byTag.items[0]?.title, '乙');

    const byFavorite = (
      await fx.app.inject({ method: 'GET', url: '/api/prompts?favorite=true', headers: { cookie } })
    ).json() as { total: number };
    assert.equal(byFavorite.total, 1);

    const otherFavorite = (
      await fx.app.inject({ method: 'GET', url: '/api/prompts?favorite=false', headers: { cookie } })
    ).json() as { total: number };
    assert.equal(otherFavorite.total, 1);

    const capped = (
      await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=9999', headers: { cookie } })
    ).json() as { limit: number };
    assert.equal(capped.limit, 200);

    for (const bad of ['favorite=maybe', 'folder_id=abc', 'folder_id=-1', 'limit=0']) {
      const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?${bad}`, headers: { cookie } });
      assert.equal(res.statusCode, 400, `${bad} 应 400，实际 ${res.statusCode}`);
    }
  } finally {
    await fx.close();
  }
});
