import type { QueryEngine } from '../db/index.js';
import { pruneVersions } from '../db/prompt-versions.js';
import { InvalidImportError, constraintKind, isConstraintError } from '../errors.js';
import { FOLDER_NAME_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from '../field-limits.js';
import {
  maxLengthOf,
  promptImportedColumns,
  promptImportedColumnsWithoutId,
  type PromptExportedColumns,
} from '../prompt-columns.js';
import { nowIso } from './auth.js';
import { EXPORT_APP, SUPPORTED_SCHEMA_VERSION } from './export.js';
import { countUsageEvents, pruneUsageBackups, readUsageEvents, removeUsageBackup, writeUsageBackup } from './usage-backup.js';

export type ImportMode = 'replace' | 'merge';

export interface ImportCounts {
  folders: number;
  tags: number;
  prompts: number;
}

/**
 * FR-134：replace 导入对**取用历史**做了什么 —— 必须如实回报，不许静默。
 *
 * `action`：
 * - `'cleared'`：replace 会 `DELETE FROM prompts` ⇒ `usage_events` 被 `ON DELETE CASCADE` 连带清空
 *   （`count` = 被清掉的条数）；
 * - `'kept'`：merge 不清库 ⇒ 取用历史原样保留（`count` = 现有条数）。
 *
 * `backup`：清空前留下的备份文件**绝对路径**；没有东西可留（本来就没有事件）时为 `null`。
 * 备份只落本地 `DATA_DIR`，**不进导出文件、不上传云端**。
 */
export interface UsageHistoryReport {
  action: 'cleared' | 'kept';
  count: number;
  backup: string | null;
}

export interface ImportResult {
  mode: ImportMode;
  imported: ImportCounts;
  /** FR-134：取用历史的去向（见 {@link UsageHistoryReport}）。 */
  usage_history: UsageHistoryReport;
}

/**
 * `importData` 的选项。
 *
 * `usageBackupDir` **必填**：replace 清空前要在这里留一份取用历史（FR-134）。
 * 故意不给默认值 —— 漏传就等于静默丢历史，那正是本阶段要消灭的行为（D-62 ③）。
 */
export interface ImportOptions {
  usageBackupDir: string;
}

/** 两个内部导入函数的产物：`importData` 在外面补上 `usage_history`（FR-134）。 */
interface ImportOutcome {
  mode: ImportMode;
  imported: ImportCounts;
}

/** 导出文件里的版本快照（导入侧自己声明，便于逐字段校验）。 */
interface NormalizedVersion {
  version_no: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  created_at: string;
}

/**
 * 归一化后的 prompt 条目。
 *
 * FR-138 / D-64：**列字段那一半派生**自 `src/prompt-columns.ts`（`exported: true` 的 11 列）；
 * `tags`（关联表）与 `versions`（版本快照）不是列，单独声明。
 *
 * 派生带来的一处**编译期保障**：列清单里加一个 `exported` 字段，这里就会因缺字段而类型检查失败
 * ⇒ 归一化必须跟着补，堵住"导入静默丢字段"的口子。
 */
interface NormalizedPrompt extends PromptExportedColumns {
  tags: string[];
  versions: NormalizedVersion[];
}

interface NormalizedFile {
  folders: Array<{ id: number; name: string; parent_id: number | null; sort_order: number }>;
  tags: Array<{ id: number; name: string }>;
  prompts: NormalizedPrompt[];
}

function fail(details: unknown[]): never {
  throw new InvalidImportError(details);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail([{ path, message: '必须是对象' }]);
  }
  return value as Record<string, unknown>;
}

/**
 * 字符串字段的解析。
 *
 * FR-157 / AC-134 C10（N3）：`maxLength` 来自字段清单（`maxLengthOf()`）或
 * `src/field-limits.ts`，**不再只由路由的 ajv schema 把关** —— 否则同一份超长数据
 * 「HTTP 写 400、导入照收」。超长**不静默截断**：逐字段 400。
 */
function asString(value: unknown, path: string, fallback?: string, maxLength?: number): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') fail([{ path, message: '必须是字符串' }]);
  if (maxLength !== undefined && value.length > maxLength) {
    fail([{ path, message: `长度不能超过 ${String(maxLength)} 个字符（实际 ${String(value.length)}）` }]);
  }
  return value;
}

function asId(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail([{ path, message: '必须是 >= 1 的整数 id' }]);
  }
  return value;
}

function asIdOrNull(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return asId(value, path);
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail([{ path, message: '必须是数组' }]);
  return value;
}

/**
 * 校验并归一化导入文件（BRIEF §6.4）：`app` 必须是 promptmanager、`schema_version` 必须 ≤ 当前支持版本，
 * 否则 400 invalid_import 且**不得改动任何数据**（校验全部发生在事务之前）。
 * 额外的形状校验是为了让"手写坏文件"得到 400 而不是 500。
 */
function parseExportFile(raw: unknown): NormalizedFile {
  const file = asObject(raw, 'data');

  if (file.app !== EXPORT_APP) {
    fail([{ path: 'data.app', message: `必须是 "${EXPORT_APP}"，实际 ${JSON.stringify(file.app)}` }]);
  }
  const schemaVersion = file.schema_version;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    fail([{ path: 'data.schema_version', message: '必须是 >= 1 的整数' }]);
  }
  if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    fail([
      {
        path: 'data.schema_version',
        message: `文件版本 ${String(schemaVersion)} 高于当前支持版本 ${String(SUPPORTED_SCHEMA_VERSION)}`,
      },
    ]);
  }

  const folderIds = new Set<number>();
  const folders = asArray(file.folders, 'data.folders').map((item) => {
    const folder = asObject(item, 'data.folders[]');
    const id = asId(folder.id, 'data.folders[].id');
    if (folderIds.has(id)) fail([{ path: 'data.folders[].id', message: `文件夹 id 重复：${String(id)}` }]);
    folderIds.add(id);
    const name = asString(folder.name, 'data.folders[].name', undefined, FOLDER_NAME_MAX_LENGTH);
    if (name.trim() === '') fail([{ path: 'data.folders[].name', message: '文件夹名不能为空' }]);
    const sortOrder = folder.sort_order === undefined ? 0 : folder.sort_order;
    if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)) {
      fail([{ path: 'data.folders[].sort_order', message: '必须是整数' }]);
    }
    return { id, name, parent_id: asIdOrNull(folder.parent_id, 'data.folders[].parent_id'), sort_order: sortOrder };
  });
  // 父必须存在（成环/悬空引用在排序时一并暴露）
  for (const folder of folders) {
    if (folder.parent_id !== null && !folderIds.has(folder.parent_id)) {
      fail([{ path: 'data.folders[].parent_id', message: `父文件夹 ${String(folder.parent_id)} 不在文件里` }]);
    }
  }

  const tagIds = new Set<number>();
  const tagNames = new Set<string>();
  const tags = asArray(file.tags, 'data.tags').map((item) => {
    const tag = asObject(item, 'data.tags[]');
    const id = asId(tag.id, 'data.tags[].id');
    if (tagIds.has(id)) fail([{ path: 'data.tags[].id', message: `标签 id 重复：${String(id)}` }]);
    tagIds.add(id);
    const name = asString(tag.name, 'data.tags[].name', undefined, TAG_NAME_MAX_LENGTH);
    if (name.trim() === '') fail([{ path: 'data.tags[].name', message: '标签名不能为空' }]);
    if (tagNames.has(name)) fail([{ path: 'data.tags[].name', message: `标签名重复：${name}` }]);
    tagNames.add(name);
    return { id, name };
  });

  const promptIds = new Set<number>();
  const prompts = asArray(file.prompts, 'data.prompts').map((item) => {
    const prompt = asObject(item, 'data.prompts[]');
    const id = asId(prompt.id, 'data.prompts[].id');
    if (promptIds.has(id)) fail([{ path: 'data.prompts[].id', message: `prompt id 重复：${String(id)}` }]);
    promptIds.add(id);

    const folderId = asIdOrNull(prompt.folder_id, 'data.prompts[].folder_id');
    if (folderId !== null && !folderIds.has(folderId)) {
      fail([{ path: 'data.prompts[].folder_id', message: `folder_id ${String(folderId)} 不在文件的 folders 里` }]);
    }

    const rawTags = prompt.tags === undefined ? [] : asArray(prompt.tags, 'data.prompts[].tags');
    const promptTags = [
      ...new Set(rawTags.map((tag) => asString(tag, 'data.prompts[].tags[]', undefined, TAG_NAME_MAX_LENGTH))),
    ].sort((a, b) =>
      a.localeCompare(b),
    );

    // FR-132：老导出文件（阶段 64 之前）没有这一项 ⇒ 缺省 0，与 folders 的 sort_order 同一口径。
    // 「缺字段 ⇒ 缺省 0」而不是报错，是为了让既有备份文件继续可导入（D-62 ⑥）。
    const sortOrder = prompt.sort_order === undefined ? 0 : prompt.sort_order;
    if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)) {
      fail([{ path: 'data.prompts[].sort_order', message: '必须是整数' }]);
    }

    const favorite = prompt.favorite === undefined ? false : prompt.favorite;
    if (typeof favorite !== 'boolean') fail([{ path: 'data.prompts[].favorite', message: '必须是布尔值' }]);

    // FR-127 / D-59 ②：**缺省 = 记住**（与 favorite 的缺省 false 相反）——
    // 老导出文件（阶段 61 之前）没有这一项，导入后必须与"既有行为一字不变"一致。
    const rememberVariables = prompt.remember_variables === undefined ? true : prompt.remember_variables;
    if (typeof rememberVariables !== 'boolean') {
      fail([{ path: 'data.prompts[].remember_variables', message: '必须是布尔值' }]);
    }

    const now = nowIso();
    const versions = asArray(prompt.versions, 'data.prompts[].versions').map((entry) => {
      const version = asObject(entry, 'data.prompts[].versions[]');
      return {
        version_no: asId(version.version_no, 'data.prompts[].versions[].version_no'),
        title: asString(version.title, 'data.prompts[].versions[].title', '', maxLengthOf('title')),
        user_prompt: asString(version.user_prompt, 'data.prompts[].versions[].user_prompt', '', maxLengthOf('user_prompt')),
        system_prompt: asString(
          version.system_prompt,
          'data.prompts[].versions[].system_prompt',
          '',
          maxLengthOf('system_prompt'),
        ),
        notes: asString(version.notes, 'data.prompts[].versions[].notes', '', maxLengthOf('notes')),
        created_at: asString(version.created_at, 'data.prompts[].versions[].created_at', now),
      };
    });
    // FR-157 / AC-134 C13（N10）：重复的 version_no 必须在**解析期**就拒绝 ——
    // 否则会一路走到 INSERT 才撞 `UNIQUE constraint failed: prompt_versions...`，
    // 用户看到的是裸 SQLite 文本（解析期拒绝 ⇒ 一个字节都不落库）。
    const seenVersionNos = new Set<number>();
    for (const version of versions) {
      if (seenVersionNos.has(version.version_no)) {
        fail([
          {
            path: 'data.prompts[].versions[].version_no',
            message: `版本号重复：${String(version.version_no)}（同一个 prompt 的版本号必须唯一）`,
          },
        ]);
      }
      seenVersionNos.add(version.version_no);
    }
    versions.sort((a, b) => a.version_no - b.version_no);
    if (versions.length === 0) fail([{ path: 'data.prompts[].versions', message: '至少要有一个版本' }]);

    // FR-10b（BRIEF v9）：prompt 条目的 title / user_prompt **必须显式给出**，不允许静默补成空串 ——
    // 否则缺字段的文件会导入出"无名条目"。只判"缺键/非字符串"：显式 `""` 仍是合法值
    // （库里允许空标题，导出必然写出 "title": ""，若一并拒绝会打破 AC-10 的导出→导入→再导出 EQUAL）。
    if (prompt.title === undefined) {
      fail([{ path: 'data.prompts[].title', message: '缺少 title：导入不允许静默补成空串（FR-10b）' }]);
    }
    if (prompt.user_prompt === undefined) {
      fail([{ path: 'data.prompts[].user_prompt', message: '缺少 user_prompt：导入不允许静默补成空串（FR-10b）' }]);
    }

    return {
      id,
      title: asString(prompt.title, 'data.prompts[].title', undefined, maxLengthOf('title')),
      user_prompt: asString(prompt.user_prompt, 'data.prompts[].user_prompt', undefined, maxLengthOf('user_prompt')),
      system_prompt: asString(prompt.system_prompt, 'data.prompts[].system_prompt', '', maxLengthOf('system_prompt')),
      notes: asString(prompt.notes, 'data.prompts[].notes', '', maxLengthOf('notes')),
      folder_id: folderId,
      sort_order: sortOrder,
      tags: promptTags,
      favorite,
      remember_variables: rememberVariables,
      created_at: asString(prompt.created_at, 'data.prompts[].created_at', now),
      updated_at: asString(prompt.updated_at, 'data.prompts[].updated_at', now),
      versions,
    };
  });

  return { folders, tags, prompts };
}

/** 父先子后；有环或悬空父 → invalid_import。 */
function foldersParentsFirst(folders: NormalizedFile['folders']): NormalizedFile['folders'] {
  const placed = new Set<number>();
  const sorted: NormalizedFile['folders'] = [];
  let remaining = [...folders].sort((a, b) => a.id - b.id);

  while (remaining.length > 0) {
    const next: NormalizedFile['folders'] = [];
    let progressed = false;
    for (const folder of remaining) {
      if (folder.parent_id === null || placed.has(folder.parent_id)) {
        sorted.push(folder);
        placed.add(folder.id);
        progressed = true;
      } else {
        next.push(folder);
      }
    }
    if (!progressed) {
      fail([{ path: 'data.folders', message: 'parent_id 存在环或引用了不存在的父（无法确定插入顺序）' }]);
    }
    remaining = next;
  }
  return sorted;
}

function maxVersionNo(prompt: NormalizedPrompt): number {
  return prompt.versions.reduce((max, version) => Math.max(max, version.version_no), 1);
}

/** replace：清空内容表后按文件重建，保留文件里的 id（AC-10 的往返一致性依赖这一点）。 */
async function replaceImport(qe: QueryEngine, file: NormalizedFile): Promise<ImportOutcome> {
  const now = nowIso();
  let autoCreatedTags = 0;

  await qe.transaction().execute(async (trx) => {
    // 清空顺序：关联 → 版本 → prompt → 标签 → 文件夹
    // ⚠️ folders 是**自引用外键**（parent_id → folders.id，ON DELETE RESTRICT）：
    //    不能一条 `DELETE FROM folders` 了事——SQLite 按 rowid 顺序删，会先删父再删子而触发
    //    `FOREIGN KEY constraint failed`（实测 code=SQLITE_CONSTRAINT_TRIGGER，AC-10 脚本上暴露）。
    //    因此反复删除"当前没有子节点"的文件夹（叶子优先），直到删空。
    await trx.deleteFrom('prompt_tags').execute();
    await trx.deleteFrom('prompt_versions').execute();
    await trx.deleteFrom('prompts').execute();
    await trx.deleteFrom('tags').execute();
    for (;;) {
      const deleted = await trx
        .deleteFrom('folders')
        .where('id', 'not in', (eb) =>
          eb
            .selectFrom('folders as child')
            .select('child.parent_id')
            .where('child.parent_id', 'is not', null),
        )
        .executeTakeFirst();
      if (Number(deleted.numDeletedRows ?? 0) === 0) break;
    }

    for (const folder of foldersParentsFirst(file.folders)) {
      await trx
        .insertInto('folders')
        .values({
          id: folder.id,
          name: folder.name,
          parent_id: folder.parent_id,
          sort_order: folder.sort_order,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    for (const tag of [...file.tags].sort((a, b) => a.id - b.id)) {
      await trx.insertInto('tags').values({ id: tag.id, name: tag.name, created_at: now, updated_at: now }).execute();
    }

    const tagIdByName = new Map(file.tags.map((tag) => [tag.name, tag.id] as const));
    let nextTagId = file.tags.reduce((max, tag) => Math.max(max, tag.id), 0) + 1;

    for (const prompt of [...file.prompts].sort((a, b) => a.id - b.id)) {
      await trx
        .insertInto('prompts')
        .values({
          // FR-138：列的值由列清单派生（含 favorite / remember_variables 的 true/false → 1/0）。
          ...promptImportedColumns(prompt),
          version_no: maxVersionNo(prompt),
        })
        .execute();

      for (const version of prompt.versions) {
        await trx
          .insertInto('prompt_versions')
          .values({ prompt_id: prompt.id, ...version })
          .execute();
      }

      // FR-86：导入的版本若多于 10 个，同样裁到最近 10 个 —— "最多 10 个"是**数据层不变式**，导入后也必须成立。
      // ⚠️ 已知张力（BRIEF v41 §4 FR-86 明确以本 FR 为准）：replace 模式原本保留文件里的 id、并让
      //    "导出 → 导入 → 再导出"逐字一致；当文件里某个 prompt 的版本 >10 时，再导出会少掉最旧的几版。
      //    已写进 README「已知限制」。
      await pruneVersions(trx as QueryEngine, prompt.id);

      for (const name of prompt.tags) {
        let tagId = tagIdByName.get(name);
        if (tagId === undefined) {
          // 文件里没声明这个标签名，但 prompt 引用了它：补建，避免丢关联（id 顺延）
          tagId = nextTagId;
          nextTagId += 1;
          tagIdByName.set(name, tagId);
          await trx.insertInto('tags').values({ id: tagId, name, created_at: now, updated_at: now }).execute();
          autoCreatedTags += 1;
        }
        await trx
          .insertInto('prompt_tags')
          .values({ prompt_id: prompt.id, tag_id: tagId })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
    }
  });

  return {
    mode: 'replace',
    imported: {
      folders: file.folders.length,
      tags: file.tags.length + autoCreatedTags,
      prompts: file.prompts.length,
    },
  };
}

/** merge：不清库；同名（同父）folder / 同名 tag 复用；prompt 一律新建并分配新 id。 */
async function mergeImport(qe: QueryEngine, file: NormalizedFile): Promise<ImportOutcome> {
  const now = nowIso();
  let createdFolders = 0;
  let createdTags = 0;
  const folderIdMap = new Map<number, number>();
  const tagIdByName = new Map<string, number>();

  await qe.transaction().execute(async (trx) => {
    for (const folder of foldersParentsFirst(file.folders)) {
      const localParent = folder.parent_id === null ? null : folderIdMap.get(folder.parent_id) ?? null;
      const lookup = trx.selectFrom('folders').select('id').where('name', '=', folder.name);
      const existing = await (localParent === null
        ? lookup.where('parent_id', 'is', null)
        : lookup.where('parent_id', '=', localParent)
      ).executeTakeFirst();

      if (existing !== undefined) {
        folderIdMap.set(folder.id, existing.id);
        continue;
      }
      const inserted = await trx
        .insertInto('folders')
        .values({
          name: folder.name,
          parent_id: localParent,
          sort_order: folder.sort_order,
          created_at: now,
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      folderIdMap.set(folder.id, inserted.id);
      createdFolders += 1;
    }

    for (const tag of [...file.tags].sort((a, b) => a.id - b.id)) {
      const existing = await trx.selectFrom('tags').select('id').where('name', '=', tag.name).executeTakeFirst();
      if (existing !== undefined) {
        tagIdByName.set(tag.name, existing.id);
        continue;
      }
      const inserted = await trx
        .insertInto('tags')
        .values({ name: tag.name, created_at: now, updated_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      tagIdByName.set(tag.name, inserted.id);
      createdTags += 1;
    }

    for (const prompt of [...file.prompts].sort((a, b) => a.id - b.id)) {
      const inserted = await trx
        .insertInto('prompts')
        .values({
          // FR-138：列的值由列清单派生；merge 模式**不带文件里的 id**（本地重建新行），
          // 且 `folder_id` 要映射到本次新建的文件夹。
          ...promptImportedColumnsWithoutId(prompt),
          folder_id: prompt.folder_id === null ? null : folderIdMap.get(prompt.folder_id) ?? null,
          version_no: maxVersionNo(prompt),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const version of prompt.versions) {
        await trx
          .insertInto('prompt_versions')
          .values({ prompt_id: inserted.id, ...version })
          .execute();
      }

      // FR-86：merge 模式同样裁剪（与 replace 一致，"最多 10 个"是数据层不变式）
      await pruneVersions(trx as QueryEngine, inserted.id);

      for (const name of prompt.tags) {
        let tagId = tagIdByName.get(name);
        if (tagId === undefined) {
          const existing = await trx.selectFrom('tags').select('id').where('name', '=', name).executeTakeFirst();
          if (existing !== undefined) {
            tagId = existing.id;
          } else {
            const row = await trx
              .insertInto('tags')
              .values({ name, created_at: now, updated_at: now })
              .returning('id')
              .executeTakeFirstOrThrow();
            tagId = row.id;
            createdTags += 1;
          }
          tagIdByName.set(name, tagId);
        }
        await trx
          .insertInto('prompt_tags')
          .values({ prompt_id: inserted.id, tag_id: tagId })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
    }
  });

  return {
    mode: 'merge',
    imported: { folders: createdFolders, tags: createdTags, prompts: file.prompts.length },
  };
}

/**
 * 导入（BRIEF §6.4 / AC-10 / AC-11）：校验 → 单事务写入（replace 清空重建 / merge 合并且 prompt 新建）。
 * 校验失败或写入中途失败 → 400 invalid_import，事务回滚，**库保持原样**。
 */
export async function importData(
  qe: QueryEngine,
  mode: unknown,
  raw: unknown,
  options: ImportOptions,
): Promise<ImportResult> {
  if (mode !== 'replace' && mode !== 'merge') {
    fail([{ path: 'mode', message: `mode 必须是 "replace" 或 "merge"，实际 ${JSON.stringify(mode)}` }]);
  }
  const file = parseExportFile(raw);

  /**
   * FR-134：replace 会在事务里 `DELETE FROM prompts` ⇒ `usage_events` 级联清空。
   * 清空**之前**先把取用历史读出来（读在事务外、写备份也在事务外）。
   * merge 不清库 ⇒ 只需要数一下现有条数，如实回报「保留 N 条」。
   *
   * ⚠️ 返工 ①（对抗性复核发现）：写备份与裁剪旧备份必须分开 ——
   * 导入**失败**时事务回滚、本次根本没有清库，那份"清空前留档"就是误导性的，
   * 而且它的轮换会把一份真实历史备份挤出保留窗口。所以失败路径删掉刚写的这份
   * （{@link removeUsageBackup}），只有 replace **成功提交后**才裁剪（{@link pruneUsageBackups}）。
   */
  const usageRows = mode === 'replace' ? await readUsageEvents(qe) : null;

  try {
    if (mode === 'replace') {
      const backup =
        usageRows !== null && usageRows.length > 0 ? await writeUsageBackup(options.usageBackupDir, usageRows) : null;
      let result: ImportOutcome;
      try {
        result = await replaceImport(qe, file);
      } catch (error) {
        // 事务回滚 ⇒ 本次没有清空任何东西 ⇒ 刚写的那份是误导性存档，删掉，
        // 让备份集合与本次导入**前**完全一致（也不让它的轮换挤掉真实历史备份）。
        if (backup !== null) await removeUsageBackup(backup);
        throw error;
      }
      await pruneUsageBackups(options.usageBackupDir);
      return {
        ...result,
        usage_history: { action: 'cleared', count: usageRows?.length ?? 0, backup },
      };
    }

    const kept = await countUsageEvents(qe);
    const result = await mergeImport(qe, file);
    return { ...result, usage_history: { action: 'kept', count: kept, backup: null } };
  } catch (error) {
    if (error instanceof InvalidImportError) throw error;
    if (isConstraintError(error)) {
      // FR-157 / AC-134 C13（N10）：分类后给可读文案，**不许**把裸 SQLite 文本回给用户。
      // 分类设施复用阶段 64 的 `constraintKind()`（与 `src/services/prompts.ts` 同一套）。
      const kind = constraintKind(error);
      if (kind === 'foreign_key') {
        fail([{ path: 'data', message: '导入数据引用了不存在的记录（外键约束），请检查文件夹 / 标签引用后重试' }]);
      }
      if (kind === 'unique') {
        fail([{ path: 'data', message: '导入数据与库里的现有记录冲突（唯一约束），请检查 id / 名称是否重复后重试' }]);
      }
      fail([{ path: 'data', message: '导入数据与库里的现有记录冲突（数据约束），请检查后重试' }]);
    }
    throw error;
  }
}
