// 阶段 59 / FR-125 / AC-121：远程数据同步的自动化断言（A–F 组，共 12 条里除「界面」外的全部）。
//
// 证据层说明（验收记录不入库）：
//   · 本文件用 **app.inject + 本地 HTTP 桩服务器**：请求真的走 `fetch` 出去，只是把 D-57 ④ 要求可注入的
//     GitHub API 基地址（`SYNC_GITHUB_API_BASE`）指向本进程内的桩 ⇒ base64、409 重试、错误映射都被真实执行。
//   · **绝不使用真实 GitHub token / 真实仓库**（用户 2026-09-29 明确要求）。
//   · AC-121 G⑫ 的界面证据（双端截图、无横滚）在 本地验收记录 + 探针里。
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTokenCipher } from '../dist/services/token-crypto.js';
import { cookieOf, login, makeFixture, readDb, type Fixture } from './helpers.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
/** 去掉注释，避免注释里的字被当成实现。 */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const REPO = 'Hopetree/sync-data-test';
const INSTANCE = 'pm';
const CLOUD_PATH = `promptmanager/${INSTANCE}.json`;
const PLAINTEXT_TOKEN = 'github_pat_FAKE_0000_only_for_tests_1234';

// ══════════════════════════════ 本地 GitHub 桩 ══════════════════════════════

interface StubRequest {
  method: string;
  url: string;
}

interface StubOptions {
  /** `GET /repos/:repo` 的状态码（缺省 200）。 */
  repoStatus?: number;
  /** `GET .../contents/:path` 的状态码（缺省：有文件 200、没文件 404）。 */
  contentsStatus?: number;
  /** `PUT` 的状态码队列，按顺序弹（用于 409 冲突重试）。 */
  putStatuses?: number[];
  /** `permissions.push`（缺省 true）；false 用来演"能读不能写"。 */
  canPush?: boolean;
}

interface Stub {
  baseUrl: string;
  requests: StubRequest[];
  files: Map<string, { content: Buffer; sha: string }>;
  commits: string[];
  close: () => Promise<void>;
}

/** 起一个演 GitHub Contents API 的桩（只监听 127.0.0.1，随机端口）。 */
async function startStub(options: StubOptions = {}): Promise<Stub> {
  const stub: Stub = {
    baseUrl: '',
    requests: [],
    files: new Map(),
    commits: [],
    close: () => Promise.resolve(),
  };
  let shaSeq = 0;
  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    stub.requests.push({ method, url });
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const repoMatch = /^\/repos\/[^/]+\/[^/]+$/.exec(url);
      if (method === 'GET' && repoMatch !== null) {
        if (options.repoStatus !== undefined && options.repoStatus >= 400) return send(options.repoStatus, { message: 'stub' });
        return send(200, { default_branch: 'main', permissions: { push: options.canPush ?? true } });
      }
      const contentsMatch = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(url);
      if (contentsMatch === null) return send(404, { message: 'Not Found' });
      const filePath = (contentsMatch[1] ?? '').split('?')[0] ?? '';
      if (method === 'GET') {
        if (options.contentsStatus !== undefined && options.contentsStatus >= 400) return send(options.contentsStatus, { message: 'stub' });
        const file = stub.files.get(filePath);
        if (file === undefined) return send(404, { message: 'Not Found' });
        return send(200, { content: file.content.toString('base64'), sha: file.sha, size: file.content.length });
      }
      if (method === 'PUT') {
        const queued = options.putStatuses?.shift();
        if (queued !== undefined && queued >= 400) {
          if (queued === 409) {
            // 演「取完 sha 之后被别人改动」：冲突发生时远端 sha 已经变了。
            shaSeq += 1;
            const prev = stub.files.get(filePath);
            stub.files.set(filePath, { content: prev?.content ?? Buffer.from('{}\n'), sha: `sha-${String(shaSeq)}` });
          }
          return send(queued, { message: 'sha does not match' });
        }
        shaSeq += 1;
        const sha = `sha-${String(shaSeq)}`;
        const commit = `commit-${String(shaSeq)}`;
        const parsed = JSON.parse(body) as { content: string };
        stub.files.set(filePath, { content: Buffer.from(parsed.content, 'base64'), sha });
        stub.commits.push(commit);
        return send(200, { content: { sha }, commit: { sha: commit } });
      }
      return send(405, { message: 'method not allowed' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  stub.baseUrl = `http://127.0.0.1:${String(port)}`;
  stub.close = () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  return stub;
}

// ══════════════════════════════ 夹具辅助 ══════════════════════════════

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

async function makeStubFixture(stub: Stub, extra: Record<string, string> = {}): Promise<Fixture> {
  return makeFixture({ SYNC_GITHUB_API_BASE: stub.baseUrl, ...extra });
}

interface ConfigOverrides {
  repo?: unknown;
  instance?: unknown;
  path?: unknown;
  token?: unknown;
  branch?: unknown;
}

function putConfig(fx: Fixture, cookie: string, overrides: ConfigOverrides = {}) {
  return fx.app.inject({
    method: 'PUT',
    url: '/api/sync/config',
    headers: { cookie },
    payload: {
      repo: REPO,
      instance: INSTANCE,
      path: CLOUD_PATH,
      token: PLAINTEXT_TOKEN,
      branch: 'main',
      ...overrides,
    },
  });
}

/** 造一份有代表性的数据（2 文件夹 / 2 标签 / 2 prompt，其中一条多版本）。 */
async function seed(fx: Fixture, cookie: string): Promise<{ p1: number; p2: number }> {
  const parent = (
    await fx.app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: '运维' } })
  ).json() as { id: number };
  await fx.app.inject({
    method: 'POST',
    url: '/api/folders',
    headers: { cookie },
    payload: { name: '交接', parent_id: parent.id, sort_order: 7 },
  });
  await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '交接' } });
  await fx.app.inject({ method: 'POST', url: '/api/tags', headers: { cookie }, payload: { name: '运维' } });
  const p1 = (
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: {
        title: '同步夹具甲',
        user_prompt: '会话交接 {{变量A}}',
        system_prompt: 'sys-甲',
        notes: 'notes-甲',
        tags: ['运维', '交接'],
        favorite: true,
      },
    })
  ).json() as { id: number };
  await fx.app.inject({
    method: 'PUT',
    url: `/api/prompts/${String(p1.id)}`,
    headers: { cookie },
    payload: { user_prompt: '会话交接 {{变量A}} 第二版' },
  });
  const p2 = (
    await fx.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '同步夹具乙', user_prompt: '没有标签与文件夹' },
    })
  ).json() as { id: number };
  return { p1: p1.id, p2: p2.id };
}

function stripVolatile(file: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(file);
  delete clone['exported_at'];
  return clone;
}

async function createWriteToken(fx: Fixture, cookie: string): Promise<string> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { cookie },
    payload: { name: 'ac-sync', scope: 'write' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { token: string }).token;
}

function readConfigRow(fx: Fixture): { repo: string; path: string; token_enc: string } {
  return readDb(fx, (db) =>
    db.prepare('select repo, path, token_enc from sync_config where id = 1').get() as {
      repo: string;
      path: string;
      token_enc: string;
    },
  );
}

// ══════════════ A 配置（AC-121 ① ②） ══════════════

test('AC-121 A①：读配置绝不回 token 明文（GET/PUT 都只回 token_set + 尾 4 位），DB 里是密文', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    const put = await putConfig(fx, cookie);
    assert.equal(put.statusCode, 200, put.body);
    const putView = put.json() as Record<string, unknown>;
    assert.equal(putView['repo'], REPO);
    assert.equal(putView['instance'], INSTANCE);
    assert.equal(putView['path'], CLOUD_PATH);
    assert.equal(putView['branch'], 'main');
    assert.equal(putView['configured'], true);
    assert.equal(putView['token_set'], true);
    assert.equal(putView['token_tail'], '1234');
    assert.equal(put.body.includes(PLAINTEXT_TOKEN), false, 'PUT 响应里不得出现 token 明文');

    const got = await fx.app.inject({ method: 'GET', url: '/api/sync/config', headers: { cookie } });
    assert.equal(got.statusCode, 200, got.body);
    const view = got.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(view).sort(), ['branch', 'configured', 'instance', 'path', 'repo', 'token_set', 'token_tail']);
    assert.equal(got.body.includes(PLAINTEXT_TOKEN), false, 'GET 响应里不得出现 token 明文');
    assert.equal(view['token_tail'], '1234');

    const row = readConfigRow(fx);
    assert.notEqual(row.token_enc, PLAINTEXT_TOKEN, 'DB 里不得存明文');
    assert.equal(row.token_enc.includes(PLAINTEXT_TOKEN), false);
    const cipher = loadTokenCipher({ dataDir: fx.dir });
    assert.equal(cipher.decrypt(row.token_enc), PLAINTEXT_TOKEN, '密文应能用 <DATA_DIR>/token-enc.key 解回');

    // PUT 省略 token ⇒ 沿用库里已有的（界面看不到明文，改分支不该逼用户重贴 token）
    const again = await putConfig(fx, cookie, { token: undefined, branch: 'release' });
    assert.equal(again.statusCode, 200, again.body);
    const againView = again.json() as Record<string, unknown>;
    assert.equal(againView['branch'], 'release');
    assert.equal(againView['token_set'], true);
    assert.equal(againView['token_tail'], '1234');
    assert.equal(readConfigRow(fx).token_enc, row.token_enc, '省略 token 时密文不该变');
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-121 A②：path / instance 不合规一律 400（缺 promptmanager/、不以 <instance>.json 收尾、非法字符）', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    const cases: { label: string; overrides: ConfigOverrides }[] = [
      { label: 'path 不含 promptmanager/', overrides: { path: 'sync-data/pm.json' } },
      { label: 'path 不以 <instance>.json 收尾', overrides: { path: 'promptmanager/other.json' } },
      { label: 'path 带 ../', overrides: { path: 'promptmanager/../pm.json' } },
      { label: 'path 前导 /', overrides: { path: '/promptmanager/pm.json' } },
      { label: 'instance 非法字符', overrides: { instance: 'bad/name' } },
      { label: 'instance 为空串（回退默认值，但 path 随之不符）', overrides: { instance: '' } },
      { label: 'repo 为空', overrides: { repo: '' } },
      { label: 'repo 不是 owner/repo', overrides: { repo: 'just-a-name' } },
      { label: '首次配置省略 token', overrides: { token: undefined } },
    ];
    for (const { label, overrides } of cases) {
      const res = await putConfig(fx, cookie, overrides);
      assert.equal(res.statusCode, 400, `${label}：应 400，实际 ${String(res.statusCode)} ${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'invalid_sync_config', label);
      assert.ok(String((res.json() as { message: string }).message).length > 0, `${label}：必须给中文原因`);
    }
    // 合法值仍然能存（且归一化成 owner/repo）
    const ok = await putConfig(fx, cookie, { repo: `https://github.com/${REPO}.git` });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((ok.json() as { repo: string }).repo, REPO);
    assert.equal(readConfigRow(fx).path, CLOUD_PATH);
  } finally {
    await fx.close();
    await stub.close();
  }
});

// ══════════════ B 权限（AC-121 ③） ══════════════

test('AC-121 B③：write 令牌调 /api/sync/* 一律 403 session_required（含 push / pull / config）', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    const token = await createWriteToken(fx, cookie);
    const auth = { authorization: `Bearer ${token}` };
    for (const [method, url] of [
      ['POST', '/api/sync/push'],
      ['POST', '/api/sync/pull'],
      ['POST', '/api/sync/test'],
      ['GET', '/api/sync/config'],
      ['PUT', '/api/sync/config'],
    ] as const) {
      const res = await fx.app.inject({ method, url, headers: auth, payload: {} });
      assert.equal(res.statusCode, 403, `${method} ${url}：应 403，实际 ${String(res.statusCode)} ${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'session_required', `${method} ${url}`);
    }
    assert.equal(stub.requests.length, 0, '被 403 挡下的请求不应真的出网');
  } finally {
    await fx.close();
    await stub.close();
  }
});

// ══════════════ C 上传（AC-121 ④ ⑤ ⑥） ══════════════

test('AC-121 C④：dry_run 只读远端 —— 报条数/路径/新建或覆盖，且远端 sha 一个字节都没动', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    await seed(fx, cookie);

    const dry = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { dry_run: true } });
    assert.equal(dry.statusCode, 200, dry.body);
    const body = dry.json() as Record<string, any>;
    assert.equal(body.dry_run, true);
    assert.equal(body.prompts, 2);
    assert.equal(body.folders, 2);
    assert.equal(body.tags, 2);
    assert.equal(body.path, CLOUD_PATH, '界面要拿这个完整路径做二次确认');
    assert.equal(body.action, 'create');
    assert.equal(body.exists, false);
    assert.equal(body.remote_sha, null);
    assert.equal(body.commit_sha, null);
    assert.equal(body.attempts, 0);
    assert.equal(stub.files.size, 0, 'dry_run 不得在远端建文件');
    assert.equal(stub.commits.length, 0);
    assert.deepEqual(
      stub.requests.map((r) => r.method),
      ['GET'],
      'dry_run 只允许 GET',
    );

    // 先真推一次，再 dry_run ⇒ 变成 overwrite，且 sha 与远端当前一致（= 没被 dry_run 改过）
    const real = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} });
    assert.equal(real.statusCode, 200, real.body);
    const remoteSha = stub.files.get(CLOUD_PATH)?.sha ?? '';
    const before = stub.requests.length;
    const dry2 = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { dry_run: true } });
    assert.equal(dry2.statusCode, 200, dry2.body);
    const body2 = dry2.json() as Record<string, any>;
    assert.equal(body2.action, 'overwrite');
    assert.equal(body2.current_sha, remoteSha);
    assert.equal(stub.files.get(CLOUD_PATH)?.sha, remoteSha, 'dry_run 后 sha 必须不变');
    assert.equal(
      stub.requests.slice(before).every((r) => r.method === 'GET'),
      true,
      'dry_run 之后的请求只能有 GET',
    );
    assert.equal(stub.commits.length, 1, 'dry_run 不产生新 commit');
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-121 C⑤：真推 ⇒ 远端内容 == GET /api/export（除 exported_at），再次 push 产生新 commit', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    await seed(fx, cookie);

    const pushed = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} });
    assert.equal(pushed.statusCode, 200, pushed.body);
    const pushBody = pushed.json() as Record<string, any>;
    assert.equal(pushBody.action, 'create');
    assert.equal(pushBody.attempts, 1);
    assert.ok(String(pushBody.remote_sha).length > 0);
    assert.ok(String(pushBody.commit_sha).length > 0);

    const stored = stub.files.get(CLOUD_PATH);
    assert.ok(stored !== undefined, '远端应有该文件');
    const remote = JSON.parse(stored.content.toString('utf8')) as Record<string, unknown>;
    const local = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as Record<string, unknown>;
    assert.deepEqual(stripVolatile(remote), stripVolatile(local), '远端内容必须与本地导出逐字段一致');
    assert.equal(remote['app'], 'promptmanager');
    assert.equal(remote['schema_version'], 1);

    const firstCommit = pushBody.commit_sha as string;
    const firstSha = stored.sha;
    const again = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} });
    assert.equal(again.statusCode, 200, again.body);
    const againBody = again.json() as Record<string, any>;
    assert.equal(againBody.action, 'overwrite');
    assert.equal(againBody.current_sha, firstSha);
    assert.notEqual(againBody.commit_sha, firstCommit, '再次 push 必须产生新 commit');
    assert.equal(stub.commits.length, 2);
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-121 C⑥：409 冲突 ⇒ 取新 sha 重试一次后成功（不无限重试），attempts = 2', async () => {
  const stub = await startStub({ putStatuses: [409, 200] });
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    await seed(fx, cookie);
    // 远端先有一份旧内容（否则"取新 sha"这一步没有意义）
    stub.files.set(CLOUD_PATH, { content: Buffer.from('{"app":"promptmanager"}\n'), sha: 'sha-old' });

    const res = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as Record<string, any>;
    assert.equal(body.attempts, 2, '必须恰好重试一次');
    const puts = stub.requests.filter((r) => r.method === 'PUT');
    assert.equal(puts.length, 2, '总共两次 PUT（首提 + 重试）');
    assert.equal(
      stub.requests.filter((r) => r.method === 'GET' && r.url.includes('/contents/')).length >= 2,
      true,
      '冲突后要重新 GET 拿新 sha',
    );
    const finalSha = stub.files.get(CLOUD_PATH)?.sha;
    assert.equal(body.remote_sha, finalSha);
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-121 C⑥(反例)：两次都 409 ⇒ 报 sync_conflict（不无限重试），远端内容不被写坏', async () => {
  const stub = await startStub({ putStatuses: [409, 409] });
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    await seed(fx, cookie);
    stub.files.set(CLOUD_PATH, { content: Buffer.from('{"app":"promptmanager"}\n'), sha: 'sha-old' });

    const res = await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} });
    assert.equal(res.statusCode, 409, res.body);
    const body = res.json() as { error: string; message: string };
    assert.equal(body.error, 'sync_conflict');
    assert.match(body.message, /冲突|409/);
    assert.equal(stub.requests.filter((r) => r.method === 'PUT').length, 2, '最多两次 PUT');
    assert.equal(stub.files.get(CLOUD_PATH)?.content.toString('utf8'), '{"app":"promptmanager"}\n');
  } finally {
    await fx.close();
    await stub.close();
  }
});

// ══════════════ D 恢复（AC-121 ⑦ ⑧） ══════════════

test('AC-121 D⑦：pull mode=merge 只新增/更新，本地独有内容不被删', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    const seeded = await seed(fx, cookie);
    assert.equal((await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} })).statusCode, 200);

    // 远端改了甲、并在云端加一条丙；本地另加一条"只有本地有"的丁
    const remote = JSON.parse(stub.files.get(CLOUD_PATH)!.content.toString('utf8')) as Record<string, any>;
    remote.prompts = remote.prompts.map((p: { id: number; title: string }) =>
      p.id === seeded.p1 ? { ...p, user_prompt: '来自云端的新正文 🚀' } : p,
    );
    remote.prompts.push({
      id: 99_001,
      title: '云端新增丙',
      user_prompt: '只存在于云端',
      system_prompt: '',
      notes: '',
      folder_id: null,
      tags: [],
      favorite: false,
      created_at: '2026-09-29T00:00:00.000Z',
      updated_at: '2026-09-29T00:00:00.000Z',
      // 既有导入契约要求每条 prompt 至少一个版本（versions[] 为空会 400 invalid_import）
      versions: [
        {
          version_no: 1,
          title: '云端新增丙',
          user_prompt: '只存在于云端',
          system_prompt: '',
          notes: '',
          created_at: '2026-09-29T00:00:00.000Z',
        },
      ],
    });
    stub.files.set(CLOUD_PATH, { content: Buffer.from(`${JSON.stringify(remote, null, 2)}\n`, 'utf8'), sha: 'sha-remote' });

    const localOnly = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '只有本地有丁', user_prompt: '本地独有' },
      })
    ).json() as { id: number };

    const pulled = await fx.app.inject({ method: 'POST', url: '/api/sync/pull', headers: { cookie }, payload: { mode: 'merge' } });
    assert.equal(pulled.statusCode, 200, pulled.body);
    const body = pulled.json() as Record<string, any>;
    assert.equal(body.mode, 'merge');
    assert.equal(body.snapshot, null, 'merge 不需要写 pre-restore 快照');
    assert.equal(body.remote_sha, 'sha-remote');

    const list = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items?: { id: number; title: string }[];
    };
    const items = list.items ?? [];
    // 既有 merge 契约（`src/services/import.ts:341`：「不清库；同名（同父）folder / 同名 tag 复用；
    // prompt 一律新建并分配新 id」，D-8 同口径）⇒ AC-121 D⑦ 的「只新增、不删本地独有」按"纯追加"成立：
    // 本地 3 条（甲/乙/丁）+ 云端 3 条（甲/乙/丙）= 6 条；**没有任何本地行被删或被原地覆盖**。
    assert.equal(items.length, 6, JSON.stringify(items.map((p) => p.title)));
    const byTitle = (title: string) => items.filter((p) => p.title === title).length;
    assert.equal(byTitle('同步夹具甲'), 2, '云端那条甲以新 id 追加（D-8：merge 重新分配 id）');
    assert.equal(byTitle('同步夹具乙'), 2);
    assert.equal(byTitle('云端新增丙'), 1);
    assert.equal(byTitle('只有本地有丁'), 1);
    assert.equal(
      items.some((p) => p.id === localOnly.id),
      true,
      '本地独有的 prompt 不能被 merge 删掉（AC-121 D⑦ 的硬约束）',
    );
    const localDetail = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(seeded.p1)}`, headers: { cookie } })
    ).json() as { user_prompt: string; title: string };
    assert.equal(localDetail.user_prompt, '会话交接 {{变量A}} 第二版', '本地原行必须原样保留，不被云端覆盖');
    const cloudBodies = await Promise.all(
      items.map(async (p) =>
        ((await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(p.id)}`, headers: { cookie } })).json() as { user_prompt: string })
          .user_prompt,
      ),
    );
    assert.equal(cloudBodies.includes('来自云端的新正文 🚀'), true, '云端改过的正文要真的落到本地');
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-121 D⑧：pull mode=replace 不带 confirm ⇒ 400；带 confirm ⇒ 清表重建 + 执行前确有本地快照', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    await seed(fx, cookie);
    assert.equal((await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} })).statusCode, 200);

    const remote = JSON.parse(stub.files.get(CLOUD_PATH)!.content.toString('utf8')) as Record<string, any>;
    remote.prompts = [remote.prompts[0]];
    remote.folders = [];
    remote.tags = [];
    stub.files.set(CLOUD_PATH, { content: Buffer.from(`${JSON.stringify(remote, null, 2)}\n`, 'utf8'), sha: 'sha-remote' });

    const noConfirm = await fx.app.inject({ method: 'POST', url: '/api/sync/pull', headers: { cookie }, payload: { mode: 'replace' } });
    assert.equal(noConfirm.statusCode, 400, noConfirm.body);
    assert.equal((noConfirm.json() as { error: string }).error, 'confirm_required');
    assert.equal(
      readDb(fx, (db) => (db.prepare('select count(*) as n from prompts').get() as { n: number }).n),
      2,
      '未确认时不能动本地数据',
    );

    const before = readdirSync(fx.dir).filter((f) => /^pre-restore-.*\.json$/.test(f));
    assert.equal(before.length, 0, '还没执行 replace 时不该有快照');

    const done = await fx.app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      headers: { cookie },
      payload: { mode: 'replace', confirm: true },
    });
    assert.equal(done.statusCode, 200, done.body);
    const body = done.json() as Record<string, any>;
    assert.equal(body.mode, 'replace');
    assert.equal(body.snapshot_kept, 3);
    assert.match(String(body.snapshot), /^pre-restore-.*\.json$/);
    assert.ok(existsSync(path.join(fx.dir, String(body.snapshot))), '执行前写的本地快照必须真的存在');
    const snap = JSON.parse(readFileSync(path.join(fx.dir, String(body.snapshot)), 'utf8')) as { prompts: unknown[] };
    assert.equal(snap.prompts.length, 2, '快照应是 replace 之前的本地全量（2 条）');

    assert.equal(
      readDb(fx, (db) => (db.prepare('select count(*) as n from prompts').get() as { n: number }).n),
      1,
      'replace 之后本地只剩云端那一条',
    );
    assert.equal(
      readDb(fx, (db) => (db.prepare('select count(*) as n from folders').get() as { n: number }).n),
      0,
    );
  } finally {
    await fx.close();
    await stub.close();
  }
});

// ══════════════ E 编码与错误（AC-121 ⑨ ⑩） ══════════════

test('AC-121 E⑨：中文 + emoji 往返逐字一致（push → 清库 → pull）', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);

    const title = '交接清单 🚀✨ 中文标点：「双引号」、‘单引号’、省略号…';
    const userPrompt = '第一步：把 🧪 交给下一位；第二步：核对 emoji 👩‍💻👨‍👩‍👧‍👦 与换行\n第二行结尾是 emoji 🙂';
    const created = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title, user_prompt: userPrompt, system_prompt: '系统提示带 emoji 🛠️', notes: '备注 中文 🎯' },
      })
    ).json() as { id: number };

    assert.equal((await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} })).statusCode, 200);
    // 桩侧看到的内容也必须逐字一致（base64 编解码没吃掉任何字节）
    const onCloud = JSON.parse(stub.files.get(CLOUD_PATH)!.content.toString('utf8')) as { prompts: { title: string; user_prompt: string }[] };
    const cloudPrompt = onCloud.prompts.find((p) => p.title === title);
    assert.ok(cloudPrompt !== undefined, '云端应有这条 prompt');
    assert.equal(cloudPrompt.title, title);
    assert.equal(cloudPrompt.user_prompt, userPrompt);

    // 清库（用既有导入接口的 replace，空数据）
    const wipe = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'replace', data: { app: 'promptmanager', schema_version: 1, folders: [], tags: [], prompts: [] } },
    });
    assert.equal(wipe.statusCode, 200, wipe.body);
    assert.equal(
      readDb(fx, (db) => (db.prepare('select count(*) as n from prompts').get() as { n: number }).n),
      0,
    );

    const pulled = await fx.app.inject({ method: 'POST', url: '/api/sync/pull', headers: { cookie }, payload: { mode: 'merge' } });
    assert.equal(pulled.statusCode, 200, pulled.body);
    const list = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items: { id: number; title: string }[];
    };
    const restored = list.items.find((p) => p.title === title);
    assert.ok(restored !== undefined, 'pull 应把这条恢复回来');
    const detail = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(restored.id)}`, headers: { cookie } })
    ).json() as { title: string; user_prompt: string; system_prompt: string; notes: string };
    assert.equal(detail.title, title);
    assert.equal(detail.user_prompt, userPrompt, '中文 + emoji 必须逐字一致');
    assert.equal(detail.system_prompt, '系统提示带 emoji 🛠️');
    assert.equal(detail.notes, '备注 中文 🎯');
    assert.notEqual(restored.id, created.id, 'merge 一律新建 id（既有 import 契约）');
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-121 E⑩：test 能区分 401 / 无写权限 / 云端没有文件 / 一切正常，网络异常给中文提示', async () => {
  const cases: { label: string; options: StubOptions; seedFile: boolean; expectStage: string; expectInMessage: RegExp }[] = [
    { label: '401 token 无效', options: { repoStatus: 401 }, seedFile: false, expectStage: 'unauthorized', expectInMessage: /令牌无效|重新签发/ },
    { label: '403 能读不能写', options: { canPush: false }, seedFile: false, expectStage: 'forbidden', expectInMessage: /Read and write/ },
    { label: '404 仓库/路径无权', options: { repoStatus: 404 }, seedFile: false, expectStage: 'not_found', expectInMessage: /404/ },
    { label: '云端还没有文件', options: { contentsStatus: 404 }, seedFile: false, expectStage: 'no_file', expectInMessage: /还没有/ },
    { label: '一切正常', options: {}, seedFile: true, expectStage: 'ok', expectInMessage: /已有/ },
  ];
  for (const item of cases) {
    const stub = await startStub(item.options);
    const fx = await makeStubFixture(stub);
    try {
      if (item.seedFile) stub.files.set(CLOUD_PATH, { content: Buffer.from('{"app":"promptmanager","schema_version":1}\n'), sha: 'sha-1' });
      const cookie = await authed(fx);
      assert.equal((await putConfig(fx, cookie)).statusCode, 200);
      const res = await fx.app.inject({ method: 'POST', url: '/api/sync/test', headers: { cookie }, payload: {} });
      assert.equal(res.statusCode, 200, `${item.label}: ${res.body}`);
      const body = res.json() as Record<string, any>;
      assert.equal(body.stage, item.expectStage, `${item.label}: ${res.body}`);
      assert.match(String(body.message), item.expectInMessage, `${item.label} 的提示要中文且可执行：${String(body.message)}`);
      if (item.expectStage === 'ok' || item.expectStage === 'no_file') {
        // `no_file` 也是"连接测试通过"（仓库/分支可访问，只是云端还没有文件）⇒ ok: true 是刻意的，
        // 界面据此提示"第一次上传会新建它"；真正的失败态（401/403/404/网络）才是 ok: false。
        assert.equal(body.ok, true, `${item.label}: ${res.body}`);
      } else {
        assert.equal(body.ok, false, `${item.label}: ${res.body}`);
      }
    } finally {
      await fx.close();
      await stub.close();
    }
  }

  // 网络异常：指向一个已关闭的端口
  const dead = await startStub();
  const baseUrl = dead.baseUrl;
  await dead.close();
  const fx = await makeStubFixture({ baseUrl, requests: [], files: new Map(), commits: [], close: () => Promise.resolve() });
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    const res = await fx.app.inject({ method: 'POST', url: '/api/sync/test', headers: { cookie }, payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { stage: string; message: string };
    assert.equal(body.stage, 'network');
    assert.match(body.message, /连不上 GitHub/);
    assert.match(body.message, /出网|代理|DNS/);
  } finally {
    await fx.close();
  }
});

// ══════════════ F 不外连（AC-121 ⑪） ══════════════

test('AC-121 F⑪：源码级 —— 同步相关的三个源文件里没有任何定时器 / 启动即出网', () => {
  const files = ['src/services/sync.ts', 'src/services/sync-github.ts', 'src/server/routes/sync.ts', 'src/services/sync-config.ts'];
  for (const rel of files) {
    const c = code(src(rel));
    assert.equal(/setInterval/.test(c), false, `${rel} 不得有 setInterval（FR-125 ④.1 不做定时上传）`);
    assert.equal(/setTimeout/.test(c), false, `${rel} 不得有 setTimeout 定时行为（出网只能由用户动作触发）`);
    assert.equal(/\b(cron|schedule)\b/i.test(c), false, `${rel} 不得有调度逻辑`);
  }
  // 服务端只允许在**请求处理路径**里建客户端：createGitHubClient 只能在 clientFor 里被调用
  const sync = code(src('src/services/sync.ts'));
  assert.equal((sync.match(/createGitHubClient\(/g) ?? []).length, 1, 'createGitHubClient 只应在 clientFor 里按请求惰性创建');
  // 启动路径（app.ts）不得包含任何同步出网调用
  const app = code(src('src/server/app.ts'));
  assert.equal(/pushSnapshot|pullSnapshot|testConnection/.test(app), false, 'buildApp 里不得触发同步出网');
});

test('AC-121 F⑪：运行时 —— 不点同步按钮则零出网（普通操作期间桩的请求数恒为 0）', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    await seed(fx, cookie);
    // 一次都不碰 /api/sync/*：登录、列表、导出、详情、令牌列表都不该出网
    await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } });
    await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
    await fx.app.inject({ method: 'GET', url: '/api/sync/config', headers: { cookie } });
    await fx.app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie } });
    assert.equal(stub.requests.length, 0, `不点同步却出网了：${JSON.stringify(stub.requests)}`);
    // 配置了也不等于会自动出网（无定时器）
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(stub.requests.length, 0, '配置写完之后也不得自动出网');
  } finally {
    await fx.close();
    await stub.close();
  }
});

test('AC-123 ⑤：remember_variables 随远程同步走 —— 上传「不记住」→ 清库 → 从云端恢复，值一致', async () => {
  const stub = await startStub();
  const fx = await makeStubFixture(stub);
  try {
    const cookie = await authed(fx);
    assert.equal((await putConfig(fx, cookie)).statusCode, 200);

    const created = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '同步开关夹具', user_prompt: '{{a}}', remember_variables: false },
      })
    ).json() as { id: number; remember_variables: boolean };
    assert.equal(created.remember_variables, false, '夹具前提：这条是「不记住」');

    assert.equal(
      (await fx.app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: {} })).statusCode,
      200,
    );
    // 桩侧看到的快照里必须带该字段（否则字段根本没上传）
    const onCloud = JSON.parse(stub.files.get(CLOUD_PATH)!.content.toString('utf8')) as {
      prompts: { title: string; remember_variables?: boolean }[];
    };
    const cloudPrompt = onCloud.prompts.find((p) => p.title === '同步开关夹具');
    assert.ok(cloudPrompt !== undefined, '云端应有这条 prompt');
    assert.equal(cloudPrompt.remember_variables, false, '云端快照里该字段必须是 false');

    // 清库（复用既有导入接口的 replace，空数据）
    const wipe = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'replace', data: { app: 'promptmanager', schema_version: 1, folders: [], tags: [], prompts: [] } },
    });
    assert.equal(wipe.statusCode, 200, wipe.body);

    const pulled = await fx.app.inject({
      method: 'POST',
      url: '/api/sync/pull',
      headers: { cookie },
      payload: { mode: 'merge' },
    });
    assert.equal(pulled.statusCode, 200, pulled.body);

    const list = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items: { id: number; title: string; remember_variables: boolean }[];
    };
    const restored = list.items.find((p) => p.title === '同步开关夹具');
    assert.ok(restored !== undefined, 'pull 应把这条恢复回来');
    assert.equal(restored.remember_variables, false, 'AC-123 ⑤：恢复后仍是「不记住」');
  } finally {
    await fx.close();
    await stub.close();
  }
});
