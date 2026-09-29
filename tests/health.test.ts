import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../dist/server/app.js';
import { loadConfig } from '../dist/config.js';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pm-health-'));
  const cfg = loadConfig({ DATA_DIR: dir, PORT: '8767', HOST: '0.0.0.0' });
  return { dir, cfg };
}

test('GET /healthz 无需认证：200 + {"status":"ok","version":…}（BRIEF §6.1、AC-2）', async () => {
  const { dir, cfg } = fixture();
  const app = await buildApp(cfg);
  try {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { status: string; version: string };
    assert.equal(body.status, 'ok');
    // 允许可选的**预发布后缀**（如 `1.4.1-beta.1`）—— 2026-09-29 起支持预发布 tag，
    // 且按 docs/versioning.md §3.1「一致优先」口径 package.json 必须等于 tag（含预发布）。
    // 仍守卫格式（必须是 X.Y.Z 或 X.Y.Z-<预发布标识>）；BRIEF AC-2 只要求 body 含 version，未限定格式。
    assert.match(body.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('服务真实绑定 0.0.0.0（不是 127.0.0.1；BRIEF §5、AC-2）', async () => {
  const { dir, cfg } = fixture();
  const app = await buildApp(cfg);
  try {
    await app.listen({ host: cfg.host, port: 0 });
    const address = app.server.address();
    assert.ok(address !== null && typeof address === 'object');
    assert.equal((address as { address: string }).address, '0.0.0.0');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('未知路径回落到前端入口（单端口交付，FR-12）', async () => {
  const { dir, cfg } = fixture();
  const app = await buildApp(cfg);
  try {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
