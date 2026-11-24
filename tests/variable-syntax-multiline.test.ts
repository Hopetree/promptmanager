// 变量值 CRLF 归一化 + 多行默认值 —— 共享纯函数（`src/variable-syntax.ts`）的行为用例。
//
// 规格（逐字）：
// 1) `renderVariableText` 取到字符串值时，先 `value.replace(/\r\n?/g, '\n')` 再返回；
//    只归一「值」，**不**归 prompt 文本、**不**归 defaults 表里的默认值。
// 2) `parseDefaultText(raw)`：先 `raw.trim()`；若 trimmed 长度 ≥ 2 且首字符是单引号 / 双引号
//    且与末字符相同 ⇒ 返回引号内部内容**原样**（不 trim、保留真实换行与缩进），并把内部的
//    `\n`（反斜杠 + 字母 n 两个字符）转成真实换行、其余反斜杠保持字面；否则维持 `return trimmed`。
//
// 本文件**测试先行**：先于实现写就并跑出红（见任务报告的红→绿原样输出），再改实现转绿。
// 注意：`default()` 内部的 `\n` 在**提示词文本里是反斜杠 + n 两个字符**，不是真实换行。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDefaultText, renderVariableText, scanVariableTexts } from '../dist/variable-syntax.js';

const newlineCount = (text: string): number => (text.match(/\n/gu) ?? []).length;
const crCount = (text: string): number => (text.match(/\r/gu) ?? []).length;

test('多行值：3 行值渲染后恰好 2 个 \\n，行序与内容逐字不变', () => {
  const value = '第一行\n第二行\n第三行';
  const rendered = renderVariableText('{{ body }}', { body: value });

  assert.equal(newlineCount(rendered.text), 2, '3 行值必须恰好 2 个换行');
  assert.deepEqual(rendered.text.split('\n'), ['第一行', '第二行', '第三行']);
  assert.deepEqual(rendered.missing, []);
});

test('多行值：4 空格缩进 + 首尾各 1 个空行原样保留', () => {
  const value = '\n    indented\n    second\n';
  const rendered = renderVariableText('{{ block }}', { block: value });

  assert.equal(rendered.text, value, '缩进与首尾空行必须逐字符保留');
  assert.equal(rendered.text.startsWith('\n'), true, '首个空行保留');
  assert.equal(rendered.text.endsWith('\n'), true, '末个空行保留');
  assert.equal(rendered.text.split('\n')[1], '    indented', '4 空格缩进保留');
});

test('CRLF 值：\\r\\n 与裸 \\r 均归一化为 \\n，结果 \\r 计数为 0', () => {
  const rendered = renderVariableText('{{ body }}', { body: 'a\r\nb\rc\nd' });

  assert.equal(rendered.text, 'a\nb\nc\nd');
  assert.equal(crCount(rendered.text), 0, '渲染结果不得残留 \\r');
  assert.equal(newlineCount(rendered.text), 3);
  assert.deepEqual(rendered.missing, []);
});

test('CRLF 只归「值」：prompt 文本与默认值里的 \\r 原样保留', () => {
  // prompt 文本里的 CRLF 不动，只有替换进去的值被归一化
  const withPromptCrlf = renderVariableText('前\r\n{{ body }}', { body: 'x\ry' });
  assert.equal(withPromptCrlf.text, '前\r\nx\ny', 'prompt 文本的 CRLF 不得被改写');

  // defaults 表里的值不做 CRLF 归一化（规格：只归「值」）
  const defaultText = "{{ d | default('D\r\nD') }}";
  assert.equal(scanVariableTexts(defaultText).defaults.d, 'D\r\nD', '默认值表不归一化 CRLF');
  assert.equal(renderVariableText(defaultText, {}).text, 'D\r\nD');
});

test('$& / $1 / 反斜杠在值与默认值中按字面输出（不做替换串展开）', () => {
  const value = '$& $1 \\n \\\\ end';
  const rendered = renderVariableText('{{ v }}', { v: value });

  assert.equal(rendered.text, value);
  assert.equal(rendered.text.includes('$&'), true);
  assert.equal(rendered.text.includes('$1'), true);
  assert.equal(rendered.text.includes('\\n'), true, '值里的反斜杠 + n 保持字面，不得变成换行');
  assert.equal(newlineCount(rendered.text), 0);
  assert.equal(renderVariableText("{{ d | default('$& $1') }}", {}).text, '$& $1');
});

test('值里的 {{ other }} 不二次渲染（替换只做一遍）', () => {
  const rendered = renderVariableText('{{ v }}', { v: 'A {{ other }} B', other: 'SHOULD-NOT-APPEAR' });

  assert.equal(rendered.text, 'A {{ other }} B');
  assert.equal(rendered.text.includes('SHOULD-NOT-APPEAR'), false, '不得对替换进来的值再做一轮渲染');
  assert.deepEqual(rendered.missing, []);
});

test('多行默认值：default("a\\nb") 未填渲染两行，已填以值为准', () => {
  // 提示词文本里的 `\n` 是反斜杠 + 字母 n 两个字符（不是真实换行）
  const text = '{{ text | default("a\\nb") }}';
  assert.equal(text.includes('\\n'), true);
  assert.equal(newlineCount(text), 0, '夹具本身没有真实换行');

  assert.equal(scanVariableTexts(text).defaults.text, 'a\nb', '默认值把字面 \\n 转成真实换行');

  const unfilled = renderVariableText(text, {});
  assert.equal(unfilled.text, 'a\nb');
  assert.equal(newlineCount(unfilled.text), 1);
  assert.deepEqual(unfilled.missing, [], '有默认值不进 missing');

  const filled = renderVariableText(text, { text: 'X\nY\nZ' });
  assert.equal(filled.text, 'X\nY\nZ', '已填以值为准');
  assert.equal(newlineCount(filled.text), 2);
});

test('多行默认值：引号内 4 空格缩进 + 首尾空行原样保留，内部空格不 trim', () => {
  const text = '{{ code | default("\\n    x\\n") }}';

  assert.equal(scanVariableTexts(text).defaults.code, '\n    x\n');
  assert.equal(renderVariableText(text, {}).text, '\n    x\n');
  // 规格：两端成对引号内部的空格原样保留（不对引号内部做 trim）
  assert.equal(scanVariableTexts("{{ s | default(' z ') }}").defaults.s, ' z ');
});

test('空串与未填：键缺失回落（多行）默认值；显式空串仍渲染为空、不回落', () => {
  const text = '{{ m | default("甲\\n乙") }}';

  assert.equal(scanVariableTexts(text).defaults.m, '甲\n乙');
  assert.equal(renderVariableText(text, {}).text, '甲\n乙', '未填（键缺失）⇒ 回落多行默认值');
  assert.equal(renderVariableText(text, { m: '' }).text, '', '显式空串算已提供 ⇒ 空，不回落默认值（既有契约）');

  const emptyDefault = '{{ e | default("") }}';
  assert.equal(scanVariableTexts(emptyDefault).defaults.e, '');
  assert.equal(renderVariableText(emptyDefault, {}).text, '');
});

test('单行短值回归：无换行值渲染逐字符一致、missing 口径不变', () => {
  assert.deepEqual(renderVariableText('你好 {{ name }}！', { name: '张三' }), {
    text: '你好 张三！',
    missing: [],
  });
  assert.equal(newlineCount(renderVariableText('你好 {{ name }}！', { name: '张三' }).text), 0);
  assert.deepEqual(renderVariableText('{{ a }}', {}), { text: '{{ a }}', missing: ['a'] });
  assert.equal(parseDefaultText(' 你好 '), '你好');
});

test('parseDefaultText 既有口径不变：未加引号仍 trim，不成对引号按字面返回', () => {
  assert.equal(parseDefaultText(undefined), undefined);
  assert.equal(parseDefaultText(' 左边去空白 '), '左边去空白');
  assert.equal(parseDefaultText("'z"), "'z", '只有一个引号不算成对');
  assert.equal(parseDefaultText("'z\""), "'z\"", '首尾引号不同不算成对');
  assert.equal(parseDefaultText(''), '');
});
