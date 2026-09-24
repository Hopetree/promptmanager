// 阶段 51 / FR-115（FIX 不含变量复制未计入取用）断言。
//
// 覆盖：新增的 `POST /api/prompts/:id/copy`（**只记账、不返正文、不产生 view**）、
// 前端无变量分支复制成功后调它（+1）、含变量分支**不调它**（弹窗不记、复制结果走 render +1）、
// 以及 FR-113/FR-114 的口径不回归（一次复制一条 / 打开详情只留痕 / 列表搜索不记）。
// 真实界面 + 查库对账（四条分支逐条实测）在 tools/ac-stage51.sh + ac-stage51-probe.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Fixture } from './helpers.ts';
import { cookieOf, login, makeFixture, PROJECT_ROOT, readDb } from './helpers.ts';

const read = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
const strip = (src: string): string =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function makePrompt(fx: Fixture, cookie: string, title: string, userPrompt: string): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload: { title, user_prompt: userPrompt } });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: number }).id;
}

function counts(fx: Fixture, id: number): { copy: number; view: number; counted: number } {
  return readDb(fx, (db) => {
    const row = db
      .prepare(
        `SELECT
           SUM(CASE WHEN kind = 'copy' THEN 1 ELSE 0 END) AS copy,
           SUM(CASE WHEN kind = 'view' THEN 1 ELSE 0 END) AS view,
           SUM(CASE WHEN coalesce(kind,'copy') IN ('copy','mcp') THEN 1 ELSE 0 END) AS counted
         FROM usage_events WHERE prompt_id = ?`,
      )
      .get(id) as { copy: number | null; view: number | null; counted: number | null };
    return { copy: row.copy ?? 0, view: row.view ?? 0, counted: row.counted ?? 0 };
  });
}

test('AC-116 ①（接口级）：`POST /api/prompts/:id/copy` 记 1 条 copy、不返正文、不产生 view', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await makePrompt(fx, cookie, 'AC116 无变量', '固定内容');
    assert.deepEqual(counts(fx, id), { copy: 0, view: 0, counted: 0 }, '起始应无记录');

    const res = await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/copy`, headers: { cookie } });
    assert.equal(res.statusCode, 204, `copy 端点应返回 204：${res.body}`);
    assert.equal(res.body, '', '不得返回正文（只记账）');

    const after = counts(fx, id);
    assert.equal(after.copy, 1, '不含变量复制必须 +1 条 copy（FR-115 的核心）');
    assert.equal(after.counted, 1, '该记录计入取用');
    assert.equal(after.view, 0, 'copy 端点**不得**产生 view（不是"打开详情"）');

    const row = readDb(
      fx,
      (db) =>
        db.prepare('SELECT channel, token_id, kind FROM usage_events WHERE prompt_id = ?').get(id) as {
          channel: string;
          token_id: number | null;
          kind: string;
        },
    );
    assert.equal(row.kind, 'copy');
    assert.equal(row.channel, 'session', '会话复制归因 channel=session');
    assert.equal(row.token_id, null, '会话复制 token_id=null');

    // 不存在 → 404
    const missing = await fx.app.inject({ method: 'POST', url: '/api/prompts/999999/copy', headers: { cookie } });
    assert.equal(missing.statusCode, 404);
  } finally {
    await fx.close();
  }
});

test('AC-116 ①④（接口级）：连调两次 copy ⇒ 恰好 +2（不是 +4、也不是 +0）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await makePrompt(fx, cookie, 'AC116 两次', '固定内容');
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/copy`, headers: { cookie } })).statusCode, 204);
    }
    assert.equal(counts(fx, id).copy, 2, '两次复制 ⇒ 恰好 2 条 copy');
    // 列表/搜索仍不记
    const before = counts(fx, id).counted;
    await fx.app.inject({ method: 'GET', url: '/api/prompts?limit=5', headers: { cookie } });
    await fx.app.inject({ method: 'GET', url: '/api/prompts?q=AC116', headers: { cookie } });
    assert.equal(counts(fx, id).counted, before, '列表/搜索不得记账');
  } finally {
    await fx.close();
  }
});

test('AC-116 ②③⑤（接口级）：弹窗路径不调 copy；render +1；打开详情仍只留痕 view', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await makePrompt(fx, cookie, 'AC116 含变量', '你好 {{姓名}}');

    // ⑤ 打开详情 ⇒ view +1、计入型不变
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.deepEqual(counts(fx, id), { copy: 0, view: 1, counted: 0 }, '打开详情只留痕 view、不计数');

    // ② 弹窗阶段只取变量名 ⇒ 不记账
    await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/variables`, headers: { cookie } });
    assert.deepEqual(counts(fx, id), { copy: 0, view: 1, counted: 0 }, '弹窗阶段不得记账');

    // ③ 复制结果 = render ⇒ copy +1
    await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/render`, headers: { cookie }, payload: { values: { 姓名: '张三' } } });
    assert.deepEqual(counts(fx, id), { copy: 1, view: 1, counted: 1 }, '复制结果 +1 条 copy');
  } finally {
    await fx.close();
  }
});

test('AC-116 ⑦（接口级）：只读令牌也能调 copy（与 render 同档归"资源读"），归因记该令牌 id', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const id = await makePrompt(fx, cookie, 'AC116 令牌', '固定内容');
    const tok = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'AC116 ro', scope: 'read' } });
    const { id: tokenId, token } = tok.json() as { id: number; token: string };
    const bearer = { authorization: `Bearer ${token}` };

    // 只读令牌不是 403（与两个渲染类 POST 同级）
    const res = await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/copy`, headers: bearer });
    assert.equal(res.statusCode, 204, `只读令牌应能用 copy 端点（与 render 同档）：${res.body}`);
    const row = readDb(
      fx,
      (db) =>
        db.prepare('SELECT channel, token_id, kind FROM usage_events WHERE prompt_id = ?').get(id) as {
          channel: string;
          token_id: number | null;
          kind: string;
        },
    );
    assert.equal(row.channel, 'token', '令牌通道归因 channel=token');
    assert.equal(row.token_id, tokenId, '令牌取用必须记该令牌 id（FR-104 口径不变）');
    assert.equal(row.kind, 'copy', '令牌（非 MCP）通道 ⇒ copy');
  } finally {
    await fx.close();
  }
});

test('AC-116 ⑨⑩（源码级）：新端点不动表结构；前端只在"复制成功"后记账且不用 GET 兼职', () => {
  // 端点：只记账、不渲染、不返回正文
  const routes = strip(read('src/server/routes/prompts.ts'));
  assert.ok(/app\.post\('\/api\/prompts\/:id\/copy'/.test(routes), '必须新增 POST /api/prompts/:id/copy');
  const copyRoute = /app\.post\('\/api\/prompts\/:id\/copy'[\s\S]*?\n  \}\);/.exec(routes)?.[0] ?? '';
  assert.ok(copyRoute !== '', '必须能定位 copy 路由');
  assert.ok(/recordUsage\(/.test(copyRoute), 'copy 路由必须记账');
  assert.ok(/reply\.code\(204\)/.test(copyRoute), 'copy 路由返回 204');
  assert.equal(/renderVariables|renderMarkdown/.test(copyRoute), false, 'copy 路由**不得**做渲染');
  assert.equal(/'view'/.test(copyRoute), false, 'copy 路由**不得**记 view');
  assert.equal(/getPrompt\(app\.qe, id\)/.test(copyRoute), true, 'copy 路由仍应校验 prompt 存在（不存在 404）');

  // 归"资源读"：只读令牌可用（与渲染类同档）
  const auth = strip(read('src/server/auth.ts'));
  assert.ok(/\\\/api\\\/prompts\\\/\\d\+\\\/copy\$/.test(auth) || /prompts\\\/\\d\+\\\/copy/.test(auth), 'copy 端点必须归"资源读"（只读令牌可用）');

  // 前端：无变量分支复制成功后记账；且**不得**再引入 getPrompt 兼职
  const copy = strip(read('web/src/use-copy.ts'));
  assert.ok(/if \(ok\) await api\.recordCopy\(prompt\.id\)/.test(copy), '无变量分支必须在复制成功后调 recordCopy');
  assert.equal(/api\.getPrompt\(/.test(copy), false, '不得用 GET /:id 兼职记账（那是 view 语义）');
  assert.ok(/hasVariables\(prompt\.user_prompt, prompt\.system_prompt\)[\s\S]{0,80}setVarsPrompt\(prompt\)/.test(copy), '含变量分支只开弹窗、不记账');
  // 顺序：先写剪贴板再记账（剪贴板需要用户激活，不能被网络请求拖过期）
  assert.ok(/const ok = await copyText\(prompt\.user_prompt, '提示词'\);\s*\n\s*if \(ok\) await api\.recordCopy/.test(copy), '必须先复制成功再记账');
  // api 层
  const api = strip(read('web/src/api.ts'));
  assert.ok(/recordCopy: \(id: number\) => request<void>\('POST', `\/api\/prompts\/\$\{String\(id\)\}\/copy`\)/.test(api), 'api.recordCopy 必须打 copy 端点');
});
