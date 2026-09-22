// 阶段 40 / FR-101（BRIEF v51 §4 + §8 AC-103）**CLI 建的 token 也有密文**断言。
//
// 这里既有**源码级**断言（CLI 传 cipher、两处调用点口径一致、既有契约的行位置），也有**真跑 CLI** 的端到端断言
// （临时 DATA_DIR，绝不碰 8767 / 生产）：查库、reveal 逐字比对、密钥不可用三态。
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { CliResult } from './helpers.ts';
import { PROJECT_ROOT, assertCliOk, makeTempDir, removeTempDir, runCliProcess } from './helpers.ts';

const cliSrc = readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'cli.ts'), 'utf8');
const routeSrc = readFileSync(path.join(PROJECT_ROOT, 'src', 'server', 'routes', 'tokens.ts'), 'utf8');

const runCli = (args: string[], dataDir: string, env: Record<string, string> = {}): Promise<CliResult> =>
  runCliProcess(args, { dataDir, env });

/** 打开临时 DATA_DIR 的库读一行（用 dist 的 openDatabase，和 CLI 同一套）。 */
async function readRow(dataDir: string): Promise<{ name: string; token_enc: string | null } | undefined> {
  const { openDatabase } = await import('../dist/db/index.js');
  const db = openDatabase({ dataDir });
  try {
    return db.prepare('SELECT name, token_enc FROM api_tokens ORDER BY id DESC LIMIT 1').get() as
      | { name: string; token_enc: string | null }
      | undefined;
  } finally {
    db.close();
  }
}

const lastLine = (stdout: string): string => stdout.trimEnd().split('\n').pop() ?? '';

test('AC-103 ①：真跑 CLI create → 该行 token_enc 非 NULL、不是明文、长度符合 base64 密文', async () => {
  const dir = makeTempDir('pm-cli-enc-');
  try {
    const res = await runCli(['token', 'create', '--name', 'cli-enc'], dir);
    assertCliOk(res, 'CLI 退出码');
    const created = lastLine(res.stdout);

    const row = await readRow(dir);
    assert.ok(row !== undefined, '应能查到该行');
    assert.equal(row.name, 'cli-enc');
    assert.ok(row.token_enc !== null, 'FR-101：CLI 建的 token **必须**有密文（改前是 NULL）');
    assert.equal(row.token_enc.startsWith('pm_'), false, '密文不得以明文前缀 pm_ 开头');
    assert.notEqual(row.token_enc, created, '密文不得等于明文');
    // 12(nonce) + 16(tag) + 46(明文) = 74 字节 ⇒ base64 ≈ 100 字符
    assert.ok(row.token_enc.length >= 96 && row.token_enc.length <= 104, `密文长度应 ≈100（实际 ${String(row.token_enc.length)}）`);
    assert.match(row.token_enc, /^[A-Za-z0-9+/]+={0,2}$/, '应是标准 base64');
  } finally {
    removeTempDir(dir);
  }
});

test('AC-103 ③④：CLI reveal 逐字等于创建明文；stdout 契约（最后一行=明文）+ stderr 提示不变', async () => {
  const dir = makeTempDir('pm-cli-enc-');
  try {
    const created = await runCli(['token', 'create', '--name', 'cli-reveal'], dir);
    assertCliOk(created, 'create 退出码');
    const plaintext = lastLine(created.stdout);
    assert.match(plaintext, /^pm_[A-Za-z0-9_-]{40,}$/, 'create 的 stdout 最后一行必须是明文（AC-22 ① 依赖）');
    assert.equal(created.stdout.trimEnd().split('\n').length, 1, 'stdout 只应有明文那一行');
    assert.match(created.stderr, /ok: token created id=\d+ name=cli-reveal/, '人类可读提示必须仍在 stderr');

    const revealed = await runCli(['token', 'reveal', '1'], dir);
    assertCliOk(revealed, 'reveal 退出码（改前这里是 token_not_revealable）');
    assert.equal(lastLine(revealed.stdout), plaintext, 'CLI reveal 必须逐字等于创建时的明文');
    assert.ok(!revealed.stderr.includes(plaintext), 'stderr 不得含明文');

    // list / revoke 行为不变
    const listed = await runCli(['token', 'list'], dir);
    assertCliOk(listed, 'list 退出码');
    assert.equal(listed.stdout.includes(plaintext), false, 'list 不得回显明文');
    assert.match(listed.stdout, /cli-reveal/);
    const revoked = await runCli(['token', 'revoke', '1'], dir);
    assertCliOk(revoked, 'revoke 退出码');
    const afterRevoke = await runCli(['token', 'list'], dir);
    assert.match(afterRevoke.stdout, /status=revoked/, 'revoke 后状态应变为 revoked');
  } finally {
    removeTempDir(dir);
  }
});

test('AC-103 ⑤：密钥不可用（TOKEN_ENC_KEY 非法）→ 创建仍成功、token_enc 为 NULL、stderr 有可读提示', async () => {
  const dir = makeTempDir('pm-cli-enc-');
  try {
    const res = await runCli(['token', 'create', '--name', 'no-key'], dir, { TOKEN_ENC_KEY: 'abcd' });
    assertCliOk(res, '密钥不可用时 create 仍须 rc=0（创建绝不因密钥失败）');
    const plaintext = lastLine(res.stdout);
    assert.match(plaintext, /^pm_/, '明文仍要正常返回（鉴权不受影响）');
    assert.match(res.stderr, /warn: 加密密钥不可用/, 'stderr 必须有可读提示（AC-103 ⑤）');
    assert.ok(!res.stderr.includes(plaintext), '提示里不得含明文');

    const row = await readRow(dir);
    assert.equal(row?.token_enc, null, '密钥不可用时该行没有密文（之后"看不了"）');
    // 该行仍可鉴权（sha256 那条路没受影响）：token_hash 照常写入 64 位 hex
    const { openDatabase } = await import('../dist/db/index.js');
    const db = openDatabase({ dataDir: dir });
    try {
      const row = db.prepare('SELECT length(token_hash) AS len FROM api_tokens').get() as { len: number };
      assert.equal(row.len, 64, 'token_hash 仍写入（鉴权不受密钥影响）');
    } finally {
      db.close();
    }

    // 恢复（去掉坏 env）后新建的 token 又有密文
    const okAgain = await runCli(['token', 'create', '--name', 'key-back'], dir);
    assertCliOk(okAgain, '恢复后 create 退出码');
    const row2 = await readRow(dir);
    assert.equal(row2?.name, 'key-back');
    assert.ok(row2?.token_enc !== null, '恢复密钥后新建的 token 必须又有密文');
  } finally {
    removeTempDir(dir);
  }
});

test('AC-103 ⑤（补充）：密钥文件不可读（同名目录占位）→ 同样"创建成功 + 无密文 + 可读提示"', async () => {
  const dir = makeTempDir('pm-cli-enc-');
  try {
    // 先建一个 token 让密钥文件生成，再把它换成同名目录（模拟"读不到密钥"）
    assertCliOk(await runCli(['token', 'create', '--name', 'first'], dir), '首次 create');
    rmSync(path.join(dir, 'token-enc.key'));
    mkdirSync(path.join(dir, 'token-enc.key'));

    const res = await runCli(['token', 'create', '--name', 'unreadable-key'], dir);
    assertCliOk(res, '密钥读不到时 create 仍须 rc=0');
    assert.match(res.stderr, /warn: 加密密钥不可用/, '必须有可读提示');
    const row = await readRow(dir);
    assert.equal(row?.token_enc, null, '读不到密钥 ⇒ 无密文');
  } finally {
    removeTempDir(dir);
  }
});

test('AC-103 ⑥：存量无密文行不回填 —— reveal 仍是 token_not_revealable（语义不变）', async () => {
  const dir = makeTempDir('pm-cli-enc-');
  try {
    assertCliOk(await runCli(['token', 'create', '--name', 'legacy'], dir), 'create');
    // 模拟"修复前用 CLI 建的"存量行：清掉密文
    const { openDatabase } = await import('../dist/db/index.js');
    const db = openDatabase({ dataDir: dir });
    db.prepare('UPDATE api_tokens SET token_enc = NULL').run();
    db.close();

    const res = await runCli(['token', 'reveal', '1'], dir);
    assert.equal(res.code, 1, '存量无密文行 reveal 必须失败（rc=1）');
    assert.match(res.stderr, /token_not_revealable/, '错误码必须仍是 token_not_revealable（不回填、不假装成功）');
  } finally {
    removeTempDir(dir);
  }
});

test('AC-103 ①（源码级）：CLI 与 HTTP 两处调用点都用 cipher，且 CLI 是"惰性解析 + 失败降级"', () => {
  // CLI：createToken 拿到第三个参数，且密钥解析包在 try/catch 里（失败 → undefined，不让创建失败）
  const createBlock = cliSrc.slice(cliSrc.indexOf("if (sub === 'create')"), cliSrc.indexOf("if (sub === 'list')"));
  assert.ok(/loadTokenCipher\(handle\.config\)/.test(createBlock), 'CLI 必须解析密钥');
  assert.ok(/try \{[\s\S]*loadTokenCipher[\s\S]*\} catch/.test(createBlock), '密钥解析必须 try/catch（创建绝不因密钥失败）');
  assert.ok(/createToken\(handle\.qe, parsed\.name, cipher\)/.test(createBlock), 'CLI 必须把 cipher 传给 createToken');
  assert.ok(/warn: 加密密钥不可用/.test(createBlock), '密钥不可用时必须写可读 stderr 提示');
  assert.ok(/process\.stdout\.write\(`\$\{plaintext\}\\n`\)/.test(createBlock), 'stdout 最后一行仍必须是明文（AC-22 ① 依赖）');
  // HTTP 路保持原样（FR-101 明确"不改 HTTP 路"）
  assert.ok(/createToken\(app\.qe, name, cipherOrUndefined\(\)\)/.test(routeSrc), 'HTTP 路仍传 cipherOrUndefined()');
  // 全仓只有这两处 createToken 调用点
  const calls = [
    ...cliSrc.matchAll(/createToken\(/g),
    ...routeSrc.matchAll(/createToken\(/g),
  ];
  assert.equal(calls.length, 2, 'createToken 调用点应恰好两处（CLI + HTTP 路由）');
});

test('AC-103 ①（源码级）：createToken 的签名与"无 cipher 则 NULL"的语义未被本阶段改动', () => {
  const service = readFileSync(path.join(PROJECT_ROOT, 'src', 'services', 'tokens.ts'), 'utf8');
  assert.ok(/export async function createToken\(\s*qe: QueryEngine,\s*rawName: string \| undefined,\s*cipher\?: TokenCipher,?\s*\)/.test(service), 'createToken 签名必须保持不变（cipher 仍可选）');
  assert.ok(/let tokenEnc: string \| null = null;/.test(service), '仍以 NULL 为默认值');
});
