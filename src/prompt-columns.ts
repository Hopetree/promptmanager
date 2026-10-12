/**
 * FR-138 / D-64：**Prompt 字段集的唯一来源**。
 *
 * 这个文件只回答一个问题 —— "Prompt 有哪些字段、每个字段长什么样"。其余所有地方都由它派生，
 * 不再各自手写一张字段表：
 *
 * | 派生去处 | 位置 |
 * | --- | --- |
 * | DB 表类型（kysely） | `src/db/schema.ts` 的 `PromptsTable` |
 * | 服务层实体类型 | `src/services/prompts.ts` 的 `PromptObject` / `CreatePromptInput` / `UpdatePromptInput` |
 * | 前端类型 | `web/src/types.ts` 的 `Prompt` / `PromptWritable`（**type-only** 引用，见下） |
 * | 导出文件 | `src/services/export.ts` 的 `ExportPrompt` 与 `buildExport` 的逐字段映射 |
 * | 导入 | `src/services/import.ts` 的 `NormalizedPrompt` 与插入值 |
 * | HTTP 校验 schema | `src/server/routes/prompts.ts`（create / update **合一份**） |
 * | 内容字段分类（FR-129） | `src/services/prompts.ts` 的 `CONTENT_FIELDS`（由 `content` 标记派生） |
 *
 * 为什么放在 `src/` 顶层：
 * - `tsconfig.json` 的 `rootDir` 是 `src`，服务端**必须**能 emit 它 ⇒ 不能放在 `web/`；
 * - `web/tsconfig.json` 用相对路径做 **`import type`** 引用 —— 类型在构建时被抹掉，不进 bundle；
 * - 放在 `src/services/` 之下会让 `src/db/schema.ts` 反向依赖服务层，故取顶层。
 *
 * 两处**有意保留的例外**（D-64 ②：宁可留一处有解释的例外，也不为了统一扭曲类型）：
 * 1. `tags`（多对多关联表）、`use_count` / `last_used_at`（聚合算出）**不是列**，无法从列清单派生，
 *    各自单独声明（见 `PromptDerivedFields` / `PromptWritableExtraFields`）。
 * 2. kysely 的 `Generated<>` 包装层不在本文件里 —— 它只依赖 `sql` / `generated` 两个标记，
 *    由 `src/db/schema.ts` 自己包一层（本文件因此**零 import**，前端可以安全地 type-only 引用）。
 * 3. `src/services/import.ts` 的归一化返回值仍是**逐字段字面量**（读文件 → 校验 → 组装），
 *    但它被 `interface NormalizedPrompt extends PromptExportedColumns` **类型强制完整** ——
 *    少一个字段编译不过，所以它不构成"第二份字段表"（不是派生，但也不会静默漂移）。
 *
 * ⚠️ **编译器管不到的写路径**：`web/src/components/PromptEditor.tsx` 的表单与保存 payload 仍是手写的，
 * 而 `PromptWritable` 的字段全是可选的 ⇒ 新加一个**可写**列时界面会**静默不发送它**。
 * 这条路径由 `tests/stage66-field-source.test.ts` 的一条用例盯住（它读源码，断言 payload 覆盖全部可写列）。
 *
 * ⚠️ 加一个字段要动哪些地方：`docs/development.md` §7（含"编译器点名 5 个文件、但仍要动 21 个"的实测口径）。
 */

/** DB 列的类型种类（决定 kysely 表类型）。 */
export type PromptSqlKind = 'integer' | 'text' | 'integer-null' | 'boolean-int';

/** 契约（实体 / 导出文件 / 可写输入）里的类型种类；`none` = 不进 Prompt 实体。 */
export type PromptApiKind = 'number' | 'string' | 'boolean' | 'number-null' | 'none';

export interface PromptColumnSpec {
  /** DB 列类型 */
  readonly sql: PromptSqlKind;
  /** 列上有 `DEFAULT`（插入可省略）⇒ 派生出的 kysely 表类型用 `Generated<>` 包一层 */
  readonly generated: boolean;
  /** 契约里的类型（`none` = 不进实体；`sort_order` 就是这样：进导出文件但不进接口对象） */
  readonly api: PromptApiKind;
  /** 是否写进导出文件（`buildExport` / 导入都按它走） */
  readonly exported: boolean;
  /** 是否随 `POST /api/prompts` 与 `PUT /api/prompts/:id` 可写（HTTP 校验 schema 也按它派生） */
  readonly writable: boolean;
  /** 是否算「内容字段」（FR-129 / D-60 ③）：改了它才产生新版本、才更新 `updated_at` */
  readonly content?: boolean;
  /** 新建时的缺省值（只有 `writable` 列需要） */
  readonly default?: string | number | boolean | null;
  /** 可写列的 JSON Schema 片段（只有 `writable` 列需要） */
  readonly schema?: Readonly<Record<string, unknown>>;
}

/**
 * **列清单**：Prompt 实体在 `prompts` 表里的全部列，顺序与 `migrations/001_init.sql` 起的建表顺序一致。
 *
 * 加字段就在这里加一行 —— 类型、校验 schema、导出 / 导入映射都会跟着长出来（见文件头）。
 */
export const PROMPT_COLUMNS = {
  id: {
    sql: 'integer',
    generated: true,
    api: 'number',
    exported: true,
    writable: false,
  },
  title: {
    sql: 'text',
    generated: false,
    api: 'string',
    exported: true,
    writable: true,
    content: true,
    default: '',
    schema: { type: 'string', maxLength: 500 },
  },
  user_prompt: {
    sql: 'text',
    generated: false,
    api: 'string',
    exported: true,
    writable: true,
    content: true,
    default: '',
    schema: { type: 'string', maxLength: 200_000 },
  },
  system_prompt: {
    sql: 'text',
    generated: false,
    api: 'string',
    exported: true,
    writable: true,
    content: true,
    default: '',
    schema: { type: 'string', maxLength: 200_000 },
  },
  notes: {
    sql: 'text',
    generated: false,
    api: 'string',
    exported: true,
    writable: true,
    content: true,
    default: '',
    schema: { type: 'string', maxLength: 200_000 },
  },
  folder_id: {
    sql: 'integer-null',
    generated: false,
    api: 'number-null',
    exported: true,
    writable: true,
    default: null,
    schema: { type: ['integer', 'null'], minimum: 1 },
  },
  favorite: {
    sql: 'boolean-int',
    generated: false,
    api: 'boolean',
    exported: true,
    writable: true,
    default: false,
    schema: { type: 'boolean' },
  },
  /**
   * FR-127 / D-59：是否记住这个提示词的变量值（1 = 记住，0 = 不记住）。列上有
   * `NOT NULL DEFAULT 1`（迁移 008），缺省「记住」。**变量值本身仍只存浏览器 localStorage**
   * （`pm-vars:<id>`），本列只控制"要不要记"。
   */
  remember_variables: {
    sql: 'boolean-int',
    generated: false,
    api: 'boolean',
    exported: true,
    writable: true,
    default: true,
    schema: { type: 'boolean' },
  },
  version_no: {
    sql: 'integer',
    generated: false,
    api: 'number',
    exported: false,
    writable: false,
  },
  /**
   * FR-70 / D-28：自定义排序位。列上有 `NOT NULL DEFAULT 0`（迁移 003），故插入可省略。
   * 它是唯一 `api: 'none'` 的列：进导出文件、但不进接口对象（前端用 `sort` 参数而不是这个值）。
   */
  sort_order: {
    sql: 'integer',
    generated: true,
    api: 'none',
    exported: true,
    writable: false,
  },
  created_at: {
    sql: 'text',
    generated: false,
    api: 'string',
    exported: true,
    writable: false,
  },
  updated_at: {
    sql: 'text',
    generated: false,
    api: 'string',
    exported: true,
    writable: false,
  },
} as const satisfies Record<string, PromptColumnSpec>;

export type PromptColumn = keyof typeof PROMPT_COLUMNS;

type Spec<K extends PromptColumn> = (typeof PROMPT_COLUMNS)[K];

type SqlTs<S extends PromptSqlKind> = S extends 'text'
  ? string
  : S extends 'integer'
    ? number
    : S extends 'boolean-int'
      ? number
      : number | null;

/** 列的 **DB 侧** TS 类型（不含 kysely 的 `Generated<>` 包装）。 */
export type PromptColumnTsType<K extends PromptColumn> = SqlTs<Spec<K>['sql']>;

/** 有 `DEFAULT`、插入可省略的列（`id` / `sort_order`）。 */
export type PromptGeneratedColumn = {
  [K in PromptColumn]: Spec<K> extends { generated: true } ? K : never;
}[PromptColumn];

type ApiTs<A extends PromptApiKind> = A extends 'string'
  ? string
  : A extends 'number'
    ? number
    : A extends 'boolean'
      ? boolean
      : A extends 'number-null'
        ? number | null
        : never;

/** 列在**契约**里的类型（`api: 'none'` 的列退回它的 DB 侧类型，供导出文件使用）。 */
export type PromptContractType<K extends PromptColumn> = Spec<K>['api'] extends 'none'
  ? PromptColumnTsType<K>
  : ApiTs<Spec<K>['api']>;

/** 出现在 Prompt 实体里的列（`sort_order` 不在其中）。 */
export type PromptEntityColumn = {
  [K in PromptColumn]: Spec<K>['api'] extends 'none' ? never : K;
}[PromptColumn];

export type PromptEntityColumns = { [K in PromptEntityColumn]: PromptContractType<K> };

/**
 * **不是列**的实体字段：`tags` 来自 `prompt_tags` 关联，`use_count` / `last_used_at` 由取用统计聚合。
 * 它们没有"列"可派生，故单独声明（D-64 ② 的例外之一）。
 */
export interface PromptDerivedFields {
  /** 按名称升序的标签名（FR-2） */
  tags: string[];
  /** 只读：被"取用"（详情 / 渲染 / MCP）的次数（FR-19） */
  use_count: number;
  /** 只读：最后一次取用时间（ISO 8601），从未取用为 null（FR-19） */
  last_used_at: string | null;
}

/** 契约里的 Prompt 对象（BRIEF §6.1；字段名固定）。 */
export type PromptEntity = PromptEntityColumns & PromptDerivedFields;

/** 可写列（`POST` / `PUT` 能改的列）。 */
export type PromptWritableColumn = {
  [K in PromptColumn]: Spec<K>['writable'] extends true ? K : never;
}[PromptColumn];

export type PromptWritableColumns = { [K in PromptWritableColumn]?: PromptContractType<K> };

/** **不是列**的可写字段：`tags`（多对多关联，见 `PromptDerivedFields`）。 */
export interface PromptWritableExtraFields {
  tags?: string[];
}

/** POST / PUT 的可写字段（BRIEF §6.1）。 */
export type PromptWritable = PromptWritableColumns & PromptWritableExtraFields;

/** 写进导出文件的列。 */
export type PromptExportedColumn = {
  [K in PromptColumn]: Spec<K>['exported'] extends true ? K : never;
}[PromptColumn];

export type PromptExportedColumns = { [K in PromptExportedColumn]: PromptContractType<K> };

/** 运行时的列清单（`Object.keys` 保持声明顺序）。 */
export const PROMPT_COLUMN_NAMES = Object.keys(PROMPT_COLUMNS) as PromptColumn[];

/** 实体里的列（`sort_order` 不在其中）。 */
export const PROMPT_ENTITY_COLUMN_NAMES = PROMPT_COLUMN_NAMES.filter(
  (name): name is PromptEntityColumn => PROMPT_COLUMNS[name].api !== 'none',
);

/** 可写列。 */
export const PROMPT_WRITABLE_COLUMN_NAMES = PROMPT_COLUMN_NAMES.filter(
  (name): name is PromptWritableColumn => PROMPT_COLUMNS[name].writable,
);

/** 导出文件里的列。 */
export const PROMPT_EXPORTED_COLUMN_NAMES = PROMPT_COLUMN_NAMES.filter(
  (name): name is PromptExportedColumn => PROMPT_COLUMNS[name].exported,
);

/**
 * **内容字段**的列（FR-129 / D-60 ③）：改了它才产生新版本、才更新 `updated_at`。
 *
 * 这条分类原先手写在 `src/services/prompts.ts` 里（`CONTENT_FIELDS`）—— 是第二份字段表：
 * 往列清单加一个"内容字段"时，那份手写清单不会跟着长，字段会落库但**不触发版本留档**。
 * 现在它由列清单的 `content` 标记派生（唯一来源原则，FR-138）。
 */
export type PromptContentColumn = {
  [K in PromptColumn]: Spec<K> extends { content: true } ? K : never;
}[PromptColumn];

/** 内容字段清单（由列清单派生；顺序 = 声明顺序）。 */
export const PROMPT_CONTENT_FIELDS = PROMPT_COLUMN_NAMES.filter(
  (name): name is PromptContentColumn => {
    // 列清单是 `as const` 的字面量联合：没标 `content` 的成员上取不到这个键，
    // 因此先收宽到 `PromptColumnSpec`（`content` 是可选键）再读。
    const spec: PromptColumnSpec = PROMPT_COLUMNS[name];
    return spec.content === true;
  },
);

/**
 * 数据库一行（`prompts` 表）的值：`Selectable<PromptsTable>` 与它结构相同。
 * 刻意不 import `PromptsTable`（那会绕回 `src/db/schema.ts`，形成循环）。
 */
export type PromptColumnValues = { [K in PromptColumn]: PromptColumnTsType<K> };

/** DB 列值 → 契约值：`favorite` / `remember_variables` 的 0/1 → true/false，其余原样。 */
function contractValue(name: PromptColumn, value: unknown): unknown {
  return PROMPT_COLUMNS[name].api === 'boolean' ? value === 1 : value;
}

/** 契约值 → DB 列值：true/false → 1/0，其余原样。 */
function columnValue(name: PromptColumn, value: unknown): unknown {
  return PROMPT_COLUMNS[name].api === 'boolean' ? (value === true ? 1 : 0) : value;
}

/** 数据库一行 → 契约对象里"逐字段来自列"的那部分（`toPromptObject` 用它）。 */
export function promptEntityColumnsFrom(row: PromptColumnValues): PromptEntityColumns {
  const columns: Record<string, unknown> = {};
  for (const name of PROMPT_ENTITY_COLUMN_NAMES) columns[name] = contractValue(name, row[name]);
  return columns as PromptEntityColumns;
}

/** 数据库一行 → 导出条目里"逐字段来自列"的那部分（`buildExport` 用它）。 */
export function promptExportedColumnsFrom(row: PromptColumnValues): PromptExportedColumns {
  const columns: Record<string, unknown> = {};
  for (const name of PROMPT_EXPORTED_COLUMN_NAMES) columns[name] = contractValue(name, row[name]);
  return columns as PromptExportedColumns;
}

/** 新建时的列值：请求里没给的用清单上的 `default`（不含 `version_no` / `created_at` / `updated_at`）。 */
export function promptCreateColumns(input: PromptWritable): { [K in PromptWritableColumn]: PromptColumnTsType<K> } {
  const columns: Record<string, unknown> = {};
  for (const name of PROMPT_WRITABLE_COLUMN_NAMES) {
    const given = (input as Record<string, unknown>)[name];
    columns[name] = columnValue(name, given === undefined ? PROMPT_COLUMNS[name].default : given);
  }
  return columns as { [K in PromptWritableColumn]: PromptColumnTsType<K> };
}

/**
 * 更新时的列值：请求里给了的覆盖 `existing`，没给的**保持原值**（`PUT` 是子集更新）。
 * 返回的键集合 = 全部可写列（含 4 个内容字段），与 `PUT` 之前的写法逐字段一致。
 */
export function promptPatchColumns(
  existing: PromptColumnValues,
  patch: PromptWritable,
): { [K in PromptWritableColumn]: PromptColumnTsType<K> } {
  const columns: Record<string, unknown> = {};
  for (const name of PROMPT_WRITABLE_COLUMN_NAMES) {
    const given = (patch as Record<string, unknown>)[name];
    columns[name] = given === undefined ? existing[name] : columnValue(name, given);
  }
  return columns as { [K in PromptWritableColumn]: PromptColumnTsType<K> };
}

/** 导出文件里 `exported: true` 的列，落到 DB 时的值类型（`favorite` 等已是 0/1）。 */
export type PromptExportedColumnValues = { [K in PromptExportedColumn]: PromptColumnTsType<K> };

/** 导入文件的 prompt 条目（归一化后）→ DB 列值；`replace` 保留文件里的 `id`（AC-10 往返依赖它）。 */
export function promptImportedColumns(source: PromptExportedColumns): PromptExportedColumnValues {
  const columns: Record<string, unknown> = {};
  for (const name of PROMPT_EXPORTED_COLUMN_NAMES) columns[name] = columnValue(name, source[name]);
  return columns as PromptExportedColumnValues;
}

/** 同上，但不带 `id`：`merge` 模式由数据库分配新 id（`merge` 的语义，不是字段集的一部分）。 */
export function promptImportedColumnsWithoutId(source: PromptExportedColumns): Omit<
  PromptExportedColumnValues,
  'id'
> {
  const columns: Record<string, unknown> = {};
  for (const name of PROMPT_EXPORTED_COLUMN_NAMES) {
    if (name === 'id') continue;
    columns[name] = columnValue(name, source[name]);
  }
  return columns as Omit<PromptExportedColumnValues, 'id'>;
}

/** **不是列**的可写字段的 JSON Schema（`tags`）。 */
export const PROMPT_WRITABLE_EXTRA_FIELDS = {
  tags: {
    type: 'array',
    maxItems: 50,
    items: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

/**
 * HTTP 校验 schema 的 `properties`：可写列（含各自的 `schema` 片段）+ `tags`。
 * `POST /api/prompts` 与 `PUT /api/prompts/:id` **共用这一份**（FR-138 ①）。
 */
export const PROMPT_WRITABLE_FIELDS = {
  ...Object.fromEntries(PROMPT_WRITABLE_COLUMN_NAMES.map((name) => [name, PROMPT_COLUMNS[name].schema])),
  ...PROMPT_WRITABLE_EXTRA_FIELDS,
};
