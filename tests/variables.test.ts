import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractVariables, renderVariables } from '../dist/services/variables.js';

test('提取：按首次出现顺序去重，忽略空白', () => {
  assert.deepEqual(extractVariables('你好 {{ 姓名 }}，重复 {{姓名}} 与 {{var-b}}'), ['姓名', 'var-b']);
  assert.deepEqual(extractVariables('{{a}}{{b}}{{a}}{{c}}'), ['a', 'b', 'c']);
  assert.deepEqual(extractVariables('没有占位符'), []);
  assert.deepEqual(extractVariables('{{ 首 }} {{尾 }} {{ 中}}'), ['首', '尾', '中']);
});

test('提取：名字规则（含中文/数字/下划线/连字符；不含空白；1–64 字符）', () => {
  assert.deepEqual(extractVariables('{{变量_1}}{{变量-2}}{{名字}}{{A1}}'), ['变量_1', '变量-2', '名字', 'A1']);
  // 空名 / 含空白 / 含其他符号 / 超长 → 都不是变量（按字面文本处理）
  assert.deepEqual(extractVariables('{{}}{{  }}'), []);
  assert.deepEqual(extractVariables('{{a b}}'), []);
  assert.deepEqual(extractVariables('{{x!}}'), []);
  assert.deepEqual(extractVariables('{{a.b}}'), []);
  assert.deepEqual(extractVariables(`{{${'长'.repeat(64)}}}`), ['长'.repeat(64)]);
  assert.deepEqual(extractVariables(`{{${'长'.repeat(65)}}}`), []);
  // 只认双花括号
  assert.deepEqual(extractVariables('{a} ${b} {{c}}'), ['c']);
});

test('提取：转义 \\{{name}} 不算变量；多字段按 user_prompt → system_prompt 顺序去重', () => {
  assert.deepEqual(extractVariables('\\{{保留}} 与 {{真的}}'), ['真的']);
  assert.deepEqual(extractVariables('\\{{a}}\\{{b}}'), []);
  assert.deepEqual(extractVariables('{{甲}}', '{{乙}}{{甲}}'), ['甲', '乙']);
  assert.deepEqual(extractVariables('{{甲}}', undefined), ['甲']);
});

test('渲染：提供的值替换、未提供的原样保留并进 missing（按提取顺序）', () => {
  const text = '你好 {{ 姓名 }}，重复 {{姓名}} 与 \\{{保留}} 以及 {{var-b}}';
  const rendered = renderVariables(text, { 姓名: '张三' });
  assert.equal(rendered.text, '你好 张三，重复 张三 与 {{保留}} 以及 {{var-b}}');
  assert.deepEqual(rendered.missing, ['var-b']);
});

test('渲染：给定空字符串算"已提供"；非字符串值视为未提供', () => {
  assert.deepEqual(renderVariables('{{a}}-{{b}}', { a: '' }), { text: '-{{b}}', missing: ['b'] });
  assert.deepEqual(renderVariables('{{a}}', { a: 123 }), { text: '{{a}}', missing: ['a'] });
  assert.deepEqual(renderVariables('{{a}}', { a: null }), { text: '{{a}}', missing: ['a'] });
  assert.deepEqual(renderVariables('{{a}}', { a: undefined }), { text: '{{a}}', missing: ['a'] });
});

test('渲染：没有值也没有占位符时文本不变；纯字面文本零改动', () => {
  assert.deepEqual(renderVariables('无占位符', {}), { text: '无占位符', missing: [] });
  assert.deepEqual(renderVariables('{{a}}', {}), { text: '{{a}}', missing: ['a'] });
  assert.deepEqual(renderVariables('{{a b}} {{}}', {}), { text: '{{a b}} {{}}', missing: [] });
});

test('渲染：只处理 user_prompt/system_prompt 之外的文本时也保持一致（纯函数）', () => {
  const text = '{{a}}{{b}}{{a}}';
  assert.deepEqual(renderVariables(text, { b: 'B' }), { text: '{{a}}B{{a}}', missing: ['a'] });
});
