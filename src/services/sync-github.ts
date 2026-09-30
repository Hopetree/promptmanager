/**
 * FR-125 / D-57 ④：GitHub Contents API 的**传输层**（阶段 59）。
 *
 * 与业务解耦的三件事都在这里：
 *   · Contents API 的 GET / PUT（base64 由调用方给出/取回）；
 *   · **409 冲突重试一次**（取新 sha 后重提，**不无限重试** —— FR-125 ④.5 / AC-121 C⑥）；
 *   · **错误中文化**（401 / 403 / 404 / 409 / 网络异常各给可执行提示，不把原始状态码抛给用户 —— FR-125 ④.7）。
 *
 * **base URL 可注入**：`SYNC_GITHUB_API_BASE`（缺省 `https://api.github.com`）。自动化测试把它指向**本地桩**
 * 服务器，于是同一个 `fetch` 路径、同一份 base64 / 重试 / 错误映射代码都被真实执行（不需要真仓库、不碰真 token）。
 */
import { SyncError } from '../errors.js';

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

/** 远端文件：`sha` 用于 PUT 的乐观并发控制（拿到它之后被别人改过 ⇒ 409）。 */
export interface GitHubFile {
  content: Buffer;
  sha: string;
}

export interface GitHubRepoInfo {
  defaultBranch: string | null;
  /** GitHub 在有权限时回 `permissions.push`；不是所有桩/响应都有 ⇒ 可空。 */
  canPush: boolean | null;
}

export interface GitHubPutResult {
  sha: string;
  commit: string | null;
  /** 本次 PUT 实际尝试次数（=2 表示发生过一次 409 重试）；AC-121 C⑥ 的机器可读证据。 */
  attempts: number;
}

export interface GitHubClient {
  getRepo(repo: string): Promise<GitHubRepoInfo>;
  getFile(repo: string, path: string, branch: string): Promise<GitHubFile | null>;
  putFile(
    repo: string,
    path: string,
    branch: string,
    args: { content: Buffer; message: string; sha?: string },
  ): Promise<GitHubPutResult>;
}

export interface GitHubClientOptions {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 出错时带上的可执行建议（区分是"测试连接"还是"上传"场景）。 */
  userAgent?: string;
}

const trimBase = (base: string): string => base.replace(/\/+$/, '');

function describeNetworkError(error: unknown): SyncError {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = String((cause as { code?: unknown } | undefined)?.code ?? '');
  const detail =
    code === 'ENOTFOUND'
      ? '域名解析失败（DNS 查不到 api.github.com）'
      : code === 'ECONNREFUSED'
        ? '连接被拒绝（出网被防火墙 / 代理挡住）'
        : code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT'
          ? '连接超时'
          : '网络不可达';
  return new SyncError(
    502,
    'sync_network',
    `连不上 GitHub：${detail}。请检查这台服务器的出网、代理与 DNS 设置后重试。`,
  );
}

/** 把 GitHub 的状态码翻成「用户看得懂、知道下一步做什么」的中文提示（FR-125 ④.7）。 */
function describeStatus(status: number, body: string, repo: string, context: string): SyncError {
  const lower = body.toLowerCase();
  if (status === 401) {
    return new SyncError(
      400,
      'sync_unauthorized',
      'GitHub 令牌无效或已过期（401）。请到 GitHub → Settings → Developer settings → Fine-grained tokens 重新签发：只勾选这一个仓库，权限只给 Contents: Read and write。',
    );
  }
  if (status === 403) {
    if (lower.includes('rate limit') || lower.includes('secondary rate')) {
      return new SyncError(
        502,
        'sync_rate_limited',
        'GitHub 限流了（403）。等几分钟再试；如果是共享出口 IP，请降低手动同步的频率。',
      );
    }
    return new SyncError(
      400,
      'sync_forbidden',
      `这个令牌没有操作 \`${repo}\` 的权限（403）。请确认令牌是 fine-grained、已勾选该仓库，且 Contents 权限为 Read and write。`,
    );
  }
  if (status === 404) {
    return new SyncError(
      400,
      'sync_not_found',
      `仓库或路径不存在、或令牌无权访问（404）：\`${repo}\`${context}。请核对仓库名拼写，以及令牌的「仅选择该仓库」是否包含它。`,
    );
  }
  if (status === 409) {
    return new SyncError(
      409,
      'sync_conflict',
      '云端文件在本次操作期间被别人改动了（409 冲突），已重新取 sha 重试一次仍未成功。请稍后重试。',
    );
  }
  if (status === 422) {
    return new SyncError(400, 'sync_rejected', 'GitHub 拒绝了这次写入（422）：请检查分支是否存在、路径是否合法。');
  }
  return new SyncError(502, 'sync_upstream', `GitHub 暂时不可用（服务端返回 ${status}）。请稍后重试。`);
}

/** P2-9②：上游响应体上限 —— 防被劫持 / 被重定向的上游把内存泵满（快照上限 5MB，这里留一倍余量）。 */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 有界读取：`response.text()` 会无上限地把整个响应读进内存，这里改成按流累计、超限即中止。 */
async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new SyncError(502, 'sync_upstream_too_large', 'GitHub 返回的内容过大，已中止读取。');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SyncError(502, 'sync_upstream_too_large', 'GitHub 返回的内容过大，已中止读取。');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const base = trimBase(options.baseUrl ?? GITHUB_API_BASE);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const headers = (): Record<string, string> => ({
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${options.token}`,
    'x-github-api-version': GITHUB_API_VERSION,
    'user-agent': options.userAgent ?? 'promptmanager-sync',
  });

  const send = async (
    method: 'GET' | 'PUT',
    url: string,
    body?: unknown,
    context = '',
  ): Promise<{ status: number; json: Record<string, unknown>; text: string }> => {
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: { ...headers(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        // P2-9②：不跟重定向 —— 基地址来自管理员配置，跟随重定向等于允许它把带 token 的请求引到别处。
        redirect: 'error',
      });
    } catch (error) {
      throw describeNetworkError(error);
    }
    const text = await readBoundedText(response);
    let json: Record<string, unknown> = {};
    if (text !== '') {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = {};
      }
    }
    if (response.status >= 400) {
      const repoMatch = /\/repos\/([^/]+\/[^/]+)/.exec(url);
      throw describeStatus(response.status, text, repoMatch?.[1] ?? '', context);
    }
    return { status: response.status, json, text };
  };

  return {
    async getRepo(repo: string): Promise<GitHubRepoInfo> {
      const { json } = await send('GET', `${base}/repos/${repo}`);
      const defaultBranch = typeof json['default_branch'] === 'string' ? (json['default_branch'] as string) : null;
      const permissions = json['permissions'] as { push?: unknown } | undefined;
      const canPush = permissions === undefined || typeof permissions.push !== 'boolean' ? null : permissions.push;
      return { defaultBranch, canPush };
    },

    async getFile(repo: string, path: string, branch: string): Promise<GitHubFile | null> {
      let response: { status: number; json: Record<string, unknown>; text: string };
      try {
        response = await send('GET', `${base}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
      } catch (error) {
        // Contents 404 = 分支或文件还没有 ⇒ 不是错误，是「云端还没有文件」（FR-125 ②）。
        if (error instanceof SyncError && error.code === 'sync_not_found') return null;
        throw error;
      }
      const raw = typeof response.json['content'] === 'string' ? (response.json['content'] as string) : '';
      const sha = typeof response.json['sha'] === 'string' ? (response.json['sha'] as string) : '';
      // GitHub 在 >1MB 的文件上回 content:'' + encoding:'none' —— 本项目快照 ~367KB，但仍如实报错而不是静默写空。
      if (raw === '') {
        throw new SyncError(
          502,
          'sync_upstream',
          '云端文件的返回体里没有内容（可能是文件超过 1MB 或响应被截断）。请改用更小的库或手动下载。',
        );
      }
      // FR-125 ④.6：**解码前清掉空白**（GitHub 的 base64 是折行的）。
      return { content: Buffer.from(raw.replace(/\s/g, ''), 'base64'), sha };
    },

    async putFile(repo: string, path: string, branch: string, args): Promise<GitHubPutResult> {
      const url = `${base}/repos/${repo}/contents/${path}`;
      const payload = (content: Buffer, sha: string | undefined): Record<string, unknown> => ({
        message: args.message,
        // FR-125 ④.6：用 Buffer 做 base64（不手搓编码）。
        content: content.toString('base64'),
        branch,
        ...(sha === undefined ? {} : { sha }),
      });

      let sha = args.sha;
      const first = await (async (): Promise<GitHubPutResult | 'conflict'> => {
        try {
          const { json } = await send('PUT', url, payload(args.content, sha));
          const content = json['content'] as { sha?: unknown } | undefined;
          const commit = json['commit'] as { sha?: unknown } | undefined;
          return {
            sha: typeof content?.sha === 'string' ? content.sha : (sha ?? ''),
            commit: typeof commit?.sha === 'string' ? commit.sha : null,
            attempts: 1,
          };
        } catch (error) {
          if (error instanceof SyncError && error.code === 'sync_conflict') return 'conflict';
          throw error;
        }
      })();

      if (first !== 'conflict') return first;

      // 409：取新 sha 后**重试一次**（不无限重试）。第二次仍 409 ⇒ describeStatus 会抛 sync_conflict。
      const latest = await this.getFile(repo, path, branch);
      sha = latest?.sha;
      const { json } = await send('PUT', url, payload(args.content, sha));
      const content = json['content'] as { sha?: unknown } | undefined;
      const commit = json['commit'] as { sha?: unknown } | undefined;
      return {
        sha: typeof content?.sha === 'string' ? content.sha : (sha ?? ''),
        commit: typeof commit?.sha === 'string' ? commit.sha : null,
        attempts: 2,
      };
    },
  };
}
