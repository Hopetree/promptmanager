import type { QueryEngine } from '../db/index.js';
import { nowIso } from './auth.js';

export const EXPORT_APP = 'promptmanager';
/** 当前支持的 ExportFile schema 版本（BRIEF §6.4）。 */
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface ExportFolder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

export interface ExportTag {
  id: number;
  name: string;
}

export interface ExportVersion {
  version_no: number;
  title: string;
  user_prompt: string;
  system_prompt: string;
  notes: string;
  created_at: string;
}

export interface ExportPrompt {
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
  versions: ExportVersion[];
}

export interface ExportFile {
  app: string;
  schema_version: number;
  exported_at: string;
  folders: ExportFolder[];
  tags: ExportTag[];
  prompts: ExportPrompt[];
}

/**
 * 全量导出（BRIEF §6.4 / AC-10）：folders/tags/prompts 按 id 升序、versions 按 version_no 升序、
 * 每个 prompt 的 tags 数组按名称升序；`exported_at` 是唯一不确定的字段。
 * 不含 users/sessions/login_attempts（导出的是内容，不是账号）。
 */
export async function buildExport(qe: QueryEngine): Promise<ExportFile> {
  const folderRows = await qe.selectFrom('folders').selectAll().orderBy('id', 'asc').execute();
  const tagRows = await qe.selectFrom('tags').selectAll().orderBy('id', 'asc').execute();
  const promptRows = await qe.selectFrom('prompts').selectAll().orderBy('id', 'asc').execute();
  const versionRows = await qe
    .selectFrom('prompt_versions')
    .selectAll()
    .orderBy('prompt_id', 'asc')
    .orderBy('version_no', 'asc')
    .execute();
  const linkRows = await qe
    .selectFrom('prompt_tags')
    .innerJoin('tags', 'tags.id', 'prompt_tags.tag_id')
    .select(['prompt_tags.prompt_id as prompt_id', 'tags.name as name'])
    .orderBy('tags.name', 'asc')
    .execute();

  const versionsByPrompt = new Map<number, ExportVersion[]>();
  for (const row of versionRows) {
    const list = versionsByPrompt.get(row.prompt_id) ?? [];
    list.push({
      version_no: row.version_no,
      title: row.title,
      user_prompt: row.user_prompt,
      system_prompt: row.system_prompt,
      notes: row.notes,
      created_at: row.created_at,
    });
    versionsByPrompt.set(row.prompt_id, list);
  }

  const tagsByPrompt = new Map<number, string[]>();
  for (const row of linkRows) {
    const list = tagsByPrompt.get(row.prompt_id) ?? [];
    list.push(row.name);
    tagsByPrompt.set(row.prompt_id, list);
  }

  return {
    app: EXPORT_APP,
    schema_version: SUPPORTED_SCHEMA_VERSION,
    exported_at: nowIso(),
    folders: folderRows.map((row) => ({
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      sort_order: row.sort_order,
    })),
    tags: tagRows.map((row) => ({ id: row.id, name: row.name })),
    prompts: promptRows.map((row) => ({
      id: row.id,
      title: row.title,
      user_prompt: row.user_prompt,
      system_prompt: row.system_prompt,
      notes: row.notes,
      folder_id: row.folder_id,
      tags: tagsByPrompt.get(row.id) ?? [],
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      versions: versionsByPrompt.get(row.id) ?? [],
    })),
  };
}
