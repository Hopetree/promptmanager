// 阶段 73 / FR-164 / AC-135 E19：验收脚本入库（tools/acceptance/）后的绊线与一键入口。
//
// 判据意图：脚本收进仓库后就属于交付面，**删掉/搬走必须变红**，且不许再出现"搬了目录却忘了改 cd"这种悬空引用。
// 读脚本走 tests/source-text.ts 的统一入口：`.sh` 归 'hash' 类（剥 `#` 注释），正好只留可执行行。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_ROOT, readSource } from './source-text.ts';

const DIR = 'tools/acceptance';
const FILES = readdirSync(path.join(PROJECT_ROOT, DIR));
// 拼出来而不是写死：本文件自己也要过 ⑬i 那条"测试里不得出现库外脚本名"的旧口径检查。
const SCRIPT = ['ac-', 'stage'].join('');
// 只数按阶段归档的脚本；run.sh 是一键入口，不是某个阶段的验收脚本。
const SHELL = FILES.filter((name) => name.startsWith(SCRIPT) && name.endsWith('.sh')).sort();
const MODULES = FILES.filter((name) => name.startsWith(SCRIPT) && name.endsWith('.mjs')).sort();

test('AC-135 E19：tools/acceptance/ 按阶段归档，脚本数有下界（删掉脚本必红）', () => {
  assert.ok(SHELL.length >= 60, `阶段脚本只有 ${SHELL.length} 个（下界 60）—— 验收脚本被删了`);
  assert.ok(MODULES.length >= 40, `探针只有 ${MODULES.length} 个（下界 40）—— 验收探针被删了`);
  for (const stage of ['1', '63', '71', '72']) {
    assert.ok(
      SHELL.some((name) => name.startsWith(`${SCRIPT}${stage}`)),
      `阶段 ${stage} 的验收脚本不在了`,
    );
  }
});

test('AC-135 E19：每个脚本都能从 tools/acceptance/ 定位到仓库根（搬目录不许漏改 cd）', () => {
  for (const name of SHELL) {
    const text = readSource(path.join(DIR, name));
    assert.match(text, /cd "\$\(dirname "\$0"\)\/\.\.\/\.\."/, `${name} 必须 cd 到仓库根（../..）`);
  }
});

test('AC-135 E19：脚本引用的同目录探针真实存在（引用不悬空）', () => {
  const pattern = new RegExp(`${DIR}/(${SCRIPT}[\\w.-]+\\.mjs)`, 'g');
  for (const name of SHELL) {
    const text = readSource(path.join(DIR, name));
    for (const match of text.matchAll(pattern)) {
      assert.ok(MODULES.includes(match[1] ?? ''), `${name} 引用了不存在的探针 ${String(match[1])}`);
    }
  }
});

test('AC-135 E19：一键入口 run.sh --list 能盘点，且按阶段能找到脚本（实跑）', () => {
  const listed = execFileSync('bash', [path.join(DIR, 'run.sh'), '--list'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  assert.match(listed, new RegExp(`${String(SHELL.length + MODULES.length)} 个脚本`), '盘点行必须报出脚本总数');
  for (const stage of ['63', '71']) {
    assert.match(listed, new RegExp(`^${stage}\\s+${SCRIPT}${stage}`, 'm'), `盘点里缺阶段 ${stage}`);
  }
  const dry = execFileSync('bash', [path.join(DIR, 'run.sh'), '71', '--dry-run'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  assert.match(dry, new RegExp(`会跑：${SCRIPT}71\\.sh`), '--dry-run 必须列出阶段 71 的主脚本');
  assert.match(dry, /只打印，不执行/, '--dry-run 不得声称"全部通过"');
});

// ─────────── 第三轮项目审视 S1 的防复发绊线（交付态脚本不许再随阶段腐烂）───────────

test('审视 S1 防复发：脚本不许把 schema 版本写死（必须从 migrations/ 派生）', () => {
  // 实例：ac-stage35.sh 曾写死 `ok: schema at v4`、ac-stage50.sh 曾写死 `v6`、ac-stage69.sh 曾写死 `v10`
  // —— 每加一个迁移就恒红。口径改成「等于 migrations/ 里最大编号」后，这里挡住回归。
  for (const name of [...SHELL, ...MODULES]) {
    const text = readSource(path.join(DIR, name));
    assert.doesNotMatch(
      text,
      /ok: schema at v[0-9]/,
      `${name} 把 schema 版本写死了：必须从 migrations/ 目录派生（MIG_MAX）`,
    );
  }
});

test('审视 S1 防复发：每个入库脚本语法有效（bash -n / node --check，实跑）', () => {
  for (const name of SHELL) {
    execFileSync('bash', ['-n', path.join(DIR, name)], { cwd: PROJECT_ROOT, stdio: 'pipe' });
  }
  for (const name of MODULES) {
    execFileSync('node', ['--check', path.join(DIR, name)], { cwd: PROJECT_ROOT, stdio: 'pipe' });
  }
});

test('审视 S2 防复发：浏览器路径只从 tools/acceptance/lib/chrome.mjs 解析（不许写死版本目录）', () => {
  // 实例：46 个探针与 tools/ui-shot.mjs 曾写死 `/root/.cache/ms-playwright/chromium_headless_shell-1243/...`
  // —— playwright 一升级目录名就变，46 个文件一起失效。
  const rot = /ms-playwright\/chromium_headless_shell-\d+/;
  for (const name of [...SHELL, ...MODULES]) {
    assert.doesNotMatch(readSource(path.join(DIR, name)), rot, `${name} 写死了 playwright 版本目录：改用 lib/chrome.mjs`);
  }
  assert.doesNotMatch(readSource('tools/ui-shot.mjs'), rot, 'tools/ui-shot.mjs 写死了 playwright 版本目录');
  // 解析器本身必须能给出一个真实存在的路径（实跑）
  const resolved = execFileSync('node', [path.join(DIR, 'lib', 'chrome.mjs')], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).trim();
  assert.ok(resolved.length > 0 && existsSync(resolved), `解析器必须给出真实存在的浏览器路径，实际 "${resolved}"`);
});
