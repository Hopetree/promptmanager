import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import type { Folder } from '../types';
import { SortableItem } from './SortableList';

interface FolderPanelProps {
  folders: Folder[];
  /** 每个文件夹**自身**（不含子文件夹）的条目数；含子项的合计在面板内递归求和 */
  counts: Record<number, number>;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onChanged: () => void;
  onUnauthorized: () => void;
  /** FR-70：**同一父级下**的文件夹拖拽重排（跨父级由服务端拒成 400，前端也不允许） */
  onReorder: (parentId: number | null, ids: number[]) => void;
}

interface Row {
  folder: Folder;
  depth: number;
  hasChildren: boolean;
  visible: boolean;
}

/**
 * 文件夹筛选 + 就地管理（FR-49 / D-24）：
 * - 标题行常驻 `+`（`folder-create`）= 新建**顶级**文件夹；
 * - 行内**悬浮**显示 `＋`（新建子文件夹）/ `⋯` 重命名 / 删除（`pm-folder-rename` / `pm-folder-delete`，删除二次确认）；
 * - 层级：展开/收起三角、按级缩进（子级 left ≥ 父级 +16px）、文件夹图标开/合两态、
 *   右侧浅灰条目数（**不用彩色徽标**）、选中态（浅底 + 左侧 3px 色条）、悬浮高亮、长名省略号。
 */
export default function FolderPanel({
  folders,
  counts,
  selected,
  onSelect,
  onChanged,
  onUnauthorized,
  onReorder,
}: FolderPanelProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // FR-54：删除弹层打开期间必须"钉住"行内操作区 —— 否则鼠标一离开行，
  // 触发 Popconfirm 的按钮被卸载，弹层随之消失（"弹窗根本无法点击"的根因）。
  const [deleteOpenFor, setDeleteOpenFor] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [createForm] = Form.useForm<{ name: string }>();
  const [renameForm] = Form.useForm<{ name: string }>();

  /** FR-70：拖动中的文件夹 id（用来把排序组限制在**同一父级**内） */
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const childrenOf = (parent: number | null): Folder[] =>
    folders
      .filter((folder) => folder.parent_id === parent)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  /** 扁平化（父 → 子），并标记"是否被祖先折叠隐藏"（折叠后子项仍在 DOM，但 display:none → offsetParent === null）。 */
  const rows = useMemo(() => {
    const out: Row[] = [];
    const known = new Set(folders.map((folder) => folder.id));
    const walk = (parent: number | null, depth: number, visible: boolean): void => {
      for (const folder of childrenOf(parent)) {
        const kids = childrenOf(folder.id).length > 0;
        out.push({ folder, depth, hasChildren: kids, visible });
        walk(folder.id, depth + 1, visible && !collapsed.has(folder.id));
      }
    };
    // 根 = parent 为 null 或父不在集合里的"孤儿"（不丢条目）
    const roots = folders.filter((folder) => folder.parent_id === null || !known.has(folder.parent_id));
    for (const root of roots.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)) {
      const kids = childrenOf(root.id).length > 0;
      out.push({ folder: root, depth: 0, hasChildren: kids, visible: true });
      walk(root.id, 1, !collapsed.has(root.id));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, collapsed]);

  /**
   * 含子文件夹的条目数（浅灰小字）。
   * FR-72 / D-29 连带修订：接口 `GET /api/prompts?folder_id=X` 的 `total` **本身就是含子目录**的，
   * 所以这里**不能再对子目录求和**（否则 A 会显示 3+2+1=6，而点进去只有 3 条 —— 正是"计数与结果不一致"的反向 bug）。
   */
  const inclusiveCount = (id: number): number => counts[id] ?? 0;

  const siblingIdsOf = (id: number | null): number[] => {
    if (id === null) return rows.map((row) => row.folder.id);
    const row = rows.find((item) => item.folder.id === id);
    if (row === undefined) return [];
    return childrenOf(row.folder.parent_id).map((folder) => folder.id);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setDraggingId(null);
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);
    const activeRow = rows.find((row) => row.folder.id === activeId);
    const overRow = rows.find((row) => row.folder.id === overId);
    // FR-70 范围限定：**只允许同一父级下的重排**（跨父级拖动一律忽略）
    if (activeRow === undefined || overRow === undefined) return;
    if (activeRow.folder.parent_id !== overRow.folder.parent_id) {
      // FR-75 ①：不允许的分支**绝不静默** —— 给可见反馈（跨父级移动本期不做）
      message.info('文件夹只能在同一个父级下调整顺序');
      return;
    }
    const siblings = childrenOf(activeRow.folder.parent_id).map((folder) => folder.id);
    const from = siblings.indexOf(activeId);
    const to = siblings.indexOf(overId);
    if (from < 0 || to < 0) return;
    onReorder(activeRow.folder.parent_id, arrayMove(siblings, from, to));
  };

  const handle = (error: unknown): void => {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthorized();
      return;
    }
    message.error(describeError(error));
  };

  const openCreate = (parent: number | null): void => {
    setCreateParent(parent);
    createForm.setFieldsValue({ name: '' });
    setCreateOpen(true);
  };

  const create = async (): Promise<void> => {
    const values = await createForm.validateFields();
    try {
      await api.createFolder(values.name, createParent);
      message.success(createParent === null ? '已创建文件夹' : '已创建子文件夹');
      setCreateOpen(false);
      createForm.resetFields();
      onChanged();
    } catch (error) {
      handle(error);
    }
  };

  const rename = async (): Promise<void> => {
    if (renameTarget === null) return;
    const values = await renameForm.validateFields();
    try {
      await api.renameFolder(renameTarget.id, values.name);
      message.success('已重命名');
      setRenameOpen(false);
      setRenameTarget(null);
      onChanged();
    } catch (error) {
      handle(error);
    }
  };

  const remove = async (folder: Folder): Promise<void> => {
    try {
      await api.deleteFolder(folder.id);
      message.success('已删除文件夹');
      setDeleteOpenFor(null);
      if (selected === folder.id) onSelect(null);
      onChanged();
    } catch (error) {
      // FR-54（P0）：任何非 2xx 都要有用户可见反馈，且说清「原因 + 下一步」——绝不静默失败。
      if (error instanceof ApiError && error.code === 'folder_not_empty') {
        const kids = childrenOf(folder.id).length;
        const own = counts[folder.id] ?? 0;
        const why = kids > 0 ? `还有 ${String(kids)} 个子文件夹` : `还有 ${String(own)} 条 prompt`;
        message.error(`没能删除「${folder.name}」：该文件夹${why}。请先清空子文件夹 / 把其中的 prompt 移走，再删除。`);
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        message.error(`没能删除「${folder.name}」：文件夹非空。请先清空子文件夹 / 把其中的 prompt 移走，再删除。`);
        return;
      }
      handle(error);
    }
  };

  const parentName = createParent === null ? '顶层' : (folders.find((f) => f.id === createParent)?.name ?? '顶层');

  const deleteHint = (folder: Folder): string => {
    const kids = childrenOf(folder.id).length;
    if (kids > 0) return `含 ${String(kids)} 个子文件夹，需先清空；服务端会拒绝删除（409）。`;
    const own = counts[folder.id] ?? 0;
    if (own > 0) return `该文件夹下有 ${String(own)} 条 prompt，需先移出；服务端会拒绝删除（409）。`;
    return '删除后不可恢复。';
  };

  return (
    <Card
      size="small"
      title={
        <Space size={4}>
          <FolderOutlined />
          文件夹
        </Space>
      }
      extra={
        <Tooltip title="新建顶级文件夹">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openCreate(null)}
            data-testid="folder-create"
            aria-label="新建文件夹"
          />
        </Tooltip>
      }
      styles={{ body: { padding: 8 } }}
    >
      {folders.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有文件夹" />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragStart={(event) => setDraggingId(Number(event.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
        <SortableContext items={siblingIdsOf(draggingId)} strategy={verticalListSortingStrategy}>
        <Flex vertical gap={2}>
          {rows.map(({ folder, depth, hasChildren, visible }) => {
            const active = selected === folder.id;
            const isOpen = hasChildren && !collapsed.has(folder.id);
            const isHovered = hovered === folder.id || deleteOpenFor === folder.id;
            return (
              <SortableItem
                key={folder.id}
                item={folder}
                getId={(item) => item.id}
                handleTestIdPrefix="pm-drag-folder"
                disabled={!visible}
                renderItem={(item, context) => (
              <Flex
                {...(context.rootListeners as React.HTMLAttributes<HTMLDivElement>)}
                ref={context.setNodeRef as React.Ref<HTMLDivElement> | undefined}
                data-testid={`pm-folder-row-${String(item.id)}`}
                data-depth={depth}
                data-dragging={context.dragging ? 'true' : undefined}
                align="center"
                gap={4}
                className={active ? 'pm-folder-row pm-folder-row-active' : 'pm-folder-row'}
                style={{
                  ...context.style,
                  display: visible ? 'flex' : 'none',
                  marginLeft: depth * 16,
                  minWidth: 0,
                }}
                onClick={() => onSelect(active ? null : folder.id)}
                onMouseEnter={() => setHovered(folder.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {hasChildren ? (
                  <Button
                    type="text"
                    size="small"
                    className="pm-folder-caret"
                    icon={isOpen ? <DownOutlined /> : <RightOutlined />}
                    aria-label={isOpen ? '收起' : '展开'}
                    data-testid={`pm-folder-toggle-${String(folder.id)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(folder.id)) next.delete(folder.id);
                        else next.add(folder.id);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <span style={{ width: 22, flex: '0 0 auto' }} />
                )}
                {isOpen ? (
                  <FolderOpenOutlined style={{ color: token.colorPrimary, fontSize: 13, flex: '0 0 auto' }} />
                ) : (
                  <FolderOutlined style={{ color: token.colorTextTertiary, fontSize: 13, flex: '0 0 auto' }} />
                )}
                <Typography.Text
                  ellipsis
                  title={folder.name}
                  style={{ minWidth: 0, flex: '1 1 auto', fontSize: 12.5 }}
                >
                  {folder.name}
                </Typography.Text>
                {isHovered && (
                  // ⚠️ Popconfirm 走 React portal：弹层在 DOM 上挂在 body，但**React 事件冒泡仍回到本行**。
                  // 这里统一拦住，避免点「取消/删除」时把该文件夹误设为当前筛选。
                  <span className="pm-folder-actions" onClick={(event) => event.stopPropagation()}>
                    <Button
                      type="text"
                      size="small"
                      icon={<FolderAddOutlined />}
                      title="新建子文件夹"
                      aria-label="新建子文件夹"
                      data-testid="pm-folder-add-child"
                      onClick={(event) => {
                        event.stopPropagation();
                        openCreate(folder.id);
                      }}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      title="重命名"
                      aria-label="重命名"
                      data-testid="pm-folder-rename"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRenameTarget(folder);
                        renameForm.setFieldsValue({ name: folder.name });
                        setRenameOpen(true);
                      }}
                    />
                    <Popconfirm
                      title={`删除文件夹「${folder.name}」？`}
                      description={deleteHint(folder)}
                      okText="删除"
                      cancelText="取消"
                      open={deleteOpenFor === folder.id}
                      onOpenChange={(open) => setDeleteOpenFor(open ? folder.id : null)}
                      onConfirm={() => void remove(folder)}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        title="删除"
                        aria-label="删除"
                        data-testid="pm-folder-delete"
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Popconfirm>
                  </span>
                )}
                <Typography.Text
                  className="pm-folder-count"
                  style={{ fontSize: 11, color: token.colorTextTertiary, flex: '0 0 auto' }}
                >
                  {inclusiveCount(item.id)}
                </Typography.Text>
                {/* FR-70：拖拽手柄放**行尾**——hover 时行内操作区出现/消失不会推挤它，指针不会"按空" */}
                <span style={{ flex: '0 0 auto' }}>{context.handle}</span>
              </Flex>
                )}
              />
            );
          })}
        </Flex>
        </SortableContext>
        </DndContext>
      )}

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void create()}
        title="新建文件夹"
        okText="创建"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入文件夹名' }]}>
            <Input placeholder="例如：运维" />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            新建位置：{parentName}
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        open={renameOpen}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTarget(null);
        }}
        onOk={() => void rename()}
        title="重命名文件夹"
        okText="保存"
        cancelText="取消"
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入文件夹名' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
