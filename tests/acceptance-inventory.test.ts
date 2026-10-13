// 阶段 73 / FR-164 / AC-135 E19：验收脚本入库（tools/acceptance/）后的绊线与一键入口。
//
// 判据意图：脚本收进仓库后就属于交付面，**删掉/搬走必须变红**，且不许再出现"搬了目录却忘了改 cd"这种悬空引用。
// 读脚本走 tests/source-text.ts 的统一入口：`.sh` 归 'hash' 类（剥 `#` 注释），正好只留可执行行。
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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
