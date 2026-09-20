// 阶段 25 / FR-76 / D-31（BRIEF v32 §4 + §8 AC-76）：
//   顶栏品牌文字 = `PromptM`（**只此一处**）；其余四处（<title>/登录页/关于页/pure.ts 错误文案）保持 `PromptManager`；
//   导出契约值 `app: 'promptmanager'` 一字不动（显示名 ≠ 契约值）；图标 mark 与移动端行为不变。
// 运行时段（桌面/移动视口 + 截图）见 tools/ac-stage25.sh 与 tools/ac-stage25-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, 'web', 'src', rel), 'utf8');

const header = src('components/AppHeader.tsx');
const login = src('components/LoginPage.tsx');
const about = src('components/AboutModal.tsx');
const pure = src('pure.ts');
const html = readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');

test('AC-76 ①：顶栏品牌文字是 PromptM（且不再出现全名）', () => {
  const attr = header.indexOf('data-testid="pm-brand-text"');
  const start = header.indexOf('>', attr) + 1; // 从开标签的 `>` 之后取，避免把属性文本当成内容
  const brand = header.slice(start, header.indexOf('</Typography.Text>', start));
  // 去掉 JSX 注释与标签后，品牌区应当**只剩** PromptM 这个词
  const text = brand.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<[^>]*>/g, ' ').trim();
  assert.equal(text, 'PromptM', `品牌区文字必须精确等于 PromptM（实际：${JSON.stringify(text)}）`);
  assert.equal(/\bPromptManager\b/.test(brand), false, '品牌区不得再出现全名');
  assert.equal(header.includes('PromptManager'), false, 'AppHeader 里不得残留 PromptManager');
});

test('AC-76 ②：反例断言 —— 其余四处**仍是全名**（防顺手全局替换）', () => {
  assert.ok(/<title>PromptManager<\/title>/.test(html), 'web/index.html 的 <title> 必须仍是 PromptManager');
  assert.ok(/PromptManager/.test(login), '登录页品牌文字必须仍是 PromptManager');
  assert.ok(/PromptManager/.test(about), '关于页品牌文字必须仍是 PromptManager');
  assert.ok(/不是 PromptManager 的导出文件/.test(pure), 'pure.ts 的错误文案必须仍含 PromptManager');
  for (const [name, source] of [['LoginPage', login], ['AboutModal', about], ['pure.ts', pure]] as Array<[string, string]>) {
    assert.equal(source.includes('PromptM\n') || /[^r]PromptM[^a]/.test(source), false, `${name} 不得被改成简称`);
  }
});

test('AC-76 ③：导出契约值 app 一字不动（D-31：显示名 ≠ 契约值）', () => {
  assert.ok(/SUPPORTED_EXPORT_FILE = \{ app: 'promptmanager', schema_version: 1 \}/.test(pure), '契约值必须仍是小写 promptmanager');
  assert.equal(/app: 'PromptM'/.test(pure), false, '契约值绝不能被改成显示名');
});

test('AC-76 ④⑤：图标 mark 与移动端行为不变', () => {
  assert.ok(header.includes('data-testid="pm-brand-mark"'), '图标 mark 锚点仍在');
  assert.ok(/src="\/promptmanager-icon\.svg"/.test(header), '图标 src 未变');
  assert.ok(/width=\{26\}[\s\S]{0,40}height=\{26\}/.test(header), '图标仍是 26×26');
  assert.ok(/\{!isMobile && \(/.test(header), '品牌文字仍只在非移动端渲染');
});
