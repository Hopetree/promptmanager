// 第三轮项目审视（S 组"非必改观察" → 本轮收口，用户 m03535 拍板"要动"）：
//   ① `/api`（无尾斜杠）与 `/API` 必须与 `/api/*` **同一口径 fail-closed**：
//      未认证 401 JSON、已认证 404 JSON；不许回落到前端入口 200 HTML。
//      红线原文是"未知 /api 路径 401，不是 404"（AGENTS.md §1.1），`/api` 与 `/API` 字面上漏在外面。
//   ② `:id` 与查询串整数必须按文档的「正整数 / 整数」**严格**解析：
//      `0x10` / `1e3` / `1.0` / `' 1'` 不许被 `Number()` 悄悄收下（`/api/prompts/1.0` 曾能取到 id=1）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';
import { readSource } from './source-text.ts';
import { parseBoundedInt, parsePositiveId } from '../dist/server/params.js';

const API_PATHS = ['/api', '/API', '/api/', '/API/prompts', '/api/no-such-route'];

test('审视收口①：/api 与 /API 未认证一律 401 JSON（fail-closed），不回落到前端入口', async () => {
  const fx = await makeFixture();
  try {
    for (const url of API_PATHS) {
      const res = await fx.app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 401, `${url} 未认证应 401（fail-closed）`);
      assert.match(String(res.headers['content-type']), /application\/json/, `${url} 应是 JSON 错误体`);
    }
    // 阴性对照：只是"以 /api 开头"但不是 API 命名空间的路径，仍走前端入口（不许顺手把 SPA 拦掉）
    const spa = await fx.app.inject({ method: 'GET', url: '/apiary' });
    assert.equal(spa.statusCode, 200, '/apiary 不是 API 路径，应仍是前端入口');
    // 既有公开路径不受影响
    assert.equal((await fx.app.inject({ method: 'GET', url: '/healthz' })).statusCode, 200);
  } finally {
    await fx.close();
  }
});

test('审视收口①：/api 与 /API 已认证一律 404 JSON（不是 SPA HTML）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    for (const url of API_PATHS) {
      const res = await fx.app.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(res.statusCode, 404, `${url} 已认证应 404 not_found`);
      assert.match(String(res.headers['content-type']), /application\/json/, `${url} 应是 JSON 错误体`);
    }
  } finally {
    await fx.close();
  }
});

test('审视收口②：parsePositiveId 只认十进制正整数（0x10 / 1e3 / 1.0 / 带空格一律 404 口径）', () => {
  for (const bad of ['0x10', '1e3', '1.0', ' 1', '1 ', '-1', '0', '', 'abc', '1,0', '1_0']) {
    assert.throws(() => parsePositiveId(bad), /not_found|NotFound/i, `"${bad}" 必须按"不存在"处理`);
  }
  assert.equal(parsePositiveId('1'), 1);
  assert.equal(parsePositiveId('007'), 7, '前导零仍按十进制解析（不破坏既有 URL）');
  assert.equal(parsePositiveId('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => parsePositiveId('9007199254740993'), /not_found|NotFound/i, '超出安全整数范围按不存在处理');
});

test('审视收口②：parseBoundedInt 只认十进制整数（超上限仍截断，空串仍取默认）', () => {
  assert.equal(parseBoundedInt('20', 20, 1, 200), 20);
  assert.equal(parseBoundedInt(undefined, 20, 1, 200), 20);
  assert.equal(parseBoundedInt('', 20, 1, 200), 20, '空串 = 没传 ⇒ 默认值（既有语义）');
  assert.equal(parseBoundedInt('999', 20, 1, 200), 200, '超上限截断（BRIEF §6.1 既有语义）');
  for (const bad of ['0x10', '1e3', '1.0', ' 1', '-1', 'abc']) {
    assert.throws(() => parseBoundedInt(bad, 20, 1, 200), /invalid_body|InvalidBody/i, `"${bad}" 必须 400`);
  }
});

test('审视收口①：闸门 / 404 兜底 / no-store 共用同一个 isApiPath 判据（防三处漂移）', () => {
  const auth = readSource('src/server/auth.ts');
  const app = readSource('src/server/app.ts');
  assert.match(auth, /export function isApiPath\(url: string\): boolean \{/, 'auth.ts 必须导出 isApiPath');
  assert.match(auth, /if \(!isApiPath\(path\)\) return;/, '闸门必须走 isApiPath');
  assert.match(app, /if \(isApiPath\(request\.url\)\) \{/, '404 兜底必须走 isApiPath');
  assert.match(app, /if \(isApiPath\(request\.url\)\) reply\.header\('cache-control', 'no-store'\)/, 'no-store 必须走 isApiPath');
  assert.doesNotMatch(app, /startsWith\('\/api\/'\)/, 'app.ts 不许再自己写 /api/ 前缀判断（判据只能有一份）');
});

test('审视收口②：路由层同口径 —— /api/prompts/1.0 不再等于 /api/prompts/1', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const created = await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '审视收口', user_prompt: '正文' },
    });
    assert.equal(created.statusCode, 201);
    const id = (created.json() as { id: number }).id;

    const strict = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.equal(strict.statusCode, 200, '正常 id 仍 200');
    for (const weird of [`${String(id)}.0`, `${String(id)}e0`, `0x${id.toString(16)}`]) {
      const res = await fx.app.inject({ method: 'GET', url: `/api/prompts/${weird}`, headers: { cookie } });
      assert.equal(res.statusCode, 404, `/api/prompts/${weird} 不许等价于 id=${String(id)}`);
    }
  } finally {
    await fx.close();
  }
});
