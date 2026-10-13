// 阶段 63（FR-131 / AC-125 C）：**交付文档与现状对齐** + CI 的「引用的仓库内路径必须存在」检查。
import { CURRENT_SCHEMA_VERSION, MIGRATION_COUNT, MIGRATION_FILES } from './migrations.ts';
//
// 这个文件做三件事：
// ① 检查器本身自检（在本仓库上必须绿）；
// ② 检查器的**红绿对照**与**假阳性反例**（`--root` 指向临时目录，不碰真仓库）；
// ③ 文档里写死的数字必须等于**现场数出来的数字**（迁移数 / schema 版本 / 测试文件数 / 用例数）——
//    这一类数字以前就是靠人手抄，抄错了没人发现，所以让它进测试。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fileExists, readRaw, readSource } from './source-text.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(ROOT, 'tools/check-doc-paths.mjs');


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

/** 现场数出来的真实数字（迁移数从 tests/migrations.ts 派生）。 */
const TEST_FILES = readdirSync(path.join(ROOT, 'tests')).filter((name) => name.endsWith('.test.ts'));
const TEST_CASES = TEST_FILES.reduce(
  (total, name) => total + (readSource(path.join('tests', name)).match(/^test\(/gm) ?? []).length,
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
  const count = MIGRATION_COUNT;
  const version = CURRENT_SCHEMA_VERSION; // 唯一手写处（tests/migrations.ts）；count 是现场派生，两者必须一致
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

/**
 * 阶段 73（FR-160 / AC-135 A3，N20）：`tests/render/**` 也要被绊线覆盖。
 *
 * 背景：上面 ⑬g 的 `readdirSync(tests)` 是**非递归**的 ⇒ `tests/render/` 下的用例一个都不在计数里。
 * 评审删掉 `tests/render/stage68-token-prefetch.test.ts` 后 `npm test` 仍然全绿。
 * 这里给渲染级一套**独立的文件数 / 用例数下界**：删掉任意一个渲染测试文件（或任意一个 `test(` 块）
 * 都会让下界破掉 ⇒ 门禁变红。下界不是精确值：新增渲染测试不必改这里。
 */
const RENDER_TEST_FILES = readdirSync(path.join(ROOT, 'tests', 'render')).filter((name) =>
  name.endsWith('.test.ts'),
);
const RENDER_TEST_CASES = RENDER_TEST_FILES.reduce(
  (total, name) => total + (readSource(path.join('tests', 'render', name)).match(/^test\(/gm) ?? []).length,
  0,
);
// 下界随渲染级用例增长而抬（阶段 71 返工②：新增 tests/render/keyboard-shortcuts.test.ts 后抬到 17/64）。
const RENDER_TEST_FLOOR = { files: 17, cases: 64 };

test('阶段73 ⑬k：tests/render/** 有文件数与用例数下界绊线（删掉任一渲染测试必红）', () => {
  assert.ok(
    RENDER_TEST_FILES.length >= RENDER_TEST_FLOOR.files,
    `tests/render/ 的测试文件数 ${String(RENDER_TEST_FILES.length)} 低于下界 ${String(RENDER_TEST_FLOOR.files)} —— 渲染级用例被删了`,
  );
  assert.ok(
    RENDER_TEST_CASES >= RENDER_TEST_FLOOR.cases,
    `tests/render/ 的用例数 ${String(RENDER_TEST_CASES)} 低于下界 ${String(RENDER_TEST_FLOOR.cases)} —— 渲染级用例被删了`,
  );
  for (const name of RENDER_TEST_FILES) {
    const cases = (readSource(path.join('tests', 'render', name)).match(/^test\(/gm) ?? []).length;
    assert.ok(cases > 0, `tests/render/${name} 一个用例都没有（空文件等于被删）`);
  }
});

test('阶段63 ⑬h：质量门步数与检查器一致（文档说九步，脚本文件头列 ⓪①①b①c①d②③④⑤）', () => {
  // 文件头的步骤表**就是注释**：这条守的是"文档写全了"，所以按 AC-129 A2 的例外走 readRaw。
  const ciRaw = readRaw('tools/ci-check.sh');
  assert.match(ciRaw, /^#\s+⓪/m);
  for (const step of ['①', '①b', '①c', '①d', '②', '③', '④', '⑤']) {
    assert.match(ciRaw, new RegExp(`^#\\s+${step}\\s`, 'm'), `ci-check.sh 文件头必须列出步骤 ${step}`);
  }
  // 光看注释会假绿（注释列了 9 步、代码里少跑一步也照样过）⇒ 再对**代码**数一遍：
  // 每个步骤一次 `line "…"`，两边的步数必须相等。
  const ci = readSource('tools/ci-check.sh');
  const codeSteps = [...ci.matchAll(/^line "([^"]+)"/gm)].map((m) => m[1] ?? '');
  // 只取文件头**连续**的那段步骤表：后面「为什么」段落里也会出现 ①②，不能一起数进来。
  const docLines: string[] = [];
  let inList = false;
  for (const line of ciRaw.split('\n')) {
    if (/^#\s+[⓪①②③④⑤]/.test(line)) {
      inList = true;
      docLines.push(line);
    } else if (inList) break;
  }
  const docSteps = docLines.map((line) => /^#\s+([⓪①②③④⑤]\w*)\s/.exec(line)?.[1] ?? '');
  assert.equal(codeSteps.length, 9, `ci-check.sh 必须恰好跑 9 个步骤（实际 ${String(codeSteps.length)}）`);
  assert.equal(docSteps.length, codeSteps.length, `文件头列的步数（${String(docSteps.length)}）必须与代码里真跑的（${String(codeSteps.length)}）一致`);
  for (const [index, step] of docSteps.entries()) {
    assert.ok(codeSteps[index]?.startsWith(step), `第 ${String(index + 1)} 步：文件头写 ${step}，代码跑的是 ${String(codeSteps[index])}`);
  }
  const dev = readSource('docs/development.md');
  assert.match(dev, /依次跑\*\*九步\*\*/);
  assert.match(dev, /①d/, 'docs/development.md 的步骤表必须包含 ①d');
});

test('阶段63 ⑬i：测试注释里不再有悬空引用（旧口径词归零；验收脚本引用必须指向真实文件）', () => {
  // 拼出来而不是写死：否则这条用例自己的断言文案就会把它要禁的词带进本文件。
  const bannedWord = ['本地', '验收记录'].join('');
  const scriptName = ['ac-', 'stage'].join('');
  const scriptRef = new RegExp(`${scriptName}[\\w.-]*\\.(?:sh|mjs)`, 'gi');
  for (const name of TEST_FILES) {
    const text = readSource(path.join('tests', name));
    assert.equal(text.includes(bannedWord), false, `${name} 里不该再出现旧口径词（过程态是库外的）`);
    // FR-164 起验收脚本随仓库入库（tools/acceptance/）：测试里可以引用，但**必须指向真实文件** ——
    // 悬空引用仍要红（原来是一律禁止提到脚本名，脚本入库后那个口径就过期了）。
    for (const match of text.matchAll(scriptRef)) {
      assert.ok(
        fileExists(path.posix.join('tools', 'acceptance', match[0])),
        `${name} 引用了不存在的验收脚本 ${match[0]}`,
      );
    }
  }
});

test('阶段63 ⑬j：AGENTS.md §13 的库外过程态都写成 `tmp/dev-process/` 前缀（不再冒充仓库内路径）', () => {
  const agents = readSource('AGENTS.md');
  for (const rel of ['BRIEF.md', 'PROGRESS.md', 'VERIFY.md', 'QUESTIONS.md']) {
    assert.match(agents, new RegExp(`tmp/dev-process/${rel}`), `§13 必须把 ${rel} 写成库外路径`);
  }
  assert.match(agents, /tmp\/dev-process\/docs\/dev-history\//);
  assert.match(agents, /nothing you write under `tmp\/` is ever committed/);
});

// —— ④ 返工 ①（独立对抗性复核整改）：检查器要**按上下文解析相对引用**、
//     不能把 `#fragment` / 行尾标点 / 无扩展名说明符误判成死链，也不能被符号链接打崩。
//     每一条都对应复核报告里的一个 finding，判据都是"真仓库绿 + 临时仓库红/绿"。 ————————————

test('返工① a：`./` `../` 按「引用它的文件所在目录」解析 —— 真路径不误报、死链判红', () => {
  withTempRoot(
    {
      'docs/development.md': ['真路径：`../AGENTS.md`、`../deploy/container.md`、`./traps.md`', '死链：`../deploy/gone.md`', ''].join('\n'),
      'AGENTS.md': '# agents\n',
      'deploy/container.md': '# container\n',
      'docs/traps.md': '# traps\n',
    },
    (dir) => {
      const { status, stdout } = runChecker(dir);
      assert.equal(status, 1, `相对写法的死链必须判红：\n${stdout}`);
      assert.match(stdout, /❌ 引用了不存在的路径：\.\.\/deploy\/gone\.md {2}<- docs\/development\.md:2/);
      assert.match(stdout, /不存在 1 条/, '三条真路径不得被误判（否则就是 4 条）');
    },
  );
});

test('返工① b：`#fragment`、行尾标点、`<...>` 包裹都不算死链（正确引用不许被判红）', () => {
  withTempRoot(
    {
      'README.md': ['锚点：`docs/traps.md#12-文档与截图的落点`', '标点：`docs/traps.md，`', '尖括号链接：[说明](<docs/traps.md>)', ''].join('\n'),
      'docs/traps.md': '# traps\n',
    },
    (dir) => {
      const { status, stdout } = runChecker(dir);
      assert.equal(status, 0, `这三处都指向真实存在的 docs/traps.md：\n${stdout}`);
      assert.match(stdout, /不存在 0 条/);
    },
  );
});

test('返工① c：无扩展名的相对**模块说明符**（`./pure`）不是路径声明', () => {
  withTempRoot(
    {
      'tests/sample.test.ts': '// `web/src/api.ts` 里有 `./pure` 这种无扩展名相对导入（Vite 解析）\n',
      'web/src/api.ts': '// api\n',
    },
    (dir) => {
      const { status, stdout } = runChecker(dir);
      assert.equal(status, 0, `模块说明符不是"某个文件存在"的断言：\n${stdout}`);
      assert.match(stdout, /检查 1 条，不存在 0 条/, '只有 `web/src/api.ts` 参与判定');
    },
  );
});

test('返工① d：尖括号链接目标里的死链照样判红（剥掉 `<>` 不等于跳过）', () => {
  withTempRoot({ 'README.md': '[说明](<docs/gone.md>)\n' }, (dir) => {
    const { status, stdout } = runChecker(dir);
    assert.equal(status, 1, `尖括号里的死链必须判红：\n${stdout}`);
    assert.match(stdout, /❌ 引用了不存在的路径：docs\/gone\.md {2}<- README\.md:1/);
  });
});

test('返工① e：`docs/` 下的自指符号链接不会让检查器崩（不跟随链接）', () => {
  const dir = makeTempRoot({ 'docs/README.md': '# docs\n' });
  try {
    symlinkSync('..', path.join(dir, 'docs/sub-loop')); // 指向 docs/ 自己
    const { status, stdout } = runChecker(dir);
    assert.equal(status, 0, `检查器不得因符号链接崩掉：\n${stdout}`);
    assert.match(stdout, /检查 0 条，不存在 0 条/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('返工① f：`docs/development.md` 的迁移行也等于现场实测（不能只改 AGENTS.md）', () => {
  const dev = readSource('docs/development.md');
  const last = MIGRATION_FILES[MIGRATION_FILES.length - 1];
  assert.match(dev, new RegExp(`\\| \`migrations/\` \\| \`001_init\\.sql\` … \`${last}\``), '迁移行的末位必须等于目录里最后一个迁移');
  assert.match(dev, new RegExp(`（\\*\\*共 ${String(MIGRATION_FILES.length)} 个\\*\\*`), '迁移数必须等于现场实测');
});

test('返工① g：AGENTS.md §13 既说清「`tmp/` 不进历史」，也不谎称历史里没有旧快照', () => {
  const agents = readSource('AGENTS.md');
  assert.match(agents, /git log --all -- tmp\/` is empty/, 'AC-125 ⑧ 要求把「`git log --all -- tmp/` 为空」写进文档');
  assert.match(
    agents,
    /tracked \*\*before the 2026-09-30 slimming\*\*/,
    '瘦身前根目录的对应文件确实在 git 历史里，必须如实说明（且不得点名已不存在的旧路径，否则检查器会判死链）',
  );
  assert.match(agents, /\*\*older\*\* snapshot/, '要写清 git 历史里只有「旧快照」，没有当前过程文件');
  assert.doesNotMatch(agents, /not in git history either/, '「这些过程记录整体不在 git 历史里」是与事实不符的说法');
});

test('返工① h：`tests/` 下的自指符号链接同样不会让检查器崩（不只是 `docs/`）', () => {
  // 独立复核实测：walkMarkdown 会跳过符号链接，但 tests/*.test.ts 那条读文件路径没有防护，
  // 于是 `tests/` 下的自指 `.test.ts` 链接会让读文件抛 ELOOP 并把门禁打成红的（rc=1）。
  const dir = makeTempRoot({ 'README.md': '# t\n' });
  try {
    mkdirSync(path.join(dir, 'tests'), { recursive: true });
    symlinkSync('loop.test.ts', path.join(dir, 'tests', 'loop.test.ts'));
    const { status, stdout } = runChecker(dir);
    assert.equal(status, 0, `检查器不得因 tests/ 下的符号链接崩掉：${stdout}`);
    assert.match(stdout, /检查 0 条，不存在 0 条/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
