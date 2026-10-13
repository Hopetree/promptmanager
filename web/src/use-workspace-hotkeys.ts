import { useCallback, useEffect } from 'react';
import type { Prompt } from './types';
import type { UseViewMode } from './components/UseView';

/**
 * FR-41c 的键盘快捷键控制器。
 *
 * 阶段 71 返工② 从 `Workspace.tsx` 抽出：M1（`Ctrl/Cmd+K` 与 `/` 离开编辑器必须过未保存闸门）与
 * M2（`↑↓` 的光标必须与界面显示同源）都落在这段"按键 → 状态迁移"的纯逻辑里，抽出来同时满足
 * AC-127 D13 的行数棘轮（`Workspace.tsx` 不许比收敛前更胖）。行为一字未改，只是搬了家。
 */

/** 快捷键需要知道的状态与回调（`Workspace` 逐项注入，模块自己不持有状态）。 */
export interface WorkspaceHotkeysOptions {
  view: 'list' | 'editor';
  viewMode: UseViewMode;
  items: readonly Prompt[];
  selected: Prompt | null;
  activeIndex: number;
  editorOpen: boolean;
  editorFullscreen: boolean;
  detailOpen: boolean;
  overlayOpen: boolean;
  discardOpen: boolean;
  setView: (view: 'list' | 'editor') => void;
  setActiveIndex: (index: number) => void;
  setSelectedId: (id: number | null) => void;
  setDetailId: (id: number | null) => void;
  setEditorFullscreen: (value: boolean) => void;
  focusSearch: () => void;
  requestLeave: (action: () => void) => void;
  closeEditor: () => void;
  copyPrompt: (prompt: Prompt) => void;
}

export function useWorkspaceHotkeys(options: WorkspaceHotkeysOptions): void {
  const {
    view,
    viewMode,
    items,
    selected,
    activeIndex,
    editorOpen,
    editorFullscreen,
    detailOpen,
    overlayOpen,
    discardOpen,
    setView,
    setActiveIndex,
    setSelectedId,
    setDetailId,
    setEditorFullscreen,
    focusSearch,
    requestLeave,
    closeEditor,
    copyPrompt,
  } = options;

  /**
   * 返工② M1：`Ctrl/Cmd+K` 与 `/` 都会切回列表 —— 编辑器开着时这就是**离开编辑器**，
   * 必须与 Esc / 返回按钮走同一条闸门（FR-152：不许静默丢弃）。无脏改动时 `requestLeave` 立即执行。
   */
  const leaveEditorThen = useCallback(
    (action: () => void): void => {
      if (view === 'editor' || editorOpen) {
        requestLeave(action);
        return;
      }
      action();
    },
    [editorOpen, requestLeave, view],
  );

  const focusList = useCallback((): void => {
    setView('list');
    window.setTimeout(focusSearch, 60);
  }, [focusSearch, setView]);

  /**
   * 返工② M2：`↑↓` 的「当前项」必须与界面显示的**同源** —— 分栏视图的高亮与右栏都取自
   * `selectedId`，表格/卡片取自 `activeIndex`。两者不同源时 Enter 会复制到用户**看不见**的那条，
   * 并因此记一次假的取用（违反 AGENTS.md「取用 = 真实使用」）。
   */
  const cursorPrompt = useCallback((): Prompt | undefined => {
    if (viewMode === 'split') return selected ?? items[activeIndex];
    return items[activeIndex];
  }, [activeIndex, items, selected, viewMode]);

  const moveCursor = useCallback(
    (delta: number): void => {
      if (items.length === 0) return;
      const next = Math.min(Math.max(activeIndex + delta, 0), items.length - 1);
      setActiveIndex(next);
      // 分栏：高亮与右栏都跟 selectedId ⇒ 光标必须一起同步，否则 ↑↓ 按了没有任何反馈
      if (viewMode === 'split') {
        const target = items[next];
        if (target !== undefined) setSelectedId(target.id);
      }
    },
    [activeIndex, items, setActiveIndex, setSelectedId, viewMode],
  );

  // 快捷键（FR-41c）：/ 聚焦搜索 · Ctrl/Cmd+K 聚焦 · Esc 关详情/关闭编辑器 · ↑↓ 选择 · Enter 复制
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true);

      // FR-152 / AC-133 B8：输入控件里的按键一律交还控件（**含 Esc**）。这一句原先写在
      // Escape 分支之后 ⇒ textarea 里按 Esc 会直接关掉编辑器、未保存内容没了。必须先判。
      if (typing) return;
      // 确认弹窗开着时其它快捷键一律不插队（Esc 由 antd Modal 自己收口）
      if (discardOpen) return;

      if (event.key === 'Escape') {
        // FR-62 退出路径 ②：全屏时 Esc **只退全屏**——不关编辑器、不丢未保存内容、不触发"返回"
        if (editorFullscreen) {
          setEditorFullscreen(false);
          return;
        }
        if (detailOpen) {
          setDetailId(null);
          return;
        }
        if (overlayOpen || discardOpen) return;
        if (view === 'editor' || editorOpen) requestLeave(closeEditor);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        // 返工② M1：编辑器开着时这是"离开编辑器"，必须先过闸门（FR-152）
        leaveEditorThen(focusList);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        // 移动端编辑器是 Drawer：`view` 仍是 'list' 但 `editorOpen` 为真 —— 也必须过闸门
        leaveEditorThen(focusList);
        return;
      }
      if (view !== 'list') return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveCursor(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveCursor(-1);
      } else if (event.key === 'Enter') {
        // 返工② M2：复制**界面显示的那条**（分栏跟 selectedId，表格/卡片跟 activeIndex）
        const targetPrompt = cursorPrompt();
        if (targetPrompt !== undefined) void copyPrompt(targetPrompt);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeEditor,
    copyPrompt,
    cursorPrompt,
    detailOpen,
    discardOpen,
    editorFullscreen,
    editorOpen,
    focusList,
    leaveEditorThen,
    moveCursor,
    overlayOpen,
    requestLeave,
    setDetailId,
    setEditorFullscreen,
    view,
  ]);
}
