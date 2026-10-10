/**
 * 界面用的纯逻辑（无 React / 无 DOM 依赖，可被 node:test 直接单测）：
 * 列表 query 组装、文件夹树、导入文件解析（FR-11b 的 merge 计数）、diff 行分类。
 */

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

export interface PromptListQueryParams {
  q?: string;
  folderId?: number | null;
  tag?: string;
  favorite?: boolean;
  sort?: 'updated' | 'recent_used' | 'custom';
  limit?: number;
  offset?: number;
}

/**
 * 组装 `GET /api/prompts` 的查询串（BRIEF §6.1 的 q/folder_id/tag/favorite/sort/limit/offset）。
 * 空串/纯空白不发参数；`sort=updated` 是默认值，不显式发；`favorite=false` 是有效筛选，必须发。
 */
export function buildPromptListQuery(params: PromptListQueryParams): string {
  const search = new URLSearchParams();
  const q = params.q?.trim();
  if (q !== undefined && q !== '') search.set('q', q);
  if (params.folderId !== undefined && params.folderId !== null) {
    search.set('folder_id', String(params.folderId));
  }
  const tag = params.tag?.trim();
  if (tag !== undefined && tag !== '') search.set('tag', tag);
  if (params.favorite !== undefined) search.set('favorite', String(params.favorite));
  if (params.sort === 'recent_used' || params.sort === 'custom') search.set('sort', params.sort);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
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

/** BRIEF FR-11b 要求的 replace 二次确认文案（逐字，界面与测试共用同一常量） */
export const REPLACE_WARNING = '将清空现有全部 prompt / 文件夹 / 标签 / 版本历史';

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

export interface ImportCounts {
  folders: number;
  tags: number;
  prompts: number;
}

export interface ImportFileShape {
  app: string;
  schema_version: number;
  folders?: unknown;
  tags?: unknown;
  prompts?: unknown;
}

export type ImportAnalysis =
  | { ok: true; counts: ImportCounts; file: ImportFileShape }
  | { ok: false; error: string };

function readArray(file: ImportFileShape, key: 'folders' | 'tags' | 'prompts'): unknown[] | string {
  const value = file[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) return `导出文件的 ${key} 必须是数组`;
  return value;
}

/**
 * 导出文件的身份（BRIEF §6.4）：`app` 契约值固定为全小写 `promptmanager`，**不许改**——
 * 改了会破坏已有导出文件的兼容（FR-60 白名单②）。这里给它一个唯一可信来源，展示层只读它做比对，
 * 避免契约值散落成裸字面量。
 */
export const SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const;

/**
 * 解析用户选中的导出 JSON，供导入界面显示"将新增多少条"（FR-11b 的 merge 计数）。
 * 只做**预览级**校验（与服务端 `POST /api/import` 的严格校验互为补充，不重复实现字段级规则）：
 * 坏 JSON / `app` 契约值不符 / schema_version 过高 / 三个顶层字段不是数组 → 拒绝并给出可读原因。
 */
export function analyzeImportFile(text: string): ImportAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '导出文件必须是 JSON 对象' };
  }
  const file = parsed as ImportFileShape;
  if (file.app !== SUPPORTED_EXPORT_FILE.app) {
    return { ok: false, error: `不是 PromptManager 的导出文件（app=${String(file.app)}）` };
  }
  if (
    typeof file.schema_version !== 'number' ||
    !Number.isInteger(file.schema_version) ||
    file.schema_version > SUPPORTED_EXPORT_FILE.schema_version
  ) {
    return {
      ok: false,
      error: `不支持的 schema_version=${String(file.schema_version)}（本服务支持 ≤ ${String(SUPPORTED_EXPORT_FILE.schema_version)}）`,
    };
  }
  const folders = readArray(file, 'folders');
  if (typeof folders === 'string') return { ok: false, error: folders };
  const tags = readArray(file, 'tags');
  if (typeof tags === 'string') return { ok: false, error: tags };
  const prompts = readArray(file, 'prompts');
  if (typeof prompts === 'string') return { ok: false, error: prompts };

  return {
    ok: true,
    file,
    counts: { folders: folders.length, tags: tags.length, prompts: prompts.length },
  };
}

/**
 * 服务端 `invalid_import` 的 `details` → 界面可读的逐条说明。
 * 前端**不复刻校验**（BRIEF FR-10b：校验在后端做死），只把后端给出的原因如实显示出来，
 * 避免出现"本地预览看着没问题、提交后被后端拒绝却只说 invalid_import"的不一致。
 */
export function formatImportDetails(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details.map((item) => {
    if (typeof item !== 'object' || item === null) return String(item);
    const { path, message } = item as { path?: unknown; message?: unknown };
    const where = typeof path === 'string' && path !== '' ? path : 'data';
    const what = typeof message === 'string' ? message : JSON.stringify(item);
    return `${where}：${what}`;
  });
}

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

/** ISO 8601 UTC → 本地可读时间（纯展示，不做日期运算；`Intl` 由运行时提供）。 */
export function formatDateTime(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** 列表里的紧凑时间（省掉年份，给表格/手机留出宽度）。 */
export function formatListDateTime(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/* ============================================================
   阶段 11：使用优先（复制 / 变量预览 / 卡片摘要）的纯逻辑
   ============================================================ */

/**
 * 占位符正则：与服务端 `src/services/variables.ts` 的 `PLACEHOLDER` **逐字一致**。
 * 契约（BRIEF §6.5 / FR-126）：`{{` + 可选空白 + 名字(1–64，Unicode 字母/数字/_/-) + 可选空白 + `}}`；
 * 默认值写法 `{{name | default(默认值)}}`（竖线也可写成转义形式 `\|`）；
 * `\{{name}}` 是转义；`{{name:示例}}` 因 `:` 不在名字字符集内而**不是**变量（FR-41e ⑦）。
 * 不认识的写法（`| upper`、`| default` 无括号…）一律按**字面文本**处理。
 */
const PM_PLACEHOLDER = /(\\?)\{\{\s*([\p{L}\p{N}_-]{1,64})\s*(?:\\?\|\s*default\s*\(([\s\S]*?)\)\s*)?\}\}/gu;

/** `default(...)` 的原始内容 → 字面默认值；`undefined` = 没写默认值（服务端同规则）。 */
function parseDefaultText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === "'" || first === '"') && first === trimmed[trimmed.length - 1]) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export interface VariableScan {
  variables: string[];
  defaults: Record<string, string>;
}

/** 扫描若干段文本：变量名单 + 默认值表（默认值取**首次出现**，保证全篇一致）——服务端同规则。 */
export function scanVariablesLocal(...texts: Array<string | undefined>): VariableScan {
  const variables: string[] = [];
  const defaults: Record<string, string> = {};
  const seen = new Set<string>();
  for (const text of texts) {
    if (text === undefined || text === '') continue;
    for (const match of text.matchAll(PM_PLACEHOLDER)) {
      if (match[1] === '\\') continue;
      const name = match[2];
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      variables.push(name);
      const parsed = parseDefaultText(match[3]);
      if (parsed !== undefined) defaults[name] = parsed;
    }
  }
  return { variables, defaults };
}

/** 从若干段文本里按**首次出现顺序**提取变量名（去重、跳过转义的）——服务端同规则。 */
export function extractVariablesLocal(...texts: Array<string | undefined>): string[] {
  return scanVariablesLocal(...texts).variables;
}

/** 这条 prompt 是否含变量（决定"复制"是直接复制还是先弹填值对话框）。 */
export function hasVariables(...texts: Array<string | undefined>): boolean {
  return extractVariablesLocal(...texts).length > 0;
}

/**
 * 填变量对话框的**实时预览**：按服务端 `renderVariables` 的规则做替换
 * （提供了字符串值 → 替换；转义 → 去掉反斜杠、其余原样；没填但有默认值 → 用默认值；
 * 没填且无默认值 → **原样保留**）。
 * 这只是"对占位符做替换"，不是模板引擎（无表达式/循环/函数）。
 * ⚠️ 最终复制仍以服务端 `POST /api/prompts/:id/render` 的返回为准；两者一致性由
 * `tests/variables-preview-parity.test.ts` 逐字符对照。
 */
export function previewRender(text: string, values: Record<string, string>): string {
  const { defaults } = scanVariablesLocal(text);
  return text.replace(PM_PLACEHOLDER, (whole: string, escape: string, name: string) => {
    if (escape === '\\') return whole.slice(1);
    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (typeof value === 'string') return value;
    const fallback = defaults[name];
    if (fallback !== undefined) return fallback;
    return whole;
  });
}

/**
 * 表单原始值 → `POST /api/prompts/:id/render` 的 `values`：**只保留已填写的变量**。
 *
 * BRIEF §6.5 / FR-41e 第 2 条（v15，2026-09-19 用户决定「没填写的变量按照原样输出」）：
 * 服务端对**未提供值**的变量原样保留 `{{name}}` 并列入 `missing`；一旦前端把空串也传下去，
 * 服务端会把它当"提供了值"而替换成空——`{{项目}}` 就被静默吞掉（旧缺陷）。
 * 因此"未填"必须在**进入 values 之前**就被剔除，空串绝不外发。
 *
 * 变量名一律以服务端 `GET /api/prompts/:id/variables` 为准（单一真相源），
 * 这里只做"按服务端给的名单筛掉未填项"，不重新解析 prompt。
 */
export function filledValues(variables: string[], raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of variables) {
    const value = raw[name];
    if (typeof value === 'string' && value !== '') out[name] = value;
  }
  return out;
}

// ─────────────────── FR-127 / FR-128：变量记忆（localStorage，键 pm-vars:<id>） ───────────────────

/**
 * 记忆的**存储介质不变**（D-59 ⑦）：变量值仍只存在浏览器 `localStorage`，键 `pm-vars:<id>`；
 * 本次只加"要不要记"的控制（开关在服务端，见 FR-127）。把这几个函数从组件里提出来，
 * 是为了让「写入 / 读取 / 删除」能在 node:test 里用内存版存储机械验证，且全站只有一份实现。
 */
export const VARS_STORAGE_PREFIX = 'pm-vars:';

/** 只用到这三个方法（浏览器 `Storage` 天然满足；测试传内存版）。 */
export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function varsStorageKey(promptId: number): string {
  return `${VARS_STORAGE_PREFIX}${String(promptId)}`;
}

/** 取存储：显式传入（测试的内存版）→ 否则浏览器 localStorage；都没有 ⇒ null（静默降级）。 */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readRememberedVars(promptId: number, storage?: StorageLike): Record<string, string> {
  const store = resolveStorage(storage);
  if (store === null) return {};
  try {
    const raw = store.getItem(varsStorageKey(promptId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRememberedVars(promptId: number, values: Record<string, string>, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  try {
    store.setItem(varsStorageKey(promptId), JSON.stringify(values));
  } catch {
    /* 隐私模式等场景写不进就算了，不影响复制 */
  }
}

/** FR-127 / D-59 ⑤：取消勾选（或点「清空」）⇒ 把该提示词已存的记忆**删掉**，避免旧值"诈尸"。 */
export function removeRememberedVars(promptId: number, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (store === null) return;
  try {
    store.removeItem(varsStorageKey(promptId));
  } catch {
    /* 同上：删不掉也不影响复制 */
  }
}

/** FR-127：弹窗标题 —— 记住时沿用原文案；**不记住时不含「（自动记忆）」**。 */
export function varsDialogTitle(remember: boolean): string {
  return remember ? '请填写变量值（自动记忆）' : '请填写变量值';
}

/**
 * 「未填」名单（FR-41e / FR-126 / FR-128 ⑯）：**不在** `values` 里 **且** 没有默认值的变量。
 * `values` 由 `filledValues` 产出（已剔除空串）⇒ "不在里面" == 未填；有默认值的不算未填。
 */
export function missingVariables(
  variables: string[],
  values: Record<string, string>,
  defaults: Record<string, string>,
): string[] {
  // 空串与"键不存在"一样算未填：界面上输入框为空 == 没填（服务端只收到 `filledValues` 剔空后的
  // 值，因此这里把空串也当未填，与服务端 `/render` 的 `missing` 口径一致）。
  return variables.filter((name) => (values[name] ?? '') === '' && defaults[name] === undefined);
}

/** FR-128 ⑰：有没有**非空**的已填值（全空 ⇒ 「清空」按钮置灰）。 */
export function hasAnyFilled(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value !== '');
}

/**
 * FR-127 / AC-123 ⑧：把「这次打开弹窗该往表单里写什么」算成一张**完整的**表。
 *
 * ⚠️ 必须给**每个变量**都写一个值（没记忆的写空串），不能只写「有记忆的那几个」：
 * antd 的 `form.setFieldsValue()` **不会清空未提供的字段**，只传有记忆的部分会让上一次打开
 * 留在 Form 里的字原样显示 —— 用户看到的就是"不记住却还是被预填了"，直接违反 FR-127。
 *
 * 提成纯函数是为了让这条口径**能被 node:test 机械验证**（组件里的 antd 表单跑不进 node:test）。
 */
export function varsFormValues(variables: string[], initial: Record<string, string>): Record<string, string> {
  const formValues: Record<string, string> = {};
  for (const name of variables) formValues[name] = initial[name] ?? '';
  return formValues;
}

/**
 * 列表展示顺序（FR-41b / FR-46）：可选「收藏置顶」（客户端，当前页内）+ 「标题」排序
 * （当前页内；接口支持 updated / recent_used / custom）。`custom`（FR-70）**保持服务端顺序**
 * （服务端已按 `sort_order, id` 升序返回），客户端不再重排。分栏中栏、表格、卡片共用这一个纯函数，
 * 保证"中栏第一条"与"自动选中的右栏条目"一致。
 */
export function orderPrompts<T extends { title: string; favorite: boolean }>(
  items: T[],
  sort: 'updated' | 'recent_used' | 'custom' | 'title',
  pinFavorites: boolean,
): T[] {
  const list = [...items];
  if (sort === 'title') {
    list.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  }
  if (!pinFavorites) return list;
  return [...list.filter((p) => p.favorite), ...list.filter((p) => !p.favorite)];
}

/** 卡片摘要：去掉 markdown 记号、折叠空白、超长截断（列表里"扫一眼就知道是什么"）。 */
export function promptExcerpt(text: string, maxLength = 160): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '· ')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= maxLength) return flat;
  return `${flat.slice(0, maxLength)}…`;
}

/* ============================================================
   视图档位开关（FR-92 / D-34）：顺序与默认值**只在这里定义一处**
   ============================================================ */

/** 档位取值集合（`localStorage['pm-view-mode']` 的取值集合不变，仍是这三个；不新增第四个档位）。 */
export const VIEW_MODE_VALUES = ['split', 'table', 'card'] as const;
export type ViewModeValue = (typeof VIEW_MODE_VALUES)[number];

const VIEW_MODE_LABELS: Record<ViewModeValue, string> = { split: '分栏', table: '表格', card: '卡片' };

/**
 * 档位开关的**选项顺序**（FR-92 ①，用户 2026-09-21）：
 * - **桌面（≥768px）** = `分栏 / 表格 / 卡片` —— 用户早先指定的顺序，**不得改**；
 * - **移动（<768px）** = `卡片 / 表格 / 分栏` —— 倒序；理由是"移动端卡片效果更好"。
 *
 * 顺序集中在这一个函数里（组件与单测都取它），避免"组件一处、断言一处"再次漂移。
 */
export function viewModeOptions(isMobile: boolean): Array<{ value: ViewModeValue; label: string }> {
  const order: ViewModeValue[] = isMobile ? ['card', 'table', 'split'] : ['split', 'table', 'card'];
  return order.map((value) => ({ value, label: VIEW_MODE_LABELS[value] }));
}

/**
 * 首次进入的**默认档位**（FR-92 ② / D-34 ②）：移动端 = `card`（卡片），桌面 = `split`（分栏）。
 * 只在 `localStorage` **没有**该键时生效 —— 用户已有的本地偏好一律不覆盖。
 */
export function defaultViewMode(isMobile: boolean): ViewModeValue {
  return isMobile ? 'card' : 'split';
}

/**
 * 令牌名称的**显示截断**（FR-99 ②，用户原话「名称最多显示前 20 个字符超过用省略号」）。
 *
 * 按**字符**（`Array.from`，不是 UTF-16 code unit）截断 —— 否则 emoji / 生僻字会被从中间劈开。
 * ⚠️ 只影响**显示**：完整名称仍放在单元格 `title` 里（悬停可看全），**不写回服务端**。
 */
export const TOKEN_NAME_DISPLAY_LIMIT = 20;

export function truncateTokenName(name: string, limit: number = TOKEN_NAME_DISPLAY_LIMIT): string {
  const chars = Array.from(name);
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : name;
}

/** 令牌掩码的形状（前 5 + `...` + 后 4），也是 AC-101 ③ 的判据。 */
export const TOKEN_MASK_PREFIX = 5;
export const TOKEN_MASK_SUFFIX = 4;

/**
 * 令牌**脱敏展示**（FR-99 ④，用户原话「token 显示前 5 位 + 后 4 位，中间用省略号」，例 `pm_96...7LU8`）。
 *
 * 输入是**抽屉打开时预取到内存的明文**（FR-95 的既有纪律：明文只在内存，不落任何持久存储/日志）。
 * 太短的值（不足 10 个字符）一律只显示 `…`，避免"脱敏"反而把整串露出来。
 */
export function maskToken(plaintext: string): string {
  const chars = Array.from(plaintext);
  if (chars.length < TOKEN_MASK_PREFIX + TOKEN_MASK_SUFFIX + 2) return '…';
  return `${chars.slice(0, TOKEN_MASK_PREFIX).join('')}...${chars.slice(-TOKEN_MASK_SUFFIX).join('')}`;
}
