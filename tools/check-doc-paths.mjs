#!/usr/bin/env node
/**
 * 文档 / 测试注释里引用的**仓库内路径必须存在**（FR-131 / AC-125 ⑫⑬⑬b）。
 *
 * 为什么要有这个检查：`AGENTS.md` 是 AI 代理唯一会读的指令文件，`CHANGELOG.md` / `docs/**` 是交付文档，
 * `tests/*.test.ts` 的注释是"这条用例的证据在哪"的指路牌 —— 三者都出现过**指向已删除文件**的引用
 * （仓库瘦身把 `docs/dev-history/` 移出、验收脚本从 `tmp/dev-process/tools/` 搬进 `tools/acceptance/` 之后，
 * 引用没跟着改）。
 * 靠人记不住，所以让它变成 CI 的一步：引用不存在的路径 ⇒ 这一步红。
 *
 * 扫描范围（与 AC-125 ⑫ 一致，不扩大）：
 *   - 仓库根：`AGENTS.md` / `CHANGELOG.md` / `CONTRIBUTING.md` / `README.md` / `SECURITY.md`
 *   - `docs/**\/*.md`
 *   - `tests/*.test.ts` 的**注释行**（`//`、`/*`、`*` 开头的行；行尾注释不解析）
 *
 * 判定规则（故意保守 —— 宁可漏报，不要误报把真路径判成死链）：
 *   1. 只认**含 `/`** 的 token（裸文件名如 `app.ts`、`index.ts` 是简称，不是路径声明）；
 *   2. token 要么以仓库已知顶层目录开头（`src/ web/ tests/ docs/ tools/ migrations/ deploy/ bin/ scripts/ dist/ tmp/ var/`），
 *      要么是**显式相对写法**（`./x` / `../x`）；
 *   3. 含 `*` 的 token 一律跳过 —— 通配/占位写法（`tmp/dev-process/tools/ac-stage*.sh`、`migrations/NNN_*.sql`、
 *      `tests/**\/*.test.ts`）不是"某个文件存在"的断言；
 *   4. **豁免库外与构建产物**（`tmp/`、`dist/`、`node_modules/`、`var/`、`.git/`）——
 *      `tmp/` 是本仓库**有意**不入库的本地过程态（`AGENTS.md` §13），不该被当成死链；
 *   5. 按上下文解析，**不裸匹配**：
 *      - `./x` / `../x` ⇒ 相对**引用它的那个文件所在目录**（`docs/development.md` 里的
 *        `../deploy/container.md` 指仓库根的 `deploy/container.md`）；解析结果若逃出仓库则不管；
 *      - 其余 ⇒ 先当**相对仓库根**，再当**相对包根**（`web/`）——
 *        测试注释里写 `src/api.ts` 指的是 `web/src/api.ts`（`src/api.ts` 是相对 `web/` 的写法）；
 *   6. 目录引用（`docs/dev-history/`）同样要求存在；
 *   7. 判定前先剥掉**不属于路径的部分**：markdown 的 `<...>` 包裹、`#fragment`（`docs/traps.md#12` 指
 *      `docs/traps.md`）、行尾标点（`docs/ok.md，`）—— 否则正确引用会被误判成死链。
 *
 * 用法：node tools/check-doc-paths.mjs [--root <dir>]   # --root 供红绿对照测试用，默认仓库根
 * 退出码：0 = 全部存在；1 = 有引用指向不存在的路径（逐条打印 `文件:行号`）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** 已知顶层目录：只有以它们开头的 token 才当路径看。 */
const TOP_LEVEL = ['src/', 'web/', 'tests/', 'docs/', 'tools/', 'migrations/', 'deploy/', 'bin/', 'scripts/', 'dist/', 'tmp/', 'var/'];
/** 库外 / 构建产物：不在仓库里本来就正常。 */
const EXEMPT = /^(tmp|dist|node_modules|var|\.git)\//;
/** 解析基准：仓库根，以及包根 `web/`（`src/x.ts` 的简写指 `web/src/x.ts`）。 */
const BASES = ['.', 'web'];
/** 根目录下要扫的 markdown。 */
const ROOT_DOCS = ['AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'README.md', 'SECURITY.md'];

function walkMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 读不了的目录跳过：检查器不该因为一个坏目录崩掉
  }
  for (const entry of entries) {
    // 不跟随符号链接：`docs/` 下出现自指链接会让递归 ELOOP 崩掉（且链接不是仓库内容）
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

function targets(root) {
  const files = [];
  for (const name of ROOT_DOCS) {
    const abs = path.join(root, name);
    if (existsSync(abs)) files.push(abs);
  }
  files.push(...walkMarkdown(path.join(root, 'docs')));
  const testsDir = path.join(root, 'tests');
  if (existsSync(testsDir)) {
    for (const entry of readdirSync(testsDir, { withFileTypes: true })) {
      // 与 walkMarkdown 同一纪律：不跟随符号链接（`tests/` 下的自指链接会让下面的 readFileSync 抛 ELOOP）
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(path.join(testsDir, entry.name));
    }
  }
  return files;
}

const isTestFile = (abs) => abs.endsWith('.test.ts');
const isRelativePath = (token) => token.startsWith('./') || token.startsWith('../');

/** 一行里所有"可能是路径"的 token（markdown 取行内 code span 与链接目标；测试取注释行的词）。 */
function tokensOfLine(line, testFile) {
  const out = [];
  if (testFile) {
    if (!/^\s*(\/\/|\*|\/\*)/.test(line)) return out; // 只看注释行
    for (const raw of line.split(/[\s，。；：、（）()「」`'"]+/)) out.push(raw);
    return out;
  }
  for (const match of line.matchAll(/`([^`\n]+)`/g)) out.push(match[1]);
  for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) out.push(match[1]);
  return out;
}

/** 剥掉不属于路径的部分：`<...>` 包裹、`#fragment`、行尾标点。 */
function normalizeToken(token) {
  let text = token.trim();
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim();
  const hash = text.indexOf('#');
  if (hash > 0) text = text.slice(0, hash); // `docs/traps.md#12` ⇒ `docs/traps.md`
  return text.replace(/[.,;:!?，。；：、！？)\]】》”’"']+$/u, '');
}

function looksLikePath(token) {
  if (token === '' || token.length > 120) return false;
  if (!token.includes('/')) return false;
  if (token.includes('*')) return false;
  if (/[\s=:<>|{}"'(),;$]/.test(token)) return false;
  if (/^https?:/.test(token) || token.startsWith('/') || token.startsWith('~') || token.startsWith('#')) return false;
  // 显式相对写法：必须是**文件**（末段带扩展名）或**目录**（以 `/` 收尾），
  // 否则 `./pure`（Vite 的无扩展名模块说明符）这类会被误判成死链。
  // 已知取舍：由此**无扩展名的相对文件引用不被判定**（例如 `./LICENSE` 缺失时不会报红）。
  // 今天仓库里没有这种写法；宁可漏报也不能误报 —— 门禁误报会把一份正确的文档判成红的。
  if (isRelativePath(token)) {
    const last = token.split('/').pop() ?? '';
    return token.endsWith('/') || last.includes('.');
  }
  return TOP_LEVEL.some((prefix) => token.startsWith(prefix));
}

/**
 * token 指向的**仓库内**绝对路径；库外、构建产物、或逃出仓库的写法返回 null（不判定）。
 * `relDir` = 引用它的那个文件相对仓库根的目录（供 `./` `../` 解析）。
 */
function resolve(root, relDir, token) {
  if (isRelativePath(token)) {
    const abs = path.resolve(root, relDir, token);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('..')) return null; // 逃出仓库：不管（不可能是"仓库内路径"）
    if (EXEMPT.test(`${rel}/`)) return null; // 解析进了库外/产物：豁免
    return abs;
  }
  if (EXEMPT.test(token)) return null;
  const hit = BASES.map((base) => path.join(root, base, token)).find((abs) => existsSync(abs));
  return hit ?? path.join(root, BASES[0], token); // 都不存在：报仓库根基准的那条
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = path.resolve(rootIndex === -1 ? process.cwd() : (args[rootIndex + 1] ?? process.cwd()));

  const findings = [];
  let checked = 0;
  for (const abs of targets(root)) {
    const rel = path.relative(root, abs);
    const relDir = path.dirname(rel);
    const testFile = isTestFile(abs);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue; // 读不了（链接环、权限、竞态删除）就不判定：门禁不得因环境问题崩掉
    }
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const raw of tokensOfLine(line, testFile)) {
        const token = normalizeToken(raw);
        if (!looksLikePath(token)) continue;
        const target = resolve(root, relDir, token);
        if (target === null) continue; // 库外 / 逃出仓库：不判定
        checked += 1;
        if (!existsSync(target)) {
          findings.push({ path: token, where: `${rel}:${String(index + 1)}` });
        }
      }
    });
  }

  for (const finding of findings) {
    console.log(`❌ 引用了不存在的路径：${finding.path}  <- ${finding.where}`);
  }
  console.log(`文档与测试注释里的仓库内路径引用：检查 ${String(checked)} 条，不存在 ${String(findings.length)} 条。`);
  if (findings.length > 0) {
    console.log('（库外 tmp/ 与构建产物 dist/ 已豁免；含 * 的通配写法不判定存在性。）');
    process.exit(1);
  }
  console.log('✅ 所有引用都指向真实存在的路径。');
}

main();
