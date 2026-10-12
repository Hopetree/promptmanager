// 阶段 70 / FR-147 / AC-132 A1–A5：变量语法单一实现 —— 前后端共用 `src/variable-syntax.ts`。
//
// 判据以 `tmp/dev-process/BRIEF.md` 的 **FR-147 / AC-132（A 组）/ D-68** 为准，不以派活提示词为准。
// 本文件是**机械检查**：语法只有一处定义、两侧都引用它、列表变量数与服务端逐条一致、
// 语法行为五例不回归（语法语义本阶段一条都不许改）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { sourceFiles, webSourceFiles } from './source-text.ts';
import { extractVariablesLocal, hasVariables, previewRender, scanVariablesLocal } from '../web/src/pure.ts';
import { renderVariables } from '../dist/services/variables.js';

const LITERAL = /const (?:PM_)?PLACEHOLDER = (\/.*?\/gu);/;

/** A1：占位符正则全仓只有一处定义，且就在共享模块里。 */
test('AC-132 A1：变量语法（正则）全仓只有一处定义', () => {
  const defining = [...sourceFiles('src'), ...webSourceFiles()]
    .filter((file) => LITERAL.test(file.text))
    .map((file) => file.rel);
  assert.deepEqual(defining, ['src/variable-syntax.ts'], '正则只许有一处定义（FR-147）');
});

/** A2：默认值解析也只有一处，前后端都不是"自己实现一份"。 */
test('AC-132 A2：默认值解析只有一处，前后端只引用不重写', () => {
  const defining = [...sourceFiles('src'), ...webSourceFiles()]
    .filter((file) => /function parseDefaultText\(/.test(file.text))
    .map((file) => file.rel);
  assert.deepEqual(defining, ['src/variable-syntax.ts'], 'parseDefaultText 只许有一处定义');

  const serverFacade = sourceFiles('src').find((file) => file.rel === 'src/services/variables.ts');
  assert.ok(serverFacade !== undefined);
  assert.match(serverFacade.text, /from '\.\.\/variable-syntax\.js'/, '服务端门面必须引用共享模块');
  const client = webSourceFiles().find((file) => file.rel === 'web/src/pure.ts');
  assert.ok(client !== undefined);
  assert.match(client.text, /from '\.\.\/\.\.\/src\/variable-syntax\.(js|ts)'/, '前端必须引用共享模块');
});

/** A3：列表变量数（前端本地扫描）与服务端 `GET /variables` 对 3 条样本逐条一致。 */
test('AC-132 A3：3 条样本（含变量 / 不含变量 / 含默认值）列表变量数与服务端一致', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const samples = [
      { title: 'A3 含变量', user_prompt: '单位是 {{单位}}，语气 {{语气}}', system_prompt: '' },
      { title: 'A3 不含变量', user_prompt: '这里没有占位符，只有普通文本', system_prompt: '' },
      {
        title: 'A3 含默认值',
        user_prompt: '{{ a | default(你好) }} {{ b }}',
        system_prompt: '系统段也提 {{ c | default("系") }}',
      },
    ];

    for (const sample of samples) {
      const created = await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: sample.title, user_prompt: sample.user_prompt, system_prompt: sample.system_prompt },
      });
      assert.equal(created.statusCode, 201, created.body);
      const id = (created.json() as { id: number }).id;

      const report = await fx.app.inject({
        method: 'GET',
        url: `/api/prompts/${String(id)}/variables`,
        headers: { cookie },
      });
      assert.equal(report.statusCode, 200, report.body);
      const body = report.json() as { variables: string[]; defaults: Record<string, string> };

      const local = scanVariablesLocal(sample.user_prompt, sample.system_prompt);
      assert.deepEqual(local.variables, body.variables, `列表变量数必须与服务端一致：${sample.title}`);
      assert.deepEqual(local.defaults, body.defaults, `默认值表必须与服务端一致：${sample.title}`);
      assert.deepEqual(extractVariablesLocal(sample.user_prompt, sample.system_prompt), body.variables);
    }
  } finally {
    await fx.close();
  }
});

/** A5：语法行为五例 —— 本阶段只许搬家，不许改语义。 */
test('AC-132 A5：语法行为五例逐条不回归', () => {
  // ① 普通占位符：没提供 ⇒ 原样保留 + missing
  assert.deepEqual(renderVariables('单位是 {{单位}}', {}), { text: '单位是 {{单位}}', missing: ['单位'] });
  // ② 有默认值：没填 ⇒ 用默认值，且不进 missing
  assert.deepEqual(renderVariables('{{ b | default(你好) }}', {}), { text: '你好', missing: [] });
  // ③ 显式空串算"已提供" ⇒ 渲染成空，**不**回落默认值
  assert.deepEqual(renderVariables('{{ b | default(你好) }}', { b: '' }), { text: '', missing: [] });
  // ④ 转义写法 ⇒ 去掉反斜杠、其余原样
  assert.deepEqual(renderVariables('\\{{ a }}', { a: 'x' }), { text: '{{ a }}', missing: [] });
  // ⑤ 不认识的写法一律按字面文本（`| upper` 不是过滤器）
  assert.deepEqual(renderVariables('{{x | upper}}', {}), { text: '{{x | upper}}', missing: [] });

  // 前端预览与服务端渲染逐字符一致（结构上共用同一个渲染函数）
  const valueSets: Array<Record<string, string>> = [{}, { b: '' }, { b: '世界' }];
  for (const values of valueSets) {
    assert.equal(previewRender('{{ a }} {{ b | default(你好) }}', values), renderVariables('{{ a }} {{ b | default(你好) }}', values).text);
  }
  assert.equal(hasVariables('{{ a }}'), true);
  assert.equal(hasVariables('普通文本'), false);
});
