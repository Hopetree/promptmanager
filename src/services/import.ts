import type { QueryEngine } from '../db/index.js';
import { InvalidImportError, isConstraintError } from '../errors.js';
import { nowIso } from './auth.js';
import { EXPORT_APP, SUPPORTED_SCHEMA_VERSION, type ExportFile } from './export.js';

export type ImportMode = 'replace' | 'merge';

export interface ImportCounts {
  folders: number;
  tags: number;
  prompts: number;
}

export interface ImportResult {
  mode: ImportMode;
  imported: ImportCounts;
}

interface NormalizedPrompt {
  id: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  folder_id: number | null;
  tags: string[];
  favorite: boolean;
  created_at: string;
  updated_at: string;
  versions: Array<{
    version_no: number;
    title: string;
    user_prompt: string;
    system_prompt: string;
    notes: string;
    created_at: string;
  }>;
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

function asString(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') fail([{ path, message: '必须是字符串' }]);
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
    const name = asString(folder.name, 'data.folders[].name');
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
    const name = asString(tag.name, 'data.tags[].name');
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
    const promptTags = [...new Set(rawTags.map((tag) => asString(tag, 'data.prompts[].tags[]')))].sort((a, b) =>
      a.localeCompare(b),
    );

    const favorite = prompt.favorite === undefined ? false : prompt.favorite;
    if (typeof favorite !== 'boolean') fail([{ path: 'data.prompts[].favorite', message: '必须是布尔值' }]);

    const now = nowIso();
    const versions = asArray(prompt.versions, 'data.prompts[].versions').map((entry) => {
      const version = asObject(entry, 'data.prompts[].versions[]');
      return {
        version_no: asId(version.version_no, 'data.prompts[].versions[].version_no'),
        title: asString(version.title, 'data.prompts[].versions[].title', ''),
        user_prompt: asString(version.user_prompt, 'data.prompts[].versions[].user_prompt', ''),
        system_prompt: asString(version.system_prompt, 'data.prompts[].versions[].system_prompt', ''),
        notes: asString(version.notes, 'data.prompts[].versions[].notes', ''),
        created_at: asString(version.created_at, 'data.prompts[].versions[].created_at', now),
      };
    });
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
      title: asString(prompt.title, 'data.prompts[].title'),
      user_prompt: asString(prompt.user_prompt, 'data.prompts[].user_prompt'),
      system_prompt: asString(prompt.system_prompt, 'data.prompts[].system_prompt', ''),
      notes: asString(prompt.notes, 'data.prompts[].notes', ''),
      folder_id: folderId,
      tags: promptTags,
      favorite,
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
async function replaceImport(qe: QueryEngine, file: NormalizedFile): Promise<ImportResult> {
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
          id: prompt.id,
          title: prompt.title,
          user_prompt: prompt.user_prompt,
          system_prompt: prompt.system_prompt,
          notes: prompt.notes,
          folder_id: prompt.folder_id,
          favorite: prompt.favorite ? 1 : 0,
          version_no: maxVersionNo(prompt),
          created_at: prompt.created_at,
          updated_at: prompt.updated_at,
        })
        .execute();

      for (const version of prompt.versions) {
        await trx
          .insertInto('prompt_versions')
          .values({ prompt_id: prompt.id, ...version })
          .execute();
      }

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
async function mergeImport(qe: QueryEngine, file: NormalizedFile): Promise<ImportResult> {
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
          title: prompt.title,
          user_prompt: prompt.user_prompt,
          system_prompt: prompt.system_prompt,
          notes: prompt.notes,
          folder_id: prompt.folder_id === null ? null : folderIdMap.get(prompt.folder_id) ?? null,
          favorite: prompt.favorite ? 1 : 0,
          version_no: maxVersionNo(prompt),
          created_at: prompt.created_at,
          updated_at: prompt.updated_at,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const version of prompt.versions) {
        await trx
          .insertInto('prompt_versions')
          .values({ prompt_id: inserted.id, ...version })
          .execute();
      }

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
export async function importData(qe: QueryEngine, mode: unknown, raw: unknown): Promise<ImportResult> {
  if (mode !== 'replace' && mode !== 'merge') {
    fail([{ path: 'mode', message: `mode 必须是 "replace" 或 "merge"，实际 ${JSON.stringify(mode)}` }]);
  }
  const file = parseExportFile(raw);

  try {
    return mode === 'replace' ? await replaceImport(qe, file) : await mergeImport(qe, file);
  } catch (error) {
    if (error instanceof InvalidImportError) throw error;
    if (isConstraintError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      fail([{ path: 'data', message: `数据约束冲突：${message}` }]);
    }
    throw error;
  }
}
