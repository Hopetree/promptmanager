// 阶段 63（FR-131 / AC-125 C）：**交付文档与现状对齐** + CI 的「引用的仓库内路径必须存在」检查。
//
// 这个文件做三件事：
// ① 检查器本身自检（在本仓库上必须绿）；
// ② 检查器的**红绿对照**与**假阳性反例**（`--root` 指向临时目录，不碰真仓库）；
// ③ 文档里写死的数字必须等于**现场数出来的数字**（迁移数 / schema 版本 / 测试文件数 / 用例数）——
//    这一类数字以前就是靠人手抄，抄错了没人发现，所以让它进测试。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(ROOT, 'tools/check-doc-paths.mjs');

function readSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function runChecker(root: string): { status: number; stdout: string } {
  const result = spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout ?? '' };
}

/** 造一个临时仓库根，按 `相对路径 -> 内容` 铺文件（`--root` 用，不碰真仓库）。 */
function makeTempRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-s63-doc-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function withTempRoot<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = makeTempRoot(files);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 现场数出来的真实数字。 */
const MIGRATION_FILES = readdirSync(path.join(ROOT, 'migrations')).filter((name) => name.endsWith('.sql'));
const TEST_FILES = readdirSync(path.join(ROOT, 'tests')).filter((name) => name.endsWith('.test.ts'));
const TEST_CASES = TEST_FILES.reduce(
  (total, name) => total + (readFileSync(path.join(ROOT, 'tests', name), 'utf8').match(/^test\(/gm) ?? []).length,
  0,
);

// —— ① 检查器自检 ——————————————————————————————————————————————————————

test('阶段63 ⑫a：检查器在本仓库上必须是绿的（rc=0 且「不存在 0 条」）', () => {
  const { status, stdout } = runChecker(ROOT);
  assert.equal(status, 0, `检查器必须绿：\n${stdout}`);
  assert.match(stdout, /不存在 0 条/);
  assert.match(stdout, /✅ 所有引用都指向真实存在的路径。/);
});

test('阶段63 ⑫b：检查器是 CI 的**独立一项**（①d），不是挂在别的步骤里', () => {
  const ci = readSource('tools/ci-check.sh');
  assert.match(ci, /①d 文档路径引用/, '文件头步骤表必须列出 ①d');
  assert.match(ci, /node tools\/check-doc-paths\.mjs/, 'ci-check 必须真的调用检查器');
  assert.match(ci, /record "①d 文档路径引用" \$\?/, '①d 必须有自己的一行 record（独立成败）');
});

// —— ② 红绿对照 + 假阳性反例 ————————————————————————————————————————————

test('阶段63 ⑬a：红绿对照 —— 引用不存在的路径 ⇒ rc=1；补上文件 ⇒ rc=0', () => {
  withTempRoot({ 'README.md': '见 `docs/missing.md` 的说明。\n' }, (dir) => {
    const red = runChecker(dir);
    assert.equal(red.status, 1, `死链必须判红：\n${red.stdout}`);
    assert.match(red.stdout, /❌ 引用了不存在的路径：docs\/missing\.md {2}<- README\.md:1/);
    assert.match(red.stdout, /不存在 1 条/);

    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/missing.md'), '# 补上了\n');
    const green = runChecker(dir);
    assert.equal(green.status, 0, `补上文件后必须转绿：\n${green.stdout}`);
    assert.match(green.stdout, /不存在 0 条/);
  });
});

test('阶段63 ⑬b：假阳性反例 —— 库外 tmp/ 与通配写法豁免、裸文件名忽略、包根 web/ 能解析', () => {
  withTempRoot(
    {
      'README.md': [
        '库外过程态：`tmp/dev-process/BRIEF.md`（豁免）',
        '通配写法：`tmp/dev-process/tools/' + ['ac-', 'stage'].join('') + '*.sh`（豁免）',
        '裸文件名：`app.ts`（不是路径声明，忽略）',
        '包根简写：`src/api.ts` 指 `web/src/api.ts`',
        '目录引用：`docs/`',
        '',
      ].join('\n'),
      'web/src/api.ts': '// 假装是前端 API 客户端\n',
      'docs/README.md': '# docs\n',
    },
    (dir) => {
      const { status, stdout } = runChecker(dir);
      assert.equal(status, 0, `这些都不该判死链：\n${stdout}`);
      // 只有 `src/api.ts`、`web/src/api.ts` 与 `docs/` 三条真正参与判定（其余豁免/忽略）
      assert.match(stdout, /检查 3 条，不存在 0 条/);
    },
  );
});

test('阶段63 ⑬c：目录引用同样要存在（`docs/nope/` ⇒ rc=1）', () => {
  withTempRoot({ 'README.md': '见 `docs/nope/` 目录。\n' }, (dir) => {
    const { status, stdout } = runChecker(dir);
    assert.equal(status, 1, `不存在的目录引用必须判红：\n${stdout}`);
    assert.match(stdout, /docs\/nope\//);
  });
});

test('阶段63 ⑬d：测试文件只看注释行（代码里的字符串不算路径声明）', () => {
  withTempRoot(
    {
      'tests/sample.test.ts': [
        "import assert from 'node:assert/strict';",
        "// 证据在 `docs/ghost.md`（注释行 ⇒ 参与判定）",
        "assert.equal(readme.includes('docs/ghost.md'), false); // 行尾注释不解析，代码更不算",
        '',
      ].join('\n'),
      'docs/README.md': '# docs\n',
    },
    (dir) => {
      const { status, stdout } = runChecker(dir);
      assert.equal(status, 1, `注释行里的死链必须判红：\n${stdout}`);
      assert.match(stdout, /docs\/ghost\.md {2}<- tests\/sample\.test\.ts:2/);
      assert.match(stdout, /不存在 1 条/, '代码里那处同名写法不得被当成第二条死链');
    },
  );
});

// —— ③ 文档数字必须等于现场数出来的数字 ————————————————————————————————

test('阶段63 ⑬e：AGENTS.md / docs/development.md 的迁移数与 schema 版本等于现场实测', () => {
  const count = MIGRATION_FILES.length;
  const version = count; // 001…NNN 连续编号 ⇒ schema 版本号 == 迁移文件数
  const last = MIGRATION_FILES[MIGRATION_FILES.length - 1];
  const agents = readSource('AGENTS.md');
  assert.match(agents, new RegExp(`\\| \`migrations/\` \\| \`001_init\\.sql\` \\.\\.\\. \`${last}\``));
  assert.match(agents, new RegExp(`\\(\\*\\*${String(count)} files\\*\\*`));
  assert.match(agents, new RegExp(`There are \\*\\*${String(count)}\\*\\* files today`));
  assert.match(agents, new RegExp(`ok: schema at v${String(version)}`));
  assert.match(readSource('docs/development.md'), new RegExp(`ok: schema at v${String(version)}`));
});

test('阶段63 ⑬f：AGENTS.md 不得再硬编码版本号（`1.5.0` 一律换成「以 package.json 为准」）', () => {
  const agents = readSource('AGENTS.md');
  assert.doesNotMatch(agents, /1\.5\.0/, '硬编码的项目版本号会静默过期（AGENTS.md §1 自己就禁止）');
  assert.match(agents, /<the version in package\.json>/, '健康检查示例必须指向 package.json');
});

test('阶段63 ⑬g：测试文件数与用例数等于现场实测（AGENTS.md §4/§7 与 CHANGELOG）', () => {
  const files = String(TEST_FILES.length);
  const cases = String(TEST_CASES);
  const agents = readSource('AGENTS.md');
  assert.match(agents, new RegExp(`\`node:test\` cases \\(${files} \`\\*\\.test\\.ts\` files\\)`));
  assert.match(agents, new RegExp(`\\(${files} files, \\*\\*${cases}\\*\\* cases at the last update\\)`));
  const changelog = readSource('CHANGELOG.md');
  assert.match(changelog, new RegExp(`\`node:test\`，${files} 个测试文件 / \\*\\*${cases} 个用例\\*\\*`));
});

test('阶段63 ⑬h：质量门步数与检查器一致（文档说九步，脚本文件头列 ⓪①①b①c①d②③④⑤）', () => {
  const ci = readSource('tools/ci-check.sh');
  assert.match(ci, /^#\s+⓪/m);
  for (const step of ['①', '①b', '①c', '①d', '②', '③', '④', '⑤']) {
    assert.match(ci, new RegExp(`^#\\s+${step}\\s`, 'm'), `ci-check.sh 文件头必须列出步骤 ${step}`);
  }
  const dev = readSource('docs/development.md');
  assert.match(dev, /依次跑\*\*九步\*\*/);
  assert.match(dev, /①d/, 'docs/development.md 的步骤表必须包含 ①d');
});

test('阶段63 ⑬i：测试注释里不再有悬空引用（旧口径词与库外脚本名归零）', () => {
  // 拼出来而不是写死：否则这条用例自己的断言文案就会把它要禁的词带进本文件。
  const bannedWord = ['本地', '验收记录'].join('');
  const bannedScript = ['ac-', 'stage'].join('');
  for (const name of TEST_FILES) {
    const text = readFileSync(path.join(ROOT, 'tests', name), 'utf8');
    assert.equal(text.includes(bannedWord), false, `${name} 里不该再出现旧口径词（过程态是库外的）`);
    assert.equal(text.toLowerCase().includes(bannedScript), false, `${name} 里不该再出现库外脚本名`);
  }
});

test('阶段63 ⑬j：AGENTS.md §13 的库外过程态都写成 `tmp/dev-process/` 前缀（不再冒充仓库内路径）', () => {
  const agents = readSource('AGENTS.md');
  for (const rel of ['BRIEF.md', 'PROGRESS.md', 'VERIFY.md', 'QUESTIONS.md']) {
    assert.match(agents, new RegExp(`tmp/dev-process/${rel}`), `§13 必须把 ${rel} 写成库外路径`);
  }
  assert.match(agents, /tmp\/dev-process\/docs\/dev-history\//);
  assert.match(agents, /these process records are deliberately \*\*not\*\* committed/);
});
