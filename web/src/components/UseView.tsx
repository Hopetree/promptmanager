import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Flex,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  TreeSelect,
  Typography,
  theme,
} from 'antd';
import type { TableProps } from 'antd';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildFolderTree, extractVariablesLocal, folderNameOf, formatListDateTime, orderPrompts, promptExcerpt, viewModeOptions } from '../pure';
import type { Folder, Prompt, PromptListFilters, PromptListResponse, Tag as PromptTag } from '../types';
import FavoriteStar from './FavoriteStar';
import type { PromptMetaPatch } from './PromptDetail';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import SortableList, { SortableItem, type SortableItemContext } from './SortableList';
import SplitView from './SplitView';
import { EmptyState, ErrorState, LoadingState } from './States';

/** FR-74：表格行内拖拽手柄的传递通道（行组件拿到 useSortable 的 handle → 塞进「标题」单元格） */
const RowHandleContext = createContext<React.ReactNode>(null);

/**
 * FR-74 ①：antd Table 的自定义行 —— 复用 `SortableItem`（同一套 @dnd-kit），
 * 手柄放在**「标题」单元格内**（不新增列 ⇒ 表头/列宽不变），行高不因手柄增高。
 */
function SortableTableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: number | string }) {
  const { 'data-row-key': rowKey, style, children, ...rest } = props;
  const id = Number(rowKey);
  const item = useMemo(() => ({ id }), [id]);
  return (
    <SortableItem
      item={item}
      getId={(value) => value.id}
      handleTestIdPrefix="pm-drag-row"
      renderItem={(_value, context) => (
        <RowHandleContext.Provider value={context.handle}>
          <tr
            {...(context.rootListeners as React.HTMLAttributes<HTMLTableRowElement>)}
            ref={context.setNodeRef as React.Ref<HTMLTableRowElement> | undefined}
            style={{ ...style, ...context.style }}
            data-dragging={context.dragging ? 'true' : undefined}
            data-row-key={rowKey}
            {...rest}
          >
            {children}
          </tr>
        </RowHandleContext.Provider>
      )}
    />
  );
}

/** 表格「标题」单元格里的拖拽手柄（真正的 listeners 由行组件经 RowHandleContext 提供） */
function RowDragHandle({ promptId }: { promptId: number }) {
  const handle = useContext(RowHandleContext);
  if (handle === null || handle === undefined) {
    return <span style={{ width: 24, flex: '0 0 auto' }} aria-hidden="true" />;
  }
  return <span style={{ flex: '0 0 auto' }}>{handle}</span>;
}

/** v19（FR-46）：档位按「分栏 / 表格 / 卡片」顺序；原「列表」档已删除。 */
export type UseViewMode = 'split' | 'table' | 'card';
export type UseSort = PromptListFilters['sort'] | 'title';

interface UseViewProps {
  data: PromptListResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  filters: PromptListFilters;
  onFiltersChange: (patch: Partial<PromptListFilters>) => void;
  sort: UseSort;
  onSortChange: (sort: UseSort) => void;
  viewMode: UseViewMode;
  onViewModeChange: (mode: UseViewMode) => void;
  pinFavorites: boolean;
  onPinFavoritesChange: (value: boolean) => void;
  folders: Folder[];
  /** FR-78：详情面添加标签时可选的已有标签 */
  tags: PromptTag[];
  isMobile: boolean;
  busyId: number | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onCopy: (prompt: Prompt) => void;
  onOpenDetail: (prompt: Prompt) => void;
  /** 编辑（打开编辑器）——表格行内的轻量管理入口（来源 = 列表） */
  onEdit: (prompt: Prompt) => void;
  /** 分栏右栏详情面里的「去编辑」（来源 = 详情；FR-55） */
  onEditDetail: (prompt: Prompt) => void;
  /** 删除（**只出现在表格视图行内**，需二次确认；FR-43 / AC-41 ⑤） */
  onDelete: (prompt: Prompt) => void;
  /** FR-57：一键收藏 / 取消收藏（分栏列表项 / 卡片 / 表格行共用） */
  onToggleFavorite: (prompt: Prompt) => void;
  /** FR-78：详情面内联改文件夹 / 标签 → 由外层落库 */
  onMetaChange: (prompt: Prompt, patch: PromptMetaPatch) => void;
  /** FR-77：表格多选后的批量动作（**一次调用只发 1 个请求**，由外层调 POST /api/prompts/bulk） */
  onBulk: (action: 'favorite' | 'move' | 'delete', ids: number[], folderId?: number | null) => Promise<boolean>;
  /** FR-70：拖拽排序落库（卡片网格与分栏中栏共用；ids = 当前视图完整新顺序） */
  onReorder: (ids: number[]) => void;
  /** 分栏视图右栏：当前选中的条目 */
  selected: Prompt | null;
  onSelect: (prompt: Prompt) => void;
  /** 详情面里的回滚等操作后刷新（分栏右栏复用详情面） */
  onReload: (prompt: Prompt) => void;
  onUnauthorized: () => void;
}

/**
 * 唯一主界面（FR-41b / FR-43 / FR-46 / D-21 / D-22）：搜索优先 + **分栏 / 表格 / 卡片**三视图 + 一键复制。
 * - **分栏（默认）**：左筛选栏（外层）+ 中列表 + 右详情面；
 * - **表格**：行内编辑 / 删除（二次确认）；
 * - **卡片**：以"用"为主，不常驻删除按钮。
 * 「列表」档自 v19 起删除。
 */
export default function UseView({
  data,
  loading,
  error,
  onRetry,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  pinFavorites,
  onPinFavoritesChange,
  folders,
  tags,
  isMobile,
  busyId,
  activeIndex,
  onActiveIndexChange,
  onCopy,
  onOpenDetail,
  onEdit,
  onEditDetail,
  onDelete,
  onToggleFavorite,
  onMetaChange,
  onBulk,
  onReorder,
  selected,
  onSelect,
  onReload,
  onUnauthorized,
}: UseViewProps) {
  const { token } = theme.useToken();
  const { modal } = AntdApp.useApp();
  const [query, setQuery] = useState(filters.q);
  const searchRef = useRef<React.ComponentRef<typeof Input> | null>(null);

  /* FR-77：表格多选状态（**只属于表格档**；切换视图 / 换页 / 改筛选即清空，避免"选中了看不见的条目"）。 */
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFolder, setMoveFolder] = useState<number | null>(null);
  useEffect(() => {
    setSelectedKeys([]);
  }, [viewMode, filters.page, filters.q, filters.folderId, filters.tag, filters.favorite]);

  // 搜索即所得（300ms 防抖）；`/` 与 Ctrl/Cmd+K 由 Workspace 的快捷键把焦点打到 pm-search-input 上
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query !== filters.q) onFiltersChange({ q: query });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.q, onFiltersChange, query]);

  // 外部（如点 logo 回主页）重置 filters.q 时，同步清空输入框
  useEffect(() => {
    setQuery(filters.q);
  }, [filters.q]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  /** 展示顺序：收藏置顶 + 标题排序（当前页内）——与 Workspace 的自动选中用同一个纯函数。 */
  const ordered = useMemo(() => orderPrompts(items, sort, pinFavorites), [items, pinFavorites, sort]);

  const orderedData = useMemo<PromptListResponse | null>(
    () => (data === null ? null : { ...data, items: ordered }),
    [data, ordered],
  );

  const varCount = (prompt: Prompt): number =>
    extractVariablesLocal(prompt.user_prompt, prompt.system_prompt).length;

  const copyLabel = (prompt: Prompt): string => (varCount(prompt) > 0 ? '填值后复制' : '复制');

  const copyButton = (prompt: Prompt, size: 'small' | 'middle' = 'small') => (
    <Tooltip title={varCount(prompt) > 0 ? '这条含变量，会先让你填值再复制' : '复制正文（计入使用记录）'}>
      <Button
        type={varCount(prompt) > 0 ? 'default' : 'primary'}
        size={size}
        icon={<CopyOutlined />}
        loading={busyId === prompt.id}
        data-testid={`pm-copy-${String(prompt.id)}`}
        onClick={(event) => {
          event.stopPropagation();
          onCopy(prompt);
        }}
        className={isMobile ? 'pm-copy-touch' : undefined}
      >
        {copyLabel(prompt)}
      </Button>
    </Tooltip>
  );

  /**
   * FR-116：卡片底部元信息 = **所属目录（带图标、排最前、只要目录名）+ 版本 + 变量数**。
   * 去掉了「取用数」与日期；相邻两项之间加**可见的「·」**，项间距由 10px 收到 6px。
   *
   * 两点刻意的实现约束（别顺手改）：
   *  ① **分隔符是装饰，不是内容** —— 它必须是 `aria-hidden` + `user-select: none` 的独立元素，
   *     且**不放进任何会被整行复制的容器**：卡片底部的复制走的是 `prompt.user_prompt`（剪贴板里
   *     从来不含这一行），所以分隔符不可能混进复制结果（FR-116 ⑥）。
   *  ② **只改这一处 gap** —— 卡片内部（标签区 gap=4、竖向 gap=10）与表格/分栏视图都不动；
   *     `gap={6}` 只写在这一个 Flex 上。
   */
  const metaLine = (prompt: Prompt) => (
    <Flex gap={6} wrap align="center" style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
      <Flex align="center" gap={4} component="span" data-testid={`pm-card-folder-${String(prompt.id)}`}>
        <FolderOpenOutlined aria-hidden style={{ fontSize: 11 }} />
        <span>{folderNameOf(folders, prompt.folder_id)}</span>
      </Flex>
      <span aria-hidden className="pm-meta-sep">·</span>
      <span className="pm-mono">v{prompt.version_no}</span>
      <span aria-hidden className="pm-meta-sep">·</span>
      <span>变量 {varCount(prompt)}</span>
    </Flex>
  );

  /** 卡片渲染（FR-70 拖拽；FR-73：内容撑满卡片高度 + 末行恒定贴底） */
  const renderCard = (prompt: Prompt, index: number, context?: SortableItemContext) => (
    <Card
      key={prompt.id}
      ref={context?.setNodeRef as React.Ref<HTMLDivElement> | undefined}
      data-testid="pm-use-card"
      hoverable
      size="small"
      // FR-73：卡片本体 = 竖向 flex，body 撑满整张卡（否则内容高度不足时末行贴不到底）
      // FR-75 ③：卡片**本体**是拖拽激活点（distance=5 保证单击/双击不被误判）
      {...(context?.rootListeners ?? {})}
      style={{
        ...context?.style,
        display: 'flex',
        flexDirection: 'column',
        cursor: context === undefined ? 'pointer' : 'grab',
        borderColor: activeIndex === index ? token.colorPrimary : undefined,
        boxShadow: activeIndex === index ? `0 0 0 2px ${token.controlOutline}` : undefined,
      }}
      styles={{ body: { padding: 14, flex: '1 1 auto', display: 'flex', flexDirection: 'column' } }}
      onClick={() => onActiveIndexChange(index)}
      onDoubleClick={() => onOpenDetail(prompt)}
    >
      <Flex vertical gap={10} style={{ flex: '1 1 auto', minHeight: 0 }}>
        <Flex align="center" gap={4}>
          <FavoriteStar prompt={prompt} testid={`pm-fav-card-${String(prompt.id)}`} onToggle={onToggleFavorite} />
          <Typography.Text strong ellipsis style={{ fontSize: 14, letterSpacing: '-0.01em', minWidth: 0 }}>
            {prompt.title === '' ? '(无标题)' : prompt.title}
          </Typography.Text>
          {context !== undefined && <span style={{ marginLeft: 'auto', flex: '0 0 auto' }}>{context.handle}</span>}
        </Flex>
        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: 3 }}
          style={{ margin: 0, fontSize: 12.5, minHeight: 54 }}
        >
          {promptExcerpt(prompt.user_prompt, 200) === '' ? '（这条还没有正文）' : promptExcerpt(prompt.user_prompt, 200)}
        </Typography.Paragraph>
        {/* FR-73 ④：无标签时**不渲染**标签区（空 Flex 会白占一个 gap，正是"末行不贴底"的成因之一） */}
        {prompt.tags.length > 0 && (
          <Flex gap={4} wrap>
            {prompt.tags.slice(0, 2).map((tag) => (
              <Tag key={tag} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                {tag}
              </Tag>
            ))}
            {prompt.tags.length > 2 && (
              <Tooltip title={prompt.tags.join(' / ')}>
                <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>+{prompt.tags.length - 2} 更多</Tag>
              </Tooltip>
            )}
          </Flex>
        )}
        {/* FR-73 ①：末行 marginTop:auto → 恒定贴卡片底边（距底 = body padding 14px） */}
        <Flex align="center" gap={8} style={{ marginTop: 'auto' }} data-testid={`pm-card-footer-${String(prompt.id)}`}>
          {metaLine(prompt)}
          <span style={{ marginLeft: 'auto' }}>{copyButton(prompt)}</span>
        </Flex>
      </Flex>
    </Card>
  );

  const tableColumns: TableProps<Prompt>['columns'] = [
    {
      title: '标题',
      key: 'title',
      width: 210,
      render: (_v, prompt) => (
        // FR-74 ①：手柄在标题单元格内（不新增列 ⇒ 列宽/表头不变；24px 不增高行高）
        <Flex align="center" gap={4} style={{ minWidth: 0 }}>
          <RowDragHandle promptId={prompt.id} />
          <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
            {prompt.title === '' ? '(无标题)' : prompt.title}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '标签',
      key: 'tags',
      width: 128,
      // FR-85：antd 6 的 `Tag` **没有** v5 那条默认的 `margin-inline-end: 8px`，所以多个 `<Tag>` 直接相邻时
      // 间距为 0 —— 视觉上"拼在一起"（用户 2026-09-21 反馈的根因）。
      // 修法：外面套一层 `Flex gap={4} wrap`（与卡片视图同一档间隙），并给每个 Tag 显式 `marginInlineEnd: 0`
      // 以免将来 antd 把默认 margin 加回来时与 gap 叠加成 12px（两种版本下都恒等于 4px）。
      // `wrap` + `minWidth: 0` 保证多标签在本列内换行，不撑破列宽（AC-87 ③ 量像素）。
      render: (_v, prompt) => (
        <Flex gap={4} wrap style={{ minWidth: 0 }} data-testid="pm-table-tag-cell">
          {prompt.tags.map((tag) => (
            <Tag key={tag} style={{ marginInlineEnd: 0 }}>
              {tag}
            </Tag>
          ))}
        </Flex>
      ),
    },
    {
      title: '文件夹',
      key: 'folder',
      /**
       * FR-123：移动端（≤440）这一列过窄，值会折成两行（`AI 协作` / `收`）。
       * 表格用 `scroll={{ x: 'max-content' }}`（内容驱动列宽），窄视口下"文件夹"内容短 ⇒ 被挤窄。
       * 给出 `minWidth` 兜底即可**不折行**，且不会撑宽桌面（桌面本来就按内容取到 ~116px）。
       * 比"移动端隐藏"更合适：目录名是列表里重要的扫描信息，详情页虽有但列表看一眼更快。
       */
      minWidth: 110,
      render: (_v, prompt) => {
        const id = prompt.folder_id;
        if (id === null) return '未归类';
        return folders.find((folder) => folder.id === id)?.name ?? '未归类';
      },
    },
    { title: '版本', key: 'version', width: 58, render: (_v, prompt) => <span className="pm-mono">v{prompt.version_no}</span> },
    { title: '变量数', key: 'vars', width: 66, render: (_v, prompt) => <span className="pm-mono">{varCount(prompt)}</span> },
    { title: '取用次数', key: 'use', width: 74, render: (_v, prompt) => <span className="pm-mono">{prompt.use_count}</span> },
    {
      title: '更新于',
      key: 'updated',
      width: 108,
      render: (_v, prompt) => <span className="pm-mono">{formatListDateTime(prompt.updated_at)}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 192,
      render: (_v, prompt) => (
        <Space size={2}>
          <FavoriteStar prompt={prompt} testid={`pm-fav-table-${String(prompt.id)}`} onToggle={onToggleFavorite} />
          {copyButton(prompt)}
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              aria-label="编辑"
              data-testid={`pm-edit-${String(prompt.id)}`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(prompt);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="删除这条 prompt？"
            description="版本历史一并移除，不可恢复。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => onDelete(prompt)}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label="删除"
              data-testid={`pm-delete-${String(prompt.id)}`}
              onClick={(event) => event.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /**
   * FR-120：空态**必须区分「库真的为空」与「有数据、只是被搜索/筛选滤空」**。
   *
   * 判定依据是**当前是否带着搜索/筛选条件**（`hasActiveFilter`），不是"列表空"本身 ——
   * 列表空在这两种情况下长得一模一样，靠它分不出来；而只看 `items.length` 才是"靠猜"。
   * 带着筛选却一条不剩时，若仍写「还没有可用的 prompt」，用户会以为自己库是空的，
   * 于是去「新建」⇒ 产生重复数据。
   */
  const hasActiveFilter = query !== '' || filters.folderId !== null || filters.tag !== null || filters.favorite;
  // "一条 prompt 都没有"（无搜索、无筛选）才显示品牌图形；只是筛不到时不显示
  const trulyEmpty = !hasActiveFilter;
  /** 空态文案：两处视图（卡片/表格、分栏）共用同一份，保证口径一致（AC-119 ⑥） */
  const emptyTitle = hasActiveFilter ? '没有匹配的条目' : '还没有可用的 prompt';
  const emptyHint = hasActiveFilter
    ? query === ''
      ? '当前筛选条件下没有条目，试试放宽筛选或清空搜索'
      : `没有匹配「${query}」的条目`
    : '点右上角「新建」写一条';
  /** FR-74 ①：表格行拖拽（与卡片/分栏同一套 dnd-kit 与同一接口；同目录内生效） */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleTableDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const ids = ordered.map((prompt) => prompt.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    // FR-75 / D-30：不再有跨目录限制，拖拽总是生效
    onReorder(arrayMove(ids, from, to));
  };

  const empty = (
    <EmptyState
      title={emptyTitle}
      hint={emptyHint}
      withBrandIcon={trulyEmpty}
    />
  );

  /* FR-77：批量动作 —— 一次操作**只发 1 个请求**（外层调 `POST /api/prompts/bulk`，整批一个事务）；
     成功后清空选中，失败保留选中以便重试。 */
  const runBulk = async (action: 'favorite' | 'move' | 'delete', folderId?: number | null): Promise<void> => {
    if (selectedKeys.length === 0) return;
    setBulkBusy(true);
    const ok = await onBulk(action, selectedKeys, folderId);
    setBulkBusy(false);
    if (ok) setSelectedKeys([]);
  };

  /** FR-77 ⑤：批量删除**必须二次确认**，写明将删除 N 条且不可恢复。 */
  const confirmBulkDelete = (): void => {
    const count = selectedKeys.length;
    modal.confirm({
      title: '批量删除 prompt？',
      content: `将删除 ${String(count)} 条 prompt，不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => runBulk('delete'),
    });
  };

  /** FR-77 ①：首列复选框 + 表头全选（antd Table rowSelection 原生提供）。 */
  const rowSelection: TableProps<Prompt>['rowSelection'] = {
    selectedRowKeys: selectedKeys,
    onChange: (keys) => setSelectedKeys(keys.map((key) => Number(key))),
    columnWidth: 44,
  };

  /** FR-77 ②：有选中项时在**表格上方**显示工具条；无选中不占位。 */
  const bulkToolbar = selectedKeys.length > 0 && (
    <Flex data-testid="pm-bulk-toolbar" className="pm-bulk-toolbar" align="center" gap={8} wrap>
      <Typography.Text data-testid="pm-bulk-count" style={{ fontSize: 12.5 }}>
        已选择 <span className="pm-mono">{selectedKeys.length}</span> 项
      </Typography.Text>
      <Space size={6} style={{ marginLeft: 'auto' }} wrap>
        <Button
          size="small"
          icon={<StarOutlined />}
          loading={bulkBusy}
          data-testid="pm-bulk-favorite"
          onClick={() => void runBulk('favorite')}
        >
          批量收藏
        </Button>
        <Button
          size="small"
          icon={<FolderOpenOutlined />}
          loading={bulkBusy}
          data-testid="pm-bulk-move"
          onClick={() => {
            setMoveFolder(null);
            setMoveOpen(true);
          }}
        >
          批量移动
        </Button>
        <Button size="small" danger icon={<DeleteOutlined />} data-testid="pm-bulk-delete" onClick={confirmBulkDelete}>
          批量删除
        </Button>
        <Button size="small" type="text" data-testid="pm-bulk-cancel" onClick={() => setSelectedKeys([])}>
          取消
        </Button>
      </Space>
    </Flex>
  );

  const body = ((): React.ReactNode => {
    if (viewMode === 'split') {
      return (
        <SplitView
          data={orderedData}
          loading={loading}
          error={error}
          onRetry={onRetry}
          folders={folders}
          tags={tags}
          isMobile={isMobile}
          emptyWithBrandIcon={trulyEmpty}
          // FR-120：分栏视图的空态文案由这里**统一下发**，与卡片/表格视图同一口径（AC-119 ⑥）
          emptyTitle={emptyTitle}
          emptyHint={emptyHint}
          selected={selected}
          onSelect={onSelect}
          busy={busyId !== null}
          onCopy={onCopy}
          onDelete={onDelete}
          onEdit={onEdit}
          onEditDetail={onEditDetail}
          onReorder={onReorder}
          onReload={onReload}
          onUnauthorized={onUnauthorized}
          onToggleFavorite={onToggleFavorite}
          onMetaChange={onMetaChange}
        />
      );
    }
    if (error !== null) return <ErrorState message={error} onRetry={onRetry} />;
    if (loading && data === null) return <LoadingState rows={4} label="正在读取 prompt…" />;
    if (viewMode === 'card') {
      if (ordered.length === 0) {
        return (
          <div className="pm-use-grid" data-testid="pm-view-card">
            {empty}
          </div>
        );
      }
      return (
        <div className="pm-use-grid" data-testid="pm-view-card">
          <SortableList
            items={ordered}
            getId={(prompt) => prompt.id}
            onReorder={onReorder}
            handleTestIdPrefix="pm-drag-card"
            strategy="grid"
            renderItem={(prompt, context) => renderCard(prompt, ordered.indexOf(prompt), context)}
          />
        </div>
      );
    }
    return (
      <div data-testid="pm-view-table">
        {/* FR-77 ②：批量工具条在表格**上方**（无选中时不占位） */}
        {bulkToolbar}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleTableDragEnd}
        >
          <SortableContext items={ordered.map((prompt) => prompt.id)} strategy={verticalListSortingStrategy}>
            <Table<Prompt>
              className="pm-table-dense"
              rowKey="id"
              size="small"
              columns={tableColumns}
              dataSource={ordered}
              pagination={false}
              rowSelection={rowSelection}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: empty }}
              components={{ body: { row: SortableTableRow } }}
              onRow={(prompt, index) => ({
                onClick: (event) => {
                  // 复选框列上的点击只切换选中，不改变"当前条目"高亮
                  if ((event.target as HTMLElement).closest('.ant-table-selection-column') !== null) return;
                  onActiveIndexChange(index ?? 0);
                },
                onDoubleClick: () => onOpenDetail(prompt),
                className: activeIndex === index ? 'pm-row-selected' : '',
              })}
            />
          </SortableContext>
        </DndContext>
      </div>
    );
  })();

  return (
    <Flex vertical gap={12}>
      {/* 搜索优先：大搜索框 + 排序 + 视图切换 + 收藏置顶 */}
      <Flex gap={8} wrap align="center">
        <Input
          ref={searchRef}
          data-testid="pm-search-input"
          size="large"
          allowClear
          autoFocus={!isMobile}
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          placeholder="搜索 prompt"
          title="按 / 聚焦，Ctrl/Cmd+K 也可以"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={() => onFiltersChange({ q: query })}
          style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 640 }}
        />
        <Tooltip title="「标题」排序在当前页内生效；「自定义」= 拖拽出来的顺序">
          <Select
            data-testid="pm-use-sort"
            size="large"
            style={{ width: 148 }}
            value={sort}
            onChange={(value) => onSortChange(value as UseSort)}
            options={[
              { value: 'updated', label: '最近更新' },
              { value: 'recent_used', label: '最近使用' },
              { value: 'title', label: '标题' },
              { value: 'custom', label: '自定义' },
            ]}
          />
        </Tooltip>
        <Segmented
          size="large"
          value={viewMode}
          onChange={(value) => onViewModeChange(value as UseViewMode)}
          /* FR-92 ①：顺序按断点 —— 桌面 分栏/表格/卡片，移动端 卡片/表格/分栏（见 pure.ts viewModeOptions） */
          options={viewModeOptions(isMobile)}
          data-testid="pm-use-viewmode"
        />
        <Space size={6}>
          <Switch size="small" checked={pinFavorites} onChange={onPinFavoritesChange} />
          <Typography.Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>收藏置顶</Typography.Text>
        </Space>
        <Space size={6}>
          <Switch
            size="small"
            data-testid="pm-use-favorite-only"
            checked={filters.favorite}
            onChange={(checked) => onFiltersChange({ favorite: checked })}
          />
          <Typography.Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>只看收藏</Typography.Text>
        </Space>
      </Flex>

      {body}

      {error === null && items.length > 0 && (
        <Flex align="center" gap={12}>
          <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
            共 <span className="pm-mono">{total}</span> 条
          </Typography.Text>
          <Pagination
            size="small"
            style={{ marginLeft: 'auto' }}
            current={filters.page}
            pageSize={filters.pageSize}
            total={total}
            showSizeChanger={false}
            onChange={(page) => onFiltersChange({ page })}
          />
        </Flex>
      )}

      {/* FR-77 ⑤：批量移动 —— 选目标文件夹（含「未归类」），确定后**一次** POST /api/prompts/bulk */}
      <Modal
        open={moveOpen}
        title="批量移动到文件夹"
        okText="确定"
        cancelText="取消"
        onCancel={() => setMoveOpen(false)}
        onOk={() => {
          setMoveOpen(false);
          void runBulk('move', moveFolder);
        }}
      >
        <Flex vertical gap={10} data-testid="pm-bulk-move-modal">
          <Typography.Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
            将选中的 {selectedKeys.length} 条 prompt 移到：
          </Typography.Text>
          <TreeSelect
            data-testid="pm-bulk-move-folder"
            aria-label="目标文件夹"
            value={moveFolder ?? 0}
            onChange={(value) => setMoveFolder(Number(value) === 0 ? null : Number(value))}
            treeData={[{ value: 0, title: '未归类', key: 0, children: [] }, ...buildFolderTree(folders)]}
            treeDefaultExpandAll
            showSearch
            treeNodeFilterProp="title"
            style={{ width: '100%' }}
          />
        </Flex>
      </Modal>
    </Flex>
  );
}
