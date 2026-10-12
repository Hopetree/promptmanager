// 阶段 66 / FR-138（BRIEF v77 §6 + §8 AC-128 / D-64）：核心实体 Prompt 的**字段集单一来源**。
//
// 判据分三层：
//   ① 源码级 —— 7 处不再各自手写字段表（读码可验）；
//   ② 编译期 —— 派生出的类型与改前的字面形状**逐字段等价**（多一个/少一个字段都编译失败）；
//   ③ 运行时 —— 派生出的 JSON Schema / 列清单与改前逐字段一致，且导出 → 导入 → 再导出逐字一致。
//
// 真浏览器的像素级证据见库外验收记录（AC-128 ⑪ 的收尾三件套与端到端）。
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Generated } from 'kysely';

import {
  PROMPT_COLUMN_NAMES,
  PROMPT_COLUMNS,
  PROMPT_CONTENT_FIELDS,
  PROMPT_ENTITY_COLUMN_NAMES,
  PROMPT_EXPORTED_COLUMN_NAMES,
  PROMPT_WRITABLE_COLUMN_NAMES,
  PROMPT_WRITABLE_FIELDS,
} from '../src/prompt-columns.ts';
import type { PromptExportedColumns, PromptWritable } from '../src/prompt-columns.ts';
import type { Prompt } from '../web/src/types.ts';
import type { PromptRow, PromptsTable } from '../dist/db/schema.js';
import type { ExportPrompt } from '../dist/services/export.js';
import type { PromptObject } from '../dist/services/prompts.js';
import { readSource } from './source-text.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readSource(rel);

// ─────────────────────────── 编译期：与改前的字面形状逐字段等价 ───────────────────────────

/** 把交叉类型摊平成单一对象类型：派生结果是 `列字段 & 派生字段`（交叉类型），与字面量对象
 *  **结构等价但类型标识不同**；摊平后比较器仍会因多一个 / 少一个 / 改类型的字段而判 `false`
 *  （下面的 `controlExtra` / `controlMissing` 就是这个比较器的对照）。 */
type Flatten<T> = { [K in keyof T]: T[K] };

/** 严格的类型相等（比双向可赋值更严：多一个可选字段也会判不等）。 */
type Equals<A, B> =
  (<T>() => T extends Flatten<A> ? 1 : 2) extends <T>() => T extends Flatten<B> ? 1 : 2
    ? true
    : false;

/** 改前 `src/db/schema.ts` 里 `PromptsTable` 的字面形状（12 列）。 */
type ExpectedPromptsTable = {
  id: Generated<number>;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  favorite: number;
  remember_variables: number;
  version_no: number;
  sort_order: Generated<number>;
  created_at: string;
  updated_at: string;
};

/** 改前 `src/services/prompts.ts` 里 `PromptObject` 的字面形状（14 字段）。 */
type ExpectedPromptObject = {
  id: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  tags: string[];
  favorite: boolean;
  remember_variables: boolean;
  created_at: string;
  updated_at: string;
  version_no: number;
  use_count: number;
  last_used_at: string | null;
};

/** 改前 `web/src/types.ts` 里 `PromptWritable` 的字面形状（8 个可选字段）。 */
type ExpectedPromptWritable = {
  title?: string;
  user_prompt?: string;
  system_prompt?: string;
  notes?: string;
  folder_id?: number | null;
  tags?: string[];
  favorite?: boolean;
  remember_variables?: boolean;
};

/** 改前 `src/services/export.ts` 里 `ExportPrompt` 去掉 `tags` / `versions` 后的字面形状（11 列）。 */
type ExpectedExportedColumns = {
  id: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  sort_order: number;
  favorite: boolean;
  remember_variables: boolean;
  created_at: string;
  updated_at: string;
};

test('AC-128 ③（编译期）：四处派生类型与改前的字面形状逐字段等价', () => {
  // 下面四个 `const` 一旦类型不等就**编译失败**（`Equals` 为 `false` 时不能赋 `true`）。
  const tableEquals: Equals<PromptsTable, ExpectedPromptsTable> = true;
  const objectEquals: Equals<PromptObject, ExpectedPromptObject> = true;
  const webEquals: Equals<Prompt, ExpectedPromptObject> = true;
  const writableEquals: Equals<PromptWritable, ExpectedPromptWritable> = true;
  const exportedEquals: Equals<PromptExportedColumns, ExpectedExportedColumns> = true;
  // `ExportPrompt` 只比列字段多 `tags` / `versions`；`PromptRow` 就是 `Selectable<PromptsTable>`。
  const exportExtras: Equals<Omit<ExportPrompt, 'tags' | 'versions'>, ExpectedExportedColumns> = true;
  const rowIsSelectable: Equals<PromptRow['folder_id'], number | null> = true;
  // 对照：比较器必须能抓到「多一个可选字段」与「少一个必填字段」，否则上面四个 `true` 没有意义。
  const controlExtra: Equals<{ a: string }, { a: string; b?: string }> = false;
  const controlMissing: Equals<{ a: string; b: string }, { a: string }> = false;
  void controlExtra;
  void controlMissing;

  assert.deepEqual(
    [tableEquals, objectEquals, webEquals, writableEquals, exportedEquals, exportExtras, rowIsSelectable],
    [true, true, true, true, true, true, true],
  );
  assert.ok(PROMPT_COLUMNS.id.generated, 'id 仍是 generated（DEFAULT 列）');
});

// ─────────────────────────── 源码级：7 处不再各自手写字段表 ───────────────────────────

test('AC-128 ①：7 处手写字段表都改成从 `src/prompt-columns.ts` 派生', () => {
  const columns = read('src/prompt-columns.ts');
  const schema = read('src/db/schema.ts');
  const prompts = read('src/services/prompts.ts');
  const exportService = read('src/services/export.ts');
  const webTypes = read('web/src/types.ts');
  const routes = read('src/server/routes/prompts.ts');

  // 单一来源本身：12 个列，每个列都有完整 6 个键（`sql` / `generated` / `api` / `exported` / `writable` + `schema`|`default`）
  assert.match(columns, /export const PROMPT_COLUMNS = \{/, '列清单必须是一个 `as const` 常量表');
  assert.equal(PROMPT_COLUMN_NAMES.length, 12);
  for (const name of PROMPT_COLUMN_NAMES) {
    const spec = PROMPT_COLUMNS[name];
    for (const key of ['sql', 'generated', 'api', 'exported', 'writable'] as const) {
      assert.ok(key in spec, `${name} 缺少 ${key}`);
    }
  }

  // ① DB 表类型：改成派生（type alias），不再手写 12 列
  assert.match(schema, /export type PromptsTable = \{/, 'PromptsTable 必须是派生出来的 type alias');
  const tableBlock = schema.slice(schema.indexOf('export type PromptsTable'));
  const tableDecl = tableBlock.slice(0, tableBlock.indexOf('\n};'));
  assert.equal(/title: string;/.test(tableDecl), false, 'PromptsTable 不得再手写列声明');
  assert.equal(tableDecl.includes('remember_variables: number'), false, 'PromptsTable 不得再手写 remember_variables');
  assert.equal(tableDecl.includes('sort_order: Generated<number>'), false, 'Generated<> 包装层也由清单派生');

  // ② 服务层实体类型
  assert.equal(prompts.includes('export interface PromptObject {'), false);
  assert.match(prompts, /export type PromptObject = PromptEntity;/);
  assert.equal(prompts.includes('export interface CreatePromptInput {'), false);
  assert.match(prompts, /export type CreatePromptInput = PromptWritable;/);

  // ③ 前端类型
  assert.equal(webTypes.includes('export interface Prompt {'), false);
  assert.match(webTypes, /export type Prompt = PromptEntity;/);
  assert.equal(webTypes.includes('export interface PromptWritable {'), false);
  assert.match(webTypes, /export type PromptWritable = PromptWritableShape;/);
  assert.match(
    webTypes,
    /from '\.\.\/\.\.\/src\/prompt-columns(\.js)?'/,
    '前端必须 type-only 引用同一份清单（`.js` 后缀是为了同时满足 web 的 Bundler 与 tests 的 NodeNext 解析）',
  );

  // ④ 导出类型与映射
  assert.match(exportService, /export type ExportPrompt = PromptExportedColumns & \{/);
  assert.match(exportService, /promptExportedColumnsFrom\(row\)/);
  assert.equal(exportService.includes('remember_variables: row.remember_variables === 1'), false, '导出映射不得再手写');

  // ⑤⑥⑦ 校验 schema：一份，且来自清单
  assert.equal(routes.includes('const writableFields'), false, '不得再手写可写字段表');
  assert.equal(routes.includes('createPromptSchema'), false, 'create 与 update 必须合一份（AC-128 ②）');
  assert.equal(routes.includes('updatePromptSchema'), false);
  assert.match(routes, /import \{ PROMPT_WRITABLE_FIELDS \} from '\.\.\/\.\.\/prompt-columns\.js';/);
  assert.equal([...routes.matchAll(/promptWritableSchema/g)].length, 3, '一份定义 + create/update 各用一次');
});

test('AC-128 ②：可写字段的 JSON Schema 由列清单派生，且与改前逐字段一致', () => {
  // 逐字来自改前 `src/server/routes/prompts.ts` 的 `writableFields`。
  assert.deepEqual(PROMPT_WRITABLE_FIELDS, {
    title: { type: 'string', maxLength: 500 },
    user_prompt: { type: 'string', maxLength: 200_000 },
    system_prompt: { type: 'string', maxLength: 200_000 },
    notes: { type: 'string', maxLength: 200_000 },
    folder_id: { type: ['integer', 'null'], minimum: 1 },
    favorite: { type: 'boolean' },
    remember_variables: { type: 'boolean' },
    tags: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 64 } },
  });
  assert.deepEqual(PROMPT_WRITABLE_COLUMN_NAMES, [
    'title',
    'user_prompt',
    'system_prompt',
    'notes',
    'folder_id',
    'favorite',
    'remember_variables',
  ]);
  assert.deepEqual(PROMPT_ENTITY_COLUMN_NAMES, [
    'id',
    'title',
    'user_prompt',
    'system_prompt',
    'notes',
    'folder_id',
    'favorite',
    'remember_variables',
    'version_no',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(PROMPT_EXPORTED_COLUMN_NAMES, [
    'id',
    'title',
    'user_prompt',
    'system_prompt',
    'notes',
    'folder_id',
    'favorite',
    'remember_variables',
    'sort_order',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(PROMPT_COLUMN_NAMES, [
    'id',
    'title',
    'user_prompt',
    'system_prompt',
    'notes',
    'folder_id',
    'favorite',
    'remember_variables',
    'version_no',
    'sort_order',
    'created_at',
    'updated_at',
  ]);
});

// ─────────────────────────── 运行时：映射助手的取值语义与改前一致 ───────────────────────────

test('AC-128 ③：映射助手的 0/1 ↔ boolean 与缺省取值逐条与改前一致', async () => {
  const { promptEntityColumnsFrom, promptCreateColumns, promptPatchColumns } = await import(
    '../src/prompt-columns.ts'
  );

  // 行 → 契约：0/1 → false/true（改前是 `row.favorite === 1`）
  const row = {
    id: 7,
    title: 't',
    user_prompt: 'u',
    system_prompt: 's',
    notes: 'n',
    folder_id: null,
    favorite: 1,
    remember_variables: 0,
    version_no: 3,
    sort_order: 9,
    created_at: 'c',
    updated_at: 'd',
  };
  assert.deepEqual(promptEntityColumnsFrom(row), {
    id: 7,
    title: 't',
    user_prompt: 'u',
    system_prompt: 's',
    notes: 'n',
    folder_id: null,
    favorite: true,
    remember_variables: false,
    version_no: 3,
    created_at: 'c',
    updated_at: 'd',
  });
  assert.equal('sort_order' in promptEntityColumnsFrom(row), false, 'sort_order 不是契约字段');

  // 契约 → 列：缺省值与改前一致（'' / null / false / remember_variables 默认 true）
  assert.deepEqual(promptCreateColumns({}), {
    title: '',
    user_prompt: '',
    system_prompt: '',
    notes: '',
    folder_id: null,
    favorite: 0,
    remember_variables: 1,
  });
  assert.deepEqual(promptCreateColumns({ favorite: true, remember_variables: false, folder_id: 5 }), {
    title: '',
    user_prompt: '',
    system_prompt: '',
    notes: '',
    folder_id: 5,
    favorite: 1,
    remember_variables: 0,
  });

  // PUT 子集：没给的保持原值，给了的按 0/1 写回
  const existing = {
    id: 7,
    title: '旧',
    user_prompt: 'u',
    system_prompt: 's',
    notes: 'n',
    folder_id: 2,
    favorite: 1,
    remember_variables: 1,
    version_no: 3,
    sort_order: 9,
    created_at: 'c',
    updated_at: 'd',
  };
  assert.deepEqual(promptPatchColumns(existing, { title: '新', favorite: false }), {
    title: '新',
    user_prompt: 'u',
    system_prompt: 's',
    notes: 'n',
    folder_id: 2,
    favorite: 0,
    remember_variables: 1,
  });
  assert.equal(
    Object.keys(promptPatchColumns(existing, {})).length,
    7,
    '键集合必须恰是 7 个可写列（多写 id/sort_order 会污染 UPDATE）',
  );
});

// ─────────────────────────── AC-128 ⑩⑬：零迁移 / 零新依赖 / 操作说明 ───────────────────────────

test('AC-128 ⑩：零迁移（阶段 66 自己没新增；阶段 68 起总数是 9）与零新增依赖', () => {
  const migrations = readdirSync(path.join(ROOT, 'migrations')).filter((name) => name.endsWith('.sql'));
  assert.equal(migrations.length, 9, `迁移总数必须与目录一致（阶段 68 起是 9 个，实际 ${String(migrations.length)}）`);
  assert.equal(existsSync(path.join(ROOT, 'migrations', '009_pinned.sql')), false);
  assert.deepEqual(
    migrations.filter((name) => name.startsWith('009')),
    ['009_fts-update-when.sql'],
    '阶段 66 自己没新增迁移；009 是阶段 68 的 FTS 触发器迁移（AC-130 ①）',
  );
});

test('AC-128 ⑬：文档里写清「加一个字段该动哪里」，且与本文件一致', () => {
  const development = read('docs/development.md');
  assert.match(development, /## \d+\.\s*加一个 Prompt 字段/, 'docs/development.md 必须有「加一个字段」小节');
  assert.match(development, /src\/prompt-columns\.ts/, '必须点名单一来源文件');
  assert.match(development, /migrations\//, '必须说明迁移仍是绕不开的一步');
  // 文档点名的"类型检查会逼你改的地方"必须与实测一致
  for (const forced of ['src/services/import.ts', 'web/src/components/Workspace.tsx']) {
    assert.ok(development.includes(forced), `文档必须点名 ${forced}（演练实测被类型检查逼着改）`);
  }
});

// ─────────────────── AC-128 ⑬（返工 ①）：加字段口径必须与实测一致 ───────────────────
//
// 复核 finding（major）：原 §7 写"必须改的文件从 27 个降到 6 个"，并只给 `typecheck:web` +
// `typecheck:tests` 两条命令。实测：① 编译器点名的是 5 个文件（漏了本文件自己）；
// ② `typecheck:tests` = `build:server && tsc tests && tsc render-tests`，第一条失败就**短路**，
// 只报 import.ts 一条，把另外 12 条藏起来 ⇒ 按文档操作会得到假全绿；
// ③ 真加一个字段今天仍要动 21 个文件（13 个是故意写死的守卫测试），27 → 6 是苹果对橘子。

test('AC-128 ⑬（返工 ①）：§7 的加字段口径与实测一致（编译器点名 5 / 仍要动 21 / 对照 27）', () => {
  const development = read('docs/development.md');
  // 四条原始命令一条都不能少（短路藏错的坑必须靠分开跑规避）
  for (const command of [
    'npm run typecheck:web',
    'npm run build:server',
    'npx tsc -p tsconfig.tests.json',
    'npx tsc -p tsconfig.render-tests.json',
  ]) {
    assert.ok(development.includes(command), `§7 必须给出原始命令 ${command}`);
  }
  assert.ok(development.includes('短路'), '§7 必须警告 typecheck:tests 第一条失败就短路、会藏错');
  // 编译器点名的 5 个文件，一个都不能漏（复核实测：含本文件自己 10 条）
  for (const named of [
    'src/services/import.ts',
    'web/src/components/Workspace.tsx',
    'tests/stage66-field-source.test.ts',
    'tests/render/smoke.test.ts',
    'tests/render/stage65-frontend-state.test.ts',
  ]) {
    assert.ok(development.includes(named), `§7 必须点名编译器点名的文件 ${named}`);
  }
  assert.ok(development.includes('21 个文件'), '§7 必须写清真加一个字段仍要动 21 个文件');
  assert.ok(development.includes('27'), '§7 必须保留阶段 61 的对照数字 27');
  assert.ok(development.includes('守卫测试'), '§7 必须说明 13 个守卫测试是故意写死的绊线');
  assert.ok(development.includes('静默漂移'), '§7 必须点明收敛消除的是静默漂移、不是改动面');
  assert.equal(
    /27\s*个降到\s*6\s*个/.test(development),
    false,
    '§7 不得再出现「27 个降到 6 个」（复核已证伪）',
  );
  assert.ok(development.includes('界面'), '§7 必须点明界面写路径是唯一没被编译器保护的地方');
});

test('AC-128 ⑬（返工 ①，续）：CHANGELOG 的加字段口径与 §7 一致，不得再写 27 → 6', () => {
  const changelog = read('CHANGELOG.md');
  assert.equal(/27\s*(→|->)\s*6/.test(changelog), false, 'CHANGELOG 不得再写「27 → 6」');
  assert.ok(changelog.includes('编译器点名 5 个文件'), 'CHANGELOG 必须写清编译器点名 5 个文件');
  assert.ok(changelog.includes('21 个文件'), 'CHANGELOG 必须写清真加一个字段仍要动 21 个文件');
  assert.ok(changelog.includes('27'), 'CHANGELOG 必须保留阶段 61 的对照数字 27');
  assert.ok(changelog.includes('docs/development.md'), 'CHANGELOG 必须指到 §7 的完整口径');
  assert.ok(changelog.includes('界面写路径'), 'CHANGELOG 必须点明界面写路径没被编译器保护');
});

// ─────────────────── AC-128 ⑭（返工 ①）：界面写路径的守卫 ───────────────────
//
// 复核 finding（minor）：`web/src/components/PromptEditor.tsx` 的 `EditorForm` 与保存 payload 仍手写，
// 而 `PromptWritable` 的字段**全是可选的** ⇒ 往列清单加一个可写列时界面会**静默不发送它**
// （编译通过、校验通过、值永远是缺省）。这是唯一没被编译器保护的写路径，必须由测试盯住。

test('AC-128 ⑭（返工 ①）：界面保存 payload 覆盖全部可写列（唯一没被编译器保护的写路径）', () => {
  const editor = read('web/src/components/PromptEditor.tsx');
  const start = editor.indexOf('const payload: PromptWritable = {');
  assert.ok(start >= 0, '必须能找到界面保存 payload 的声明（const payload: PromptWritable = {）');
  const end = editor.indexOf('};', start);
  assert.ok(end > start, '必须能找到 payload 的结尾');
  const payload = editor.slice(start, end);
  for (const name of [...PROMPT_WRITABLE_COLUMN_NAMES, 'tags']) {
    assert.ok(
      payload.includes(`${name}:`),
      `保存 payload 必须覆盖可写字段 ${name}（否则界面会静默不发送它，编译期看不出来）`,
    );
  }
  // 表单也得有对应字段，否则用户根本改不到它
  const formStart = editor.indexOf('interface EditorForm {');
  const formEnd = editor.indexOf('}', formStart);
  assert.ok(formStart >= 0 && formEnd > formStart, '必须能找到 EditorForm 接口');
  const form = editor.slice(formStart, formEnd);
  for (const name of PROMPT_WRITABLE_COLUMN_NAMES) {
    assert.match(
      form,
      new RegExp(`^\\s*${name}\\??:`, 'm'),
      `EditorForm 必须声明可写字段 ${name}（界面表单是字段集的最后一个消费者）`,
    );
  }
});

// ─────────────────── AC-128 ⑮（返工 ①）：内容字段分类也由列清单派生 ───────────────────

test('AC-128 ⑮（返工 ①）：内容字段分类由列清单派生（不再是第二份手写字段表）', () => {
  const prompts = read('src/services/prompts.ts');
  assert.equal(
    /CONTENT_FIELDS = \[/.test(prompts),
    false,
    '不得再手写内容字段数组（手写时往列清单加内容字段不会跟着长 ⇒ 落库但不产生版本留档）',
  );
  assert.match(prompts, /export const CONTENT_FIELDS = PROMPT_CONTENT_FIELDS;/, '必须派生自列清单');
  const columns = read('src/prompt-columns.ts');
  assert.match(columns, /PROMPT_CONTENT_FIELDS = PROMPT_COLUMN_NAMES\.filter/, '必须从列名派生');
  assert.match(columns, /const spec: PromptColumnSpec = PROMPT_COLUMNS\[name\]/, '必须读列清单里的那一列');
  assert.match(columns, /spec\.content === true/, '必须按 content 标记过滤');
  assert.deepEqual(
    [...PROMPT_CONTENT_FIELDS],
    ['title', 'user_prompt', 'system_prompt', 'notes'],
    '内容字段必须恰是这 4 个（FR-129 / D-60 ③ 固定边界）',
  );
  assert.equal(
    [...columns.matchAll(/content: true,/g)].length,
    4,
    '列清单里必须恰有 4 个列标了 content: true',
  );
});
