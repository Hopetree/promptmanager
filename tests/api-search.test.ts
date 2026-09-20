import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

/** AC-6 规定的 5 条固定语料。 */
const CORPUS = [
  { title: '会话交接模板', user_prompt: '把上下文交给下一个同学' },
  { title: '交接文档规范', user_prompt: '写清楚背景与上下文' },
  { title: 'rebase 流程', user_prompt: 'rebase 之前先备份，保留上下文' },
  { title: 'FTS5 笔记', user_prompt: 'trigram 与上下文' },
  { title: '无关记录', user_prompt: '今天的天气与上下文' },
];

interface ListBody {
  total: number;
  limit: number;
  offset: number;
  items: Array<Record<string, unknown>>;
}

async function seedViaApi(fx: Awaited<ReturnType<typeof makeFixture>>, cookie: string): Promise<number[]> {
  const ids: number[] = [];
  for (const row of CORPUS) {
    const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: row });
    assert.equal(res.statusCode, 201, res.body);
    ids.push(Number((res.json() as { id: number }).id));
  }
  return ids;
}

test('AC-6：≥3 码点走 FTS5（total=1 且命中目标 id）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const ids = await seedViaApi(fx, cookie);

    const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('会话交接')}`, headers: { cookie } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as ListBody;
    assert.equal(body.total, 1);
    assert.equal(body.items[0]?.id, ids[0]);
  } finally {
    await fx.close();
  }
});

test('AC-6：2 码点走 LIKE 兜底命中 >=2 条（trigram 单独做不到）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    await seedViaApi(fx, cookie);

    const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('交接')}`, headers: { cookie } });
    const body = res.json() as ListBody;
    assert.ok(body.total >= 2, `期望 >=2，实际 ${body.total}`);
  } finally {
    await fx.close();
  }
});

test('AC-6：无命中 → total=0；特殊字符 → HTTP 200（不得 500）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    await seedViaApi(fx, cookie);

    const none = await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('不存在的词')}`, headers: { cookie } });
    assert.equal((none.json() as ListBody).total, 0);

    // AC-6 原文的特殊字符串（"*-%_）以及更多变体
    const nasty = ['%22%2A-%25_', '%22', '%2A', '-', '%28', '%29', '%25', '_', 'a-b', 'C%2B%2B', '%27', '%5C'];
    for (const raw of nasty) {
      const res = await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${raw}`, headers: { cookie } });
      assert.equal(res.statusCode, 200, `q=${raw} 不应 500（实际 ${res.statusCode}）`);
      assert.equal(typeof (res.json() as ListBody).total, 'number');
    }
  } finally {
    await fx.close();
  }
});

test('检索的边界与排序：大小写不敏感、空白 q、bm25 相关性、分页 total 语义', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    await seedViaApi(fx, cookie);

    const lower = (await fx.app.inject({ method: 'GET', url: '/api/prompts?q=rebase', headers: { cookie } })).json() as ListBody;
    const upper = (await fx.app.inject({ method: 'GET', url: '/api/prompts?q=REBASE', headers: { cookie } })).json() as ListBody;
    assert.equal(lower.total, upper.total);
    assert.equal(lower.total, 1);

    const blank = (await fx.app.inject({ method: 'GET', url: '/api/prompts?q=%20%20', headers: { cookie } })).json() as ListBody;
    assert.equal(blank.total, 5, '纯空白等同缺省 → 全部');

    const noQuery = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as ListBody;
    assert.equal(noQuery.total, 5);

    // 相关性：同一条语料里命中次数更多的应排在前面（bm25 ASC）
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '上下文 上下文 上下文', user_prompt: '上下文 上下文' },
    });
    const ranked = (await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('上下文')}`, headers: { cookie } })).json() as ListBody;
    assert.equal(ranked.total, 6);
    assert.equal(ranked.items[0]?.title, '上下文 上下文 上下文', '高相关（出现次数多）应排第一');

    const paged = (await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('上下文')}&limit=2&offset=0`, headers: { cookie } })).json() as ListBody;
    assert.equal(paged.total, 6, 'total 是命中总数');
    assert.equal(paged.items.length, 2);
    assert.equal(paged.limit, 2);
    assert.equal(paged.offset, 0);
  } finally {
    await fx.close();
  }
});

test('检索与其他筛选叠加：q + tag + folder_id + favorite', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const folder = (
      await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } })
    ).json() as { id: number };
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '会话交接在文件夹里', user_prompt: '上下文', tags: ['交接'], folder_id: folder.id, favorite: true },
    });
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '会话交接不在文件夹', user_prompt: '上下文', tags: ['其他'] },
    });

    const url = `/api/prompts?q=${encodeURIComponent('会话交接')}&tag=${encodeURIComponent('交接')}&folder_id=${String(folder.id)}&favorite=true`;
    const body = (await fx.app.inject({ method: 'GET', url, headers: { cookie } })).json() as ListBody;
    assert.equal(body.total, 1);
    assert.equal(body.items[0]?.title, '会话交接在文件夹里');

    const mismatch = (await fx.app.inject({ method: 'GET', url: `/api/prompts?q=${encodeURIComponent('会话交接')}&tag=${encodeURIComponent('不存在')}`, headers: { cookie } })).json() as ListBody;
    assert.equal(mismatch.total, 0);
  } finally {
    await fx.close();
  }
});
