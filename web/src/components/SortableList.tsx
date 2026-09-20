import { HolderOutlined } from '@ant-design/icons';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

/**
 * 拖拽排序的共用封装（FR-70 / D-28）：**卡片网格**与**竖直列表**两种形态共用同一套 dnd-kit 配置。
 *
 * 约定（都是 AC-70 的机械判据）：
 * - 手柄 `HolderOutlined` 走 `.pm-drag-handle`：热区 24×24、`cursor: grab/grabbing`、**不增加行高**（放在标题行里）；
 * - 手柄是唯一的拖拽激活点（`setActivatorNodeRef`），条目本体仍可点击（单击切换右栏 / 双击开详情）；
 * - 让位过渡 **150ms**（dnd-kit 的 `transition.duration`）——拖动中其它条目只做 transform，不重排 DOM、不闪烁；
 * - **拖拽总是生效**（FR-75 / D-30）：`onReorder` 收到的是"拖完后当前列表的完整 id 顺序"，由调用方落库；
 *   后端按**槽位保持**语义写库（其他条目不受影响、不产生重复 sort_order、不把这组条目顶到全局最前）。
 * - 条目**本体**即拖拽激活点（FR-75 ③），手柄保留（可聚焦 / 键盘方向键移动 / 视觉提示）。
 */
export interface SortableItemContext {
  /** 拖拽手柄（贴在标题行里） */
  handle: ReactNode;
  /** 该条目是否正被拖动 */
  dragging: boolean;
  /** 根元素 ref（必须挂到条目根节点上） */
  setNodeRef: (element: HTMLElement | null) => void;
  /** 根元素样式（transform + transition + 拖动中层级） */
  style: CSSProperties;
  /**
   * FR-75 ③：挂到**条目本体**上的指针监听（`onPointerDown`）—— 让整张卡片/整行都能作为拖拽激活点。
   * 手柄仍保留键盘监听（`attributes` + `onKeyDown`），保证键盘可达；`activationConstraint.distance = 5`
   * 保证"单击选中 / 双击开详情"不会被误判成拖拽。
   */
  rootListeners: Record<string, unknown>;
}

interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => number;
  /** 拖拽结束：给出当前列表的完整新顺序（id 数组），由调用方落库 */
  onReorder: (ids: number[]) => void;
  renderItem: (item: T, context: SortableItemContext) => ReactNode;
  /** 手柄的 data-testid 前缀（最终为 `<prefix>-<id>`） */
  handleTestIdPrefix: string;
  /** grid = 卡片网格（rect strategy）；list = 竖直列表（vertical strategy） */
  strategy?: 'grid' | 'list';
  disabled?: boolean;
}

export function DragHandle({
  id,
  testId,
  attributes,
  listeners,
  setActivatorNodeRef,
  disabled,
}: {
  id: number;
  testId: string;
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  disabled: boolean;
}) {
  return (
    <Button
      type="text"
      size="small"
      className="pm-drag-handle"
      icon={<HolderOutlined />}
      data-testid={testId}
      aria-label={`拖动排序 #${String(id)}`}
      title="按住拖动以调整顺序"
      disabled={disabled}
      ref={setActivatorNodeRef}
      onClick={(event) => {
        // 手柄只负责拖拽，不要把点击冒泡成"选中/打开详情"
        event.stopPropagation();
      }}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        // FR-75 ③：本体也挂了 onPointerDown —— 手柄上先处理再**阻止冒泡**，避免同一次按下被两个激活点各启动一次
        (listeners?.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(event);
        event.stopPropagation();
      }}
    />
  );
}

export function SortableItem<T>({
  item,
  getId,
  renderItem,
  handleTestIdPrefix,
  disabled = false,
}: {
  item: T;
  getId: (item: T) => number;
  renderItem: (item: T, context: SortableItemContext) => ReactNode;
  handleTestIdPrefix: string;
  disabled?: boolean;
}) {
  const id = getId(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    // AC-70 ②：让位过渡 ≤150ms
    transition: { duration: 150, easing: 'ease' },
  });

  // FR-75 ③：**本体**也作为指针激活点（整张卡片可拖）；手柄仍保留完整监听（指针 + 键盘），
  // 手柄的 onPointerDown 内部会阻止冒泡，故同一次按下只会启动一次拖拽。
  const allListeners = (listeners ?? {}) as Record<string, unknown>;
  const { onPointerDown } = allListeners;

  return (
    <>
      {renderItem(item, {
        handle: (
          <DragHandle
            id={id}
            testId={`${handleTestIdPrefix}-${String(id)}`}
            attributes={attributes}
            listeners={allListeners}
            setActivatorNodeRef={setActivatorNodeRef}
            disabled={disabled}
          />
        ),
        rootListeners: onPointerDown === undefined ? {} : { onPointerDown },
        dragging: isDragging,
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.55 : undefined,
          zIndex: isDragging ? 2 : undefined,
          position: 'relative',
        },
      })}
    </>
  );
}

export default function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  handleTestIdPrefix,
  strategy = 'list',
  disabled = false,
}: SortableListProps<T>) {
  const sensors = useSensors(
    // 5px 才激活：避免"点一下条目"被误判成拖拽（条目本体还要负责单击切换右栏）
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = items.map((item) => getId(item));

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    // FR-75 / D-30：**不再有跨目录限制** —— inclusive 视图（全部 / 父目录）下拖拽总是生效
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={strategy === 'list' ? [restrictToVerticalAxis, restrictToParentElement] : [restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={strategy === 'list' ? verticalListSortingStrategy : rectSortingStrategy}>
        {items.map((item) => (
          <SortableItem
            key={getId(item)}
            item={item}
            getId={getId}
            renderItem={renderItem}
            handleTestIdPrefix={handleTestIdPrefix}
            disabled={disabled}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
