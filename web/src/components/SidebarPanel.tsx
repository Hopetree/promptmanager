import { Flex } from 'antd';
import type { Folder, Tag as PromptTag } from '../types';
import FolderPanel from './FolderPanel';
import TagPanel from './TagPanel';

interface SidebarPanelProps {
  folders: Folder[];
  /** 每个文件夹自身的条目数（含子文件夹的合计在 FolderPanel 内求和） */
  folderCounts: Record<number, number>;
  tags: PromptTag[];
  selectedFolderId: number | null;
  selectedTag: string | null;
  onSelectFolder: (id: number | null) => void;
  onSelectTag: (name: string | null) => void;
  onChanged: () => void;
  onUnauthorized: () => void;
  /** FR-70：同一父级下的文件夹拖拽重排 */
  onReorderFolders: (parentId: number | null, ids: number[]) => void;
}

/**
 * 左侧栏（FR-40b 第 2 条 + FR-49 / FR-50 / D-24）：
 * **文件夹** = 筛选 + 就地增删改（标题行 `+` 新建、行内悬浮 新建子文件夹/重命名/删除）；
 * **标签** = 胶囊云，只做筛选（不提供增删改）。侧栏锚点仍是 `pm-sidebar`（AC-31）。
 */
export default function SidebarPanel({
  folders,
  folderCounts,
  tags,
  selectedFolderId,
  selectedTag,
  onSelectFolder,
  onSelectTag,
  onChanged,
  onUnauthorized,
  onReorderFolders,
}: SidebarPanelProps) {
  return (
    <Flex data-testid="pm-sidebar" vertical gap={12}>
      <FolderPanel
        folders={folders}
        counts={folderCounts}
        selected={selectedFolderId}
        onSelect={onSelectFolder}
        onChanged={onChanged}
        onUnauthorized={onUnauthorized}
        onReorder={onReorderFolders}
      />
      <TagPanel tags={tags} selected={selectedTag} onSelect={onSelectTag} />
    </Flex>
  );
}
