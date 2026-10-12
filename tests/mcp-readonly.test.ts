import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PROJECT_ROOT, makeFixture } from './helpers.ts';
import { readSource } from './source-text.ts';

/** 只读保证：工具面不得出现任何写操作工具（AC-26 ②）。 */
const WRITE_HINTS = ['create', 'update', 'delete', 'remove', 'import', 'export', 'set', 'put', 'post', 'add', 'write', 'edit', 'rollback'];

test('AC-26 ②：tools/list 里没有任何写操作工具，且恰好是三个只读工具', async () => {
  const fx = await makeFixture();
  try {
    const base = (await fx.app.listen({ host: '127.0.0.1', port: 0 })).replace(/\/$/, '');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(PROJECT_ROOT, 'bin', 'pm-mcp.mjs')],
      env: { ...getDefaultEnvironment(), PM_API_URL: base, PM_API_TOKEN: 'pm_placeholder_for_this_test' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'pm-readonly-probe', version: '0.0.0' });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, ['prompt_get', 'prompt_render', 'prompt_search']);

      const offenders = names.filter((name) => WRITE_HINTS.some((hint) => name.toLowerCase().includes(hint)));
      assert.deepEqual(offenders, [], `不得出现写操作工具：${offenders.join(', ')}`);
      assert.equal(names.length, 3, '工具面数量必须恰好为 3');
    } finally {
      await client.close();
    }
  } finally {
    await fx.close();
  }
});

test('MCP 入口不向 stdout 写非协议内容（stdio 洁净性）', () => {
  const entry = readSource('bin/pm-mcp.mjs');
  assert.ok(!/console\.log/.test(entry), 'bin/pm-mcp.mjs 不得使用 console.log（会污染 JSON-RPC 流）');
  assert.match(entry, /pm-mcp|dist\/mcp\/server\.js/, '入口应载入编译产物 dist/mcp/server.js');

  const server = readSource('src/mcp/server.ts');
  assert.ok(!/console\.log/.test(server), 'src/mcp/server.ts 不得使用 console.log');
  // 不直连数据库：MCP 这层不得 import 数据库/业务服务模块
  assert.ok(!/from '\.\.\/db\//.test(server), 'MCP 层不得 import src/db/**（不许直连 DB）');
  assert.ok(!/from '\.\.\/services\//.test(server), 'MCP 层不得 import src/services/**（只经 HTTP API）');
  // 通道标记要断言**真正设置它的代码**：server 传 channel、客户端落成请求头（注释里提一句不算实现）
  assert.match(server, /channel: 'mcp'/, 'MCP 调用必须显式标 channel=mcp（服务端据此记 mcp 通道）');
  const apiClient = readSource('src/client/pm-api.ts');
  assert.match(apiClient, /headers\['x-pm-channel'\] = 'mcp'/, 'HTTP 客户端必须把 channel=mcp 落成 x-pm-channel 头');
});
