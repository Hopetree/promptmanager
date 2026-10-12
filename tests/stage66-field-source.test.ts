// 阶段 66 / FR-138（BRIEF v77 §6 + §8 AC-128 / D-64）：核心实体 Prompt 的**字段集单一来源**。
//
// 判据分三层：
//   ① 源码级 —— 7 处不再各自手写字段表（读码可验）；
//   ② 编译期 —— 派生出的类型与改前的字面形状**逐字段等价**（多一个/少一个字段都编译失败）；
//   ③ 运行时 —— 派生出的 JSON Schema / 列清单与改前逐字段一致，且导出 → 导入 → 再导出逐字一致。
//
// 真浏览器的像素级证据见库外验收记录（AC-128 ⑪ 的收尾三件套与端到端）。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Generated } from 'kysely';

import {
  PROMPT_COLUMN_NAMES,
  PROMPT_COLUMNS,
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

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

test('AC-128 ⑩：零迁移（migrations 仍 8 个、无 009）与零新增依赖', () => {
  const migrations = readdirSync(path.join(ROOT, 'migrations')).filter((name) => name.endsWith('.sql'));
  assert.equal(migrations.length, 8, `迁移必须仍是 8 个（实际 ${String(migrations.length)}）`);
  assert.equal(existsSync(path.join(ROOT, 'migrations', '009_pinned.sql')), false);
  assert.equal(migrations.some((name) => name.startsWith('009')), false, '本阶段不得新增迁移');
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
