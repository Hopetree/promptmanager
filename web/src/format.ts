/** 时间格式化、排序与摘要（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

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
