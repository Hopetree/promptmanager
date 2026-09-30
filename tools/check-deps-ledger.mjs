#!/usr/bin/env node
// 依赖台账一致性检查（2026-09-30）。
//
// 为什么需要它：`docs/dependencies.md` 是**手工维护**的版本台账，而版本会被自动化改动
// （dependabot / `npm install`）改掉 —— 一次合并就可能让台账过期，且**没有任何东西会发现**。
// 本脚本把"台账必须与实际版本一致"变成可执行断言。
//
// 判据：`package.json` 里**每一个直接依赖**（dependencies + devDependencies）都必须在
// `docs/dependencies.md` 里有一行 `| \`<name>\` | <version> | ...`（版本逐字相等）。
//
// 退出码：0 = 全部一致；1 = 有缺失或版本不符（打印明细）。
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ledger = readFileSync(path.join(ROOT, 'docs', 'dependencies.md'), 'utf8');

const direct = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const bad = [];
for (const [name, version] of Object.entries(direct)) {
  // 台账行形如： | `vite` | 8.3.1 | MIT | ... |
  const row = new RegExp('\\|\\s*`' + esc(name) + '`\\s*\\|\\s*' + esc(version) + '\\s*\\|');
  if (!row.test(ledger)) bad.push(`${name}@${version}`);
}

const total = Object.keys(direct).length;
if (bad.length > 0) {
  console.error(`❌ 台账与实际版本不一致（共 ${total} 个直接依赖，${bad.length} 个对不上）：`);
  for (const item of bad) console.error(`   · ${item} —— docs/dependencies.md 里没有 | \`name\` | ${item.split('@').pop()} | 这一行`);
  console.error('   改法：更新 docs/dependencies.md 的 §2.1 / §2.2 表格行，并**重跑 OSV 审计**（旧版本的结论对新版本无效）。');
  process.exit(1);
}
console.log(`✅ 台账一致：${total} 个直接依赖的版本与 docs/dependencies.md 逐字相符`);
