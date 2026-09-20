import { App as AntdApp, Button, Card, Drawer, Flex, Grid, Input, Layout, List, Typography, theme } from 'antd';
import { ArrowLeftOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import type { CSSProperties } from 'react';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, describeError } from '../api';
import { formatListDateTime, orderPrompts } from '../pure';
import type { Folder, Prompt, PromptListFilters, PromptListResponse, Tag } from '../types';
import type { ThemeMode } from '../theme-mode';
import {
  LazyAboutModal,
  LazyImportExportModal,
  LazyPasswordModal,
  LazyPromptEditor,
  LazyTokenDrawer,
  LazyUsageDrawer,
  LazyVarsDialog,
} from '../lazy';
import AppHeader from './AppHeader';
import LazyFallback from './LazyFallback';
import PromptDetail, { type PromptMetaPatch } from './PromptDetail';
import SidebarPanel from './SidebarPanel';
import UseView, { type UseSort, type UseViewMode } from './UseView';
import { usePromptCopy } from '../use-copy';

interface WorkspaceProps {
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  onSignedOut: () => void;
}

const PAGE_SIZE = 20;

/** 新建时的**内存草稿**（FR-45）：`id=0` 表示还没入库；点「保存」才 POST 创建。 */
const EMPTY_DRAFT: Prompt = {
  id: 0,
  title: '',
  user_prompt: '',
  system_prompt: '',
  notes: '',
  folder_id: null,
  tags: [],
  favorite: false,
  created_at: '',
  updated_at: '',
  version_no: 0,
  use_count: 0,
  last_used_at: null,
};

/** 本地偏好（视图/排序/收藏置顶都记住；不新增接口）。v17（FR-43）起界面只有一套，没有模式开关。 */
function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}
function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下写不进就算了 */
  }
}

/**
 * 工作区（FR-43 / D-21 / FR-46 / FR-48）：**只有一个主界面**——使用优先的三档视图（分栏 / 表格 / 卡片）。
 * 管理动作（编辑 / 删除）落在表格行内与分栏右栏的详情面里（D-22），编辑页自身也有删除；
 * `⋯更多` 只放 使用统计 → API 令牌 → 导入 / 导出 → 关于（testid 仍是 `pm-settings`）→ 已登录信息 → 登出。
 * 编辑器为三栏常驻（左列表 / 中表单 / 右预览·变量·版本，FR-56 顺序）；全屏由 `editorFullscreen` 控制（FR-62）。
 */
export default function Workspace({ themeMode, onCycleTheme, onSignedOut }: WorkspaceProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === undefined ? window.innerWidth < 768 : !screens.md;
  // 768–1200px：保留「中栏 + 右栏」，左栏收成抽屉（FR-46）；≥1200 三栏同屏
  const isNarrow = !isMobile && (screens.xl === undefined ? window.innerWidth < 1200 : !screens.xl);

  const [view, setView] = useState<'list' | 'editor'>('list');
  const [useSort, setUseSort] = useState<UseSort>(() =>
    // FR-70：'custom'（自定义排序）也必须能被记住 —— 否则刷新后会回退成 updated、拖拽结果看起来丢失
    readPref<UseSort>('pm-use-sort', 'updated', ['updated', 'recent_used', 'title', 'custom']),
  );
  // v19（FR-46）：默认 = 分栏；档位 split/table/card（旧值 `list` 自然回退到 split）
  const [viewMode, setViewMode] = useState<UseViewMode>(() =>
    readPref<UseViewMode>('pm-view-mode', 'split', ['split', 'table', 'card']),
  );
  const [pinFavorites, setPinFavorites] = useState(() => readBoolPref('pm-pin-favorites', true));
  const [activeIndex, setActiveIndex] = useState(0);
  const [filters, setFilters] = useState<PromptListFilters>({
    q: '',
    folderId: null,
    tag: null,
    favorite: false,
    sort: readPref<PromptListFilters['sort']>('pm-use-sort', 'updated', ['updated', 'recent_used', 'custom']),
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [data, setData] = useState<PromptListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editing, setEditing] = useState<Prompt | null>(null);
  /** true = 编辑器里是**未保存草稿**（FR-45） */
  const [isNew, setIsNew] = useState(false);
  /** 进入编辑态的来源（FR-55：详情 → 返回详情；列表 / 新建 → 返回列表） */
  const [editorOrigin, setEditorOrigin] = useState<'detail' | 'list' | 'new'>('list');
  /** 分栏视图右栏当前选中（FR-46；桌面端内联显示） */
  const [selected, setSelected] = useState<Prompt | null>(null);
  /** 详情弹层（卡片/表格双击、移动端点条目） */
  const [detail, setDetail] = useState<Prompt | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  /** FR-62：编辑器全屏（状态放在这里，Esc 与外壳隐藏才能统一处理） */
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [siderOpen, setSiderOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** FR-67：修改密码弹窗 */
  const [passwordOpen, setPasswordOpen] = useState(false);

  const handleUnauthorized = useCallback((): void => {
    message.warning('会话已失效，请重新登录');
    onSignedOut();
  }, [message, onSignedOut]);

  const copier = usePromptCopy(handleUnauthorized);

  const notify = useCallback(
    (error: unknown): void => {
      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      message.error(describeError(error));
    },
    [handleUnauthorized, message],
  );

  const loadList = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.listPrompts({
        q: filters.q,
        folderId: filters.folderId,
        tag: filters.tag ?? undefined,
        favorite: filters.favorite ? true : undefined,
        sort: filters.sort,
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize,
      });
      setData(result);
      setListError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      setListError(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [filters, handleUnauthorized]);

  const loadFolders = useCallback(async (): Promise<void> => {
    try {
      setFolders((await api.folders()).items);
    } catch (error) {
      notify(error);
    }
  }, [notify]);

  const loadTags = useCallback(async (): Promise<void> => {
    try {
      setTags((await api.tags()).items);
    } catch (error) {
      notify(error);
    }
  }, [notify]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  useEffect(() => {
    void loadFolders();
    void loadTags();
  }, [loadFolders, loadTags, refreshKey]);

  // FR-49 ④：每个文件夹**自身**的条目数（`folder_id` 是精确筛选，含子文件夹的合计在 FolderPanel 内求和）。
  // 走既有契约（GET /api/prompts?folder_id=N&limit=1 只取 total），不改接口。
  const [folderCounts, setFolderCounts] = useState<Record<number, number>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (folders.length === 0) {
        if (alive) setFolderCounts({});
        return;
      }
      try {
        const pairs = await Promise.all(
          folders.map(async (folder) => {
            const result = await api.listPrompts({ folderId: folder.id, limit: 1 });
            return [folder.id, result.total] as const;
          }),
        );
        if (alive) setFolderCounts(Object.fromEntries(pairs));
      } catch {
        /* 计数失败不阻塞筛选 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [folders, refreshKey]);

  useEffect(() => {
    if (filters.folderId !== null && folders.length > 0 && !folders.some((folder) => folder.id === filters.folderId)) {
      setFilters((prev) => ({ ...prev, folderId: null, page: 1 }));
    }
    if (filters.tag !== null && tags.length > 0 && !tags.some((tag) => tag.name === filters.tag)) {
      setFilters((prev) => ({ ...prev, tag: null, page: 1 }));
    }
  }, [folders, tags, filters.folderId, filters.tag]);

  const applyFilters = useCallback((patch: Partial<PromptListFilters>): void => {
    setFilters((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  }, []);

  const refresh = useCallback((): void => {
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => writePref('pm-use-sort', useSort), [useSort]);
  useEffect(() => writePref('pm-view-mode', viewMode), [viewMode]);
  useEffect(() => writePref('pm-pin-favorites', pinFavorites ? '1' : '0'), [pinFavorites]);

  /**
   * FR-70 / D-28：拖拽排序落库（FR-74 ②：**乐观更新** —— 本地立即生效、后端静默提交、失败回滚）。
   * - 顺序 = `ids`（当前视图的完整新顺序）→ `PATCH /api/prompts/order`；
   * - 先本地重排 `data.items`（**不重新请求** ⇒ 无 loading 骨架、无整表重绘闪烁），再后台 PATCH；
   *   失败 → 回滚到拖动前的数据 + 提示（绝不静默）；
   * - 若当前不是「自定义」档 → 切档并给**一次**轻提示（BRIEF 允许的"已切换为自定义排序"）；
   * - 同时关掉「收藏置顶」：拖拽是显式指定顺序，否则刷新后收藏会重新置顶、看起来"没生效"。
   */
  const reorderPrompts = useCallback(
    async (ids: number[]): Promise<void> => {
      const snapshot = data;
      const byId = new Map((snapshot?.items ?? []).map((prompt) => [prompt.id, prompt]));
      const reordered = ids.map((id) => byId.get(id)).filter((prompt): prompt is Prompt => prompt !== undefined);
      // 乐观更新：当前页所有条目都在 ids 里时才本地重排（否则顺序不完整，交给服务端回包）
      if (snapshot !== null && reordered.length === ids.length && reordered.length === snapshot.items.length) {
        setData({ ...snapshot, items: reordered });
      }
      if (pinFavorites) setPinFavorites(false);
      if (useSort !== 'custom') {
        setUseSort('custom');
        applyFilters({ sort: 'custom' });
        message.info('已切换为自定义排序');
      }
      try {
        await api.reorderPrompts(ids);
      } catch (error) {
        if (snapshot !== null) setData(snapshot); // 回滚
        notify(error);
      }
    },
    [applyFilters, data, message, notify, pinFavorites, useSort],
  );

  /** FR-70：同一父级下的文件夹重排（跨父级由服务端拒成 400）。 */
  const reorderFolders = useCallback(
    async (parentId: number | null, ids: number[]): Promise<void> => {
      try {
        await api.reorderFolders(parentId, ids);
        setFolders((await api.folders()).items);
      } catch (error) {
        notify(error);
      }
    },
    [notify],
  );

  const changeSort = useCallback(
    (next: UseSort): void => {
      setUseSort(next);
      // 接口只支持 updated / recent_used；`title` 是"当前页内"的客户端排序
      applyFilters({ sort: next === 'title' ? 'updated' : next });
    },
    [applyFilters],
  );

  const focusSearch = useCallback((): void => {
    const element = document.querySelector<HTMLElement>(
      '[data-testid="pm-search-input"] input, [data-testid="pm-search-input"]',
    );
    element?.focus();
  }, []);

  /** FR-62：顶栏实际高度（编辑器浮层从这里往下铺；不写死 64px，跟随窗口/字号变化） */
  const [headerHeight, setHeaderHeight] = useState(64);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.pm-shell-header');
    if (header === null) return undefined;
    const update = (): void => setHeaderHeight(Math.round(header.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const closeEditor = useCallback((): void => {
    // 草稿直接丢弃：**不碰服务端**（FR-45）
    setIsNew(false);
    setEditing(null);
    setEditorOpen(false);
    setEditorFullscreen(false);
    setView('list');
  }, []);

  const openEditor = useCallback(
    async (id: number, origin: 'detail' | 'list' = 'list'): Promise<void> => {
      try {
        // 走 GET /api/prompts/:id：按 FR-19 记一次 session 取用，并拿到最新 use_count
        const prompt = await api.getPrompt(id);
        setEditing(prompt);
        setIsNew(false);
        setEditorOrigin(origin);
        if (isMobile) setEditorOpen(true);
        else setView('editor');
      } catch (error) {
        notify(error);
      }
    },
    [isMobile, notify],
  );

  /** FR-55：从编辑器回到"详情"（分栏右栏 / 详情弹层），而不是回列表。 */
  const backToDetail = useCallback((): void => {
    const target = editing;
    setEditorOpen(false);
    setEditorFullscreen(false);
    setView('list');
    if (target === null || target.id === 0) return;
    if (isMobile) setDetail(target);
    else setSelected(target);
  }, [editing, isMobile]);

  const openDetail = useCallback(
    async (prompt: Prompt): Promise<void> => {
      try {
        // 打开详情 = FR-19 的一次 session 取用
        const fresh = await api.getPrompt(prompt.id);
        if (!isMobile && viewMode === 'split') setSelected(fresh);
        else setDetail(fresh);
      } catch (error) {
        notify(error);
      }
    },
    [isMobile, notify, viewMode],
  );

  /** FR-51：点 logo = 回主页 —— 视图回分栏、清搜索与全部筛选、取消选中、回到列表顶部。 */
  const goHome = useCallback((): void => {
    setViewMode('split');
    setFilters({ q: '', folderId: null, tag: null, favorite: false, sort: 'updated', page: 1, pageSize: PAGE_SIZE });
    setSelected(null);
    setDetail(null);
    setIsNew(false);
    setEditing(null);
    setEditorOpen(false);
    setEditorFullscreen(false);
    setView('list');
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.querySelector<HTMLElement>('.pm-split-list')?.scrollTo({ top: 0 });
  }, []);

  /** FR-57：一键收藏 / 取消收藏（走 PUT；见 PROGRESS 记录的"会生成一个版本"的既有语义）。 */
  const toggleFavorite = useCallback(
    async (prompt: Prompt): Promise<void> => {
      const next = !prompt.favorite;
      try {
        const updated = await api.updatePrompt(prompt.id, { favorite: next });
        message.success(next ? '已收藏' : '已取消收藏');
        setData((prev) =>
          prev === null
            ? prev
            : { ...prev, items: prev.items.map((item) => (item.id === updated.id ? { ...item, favorite: updated.favorite } : item)) },
        );
        setSelected((prev) => (prev !== null && prev.id === updated.id ? { ...prev, favorite: updated.favorite } : prev));
        setDetail((prev) => (prev !== null && prev.id === updated.id ? { ...prev, favorite: updated.favorite } : prev));
        setEditing((prev) => (prev !== null && prev.id === updated.id ? { ...prev, favorite: updated.favorite } : prev));
      } catch (error) {
        notify(error);
      }
    },
    [message, notify],
  );

  /**
   * FR-78：详情页内联改「文件夹 / 标签」—— 复用既有 `PUT /api/prompts/:id`（与编辑器**同源**），
   * 成功后同步所有本地视图（列表 / 分栏右栏 / 详情弹层 / 编辑器）并刷新侧栏计数。
   */
  const patchPromptMeta = useCallback(
    async (prompt: Prompt, patch: PromptMetaPatch): Promise<void> => {
      try {
        const updated = await api.updatePrompt(prompt.id, patch);
        message.success(patch.folder_id !== undefined ? '已更新文件夹' : '已更新标签');
        const merge = (prev: Prompt | null): Prompt | null =>
          prev !== null && prev.id === updated.id
            ? {
                ...prev,
                folder_id: updated.folder_id,
                tags: updated.tags,
                version_no: updated.version_no,
                updated_at: updated.updated_at,
              }
            : prev;
        setSelected(merge);
        setDetail(merge);
        setEditing(merge);
        setData((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                items: prev.items.map((item) =>
                  item.id === updated.id
                    ? {
                        ...item,
                        folder_id: updated.folder_id,
                        tags: updated.tags,
                        version_no: updated.version_no,
                        updated_at: updated.updated_at,
                      }
                    : item,
                ),
              },
        );
        refresh();
      } catch (error) {
        notify(error);
      }
    },
    [message, notify, refresh],
  );

  /**
   * FR-77：表格批量动作（**一次操作只发 1 个请求** → `POST /api/prompts/bulk`，服务端整批一个事务）。
   * 返回是否成功，供 UseView 决定是否清空选中（失败保留选中以便重试）。
   */
  const bulkAction = useCallback(
    async (action: 'favorite' | 'move' | 'delete', ids: number[], folderId?: number | null): Promise<boolean> => {
      try {
        const result = await api.bulkPrompts(action, ids, folderId);
        const label =
          action === 'favorite'
            ? `已收藏 ${String(result.affected)} 条`
            : action === 'move'
              ? `已移动 ${String(result.affected)} 条`
              : `已删除 ${String(result.affected)} 条`;
        message.success(label);
        if (action === 'delete') {
          // 被删条目若正被详情 / 编辑器持有，清掉，避免继续指向已不存在的记录
          const drop = (prev: Prompt | null): Prompt | null => (prev !== null && ids.includes(prev.id) ? null : prev);
          setSelected(drop);
          setDetail(drop);
          setEditing(drop);
        }
        refresh();
        return true;
      } catch (error) {
        notify(error);
        return false;
      }
    },
    [message, notify, refresh],
  );

  /** 分栏中栏的展示顺序（与 UseView 共用 orderPrompts，保证"第一条"一致）。 */
  const orderedItems = useMemo(
    () => orderPrompts(data?.items ?? [], useSort, pinFavorites),
    [data, useSort, pinFavorites],
  );

  /** 分栏默认选中第一条（不额外发请求 → 不记取用；用户点选才走 openDetail 记取用）。 */
  useEffect(() => {
    if (isMobile || viewMode !== 'split') return;
    if (orderedItems.length === 0) {
      setSelected(null);
      return;
    }
    if (selected === null || !orderedItems.some((prompt) => prompt.id === selected.id)) {
      setSelected(orderedItems[0] ?? null);
    }
  }, [isMobile, orderedItems, selected, viewMode]);

  /**
   * `＋新建`：只把**内存草稿**放进编辑器（FR-45）。
   * ⚠️ 这里**不得**调用 `api.createPrompt`——未点「保存」不能有任何服务端记录。
   */
  const createPrompt = useCallback((): void => {
    setEditing({ ...EMPTY_DRAFT });
    setIsNew(true);
    setEditorOrigin('new');
    if (isMobile) setEditorOpen(true);
    else setView('editor');
  }, [isMobile]);

  const removePrompt = useCallback(
    async (prompt: Prompt): Promise<void> => {
      try {
        await api.deletePrompt(prompt.id);
        message.success('已删除');
        if (editing?.id === prompt.id) closeEditor();
        refresh();
      } catch (error) {
        notify(error);
      }
    },
    [closeEditor, editing?.id, message, notify, refresh],
  );

  const logout = useCallback((): void => {
    void (async () => {
      try {
        await api.logout();
      } catch {
        // 登出失败也要回登录页（本地状态优先）
      }
      onSignedOut();
    })();
  }, [onSignedOut]);

  const overlayOpen =
    copier.varsPrompt !== null || aboutOpen || importExportOpen || usageOpen || tokensOpen;

  // 快捷键（FR-41c）：/ 聚焦搜索 · Ctrl/Cmd+K 聚焦 · Esc 关详情/关闭编辑器 · ↑↓ 选择 · Enter 复制
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true);

      if (event.key === 'Escape') {
        // FR-62 退出路径 ②：全屏时 Esc **只退全屏**——不关编辑器、不丢未保存内容、不触发"返回"
        if (editorFullscreen) {
          setEditorFullscreen(false);
          return;
        }
        if (detail !== null) {
          setDetail(null);
          return;
        }
        if (overlayOpen) return;
        if (view === 'editor' || editorOpen) closeEditor();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setView('list');
        window.setTimeout(focusSearch, 60);
        return;
      }
      if (typing) return;
      if (event.key === '/') {
        event.preventDefault();
        if (view !== 'list') setView('list');
        window.setTimeout(focusSearch, 60);
        return;
      }
      if (view !== 'list') return;
      const list = data?.items ?? [];
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(list.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        const targetPrompt = list[activeIndex];
        if (targetPrompt !== undefined) void copier.copyPrompt(targetPrompt);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, closeEditor, copier, data, detail, editorFullscreen, editorOpen, focusSearch, overlayOpen, view]);

  const folderName = (id: number | null): string => {
    if (id === null) return '未归类';
    return folders.find((folder) => folder.id === id)?.name ?? '未归类';
  };

  /** 编辑器左栏：可搜索的 prompt 列表（FR-40b「左（列表）」）。 */
  const editorList = (
    <Card
      size="small"
      title={
        <Flex align="center" gap={6}>
          <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={closeEditor} aria-label="返回列表" />
          <Typography.Text style={{ fontSize: 12, fontWeight: 600 }}>Prompt 列表</Typography.Text>
        </Flex>
      }
      styles={{ body: { padding: 8 } }}
    >
      <Input.Search
        size="small"
        allowClear
        defaultValue={filters.q}
        placeholder="搜索"
        style={{ marginBottom: 8 }}
        onSearch={(value) => applyFilters({ q: value })}
      />
      <List
        size="small"
        dataSource={data?.items ?? []}
        locale={{ emptyText: '没有匹配的 prompt' }}
        renderItem={(prompt) => (
          <List.Item
            onClick={() => void openEditor(prompt.id)}
            style={{
              cursor: 'pointer',
              padding: '8px 6px',
              borderRadius: 6,
              background: prompt.id === editing?.id ? token.controlItemBgActive : undefined,
            }}
          >
            <Flex vertical gap={2} style={{ width: '100%', minWidth: 0 }}>
              <Flex align="center" gap={6}>
                {prompt.favorite ? (
                  <StarFilled style={{ color: token.colorPrimary, fontSize: 11 }} />
                ) : (
                  <StarOutlined style={{ color: token.colorTextQuaternary, fontSize: 11 }} />
                )}
                <Typography.Text ellipsis style={{ fontSize: 12.5 }}>
                  {prompt.title === '' ? '(无标题)' : prompt.title}
                </Typography.Text>
              </Flex>
              <Flex gap={8} style={{ fontSize: 11, color: token.colorTextTertiary }}>
                <span>{folderName(prompt.folder_id)}</span>
                <span className="pm-mono">v{prompt.version_no}</span>
                <span className="pm-mono">{formatListDateTime(prompt.updated_at)}</span>
              </Flex>
            </Flex>
          </List.Item>
        )}
      />
    </Card>
  );

  const sidebar = () => (
    <SidebarPanel
      folders={folders}
      folderCounts={folderCounts}
      tags={tags}
      selectedFolderId={filters.folderId}
      selectedTag={filters.tag}
      onSelectFolder={(id) => applyFilters({ folderId: id })}
      onSelectTag={(name) => applyFilters({ tag: name })}
      onChanged={refresh}
      onUnauthorized={handleUnauthorized}
      onReorderFolders={(parentId, ids) => void reorderFolders(parentId, ids)}
    />
  );

  const editorNode =
    editing === null ? (
      <Card>
        <Typography.Text>没有选中的 prompt。</Typography.Text>
      </Card>
    ) : (
      <Suspense fallback={<LazyFallback label="正在加载编辑器…" />}>
        <LazyPromptEditor
          prompt={editing}
          isNew={isNew}
          origin={editorOrigin}
          onToggleFavorite={(prompt) => void toggleFavorite(prompt)}
          folders={folders}
          tags={tags}
          isMobile={isMobile}
          left={isMobile ? undefined : editorList}
          onClose={closeEditor}
          onBackToDetail={backToDetail}
          onSaved={(prompt) => {
            setIsNew(false);
            setEditing(prompt);
            refresh();
          }}
          onDeleted={() => {
            closeEditor();
            refresh();
          }}
          onCopyText={(text, label) => void copier.copyText(text, label)}
          onUnauthorized={handleUnauthorized}
          fullscreen={editorFullscreen}
          onToggleFullscreen={() => setEditorFullscreen((value) => !value)}
        />
      </Suspense>
    );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <AppHeader
        themeMode={themeMode}
        onCycleTheme={onCycleTheme}
        isMobile={isMobile}
        showFilters={isMobile || isNarrow}
        onOpenFilters={() => setSiderOpen(true)}
        onCreate={createPrompt}
        onOpenUsage={() => setUsageOpen(true)}
        onOpenTokens={() => setTokensOpen(true)}
        onOpenImportExport={() => setImportExportOpen(true)}
        onOpenSettings={() => setAboutOpen(true)}
        onOpenPassword={() => setPasswordOpen(true)}
        onLogout={logout}
        onGoHome={goHome}
      />

      {/*
        列表壳**始终挂载**（不再因进入编辑器而卸载）：编辑器是覆盖其上的浮层，
        这样全屏时 `pm-sidebar` / `pm-split-list` 仍在 DOM 里，可由 CSS 隐藏 ⇒ `offsetParent === null`（AC-62 ②）；
        退出全屏后三者自然恢复（AC-62 ④）。
      */}
      <Layout hasSider={!isMobile && !isNarrow} style={{ background: 'transparent' }}>
        {!isMobile && !isNarrow && (
          <Layout.Sider width={248} style={{ background: 'transparent', padding: '16px 0 0 16px' }}>
            <div style={{ position: 'sticky', top: 16 }}>{sidebar()}</div>
          </Layout.Sider>
        )}
        <Layout.Content style={{ padding: 16, width: '100%', minWidth: 0 }} aria-label="拿来就用">
          <UseView
            data={data}
            loading={loading}
            error={listError}
            onRetry={() => void loadList()}
            filters={filters}
            onFiltersChange={applyFilters}
            sort={useSort}
            onSortChange={changeSort}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            pinFavorites={pinFavorites}
            onPinFavoritesChange={setPinFavorites}
            folders={folders}
            tags={tags}
            isMobile={isMobile}
            busyId={copier.busyId}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            onCopy={(prompt) => void copier.copyPrompt(prompt)}
            onOpenDetail={(prompt) => void openDetail(prompt)}
            onEdit={(prompt) => void openEditor(prompt.id, 'list')}
            onEditDetail={(prompt) => void openEditor(prompt.id, 'detail')}
            onDelete={(prompt) => void removePrompt(prompt)}
            onToggleFavorite={(prompt) => void toggleFavorite(prompt)}
            onMetaChange={(prompt, patch) => void patchPromptMeta(prompt, patch)}
            onBulk={bulkAction}
            onReorder={(ids) => void reorderPrompts(ids)}
            selected={selected}
            onSelect={(prompt) => void openDetail(prompt)}
            onReload={(prompt) => {
              void (async () => {
                try {
                  const fresh = await api.getPrompt(prompt.id);
                  setSelected(fresh);
                } catch (error) {
                  notify(error);
                }
                refresh();
              })();
            }}
            onUnauthorized={handleUnauthorized}
          />
        </Layout.Content>
      </Layout>

      {view === 'editor' && !isMobile && (
        <div
          className="pm-editor-overlay"
          data-testid="pm-editor-overlay"
          style={{ '--pm-overlay-top': `${String(headerHeight)}px` } as CSSProperties}
        >
          {editorNode}
        </div>
      )}

      {isMobile && (
        <Drawer
          open={editorOpen}
          placement="right"
          width="100%"
          onClose={closeEditor}
          /* FR-62：全屏时 Esc 归"退出全屏"管，抽屉不得抢走 Esc 去关编辑器 */
          keyboard={!editorFullscreen}
          closable={!editorFullscreen}
          styles={{ body: { padding: editorFullscreen ? 0 : 12 } }}
          title={isNew ? '新建 prompt' : '编辑'}
        >
          {editorNode}
        </Drawer>
      )}

      <Drawer
        open={siderOpen}
        onClose={() => setSiderOpen(false)}
        placement="left"
        width={300}
        title="筛选"
        styles={{ body: { padding: 8 } }}
      >
        {sidebar()}
      </Drawer>


      {/* 重组件按需挂载 + Suspense 兜底（FR-61）：关闭即卸载，绝不在首屏触发 import */}
      {importExportOpen && (
        <Suspense fallback={null}>
          <LazyImportExportModal open onClose={() => setImportExportOpen(false)} onImported={refresh} />
        </Suspense>
      )}
      {usageOpen && (
        <Suspense fallback={null}>
          <LazyUsageDrawer open onClose={() => setUsageOpen(false)} onUnauthorized={handleUnauthorized} />
        </Suspense>
      )}
      {tokensOpen && (
        <Suspense fallback={null}>
          <LazyTokenDrawer open onClose={() => setTokensOpen(false)} onUnauthorized={handleUnauthorized} />
        </Suspense>
      )}
      {aboutOpen && (
        <Suspense fallback={null}>
          <LazyAboutModal open onClose={() => setAboutOpen(false)} />
        </Suspense>
      )}
      {passwordOpen && (
        <Suspense fallback={null}>
          <LazyPasswordModal open onClose={() => setPasswordOpen(false)} />
        </Suspense>
      )}
      <PromptDetail
        prompt={detail}
        isMobile={isMobile}
        busy={copier.busyId !== null}
        onClose={() => setDetail(null)}
        onCopy={(prompt) => void copier.copyPrompt(prompt)}
        onDelete={(prompt) => {
          setDetail(null);
          void removePrompt(prompt);
        }}
        onEdit={(prompt) => {
          setDetail(null);
          void openEditor(prompt.id, 'detail');
        }}
        onToggleFavorite={(prompt) => void toggleFavorite(prompt)}
        folders={folders}
        tags={tags}
        onMetaChange={(prompt, patch) => void patchPromptMeta(prompt, patch)}
        onReload={(prompt) => {
          void (async () => {
            try {
              setDetail(await api.getPrompt(prompt.id));
            } catch (error) {
              notify(error);
            }
            refresh();
          })();
        }}
        onUnauthorized={handleUnauthorized}
      />
      {copier.varsPrompt !== null && (
        <Suspense fallback={null}>
          <LazyVarsDialog
            prompt={copier.varsPrompt}
            busy={copier.busyId !== null}
            onCancel={copier.closeVars}
            onConfirm={(prompt, values) => void copier.copyRendered(prompt, values)}
          />
        </Suspense>
      )}
    </Layout>
  );
}
