// 阶段 32 / FR-87（BRIEF v42 §4 + §8 AC-89）的**源码级**断言：`tools/ci-check.sh` 的步骤顺序。
//
// 为什么这里只做源码级断言、不做"删掉 dist 再跑一遍"的可执行断言：
//   `npm test` 是**并发**跑所有测试文件的，而很多用例要读 `dist/web`；在某个测试进程里 `rm -rf dist`
//   会把同批其它文件打挂（假红）。**真·干净环境的可执行验证**放在 `tools/ac-stage32.sh`（它先
//   `rm -rf dist` 再跑 `bash tools/ci-check.sh`，并断言 rc=0 + 6 项全绿）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(path.join(ROOT, 'tools', 'ci-check.sh'), 'utf8');
const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** 某个字符串在文件里的行号（1-based）；找不到返回 -1。 */
function lineOf(needle: string, text = ci): number {
  const at = text.indexOf(needle);
  return at < 0 ? -1 : text.slice(0, at).split('\n').length;
}

test('AC-89 ②：ci-check.sh 里「构建」必须排在「typecheck:tests」之前（干净环境才不报 TS2307）', () => {
  const build = lineOf('npm run build >"$LOG_DIR/build.log"');
  const typecheckTests = lineOf('npm run typecheck:tests >"$LOG_DIR/typecheck-tests.log"');
  const typecheckWeb = lineOf('npm run typecheck:web >"$LOG_DIR/typecheck-web.log"');
  const npmTest = lineOf('npm test >"$LOG_DIR/test.log"');

  assert.ok(build > 0, '找不到 ② 的构建命令');
  assert.ok(typecheckTests > 0, '找不到 typecheck:tests 命令');
  assert.ok(
    build < typecheckTests,
    `构建必须排在 typecheck:tests 之前（构建在第 ${String(build)} 行、typecheck:tests 在第 ${String(typecheckTests)} 行）`,
  );
  assert.ok(
    build < typecheckWeb,
    `构建也必须排在 typecheck:web 之前（同一段落顺序：构建 → 两个类型检查）`,
  );
  assert.ok(typecheckTests < npmTest, 'typecheck 仍应排在 npm test 之前');
});

test('AC-89 ②：脚本注释里写明了「为什么必须先构建」（否则下次有人会把顺序改回去）', () => {
  // 理由必须包含三个要素：测试 import 的是构建产物、干净环境没有 dist、症状是 TS2307
  assert.ok(ci.includes('为什么'), '注释必须显式回答"为什么必须先构建"');
  assert.ok(/import .*from '\.\.\/dist/.test(ci) || ci.includes("'../dist/"), '注释要指出测试 import 的是 ../dist/**');
  assert.ok(ci.includes('dist/'), '注释要提到 dist/');
  assert.ok(ci.includes('TS2307'), '注释要写明干净环境下的症状是 TS2307');
  assert.ok(ci.includes('rm -rf dist'), '注释要给出复现命令 rm -rf dist');
  assert.ok(ci.includes('38'), '注释要写明实测错误数（38）');
});

test('AC-89 ①：步骤编号与行数不变 —— 仍是 6 项，顺序为 依赖 → 构建 → 类型检查 → 测试 → 体积预算', () => {
  // 每个步骤有"成功/失败"两个分支各调一次 record，所以按出现顺序去重后再比
  const records = [...new Set([...ci.matchAll(/^\s*record "([^"]+)"/gm)].map((m) => m[1]))];
  assert.equal(records.length, 6, `ci-check.sh 必须仍恰好 6 项（实际 ${String(records.length)}：${records.join(' / ')}）`);
  assert.deepEqual(records, [
    '① 依赖已安装',
    '② npm run build',
    '③a typecheck:web',
    '③b typecheck:tests',
    '④ npm test',
    '⑤ 体积预算（最大 chunk ≤ 500KB）',
  ]);
  // 旧的编号（②a/②b/③ npm test/④a/④b）不得残留，避免汇总表与文档对不上
  for (const stale of ['②a typecheck:web', '②b typecheck:tests', '④a npm run build', '④b 体积预算']) {
    assert.equal(ci.includes(`record "${stale}`), false, `ci-check.sh 里仍残留旧编号：${stale}`);
  }
});

test('AC-89 ③：`typecheck:tests` 自己声明了构建前置 —— 裸跑（先删 dist）也必须 0 错误', () => {
  // AC-89 ③ 的字面命令是 `rm -rf dist && npm run typecheck:tests` → 期望 0 个错误。
  // 只调 ci-check 的顺序**不足以**满足它（裸跑仍然会 38 个 TS2307），所以脚本自身要带构建前缀。
  const script = pkg.scripts['typecheck:tests'] ?? '';
  assert.ok(
    /^npm run build:server && /.test(script),
    `typecheck:tests 必须以 \`npm run build:server &&\` 开头（实际：${JSON.stringify(script)}）`,
  );
  assert.ok(/tsc -p tsconfig\.tests\.json/.test(script), '前缀之后仍必须是原来的 tsc 命令');
  // 不得顺手改动别的脚本（本阶段只允许这一处）
  assert.equal(pkg.scripts.build, 'npm run build:server && npm run build:web', 'build 脚本未变');
  assert.equal(pkg.scripts['typecheck:web'], 'tsc -p web/tsconfig.json', 'typecheck:web 脚本未变');
  assert.equal(
    pkg.scripts.test,
    'npm run build && npm run typecheck:tests && node --test "tests/**/*.test.ts"',
    'test 脚本未变（仍是官方入口：build → typecheck:tests → node --test）',
  );
});

test('AC-89：CI workflow 未改（仍是 npm ci + 同一套脚本；触发条件/Node 版本/无 secrets 都不变）', () => {
  assert.ok(/node-version: '24'/.test(workflow), 'workflow 必须仍用 Node 24');
  assert.ok(/run: npm ci/.test(workflow), 'workflow 仍只做 npm ci');
  assert.ok(/run: bash tools\/ci-check\.sh/.test(workflow), 'workflow 仍调同一个脚本');
  assert.ok(/permissions:\s*\n\s*contents: read/.test(workflow), '仍只有 contents: read 权限');
  assert.equal(/secrets\./.test(workflow), false, '不得引用任何 secrets');
  assert.ok(/on:\s*\n\s*push:/.test(workflow) && /pull_request:/.test(workflow), '触发条件仍是 push + PR');
});
