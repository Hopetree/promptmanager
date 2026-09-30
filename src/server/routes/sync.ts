import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import { SyncError } from '../../errors.js';
import {
  defaultInstance,
  readSyncConfig,
  toView,
  writeSyncConfig,
  type SyncConfigView,
} from '../../services/sync-config.js';
import { pullSnapshot, pushSnapshot, requireSyncConfig, testConnection, type SyncDeps } from '../../services/sync.js';
import { TokenEncKeyUnavailableError, loadTokenCipher, type TokenCipher } from '../../services/token-crypto.js';

/**
 * FR-125 / AC-121（阶段 59）：远程数据同步的 5 个端点。
 *
 * · `GET  /api/sync/config`  读配置（**绝不回 token 明文**，只回 `token_set` + 尾 4 位）
 * · `PUT  /api/sync/config`  写配置（repo/instance/path/token/branch；token 加密落库）
 * · `POST /api/sync/test`    测试连接（区分 401 / 404 / 云端没有文件 / 网络异常）
 * · `POST /api/sync/push`    立即上传（`dry_run: true` 只读不算远端；真推覆盖目标文件）
 * · `POST /api/sync/pull`    从云端恢复（`merge` 缺省；`replace` 必须 `confirm: true`，且执行前自动写本地快照）
 *
 * **仅会话可用**：`/api/sync` 已在 `src/server/auth.ts` 的 `SESSION_ONLY_PREFIXES` 里 —— API 令牌调
 * `push` / `pull` 一律 **403 `session_required`**（FR-125 ③：它能清空数据，与「令牌管理 / 改口令」同级）。
 * 本文件里**没有任何定时器**：每一次出网都由上面某一次 HTTP 请求驱动（FR-125 ④.1）。
 */

/** 四个写端点的 body 形状：只做最弱校验（必须对象），字段级校验交给 sync-config（保证 400 带中文原因）。 */
const objectBody = { type: 'object', additionalProperties: true } as const;

function cipherOrThrow(config: AppConfig): TokenCipher {
  try {
    return loadTokenCipher(config);
  } catch (error) {
    if (error instanceof TokenEncKeyUnavailableError) {
      throw new SyncError(
        500,
        'token_enc_key_unavailable',
        '服务端加密密钥不可用：请确认 <DATA_DIR>/token-enc.key 可读写（或正确设置了 TOKEN_ENC_KEY），然后重试。',
      );
    }
    throw error;
  }
}

export function registerSyncRoutes(app: FastifyInstance, config: AppConfig): void {
  const depsFor = (): SyncDeps => ({ qe: app.qe, config, cipher: cipherOrThrow(config) });

  app.get('/api/sync/config', async () => {
    const cipher = cipherOrThrow(config);
    return toView(await readSyncConfig(app.qe), cipher);
  });

  app.put('/api/sync/config', { schema: { body: objectBody } }, async (request): Promise<SyncConfigView> => {
    const cipher = cipherOrThrow(config);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fallback = defaultInstance(config.publicOrigin, request.headers.host);
    const record = await writeSyncConfig(
      app.qe,
      cipher,
      {
        repo: body['repo'],
        instance: body['instance'],
        path: body['path'],
        token: body['token'],
        branch: body['branch'],
      },
      fallback,
    );
    // 写回同样**只回脱敏形状**（routes 层不额外拼装任何含 token 的字段）。
    return toView(record, cipher);
  });

  app.post('/api/sync/test', async () => {
    const deps = depsFor();
    const record = requireSyncConfig(await readSyncConfig(app.qe));
    return testConnection(deps, record);
  });

  app.post('/api/sync/push', { schema: { body: objectBody } }, async (request) => {
    const deps = depsFor();
    const record = requireSyncConfig(await readSyncConfig(app.qe));
    const body = (request.body ?? {}) as Record<string, unknown>;
    const dryRun = body['dry_run'] === true;
    return pushSnapshot(deps, record, { dryRun });
  });

  app.post('/api/sync/pull', { schema: { body: objectBody } }, async (request) => {
    const deps = depsFor();
    const record = requireSyncConfig(await readSyncConfig(app.qe));
    const body = (request.body ?? {}) as Record<string, unknown>;
    const modeRaw = body['mode'];
    if (modeRaw !== undefined && modeRaw !== 'merge' && modeRaw !== 'replace') {
      throw new SyncError(400, 'invalid_sync_mode', '恢复模式只支持 `merge`（缺省，只新增/更新）或 `replace`（清空重建）。');
    }
    return pullSnapshot(deps, record, { mode: modeRaw === 'replace' ? 'replace' : 'merge', confirm: body['confirm'] === true });
  });
}
