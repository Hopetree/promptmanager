import { App as AntdApp, Button, Card, Drawer, Flex, Grid, Input, Layout, List, Typography, theme } from 'antd';
import { ArrowLeftOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import type { CSSProperties } from 'react';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api';
import { defaultViewMode, formatListDateTime, orderPrompts } from '../pure';
import type { Folder, Prompt, PromptListFilters, PromptListResponse, Tag } from '../types';
import type { ThemeMode } from '../theme-mode';
import {
  LazyAboutModal,
  LazyImportExportModal,
  LazyPasswordModal,
  LazyPromptEditor,
  LazySyncModal,
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
  // 新草稿默认「记住变量值」= 服务端默认（FR-127；`POST` 省略该字段时也是 true）
  remember_variables: true,
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
  // v19（FR-46）：默认 = 分栏；档位 split/table/card（旧值 `list` 自然回退到 split）。
  // FR-92 ② / D-34 ②：**移动端首次进入默认卡片**（桌面仍分栏）；已有本地偏好一律不覆盖（readPref 先读存储）。
  const [viewMode, setViewMode] = useState<UseViewMode>(() =>
    readPref<UseViewMode>('pm-view-mode', defaultViewMode(isMobile), ['split', 'table', 'card']),
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
  /**
   * FR-137：**单一数据源** —— 同一份 prompt 只存在这一处（`Map<id, Prompt>`）；
   * 列表响应只留「这一页有哪几条 / 一共几条」（`listIds` + `total`），要显示的对象一律
   * 从 `prompts` 按 id 派生（见下面的 `selected` / `detail` / `editing`），写回只有 `mergePrompts()` 一个入口。
   */
  const [prompts, setPrompts] = useState<Map<number, Prompt>>(() => new Map());
  /** `null` = 还没加载过（`UseView` 据此显示骨架） */
  const [listIds, setListIds] = useState<number[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  /**
   * FR-141：侧栏文件夹徽标上的条目数（含子文件夹 —— 与 `?folder_id=X` 的 `total` 同口径）。
   * 跟着列表响应一起来（`include=folder_counts`），不再单独对每个文件夹发一次请求。
   */
  const [folderCounts, setFolderCounts] = useState<Record<number, number>>({});
  const [tags, setTags] = useState<Tag[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  /** 编辑器里那条（只存 id；`draft` 优先 —— 未保存草稿还没进服务端） */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Prompt | null>(null);
  /** true = 编辑器里是**未保存草稿**（FR-45） */
  const [isNew, setIsNew] = useState(false);
  /** 进入编辑态的来源（FR-55：详情 → 返回详情；列表 / 新建 → 返回列表） */
  const [editorOrigin, setEditorOrigin] = useState<'detail' | 'list' | 'new'>('list');
  /** 分栏右栏（FR-46）/ 详情弹层当前选中 —— **只存 id**，对象从 `prompts` 派生 */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  /** FR-62：编辑器全屏（状态放在这里，Esc 与外壳隐藏才能统一处理） */
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [siderOpen, setSiderOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  /** FR-125：远程数据同步弹窗（阶段 59） */
  const [syncOpen, setSyncOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** FR-67：修改密码弹窗 */
  const [passwordOpen, setPasswordOpen] = useState(false);

  /** FR-137：**唯一写入口** —— 把最新对象合并进单一数据源（同 id 覆盖、位置不变）。 */
  const mergePrompts = useCallback((incoming: Prompt | Prompt[]): void => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    setPrompts((previous) => new Map([...previous, ...list.map((prompt) => [prompt.id, prompt] as const)]));
  }, []);

  /** 本地立即移除（批量删除后不必等重新拉列表）。 */
  const dropPrompts = useCallback((ids: number[]): void => {
    setPrompts((previous) => new Map([...previous].filter(([id]) => !ids.includes(id))));
    setListIds((previous) => (previous === null ? previous : previous.filter((id) => !ids.includes(id))));
  }, []);

  /** 四个展示位**全部派生**自 `prompts` —— 没有第二份对象可以不同步。 */
  const selected = selectedId === null ? null : prompts.get(selectedId) ?? null;
  const detail = detailId === null ? null : prompts.get(detailId) ?? null;
  const editing = draft ?? (editingId === null ? null : prompts.get(editingId) ?? null);

  // 填值弹窗按 id 反查 ⇒ 它不再是第 5 份副本（FR-137）
  const copier = usePromptCopy((id) => prompts.get(id) ?? null);

  /** 交给 `UseView` 的列表响应：`items` 每次渲染都从单一数据源投影出来。 */
  const data = useMemo<PromptListResponse | null>(() => {
    if (listIds === null) return null;
    const items = listIds.flatMap((id) => {
      const prompt = prompts.get(id);
      return prompt === undefined ? [] : [prompt];
    });
    return { total, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize, items };
  }, [filters.page, filters.pageSize, listIds, prompts, total]);

  const notify = useCallback(
    (error: unknown): void => {
      message.error(describeError(error));
    },
    [message],
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
        // FR-141：顺手把全部文件夹的条目数带回来（替代原先"每个文件夹各发一次请求"的 N+1）
        includeFolderCounts: true,
      });
      mergePrompts(result.items);
      setListIds(result.items.map((prompt) => prompt.id));
      setTotal(result.total);
      // 计数失败时服务端回 `null` ⇒ **保留上一次的数字**，不影响列表（FR-49 ④ 的"失败不阻塞筛选"）
      if (result.folder_counts != null) {
        setFolderCounts(Object.fromEntries(Object.entries(result.folder_counts).map(([id, n]) => [Number(id), n])));
      }
      setListError(null);
    } catch (error) {
      setListError(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [filters, mergePrompts]);

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
      const snapshot = listIds;
      // 乐观更新：当前页所有条目都在 ids 里时才本地重排（否则顺序不完整，交给服务端回包）
      const samePage = snapshot !== null && ids.length === snapshot.length && snapshot.every((id) => ids.includes(id));
      if (samePage) setListIds(ids);
      if (pinFavorites) setPinFavorites(false);
      if (useSort !== 'custom') {
        setUseSort('custom');
        applyFilters({ sort: 'custom' });
        message.info('已切换为自定义排序');
      }
      try {
        await api.reorderPrompts(ids);
      } catch (error) {
        if (snapshot !== null) setListIds(snapshot); // 回滚
        notify(error);
      }
    },
    [applyFilters, listIds, message, notify, pinFavorites, useSort],
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
    setDraft(null);
    setEditingId(null);
    setEditorOpen(false);
    setEditorFullscreen(false);
    setView('list');
  }, []);

  const openEditor = useCallback(
    async (id: number, origin: 'detail' | 'list' = 'list'): Promise<void> => {
      try {
        // 走 GET /api/prompts/:id：按 FR-19 记一次 session 取用，并拿到最新 use_count
        const prompt = await api.getPrompt(id);
        mergePrompts(prompt);
        setDraft(null);
        setEditingId(prompt.id);
        setIsNew(false);
        setEditorOrigin(origin);
        if (isMobile) setEditorOpen(true);
        else setView('editor');
      } catch (error) {
        notify(error);
      }
    },
    [isMobile, mergePrompts, notify],
  );

  /** FR-55：从编辑器回到"详情"（分栏右栏 / 详情弹层），而不是回列表。 */
  const backToDetail = useCallback((): void => {
    const target = editing;
    setEditorOpen(false);
    setEditorFullscreen(false);
    setView('list');
    if (target === null || target.id === 0) return;
    if (isMobile) setDetailId(target.id);
    else setSelectedId(target.id);
  }, [editing, isMobile]);

  const openDetail = useCallback(
    async (prompt: Prompt): Promise<void> => {
      try {
        // 打开详情 = FR-19 的一次 session 取用
        const fresh = await api.getPrompt(prompt.id);
        mergePrompts(fresh);
        if (!isMobile && viewMode === 'split') setSelectedId(fresh.id);
        else setDetailId(fresh.id);
      } catch (error) {
        notify(error);
      }
    },
    [isMobile, mergePrompts, notify, viewMode],
  );

  /** FR-51：点 logo = 回主页 —— 视图回分栏、清搜索与全部筛选、取消选中、回到列表顶部。 */
  const goHome = useCallback((): void => {
    setViewMode('split');
    setFilters({ q: '', folderId: null, tag: null, favorite: false, sort: 'updated', page: 1, pageSize: PAGE_SIZE });
    setSelectedId(null);
    setDetailId(null);
    setIsNew(false);
    setDraft(null);
    setEditingId(null);
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
        // FR-137：只写单一数据源 —— 列表 / 分栏右栏 / 详情 / 编辑器全部派生，无需再逐个 merge
        mergePrompts(updated);
      } catch (error) {
        notify(error);
      }
    },
    [mergePrompts, message, notify],
  );

  /**
   * FR-127 / D-59 ④：填值弹窗里的勾选框改了「是否记住变量值」⇒ 写服务端同一字段，
   * 并同步所有本地视图（手法与 `toggleFavorite` 一致），这样换浏览器 / 换设备一致、
   * 且下次从列表重新打开弹窗时用的是新值（AC-123 ⑧⑪）。
   */
  const setRememberVariables = useCallback(
    async (prompt: Prompt, remember: boolean): Promise<void> => {
      try {
        const updated = await api.updatePrompt(prompt.id, { remember_variables: remember });
        mergePrompts(updated);
      } catch (error) {
        notify(error);
      }
    },
    [mergePrompts, notify],
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
        mergePrompts(updated);
        refresh();
      } catch (error) {
        notify(error);
      }
    },
    [mergePrompts, message, notify, refresh],
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
          dropPrompts(ids);
          const dropId = (prev: number | null): number | null => (prev !== null && ids.includes(prev) ? null : prev);
          setSelectedId(dropId);
          setDetailId(dropId);
          setEditingId(dropId);
          setDraft((prev) => (prev !== null && ids.includes(prev.id) ? null : prev));
        }
        refresh();
        return true;
      } catch (error) {
        notify(error);
        return false;
      }
    },
    [dropPrompts, message, notify, refresh],
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
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !orderedItems.some((prompt) => prompt.id === selectedId)) {
      setSelectedId(orderedItems[0]?.id ?? null);
    }
  }, [isMobile, orderedItems, selectedId, viewMode]);

  /**
   * `＋新建`：只把**内存草稿**放进编辑器（FR-45）。
   * ⚠️ 这里**不得**调用 `api.createPrompt`——未点「保存」不能有任何服务端记录。
   */
  const createPrompt = useCallback((): void => {
    setDraft({ ...EMPTY_DRAFT });
    setEditingId(null);
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
    copier.varsPrompt !== null || aboutOpen || importExportOpen || syncOpen || usageOpen || tokensOpen;

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
          setDetailId(null);
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
            <Flex
              vertical
              gap={2}
              style={{ width: '100%', minWidth: 0 }}
              /* 阶段 65（AC-127 B5）：渲染级测试点左栏「另一条」来验证换条目会重填表单 */
              data-testid={`pm-editor-list-item-${String(prompt.id)}`}
            >
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
            // FR-136 ②：把服务端回包写进**单一数据源** ⇒ 列表 / 分栏右栏 / 详情立刻是同一份最新数据
            setIsNew(false);
            setDraft(null);
            mergePrompts(prompt);
            setEditingId(prompt.id);
            refresh();
          }}
          onDeleted={() => {
            closeEditor();
            refresh();
          }}
          onCopyText={(text, label) => void copier.copyText(text, label)}
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
        onOpenSync={() => setSyncOpen(true)}
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
                  mergePrompts(fresh);
                } catch (error) {
                  notify(error);
                }
                refresh();
              })();
            }}
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
      {syncOpen && (
        <Suspense fallback={null}>
          {/* FR-125：远程数据同步（阶段 59）—— 每次出网都由弹窗里的按钮触发，无定时器 */}
          <LazySyncModal open onClose={() => setSyncOpen(false)} onPulled={refresh} />
        </Suspense>
      )}
      {usageOpen && (
        <Suspense fallback={null}>
          <LazyUsageDrawer open onClose={() => setUsageOpen(false)} />
        </Suspense>
      )}
      {tokensOpen && (
        <Suspense fallback={null}>
          {/* FR-106：移动端抽屉被夹到视口宽 ⇒ 把 isMobile 传进去，让它把创建表单改成竖排并让表格可横滚 */}
          <LazyTokenDrawer
            open
            onClose={() => setTokensOpen(false)}
            isMobile={isMobile}
          />
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
        onClose={() => setDetailId(null)}
        onCopy={(prompt) => void copier.copyPrompt(prompt)}
        onDelete={(prompt) => {
          setDetailId(null);
          void removePrompt(prompt);
        }}
        onEdit={(prompt) => {
          setDetailId(null);
          void openEditor(prompt.id, 'detail');
        }}
        onToggleFavorite={(prompt) => void toggleFavorite(prompt)}
        folders={folders}
        tags={tags}
        onMetaChange={(prompt, patch) => void patchPromptMeta(prompt, patch)}
        onReload={(prompt) => {
          void (async () => {
            try {
              mergePrompts(await api.getPrompt(prompt.id));
            } catch (error) {
              notify(error);
            }
            refresh();
          })();
        }}
      />
      {copier.varsPrompt !== null && (
        <Suspense fallback={null}>
          <LazyVarsDialog
            prompt={copier.varsPrompt}
            busy={copier.busyId !== null}
            onCancel={copier.closeVars}
            onConfirm={(prompt, values) => void copier.copyRendered(prompt, values)}
            onRememberChange={(prompt, remember) => void setRememberVariables(prompt, remember)}
          />
        </Suspense>
      )}
    </Layout>
  );
}
