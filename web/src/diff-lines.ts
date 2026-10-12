/** 版本 diff 的行分类（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

export type DiffLineType = 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** unified diff 文本 → 逐行分类（界面按类型着色显示）。 */
export function classifyDiffLines(diff: string): DiffLine[] {
  return diff.split('\n').map((text) => {
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@') || text.startsWith('Index:') || text.startsWith('===') || text.startsWith('\\')) {
      return { type: 'meta', text };
    }
    if (text.startsWith('+')) return { type: 'add', text };
    if (text.startsWith('-')) return { type: 'del', text };
    return { type: 'ctx', text };
  });
}
