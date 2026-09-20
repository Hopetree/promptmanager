import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

interface FolderItem {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

interface TagItem {
  id: number;
  name: string;
  count: number;
}

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

test('AC-14：父子文件夹结构与 CRUD（含 400/404/409）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);

    const parent = await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } });
    assert.equal(parent.statusCode, 201, parent.body);
    const parentBody = parent.json() as FolderItem;
    assert.equal(parentBody.parent_id, null);
    assert.equal(parentBody.sort_order, 0);

    const child = await fx.app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: '交接', parent_id: parentBody.id, sort_order: 5 },
    });
    assert.equal(child.statusCode, 201, child.body);
    const childBody = child.json() as FolderItem;
    assert.equal(childBody.parent_id, parentBody.id);
    assert.equal(childBody.sort_order, 5);

    const list = (await fx.app.inject({ method: 'GET', url: '/api/folders', headers: { cookie } })).json() as { items: FolderItem[] };
    assert.equal(list.items.length, 2);
    const fromList = new Map(list.items.map((f) => [f.name, f]));
    assert.equal(fromList.get('交接')?.parent_id, parentBody.id, '结构正确：子的 parent_id = 父 id');
    assert.equal(fromList.get('运维')?.parent_id, null);

    // 400：父不存在 / 同父重名 / 空名
    const missingParent = await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: 'x', parent_id: 999999 } });
    assert.equal(missingParent.statusCode, 400, missingParent.body);
    const duplicate = await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } });
    assert.equal(duplicate.statusCode, 400, duplicate.body);
    const emptyName = await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '   ' } });
    assert.equal(emptyName.statusCode, 400);

    // PUT 改名 + 400 成环（把父挂到自己的后代下）+ 404
    const renamed = await fx.app.inject({
      method: 'PUT',
      url: `/api/folders/${String(parentBody.id)}`,
      headers: { cookie },
      payload: { name: '运维改名' },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((renamed.json() as FolderItem).name, '运维改名');

    const cycle = await fx.app.inject({
      method: 'PUT',
      url: `/api/folders/${String(parentBody.id)}`,
      headers: { cookie },
      payload: { parent_id: childBody.id },
    });
    assert.equal(cycle.statusCode, 400, '把父挂到自己的后代下必须被拒（防成环）');

    const selfParent = await fx.app.inject({
      method: 'PUT',
      url: `/api/folders/${String(parentBody.id)}`,
      headers: { cookie },
      payload: { parent_id: parentBody.id },
    });
    assert.equal(selfParent.statusCode, 400);

    const notFound = await fx.app.inject({ method: 'PUT', url: '/api/folders/999999', headers: { cookie }, payload: { name: 'x' } });
    assert.equal(notFound.statusCode, 404);

    // 409：有子项
    const withChild = await fx.app.inject({ method: 'DELETE', url: `/api/folders/${String(parentBody.id)}`, headers: { cookie } });
    assert.equal(withChild.statusCode, 409, withChild.body);
    assert.equal((withChild.json() as { error: string }).error, 'folder_not_empty');

    // 空文件夹可删
    const empty = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '空' } })
    ).json() as FolderItem;
    const deleted = await fx.app.inject({ method: 'DELETE', url: `/api/folders/${String(empty.id)}`, headers: { cookie } });
    assert.equal(deleted.statusCode, 204);
    assert.equal((await fx.app.inject({ method: 'DELETE', url: `/api/folders/${String(empty.id)}`, headers: { cookie } })).statusCode, 404);
  } finally {
    await fx.close();
  }
});

test('AC-14：文件夹非空（有 prompt 归属）→ 409；移走 prompt 后可删', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const folder = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '有内容' } })
    ).json() as FolderItem;
    const prompt = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '占位', folder_id: folder.id } })
    ).json() as { id: number };

    const blocked = await fx.app.inject({ method: 'DELETE', url: `/api/folders/${String(folder.id)}`, headers: { cookie } });
    assert.equal(blocked.statusCode, 409, blocked.body);

    await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(prompt.id)}`, headers: { cookie }, payload: { folder_id: null } });
    const afterMove = await fx.app.inject({ method: 'DELETE', url: `/api/folders/${String(folder.id)}`, headers: { cookie } });
    assert.equal(afterMove.statusCode, 204, afterMove.body);
  } finally {
    await fx.close();
  }
});

test('AC-14：标签 CRUD + 计数 + 改名合并', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);

    const a = (
      await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '交接' } })
    ).json() as TagItem;
    const b = (
      await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '运维' } })
    ).json() as TagItem;
    assert.equal(a.count, 0);
    assert.equal(b.count, 0);

    const duplicate = await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '交接' } });
    assert.equal(duplicate.statusCode, 400, '重名标签创建应 400（不静默返回已有）');

    const emptyName = await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '  ' } });
    assert.equal(emptyName.statusCode, 400);

    // 一个 prompt 打标签 A，另一个打标签 B
    const p1 = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '甲', tags: ['交接'] } })
    ).json() as { id: number };
    const p2 = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '乙', tags: ['运维'] } })
    ).json() as { id: number };

    let tags = (await fx.app.inject({ method: 'GET', url: '/api/tags', headers: { cookie } })).json() as { items: TagItem[] };
    const countOf = (name: string) => tags.items.find((t) => t.name === name)?.count;
    assert.equal(countOf('交接'), 1);
    assert.equal(countOf('运维'), 1);

    // 改名合并：把"运维"改成"交接" → 合并到"交接"，计数相加，无重名
    const merged = await fx.app.inject({
      method: 'PUT',
      url: `/api/tags/${String(b.id)}`,
      headers: { cookie },
      payload: { name: '交接' },
    });
    assert.equal(merged.statusCode, 200, merged.body);
    const mergedBody = merged.json() as TagItem;
    assert.equal(mergedBody.id, a.id, '合并后存活的是目标标签');
    assert.equal(mergedBody.name, '交接');
    assert.equal(mergedBody.count, 2, '计数相加');

    tags = (await fx.app.inject({ method: 'GET', url: '/api/tags', headers: { cookie } })).json() as { items: TagItem[] };
    assert.equal(tags.items.filter((t) => t.name === '交接').length, 1, '不得出现重名');
    assert.equal(tags.items.find((t) => t.name === '运维'), undefined, '源标签应消失');

    // 两个 prompt 现在都带"交接"；按 tag 过滤应命中 2 条
    const byTag = (await fx.app.inject({ method: 'GET', url: `/api/prompts?tag=${encodeURIComponent('交接')}`, headers: { cookie } })).json() as { total: number };
    assert.equal(byTag.total, 2);

    // 改名（非合并）+ 404 + 删除
    const renamed = await fx.app.inject({
      method: 'PUT',
      url: `/api/tags/${String(a.id)}`,
      headers: { cookie },
      payload: { name: '交接与运维' },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal((renamed.json() as TagItem).name, '交接与运维');

    assert.equal((await fx.app.inject({ method: 'PUT', url: '/api/tags/999999', headers: { cookie }, payload: { name: 'x' } })).statusCode, 404);
    assert.equal((await fx.app.inject({ method: 'DELETE', url: `/api/tags/${String(a.id)}`, headers: { cookie } })).statusCode, 204);
    assert.equal((await fx.app.inject({ method: 'DELETE', url: `/api/tags/${String(a.id)}`, headers: { cookie } })).statusCode, 404);

    // 删标签后 prompt 仍在，只是不再带该标签
    const p1After = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(p1.id)}`, headers: { cookie } })).json() as { tags: string[] };
    assert.deepEqual(p1After.tags, []);
    assert.equal((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(p2.id)}`, headers: { cookie } })).statusCode, 200);
  } finally {
    await fx.close();
  }
});

test('AC-14：把 prompt 归入文件夹 + 打标签后，folder_id/tag 过滤各命中 1 条', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const folder = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '归类目标' } })
    ).json() as FolderItem;
    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title: '待归类' } })
    ).json() as { id: number };

    const updated = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(created.id)}`,
      headers: { cookie },
      payload: { folder_id: folder.id, tags: ['交接'] },
    });
    assert.equal(updated.statusCode, 200, updated.body);

    const byFolder = (await fx.app.inject({ method: 'GET', url: `/api/prompts?folder_id=${String(folder.id)}`, headers: { cookie } })).json() as { total: number; items: Array<{ id: number }> };
    assert.equal(byFolder.total, 1);
    assert.equal(byFolder.items[0]?.id, created.id);

    const byTag = (await fx.app.inject({ method: 'GET', url: `/api/prompts?tag=${encodeURIComponent('交接')}`, headers: { cookie } })).json() as { total: number; items: Array<{ id: number }> };
    assert.equal(byTag.total, 1);
    assert.equal(byTag.items[0]?.id, created.id);
  } finally {
    await fx.close();
  }
});
