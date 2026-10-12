/** 文件夹树的形状与组装（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

/** 文件夹的最小形状（避免依赖服务端类型文件） */
export interface FolderLike {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

/** antd TreeSelect 需要的节点形状（只取用得到的字段） */
export interface FolderTreeNode {
  value: number;
  title: string;
  key: number;
  children: FolderTreeNode[];
}

/**
 * 扁平文件夹列表 → antd TreeSelect 的树（FR-4 的 `parent_id` 树形）。
 * 排序：`sort_order` 升序，同级按 id 升序；父节点不在集合里的"孤儿"提到根（不会丢条目）。
 */
export function buildFolderTree(folders: FolderLike[]): FolderTreeNode[] {
  const sorted = [...folders].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const nodes = new Map<number, FolderTreeNode>();
  for (const folder of sorted) {
    nodes.set(folder.id, { value: folder.id, title: folder.name, key: folder.id, children: [] });
  }
  const roots: FolderTreeNode[] = [];
  for (const folder of sorted) {
    const node = nodes.get(folder.id);
    if (node === undefined) continue;
    const parent = folder.parent_id === null ? undefined : nodes.get(folder.parent_id);
    if (parent === undefined || folder.parent_id === folder.id) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}

/** FR-116 ③：无目录时的兜底文案（不得空白、不得出现 `null` / `undefined`）。 */
export const CARD_FOLDER_FALLBACK = '未分组';

/**
 * FR-116 ②：目录项**只显示目录名**（不带父级路径、不出现 `folder_id` 数字）。
 *
 * `Prompt` 里只有 `folder_id`（数字），那是 BRIEF §6.1 的契约字段、本阶段不得改其语义（FR-116 ⑨），
 * 所以**不给列表接口加字段**：目录名由前端用 `Workspace` → `UseView` 本来就持有的 `folders`
 * （`GET /api/folders`）映射得到。目录名本来就在库里 ⇒ **无需为此新增迁移**。
 */
export function folderNameOf(folders: FolderLike[], folderId: number | null | undefined): string {
  if (folderId === null || folderId === undefined) return CARD_FOLDER_FALLBACK;
  const hit = folders.find((folder) => folder.id === folderId);
  if (hit === undefined || hit.name.trim() === '') return CARD_FOLDER_FALLBACK;
  // 只取名字本身：即便库里存了「父/子」这样的字面量，也只显示最后一段（绝不拼父级路径）。
  const parts = hit.name.split('/');
  const last = parts[parts.length - 1] ?? '';
  return last.trim() || CARD_FOLDER_FALLBACK;
}
