import { renameSync, rmSync, writeFileSync } from 'node:fs';
// 注意：数据库模块**只在本地管理命令里动态载入**（pm get / pm render 一律走 HTTP，永远不加载它）
import type { QueryEngine } from '../db/index.js';
import {
  ApiConnectionError,
  apiError,
  apiRequest,
  resolveApiEnv,
  type ApiEnv,
  type ApiResponse,
} from '../client/pm-api.js';

const USAGE = `用法：node bin/pm.mjs <命令> [选项]

命令：
  migrate                              执行 migrations/*.sql（幂等），输出 ok: schema at v<N>
  user set-password --username <u>     设置/新建用户口令（口令从 stdin 读，绝不打印）  [阶段 2]
  export --out <path>                  导出全量 JSON（与 GET /api/export 同格式；用于备份）
  token create --name <n> [--scope read|write]
                                       创建 API Token（明文在 stdout 最后一行；FR-94 起加密落库、可再查看）
                                       --scope 缺省 read（只读：检索/查看/渲染）；write 才能改资源
  token list                           列出 API Token（不含明文；含 revealable / scope）
  token reveal <id>                     查看 API Token 明文（本机管理路径，读同一加密密钥）
  token revoke <id>                     撤销 API Token（立即失效）
  get [<关键词>] [--id <N>] [--json]    经 HTTP API 检索 / 取单个 prompt（需 PM_API_URL+PM_API_TOKEN）
  render --id <N> [--set k=v ...] [--json]  经 HTTP API 渲染变量，缺省输出渲染后的 user_prompt

客户端命令的环境变量：PM_API_URL（默认 http://127.0.0.1:$PORT）、PM_API_TOKEN（Bearer）
退出码：0 成功 / 1 运行时错误 / 2 用法错误
`;

function fail(message: string): number {
  process.stderr.write(`error: ${message}\n`);
  return 1;
}

function usage(message: string): number {
  process.stderr.write(`error: ${message}\n\n${USAGE}`);
  return 2;
}

/** 读尽 stdin；只去掉一个行尾换行（口令可以含空格，不做 trim）。 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function openCliDatabase(): Promise<{
  qe: QueryEngine;
  /** 运行期配置（FR-94：`token reveal` 需要 dataDir 来定位加密密钥文件） */
  config: ReturnType<typeof import('../config.js').loadConfig>;
  close: () => Promise<void>;
}> {
  const { loadConfig } = await import('../config.js');
  const { prepareDatabase } = await import('../db/index.js');
  const config = loadConfig();
  const { qe } = prepareDatabase(config);
  return { qe, config, close: () => qe.destroy() };
}

async function migrate(argv: string[]): Promise<number> {
  const unknown = argv.filter((arg) => arg !== '--help' && arg !== '-h');
  if (unknown.length > 0) return usage(`migrate 不接受参数："${unknown[0]}"`);
  if (argv.length > 0) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    const { loadConfig } = await import('../config.js');
    const { prepareDatabase } = await import('../db/index.js');
    const config = loadConfig();
    const { qe, migration } = prepareDatabase(config);
    try {
      process.stdout.write(`ok: schema at v${migration.version}\n`);
      return 0;
    } finally {
      await qe.destroy();
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

interface ParsedOutArgs {
  out?: string;
  help: boolean;
  unknown: string[];
}

function parseOutArgs(argv: string[]): ParsedOutArgs {
  const parsed: ParsedOutArgs = { help: false, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--out') {
      parsed.out = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--out=')) {
      parsed.out = arg.slice('--out='.length);
    } else {
      parsed.unknown.push(arg);
    }
  }
  return parsed;
}

/** 使用侧命令的连接错误提示（强调"只走 HTTP、不回退直连 DB"）。 */
function clientErrorMessage(error: unknown): string {
  if (error instanceof ApiConnectionError) {
    return `${error.message} —— 本命令只走 HTTP API，不会回退直连数据库`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** `export --out <path>`：与 GET /api/export 同格式（同 JSON 结构），写入采用 tmp+rename。 */
async function exportCommand(argv: string[]): Promise<number> {
  const parsed = parseOutArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.unknown.length > 0) return usage(`未知选项 "${parsed.unknown[0]}"`);
  const out = (parsed.out ?? '').trim();
  if (out === '') return usage('缺少 --out <path>');

  let close: (() => Promise<void>) | undefined;
  try {
    const { buildExport } = await import('../services/export.js');
    const handle = await openCliDatabase();
    close = handle.close;
    const file = await buildExport(handle.qe);
    const json = JSON.stringify(file);
    const tmp = `${out}.tmp`;
    try {
      writeFileSync(tmp, json);
      renameSync(tmp, out);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
    process.stdout.write(
      `ok: exported ${String(file.folders.length)} folders / ${String(file.tags.length)} tags / ${String(file.prompts.length)} prompts -> ${out}\n`,
    );
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (close !== undefined) await close();
  }
}

interface ParsedUserArgs {
  username?: string;
  help: boolean;
  unknown: string[];
}

function parseUserArgs(argv: string[]): ParsedUserArgs {
  const parsed: ParsedUserArgs = { help: false, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--username') {
      parsed.username = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--username=')) {
      parsed.username = arg.slice('--username='.length);
    } else {
      parsed.unknown.push(arg);
    }
  }
  return parsed;
}

async function userSetPassword(argv: string[]): Promise<number> {
  const parsed = parseUserArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.unknown.length > 0) return usage(`未知选项 "${parsed.unknown[0]}"`);

  const username = (parsed.username ?? '').trim();
  if (username === '') return usage('缺少 --username <用户名>');

  const password = await readStdin();
  if (password === '') return usage('口令不能为空（从 stdin 读入）');

  let close: (() => Promise<void>) | undefined;
  try {
    const { setUserPassword } = await import('../services/auth.js');
    const handle = await openCliDatabase();
    close = handle.close;
    await setUserPassword(handle.qe, username, password);
    process.stdout.write(`ok: user ${username} password updated\n`);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (close !== undefined) await close();
  }
}

async function user(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) return usage('user 缺少子命令（当前只有 set-password）');
  if (sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (sub !== 'set-password') return usage(`user 的子命令 "${sub}" 未实现（当前只有 set-password）`);
  return userSetPassword(rest);
}

interface ParsedNameArgs {
  name?: string;
  /** FR-103：`--scope read|write`（缺省 read） */
  scope?: string;
  rest: string[];
  help: boolean;
  unknown: string[];
}

function parseNameArgs(argv: string[]): ParsedNameArgs {
  const parsed: ParsedNameArgs = { rest: [], help: false, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--name') {
      parsed.name = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--name=')) parsed.name = arg.slice('--name='.length);
    else if (arg === '--scope') {
      parsed.scope = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--scope=')) parsed.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--')) parsed.unknown.push(arg);
    else parsed.rest.push(arg);
  }
  return parsed;
}

function printTokenList(
  items: Array<{
    id: number;
    name: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
    scope: string;
  }>,
): void {
  if (items.length === 0) {
    process.stdout.write('(no tokens)\n');
    return;
  }
  for (const item of items) {
    const status = item.revoked_at === null ? 'active' : `revoked@${item.revoked_at}`;
    // FR-103：列出权限（read=只读 / write=读写）
    process.stdout.write(
      `id=${String(item.id)}  name=${item.name}  scope=${item.scope}  created=${item.created_at}  last_used=${item.last_used_at ?? 'never'}  status=${status}\n`,
    );
  }
}

/**
 * FR-16 的 token 子命令。两条通道（见 PROGRESS 阶段 6 §4 决策 1）：
 * - 设了 PM_API_URL（并有 PM_API_TOKEN）→ 走 HTTP `/api/tokens`，**连不上就报错**；
 * - 两者都没设 → 本机引导路径（与 set-password/migrate 同类的本地管理命令），stderr 显式提示通道，stdout 只给明文。
 */
async function token(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined) return usage('token 缺少子命令（create / list / revoke）');
  if (sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (sub !== 'create' && sub !== 'list' && sub !== 'reveal' && sub !== 'revoke') {
    return usage(`token 的子命令 "${sub}" 未实现（create / list / reveal / revoke）`);
  }
  if (sub === 'reveal') {
    // FR-94：reveal **只走本机管理路径**（读同一加密密钥）。HTTP 面刻意只允许 cookie 会话
    // （避免 token 互相窥视），而 CLI 没有 cookie ⇒ 设置 PM_API_URL 时明确拒绝，不回退。
    if (resolveApiEnv().explicit) {
      return usage('token reveal 只支持本机管理路径（不设 PM_API_URL）；HTTP 面只允许浏览器会话调用 /api/tokens/:id/reveal');
    }
  }

  const api = resolveApiEnv();
  if (api.explicit) {
    if (api.token === undefined) {
      return usage('设置了 PM_API_URL 时必须同时设置 PM_API_TOKEN（token 子命令走 HTTP API，不回退直连数据库）');
    }
    return tokenOverHttp(sub, rest, api);
  }

  process.stderr.write('(bootstrap: local admin path —— 未设置 PM_API_URL，按本机管理命令处理)\n');
  return tokenLocal(sub, rest);
}

async function tokenLocal(sub: string, argv: string[]): Promise<number> {
  const parsed = parseNameArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.unknown.length > 0) return usage(`未知选项 "${parsed.unknown[0]}"`);
  if (sub === 'create' && (parsed.name ?? '').trim() === '') {
    return usage('缺少 --name <名字>（token create --name <n>）');
  }

  let close: (() => Promise<void>) | undefined;
  try {
    const tokens = await import('../services/tokens.js');
    const handle = await openCliDatabase();
    close = handle.close;

    if (sub === 'create') {
      /**
       * FR-101：**CLI 建的 token 也要有密文**（否则界面 Token 列显示 `—`、`token reveal` 报 token_not_revealable），
       * 与 HTTP 路（`routes/tokens.ts` 的 `cipherOrUndefined()`）**完全对齐**：**惰性解析**密钥、
       * 失败就降级为 undefined —— **创建永不因密钥失败**（`createToken` 内部会写一条不含明文的 stderr warn）。
       */
      const { loadTokenCipher } = await import('../services/token-crypto.js');
      let cipher;
      try {
        cipher = loadTokenCipher(handle.config);
      } catch (error) {
        cipher = undefined;
        /**
         * 密钥不可用时**必须有可读提示**（AC-103 ⑤）：此时 `createToken` 拿到的是 undefined，
         * 它内部那条 warn 只在"拿到了 cipher 但加密失败"时才会响 ⇒ 这里补一条。
         * ⚠️ 只写原因（路径/长度等），**绝不**打印明文或密钥本身。
         */
        process.stderr.write(
          `warn: 加密密钥不可用，这条 token 之后无法查看（鉴权不受影响）：${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      // FR-103：显式非法 scope 给用法错误（不静默降级）；缺省由服务层取 read
      const scope = parsed.scope === undefined ? undefined : tokens.parseScope(parsed.scope);
      if (parsed.scope !== undefined && scope === null) {
        return usage(`--scope 只能是 read 或 write（收到 "${parsed.scope}"）`);
      }
      const { summary, token: plaintext } = await tokens.createToken(handle.qe, parsed.name, cipher, scope);
      process.stderr.write(
        `ok: token created id=${String(summary.id)} name=${summary.name} scope=${summary.scope}（明文只显示这一次）\n`,
      );
      process.stdout.write(`${plaintext}\n`); // stdout 最后一行 = 明文（AC-22 ① 依赖）
      return 0;
    }
    if (sub === 'list') {
      if (parsed.rest.length > 0) return usage(`list 不接受参数："${parsed.rest[0]}"`);
      printTokenList(await tokens.listTokens(handle.qe));
      return 0;
    }
    if (sub === 'reveal') {
      const rawId = parsed.rest[0];
      if (rawId === undefined) return usage('缺少 <id>（token reveal <id>）');
      const { loadTokenCipher, TokenEncKeyUnavailableError } = await import('../services/token-crypto.js');
      try {
        const plaintext = await tokens.revealToken(handle.qe, Number(rawId), loadTokenCipher(handle.config));
        process.stderr.write(`ok: token ${rawId} revealed（明文在下一行）\n`);
        process.stdout.write(`${plaintext}\n`);
        return 0;
      } catch (error) {
        if (error instanceof TokenEncKeyUnavailableError) return fail(error.message);
        throw error;
      }
    }
    // revoke <id>
    const rawId = parsed.rest[0];
    if (rawId === undefined) return usage('缺少 <id>（token revoke <id>）');
    if (!/^[0-9]+$/.test(rawId)) return usage(`<id> 必须是正整数，实际 "${rawId}"`);
    await tokens.revokeToken(handle.qe, Number(rawId));
    process.stdout.write(`ok: token ${rawId} revoked\n`);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (close !== undefined) await close();
  }
}

async function tokenOverHttp(sub: string, argv: string[], api: ApiEnv): Promise<number> {
  const parsed = parseNameArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.unknown.length > 0) return usage(`未知选项 "${parsed.unknown[0]}"`);
  process.stderr.write(`(http: ${api.url})\n`);

  try {
    if (sub === 'create') {
      if (parsed.name === undefined) return usage('缺少 --name <名字>（token create --name <n>）');
      if (parsed.scope !== undefined && parsed.scope !== 'read' && parsed.scope !== 'write') {
        return usage(`--scope 只能是 read 或 write（收到 "${parsed.scope}"）`);
      }
      const response = await apiRequest('POST', '/api/tokens', {
        name: parsed.name,
        ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
      });
      if (response.status !== 201) return fail(`创建 token 失败：${apiError(response)}`);
      const body = response.json as { id: number; name: string; token: string; scope: string };
      process.stderr.write(
        `ok: token created id=${String(body.id)} name=${body.name} scope=${body.scope}（明文只显示这一次）\n`,
      );
      process.stdout.write(`${body.token}\n`);
      return 0;
    }
    if (sub === 'list') {
      const response = await apiRequest('GET', '/api/tokens');
      if (response.status !== 200) return fail(`列出 token 失败：${apiError(response)}`);
      printTokenList((response.json as { items: [] }).items);
      return 0;
    }
    const rawId = parsed.rest[0];
    if (rawId === undefined) return usage('缺少 <id>（token revoke <id>）');
    if (!/^[0-9]+$/.test(rawId)) return usage(`<id> 必须是正整数，实际 "${rawId}"`);
    const response = await apiRequest('DELETE', `/api/tokens/${rawId}`);
    if (response.status === 404) return fail(`token ${rawId} 不存在`);
    if (response.status !== 204) return fail(`撤销 token 失败：${apiError(response)}`);
    process.stdout.write(`ok: token ${rawId} revoked\n`);
    return 0;
  } catch (error) {
    return fail(clientErrorMessage(error));
  }
}

// ---- `pm get` / `pm render`：**只走 HTTP API**（FR-16），完全不加载数据库模块 ----

interface ParsedGetArgs {
  query?: string;
  id?: string;
  json: boolean;
  help: boolean;
  unknown: string[];
  positional: string[];
}

function parseGetArgs(argv: string[]): ParsedGetArgs {
  const parsed: ParsedGetArgs = { json: false, help: false, unknown: [], positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--id') {
      parsed.id = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--id=')) parsed.id = arg.slice('--id='.length);
    else if (arg.startsWith('--')) parsed.unknown.push(arg);
    else parsed.positional.push(arg);
  }
  return parsed;
}

function requireApiToken(): number | null {
  const { token } = resolveApiEnv();
  if (token === undefined) {
    return usage('缺少 PM_API_TOKEN（使用侧命令一律经 HTTP API，不回退直连数据库）');
  }
  return null;
}

function printPromptLine(prompt: { id: number; title: string; updated_at: string; tags?: string[]; favorite?: boolean }): void {
  const tags = prompt.tags !== undefined && prompt.tags.length > 0 ? `  tags=${prompt.tags.join(',')}` : '';
  const star = prompt.favorite === true ? '  ★' : '';
  process.stdout.write(`id=${String(prompt.id)}  ${prompt.title}  updated=${prompt.updated_at}${tags}${star}\n`);
}

/** `pm get [<关键词>] [--id <N>] [--json]` */
async function getCommand(argv: string[]): Promise<number> {
  const parsed = parseGetArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.unknown.length > 0) return usage(`未知选项 "${parsed.unknown[0]}"`);
  if (parsed.positional.length > 1) return usage(`最多只能给一个关键词，多给了 ${String(parsed.positional.length)} 个参数`);
  if (parsed.id === undefined && parsed.positional.length === 0) {
    return usage('需要关键词或 --id <N>（例如：pm get 会话交接 / pm get --id 3）');
  }
  if (parsed.id !== undefined && !/^[0-9]+$/.test(parsed.id)) return usage(`--id 必须是正整数，实际 "${parsed.id}"`);

  const missingToken = requireApiToken();
  if (missingToken !== null) return missingToken;

  try {
    if (parsed.id !== undefined) {
      const response = await apiRequest('GET', `/api/prompts/${parsed.id}`);
      if (response.status === 404) return fail(`prompt ${parsed.id} 不存在`);
      if (response.status !== 200) return fail(`取 prompt 失败：${apiError(response)}`);
      const prompt = response.json as { id: number; title: string; updated_at: string; tags: string[]; favorite: boolean };
      if (parsed.json) process.stdout.write(`${JSON.stringify(prompt)}\n`);
      else printPromptLine(prompt);
      return 0;
    }

    const query = parsed.positional[0] ?? '';
    const response = await apiRequest('GET', `/api/prompts?q=${encodeURIComponent(query)}&limit=200`);
    if (response.status !== 200) return fail(`检索失败：${apiError(response)}`);
    const body = response.json as { total: number; items: Array<{ id: number; title: string; updated_at: string; tags: string[]; favorite: boolean }> };
    if (parsed.json) process.stdout.write(`${JSON.stringify(body.items)}\n`);
    else {
      process.stdout.write(`total=${String(body.total)}\n`);
      for (const prompt of body.items) printPromptLine(prompt);
    }
    return 0;
  } catch (error) {
    return fail(clientErrorMessage(error));
  }
}

interface ParsedRenderArgs {
  id?: string;
  sets: Record<string, string>;
  json: boolean;
  help: boolean;
  unknown: string[];
}

function parseRenderArgs(argv: string[]): { parsed: ParsedRenderArgs; badSet?: string } {
  const parsed: ParsedRenderArgs = { sets: {}, json: false, help: false, unknown: [] };
  let badSet: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--id') {
      parsed.id = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--id=')) parsed.id = arg.slice('--id='.length);
    else if (arg === '--set' || arg.startsWith('--set=')) {
      const spec = arg === '--set' ? argv[i + 1] : arg.slice('--set='.length);
      if (arg === '--set') i += 1;
      const text = spec ?? '';
      const eq = text.indexOf('=');
      if (eq <= 0) {
        badSet = text;
      } else {
        parsed.sets[text.slice(0, eq).trim()] = text.slice(eq + 1);
      }
    } else if (arg.startsWith('--')) parsed.unknown.push(arg);
  }
  return badSet === undefined ? { parsed } : { parsed, badSet };
}

/** `pm render --id <N> [--set k=v ...] [--json]`：缺省输出渲染后的 user_prompt（逐字符，不加额外换行）。 */
async function renderCommand(argv: string[]): Promise<number> {
  const { parsed, badSet } = parseRenderArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.unknown.length > 0) return usage(`未知选项 "${parsed.unknown[0]}"`);
  if (badSet !== undefined) return usage(`--set 的格式是 key=value（键不能为空），实际 "${badSet}"`);
  if (parsed.id === undefined) return usage('缺少 --id <N>（pm render --id <N> [--set k=v ...]）');
  if (!/^[0-9]+$/.test(parsed.id)) return usage(`--id 必须是正整数，实际 "${parsed.id}"`);

  const missingToken = requireApiToken();
  if (missingToken !== null) return missingToken;

  try {
    const response = await apiRequest('POST', `/api/prompts/${parsed.id}/render`, { values: parsed.sets });
    if (response.status === 404) return fail(`prompt ${parsed.id} 不存在`);
    if (response.status !== 200) return fail(`渲染失败：${apiError(response)}`);
    const body = response.json as { user_prompt: string; system_prompt: string; missing: string[] };
    if (parsed.json) process.stdout.write(`${JSON.stringify(body)}\n`);
    else process.stdout.write(body.user_prompt); // 逐字符输出，不加额外换行
    return 0;
  } catch (error) {
    return fail(clientErrorMessage(error));
  }
}

/** CLI 入口；返回进程退出码（0 成功 / 1 运行时错误 / 2 用法错误，BRIEF §6.2）。 */
export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) return usage('缺少命令');
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (command) {
    case 'migrate':
      return migrate(rest);
    case 'user':
      return user(rest);
    case 'export':
      return exportCommand(rest);
    case 'token':
      return token(rest);
    case 'get':
      return getCommand(rest);
    case 'render':
      return renderCommand(rest);
    default:
      return usage(`未知命令 "${command}"（已交付：migrate、user set-password、export、token、get、render）`);
  }
}
