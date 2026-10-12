// 阶段 67 返工 ①：`tests/source-text.ts` 剥注释器的守卫用例。
//
// 为什么要有这个文件：FR-139 把「扫源码的断言」统一压到剥注释入口上，剥注释器本身
// 于是成了**所有源码级断言的公共地基**。它剥多了（把代码/字符串也擦掉）或剥少了
// （注释还在），都会让上层断言假红或假绿 —— 而两者都不会被上层用例发现。
// 这里的用例来自一轮独立对抗性复核（`var/s67-review/strip-probe.ts` 的产物）：
//   ① `{` 紧邻块注释被误删（对象字面量里的 `{\n /** JSDoc */`、空对象 `{ /* c */ }`）；
//   ② SQL 不认单引号字符串 ⇒ `'read'` / `'view'` 这类字面量被当注释擦掉；
//   ③ YAML / shell 的行内 `#` 注释未剥。
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PROJECT_ROOT, readRaw, sourceKindOf, stripSourceComments } from './source-text.ts';

/** 递归列出某目录下所有文件（相对仓库根）。 */
function filesUnder(relativeDir: string): string[] {
  const root = path.join(PROJECT_ROOT, relativeDir);
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesUnder(relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

/** 长度与换行数必须守恒：剥注释只把注释字符换成空格，不动行结构。 */
function assertShapePreserved(raw: string, clean: string, label: string): void {
  assert.equal(clean.length, raw.length, `${label}：剥注释后长度必须不变`);
  assert.equal(
    clean.split('\n').length,
    raw.split('\n').length,
    `${label}：剥注释后换行数必须不变`,
  );
}

test('FR-139：字符串 / 模板串 / 正则 / 除号里的伪注释不被误剥', () => {
  const source = [
    `const url = 'https://example.test/x'; // 真注释`,
    'const tpl = `a // b /* c */ d`; // 尾注释',
    'const re = /a\\/b/; // 注释',
    'const ratio = total / count; // 注释',
  ].join('\n');
  const clean = stripSourceComments(source, 'code');
  assertShapePreserved(source, clean, 'TS 语料');
  assert.ok(clean.includes(`'https://example.test/x'`), '字符串里的 // 必须保留');
  assert.ok(clean.includes('`a // b /* c */ d`'), '模板串里的 // 与 /* 必须保留');
  assert.ok(clean.includes('/a\\/b/'), '正则字面量必须保留');
  assert.ok(clean.includes('total / count'), '除号必须保留');
  assert.equal(clean.includes('真注释'), false, '行尾注释必须被剥');
  assert.equal(clean.includes('尾注释'), false, '模板串后的注释必须被剥');
});

test('FR-139：JSX 注释外壳 `{/* … */}` 连外层花括号一起去掉', () => {
  const source = 'const x = (<div>{/* hello */}PromptM</div>);\n';
  const clean = stripSourceComments(source, 'code');
  assertShapePreserved(source, clean, 'JSX 注释');
  assert.equal(clean.includes('hello'), false, 'JSX 注释内容必须被剥');
  assert.equal(clean.includes('{'), false, 'JSX 注释外壳的左花括号也必须被剥（否则留空表达式容器）');
  assert.ok(clean.includes('PromptM'), '注释外的文本必须保留');
});

test('FR-139 返工①：对象字面量里的 `{` + JSDoc 不能被当成 JSX 外壳擦掉', () => {
  const source = ['const spec = {', '  /** DB 列类型 */', '  sql: string;', '};'].join('\n');
  const clean = stripSourceComments(source, 'code');
  assertShapePreserved(source, clean, '对象字面量');
  assert.equal(clean.includes('DB 列类型'), false, 'JSDoc 内容必须被剥');
  assert.ok(clean.startsWith('const spec = {'), '开括号必须留在原位');
  assert.ok(clean.trimEnd().endsWith('};'), '闭括号必须留在原位');
});

test('FR-139 返工①：空对象与 catch 块里的 `/* … */` 只擦注释、不擦花括号', () => {
  for (const source of ['const empty = { /* 隐私模式忽略 */ };', 'try {\n} catch { /* 隐私模式忽略 */ }']) {
    const clean = stripSourceComments(source, 'code');
    assertShapePreserved(source, clean, '块注释外壳');
    assert.equal(clean.includes('隐私模式忽略'), false, '注释内容必须被剥');
    assert.equal(
      (clean.match(/\{/g) ?? []).length,
      (source.match(/\{/g) ?? []).length,
      `花括号数量必须不变：${source}`,
    );
    assert.equal(
      (clean.match(/\}/g) ?? []).length,
      (source.match(/\}/g) ?? []).length,
      `闭花括号数量必须不变：${source}`,
    );
  }
});

test('FR-139 返工①：真实源码全量 —— `{` 后紧跟块注释的开括号一律保留、长度与换行守恒、剥两遍等价', () => {
  const files = [...filesUnder('src'), ...filesUnder('web/src')].filter((file) => /\.tsx?$/.test(file));
  assert.ok(files.length > 50, `语料应有足够多文件，实测 ${String(files.length)} 个`);
  let checkedOpenBrace = 0;
  for (const file of files) {
    const raw = readRaw(file);
    const clean = stripSourceComments(raw, sourceKindOf(file));
    assertShapePreserved(raw, clean, file);
    assert.equal(
      stripSourceComments(clean, sourceKindOf(file)),
      clean,
      `${file}：剥注释必须幂等`,
    );
    // `{` + 空白 + 块注释（对象字面量 + JSDoc 的典型形态）：开括号必须原样留下。
    for (const match of raw.matchAll(/\{[ \t]*\n[ \t]*\/\*/g)) {
      const index = match.index;
      assert.equal(clean[index], '{', `${file} @${String(index)}：对象字面量的开括号被误擦`);
      checkedOpenBrace += 1;
    }
    // JSX 外壳 `{/*` 必须整块消失（左括号不能留下）。
    for (const match of raw.matchAll(/\{\/\*/g)) {
      const index = match.index;
      assert.equal(clean[index], ' ', `${file} @${String(index)}：JSX 注释外壳没被清干净`);
    }
  }
  assert.ok(checkedOpenBrace > 10, `语料里应命中足够多的「对象字面量 + JSDoc」，实测 ${String(checkedOpenBrace)} 处`);
});

test('FR-139 返工①：SQL 的单引号字符串不被当注释吃掉，注释本身要剥', () => {
  const source = [
    "UPDATE api_tokens SET scope = 'read' WHERE scope = 'write'; -- 行尾注释",
    "INSERT INTO t VALUES ('a -- b', '/* x */');",
    'SELECT /* 块注释 */ 1;',
    "INSERT INTO t VALUES ('it''s');",
  ].join('\n');
  const clean = stripSourceComments(source, 'sql');
  assertShapePreserved(source, clean, 'SQL 语料');
  assert.ok(clean.includes("'read'"), '字符串字面量 read 必须保留');
  assert.ok(clean.includes("'write'"), '字符串字面量 write 必须保留');
  assert.ok(clean.includes("'a -- b'"), '字符串里的 -- 必须保留');
  assert.ok(clean.includes("'/* x */'"), '字符串里的 /* */ 必须保留');
  assert.ok(clean.includes("'it''s'"), "SQL 的 '' 转义必须保留");
  assert.equal(clean.includes('行尾注释'), false, 'SQL 行尾注释必须被剥');
  assert.equal(clean.includes('块注释'), false, 'SQL 块注释必须被剥');
});

test('FR-139 返工①：真实迁移文件里**代码层**的字符串字面量一个都不能少', () => {
  const migrations = filesUnder('migrations').filter((file) => file.endsWith('.sql'));
  assert.ok(migrations.length >= 8, `迁移文件应有 8 个，实测 ${String(migrations.length)} 个`);
  let literals = 0;
  for (const file of migrations) {
    const raw = readRaw(file);
    const clean = stripSourceComments(raw, 'sql');
    assertShapePreserved(raw, clean, file);
    for (const match of raw.matchAll(/'[^'\n]*'/g)) {
      // 注释是**应该**被剥掉的，所以只检查不在 `--` 注释行上的字面量
      // （本仓迁移里的 `'read'` / `'view'` 这类说明文字大量出现在注释里，那不是被吃掉）。
      const lineStart = raw.lastIndexOf('\n', match.index) + 1;
      const line = raw.slice(lineStart, raw.indexOf('\n', match.index) === -1 ? raw.length : raw.indexOf('\n', match.index));
      if (line.trimStart().startsWith('--')) continue;
      assert.ok(clean.includes(match[0]), `${file} @${String(match.index)}：代码里的字面量 ${match[0]} 被注释剥掉了`);
      literals += 1;
    }
  }
  assert.ok(literals > 10, `迁移的代码里应命中足够多的字符串字面量，实测 ${String(literals)} 个`);
});

test('FR-139 返工①：YAML / shell 的行内 `#` 注释也要剥，引号内与 `${VAR#x}` 要保留', () => {
  const source = [
    'key: 1 # 行内说明',
    'full: ",# not a comment"',
    'url: "https://x.test/#frag" # 真注释',
    '# 整行注释',
    'echo "$HOME" # 尾注释',
    'bare=${PATH#/usr}',
    'nospace=foo#bar',
  ].join('\n');
  const clean = stripSourceComments(source, 'hash');
  assertShapePreserved(source, clean, 'YAML / shell 语料');
  assert.equal(clean.includes('行内说明'), false, '行内注释必须被剥');
  assert.equal(clean.includes('整行注释'), false, '整行注释必须被剥');
  assert.equal(clean.includes('尾注释'), false, 'shell 行尾注释必须被剥');
  assert.ok(clean.includes('",# not a comment"'), '引号里的 # 必须保留');
  assert.ok(clean.includes('"https://x.test/#frag"'), '引号里的 URL 片段必须保留');
  assert.ok(clean.includes('${PATH#/usr}'), 'shell 参数展开里的 # 必须保留');
  assert.ok(clean.includes('foo#bar'), '紧贴的 # 不是注释，必须保留');
});

test('FR-139 返工①：真实 ci.yml 与 ci-check.sh 的行内注释已被剥掉', () => {
  for (const file of ['.github/workflows/ci.yml', 'tools/ci-check.sh']) {
    const raw = readRaw(file);
    const clean = stripSourceComments(raw, sourceKindOf(file));
    assertShapePreserved(raw, clean, file);
    const inlineComment = /[ \t]#[ \t]+\S/;
    assert.ok(inlineComment.test(raw), `${file}：夹具假设它含行内注释`);
    assert.equal(inlineComment.test(clean), false, `${file}：行内注释没被剥干净`);
  }
});
