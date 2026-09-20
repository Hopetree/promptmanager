import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieOf, login, makeFixture } from './helpers.ts';

async function authed(fx: Awaited<ReturnType<typeof makeFixture>>): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function createPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as Record<string, unknown>;
}

async function putPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  id: number,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: { cookie }, payload });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Record<string, unknown>;
}

test('AC-9：版本列表升序含首版；diff 含 -/+ 行；回滚 = 新版本且不删历史', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const V1_BODY = '第一版正文：会话交接 {{变量A}}';
    const V2_BODY = '第二版正文：改了内容';
    const V3_BODY = '第三版正文：又改了';

    const v1 = await createPrompt(fx, cookie, { title: '版本演示', user_prompt: V1_BODY, notes: 'v1 备注' });
    const id = Number(v1.id);
    assert.equal(v1.version_no, 1);

    const v2 = await putPrompt(fx, cookie, id, { user_prompt: V2_BODY });
    assert.equal(v2.version_no, 2);
    const v3 = await putPrompt(fx, cookie, id, { user_prompt: V3_BODY, notes: 'v3 备注' });
    assert.equal(v3.version_no, 3);

    const versionsRes = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/versions`, headers: { cookie } });
    assert.equal(versionsRes.statusCode, 200, versionsRes.body);
    const versions = versionsRes.json() as { items: Array<{ version_no: number; created_at: string; title: string }> };
    assert.deepEqual(
      versions.items.map((v) => v.version_no),
      [1, 2, 3],
      '升序且含首版',
    );
    for (const item of versions.items) {
      assert.match(item.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(item.title, '版本演示');
    }

    const diffRes = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/diff?from=1&to=3`, headers: { cookie } });
    assert.equal(diffRes.statusCode, 200, diffRes.body);
    const diff = (diffRes.json() as { diff: string }).diff;
    assert.ok(typeof diff === 'string' && diff.length > 0, 'diff 应为非空文本');
    const lines = diff.split('\n');
    assert.ok(lines.some((l) => l.startsWith('-') && !l.startsWith('---')), 'unified diff 必须含删除行');
    assert.ok(lines.some((l) => l.startsWith('+') && !l.startsWith('+++')), 'unified diff 必须含新增行');
    assert.ok(diff.includes(V1_BODY), 'diff 应包含 v1 的正文');
    assert.ok(diff.includes(V3_BODY), 'diff 应包含 v3 的正文');
    assert.match(diff, /@@/);

    const rollbackRes = await fx.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/versions/1/rollback`,
      headers: { cookie },
    });
    assert.equal(rollbackRes.statusCode, 200, rollbackRes.body);
    const rolled = rollbackRes.json() as Record<string, unknown>;
    assert.equal(rolled.version_no, 4, '回滚要生成新版本');
    assert.equal(rolled.user_prompt, V1_BODY, '正文应回到 v1');
    assert.equal(rolled.notes, 'v1 备注', '备注也应回到 v1');
    assert.equal(rolled.title, '版本演示');

    const after = (await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } })).json() as Record<string, unknown>;
    assert.equal(after.user_prompt, V1_BODY);
    assert.equal(Buffer.from(String(after.user_prompt)).equals(Buffer.from(V1_BODY)), true, '正文逐字符一致');

    const versionsAfter = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/versions`, headers: { cookie } })
    ).json() as { items: Array<{ version_no: number }> };
    assert.deepEqual(
      versionsAfter.items.map((v) => v.version_no),
      [1, 2, 3, 4],
      '历史版本一个都不能少',
    );
  } finally {
    await fx.close();
  }
});

test('AC-9 扩展：diff 缺参/非法/越界 → 400；prompt 或版本不存在 → 404', async () => {
  const fx = await makeFixture();
  try {
    const cookie = await authed(fx);
    const created = await createPrompt(fx, cookie, { title: 'x', user_prompt: 'v1' });
    const id = Number(created.id);
    await putPrompt(fx, cookie, id, { user_prompt: 'v2' });

    for (const query of ['', '?from=1', '?to=2', '?from=abc&to=2', '?from=1&to=abc', '?from=0&to=1', '?from=1&to=99', '?from=99&to=1']) {
      const res = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/diff${query}`, headers: { cookie } });
      assert.equal(res.statusCode, 400, `diff${query} 应为 400，实际 ${res.statusCode}：${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'invalid_body');
    }

    const missingPrompt = await fx.app.inject({ method: 'GET', url: '/api/prompts/999999/diff?from=1&to=2', headers: { cookie } });
    assert.equal(missingPrompt.statusCode, 404);

    const missingVersions = await fx.app.inject({ method: 'GET', url: '/api/prompts/999999/versions', headers: { cookie } });
    assert.equal(missingVersions.statusCode, 404);

    const rollbackMissing = await fx.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/versions/99/rollback`, headers: { cookie } });
    assert.equal(rollbackMissing.statusCode, 404);

    const rollbackBadPrompt = await fx.app.inject({ method: 'POST', url: '/api/prompts/999999/versions/1/rollback', headers: { cookie } });
    assert.equal(rollbackBadPrompt.statusCode, 404);
  } finally {
    await fx.close();
  }
});

test('版本接口与回滚需要认证（401），且 diff 对相同版本返回空补丁', async () => {
  const fx = await makeFixture();
  try {
    const anon = await fx.app.inject({ method: 'GET', url: '/api/prompts/1/versions' });
    assert.equal(anon.statusCode, 401);

    const cookie = await authed(fx);
    const created = await createPrompt(fx, cookie, { title: 'same', user_prompt: '同一版' });
    const id = Number(created.id);

    const same = await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}/diff?from=1&to=1`, headers: { cookie } });
    assert.equal(same.statusCode, 200);
    const diff = (same.json() as { diff: string }).diff;
    assert.ok(!diff.split('\n').some((l) => l.startsWith('+') && !l.startsWith('+++')), '同版本不应有新增行');
  } finally {
    await fx.close();
  }
});
