// 阶段 49 / FR-113（FIX 复制一次被记两次取用）断言。
//
// 覆盖：复制路径**不得**为"拿正文"再请求一次会计数的 `GET /api/prompts/:id`；
// 含变量路径仍保留 `render` 那一次；打开详情/列表搜索/MCP 的既有口径不受影响；表结构不变。
// 真实界面操作的**查库对账**（四组对照 + 改前改后对照）在 tools/ac-stage49.sh + ac-stage49-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from './helpers.ts';

const read = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

/** 去掉注释后的源码（源码级断言只检查**真代码**，不检查注释里提到的端点名）。 */
const strip = (src: string): string =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const copy = strip(read('web/src/use-copy.ts'));

test('AC-114 ①②（源码级）：复制路径**不再**为拿正文而 GET `/api/prompts/:id`', () => {
  /**
   * FR-113 的根因：`copyPrompt` 里 `const fresh = await api.getPrompt(prompt.id)`
   * —— 而 `GET /api/prompts/:id` 在服务端是"打开详情记取用"的**同一条路由**（会 recordUsage）。
   * 用户一次「点开 + 复制」于是记了两条（实测 +2）。修法 = 直接用手里的 `prompt.user_prompt`。
   */
  assert.equal(
    /api\.getPrompt\(/.test(copy),
    false,
    '复制路径不得再调 api.getPrompt（那是记取用的端点）—— 正文用调用方传进来的数据',
  );
  assert.ok(
    /await copyText\(prompt\.user_prompt, '提示词'\)/.test(copy),
    '无变量分支应直接复制入参里的 user_prompt',
  );
  // 含变量分支：仍走 render（**保留那一次取用**，不是"完全不记"）
  assert.ok(/api\.render\(prompt\.id, values\)/.test(copy), '含变量分支必须仍走服务端 render（记一次）');
  assert.ok(/copyRendered/.test(copy), 'copyRendered 仍在');
});

test('AC-114 ③④（源码级）：服务端"打开详情记取用 / 列表不记"的口径原样保留', () => {
  const routes = strip(read('src/server/routes/prompts.ts'));
  // 打开详情：仍然记（且是"先记后读"，响应里的 use_count 含本次）
  assert.ok(
    /app\.get\('\/api\/prompts\/:id',[\s\S]*?recordUsage\(/.test(routes),
    'GET /api/prompts/:id 仍必须记一次取用（本次修复不得动它）',
  );
  // render：仍然记（FR-113 明确要保留）
  assert.ok(
    /app\.post\('\/api\/prompts\/:id\/render'[\s\S]*?recordUsage\(/.test(routes),
    'render 仍必须记一次取用',
  );
  // 列表不带 recordUsage（既有口径：列表/搜索不记）
  const listRoute = /app\.get\('\/api\/prompts',[\s\S]*?\n  \}\);/.exec(routes)?.[0] ?? '';
  assert.ok(listRoute !== '', '必须能定位列表路由');
  assert.equal(/recordUsage/.test(listRoute), false, '列表/搜索不得记取用');
});

test('AC-114 ⑦（源码级）：未新增迁移、未改 usage_events 表结构、未改 channel/token_id 语义', () => {
  // 迁移目录仍是 001–005（005 是阶段 42 加的 scope + token_id；本阶段不动数据库）
  const migrations = read('migrations/005_token-scope.sql');
  assert.ok(migrations.length > 0, '005 仍应是阶段 42 那个迁移');
  // 本次修复**只改前端取数方式** ⇒ 不应触碰 usage 服务层
  const usage = strip(read('src/services/usage.ts'));
  assert.ok(/export async function recordUsage/.test(usage), 'recordUsage 签名应保持（仍是 4 参：qe/promptId/channel/tokenId）');
  assert.ok(/tokenId: number \| null = null/.test(usage), 'tokenId 仍是可选且默认 null（会话取用记 NULL）');
  // channel 取值集合不变（session / token / mcp）
  const auth = strip(read('src/server/auth.ts'));
  assert.ok(/export type AuthChannel = 'session' \| 'token' \| 'mcp'/.test(auth), 'channel 三种取值不变');
});

test('AC-114 ⑤（源码级）：MCP 取用记账未被本阶段触碰', () => {
  // MCP 走自己的 HTTP 传输，最终仍打到同一批 /api 路由（带 X-PM-Channel: mcp）⇒ 记账口径自然一致
  const http = read('src/mcp/http.ts');
  assert.ok(/x-pm-channel|X-PM-Channel/i.test(http), 'MCP 传输仍标记 mcp 通道（归因不变）');
  // 本次改动只在 web/src/use-copy.ts，没动 MCP 侧
  const copySrc = read('web/src/use-copy.ts');
  assert.equal(/mcp/i.test(copySrc), false, '复制逻辑不应涉及 MCP 通道判定');
});
