// 阶段 60 / FR-126 / AC-122：提示词变量支持「默认值」—— `{{ 名字 | default(默认值) }}`（Jinja 系语法）。
//
// 本文件按 AC-122 的 A~F 六组逐条落断言。判据以 `tmp/dev-process/BRIEF.md` 的
// **FR-126 / AC-122 / D-58** 三节为准，不以派活提示词为准。
//
// 铁律（D-58 / FR-126 ④）：**现有变量行为一条都不能变** ——
// `{{名字}}`、`\{{}}` 转义、`{{a b}}` / `{{}}` / `{{x!}}` 不匹配即字面、`missing` 语义、
// 空串算"已提供"、非字符串算"未提供"，全部保持原样。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { extractVariables, renderVariables, scanVariables } from '../dist/services/variables.js';
import {
  extractVariablesLocal,
  filledValues,
  hasVariables,
  previewRender,
} from '../web/src/pure.ts';
import { PROJECT_ROOT, cookieOf, login, makeFixture } from './helpers.ts';

const src = (relative: string): string => readFileSync(path.join(PROJECT_ROOT, relative), 'utf8');

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function createPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: number }).id;
}

/* ============================================================
   A. 语法与解析（AC-122 第 1–8 条）
   ============================================================ */

test('AC-122 ①：提取带默认值的变量 + defaults 映射；无默认值的项不进 defaults', () => {
  const text = '{{ a }} 与 {{ b | default(你好) }} 与 {{ c | default() }}';
  const scan = scanVariables(text);
  assert.deepEqual(scan.variables, ['a', 'b', 'c'], '三个变量都要被提取');
  assert.deepEqual(scan.defaults, { b: '你好', c: '' }, 'a 无默认值 ⇒ 不在 defaults 里');
  // 既有入口语义不变（仍是名字数组）
  assert.deepEqual(extractVariables(text), ['a', 'b', 'c']);
});

test('AC-122 ②：不认识的写法一律按字面（不进 variables、渲染原样保留）', () => {
  const literals = [
    '{{ d | upper }}', // 其它过滤器
    '{{ e | default }}', // 无括号
    '{{ z | Default(x) }}', // 大小写：只认小写 default
    '{{ z | default(x) | upper }}', // 过滤器链
    '{{ z | default x }}', // 缺括号
  ];
  for (const text of literals) {
    assert.deepEqual(extractVariables(text), [], `不得识别：${text}`);
    assert.deepEqual(scanVariables(text).defaults, {}, `不得识别：${text}`);
    const rendered = renderVariables(text, {});
    assert.equal(rendered.text, text, `必须原样保留：${text}`);
    assert.deepEqual(rendered.missing, [], `字面文本不进 missing：${text}`);
  }
});

test('AC-122 ③：转义 \\{{…}} 输出字面文本（去掉反斜杠），名字不进 variables', () => {
  const text = '\\{{ f | default(x) }}';
  assert.deepEqual(extractVariables(text), [], '转义的默认值写法不算变量');
  assert.equal(renderVariables(text, {}).text, '{{ f | default(x) }}', '去掉反斜杠、其余原样');
  assert.equal(renderVariables(text, { f: 'F' }).text, '{{ f | default(x) }}', '给了值也不渲染（转义优先）');
  // 既有转义行为不回归
  assert.equal(renderVariables('\\{{保留}}', {}).text, '{{保留}}');
  assert.deepEqual(extractVariables('\\{{保留}} 与 {{真的}}'), ['真的']);
});

test('AC-122 ④：竖线写成转义形式（反斜杠 + 竖线）同样识别为带默认值的变量', () => {
  const text = '{{ g \\| default(x) }}';
  const scan = scanVariables(text);
  assert.deepEqual(scan.variables, ['g']);
  assert.deepEqual(scan.defaults, { g: 'x' });
  assert.equal(renderVariables(text, {}).text, 'x');
  // 转义竖线的写法与不转义的写法**等价**
  assert.deepEqual(scanVariables('{{ g | default(x) }}'), scan);
});

test('AC-122 ⑤：名字规则与「不匹配即字面」不变', () => {
  assert.deepEqual(extractVariables('{{a b}}'), []);
  assert.deepEqual(extractVariables('{{}}'), []);
  assert.deepEqual(extractVariables('{{x!}}'), []);
  assert.deepEqual(extractVariables('{{a.b}}'), []);
  assert.deepEqual(extractVariables('{{ 名字 }}'), ['名字'], '两端空白仍被接受');
  assert.deepEqual(extractVariables(`{{${'长'.repeat(64)}}}`), ['长'.repeat(64)]);
  assert.deepEqual(extractVariables(`{{${'长'.repeat(65)}}}`), []);
  // 带默认值时名字规则同样不变：超长 / 含空白一律字面
  assert.deepEqual(extractVariables(`{{ ${'长'.repeat(65)} | default(x) }}`), []);
  assert.deepEqual(extractVariables('{{a b | default(x)}}'), []);
  assert.equal(renderVariables('{{a b}} {{}}', {}).text, '{{a b}} {{}}');
});

test('AC-122 ⑥：默认值两端若是成对引号 ⇒ 剥掉这一对', () => {
  assert.deepEqual(scanVariables("{{ h | default('z') }}").defaults, { h: 'z' });
  assert.deepEqual(scanVariables('{{ h | default("z") }}').defaults, { h: 'z' });
  assert.deepEqual(scanVariables("{{ h | default( 'z' ) }}").defaults, { h: 'z' }, '先去空白再剥引号');
  assert.deepEqual(scanVariables("{{ h | default('a)b') }}").defaults, { h: 'a)b' });
  assert.deepEqual(scanVariables('{{ h | default("") }}').defaults, { h: '' });
  // 不成对 / 只有一个引号 ⇒ 不剥
  assert.deepEqual(scanVariables("{{ h | default('z) }}").defaults, { h: "'z" });
  assert.deepEqual(scanVariables("{{ h | default('z\") }}").defaults, { h: "'z\"" });
  assert.deepEqual(scanVariables("{{ h | default(') }}").defaults, { h: "'" });
});

test('AC-122 ⑦：默认值可含特殊字符（取「紧跟 }} 的那个 )」之间的字面文本）', () => {
  assert.deepEqual(scanVariables('{{ i | default(a)b) }}').defaults, { i: 'a)b' });
  assert.deepEqual(scanVariables('{{ j | default(x:y) }}').defaults, { j: 'x:y' });
  assert.deepEqual(scanVariables('{{ j | default(a|b) }}').defaults, { j: 'a|b' });
  assert.deepEqual(scanVariables('{{ j | default( 两边去空白 ) }}').defaults, { j: '两边去空白' });
  // 默认值里出现 `}}` 也不能把占位符截断
  assert.deepEqual(scanVariables('{{ j | default(a}}b) }}').defaults, { j: 'a}}b' });
});

test('AC-122 ⑧：默认值是字面文本，不递归展开', () => {
  const text = '{{ k | default({{x}}) }}';
  const scan = scanVariables(text);
  assert.deepEqual(scan.variables, ['k'], '内部的 {{x}} 不得被当成变量');
  assert.deepEqual(scan.defaults, { k: '{{x}}' });
  assert.equal(renderVariables(text, {}).text, '{{x}}', '默认值原样输出，不再解析');
});

/* ============================================================
   B. 渲染语义（AC-122 第 9–12 条）
   ============================================================ */

test('AC-122 ⑨：没填 ⇒ 用默认值，且不进 missing', () => {
  const r = renderVariables('你好 {{ b | default(你好) }}', {});
  assert.equal(r.text, '你好 你好');
  assert.deepEqual(r.missing, []);
  // 混排：有默认值的消失，无默认值的仍原样 + missing
  const mixed = renderVariables('{{ a }} / {{ b | default(B) }}', {});
  assert.equal(mixed.text, '{{ a }} / B');
  assert.deepEqual(mixed.missing, ['a']);
});

test('AC-122 ⑩：显式空串 ⇒ 渲染成空（不是回落到默认值）', () => {
  const r = renderVariables('你好 {{ b | default(你好) }}', { b: '' });
  assert.equal(r.text, '你好 ');
  assert.deepEqual(r.missing, []);
});

test('AC-122 ⑪：无默认值且没填 ⇒ 现状不变（原样保留 + missing）', () => {
  const r = renderVariables('{{ a }}', {});
  assert.equal(r.text, '{{ a }}');
  assert.deepEqual(r.missing, ['a']);
  // 非字符串值仍视为"未提供"（既有契约）；有默认值时按"没填"处理 ⇒ 用默认值且不进 missing
  assert.deepEqual(renderVariables('{{a}}', { a: 123 }), { text: '{{a}}', missing: ['a'] });
  assert.deepEqual(renderVariables('{{q | default(D)}}', { q: 123 }), { text: 'D', missing: [] });
});

test('AC-122 ⑫：同名多处默认值不同 ⇒ 取首次出现，全篇一致', () => {
  const text = '{{ p | default(第一) }} 和 {{ p | default(第二) }}';
  assert.deepEqual(scanVariables(text).defaults, { p: '第一' });
  assert.equal(renderVariables(text, {}).text, '第一 和 第一');
  // 提取顺序仍是首次出现（既有契约）
  assert.deepEqual(scanVariables('{{甲}} {{乙}} {{甲}}').variables, ['甲', '乙']);
});

/* ============================================================
   C. 前后端一致性（AC-122 第 13–14 条）
   ============================================================ */

test('AC-122 ⑬：前端纯逻辑与服务端同规则（含默认值场景）', () => {
  const text = '{{ a }} / {{ b | default(你好) }} / {{ c | default() }} / {{ d | upper }} / \\{{ e }}';
  assert.deepEqual(extractVariablesLocal(text), ['a', 'b', 'c'], '前端提取与服务端一致');
  assert.equal(hasVariables(text), true);

  const CASES: Array<Record<string, string>> = [{}, { a: 'A' }, { b: '' }, { a: 'A', b: 'B' }, { d: 'D' }];
  for (const values of CASES) {
    const rendered = renderVariables(text, values);
    assert.equal(previewRender(text, values), rendered.text, `预览与服务端必须逐字符一致：${JSON.stringify(values)}`);
  }
  // 未填的默认值变量在预览里直接出默认值（不是留着占位符）
  assert.equal(previewRender('{{ b | default(你好) }}', {}), '你好');
  // 只统计"无默认值且未填"的才算未填
  assert.deepEqual(filledValues(['a', 'b'], { a: '', b: 'x' }), { b: 'x' });
});

test('AC-122 ⑭：前后端两份占位符正则逐字一致', () => {
  const pick = (text: string): string => {
    const match = /const (?:PM_)?PLACEHOLDER = (\/.*?\/gu);/.exec(text);
    assert.ok(match !== null, '未找到占位符正则定义');
    return match[1] ?? '';
  };
  const server = pick(src('src/services/variables.ts'));
  const client = pick(src('web/src/pure.ts'));
  assert.equal(client, server, '两份正则必须逐字一致（FR-126 ④）');
});

/* ============================================================
   D. 契约与兼容（AC-122 第 15–19 条）
   ============================================================ */

test('AC-122 ⑮⑯：GET /variables 的 variables 形状不变 + 新增 defaults；render 请求体不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await createPrompt(fx, cookie, {
      title: '默认值夹具',
      user_prompt: '{{ a }} {{ b | default(你好) }} {{ c | default() }}',
      system_prompt: '{{ s | default(系统) }}',
    });

    const res = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/variables`, headers: { cookie } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { variables: unknown; defaults: unknown };
    assert.deepEqual(body.variables, ['a', 'b', 'c', 's'], 'variables 仍是字符串数组（形状不变）');
    assert.ok(Array.isArray(body.variables), 'variables 必须是数组');
    assert.deepEqual(body.defaults, { b: '你好', c: '', s: '系统' });

    // 无默认值时 defaults 是空对象（形状稳定，调用方不必处理两种形状）
    const plain = await createPrompt(fx, cookie, { title: '无默认值', user_prompt: '{{ a }}' });
    const plainRes = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(plain)}/variables`, headers: { cookie } });
    assert.deepEqual(plainRes.json(), { variables: ['a'], defaults: {} });

    // render 的请求体不变：只传 values（调用方完全不必知道默认值的存在）
    const rendered = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { cookie },
      payload: { values: {} },
    });
    assert.equal(rendered.statusCode, 200, rendered.body);
    const out = rendered.json() as { user_prompt: string; system_prompt: string; missing: string[] };
    assert.equal(out.user_prompt, '{{ a }} 你好 ');
    assert.equal(out.system_prompt, '系统');
    assert.deepEqual(out.missing, ['a'], '有默认值的变量不再进 missing');

    // 显式空串 ⇒ 空，且请求体形状不变
    const empty = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { cookie },
      payload: { values: { b: '' } },
    });
    assert.equal((empty.json() as { user_prompt: string }).user_prompt, '{{ a }}  ', 'b 传空串 ⇒ 空；c 未填但有默认值 "" ⇒ 也是空');
  } finally {
    await fx.close();
  }
});

test('AC-122 ⑰：MCP prompt_get 带出 defaults（加法，不改既有字段）', () => {
  const server = src('src/mcp/server.ts');
  assert.match(server, /defaults/, 'prompt_get 必须带出 defaults');
  // prompt_render 不需要改：默认值由服务端渲染时应用
  assert.match(server, /`\/api\/prompts\/\$\{String\(id\)\}\/variables`/, '仍从 /variables 取变量');
});

test('AC-122 ⑱：零迁移 —— migrations/ 不新增文件、schema 版本不变', () => {
  const files = readdirSync(path.join(PROJECT_ROOT, 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.deepEqual(
    files,
    [
      '001_init.sql',
      '002_tokens-and-usage.sql',
      '003_prompt-sort-order.sql',
      '004_token-enc.sql',
      '005_token-scope.sql',
      '006_usage-kind.sql',
      '007_sync-config.sql',
    ],
    '阶段 60 零迁移：不得新增迁移文件（后续阶段若新增，同步更新本清单）',
  );
  // 默认值只写在正文里 ⇒ 迁移文件里不得出现名为 default 的**列**
  for (const name of files) {
    assert.equal(
      /^\s*["'`[]?default["'`\]]?\s+(?:TEXT|VARCHAR|INTEGER|REAL|BLOB)/im.test(src(path.join('migrations', name))),
      false,
      `${name} 不应新增名为 default 的列`,
    );
  }
});

test('AC-122 ⑲：导出 → 导入 → 再导出，含默认值的正文逐字一致', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const TEXT = '{{ a }} {{ b | default(你好) }} {{ c | default() }}';
    await createPrompt(fx, cookie, { title: '往返夹具', user_prompt: TEXT, system_prompt: '{{ s | default(系统) }}' });

    const exported = await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
    assert.equal(exported.statusCode, 200, exported.body);
    const file = exported.json() as Record<string, unknown>;
    const before = JSON.stringify(file.prompts);

    const imported = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'replace', data: file },
    });
    assert.equal(imported.statusCode, 200, imported.body);

    const after = await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
    assert.equal(JSON.stringify((after.json() as Record<string, unknown>).prompts), before, '往返必须逐字一致');
    assert.ok(before.includes('default(你好)'), '夹具确实带了默认值');
  } finally {
    await fx.close();
  }
});

/* ============================================================
   E. 界面（AC-122 第 20–21 条）
   ============================================================ */

test('AC-122 ⑳：填值对话框与变量面板把默认值作为占位提示并标注「可留空」', () => {
  const dialog = src('web/src/components/VarsDialog.tsx');
  const panel = src('web/src/components/VariablePanel.tsx');

  for (const [name, text] of [
    ['VarsDialog', dialog],
    ['VariablePanel', panel],
  ] as Array<[string, string]>) {
    assert.match(text, /可留空/, `${name} 必须标注「可留空」`);
    assert.match(text, /defaults/, `${name} 必须使用服务端返回的 defaults`);
    // 占位提示优先显示默认值
    assert.match(text, /placeholder=\{[^}]*defaults/, `${name} 的输入框占位提示要显示默认值`);
  }

  // 「还有 N 个没填」只统计无默认值的变量（VarsDialog 的 missing 计算）
  assert.match(
    dialog,
    /filter\(\(name\) => values\[name\] === undefined && defaults\[name\] === undefined\)/,
    'VarsDialog 的 missing 必须排除有默认值的变量',
  );

  // 前端 api 客户端把 defaults 收进类型（形状不变 + 新增字段）
  const api = src('web/src/api.ts');
  assert.match(api, /variables: string\[\]; defaults: Record<string, string>/, 'api.variables 的返回类型要带 defaults');
});

/* ============================================================
   F. 文档（AC-122 第 22 条）
   ============================================================ */

test('AC-122 ㉒：README / docs/api.md / docs/traps.md 都补了默认值说明', () => {
  const readme = src('README.md');
  assert.match(readme, /default\(/, 'README 的变量写法一节要补默认值语法');
  const api = src('docs/api.md');
  assert.match(api, /defaults/, 'docs/api.md 要补 defaults 字段');
  assert.match(api, /default\(/, 'docs/api.md 要补默认值语法');
  const traps = src('docs/traps.md');
  assert.match(traps, /default/, 'docs/traps.md 要补一条（为什么只支持 default 一个过滤器）');
  assert.match(traps, /竖线/, 'docs/traps.md 要说明竖线在 Markdown 表格里要转义');
});
