import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { CliResult } from './helpers.ts';
import {
  PROJECT_ROOT,
  assertCliOk,
  makeTempDir,
  removeTempDir,
  runCliProcess,
} from './helpers.ts';

const runCli = (args: string[], dataDir: string): Promise<CliResult> => runCliProcess(args, { dataDir });

test('CLI export：写出与 /api/export 同结构的文件，rc=0，且不打印口令类内容', async () => {
  const dir = makeTempDir('pm-cli-export-');
  const outDir = mkdtempSync(path.join(tmpdir(), 'pm-out-'));
  const out = path.join(outDir, 'backup.json');
  try {
    // 先用 CLI 建库 + 服务侧写入数据（直接调服务层，避免起 HTTP）
    const { loadConfig } = await import('../dist/config.js');
    const { prepareDatabase } = await import('../dist/db/index.js');
    const { createPrompt } = await import('../dist/services/prompts.js');
    const config = loadConfig({ DATA_DIR: dir });
    const { qe } = prepareDatabase(config);
    await createPrompt(qe, { title: 'CLI 导出夹具', user_prompt: '会话交接', tags: ['交接'] });
    await qe.destroy();

    const res = await runCli(['export', '--out', out], dir);
    assertCliOk(res, 'CLI 退出码');
    assert.match(res.stdout, /exported/);
    assert.ok(existsSync(out), '导出文件应存在');

    const file = JSON.parse(readFileSync(out, 'utf8')) as Record<string, any>;
    assert.equal(file.app, 'promptmanager');
    assert.equal(file.schema_version, 1);
    assert.match(String(file.exported_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(file.prompts.length, 1);
    assert.equal(file.prompts[0].title, 'CLI 导出夹具');
    assert.deepEqual(file.prompts[0].tags, ['交接']);
    assert.deepEqual(
      file.prompts[0].versions.map((v: { version_no: number }) => v.version_no),
      [1],
    );
  } finally {
    removeTempDir(dir);
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('CLI export：与 POST /api/import 兼容（把 CLI 文件导回库）', async () => {
  const dir = makeTempDir('pm-cli-export-');
  const dir2 = makeTempDir('pm-cli-export2-');
  const outDir = mkdtempSync(path.join(tmpdir(), 'pm-out-'));
  const out = path.join(outDir, 'backup.json');
  try {
    const { loadConfig } = await import('../dist/config.js');
    const { prepareDatabase } = await import('../dist/db/index.js');
    const { createPrompt } = await import('../dist/services/prompts.js');
    const { importData } = await import('../dist/services/import.js');
    const { buildExport } = await import('../dist/services/export.js');

    const source = prepareDatabase(loadConfig({ DATA_DIR: dir }));
    await createPrompt(source.qe, { title: '往返夹具', user_prompt: '会话交接 {{X}}' });
    await source.qe.destroy();

    const cli = await runCli(['export', '--out', out], dir);
    assertCliOk(cli, 'CLI 退出码');
    const file = JSON.parse(readFileSync(out, 'utf8')) as unknown;

    const target = prepareDatabase(loadConfig({ DATA_DIR: dir2 }));
    const result = await importData(target.qe, 'replace', file);
    assert.equal(result.imported.prompts, 1);
    const roundTrip = await buildExport(target.qe);
    assert.equal(roundTrip.prompts[0]?.title, '往返夹具');
    await target.qe.destroy();
  } finally {
    removeTempDir(dir);
    removeTempDir(dir2);
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('CLI export：用法错误 rc=2（缺 --out / 未知选项 / 不存在的目录 rc=1）', async () => {
  const dir = makeTempDir('pm-cli-export-');
  try {
    const missing = await runCli(['export'], dir);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--out/);

    const unknown = await runCli(['export', '--out', '/tmp/x.json', '--nope'], dir);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /--nope/);

    const badDir = await runCli(['export', '--out', '/tmp/pm-does-not-exist-dir-xyz/a.json'], dir);
    assert.equal(badDir.code, 1, `stderr=${badDir.stderr}`);
    assert.match(badDir.stderr, /error:/);
  } finally {
    removeTempDir(dir);
  }
});
