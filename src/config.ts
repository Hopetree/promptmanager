import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 运行时配置（BRIEF §6.3 环境变量表）。 */
export interface AppConfig {
  /** 监听地址，默认 0.0.0.0（内网可达；BRIEF §5 / STANDARDS §3.2） */
  host: string;
  /** 监听端口，默认 8767（台账分配；BRIEF D-4） */
  port: number;
  /** 数据目录：内含 pm.db 与 media/（BRIEF §6.3、D-9） */
  dataDir: string;
  /** 会话有效期（小时），默认 720 */
  sessionTtlHours: number;
  /** 登录失败阈值（窗口内），默认 5 */
  loginMaxFailures: number;
  /** 登录失败统计窗口（秒），默认 60 */
  loginWindowSeconds: number;
  /** 版本号（取自 package.json，供 /healthz 返回） */
  version: string;
  /** 项目根目录 */
  projectRoot: string;
  /** 前端构建产物目录（由本进程静态托管，FR-12） */
  webRoot: string;
  /** 迁移脚本目录（migrations/*.sql） */
  migrationsDir: string;
  /** CORS 白名单（BRIEF FR-17 / AC-23）：空数组 = 默认关闭；条目必须是精确 origin，禁止 `*` */
  corsOrigins: string[];
  /** 是否信任反向代理头（BRIEF D-18 / AC-28）：**默认 false**；关闭时 X-Forwarded-For 不影响来源 IP/限流 */
  trustProxy: boolean;
  /** 公网公开地址（BRIEF D-18 / AC-28）：设置后会话 cookie 追加 Secure；未设置不得加（内网 HTTP 要能登录） */
  publicOrigin: string | undefined;
}

/**
 * 项目根：从本模块所在目录向上找到 name=promptmanager 的 package.json。
 * 不写死层级，源码（src/**）与编译产物（dist/**）里都能正确定位。
 */
export function findProjectRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown };
      if (pkg.name === 'promptmanager') return dir;
    } catch {
      // 继续向上找
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir, '..', '..');
    dir = parent;
  }
}

export const defaultProjectRoot = findProjectRoot();

function readVersion(projectRoot: string): string {
  try {
    const raw = readFileSync(path.join(projectRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readString(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * CORS 白名单解析（FR-17）：逗号分隔、去空白；**出现 `*` 直接报配置错误**（不许静默忽略）。
 * 返回空数组表示"默认关闭"（同源，不注册 CORS）。
 */
function readCorsOrigins(env: Record<string, string | undefined>): string[] {
  const raw = readString(env, 'CORS_ORIGINS');
  if (raw === undefined) return [];
  const origins = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

  const wildcard = origins.find((origin) => origin.includes('*'));
  if (wildcard !== undefined) {
    throw new Error(`配置错误：CORS_ORIGINS 不允许通配符 "*"（实际 "${wildcard}"），请给出精确 origin`);
  }
  for (const origin of origins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new Error(`配置错误：CORS_ORIGINS 里的 "${origin}" 不是合法的 origin（形如 https://host[:port]）`);
    }
  }
  return origins;
}

/** TRUST_PROXY 解析：只有明确的真值才开启；非法值直接报错（不静默当作关闭）。 */
function readTrustProxy(env: Record<string, string | undefined>): boolean {
  const raw = readString(env, 'TRUST_PROXY')?.toLowerCase();
  if (raw === undefined) return false;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`配置错误：TRUST_PROXY 只接受 1/true/yes/on 或 0/false/no/off，实际 "${raw}"`);
}

/** PUBLIC_ORIGIN：形如 https://host[:port] 的精确 origin（不带路径）；空 = 未设置。 */
function readPublicOrigin(env: Record<string, string | undefined>): string | undefined {
  const raw = readString(env, 'PUBLIC_ORIGIN');
  if (raw === undefined) return undefined;
  if (!/^https?:\/\/[^/\s]+$/.test(raw)) {
    throw new Error(`配置错误：PUBLIC_ORIGIN 必须是形如 https://host[:port] 的 origin（不带路径），实际 "${raw}"`);
  }
  return raw;
}

function readPositiveInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = readString(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`配置错误：${name} 必须是 1..${max} 的整数，实际为 "${raw}"`);
  }
  return value;
}

/**
 * 读取配置。显式传入 env 便于测试；不传则用 process.env。
 * 非法值一律抛错，不静默回退（避免"以为是默认端口其实是错配置"）。
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const projectRoot = defaultProjectRoot;
  const dataDirRaw = readString(env, 'DATA_DIR');
  return {
    host: readString(env, 'HOST') ?? '0.0.0.0',
    port: readPositiveInt(env, 'PORT', 8767, 65535),
    dataDir: dataDirRaw === undefined ? path.join(projectRoot, 'data') : path.resolve(dataDirRaw),
    sessionTtlHours: readPositiveInt(env, 'SESSION_TTL_HOURS', 720, 876_000),
    loginMaxFailures: readPositiveInt(env, 'LOGIN_MAX_FAILURES', 5, 10_000),
    loginWindowSeconds: readPositiveInt(env, 'LOGIN_WINDOW_SECONDS', 60, 86_400),
    version: readVersion(projectRoot),
    projectRoot,
    webRoot: path.join(projectRoot, 'dist', 'web'),
    migrationsDir: path.join(projectRoot, 'migrations'),
    corsOrigins: readCorsOrigins(env),
    trustProxy: readTrustProxy(env),
    publicOrigin: readPublicOrigin(env),
  };
}
