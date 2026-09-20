#!/usr/bin/env node
/**
 * AC-32：生成「设计稿 vs 实现」并排对照图（≥4 组）。
 *
 * 做法：每组写一个自包含的 HTML 联络表（两张本地 PNG 左右并排 + 标注），
 * 再用 `docs/dev-history/design/tools/design-shots.mjs`（零安装 CDP）把它渲染成一张 PNG，
 * 产物落在 `docs/dev-history/shots/compare/`（上线准备 P1 起：设计打样已归档，对照图随之归档）。
 *
 * 用法：node tools/design-compare.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs/dev-history/shots/compare');
mkdirSync(OUT, { recursive: true });

/** 每组：name / 设计稿相对路径 / 实现相对路径 / 单张尺寸 / 说明 */
const PAIRS = [
  {
    name: '01-list-light',
    design: '../../design/a-dark-saas/shots/list-light.png',
    impl: '../02-list.png',
    width: 1280,
    height: 800,
    note: '列表页（亮）：KPI 行 + 侧栏 + 筛选行 + 密集表格 + 状态条',
  },
  {
    name: '02-list-dark',
    design: '../../design/a-dark-saas/shots/list-dark.png',
    impl: '../06-dark-list.png',
    width: 1280,
    height: 800,
    note: '列表页（暗）：A 方向的规范形态（近黑画布 + 表面色阶 + 唯一强调色）',
  },
  {
    name: '03-editor',
    design: '../../design/a-dark-saas/shots/editor-light.png',
    impl: '../03-editor.png',
    width: 1280,
    height: 800,
    note: '编辑器三栏常驻：左（列表）· 中（编辑主体）· 右（版本历史 / 变量填值 / Markdown 预览）',
  },
  {
    name: '04-mobile-list',
    design: '../../design/a-dark-saas/shots/mobile-list.png',
    impl: '../05-mobile-list.png',
    width: 390,
    height: 844,
    note: '移动端 390×844：卡片式列表（顶栏收成 ☰ + 品牌 + ⋯）',
  },
  {
    name: '05-import-confirm',
    design: '../../design/a-dark-saas/shots/import-confirm.png',
    impl: '../09-import-confirm.png',
    width: 1280,
    height: 800,
    note: '导入 replace 二次确认（FR-11b 文案逐字保留）',
  },
];

const HEADER_H = 62;
const CAPTION_H = 26;
const PAD = 16;
const GAP = 12;

function html(pair) {
  const totalW = PAD * 2 + pair.width * 2 + GAP;
  const totalH = HEADER_H + CAPTION_H + pair.height + PAD + 10;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>AC-32 对照 · ${pair.name}</title>
<style>
  html,body{margin:0;background:#0b0c0d;color:#d0d6e0;
    font:13px/1.5 Inter,-apple-system,"Noto Sans SC","Droid Sans Fallback",sans-serif}
  .wrap{width:${totalW}px;min-height:${totalH}px;padding:${PAD}px;box-sizing:border-box}
  .head{display:flex;align-items:baseline;gap:12px;height:${HEADER_H - 8}px}
  .head b{font-size:15px;color:#f7f8f8;letter-spacing:-0.01em}
  .head span{color:#8a8f98}
  .head em{margin-left:auto;font-style:normal;color:#5e6ad2;font-weight:500}
  .panes{display:flex;gap:${GAP}px;align-items:flex-start}
  .pane{width:${pair.width}px}
  .cap{height:${CAPTION_H}px;display:flex;align-items:center;gap:8px;
    color:#8a8f98;font-family:ui-monospace,Menlo,monospace;font-size:11px}
  .cap i{width:6px;height:6px;border-radius:50%;background:#5e6ad2;display:inline-block}
  .cap i.impl{background:#27a644}
  img{width:${pair.width}px;height:${pair.height}px;display:block;
    border:1px solid #23252a;border-radius:8px}
</style></head>
<body><div class="wrap">
  <div class="head">
    <b>AC-32 并排对照 · ${pair.name}</b>
    <span>${pair.note}</span>
    <em>左 = 设计稿 · 右 = 实现</em>
  </div>
  <div class="panes">
    <div class="pane">
      <div class="cap"><i></i>设计稿 ${pair.design.replace('../../', 'docs/')}</div>
      <img src="${pair.design}" alt="设计稿">
    </div>
    <div class="pane">
      <div class="cap"><i class="impl"></i>实现 ${pair.impl.replace('../', 'docs/shots/')}（当前状态截图仍在 docs/shots/）</div>
      <img src="${pair.impl}" alt="实现">
    </div>
  </div>
</div></body></html>`;
}

const shots = [];
for (const pair of PAIRS) {
  const file = path.join(OUT, `${pair.name}.html`);
  writeFileSync(file, html(pair));
  const totalW = PAD * 2 + pair.width * 2 + GAP;
  const totalH = HEADER_H + CAPTION_H + pair.height + PAD + 10;
  shots.push({
    name: pair.name,
    url: 'file://' + file,
    width: totalW,
    height: totalH,
    dark: true,
    waitFor: 'img',
    settleMs: 600,
  });
}

const planPath = path.join(OUT, 'plan.json');
writeFileSync(planPath, JSON.stringify({ outDir: OUT, shots }, null, 2));
console.log(`PLAN compare shots=${shots.length} -> ${OUT}`);
const result = spawnSync('node', [path.join(ROOT, 'docs/dev-history/design/tools/design-shots.mjs'), planPath], {
  stdio: 'inherit',
  cwd: ROOT,
});
process.exit(result.status ?? 1);
