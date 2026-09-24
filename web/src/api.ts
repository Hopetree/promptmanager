/**
 * 同源 HTTP 客户端：浏览器只用 cookie 会话（`pm_sid`，HttpOnly），没有 Bearer token 的场景。
 * 一律 `credentials: 'same-origin'`（默认值，这里显式写出以表明意图）；不自建 HTTP 层、不做重试/加解密。
 */
import { buildPromptListQuery, type PromptListQueryParams } from './pure';
import type {
  CreatedToken,
  ExportFile,
  Folder,
  ImportResult,
  Prompt,
  PromptListResponse,
  PromptWritable,
  RenderResult,
  Tag,
  TokenSummary,
  UsageSummary,
  VersionSummary,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** 服务端 400 响应里的 `details`（如 `invalid_import` 的逐条原因） */
  readonly details: unknown;
  /** 服务端 400 响应里的 `message`（如 `invalid_password` 的规则说明，FR-67） */
  readonly serverMessage: string | undefined;

  constructor(status: number, code: string | undefined, message: string, details?: unknown, serverMessage?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.serverMessage = serverMessage;
  }
}

interface ErrorBody {
  error?: unknown;
  details?: unknown;
  message?: unknown;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const errorBody = (json ?? {}) as ErrorBody;
    const code = typeof errorBody.error === 'string' ? errorBody.error : undefined;
    throw new ApiError(
      response.status,
      code,
      `HTTP ${String(response.status)}${code === undefined ? '' : ` ${code}`}`,
      errorBody.details,
      typeof errorBody.message === 'string' ? errorBody.message : undefined,
    );
  }
  return json as T;
}

export const api = {
  /** 会话探测：未登录返回 null（不是异常）。 */
  async me(): Promise<{ username: string } | null> {
    try {
      return await request<{ username: string }>('GET', '/api/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },

  login: (username: string, password: string) =>
    request<{ ok: true; username: string }>('POST', '/api/login', { username, password }),

  logout: () => request<void>('POST', '/api/logout'),

  /** FR-67：界面改口令。成功 204；当前密码错是 400 `invalid_old_password`（**不是 401**，不会被当会话失效）。 */
  changePassword: (oldPassword: string, newPassword: string) =>
    request<void>('POST', '/api/password', { old_password: oldPassword, new_password: newPassword }),

  listPrompts: (params: PromptListQueryParams) =>
    request<PromptListResponse>('GET', `/api/prompts${buildPromptListQuery(params)}`),

  getPrompt: (id: number) => request<Prompt>('GET', `/api/prompts/${String(id)}`),

  createPrompt: (input: PromptWritable) => request<Prompt>('POST', '/api/prompts', input),

  updatePrompt: (id: number, input: PromptWritable) => request<Prompt>('PUT', `/api/prompts/${String(id)}`, input),

  deletePrompt: (id: number) => request<void>('DELETE', `/api/prompts/${String(id)}`),

  /** FR-70：按拖拽结果落库（当前视图内的完整新顺序）；服务端校验非法 id → 400，幂等。 */
  reorderPrompts: (ids: number[]) => request<void>('PATCH', '/api/prompts/order', { ids }),

  /**
   * FR-77 ⑥：表格多选后的**批量动作**（一次调用只发 1 个请求；服务端整批一个事务）。
   * `folder_id` 只在 `action === 'move'` 时传（`null` = 移回「未归类」）。
   */
  bulkPrompts: (action: 'favorite' | 'move' | 'delete', ids: number[], folderId?: number | null) =>
    request<{ action: string; affected: number }>('POST', '/api/prompts/bulk', {
      action,
      ids,
      ...(folderId === undefined ? {} : { folder_id: folderId }),
    }),

  versions: (id: number) => request<{ items: VersionSummary[] }>('GET', `/api/prompts/${String(id)}/versions`),

  diff: (id: number, from: number, to: number) =>
    request<{ diff: string }>('GET', `/api/prompts/${String(id)}/diff?from=${String(from)}&to=${String(to)}`),

  rollback: (id: number, versionNo: number) =>
    request<Prompt>('POST', `/api/prompts/${String(id)}/versions/${String(versionNo)}/rollback`),

  variables: (id: number) => request<{ variables: string[] }>('GET', `/api/prompts/${String(id)}/variables`),

  render: (id: number, values: Record<string, string>) =>
    request<RenderResult>('POST', `/api/prompts/${String(id)}/render`, { values }),

  /**
   * FR-115：**记一次"复制"**（不含变量的提示词走本地剪贴板复制，需要显式告诉后端）。
   * 只记账、不返回正文（正文前端已有）⇒ 与 `render` 一样服务端会记一条**计入型**取用。
   * ⚠️ 不要改用 `getPrompt()` 来"顺带记账" —— 那是"打开详情"语义，会记成 `view`。
   */
  recordCopy: (id: number) => request<void>('POST', `/api/prompts/${String(id)}/copy`),

  renderMarkdown: (markdown: string) => request<{ html: string }>('POST', '/api/render/markdown', { markdown }),

  folders: () => request<{ items: Folder[] }>('GET', '/api/folders'),

  createFolder: (name: string, parentId: number | null) =>
    request<Folder>('POST', '/api/folders', { name, parent_id: parentId }),

  renameFolder: (id: number, name: string) => request<Folder>('PUT', `/api/folders/${String(id)}`, { name }),

  deleteFolder: (id: number) => request<void>('DELETE', `/api/folders/${String(id)}`),

  /** FR-70：同一父级下的文件夹重排（跨父级会被服务端拒成 400）。 */
  reorderFolders: (parentId: number | null, ids: number[]) =>
    request<void>('PATCH', '/api/folders/order', { parent_id: parentId, ids }),

  tags: () => request<{ items: Tag[] }>('GET', '/api/tags'),

  createTag: (name: string) => request<Tag>('POST', '/api/tags', { name }),

  renameTag: (id: number, name: string) => request<Tag>('PUT', `/api/tags/${String(id)}`, { name }),

  deleteTag: (id: number) => request<void>('DELETE', `/api/tags/${String(id)}`),

  exportAll: () => request<ExportFile>('GET', '/api/export'),

  importAll: (mode: 'replace' | 'merge', data: unknown) => request<ImportResult>('POST', '/api/import', { mode, data }),

  usageSummary: (days: number) => request<UsageSummary>('GET', `/api/usage/summary?days=${String(days)}`),

  tokens: () => request<{ items: TokenSummary[] }>('GET', '/api/tokens'),

  /** FR-103：新建令牌可指定权限；**不传 = 只读**（服务端缺省）。 */
  createToken: (name: string, scope?: 'read' | 'write') =>
    request<CreatedToken>('POST', '/api/tokens', scope === undefined ? { name } : { name, scope }),

  revokeToken: (id: number) => request<void>('DELETE', `/api/tokens/${String(id)}`),
  /**
   * FR-105：**改已有令牌的权限**（只读 ↔ 读写）。**立即生效**（服务端每个请求都查库、不缓存）。
   * 返回该行最新的摘要 —— 界面用它**只更新那一行**（不发整表刷新、不重载页面）。
   */
  setTokenScope: (id: number, scope: 'read' | 'write') =>
    request<TokenSummary>('PATCH', `/api/tokens/${String(id)}`, { scope }),
  /** FR-94：查看 token 明文（**只允许会话 cookie**；Bearer 调会被 403）。 */
  revealToken: (id: number) => request<{ token: string }>('POST', `/api/tokens/${String(id)}/reveal`),
  /** FR-96：**硬删除**已撤销的 token（未撤销 → 409；真删行、审计一并消失）。 */
  deleteTokenPermanently: (id: number) => request<void>('DELETE', `/api/tokens/${String(id)}/permanent`),
};

/** 统一的用户可读错误文案（401 单独判，用于把用户踢回登录页）。 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') return '尝试过于频繁，请稍后再试（登录失败次数超过阈值）';
    if (error.code === 'invalid_credentials') return '用户名或密码不正确';
    if (error.code === 'unauthorized') return '会话已失效，请重新登录';
    if (error.code === 'folder_not_empty') return '文件夹下还有子文件夹或 prompt，不能删除';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
