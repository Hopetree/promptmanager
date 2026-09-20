import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../dist/config.js';
import { prepareDatabase, type QueryEngine } from '../dist/db/index.js';
import { searchPrompts } from '../dist/db/prompt-queries.js';
import { countCodePoints, ftsMatchExpression, isFtsQuery, likePattern } from '../dist/db/search.js';
import { createPrompt, deletePrompt, updatePrompt } from '../dist/services/prompts.js';

/** 纯数据层夹具：临时库 + 迁移 + 查询引擎。 */
async function withDb<T>(fn: (qe: QueryEngine) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-dbsearch-'));
  const config = loadConfig({ DATA_DIR: dir });
  const { qe } = prepareDatabase(config);
  try {
    return await fn(qe);
  } finally {
    await qe.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** AC-6 规定的 5 条固定语料。 */
const CORPUS: Array<{ title: string; user_prompt: string }> = [
  { title: '会话交接模板', user_prompt: '把上下文交给下一个同学' },
  { title: '交接文档规范', user_prompt: '写清楚背景与上下文' },
  { title: 'rebase 流程', user_prompt: 'rebase 之前先备份，保留上下文' },
  { title: 'FTS5 笔记', user_prompt: 'trigram 与上下文' },
  { title: '无关记录', user_prompt: '今天的天气与上下文' },
];

async function seedCorpus(qe: QueryEngine): Promise<number[]> {
  const ids: number[] = [];
  for (const row of CORPUS) {
    const created = await createPrompt(qe, row);
    ids.push(created.id);
  }
  return ids;
}

const base = { limit: 50, offset: 0 };

test('长度归一化按 Unicode 码点：>=3 走 FTS，<3 走 LIKE（BRIEF §6.6）', () => {
  assert.equal(countCodePoints('交接'), 2);
  assert.equal(countCodePoints('👍👍'), 2);
  assert.equal(countCodePoints('👍👍👍'), 3);
  assert.equal(countCodePoints('café'), 4);

  assert.equal(isFtsQuery('会话交接'), true);
  assert.equal(isFtsQuery('会话交'), true);
  assert.equal(isFtsQuery('上下文'), true);
  assert.equal(isFtsQuery('交接'), false);
  assert.equal(isFtsQuery('AI'), false);
  assert.equal(isFtsQuery('  交接  '), false, '先 trim 再计数');
  assert.equal(isFtsQuery('abc'), true);
  assert.equal(isFtsQuery(''), false);
  assert.equal(isFtsQuery('   '), false);
});

test('字面短语处理：FTS 引号双写、LIKE 转义 % _ \\', () => {
  assert.equal(ftsMatchExpression('a"b'), '"a""b"');
  assert.equal(ftsMatchExpression('C++'), '"C++"');
  assert.equal(likePattern('100%_\\'), '%100\\%\\_\\\\%');
  assert.equal(likePattern('交接'), '%交接%');
});

test('检索三种长度：>=3 命中目标、2 码点 LIKE 兜底、无命中为 0', async () => {
  await withDb(async (qe) => {
    const ids = await seedCorpus(qe);

    const long = await searchPrompts(qe, { ...base, q: '会话交接' });
    assert.equal(long.total, 1, '≥3 码点走 FTS5');
    assert.deepEqual(long.rows.map((r) => r.id), [ids[0]]);
    assert.equal(long.order, 'relevance');

    const short = await searchPrompts(qe, { ...base, q: '交接' });
    assert.equal(short.total, 2, '2 码点必须由 LIKE 兜底命中（trigram 单独做不到）');
    assert.deepEqual([...short.rows.map((r) => r.id)].sort(), [ids[0], ids[1]]);
    assert.equal(short.order, 'recent');

    const none = await searchPrompts(qe, { ...base, q: '不存在的词' });
    assert.equal(none.total, 0);
    assert.deepEqual(none.rows, []);

    const all = await searchPrompts(qe, { ...base, q: '上下文' });
    assert.equal(all.total, 5, '5 条语料都含"上下文"');
  });
});

test('匹配范围覆盖 title/user_prompt/system_prompt/notes 四个字段', async () => {
  await withDb(async (qe) => {
    const created = await createPrompt(qe, {
      title: '标题里有独门词甲',
      user_prompt: '用户提示词里有独门词乙',
      system_prompt: '系统提示词里有独门词丙',
      notes: '备注里有独门词丁',
    });
    for (const word of ['独门词甲', '独门词乙', '独门词丙', '独门词丁']) {
      const hit = await searchPrompts(qe, { ...base, q: word });
      assert.equal(hit.total, 1, `${word} 应命中`);
      assert.equal(hit.rows[0]?.id, created.id);
    }
  });
});

test('特殊字符一律当字面短语：不抛错、不 500（含引号/星号/减号/百分号/括号/下划线）', async () => {
  await withDb(async (qe) => {
    await seedCorpus(qe);
    for (const q of ['"', '*', '-', 'a-b', 'C++', '100%', '(', ')', '_', '%', '"unclosed', "it's", '***', '--x']) {
      const result = await searchPrompts(qe, { ...base, q });
      assert.equal(typeof result.total, 'number', `q=${JSON.stringify(q)} 不应抛错`);
    }
  });
});

test('英文大小写不敏感（FTS 与 LIKE 两条路径）', async () => {
  await withDb(async (qe) => {
    await seedCorpus(qe);
    const lower = await searchPrompts(qe, { ...base, q: 'rebase' });
    const upper = await searchPrompts(qe, { ...base, q: 'REBASE' });
    assert.equal(lower.total, 1, 'FTS 路径大小写不敏感');
    assert.equal(upper.total, 1);

    const shortLower = await searchPrompts(qe, { ...base, q: 'ft' });
    const shortUpper = await searchPrompts(qe, { ...base, q: 'FT' });
    assert.equal(shortLower.total, shortUpper.total, 'LIKE 路径（ASCII）大小写不敏感');
  });
});

test('空 / 纯空白 q 等同缺省 → 返回全部，按 updated_at 倒序', async () => {
  await withDb(async (qe) => {
    await seedCorpus(qe);
    for (const q of ['', '   ', '\t']) {
      const result = await searchPrompts(qe, { ...base, q });
      assert.equal(result.total, 5, `q=${JSON.stringify(q)} 应返回全部`);
      assert.equal(result.order, 'recent');
    }
  });
});

test('筛选：folder_id / tag / favorite 与检索可叠加，分页只影响 items 不影响 total', async () => {
  await withDb(async (qe) => {
    const { createFolder } = await import('../dist/services/folders.js');
    const folder = await createFolder(qe, { name: '运维' });
    const inFolder = await createPrompt(qe, { title: '会话交接进文件夹', user_prompt: '上下文', folder_id: folder.id, tags: ['交接'], favorite: true });
    const other = await createPrompt(qe, { title: '会话交接不在文件夹', user_prompt: '上下文', tags: ['其他'] });

    // FR-72：searchPrompts 收的是**已解析好的文件夹 id 集合**（含后代），由 listPrompts 用 descendantFolderIds 解析
    const byFolder = await searchPrompts(qe, { ...base, q: '', folderIds: [folder.id] });
    assert.equal(byFolder.total, 1);
    assert.equal(byFolder.rows[0]?.id, inFolder.id);

    const byTag = await searchPrompts(qe, { ...base, q: '', tag: '其他' });
    assert.equal(byTag.total, 1);
    assert.equal(byTag.rows[0]?.id, other.id);

    const byFavorite = await searchPrompts(qe, { ...base, q: '', favorite: true });
    assert.deepEqual(byFavorite.rows.map((r) => r.id), [inFolder.id]);

    const combined = await searchPrompts(qe, { ...base, q: '会话交接', favorite: true });
    assert.equal(combined.total, 1);
    assert.equal(combined.rows[0]?.id, inFolder.id);

    const paged = await searchPrompts(qe, { q: '上下文', limit: 2, offset: 0 });
    assert.equal(paged.total, 2, 'total 是命中总数，不受 limit 影响');
    assert.equal(paged.rows.length, 2);
    const paged2 = await searchPrompts(qe, { q: '上下文', limit: 2, offset: 2 });
    assert.equal(paged2.total, 2);
    assert.equal(paged2.rows.length, 0);
  });
});

test('FTS 索引随 prompt 的增删改同步维护', async () => {
  await withDb(async (qe) => {
    const ids = await seedCorpus(qe);
    assert.equal((await searchPrompts(qe, { ...base, q: '会话交接' })).total, 1);

    // DELETE：原语料里 2 条含"交接"（ids[0] 标题、ids[1] 标题）→ 删掉 ids[1] 应剩 1
    await deletePrompt(qe, ids[1] ?? 0);
    assert.equal((await searchPrompts(qe, { ...base, q: '交接' })).total, 1, 'DELETE 后应少一条（原本 2 条）');

    // UPDATE：把 ids[0] 的内容整体换掉 → 旧词不再命中、新词命中
    await updatePrompt(qe, ids[0] ?? 0, { title: '改名了', user_prompt: '内容也换掉' });
    assert.equal((await searchPrompts(qe, { ...base, q: '会话交接' })).total, 0, 'UPDATE 后旧内容不应再命中');
    assert.equal((await searchPrompts(qe, { ...base, q: '交接' })).total, 0, 'UPDATE 后旧标题里的"交接"也不应再命中');
    assert.equal((await searchPrompts(qe, { ...base, q: '改名了' })).total, 1, 'UPDATE 后新内容应命中');
  });
});
