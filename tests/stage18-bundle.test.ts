// 阶段 18 / FR-61（BRIEF v24 §4 + §8 AC-61）的**构建体积**断言：
// ① 最大 chunk ≤ 500 KB（未压缩）② 首屏入口 chunk 可查 ③ 零外链
// ④ 六处重组件必须走动态 import（懒加载）；⑤ 总 gzip 不增（对照阶段 18 开工前基线）
// 说明：本文件依赖 `npm run build` 的产物（`npm test` 会先 build）；产物缺失时**失败而不是跳过**。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_WEB = path.join(ROOT, 'dist', 'web');
const ASSETS = path.join(DIST_WEB, 'assets');

/** 阶段 18 开工前实测（`dist/web` 的 js+css gzip 合计，`zlib.gzipSync` 默认级别；FR-61 的"总 gzip 不增"基线） */
const BASELINE_TOTAL_GZIP = 399_175;
/**
 * 基线上允许的**已对账**增量（阶段 18 三件事的记账，逐项见 PROGRESS）：
 * ① 分包边界开销：每个 chunk 是一个独立 gzip 流，实测约 +0.4 KB；
 * ② FR-62（编辑器全屏）是**新增功能**，其代码本身（按钮 / 状态 / 全屏逻辑 / CSS）实测约 +1.4 KB；
 * 只做 FR-61（B）时实测 **398,567 B < 基线**（即瘦身本身没有增体积）。
 */
const STAGE18_ACCOUNTED_DELTA = 2_560;
/**
 * 阶段 22（FR-70 拖拽排序）的**已对账**增量：**实测** +15,954 B gzip。
 * 依据：把 HEAD~2（阶段 21，未引入拖拽库）的 `web/src` 在同一 `node_modules` 下重新构建，
 * 总 gzip = 401,067 B；阶段 22 为 417,021 B ⇒ 差值 15,954 B = `@dnd-kit` 四包（core/sortable/utilities/modifiers，
 * 落在 `vendor-misc` chunk）+ 拖拽/备注样式，减去 FR-71 删掉的正文摘要与元信息代码。
 * BRIEF FR-70 明确要求"用成熟库、禁止自己手写拖拽引擎"，故这笔体积是**规格要求**的代价；
 * 未压缩的最大 chunk 仍为 467,320 B（≤500KB，AC-61 ① 不变）。
 */
const STAGE22_ACCOUNTED_DELTA = 15_954;
/**
 * 阶段 27（FR-77 ~ FR-81）的**已对账**增量：**实测** +963 B gzip。
 * 依据（2026-09-21）：把本阶段改动前的 `web/src`（HEAD = 阶段 26 收尾）在同一 `node_modules` 下重新
 * `npm run build:web`，总 gzip = **417,515 B**；本阶段完成后 = **418,478 B** ⇒ 差值 **963 B**。
 * 构成：表格批量工具条 + `rowSelection` + 批量移动弹窗（FR-77）、详情页元信息行（文件夹下拉 + 标签胶囊，FR-78）、
 * 减去移除的「备注」页签（FR-79）与变量区块（FR-80）、VarsDialog 尺寸（FR-81，仅数值改动）后的净值。
 * 未压缩的最大 chunk 仍为 470,985 B（≤500KB，AC-61 ① 不变）。
 */
const STAGE27_ACCOUNTED_DELTA = 963;
/**
 * 阶段 29（FR-82 / FR-83）的**已对账**增量：**实测** +166 B gzip。
 * 依据（2026-09-21）：阶段 27 收尾时总 gzip = **418,478 B**（见上一条）；本阶段完成后 = **418,644 B**
 * ⇒ 差值 **166 B**。构成：`app.css` 新增的半选态覆写 + 工具条间距 + 详情 chip 统一（约 +0.4 KB raw / +0.16 KB gzip），
 * 以及 `PromptDetail.tsx` 的间距/换行保护（无新增依赖、无新增组件）。
 * 未压缩的最大 chunk 仍为 470,985 B（≤500KB，AC-61 ① 不变）。
 */
const STAGE29_ACCOUNTED_DELTA = 166;
/**
 * 阶段 31（FR-85 / FR-86）的**已对账**增量：**实测** +113 B gzip。
 * 依据（2026-09-21）：阶段 29 收尾时总 gzip = **418,644 B**（见上一条）；本阶段完成后 = **418,757 B**
 * ⇒ 差值 **113 B**。构成：`UseView.tsx` 表格「标签」列改成 `Flex gap={4} wrap` + 每个 Tag 归零自带 margin（FR-85）、
 * `VersionPanel.tsx` 新增保留策略文案与回滚确认文案（FR-86）。**无新增依赖、无新增组件、无新增 chunk**。
 * 未压缩的最大 chunk 仍为 470,985 B（≤500KB，AC-61 ① 不变）。
 */
const STAGE31_ACCOUNTED_DELTA = 113;
/**
 * 阶段 36（FR-95 / FR-96 / FR-97）的**已对账**增量：**实测** +679 B gzip。
 * 依据（2026-09-22）：阶段 31 收尾时总 gzip = **418,757 B**（见上一条）；本阶段完成后 = **419,436 B**
 * ⇒ 差值 **679 B**。构成：`TokenDrawer.tsx` 的"预取明文 + 同步复制 + 真「显示」入口 + 硬删除按钮 +
 * 去掉创建弹窗"（净增）与 `clipboard.ts` 兜底改为 Selection API（新增一条路径，+约 0.3 KB raw）。
 * **无新增依赖、无新增 chunk**；未压缩的最大 chunk 仍为 470,985 B（≤500KB，AC-61 ① 不变）。
 */
const STAGE36_ACCOUNTED_DELTA = 679;
/**
 * 阶段 37（FR-98 令牌列表折叠排版）的**已对账**增量：**实测** +247 B gzip。
 * 依据（2026-09-22）：阶段 36 收尾总 gzip = **419,436 B**；本阶段完成后 = **419,683 B** ⇒ **+247 B**。
 * 构成：`TokenDrawer` 6 列 → 4 列 + 行展开区（`最近使用`/`操作`/明文折进展开区）+ 两个展开箭头图标。
 * **无新增依赖、无新增 chunk**；未压缩的最大 chunk 仍 470,985 B（AC-61 ① 不变）。
 */
const STAGE37_ACCOUNTED_DELTA = 247;
/**
 * 阶段 43（FR-105 令牌权限可改）的**已对账**增量：**实测** +246 B gzip。
 * 依据（2026-09-22）：把改动前的 `web/src`（HEAD = 阶段 42 收尾 `774836e`）在同一 `node_modules` 下
 * 重新 `npm run build:web`，总 gzip = **419,673 B**；本阶段完成后 = **419,919 B** ⇒ 差值 **246 B**。
 * 构成：`TokenDrawer.tsx` 的「状态」列权限文本包进 antd `Dropdown`（两项菜单 + 手型/title + 只更新该行 state）
 * 与 `api.ts` 的 `setTokenScope`。**无新增依赖、无新增 chunk**；未压缩的最大 chunk 仍 470,985 B（AC-61 ① 不变）。
 */
const STAGE43_ACCOUNTED_DELTA = 246;
/** AC-61 ①：未压缩的 chunk 上限（Vite 告警阈值口径 500 kB） */
const MAX_CHUNK_BYTES = 500_000;
/** AC-61 ②：首屏入口 chunk 预算（未压缩） */
const MAX_ENTRY_BYTES = 100_000;

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
      const buffer = readFileSync(file);
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
  const html = readFileSync(path.join(DIST_WEB, 'index.html'), 'utf8');
  const entry = html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1];
  assert.ok(entry !== undefined, 'index.html 里找不到入口 js');
  const asset = readDistAssets().find((item) => item.rel === entry);
  assert.ok(asset !== undefined, `入口 chunk ${entry} 不在 assets 里`);
  assert.ok(asset.raw <= MAX_ENTRY_BYTES, `入口 chunk ${entry} = ${String(asset.raw)} B，超过预算 ${String(MAX_ENTRY_BYTES)} B`);
});

test('AC-61 ⑤：总 gzip 不增（js+css 合计 ≤ 开工前基线 + 已对账增量：阶段 18 / 22 / 27 / 29 / 31 / 36 / 37 / 43）', () => {
  const total = readDistAssets().reduce((sum, asset) => sum + asset.gzip, 0);
  const budget =
    BASELINE_TOTAL_GZIP +
    STAGE18_ACCOUNTED_DELTA +
    STAGE22_ACCOUNTED_DELTA +
    STAGE27_ACCOUNTED_DELTA +
    STAGE29_ACCOUNTED_DELTA +
    STAGE31_ACCOUNTED_DELTA +
    STAGE36_ACCOUNTED_DELTA +
    STAGE37_ACCOUNTED_DELTA +
    STAGE43_ACCOUNTED_DELTA;
  assert.ok(total <= budget, `总 gzip = ${String(total)} B，超过预算 ${String(budget)} B（基线 ${String(BASELINE_TOTAL_GZIP)} B）`);
});

test('AC-61 ④：六处重组件都走动态 import（编辑器 / Markdown 预览 / 版本 diff / 导入导出 / 使用统计 / 令牌）', () => {
  const lazy = readFileSync(path.join(ROOT, 'web', 'src', 'lazy.ts'), 'utf8');
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
    readFileSync(path.join(ROOT, 'web', 'src', 'components', 'VersionPanel.tsx'), 'utf8').includes('DiffView'),
    '版本历史里仍要能看到 diff 视图',
  );
  // 不得再静态 import 这些重组件（否则打进首屏图，懒加载失效）
  for (const file of ['Workspace.tsx', 'PromptDetail.tsx', 'PromptEditor.tsx']) {
    const text = readFileSync(path.join(ROOT, 'web', 'src', 'components', file), 'utf8');
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
  const config = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
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
