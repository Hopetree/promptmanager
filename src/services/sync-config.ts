/**
 * FR-125 / D-57：远程同步配置的读写与校验（阶段 59）。
 *
 * 三件事：
 *   ① **归一化 + 校验**：`repo` 允许粘贴网页/SSH 地址；`path` 必须含 `promptmanager/` 且以 `<instance>.json`
 *      收尾（FR-125 ④.2「防多实例撞名静默覆盖」）；`instance` 仅 `[A-Za-z0-9._-]`。
 *   ② **落库加密**：token 用 `token-crypto` 加密后进 `sync_config.token_enc`（D-57 ②：不用 env 存 token）。
 *   ③ **脱敏读取**：任何返回给前端的形状都**不含明文**，只有 `token_set` + 尾 4 位提示。
 */
import type { QueryEngine } from '../db/index.js';
import { SyncError } from '../errors.js';
import type { TokenCipher } from './token-crypto.js';

export const DEFAULT_BRANCH = 'main';
/** FR-125 ①：路径必须含这个片段（大小写敏感 —— GitHub 路径区分大小写）。 */
export const PATH_MARKER = 'promptmanager/';
const INSTANCE_RE = /^[A-Za-z0-9._-]+$/;
const PATH_CHARS_RE = /^[A-Za-z0-9._/-]+$/;

/** DB 里的原始行（token 是密文）。 */
export interface SyncConfigRecord {
  repo: string;
  instance: string;
  path: string;
  branch: string;
  tokenEnc: string;
  updatedAt: string;
}

/**
 * 前端可见的配置形状：**只有 `token_set` 与 `token_tail`**（FR-125 ①/AC-121 A①）。
 * `configured=false` 时其余字段为 null。
 */
export interface SyncConfigView {
  configured: boolean;
  repo: string | null;
  instance: string | null;
  path: string | null;
  branch: string | null;
  token_set: boolean;
  token_tail: string | null;
}

export interface SyncConfigInput {
  repo?: unknown;
  instance?: unknown;
  path?: unknown;
  token?: unknown;
  branch?: unknown;
}

const invalid = (message: string): SyncError => new SyncError(400, 'invalid_sync_config', message);

/** `owner/repo`（也接受 `https://github.com/owner/repo(.git)`、`git@github.com:owner/repo.git`）。 */
export function normalizeRepo(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') throw invalid('仓库不能为空，请填 `owner/repo`（也支持直接粘贴仓库网页地址）。');
  const patterns = [
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i,
    /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m !== null) return `${m[1]}/${m[2]}`;
  }
  throw invalid('仓库格式不对：请填 `owner/repo`，或粘贴 GitHub 仓库的网页地址 / SSH 地址。');
}

/** `instance`：仅 `[A-Za-z0-9._-]`（FR-125 ①）。 */
export function normalizeInstance(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const value = text === '' ? fallback : text;
  if (value === '') throw invalid('实例标识不能为空：它参与拼云端文件名，请填一个（如 `home-nas`）。');
  if (!INSTANCE_RE.test(value)) {
    throw invalid('实例标识只允许字母、数字、点、下划线和短横线（`[A-Za-z0-9._-]`），不能有空格或中文。');
  }
  if (value.length > 60) throw invalid('实例标识太长（上限 60 字符）。');
  return value;
}

/**
 * `path`：必须含 `promptmanager/` 且以 `<instance>.json` 收尾（FR-125 ①/④.2 + AC-121 A②）。
 * 额外收紧要几点：不许前导 `/`、不许 `..`、不许空段、不许反斜杠或其它字符。
 */
export function normalizePath(raw: unknown, instance: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') throw invalid('云端路径不能为空，形如 `promptmanager/<实例>.json`。');
  if (text.length > 200) throw invalid('云端路径太长（上限 200 字符）。');
  const cleaned = text.replace(/^\.\//, '');
  if (cleaned.startsWith('/')) throw invalid('云端路径不要以 `/` 开头（这是仓库内相对路径）。');
  if (cleaned.includes('\\')) throw invalid('云端路径请用 `/` 分隔，不要用反斜杠。');
  if (!PATH_CHARS_RE.test(cleaned)) {
    throw invalid('云端路径只允许字母、数字、点、下划线、短横线和 `/`。');
  }
  const segments = cleaned.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw invalid('云端路径不能出现空目录或 `..`。');
  }
  if (!cleaned.includes(PATH_MARKER)) {
    throw invalid(`云端路径必须放进 \`${PATH_MARKER}\` 目录里，例如 \`${PATH_MARKER}${instance}.json\`。`);
  }
  if (!(cleaned === `${instance}.json` || cleaned.endsWith(`/${instance}.json`))) {
    throw invalid(`云端路径必须以 \`${instance}.json\` 收尾（当前实例标识是 \`${instance}\`），否则多个实例会互相覆盖。`);
  }
  return cleaned;
}

/** 从 `PUBLIC_ORIGIN`（缺省时退回请求的 Host）推默认实例标识；非法字符替换成 `-`。 */
export function defaultInstance(publicOrigin: string | undefined, requestHost?: string): string {
  const pick = (value: string): string => {
    try {
      return new URL(value.includes('://') ? value : `http://${value}`).hostname;
    } catch {
      return '';
    }
  };
  const host = (publicOrigin !== undefined && publicOrigin !== '' ? pick(publicOrigin) : '') || pick(requestHost ?? '');
  const sanitized = host.replace(/[^A-Za-z0-9._-]/g, '-');
  return sanitized === '' ? 'promptmanager' : sanitized;
}

/** 读一行配置（没有则 null）。token 仍是密文 —— 解密只发生在 `toView`。 */
export async function readSyncConfig(qe: QueryEngine): Promise<SyncConfigRecord | null> {
  const row = await qe.selectFrom('sync_config').selectAll().where('id', '=', 1).executeTakeFirst();
  if (row === undefined) return null;
  return {
    repo: row.repo,
    instance: row.instance,
    path: row.path,
    branch: row.branch,
    tokenEnc: row.token_enc,
    updatedAt: row.updated_at,
  };
}

/** 解出尾 4 位（只用于提示；解不开就当没有提示，绝不回明文）。 */
export function tokenTail(cipher: TokenCipher, tokenEnc: string): string | null {
  try {
    const plain = cipher.decrypt(tokenEnc);
    return plain.length >= 4 ? plain.slice(-4) : null;
  } catch {
    return null;
  }
}

export function toView(record: SyncConfigRecord | null, cipher: TokenCipher): SyncConfigView {
  if (record === null) {
    return { configured: false, repo: null, instance: null, path: null, branch: null, token_set: false, token_tail: null };
  }
  return {
    configured: true,
    repo: record.repo,
    instance: record.instance,
    path: record.path,
    branch: record.branch,
    token_set: true,
    token_tail: tokenTail(cipher, record.tokenEnc),
  };
}

/**
 * 写入配置（整行覆盖）。
 *
 * `token` **可以省略**：此时沿用库里已有的 token（否则用户每改一次分支/路径都得重新粘一遍 token，
 * 而界面按设计看不到明文）。**首次配置**省略 token ⇒ 400。
 */
export async function writeSyncConfig(
  qe: QueryEngine,
  cipher: TokenCipher,
  input: SyncConfigInput,
  fallbackInstance: string,
): Promise<SyncConfigRecord> {
  const existing = await readSyncConfig(qe);
  const repo = normalizeRepo(input.repo);
  const instance = normalizeInstance(input.instance, fallbackInstance);
  const path = normalizePath(input.path, instance);
  const branchRaw = typeof input.branch === 'string' ? input.branch.trim() : '';
  if (branchRaw !== '' && !/^[A-Za-z0-9._/-]+$/.test(branchRaw)) {
    throw invalid('分支名只允许字母、数字、点、下划线、短横线和 `/`。');
  }
  const branch = branchRaw === '' ? DEFAULT_BRANCH : branchRaw;

  let tokenEnc: string;
  if (typeof input.token === 'string' && input.token.trim() !== '') {
    tokenEnc = cipher.encrypt(input.token.trim());
  } else if (existing !== null) {
    tokenEnc = existing.tokenEnc;
  } else {
    throw invalid('首次配置必须填 GitHub 令牌（保存后界面只显示「已设置」和尾 4 位，不再回显明文）。');
  }

  const updatedAt = new Date().toISOString();
  await qe
    .insertInto('sync_config')
    .values({ id: 1, repo, instance, path, branch, token_enc: tokenEnc, updated_at: updatedAt })
    .onConflict((oc) => oc.column('id').doUpdateSet({ repo, instance, path, branch, token_enc: tokenEnc, updated_at: updatedAt }))
    .execute();

  return { repo, instance, path, branch, tokenEnc, updatedAt };
}
