import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Token 明文的**可逆加密**（FR-94 / D-35 ②）：AES-256-GCM，密文形如 `base64(nonce ‖ tag ‖ ciphertext)`。
 *
 * 为什么保留 sha256：`token_hash` 仍是**鉴权**的唯一依据（语义一字不变）⇒ 密钥丢失只影响"能不能看"，
 * 不影响"能不能用"。这也让迁移零风险：存量行 `token_enc IS NULL` 照样鉴权通过。
 *
 * 密钥来源（优先级从高到低）：
 * 1. env `TOKEN_ENC_KEY`（32 字节 hex = 64 个十六进制字符）；
 * 2. 文件 `<DATA_DIR>/token-enc.key`（600，首次自动生成）—— 容器里 `/data` 是卷 ⇒ 重建不丢。
 *
 * 纪律：**密钥绝不入库、不入仓库、不进日志**；本模块也**不打印**任何密钥/明文。
 */

/** 密钥文件名（放在 DATA_DIR 下；与 pm.db 同目录 ⇒ 备份策略与库一致）。 */
export const TOKEN_ENC_KEY_FILE = 'token-enc.key';

const NONCE_BYTES = 12; // GCM 标准 nonce
const TAG_BYTES = 16; // GCM tag

/**
 * 密钥不可用 / 密文无法解密。上层把它映射成**明确错误**（不崩、不泄）：
 * 配置问题不应该是 500 之外的语义，但必须让使用者看懂该做什么。
 */
export class TokenEncKeyUnavailableError extends Error {
  readonly code = 'token_enc_key_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'TokenEncKeyUnavailableError';
  }
}

export interface TokenCipher {
  /** 明文 → `base64(nonce ‖ tag ‖ ciphertext)` */
  encrypt(plaintext: string): string;
  /** 密文 → 明文；密钥不匹配或密文损坏 → `TokenEncKeyUnavailableError` */
  decrypt(payload: string): string;
}

function parseKeyHex(raw: string, source: string): Buffer {
  const hex = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new TokenEncKeyUnavailableError(
      `${source} 必须是 32 字节 hex（64 个十六进制字符）；当前长度 ${String(hex.length)}。` +
        '请修正后重试（改密钥会导致已加密的 token 无法查看，但**不影响鉴权**）。',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * 解析密钥：env 优先；否则读/建 `<DATA_DIR>/token-enc.key`（600）。
 * ⚠️ 只在真正需要加解密时调用（**惰性**）——密钥不可用不应该影响启动、列表或其它接口。
 */
export function resolveTokenKey(
  config: { dataDir: string },
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const fromEnv = (env['TOKEN_ENC_KEY'] ?? '').trim();
  if (fromEnv !== '') return parseKeyHex(fromEnv, 'TOKEN_ENC_KEY');

  const file = path.join(config.dataDir, TOKEN_ENC_KEY_FILE);
  try {
    return parseKeyHex(readFileSync(file, 'utf8'), file);
  } catch (error) {
    if (error instanceof TokenEncKeyUnavailableError) throw error;
    const code = (error as { code?: string } | null)?.code;
    if (code !== 'ENOENT') {
      throw new TokenEncKeyUnavailableError(
        `无法读取密钥文件 ${file}（${error instanceof Error ? error.message : String(error)}）。` +
          '请检查数据目录权限，或改用 env TOKEN_ENC_KEY。',
      );
    }
  }

  // 首次：生成并落盘（600）。写失败 → 明确错误（不影响鉴权）
  const hex = randomBytes(32).toString('hex');
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, `${hex}\n`, { mode: 0o600 });
    chmodSync(file, 0o600); // 明确一次（受 umask 影响时兜底）
  } catch (error) {
    throw new TokenEncKeyUnavailableError(
      `无法创建密钥文件 ${file}（${error instanceof Error ? error.message : String(error)}）。` +
        '请检查数据目录权限，或改用 env TOKEN_ENC_KEY。',
    );
  }
  return parseKeyHex(hex, file);
}

/** 用给定密钥做加解密（纯函数式，便于单测注入固定密钥）。 */
export function cipherWithKey(key: Buffer): TokenCipher {
  if (key.length !== 32) {
    throw new TokenEncKeyUnavailableError(`密钥必须是 32 字节（当前 ${String(key.length)} 字节）`);
  }
  return {
    encrypt(plaintext: string): string {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([nonce, tag, body]).toString('base64');
    },
    decrypt(payload: string): string {
      let raw: Buffer;
      try {
        raw = Buffer.from(payload, 'base64');
      } catch {
        throw new TokenEncKeyUnavailableError('密文不是合法的 base64 —— 数据可能已损坏。');
      }
      if (raw.length <= NONCE_BYTES + TAG_BYTES) {
        throw new TokenEncKeyUnavailableError('密文长度异常 —— 数据可能已损坏。');
      }
      const nonce = raw.subarray(0, NONCE_BYTES);
      const tag = raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
      const body = raw.subarray(NONCE_BYTES + TAG_BYTES);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      } catch {
        // GCM 校验失败：密钥不匹配（例如密钥文件被替换/重建）或密文被篡改
        throw new TokenEncKeyUnavailableError(
          '解密失败：当前密钥与密文不匹配（密钥文件被替换或密文损坏）。' +
            '恢复原密钥文件或原 TOKEN_ENC_KEY 后可再次查看；**鉴权不受影响**。',
        );
      }
    },
  };
}

/** 便捷入口：按配置解析密钥并返回 cipher（惰性调用点由上层控制）。 */
export function loadTokenCipher(
  config: { dataDir: string },
  env: NodeJS.ProcessEnv = process.env,
): TokenCipher {
  return cipherWithKey(resolveTokenKey(config, env));
}
