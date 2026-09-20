import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../dist/services/markdown.js';

test('AC-12：<script> 与 javascript: 必须被净化，代码块必须高亮', () => {
  const html = renderMarkdown(
    ['# 标题', '', '<script>alert(1)</script>', '', '[x](javascript:alert(1))', '', '```js', 'const a = 1;', '```', ''].join('\n'),
  );
  assert.ok(!html.includes('<script'), `不应含 <script：${html}`);
  assert.ok(!html.includes('javascript:'), `不应含 javascript:：${html}`);
  assert.ok(html.includes('<h1'), '正常 Markdown 结构应保留');
  assert.match(html, /<pre/);
  assert.match(html, /<code[^>]*class="[^"]*hljs/);
});

test('净化：事件属性 / iframe / 危险协议被去掉，安全标签与 class 保留', () => {
  const html = renderMarkdown(
    [
      '<img src=x onerror=alert(1)>',
      '<iframe src="http://evil"></iframe>',
      '<a href="javascript:alert(1)">j</a>',
      '<a href="https://example.com">ok</a>',
      '<b>粗体</b>',
    ].join('\n\n'),
  );
  assert.ok(!/onerror/i.test(html), `不应含 onerror：${html}`);
  assert.ok(!html.includes('<iframe'), '不应含 iframe');
  assert.ok(!html.includes('javascript:'), '不应含 javascript:');
  assert.ok(html.includes('href="https://example.com"'), '正常链接应保留');
  assert.ok(html.includes('<b>粗体</b>'), '安全标签应保留');
});

test('高亮：显式语言、未知语言、无语言三种情况都要带 hljs 类', () => {
  const js = renderMarkdown('```js\nconst a = 1;\n```');
  assert.match(js, /class="hljs language-js"/);
  assert.ok(js.includes('<span class="hljs-keyword">const</span>'), '关键字应被高亮');

  const unknown = renderMarkdown('```notalanguage\nfoo bar\n```');
  assert.match(unknown, /<code[^>]*class="[^"]*hljs/);

  const plain = renderMarkdown('```\nsome text\n```');
  assert.match(plain, /<code[^>]*class="[^"]*hljs/);

  // 代码内容必须被转义（不能让代码里的标签变成真标签）。
  // 注意：html 语言会被高亮成 <span class="hljs-tag">&lt;<span class="hljs-name">script</span>&gt;</span>，
  // 所以断言的是"没有真的 <script 标签 + 出现转义实体"，而不是连续的 &lt;script&gt; 子串。
  const escaped = renderMarkdown('```html\n<script>alert(1)</script>\n```');
  assert.ok(!escaped.includes('<script'), `代码里的 script 必须转义：${escaped}`);
  assert.ok(escaped.includes('&lt;'), '应出现转义实体 &lt;');
  assert.ok(escaped.includes('hljs'), '代码块应带高亮类');
});

test('常规 Markdown 结构与中文都能正常渲染', () => {
  const html = renderMarkdown('- 一\n- 二\n\n**加粗** 与 `行内代码`\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
  assert.ok(html.includes('<ul>'));
  assert.ok(html.includes('<strong>加粗</strong>'));
  assert.ok(html.includes('<code>行内代码</code>'));
  assert.ok(html.includes('<table>'), 'gfm 表格应渲染');
});

test('空字符串与纯文本输入不报错', () => {
  assert.equal(renderMarkdown('').trim(), '');
  assert.match(renderMarkdown('就一行纯文本'), /就一行纯文本/);
});

// ---- BRIEF v4 §5「Markdown 净化硬化」（正式验收在阶段 6，本阶段顺手落地并断言）----
test('硬化：输出 HTML 不得出现 style= 属性与 style/form/input/button/math/mtext/link/meta/base 标签', () => {
  const payloads = [
    '<div style="position:fixed;inset:0;background:#fff">整页覆盖</div>',
    '<style>body{display:none}</style>',
    '<form action="/api/logout" method="post"><input name="x"><button>点我</button></form>',
    '<math><mtext>伪装的数学标记</mtext></math>',
    '<link rel="stylesheet" href="http://evil/x.css">',
    '<meta http-equiv="refresh" content="0;url=http://evil">',
    '<base href="http://evil/">',
    '<p style="color:red">行内样式</p>',
    '<span STYLE="background:url(javascript:alert(1))">大小写绕过</span>',
  ];

  for (const payload of payloads) {
    const html = renderMarkdown(payload);
    assert.ok(!/\sstyle\s*=/i.test(html), `不得出现 style= 属性：${payload} → ${html}`);
    for (const tag of ['<style', '<form', '<input', '<button', '<math', '<mtext', '<link', '<meta', '<base']) {
      assert.ok(!html.toLowerCase().includes(tag), `不得出现 ${tag}：${payload} → ${html}`);
    }
  }
});

test('硬化后正常内容仍保留（不能把 Markdown 渲染也一起关掉）', () => {
  const html = renderMarkdown('# 标题\n\n**加粗** 与 [链接](https://example.com)\n\n```js\nconst a = 1;\n```\n');
  assert.ok(html.includes('<h1'), '标题保留');
  assert.ok(html.includes('<strong>加粗</strong>'), '加粗保留');
  assert.ok(html.includes('href="https://example.com"'), '正常链接保留');
  assert.ok(html.includes('hljs'), '代码高亮保留');
});
