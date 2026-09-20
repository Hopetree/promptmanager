import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cookieOf, login, makeFixture, makeTempDir, removeTempDir } from './helpers.ts';

const BODY = '重启后仍要在：会话交接 ✅ "引号" {{变量}}\n第二行\t制表符';

test('AC-15：建 prompt → 停服 → 同一 DATA_DIR 重启 → 数据与正文逐字符一致', async () => {
  const dir = makeTempDir('pm-restart-');

  // 第一次启动：建 prompt（复用同一个数据目录，close() 不删目录）
  const first = await makeFixture({}, { dir });
  let id = 0;
  let cookie = '';
  try {
    cookie = cookieOf(await login(first.app));
    const created = await first.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: {
        title: '重启持久性',
        user_prompt: BODY,
        system_prompt: 'sys-正文',
        notes: 'notes-正文',
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    id = Number((created.json() as { id: number }).id);
  } finally {
    await first.close(); // 模拟 kill：关闭 HTTP 与数据库连接
  }

  // 端口应已释放（真实进程级验证由 tools/ac-stage2.sh 负责，这里验证连接已关）
  const second = await makeFixture({}, { dir, withUser: false });
  try {
    const list = await second.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } });
    assert.equal(list.statusCode, 200, list.body);
    const body = list.json() as { total: number; items: Array<Record<string, unknown>> };
    assert.equal(body.total, 1);

    const item = body.items.find((row) => row.id === id);
    assert.ok(item, '重启后应仍能查到该 prompt');
    assert.equal(item.title, '重启持久性');
    assert.equal(item.user_prompt, BODY);
    assert.equal(item.system_prompt, 'sys-正文');
    assert.equal(item.notes, 'notes-正文');
    assert.equal(item.version_no, 1);
    assert.equal(Buffer.from(String(item.user_prompt)).equals(Buffer.from(BODY)), true, '正文必须逐字符一致');
  } finally {
    await second.close();
    assert.ok(existsSync(path.join(dir, 'pm.db')), 'pm.db 必须落盘');
    removeTempDir(dir);
  }
});

test('AC-15：会话也在库里（重启后同一 cookie 仍可用，无需重新登录）', async () => {
  const dir = makeTempDir('pm-restart-');
  const first = await makeFixture({}, { dir });
  let cookie = '';
  try {
    cookie = cookieOf(await login(first.app));
  } finally {
    await first.close();
  }

  const second = await makeFixture({}, { dir, withUser: false });
  try {
    const me = await second.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    assert.equal(me.statusCode, 200, me.body);
    assert.deepEqual(me.json(), { username: 'admin' });
  } finally {
    await second.close();
    removeTempDir(dir);
  }
});
