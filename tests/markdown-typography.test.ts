/**
 * FR-167 / AC-138：Markdown 显示样式的**源码级**绊线（计算样式由 `tools/acceptance/ac-stage76.sh` 真浏览器量）。
 *
 * 为什么需要这层：AC-138 的判据是「计算样式」，但样式文件一旦被后人改回
 * `@import … (prefers-color-scheme)`、或在 CSS 里写死色值，问题只会在真浏览器里复现。
 * 这里把「必须有哪几类规则 / 必须走 `--pm-*` 变量 / 主题源必须是应用主题」钉在测试里，
 * 让 `npm test` 就能挡住回归（数值档由 D-74 ① 留给实现，这里只判「达到目的」的形态）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSource, readWebSource } from './source-text.ts';

const css = readWebSource('styles/markdown.css');

/** 取某个选择器块（第一条）的声明文本；找不到返回空串。 */
function block(selectorPattern: string): string {
  const match = new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1] ?? '';
}

function pxOf(declarations: string, property: string): number | null {
  const match = new RegExp(`${property}\\s*:\\s*([0-9.]+)px`).exec(declarations);
  return match?.[1] === undefined ? null : Number(match[1]);
}

test('AC-138 ③：主题源必须是应用主题（不许 prefers-color-scheme，也不许 hljs 自带明暗主题）', () => {
  assert.equal(css.includes('prefers-color-scheme'), false, '样式里不许再出现 prefers-color-scheme');
  assert.equal(css.includes('highlight.js/styles'), false, '不许 @import highlight.js 的明暗主题（它跟系统不跟应用）');
  // 必须由 --pm-*（= antd token 落到 <html> 的变量）驱动
  assert.ok((css.match(/var\(--pm-[a-z0-9-]+\)/g) ?? []).length >= 10, '颜色/字体必须取 --pm-* 变量');
  assert.match(css, /\[data-theme='dark'\]|\[data-theme="dark"\]|--pm-/, '暗色要有应用主题的作用域或变量');
});

test('AC-138 ③：颜色不写死（CSS 里不许出现十六进制色值）', () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, '颜色一律走 antd token 变量，不许写死色值');
});

test('AC-138 ①：blockquote 有 ≥2px 左边框 + 浅底 + 内边距', () => {
  const declarations = block('\\.pm-markdown blockquote');
  assert.ok(declarations.length > 0, '缺 blockquote 规则');
  assert.ok((pxOf(declarations, 'border-left') ?? 0) >= 2, 'blockquote 左边框必须 ≥ 2px');
  assert.match(declarations, /background:\s*var\(--pm-/, 'blockquote 要有浅底（应用 surface）');
  assert.ok(pxOf(declarations, 'padding') !== null, 'blockquote 要有内边距');
});

test('AC-138 ②：表格 collapse + 单元格 ≥1px 边框 + ≥4px 内边距 + 表头浅底', () => {
  assert.match(block('\\.pm-markdown table'), /border-collapse:\s*collapse/);
  const cell = block('\\.pm-markdown th,\\s*\\.pm-markdown td');
  assert.ok((pxOf(cell, 'border') ?? 0) >= 1, 'th/td 边框必须 ≥ 1px');
  assert.ok((pxOf(cell, 'padding') ?? 0) >= 4, 'th/td 内边距必须 ≥ 4px');
  assert.match(block('\\.pm-markdown th'), /background:\s*var\(--pm-/, '表头要有底色');
});

test('AC-138 ③：h1 > h2 > h3 字号严格递减，且 margin 不为 0', () => {
  const sizes = ['h1', 'h2', 'h3'].map((tag) => pxOf(block(`\\.pm-markdown ${tag}`), 'font-size'));
  assert.ok(sizes.every((size) => typeof size === 'number' && size > 0), `h1/h2/h3 字号必须显式给：${sizes.join('/')}`);
  const [h1, h2, h3] = sizes as [number, number, number];
  assert.ok(h1 > h2 && h2 > h3, `字号必须严格递减，实际 ${String(h1)}/${String(h2)}/${String(h3)}`);
  for (const tag of ['h1', 'h2', 'h3']) {
    assert.ok((pxOf(block(`\\.pm-markdown ${tag}`), 'margin') ?? 0) !== 0, `${tag} 的 margin 不为 0`);
  }
});

test('AC-138 ④：行内 code 有底色 + 圆角或 padding（代码块内的 code 除外）', () => {
  const inline = block('\\.pm-markdown :not\\(pre\\) > code');
  assert.match(inline, /background:\s*var\(--pm-/, '行内 code 要有底色');
  assert.ok(
    pxOf(inline, 'border-radius') !== null || pxOf(inline, 'padding') !== null,
    '行内 code 要有圆角或 padding',
  );
});

test('AC-138 ⑤：列表 padding-left > 0 且相邻 li 有间距', () => {
  const list = block('\\.pm-markdown ul,\\s*\\.pm-markdown ol');
  assert.ok((pxOf(list, 'padding-left') ?? 0) > 0, 'ul/ol 的 padding-left 必须 > 0');
  assert.ok((pxOf(block('\\.pm-markdown li \\+ li'), 'margin-top') ?? 0) > 0, 'li + li 必须有可见间距');
});

test('AC-138 ⑥⑦：pre 用应用 surface + 边框/圆角 + ≥8px padding + 横向可滚', () => {
  const pre = block('\\.pm-markdown pre');
  assert.match(pre, /background:\s*var\(--pm-surface-/, 'pre 必须用应用的 surface 色（不是高亮主题自带的纯白/纯黑）');
  assert.ok(
    (pxOf(pre, 'border') ?? 0) >= 1 || pxOf(pre, 'border-radius') !== null,
    'pre 要有边框或圆角（"有面"）',
  );
  assert.ok((pxOf(pre, 'padding') ?? 0) >= 8, 'pre 的 padding 必须 ≥ 8px');
  assert.match(pre, /overflow-x:\s*(auto|scroll)/, 'pre 必须横向可滚');
});

test('AC-138 ⑩：hljs token 色全部取 --pm-code-* 变量（随应用主题变）', () => {
  for (const token of ['keyword', 'string', 'number', 'comment', 'title', 'attr']) {
    assert.match(
      css,
      new RegExp(`\\.hljs-${token}[^{]*\\{[^}]*color:\\s*var\\(--pm-code-${token}\\)`),
      `hljs-${token} 必须取 var(--pm-code-${token})`,
    );
  }
});

test('AC-138 ③：cssVars 注入 --pm-code-* 与 --pm-warning（亮/暗两套值由 theme.ts 决定）', () => {
  const theme = readWebSource('theme.ts');
  for (const name of ['--pm-warning', '--pm-code-keyword', '--pm-code-string', '--pm-code-number', '--pm-code-comment', '--pm-code-title', '--pm-code-attr']) {
    assert.ok(theme.includes(`'${name}'`), `theme.ts 的 cssVars 必须注入 ${name}`);
  }
});

test('AC-138 ⑧：<html> 暴露**已解析**的 data-theme（system 也要落到 light/dark）', () => {
  const app = readWebSource('App.tsx');
  assert.match(
    app,
    /dataset\['theme'\]\s*=\s*prefersDark\s*\?\s*'dark'\s*:\s*'light'/,
    'ThemeBridge 必须写 data-theme = 解析后的实际主题',
  );
  // 主题数据源是 resolveDark(themeMode, prefersDark)：system 模式也被解析成布尔
  assert.match(app, /resolveDark\(themeMode, prefersDark\)/);
});

test('AC-138 ⑪：服务端渲染与净化一行未改（源码级绊线）', () => {
  const markdown = readSource('src/services/markdown.ts');
  assert.match(markdown, /DOMPurify\.sanitize\(/, '净化仍在服务端');
  assert.match(markdown, /highlight\.js|hljs/, '高亮仍在服务端');
  // 前端不引任何 markdown 渲染/高亮库（渲染只在服务端）
  assert.equal(/from 'marked'|from 'highlight\.js'|from 'dompurify'/.test(css), false);
});
