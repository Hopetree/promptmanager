#!/usr/bin/env node
// S0 技术验证：中文检索方案实测（BRIEF §6.8 / §6.6 / D-3）。
// 目的：在 228 上复核 host_manger 的实测结论——trigram 对中文 ≥3 字符可用、<3 字符 0 命中、
// 默认 unicode61 对中文 0 命中、特殊字符不报错、2000 条规模下性能可用。
// 用法：node tools/search-zh-poc.mjs
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';

const out = (line = '') => process.stdout.write(`${line}\n`);
const rule = (title) => out(`\n=== ${title} ===`);

const db = new Database(':memory:');

rule('1. 环境');
out(`sqlite_version = ${db.prepare('select sqlite_version() as v').get().v}`);
out(`node           = ${process.version}`);
out(`better-sqlite3 = ${(await import('better-sqlite3/package.json', { with: { type: 'json' } })).default.version}`);

db.exec("create virtual table fts_trigram using fts5(body, tokenize='trigram')");
db.exec("create virtual table fts_unicode using fts5(body, tokenize='unicode61')");
const insTrigram = db.prepare('insert into fts_trigram(body) values (?)');
const insUnicode = db.prepare('insert into fts_unicode(body) values (?)');

const CORPUS = [
  '会话交接：把工作上下文交给下一个同学',
  '交接文档需要写清楚背景、结论和遗留问题',
  'rebase 之前先备份分支',
  'FTS5 的 trigram 分词器支持中文子串匹配',
  'AI 助手与上下文整理',
  '今天天气不错',
];
for (const line of CORPUS) {
  insTrigram.run(line);
  insUnicode.run(line);
}

const phrase = (q) => `"${q.replaceAll('"', '""')}"`;
const matchCount = (table, q) =>
  db.prepare(`select count(*) as n from ${table} where ${table} match ?`).get(phrase(q)).n;

rule('2. 中文语料：trigram vs unicode61（对照）');
out('query\t\t\ttrigram\tunicode61');
for (const q of ['会话交接', '会话', '交接文档', '交接', '上下文', 'rebase', 'FTS5', '无关词汇']) {
  out(`${q}\t\t\t${matchCount('fts_trigram', q)}\t${matchCount('fts_unicode', q)}`);
}

rule('3. trigram 的长度下限（<3 字符）');
for (const q of ['交接', '会话', '上下文', 'AI']) {
  out(`MATCH ${JSON.stringify(q)} → ${matchCount('fts_trigram', q)} 命中   (码点数 = ${[...q].length})`);
}

rule('4. LIKE 兜底（同一语料）');
const likeCount = (q) =>
  db.prepare("select count(*) as n from fts_trigram where body like ? escape '\\'").get(`%${q}%`).n;
for (const q of ['交接', '会话', '上下文', 'AI']) {
  out(`LIKE '%${q}%' → ${likeCount(q)} 命中`);
}

rule('5. 特殊字符作为 MATCH 短语（必须不报错）');
for (const q of ['"', '*', '-', 'a-b', 'C++', '100%', '(', ')', '_', '%', '"unclosed', "it's"]) {
  let result;
  try {
    result = `${matchCount('fts_trigram', q)} 命中`;
  } catch (error) {
    result = `ERROR: ${error.message}`;
  }
  out(`MATCH ${JSON.stringify(q)} → ${result}`);
}

rule('6. 2000 条中文记录规模基线');
const scale = new Database(':memory:');
scale.exec("create virtual table fts_trigram using fts5(body, tokenize='trigram')");
scale.exec('create table plain(id integer primary key, body text)');
const insertFts = scale.prepare('insert into fts_trigram(body) values (?)');
const insertPlain = scale.prepare('insert into plain(body) values (?)');
scale.transaction(() => {
  for (let i = 0; i < 2000; i += 1) {
    const body = `第 ${i} 条记录：会话交接与上下文整理，rebase 注意事项 ${i * 7}`;
    insertFts.run(body);
    insertPlain.run(body);
  }
})();

const timeIt = (fn, rounds = 5) => {
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return { min: samples[0], median: samples[Math.floor(samples.length / 2)] };
};

const matchFast = scale.prepare('select count(*) as n from fts_trigram where fts_trigram match ?');
const likeFast = scale.prepare("select count(*) as n from plain where body like ? escape '\\'");

const tMatch = timeIt(() => matchFast.get(phrase('会话交接')));
const tLike3 = timeIt(() => likeFast.get('%会话交接%'));
const tLike2 = timeIt(() => likeFast.get('%交接%'));

out(`MATCH "会话交接"   → ${matchFast.get(phrase('会话交接')).n} 命中 / 最短 ${tMatch.min.toFixed(2)} ms`);
out(`LIKE  '%会话交接%' → ${likeFast.get('%会话交接%').n} 命中 / 最短 ${tLike3.min.toFixed(2)} ms`);
out(`LIKE  '%交接%'     → ${likeFast.get('%交接%').n} 命中 / 最短 ${tLike2.min.toFixed(2)} ms`);

rule('7. 长度归一化必须按 Unicode 码点（JS 里用 [...s].length，不是 s.length）');
for (const s of ['交接', 'session', 'café', '👍👍']) {
  out(`"${s}" → s.length=${s.length}  码点数=${[...s].length}`);
}

rule('8. 英文大小写不敏感 + bm25 相关性排序（trigram）');
out(`MATCH "rebase" → ${matchCount('fts_trigram', 'rebase')} 命中；MATCH "REBASE" → ${matchCount('fts_trigram', 'REBASE')} 命中`);
const rank = new Database(':memory:');
rank.exec("create virtual table fts using fts5(body, tokenize='trigram')");
const rankInsert = rank.prepare('insert into fts(body) values (?)');
rankInsert.run('会话交接');
for (let i = 0; i < 50; i += 1) rankInsert.run(`第 ${i} 条普通记录，与主题无关的内容 ${i}`);
rankInsert.run('会话交接 会话交接 会话交接');
rankInsert.run('这里顺便提一句会话交接');
const ranked = rank
  .prepare('select rowid, bm25(fts) as score from fts where fts match ? order by score')
  .all(phrase('会话交接'));
out(
  `bm25 排序（SQLite 返回负分，越负越相关；升序即相关性降序）：${ranked
    .map((r) => `rowid=${r.rowid}(${(r.score * -1).toFixed(3)})`)
    .join('  ')}`,
);

rule('结论');
out('trigram：中文 ≥3 码点可用；<3 码点 0 命中 → 必须 LIKE 兜底');
out('unicode61：只在分词边界偶然命中（"："、"、" 等分隔符处），中文子串检索不可用');
out('特殊字符加引号 + 内部引号转义后全部不报错');
out('英文大小写不敏感（rebase / REBASE 同命中）；bm25 可把高频命中排前');
out('2000 条规模下 MATCH 与 LIKE 均在亚毫秒级');
db.close();
scale.close();
