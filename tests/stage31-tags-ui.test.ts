// 阶段 31 / FR-85（表格「标签」列加间距）+ FR-86 文案（版本面板可见说明）的**前端源码级**断言。
// 运行时段（真实像素 gap / 卡片视图对照 / DOM 文案可见性）见 tools/ac-stage31.sh 与 tools/ac-stage31-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const useView = src('components/UseView.tsx');
const versionPanel = src('components/VersionPanel.tsx');

/** 取出表格「标签」列那段 render（从 `key: 'tags'` 到下一个列定义）。 */
function tagsColumn(): string {
  const at = useView.indexOf("key: 'tags'");
  assert.ok(at >= 0, 'UseView.tsx 里找不到表格「标签」列');
  const end = useView.indexOf("title: '文件夹'", at);
  assert.ok(end > at, '找不到「标签」列之后的下一个列定义');
  return useView.slice(at, end);
}

test('AC-87 ①：表格「标签」列的相邻标签有 ≥4px 间隙（Flex gap={4} + 每个 Tag 归零自带 margin）', () => {
  const column = tagsColumn();
  const gap = /gap=\{(\d+)\}/.exec(column);
  assert.ok(gap !== null, '「标签」列必须显式给出 gap（否则 antd 6 的 Tag 没有默认 margin，标签会拼在一起）');
  assert.ok(Number(gap[1]) >= 4, `相邻标签间隙必须 ≥4px，实际 gap={${gap[1]}}`);
  assert.equal(gap[1], '4', '应与卡片视图同一档（gap={4}）');
  // antd 5 的 Tag 自带 `margin-inline-end: 8px`；必须显式归零，否则一旦 antd 把默认 margin 加回来，
  // 实际间隙会变成 8 + 4 = 12px（与卡片视图不一致，也会让 128px 列更早换行）。
  assert.ok(
    /marginInlineEnd:\s*0/.test(column),
    '每个 Tag 必须显式 marginInlineEnd: 0（把间隙的唯一来源钉在 Flex gap 上）',
  );
  // 单个标签 / 无标签不受影响：渲染路径仍然是"按 tags 数组直接 map"，没有额外的占位/包装分支
  assert.ok(/prompt\.tags\.map\(/.test(column), '仍按 tags 数组直接 map（无标签时渲染空容器，不占位）');
});

test('AC-87 ②：卡片视图的标签间隙仍是 gap={4}（两处同档，运行时段量像素对照）', () => {
  const card = useView.slice(useView.indexOf('renderCard = ('), useView.indexOf('const tableColumns'));
  assert.ok(/<Flex gap=\{4\} wrap>/.test(card), '卡片视图标签区必须仍是 Flex gap={4} wrap');
  assert.ok(/marginInlineEnd:\s*0/.test(card), '卡片标签同样把自带 margin 归零');
});

test('AC-87 ③：多标签不溢出 —— 标签容器 wrap + minWidth:0，且列宽仍是 128（未改列宽）', () => {
  const column = tagsColumn();
  assert.ok(/wrap/.test(column), '标签容器必须允许换行（多标签在 128px 列内折行，不横向溢出）');
  assert.ok(/minWidth:\s*0/.test(column), '标签容器必须 minWidth:0（flex 子项才能收缩而不是撑破列）');
  assert.ok(/width:\s*128/.test(column), '「标签」列宽必须仍是 128（BRIEF 明确不改列宽）');
  // 其它列的宽度一字未动（防止"顺手调列宽"）
  for (const [title, width] of [
    ['标题', 210],
    ['文件夹', 86],
    ['版本', 58],
    ['变量数', 66],
    ['取用次数', 74],
    ['更新于', 108],
    ['操作', 192],
  ] as const) {
    const at = useView.indexOf(`title: '${title}'`);
    assert.ok(at >= 0, `找不到列「${title}」`);
    const block = useView.slice(at, at + 400);
    assert.ok(
      new RegExp(`width:\\s*${String(width)}`).test(block),
      `列「${title}」的宽度必须仍是 ${String(width)}`,
    );
  }
  // 数据与顺序不变：仍然是 tags 数组原序，没有排序/截断
  assert.equal(/tags\.slice|tags\.sort|\.reverse\(\)/.test(tagsColumn()), false, '标签内容与顺序不得改动');
});

test('AC-88 ⑧：版本面板有可见的「最多保留最近 10 个版本」文案（带 data-testid 供 DOM 断言）', () => {
  assert.ok(
    versionPanel.includes('最多保留最近 10 个版本'),
    '版本面板必须写出保留策略（FR-86 用户明确要求"需要有文案说明"）',
  );
  assert.ok(
    /data-testid="pm-version-retention-note"/.test(versionPanel),
    '保留策略文案必须带 data-testid="pm-version-retention-note"（AC-88 ⑧ 的 DOM 断言锚点）',
  );
  // 文案必须在三个视图之外（表格/对比/详情都能看到），即出现在 Segmented 之后的标题行里
  const headerAt = versionPanel.indexOf('data-testid="pm-version-views"');
  const noteAt = versionPanel.indexOf('pm-version-retention-note');
  const compareAt = versionPanel.indexOf("{view === 'compare' &&");
  assert.ok(headerAt >= 0 && noteAt > headerAt && noteAt < compareAt, '文案应在版本面板标题行（三视图共用区）里');
});

test('AC-88 ⑧（对抗性）：与 FR-86 冲突的旧文案（"历史不删除"）必须已清掉', () => {
  // FR-86 之后版本会被真删，任何"历史永不删除 / 历史版本不会被删除 / 历史保留"的表述都是错的
  for (const stale of ['历史不删除', '历史版本不会被删除', '历史永不删除', '绝不删历史']) {
    assert.equal(versionPanel.includes(stale), false, `版本面板仍留有与 FR-86 冲突的旧文案：${stale}`);
  }
  // 回滚确认框要说明"会生成新版本 + 保留上限"
  assert.ok(
    /会生成一个新版本；最多保留最近 10 个版本。/.test(versionPanel),
    '回滚二次确认必须写明"生成新版本 + 最多保留最近 10 个版本"',
  );
});
