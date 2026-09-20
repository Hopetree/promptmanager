import { InboxOutlined } from '@ant-design/icons';
import { Card, Flex, Typography, theme } from 'antd';
import type { Folder, Prompt, PromptListResponse } from '../types';
import FavoriteStar from './FavoriteStar';
import { PromptDetailPanel } from './PromptDetail';
import SortableList from './SortableList';
import { EmptyState, ErrorState, LoadingState } from './States';

interface SplitViewProps {
  data: PromptListResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  folders: Folder[];
  isMobile: boolean;
  /** FR-59：列表"一条都没有"时显示品牌图形（72） */
  emptyWithBrandIcon: boolean;
  /** 当前右栏选中的条目（null = 空态） */
  selected: Prompt | null;
  onSelect: (prompt: Prompt) => void;
  busy: boolean;
  onCopy: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
  onEdit: (prompt: Prompt) => void;
  /** 右栏详情面的「去编辑」：来源是**详情**（FR-55 返回详情） */
  onEditDetail: (prompt: Prompt) => void;
  onReload: (prompt: Prompt) => void;
  onUnauthorized: () => void;
  onToggleFavorite: (prompt: Prompt) => void;
  /** FR-70：中栏条目拖拽结束 → 给出当前列表完整新顺序（服务端落库由 Workspace 负责） */
  onReorder: (ids: number[]) => void;
}

/**
 * 分栏视图（FR-46 / AC-44 / D-22，PromptHub 式三栏的"中 + 右"）：
 * - **中栏** `pm-split-list`：每条 `pm-split-item` = **标题（单行截断）+ 备注（固定两行）**
 *   + 收藏星标 + 拖拽手柄（FR-71 精简：不再显示正文摘要与 v/取用/更新于/文件夹/变量 等元信息）；
 *   **单击即切换右栏**，当前项有明确选中态（底色 + 左侧色条，不只靠 hover）；条目可**同层级拖拽排序**（FR-70）。
 * - **右栏** = **原样复用**详情面（`PromptDetailPanel`，即 `pm-detail` 及其全部子 testid）；
 *   未选中时给一句空态提示，不留白板；
 * - **移动端（<768px）单栏降级**：只渲染中栏列表，点条目光标由外层打开详情抽屉。
 *
 * 左栏仍由外层（Workspace）用现有只读筛选栏（`pm-sidebar`）提供。
 */
export default function SplitView({
  data,
  loading,
  error,
  onRetry,
  folders,
  isMobile,
  emptyWithBrandIcon,
  selected,
  onSelect,
  busy,
  onCopy,
  onDelete,
  onEdit,
  onEditDetail,
  onReload,
  onUnauthorized,
  onToggleFavorite,
  onReorder,
}: SplitViewProps) {
  const { token } = theme.useToken();
  const items = data?.items ?? [];

  const list = ((): React.ReactNode => {
    if (error !== null) return <ErrorState message={error} onRetry={onRetry} />;
    if (loading && data === null) return <LoadingState rows={6} label="正在读取 prompt…" />;
    if (items.length === 0) {
      return <EmptyState title="还没有可用的 prompt" hint="点右上角「新建」写一条" withBrandIcon={emptyWithBrandIcon} />;
    }
    return (
      <div data-testid="pm-split-list">
      <SortableList
        items={items}
        getId={(prompt) => prompt.id}
        onReorder={onReorder}
        handleTestIdPrefix="pm-drag-split"
        strategy="list"
        renderItem={(prompt, { handle, dragging, setNodeRef, style, rootListeners }) => {
          const active = selected !== null && selected.id === prompt.id;
          return (
            <div
              // FR-75 ③：条目本体可拖（手柄保留，供键盘与视觉提示）
              {...(rootListeners as React.HTMLAttributes<HTMLDivElement>)}
              ref={setNodeRef}
              style={{ ...style, marginBottom: 2, cursor: dragging ? 'grabbing' : 'grab' }}
              data-testid="pm-split-item"
              data-selected={active ? 'true' : 'false'}
              data-dragging={dragging ? 'true' : 'false'}
              className={active ? 'pm-split-item pm-split-item-active' : 'pm-split-item'}
              onClick={() => onSelect(prompt)}
              onDoubleClick={() => onSelect(prompt)}
            >
              {/* FR-71：条目只留 标题（单行截断）+ 备注（固定两行）；元信息与正文摘要全部去掉 */}
              <Flex align="center" gap={4}>
                <FavoriteStar prompt={prompt} testid={`pm-fav-split-${String(prompt.id)}`} onToggle={onToggleFavorite} />
                <Typography.Text strong ellipsis style={{ fontSize: 13, minWidth: 0 }}>
                  {prompt.title === '' ? '(无标题)' : prompt.title}
                </Typography.Text>
                <span style={{ marginLeft: 'auto', flex: '0 0 auto' }}>{handle}</span>
              </Flex>
              <div className="pm-split-notes" title={prompt.notes === '' ? undefined : prompt.notes}>
                {prompt.notes}
              </div>
            </div>
          );
        }}
      />
      </div>
    );
  })();

  return (
    <Flex gap={12} align="stretch" className="pm-split" data-testid="pm-view-split">
      <Card
        size="small"
        className="pm-split-list"
        styles={{ body: { padding: 6 } }}
        /* FR-71：中栏宽度 -8%（三档 clamp 各缩小 8%：实测 366px @1600 → 337px，比值 0.92） */
        style={{ flex: '0 0 clamp(276px, 31.3%, 350px)', minWidth: 0 }}
      >
        {list}
      </Card>

      {!isMobile && (
        <Card
          size="small"
          className="pm-split-detail"
          styles={{ body: { padding: 16 } }}
          style={{ flex: '1 1 auto', minWidth: 0 }}
        >
          {selected === null ? (
            <Flex
              vertical
              align="center"
              justify="center"
              gap={6}
              style={{ padding: '48px 16px', color: token.colorTextTertiary }}
            >
              <InboxOutlined style={{ fontSize: 24, color: token.colorTextQuaternary }} />
              <Typography.Text style={{ fontSize: 13, color: token.colorTextSecondary }}>
                从左侧选一条 prompt
              </Typography.Text>
              <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
                右侧会显示它的正文、变量填值与版本历史
              </Typography.Text>
            </Flex>
          ) : (
            <PromptDetailPanel
              key={selected.id}
              prompt={selected}
              busy={busy}
              onCopy={onCopy}
              onDelete={onDelete}
              onEdit={onEditDetail}
              onReload={onReload}
              onUnauthorized={onUnauthorized}
              onToggleFavorite={onToggleFavorite}
            />
          )}
        </Card>
      )}
    </Flex>
  );
}
