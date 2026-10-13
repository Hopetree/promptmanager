/**
 * 常驻回归（阶段 73 / FR-160 / AC-135 A4）—— 「大行数分页 / 搜索」。
 *
 * 为什么要有这条（N24 指出的失败注入缺口：`docs/search-zh.md` 的性能数字没有任何基准守护）：
 * 分页与检索的正确性只在几十行的夹具上验过；行数上去以后最容易坏的两件事是
 * **翻页不重不漏**（排序没有稳定 tiebreaker 时 LIMIT/OFFSET 会漂）与**检索命中数与 total 不一致**。
 *
 * 判据（全部对**真实 HTTP 响应**断言，不 mock 查询层）：
 * ① 全量翻页：每一页的 id 不与已见集合重叠，翻完恰好覆盖 `total` 条；
 * ② 检索：命中集合的分页同样不重不漏，`total` 等于命中数；
 * ③ 无命中查询：`total=0` 且 `items` 为空（不是 500、不是全量返回）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../dist/config.js';
import { prepareDatabase } from '../dist/db/index.js';
import { cookieOf, login, makeFixture, type Fixture } from './helpers.ts';

const ROWS = 500;
const PAGE = 50;
/** 每隔一行带上的独特标记（用来算"检索命中数"）。 */
const TOKEN = '独特标记';
const TOKEN_ROWS = ROWS / 2;

interface ListBody {
  total: number;
  items: Array<{ id: number; title: string }>;
}

async function seed(fixture: Fixture, count: number): Promise<void> {
  const config = loadConfig({ DATA_DIR: fixture.dir });
  const { qe } = prepareDatabase(config);
  const now = new Date().toISOString();
  await qe.transaction().execute(async (trx) => {
    for (let i = 0; i < count; i += 1) {
      const marked = i % 2 === 0;
      await trx
        .insertInto('prompts')
        .values({
          title: `批量第 ${String(i)} 条${marked ? TOKEN : ''}`,
          user_prompt: `正文 ${String(i)}：上下文整理${marked ? TOKEN : ''}`,
          system_prompt: 'seeded',
          notes: '',
          folder_id: null,
          favorite: 0,
          remember_variables: 1,
          version_no: 1,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }
  });
  await qe.destroy();
}

/** 翻完某个查询的全部页；返回 id 列表（顺序即服务端给的顺序）。 */
async function walkPages(
  fixture: Fixture,
  cookie: string,
  query: string,
  expectedTotal: number,
): Promise<number[]> {
  const ids: number[] = [];
  const seen = new Set<number>();
  let offset = 0;
  for (;;) {
    const response = await fixture.app.inject({
      method: 'GET',
      url: `/api/prompts?limit=${String(PAGE)}&offset=${String(offset)}${query}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, `分页请求必须 200（offset=${String(offset)}）`);
    const body = response.json() as ListBody;
    assert.equal(body.total, expectedTotal, '每一页的 total 都必须一致');
    for (const item of body.items) {
      assert.equal(seen.has(item.id), false, `分页出现重复条目 id=${String(item.id)}（offset=${String(offset)}）`);
      seen.add(item.id);
      ids.push(item.id);
    }
    if (body.items.length < PAGE) break;
    offset += PAGE;
    assert.ok(offset <= expectedTotal + PAGE, '翻页没有收敛（total 与实际返回不一致）');
  }
  return ids;
}

test('AC-135 A4：大行数分页 —— 全量翻页不重不漏，覆盖数与 total 一致', async (t) => {
  const fixture = await makeFixture();
  try {
    await seed(fixture, ROWS);
    const cookie = cookieOf(await login(fixture.app));

    const started = Date.now();
    const ids = await walkPages(fixture, cookie, '', ROWS);
    const elapsed = Date.now() - started;

    assert.equal(ids.length, ROWS, `翻完所有页必须恰好 ${String(ROWS)} 条`);
    assert.equal(new Set(ids).size, ROWS, '不得有重复条目');
    t.diagnostic(
      `分页实测：${String(ROWS)} 行 / ${String(Math.ceil(ROWS / PAGE))} 页 / limit=${String(PAGE)}，用时 ${String(elapsed)} ms`,
    );
  } finally {
    await fixture.close();
  }
});

test('AC-135 A4：大行数检索 —— 命中集合的分页不重不漏，total 等于命中数', async (t) => {
  const fixture = await makeFixture();
  try {
    await seed(fixture, ROWS);
    const cookie = cookieOf(await login(fixture.app));

    const started = Date.now();
    const ids = await walkPages(fixture, cookie, `&q=${encodeURIComponent(TOKEN)}`, TOKEN_ROWS);
    const elapsed = Date.now() - started;

    assert.equal(ids.length, TOKEN_ROWS, `带标记的行有 ${String(TOKEN_ROWS)} 条，检索必须全部命中`);
    assert.equal(new Set(ids).size, TOKEN_ROWS, '检索分页不得重复');
    t.diagnostic(`检索实测：q=${TOKEN} 命中 ${String(TOKEN_ROWS)} 行，用时 ${String(elapsed)} ms`);
  } finally {
    await fixture.close();
  }
});

test('AC-135 A4：无命中查询 ⇒ total=0 且 items 为空（不是 500、不是全量返回）', async () => {
  const fixture = await makeFixture();
  try {
    await seed(fixture, 40);
    const cookie = cookieOf(await login(fixture.app));
    const response = await fixture.app.inject({
      method: 'GET',
      url: `/api/prompts?q=${encodeURIComponent('绝对不存在的词zzz')}`,
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as ListBody;
    assert.equal(body.total, 0, '无命中查询的 total 必须是 0');
    assert.equal(body.items.length, 0, '无命中查询不得返回任何条目');
  } finally {
    await fixture.close();
  }
});
