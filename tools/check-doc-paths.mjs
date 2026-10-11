#!/usr/bin/env node
/**
 * 文档 / 测试注释里引用的**仓库内路径必须存在**（FR-131 / AC-125 ⑫⑬⑬b）。
 *
 * 为什么要有这个检查：`AGENTS.md` 是 AI 代理唯一会读的指令文件，`CHANGELOG.md` / `docs/**` 是交付文档，
 * `tests/*.test.ts` 的注释是"这条用例的证据在哪"的指路牌 —— 三者都出现过**指向已删除文件**的引用
 * （仓库瘦身把 `docs/dev-history/`、`tmp/dev-process/tools/ac-stage*.sh` 移出后，引用没跟着改）。
 * 靠人记不住，所以让它变成 CI 的一步：引用不存在的路径 ⇒ 这一步红。
 *
 * 扫描范围（与 AC-125 ⑫ 一致，不扩大）：
 *   - 仓库根：`AGENTS.md` / `CHANGELOG.md` / `CONTRIBUTING.md` / `README.md` / `SECURITY.md`
 *   - `docs/**\/*.md`
 *   - `tests/*.test.ts` 的**注释行**（`//`、`/*`、`*` 开头的行；行尾注释不解析）
 *
 * 判定规则（故意保守 —— 宁可漏报，不要误报把真路径判成死链）：
 *   1. 只认**含 `/`** 的 token（裸文件名如 `app.ts`、`index.ts` 是简称，不是路径声明）；
 *   2. token 必须以仓库已知顶层目录开头（`src/ web/ tests/ docs/ tools/ migrations/ deploy/ bin/ scripts/ dist/ tmp/ var/`）；
 *   3. 含 `*` 的 token 一律跳过 —— 通配/占位写法（`tmp/dev-process/tools/ac-stage*.sh`、`migrations/NNN_*.sql`、
 *      `tests/**\/*.test.ts`）不是"某个文件存在"的断言；
 *   4. **豁免库外与构建产物**（`tmp/`、`dist/`、`node_modules/`、`var/`、`.git/`）——
 *      `tmp/` 是本仓库**有意**不入库的本地过程态（`AGENTS.md` §13），不该被当成死链；
 *   5. 按上下文解析：先当**相对仓库根**，再当**相对包根**（`web/`）——
 *      测试注释里写 `src/api.ts` 指的是 `web/src/api.ts`（`src/api.ts` 是相对 `web/` 的写法）；
 *   6. 目录引用（`docs/dev-history/`）同样要求存在。
 *
 * 用法：node tools/check-doc-paths.mjs [--root <dir>]   # --root 供红绿对照测试用，默认仓库根
 * 退出码：0 = 全部存在；1 = 有引用指向不存在的路径（逐条打印 `文件:行号`）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) walkMarkdown(abs, out);
    else if (entry.endsWith('.md')) out.push(abs);
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
    for (const entry of readdirSync(testsDir)) {
      if (entry.endsWith('.test.ts')) files.push(path.join(testsDir, entry));
    }
  }
  return files;
}

const isTestFile = (abs) => abs.endsWith('.test.ts');

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

function looksLikePath(token) {
  if (token === '' || token.length > 120) return false;
  if (!token.includes('/')) return false;
  if (token.includes('*')) return false;
  if (/[\s=:<>|{}"'(),;$]/.test(token)) return false;
  if (/^https?:/.test(token) || token.startsWith('/') || token.startsWith('~') || token.startsWith('#')) return false;
  return TOP_LEVEL.some((prefix) => token.startsWith(prefix));
}

const exists = (root, base, token) => existsSync(path.join(root, base, token));

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = path.resolve(rootIndex === -1 ? process.cwd() : (args[rootIndex + 1] ?? process.cwd()));

  const findings = [];
  let checked = 0;
  for (const abs of targets(root)) {
    const rel = path.relative(root, abs);
    const testFile = isTestFile(abs);
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const token of tokensOfLine(line, testFile)) {
        const trimmed = token.trim();
        if (!looksLikePath(trimmed)) continue;
        if (EXEMPT.test(trimmed)) continue;
        checked += 1;
        if (!BASES.some((base) => exists(root, base, trimmed))) {
          findings.push({ path: trimmed, where: `${rel}:${String(index + 1)}` });
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
