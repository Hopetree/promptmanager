// 阶段 36 / FR-95 / FR-96 / FR-97（BRIEF v47 §4 + §8 AC-97 / AC-98 / AC-99）断言。
//
// 这里覆盖**接口语义 + 前端源码级**；**非安全上下文下的真鼠标复制/粘贴**（AC-97 ①②③⑤）
// 与真鼠标删除/创建（AC-98 ① / AC-99 ①②）在 tools/ac-stage36.sh + ac-stage36-probe.mjs 里跑
// —— 且**必须**用内网 IP（`127.0.0.1` 是安全上下文，会掩盖本阶段的 bug，阶段 35 就是这么漏的）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, PROJECT_ROOT, readDb } from './helpers.ts';

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const webSrc = (rel: string): string => readFileSync(path.join(PROJECT_ROOT, 'web', 'src', rel), 'utf8');
const drawerRaw = webSrc('components/TokenDrawer.tsx');
/**
 * ⚠️ 负向断言必须扫**去掉注释后的代码**：本文件的注释里会**描述**这些规则
 * （"不写 localStorage"、"不再弹明文 Modal"），直接 grep 全文会把注释判成违规（首版就踩了这个假红）。
 */
const drawer = drawerRaw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX 注释 {/* … */}
  .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
  .replace(/^\s*\/\/.*$/gm, ''); // 行注释

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function newToken(fx: Fixture, cookie: string, name: string): Promise<{ id: number; token: string }> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: number; token: string };
}

function countRows(fx: Fixture, id: number): number {
  return readDb(
    fx,
    (db) => (db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE id = ?').get(id) as { n: number }).n,
  );
}

test('AC-98 ②：DELETE /api/tokens/:id/permanent 三态 —— 已撤销 204 / 未撤销 409 token_not_revoked / 不存在 404', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await newToken(fx, cookie, 'permanent');

    // ① 未撤销 → 409
    const active = await fx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${String(token.id)}/permanent`,
      headers: { cookie },
    });
    assert.equal(active.statusCode, 409, active.body);
    assert.equal((active.json() as { error: string }).error, 'token_not_revoked');
    assert.equal(countRows(fx, token.id), 1, '409 时不得删行');

    // ② 先撤销 → 再删 → 204
    const revoke = await fx.app.inject({ method: 'DELETE', url: `/api/tokens/${String(token.id)}`, headers: { cookie } });
    assert.equal(revoke.statusCode, 204, revoke.body);
    const removed = await fx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${String(token.id)}/permanent`,
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 204, removed.body);

    // ③ 不存在 → 404
    const missing = await fx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${String(token.id)}/permanent`,
      headers: { cookie },
    });
    assert.equal(missing.statusCode, 404, missing.body);
  } finally {
    await fx.close();
  }
});

test('AC-98 ③④：真删（列表不含 + 直接查库 0 行）；被撤销的 token 调 API 仍 401；撤销幂等不变', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const token = await newToken(fx, cookie, 'permanent-2');
    await fx.app.inject({ method: 'DELETE', url: `/api/tokens/${String(token.id)}`, headers: { cookie } });

    // ④ 撤销后即失效
    const afterRevoke = await fx.app.inject({
      method: 'GET',
      url: '/api/prompts',
      headers: { authorization: `Bearer ${token.token}` },
    });
    assert.equal(afterRevoke.statusCode, 401, '撤销后该 token 必须已失效');

    // 撤销幂等（重复撤销仍 204）
    const revokeAgain = await fx.app.inject({ method: 'DELETE', url: `/api/tokens/${String(token.id)}`, headers: { cookie } });
    assert.equal(revokeAgain.statusCode, 204, '撤销必须保持幂等');

    const removed = await fx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${String(token.id)}/permanent`,
      headers: { cookie },
    });
    assert.equal(removed.statusCode, 204);

    // ③ 列表不含 + 查库 0
    const list = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    assert.equal((list.json() as { items: Array<{ id: number }> }).items.some((item) => item.id === token.id), false);
    assert.equal(countRows(fx, token.id), 0, '硬删除必须真删行（审计一并消失）');
  } finally {
    await fx.close();
  }
});

test('AC-98 ①（源码级）：只有**已撤销**行渲染「删除」（永久删除+不可恢复文案）；有效行仍是「撤销」', () => {
  // 有效行分支：撤销按钮
  assert.ok(/data-testid=\{`pm-token-revoke-\$\{String\(token\.id\)\}`\}/.test(drawer), '有效行必须有「撤销」');
  // 已撤销分支：删除按钮 + 二次确认 + 不可恢复文案
  assert.ok(/data-testid=\{`pm-token-delete-\$\{String\(token\.id\)\}`\}/.test(drawer), '已撤销行必须有「删除」');
  assert.ok(drawer.includes('永久删除、不可恢复'), '删除确认必须写明"永久删除、不可恢复"');
  assert.ok(/token\.revoked_at === null \?/.test(drawer), '两个按钮必须按 revoked_at 分支渲染');
  // 两个 testid 互斥：删除按钮出现在 else 分支（即 revoked_at 非空时）
  const deleteAt = drawer.indexOf('pm-token-delete-');
  const revokeAt = drawer.indexOf('pm-token-revoke-');
  assert.ok(revokeAt >= 0 && deleteAt > revokeAt, '删除必须写在撤销之后的 else 分支里');
});

test('AC-97 ①（源码级）：抽屉打开时**预取**明文，点「复制」时**同步**写（writeClipboard 之前不得 await）', () => {
  // 预取：load() 里对 revealable 行并发调 revealToken
  assert.ok(/api\.revealToken\(token\.id\)/.test(drawer), 'load() 必须预取明文（revealToken）');
  assert.ok(/Promise\.all\(/.test(drawer), '预取必须并发（Promise.all）');
  /**
   * ⚠️ v50（FR-100）变更：预取**不再排除已撤销行**（撤销 ≠ 销毁，撤销行也要显示掩码并可复制）
   * ⇒ 这条断言**同步改写**为"只按 revealable 过滤"，语义随之更新，不是删掉覆盖。
   */
  assert.ok(/filter\(\(token\) => token\.revealable\)/.test(drawer), '预取只按 revealable 过滤（含已撤销行）');

  // 同步复制：点击处理器里，writeClipboard 之前不得出现 await
  const handlerStart = drawer.indexOf('const copyPlaintext = (id: number): void => {');
  // ⚠️ 边界必须用**代码**（`drawer` 是去注释后的文本，用注释标记当边界会找不到 → slice 到 -1）
  // 阶段 37（FR-98）把展开状态改名 toggleShown → toggleExpanded ⇒ 边界随之更新（断言语义不变）
  const handlerEnd = drawer.indexOf('const revoke');
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, '找不到 copyPlaintext');
  const handler = drawer.slice(handlerStart, handlerEnd);
  const writeAt = handler.indexOf('writeClipboard(plaintext)');
  assert.ok(writeAt > 0, 'copyPlaintext 必须调用 writeClipboard(内存里的明文)');
  assert.equal(
    /\bawait\b/.test(handler.slice(0, writeAt)),
    false,
    'writeClipboard 之前不得 await（否则用户激活过期 ⇒ 内网 HTTP 下写不进剪贴板）',
  );
  assert.equal(/api\.revealToken/.test(handler), false, '点击「复制」时**不得**再发 reveal 请求');
  assert.ok(/plaintexts\.get\(id\)/.test(handler), '明文必须取自内存缓存');
});

test('AC-97 ③④⑤（源码级）：关闭即清缓存 + 内容卸载 + 失败文案指向**真实存在**的路径', () => {
  // 关抽屉清缓存
  assert.ok(/setPlaintexts\(new Map\(\)\)/.test(drawer), '抽屉关闭必须清空明文缓存');
  assert.ok(/destroyOnHidden/.test(drawer), 'Drawer 必须 destroyOnHidden（关闭后 DOM 不残留明文）');
  // 明文不落持久存储：TokenDrawer 里不得出现 localStorage/sessionStorage
  assert.equal(/localStorage|sessionStorage/.test(drawer), false, '明文绝不能写进任何持久存储');

  /**
   * ⚠️ v49（FR-99）变更：UI 里的「显示」入口**随折叠一起被移除**（用户改口，AC-100 作废）。
   * 因此这一条断言的**目标同步改写**为"不再有指向已移除入口的文案 + 改为指向真实存在路径"，
   * 而不是删掉这条覆盖（FR-95 的"文案必须可执行"要求依然成立）。
   */
  assert.equal(/pm-token-show-/.test(drawer), false, '「显示」入口已随折叠移除（FR-99）');
  assert.equal(drawer.includes('「显示」'), false, '不得再出现指向已移除入口的文案');
  assert.ok(/浏览器不允许自动复制/.test(drawer), '仍须有可读的失败提示');
  assert.ok(/pm token reveal/.test(drawer), '失败提示必须指向真实存在路径（命令行 pm token reveal）');
  // 明文仍以"掩码 + 复制"两种方式出现在 UI（不再是可展开的完整明文）
  assert.ok(/maskToken\(/.test(drawer), 'Token 列以掩码展示（前 5 + ... + 后 4）');
  assert.ok(/writeClipboard\(plaintext\)/.test(drawer), '「复制」仍是取完整明文的路径');
});

test('AC-99 ①③（源码级）：创建后**不再有明文 Modal**，改为提示 + 列表刷新；响应形态未改', () => {
  assert.equal(/\bModal\b/.test(drawer), false, 'TokenDrawer 里不得再有 Modal（创建弹窗已删）');
  assert.equal(/setCreated|created\?\.token/.test(drawer), false, '不得再有 created 状态/明文回显');
  assert.ok(/message\.success\('已创建；点列表里的「复制」取明文'\)/.test(drawer), '必须有可读提示');
  assert.ok(/await load\(\)/.test(drawer), '创建后必须刷新列表（新行可直接复制）');
  // 服务端响应形态不变：POST /api/tokens 仍返回明文一次
  assert.ok(
    /reply\.code\(201\)\.send\(\{ \.\.\.summary, token \}\)/.test(
      readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'routes', 'tokens.ts'), 'utf8'),
    ),
    'POST /api/tokens 必须仍返回明文（向后兼容 CLI/脚本）',
  );
});

test('AC-99 ③：新建 token 仍 revealable=true（加密落库未回归）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await newToken(fx, cookie, 'still-revealable');
    const list = await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    const item = (list.json() as { items: Array<{ id: number; revealable: boolean }> }).items.find((i) => i.id === created.id);
    assert.equal(item?.revealable, true);
  } finally {
    await fx.close();
  }
});
