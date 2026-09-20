import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../dist/config.js';

test('loadConfig：默认 PORT=8767 / HOST=0.0.0.0（BRIEF §6.3、§5 监听与端口）', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 8767);
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.sessionTtlHours, 720);
  assert.equal(cfg.loginMaxFailures, 5);
  assert.equal(cfg.loginWindowSeconds, 60);
  assert.ok(cfg.dataDir.endsWith('/data'), `dataDir 默认应为 <项目>/data，实际 ${cfg.dataDir}`);
  assert.ok(cfg.webRoot.endsWith('/dist/web'), `webRoot 应为 <项目>/dist/web，实际 ${cfg.webRoot}`);
});

test('loadConfig：环境变量覆盖默认值', () => {
  const cfg = loadConfig({
    PORT: '9001',
    HOST: '10.0.0.1',
    DATA_DIR: '/tmp/pm-cfg-override',
    SESSION_TTL_HOURS: '12',
    LOGIN_MAX_FAILURES: '3',
    LOGIN_WINDOW_SECONDS: '30',
  });
  assert.equal(cfg.port, 9001);
  assert.equal(cfg.host, '10.0.0.1');
  assert.equal(cfg.dataDir, '/tmp/pm-cfg-override');
  assert.equal(cfg.sessionTtlHours, 12);
  assert.equal(cfg.loginMaxFailures, 3);
  assert.equal(cfg.loginWindowSeconds, 30);
});

test('loadConfig：非法端口/阈值直接报错，不静默回退', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ SESSION_TTL_HOURS: '-1' }), /SESSION_TTL_HOURS/);
});
