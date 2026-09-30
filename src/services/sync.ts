/**
 * FR-125 / D-57 ③：远程同步的业务层（阶段 59）。
 *
 * 原则（D-57 ③）：
 *   · **快照 = 既有导出格式** —— 直接复用 `buildExport(qe)`，不另造序列化；
 *   · **恢复 = 既有 `POST /api/import`** —— 直接复用 `importData(qe, mode, data)`，不另造解析 / 合并逻辑；
 *   · **不做自动 / 定时上传** —— 本文件里没有任何定时器，每次出网都由一次 HTTP 请求（= 用户点击）驱动。
 *
 * 三个动作：`testConnection`（测试连接）/ `pushSnapshot`（立即上传，含 dry_run）/ `pullSnapshot`（从云端恢复）。
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { QueryEngine } from '../db/index.js';
import { SyncError } from '../errors.js';
import { buildExport, type ExportFile } from './export.js';
import { importData, type ImportMode, type ImportResult } from './import.js';
import { createGitHubClient, type GitHubClient } from './sync-github.js';
import type { SyncConfigRecord } from './sync-config.js';
import type { TokenCipher } from './token-crypto.js';

/** FR-125 ④.8：超过阈值**拒绝并说明原因**（不静默截断、不部分上传）。 */
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
/** FR-125 ④.4：`replace` 前自动写本地快照，**保留最近 3 份**。 */
export const PRE_RESTORE_KEEP = 3;

export interface SyncDeps {
  qe: QueryEngine;
  config: AppConfig;
  cipher: TokenCipher;
  /** 测试注入用：缺省按 `SYNC_GITHUB_API_BASE` 建真实客户端（指向本地桩即可，见 D-57 ④）。 */
  createClient?: (record: SyncConfigRecord) => GitHubClient;
}

export type TestStage = 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'no_file' | 'rate_limited' | 'network' | 'upstream';

export interface SyncTestResult {
  ok: boolean;
  stage: TestStage;
  /** 中文可执行提示（401 / 404 / 云端无文件 / 网络异常各不相同 —— FR-125 ②/④.7、AC-121 E⑩）。 */
  message: string;
  repo: string;
  path: string;
  branch: string;
  file_exists: boolean | null;
  file_sha: string | null;
  can_push: boolean | null;
  default_branch: string | null;
}

export interface SyncPushResult {
  dry_run: boolean;
  repo: string;
  path: string;
  branch: string;
  /** 将推送（或已推送）的条数 —— FR-125 ② 要求 dry_run 就报出来，界面据此二次确认。 */
  prompts: number;
  folders: number;
  tags: number;
  bytes: number;
  exists: boolean;
  action: 'create' | 'overwrite';
  current_sha: string | null;
  remote_sha: string | null;
  commit_sha: string | null;
  attempts: number;
  exported_at: string;
}

export interface SyncPullResult {
  mode: ImportMode;
  imported: ImportResult['imported'];
  remote_sha: string;
  /** `replace` 前的本地快照文件名（`merge` 时为 null）；AC-121 D⑧ 会检查它确实存在。 */
  snapshot: string | null;
  snapshot_kept: number;
}

const notConfigured = (): SyncError =>
  new SyncError(400, 'sync_not_configured', '还没有配置远程同步。请先填仓库、实例标识、云端路径与 GitHub 令牌，然后点「保存配置」。');

export function requireSyncConfig(record: SyncConfigRecord | null): SyncConfigRecord {
  if (record === null) throw notConfigured();
  return record;
}

export function clientFor(deps: SyncDeps, record: SyncConfigRecord): GitHubClient {
  if (deps.createClient !== undefined) return deps.createClient(record);
  return createGitHubClient({
    baseUrl: deps.config.syncGitHubApiBase,
    token: deps.cipher.decrypt(record.tokenEnc),
  });
}

/** 快照文本：既有导出结构 + 2 空格缩进（git 里能直接读 diff；解析契约不变）。 */
export function serializeSnapshot(file: ExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function assertSnapshotSize(text: string): void {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_SNAPSHOT_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    throw new SyncError(
      400,
      'snapshot_too_large',
      `本地快照 ${mb} MB，超过 5 MB 上限，已拒绝上传（不做截断、不做部分上传）。请先精简库，或把云同步关掉改用文件级备份。`,
    );
  }
}

/** 把远端内容解成「既有导出格式」的对象；格式不对时由 `importData` 抛 `invalid_import`。 */
function parseRemote(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyncError(
      400,
      'invalid_import',
      '云端文件不是合法 JSON，无法作为快照恢复。请确认这个路径下放的是由本应用导出的文件。',
    );
  }
}

/** ② 测试连接：区分「token 无效（401）／仓库或路径无权限（404）／云端还没有文件」。 */
export async function testConnection(deps: SyncDeps, record: SyncConfigRecord): Promise<SyncTestResult> {
  const client = clientFor(deps, record);
  const base: SyncTestResult = {
    ok: false,
    stage: 'ok',
    message: '',
    repo: record.repo,
    path: record.path,
    branch: record.branch,
    file_exists: null,
    file_sha: null,
    can_push: null,
    default_branch: null,
  };
  try {
    const info = await client.getRepo(record.repo);
    base.default_branch = info.defaultBranch;
    base.can_push = info.canPush;
    if (info.canPush === false) {
      return {
        ...base,
        stage: 'forbidden',
        message: `令牌能读 \`${record.repo}\`，但没有写权限（GitHub 报 permissions.push = false）。请把该令牌的 Contents 权限改成 Read and write。`,
        file_exists: null,
      };
    }
  } catch (error) {
    if (error instanceof SyncError) {
      const stage: TestStage =
        error.code === 'sync_unauthorized'
          ? 'unauthorized'
          : error.code === 'sync_rate_limited'
            ? 'rate_limited'
            : error.code === 'sync_network'
              ? 'network'
              : error.code === 'sync_forbidden'
                ? 'forbidden'
                : error.code === 'sync_not_found'
                  ? 'not_found'
                  : 'upstream';
      return { ...base, stage, message: error.message };
    }
    throw error;
  }

  try {
    const file = await client.getFile(record.repo, record.path, record.branch);
    if (file === null) {
      return {
        ...base,
        ok: true,
        stage: 'no_file',
        message: `连接正常（仓库 \`${record.repo}\`、分支 \`${record.branch}\` 都可访问），但云端还没有 \`${record.path}\`。第一次「立即上传」会新建它。`,
        file_exists: false,
      };
    }
    return {
      ...base,
      ok: true,
      stage: 'ok',
      message: `一切正常：云端已有 \`${record.path}\`（${file.content.length} 字节），上传会**覆盖**它。`,
      file_exists: true,
      file_sha: file.sha,
    };
  } catch (error) {
    if (error instanceof SyncError) {
      const stage: TestStage =
        error.code === 'sync_network' ? 'network' : error.code === 'sync_rate_limited' ? 'rate_limited' : 'upstream';
      return { ...base, stage, message: error.message, file_exists: null };
    }
    throw error;
  }
}

/** ③ 立即上传：`dry_run` 时只读远端（**不改远端**），真推时覆盖该文件。 */
export async function pushSnapshot(
  deps: SyncDeps,
  record: SyncConfigRecord,
  options: { dryRun: boolean },
): Promise<SyncPushResult> {
  const file = await buildExport(deps.qe);
  const text = serializeSnapshot(file);
  assertSnapshotSize(text);
  const client = clientFor(deps, record);

  const current = await client.getFile(record.repo, record.path, record.branch);
  const exists = current !== null;
  const common = {
    repo: record.repo,
    path: record.path,
    branch: record.branch,
    prompts: file.prompts.length,
    folders: file.folders.length,
    tags: file.tags.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    exists,
    action: (exists ? 'overwrite' : 'create') as 'overwrite' | 'create',
    current_sha: current?.sha ?? null,
    exported_at: file.exported_at,
  };

  if (options.dryRun) {
    // 只读：不 PUT、不建 sha ⇒ 远端文件 sha 不变（AC-121 C④）。
    return { dry_run: true, ...common, remote_sha: current?.sha ?? null, commit_sha: null, attempts: 0 };
  }

  const stamp = new Date().toISOString();
  const result = await client.putFile(record.repo, record.path, record.branch, {
    content: Buffer.from(text, 'utf8'),
    message: `sync(${record.instance}): 手动上传全量快照 ${stamp}`,
    ...(current === null ? {} : { sha: current.sha }),
  });
  return {
    dry_run: false,
    ...common,
    remote_sha: result.sha,
    commit_sha: result.commit,
    attempts: result.attempts,
  };
}

/** 写 `<DATA_DIR>/pre-restore-<ts>.json` 并只保留最近 3 份（FR-125 ④.4）。 */
export async function writePreRestoreSnapshot(deps: SyncDeps, file: ExportFile): Promise<string> {
  const dir = deps.config.dataDir;
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `pre-restore-${ts}.json`;
  await writeFile(path.join(dir, name), serializeSnapshot(file), 'utf8');
  const all = (await readdir(dir)).filter((entry) => /^pre-restore-.*\.json$/.test(entry)).sort();
  const stale = all.slice(0, Math.max(0, all.length - PRE_RESTORE_KEEP));
  for (const entry of stale) await rm(path.join(dir, entry), { force: true });
  return name;
}

/** ④ 从云端恢复：取远端 → 走既有 `importData`（merge / replace）。 */
export async function pullSnapshot(
  deps: SyncDeps,
  record: SyncConfigRecord,
  options: { mode: ImportMode; confirm: boolean },
): Promise<SyncPullResult> {
  const client = clientFor(deps, record);
  const remote = await client.getFile(record.repo, record.path, record.branch);
  if (remote === null) {
    throw new SyncError(
      400,
      'sync_no_remote_file',
      `云端还没有 \`${record.path}\`（404）。请先在上游实例点「立即上传」，或核对分支 \`${record.branch}\` 与路径。`,
    );
  }
  if (options.mode === 'replace' && !options.confirm) {
    throw new SyncError(
      400,
      'confirm_required',
      '用 replace 恢复会清空本地全部内容表（文件夹 / 标签 / 提示词），必须显式二次确认（confirm: true）才会执行。',
    );
  }

  const data = parseRemote(remote.content.toString('utf8'));
  let snapshot: string | null = null;
  if (options.mode === 'replace') {
    // 执行前**自动**写本地快照（不用用户点，也不因确认框而省略）。
    snapshot = await writePreRestoreSnapshot(deps, await buildExport(deps.qe));
  }
  const result = await importData(deps.qe, options.mode, data);
  return {
    mode: options.mode,
    imported: result.imported,
    remote_sha: remote.sha,
    snapshot,
    snapshot_kept: PRE_RESTORE_KEEP,
  };
}
