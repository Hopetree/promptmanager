import { createTwoFilesPatch } from 'diff';
import type { QueryEngine } from '../db/index.js';
import { pruneVersions, selectVersion, selectVersions, type PromptVersionRow } from '../db/prompt-versions.js';
import { InvalidBodyError, NotFoundError } from '../errors.js';
import { nowIso } from './auth.js';
import { getPrompt, type PromptObject } from './prompts.js';

/** 契约里的版本摘要（BRIEF §6.1：version_no / created_at / title）。 */
export interface VersionSummary {
  version_no: number;
  created_at: string;
  title: string;
}

/**
 * 版本快照 → diff 用的规范文本。
 * BRIEF 只规定"两版本 unified diff"，没有规定文本形态；这里用四段带标记的文本，
 * 多行值安全、能看出是哪个字段变了，且必然产生 `-`/`+` 行（AC-9 的可执行判据）。
 *
 * **归一化（FR-64，修："备注没改也显示成变更"）**：
 * ① 每个字段值**裁掉尾部空白**（`\s+$`：尾部换行/空格/制表符都算）；
 * ② 整段文本**以 `\n` 结尾**。
 * 否则 jsdiff（`createTwoFilesPatch`）的 "No newline at end of file" 语义会把**文件尾部的换行差异**
 * 当成内容变更 —— 而 `[notes]` 恰好是最后一段，于是每个有版本历史的条目都会多出一条假的备注变更。
 */
export function snapshotText(snapshot: Pick<PromptVersionRow, 'title' | 'user_prompt' | 'system_prompt' | 'notes'>): string {
  const section = (label: string, value: string): string => `[${label}]\n${value.replace(/\s+$/, '')}`;
  return `${[
    section('title', snapshot.title),
    section('user_prompt', snapshot.user_prompt),
    section('system_prompt', snapshot.system_prompt),
    section('notes', snapshot.notes),
  ].join('\n')}\n`;
}

async function assertPromptExists(qe: QueryEngine, promptId: number): Promise<void> {
  const row = await qe.selectFrom('prompts').select('id').where('id', '=', promptId).executeTakeFirst();
  if (row === undefined) throw new NotFoundError();
}

/** 版本列表：升序、含首版（FR-7）。 */
export async function listVersions(qe: QueryEngine, promptId: number): Promise<VersionSummary[]> {
  await assertPromptExists(qe, promptId);
  const rows = await selectVersions(qe, promptId);
  return rows.map((row) => ({
    version_no: row.version_no,
    created_at: row.created_at,
    title: row.title,
  }));
}

/** 两个版本的 unified diff（FR-7）；版本不存在按 BRIEF §6.1 的"越界"处理 → 400。 */
export async function diffVersions(
  qe: QueryEngine,
  promptId: number,
  from: number,
  to: number,
): Promise<string> {
  await assertPromptExists(qe, promptId);

  const before = await selectVersion(qe, promptId, from);
  const after = await selectVersion(qe, promptId, to);
  if (before === undefined || after === undefined) {
    throw new InvalidBodyError([
      { path: 'from/to', message: `版本越界：from=${from} to=${to}（该 prompt 只有 ${String((await selectVersions(qe, promptId)).length)} 个版本）` },
    ]);
  }

  return createTwoFilesPatch(`v${from}`, `v${to}`, snapshotText(before), snapshotText(after), '', '', {
    context: 3,
  });
}

/**
 * 回滚到第 n 版（FR-7）：**恢复内容并生成新版本**。
 * FR-86 起每次产生新版本后统一裁剪到最近 10 个（见 `pruneVersions`），所以"历史"是**有上限**的：
 * 回滚到一个已被裁剪掉的版本 → `selectVersion` 拿不到 → **404**（既有语义不变）。
 * 只回滚内容四字段（title/user_prompt/system_prompt/notes）——版本快照里没有标签/文件夹/收藏。
 */
export async function rollbackToVersion(
  qe: QueryEngine,
  promptId: number,
  versionNo: number,
): Promise<PromptObject> {
  await assertPromptExists(qe, promptId);

  const snapshot = await selectVersion(qe, promptId, versionNo);
  if (snapshot === undefined) throw new NotFoundError();

  const current = await qe
    .selectFrom('prompts')
    .select('version_no')
    .where('id', '=', promptId)
    .executeTakeFirstOrThrow();
  const nextVersionNo = current.version_no + 1;
  const now = nowIso();

  await qe.transaction().execute(async (trx) => {
    await trx
      .updateTable('prompts')
      .set({
        title: snapshot.title,
        user_prompt: snapshot.user_prompt,
        system_prompt: snapshot.system_prompt,
        notes: snapshot.notes,
        version_no: nextVersionNo,
        updated_at: now,
      })
      .where('id', '=', promptId)
      .execute();

    await trx
      .insertInto('prompt_versions')
      .values({
        prompt_id: promptId,
        version_no: nextVersionNo,
        title: snapshot.title,
        user_prompt: snapshot.user_prompt,
        system_prompt: snapshot.system_prompt,
        notes: snapshot.notes,
        created_at: now,
      })
      .execute();

    // FR-86：回滚 = 恢复内容 + **生成新版本**，所以也是"产生新版本之后"的写入点 ⇒ 同样裁剪（仍 ≤10）。
    // 注意语义边界：回滚到**已被裁剪掉**的版本会先在 `selectVersion` 处 404，走不到这里（既有语义不变）。
    await pruneVersions(trx as QueryEngine, promptId);
  });

  const prompt = await getPrompt(qe, promptId);
  if (prompt === null) throw new NotFoundError();
  return prompt;
}
