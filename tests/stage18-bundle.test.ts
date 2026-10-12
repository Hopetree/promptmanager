// 阶段 18 / FR-61（BRIEF v24 §4 + §8 AC-61）的**构建体积**断言：
// ① 最大 chunk ≤ 500 KB（未压缩）② 首屏入口 chunk 可查 ③ 零外链
// ④ 六处重组件必须走动态 import（懒加载）；⑤ 总 gzip 不增（对照阶段 18 开工前基线）
// 说明：本文件依赖 `npm run build` 的产物（`npm test` 会先 build）；产物缺失时**失败而不是跳过**。
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { readBytes, readRaw, readSource } from './source-text.ts';
import { evaluateBundleBudget, readBundleBudget } from './bundle-budget.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_WEB = path.join(ROOT, 'dist', 'web');
const ASSETS = path.join(DIST_WEB, 'assets');

// 阶段 69（FR-146）起，体积预算**不再手工累加常量**：账本在 `tests/bundle-budget.json`，
// 由 `node tools/bundle-budget.mjs --record <阶段> --note "<依据>"` 写入（delta 可为负 ⇒ 体积下降会回收预算）。
// 判定是纯函数 `evaluateBundleBudget`，上界与下界都查；测试标题里的阶段清单也从账本派生。
const LEDGER = readBundleBudget();
const VERDICT = evaluateBundleBudget(0, LEDGER);

const MAX_ENTRY_BYTES = 100_000;

// 500 KB 是既有的硬约束（阶段 69 / D-67 ④：本阶段只改记账方式，**不许放宽红线**）。
const MAX_CHUNK_BYTES = 500_000;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function readDistAssets(): Array<{ rel: string; raw: number; gzip: number }> {
  assert.ok(existsSync(path.join(DIST_WEB, 'index.html')), 'dist/web 不存在：请先 `npm run build`');
  return walk(ASSETS)
    .filter((file) => file.endsWith('.js') || file.endsWith('.css'))
    .map((file) => {
      const buffer = readBytes(file);
      return { rel: path.relative(DIST_WEB, file), raw: buffer.byteLength, gzip: zlib.gzipSync(buffer).byteLength };
    });
}

test('AC-61 ①：没有任何 chunk 超过 500 KB（未压缩）——构建不再触发体积告警', () => {
  const over = readDistAssets().filter((asset) => asset.raw > MAX_CHUNK_BYTES);
  const detail = readDistAssets()
    .map((asset) => `${asset.rel} raw=${String(asset.raw)} gzip=${String(asset.gzip)}`)
    .join('\n');
  assert.deepEqual(
    over.map((asset) => asset.rel),
    [],
    `以下 chunk 超过 500 KB：\n${detail}`,
  );
});

test('AC-61 ②：首屏入口 chunk 存在且在预算内（index.html 引用的 js）', () => {
  const html = readRaw(path.join('dist/web', 'index.html'));
  const entry = html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1];
  assert.ok(entry !== undefined, 'index.html 里找不到入口 js');
  const asset = readDistAssets().find((item) => item.rel === entry);
  assert.ok(asset !== undefined, `入口 chunk ${entry} 不在 assets 里`);
  assert.ok(asset.raw <= MAX_ENTRY_BYTES, `入口 chunk ${entry} = ${String(asset.raw)} B，超过预算 ${String(MAX_ENTRY_BYTES)} B`);
});

test(`AC-61 ⑤：总 gzip 在账本区间内（上界与下界都查；账本阶段：${VERDICT.stages}）`, () => {
  const total = readDistAssets().reduce((sum, asset) => sum + asset.gzip, 0);
  const verdict = evaluateBundleBudget(total, LEDGER);
  assert.ok(verdict.ok, verdict.message);
});

test('AC-61 ④：六处重组件都走动态 import（编辑器 / Markdown 预览 / 版本 diff / 导入导出 / 使用统计 / 令牌）', () => {
  const lazy = readSource('web/src/lazy.ts');
  const required = [
    './components/PromptEditor',
    './components/MarkdownPreview',
    './components/VersionPanel',
    './components/ImportExportModal',
    './components/UsageDrawer',
    './components/TokenDrawer',
  ];
  for (const target of required) {
    assert.ok(
      lazy.includes(`import('${target}')`),
      `web/src/lazy.ts 缺少动态 import：${target}（FR-61 要求懒加载）`,
    );
  }
  // 版本 diff 由 VersionPanel 承载（DiffView 是其子件），单独断言仍然可达
  assert.ok(
    readSource('web/src/components/VersionPanel.tsx').includes('DiffView'),
    '版本历史里仍要能看到 diff 视图',
  );
  // 不得再静态 import 这些重组件（否则打进首屏图，懒加载失效）
  for (const file of ['Workspace.tsx', 'PromptDetail.tsx', 'PromptEditor.tsx']) {
    const text = readSource(path.join('web/src/components', file));
    for (const heavy of ['PromptEditor', 'MarkdownPreview', 'VersionPanel', 'ImportExportModal', 'UsageDrawer', 'TokenDrawer']) {
      assert.equal(
        new RegExp(`^import\\s+${heavy}\\s+from`, 'm').test(text),
        false,
        `${file} 不应再静态 import ${heavy}`,
      );
    }
  }
});

test('AC-61：分包策略写在 vite.config.ts（vendor 分离：react / rc / antd / 懒加载块）', () => {
  const config = readSource('vite.config.ts');
  // Vite 8（rolldown）下 manualChunks 已弃用，等价 API 是 output.codeSplitting.groups；
  // 两种写法都算「合理分包」，但至少要有一个在。
  assert.ok(
    /manualChunks|codeSplitting/.test(config),
    'vite.config.ts 必须有分包策略（manualChunks 或其 rolldown 等价物 codeSplitting.groups）',
  );
  for (const group of ['vendor-react', 'vendor-rc', 'vendor-antd', 'app-lazy']) {
    assert.ok(config.includes(group), `分包策略缺少分组 ${group}`);
  }
});
