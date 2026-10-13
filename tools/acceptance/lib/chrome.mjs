// 解析本机可用的 chrome-headless-shell / chromium —— **唯一**的浏览器路径解析点。
//
// 为什么需要它（第三轮项目审视 S2）：46 个入库探针与 `tools/ui-shot.mjs` 曾经把 playwright 的
// **版本目录**写死（`/root/.cache/ms-playwright/chromium_headless_shell-1243/...`）——
// playwright 一升级目录名就变，46 个文件一起失效。这里只认「缓存根 + 目录通配 + 版本号排序」，
// 不认版本号，也不写死任何一台机器的路径。
//
// 解析顺序：
//   1. `PM_CHROME` / `CHROME_PATH`（显式指定，最高优先；CI 或换机器时用）
//   2. playwright 缓存目录（根可用 `PM_PLAYWRIGHT_CACHE` 覆盖，默认 `/root/.cache/ms-playwright`）：
//      · `chromium_headless_shell-<版本>/chrome-headless-shell-linux64/chrome-headless-shell`（首选，最轻）
//      · `chromium-<版本>/chrome-linux/chrome`（完整 chromium，兜底）
//      同族取**版本号最大**的那个（新装的优先），而不是目录名排序（`-999` 会排在 `-1243` 前面）。
//   3. 系统浏览器：`/usr/bin/chromium` 等常见路径。
// 全都没有时**抛错**（带可操作提示），不返回 undefined 让调用方猜。
//
// 用法（模块）：import { resolveChrome } from './lib/chrome.mjs';  const CHROME = resolveChrome();
// 用法（命令行）：node tools/acceptance/lib/chrome.mjs            # 打印解析到的路径（找不到则 rc=1）
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CACHE_ROOT = process.env.PM_PLAYWRIGHT_CACHE ?? '/root/.cache/ms-playwright';

/** playwright 缓存里 chrome-headless-shell 的相对路径后缀。 */
const SHELL_SUFFIX = path.join('chrome-headless-shell-linux64', 'chrome-headless-shell');
/** playwright 缓存里完整 chromium 的相对路径后缀。 */
const FULL_SUFFIX = path.join('chrome-linux', 'chrome');

/** 系统浏览器（发行版包管理器装的），按常见程度排序。 */
const SYSTEM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/opt/google/chrome/chrome',
];

/** 从 `chromium_headless_shell-1243` 这类目录名里取版本号（取不到返回 -1）。 */
function versionOf(name) {
  const match = /-(\d+)$/.exec(name);
  return match === null ? -1 : Number(match[1]);
}

/** 按版本号从大到小列出缓存目录里匹配 `prefix` 的子目录名。 */
function cacheDirs(prefix) {
  let names;
  try {
    names = readdirSync(CACHE_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort((a, b) => versionOf(b) - versionOf(a));
}

/**
 * 候选路径，按解析优先级排列（**不保证存在** —— 调用方用 `existsSync` 过滤，测试也据此断言顺序）。
 */
export function chromeCandidates() {
  const explicit = [process.env.PM_CHROME, process.env.CHROME_PATH].filter(
    (value) => typeof value === 'string' && value !== '',
  );
  const fromCache = [
    ...cacheDirs('chromium_headless_shell-').map((name) => path.join(CACHE_ROOT, name, SHELL_SUFFIX)),
    ...cacheDirs('chromium-').map((name) => path.join(CACHE_ROOT, name, FULL_SUFFIX)),
  ];
  return [...explicit, ...fromCache, ...SYSTEM_CANDIDATES];
}

/**
 * 解析到一个**真实存在**的浏览器可执行文件；都找不到时抛可读错误。
 * `env` 只用于测试注入（默认读进程环境，避免测试改全局 process.env）。
 */
export function resolveChrome(env = process.env) {
  const explicit = [env.PM_CHROME, env.CHROME_PATH].filter((value) => typeof value === 'string' && value !== '');
  const cacheRoot = env.PM_PLAYWRIGHT_CACHE ?? CACHE_ROOT;
  const fromCache = [
    ...cacheDirs('chromium_headless_shell-').map((name) => path.join(cacheRoot, name, SHELL_SUFFIX)),
    ...cacheDirs('chromium-').map((name) => path.join(cacheRoot, name, FULL_SUFFIX)),
  ];
  const candidates = [...explicit, ...fromCache, ...SYSTEM_CANDIDATES];
  const hit = candidates.find((candidate) => existsSync(candidate));
  if (hit === undefined) {
    throw new Error(
      `找不到可用的 chrome-headless-shell / chromium。已尝试：${candidates.join('、')}。\n` +
        '请用 `npx playwright install chromium-headless-shell` 安装，或设 `PM_CHROME=<可执行文件路径>` 显式指定。',
    );
  }
  return hit;
}

// 直接执行时打印解析结果（供 .sh 用：CHROME=$(node tools/acceptance/lib/chrome.mjs)）
if (process.argv[1] !== undefined && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  try {
    console.log(resolveChrome());
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
