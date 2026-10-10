// 阶段 61 / FR-127 + FR-128 / AC-123：变量记忆「可控」（服务端开关）+ 填值弹窗「一键清空」。
//
// 这份测试**先写、先看它红**（red → green）：它引用的 `remember_variables` 字段、008 迁移、
// 以及 `web/src/pure.ts` 里的记忆存储助手（`readRememberedVars` 等）在改动前都**不存在**。
//
// 逐条对应 AC-123 的编号见每个 test 名开头。
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../dist/config.js';
import { openDatabase } from '../dist/db/index.js';
import { runMigrations } from '../dist/db/migrate.js';
import {
  VARS_STORAGE_PREFIX,
  hasAnyFilled,
  missingVariables,
  readRememberedVars,
  removeRememberedVars,
  varsDialogTitle,
  varsStorageKey,
  writeRememberedVars,
  type StorageLike,
} from '../web/src/pure.ts';
import { cookieOf, login, makeFixture, PROJECT_ROOT, type Fixture } from './helpers.ts';

async function authed(fx: Fixture): Promise<string> {
  return cookieOf(await login(fx.app));
}

/** 内存版 localStorage（node:test 里没有 window，靠它把记忆语义测成真）。 */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function stripVolatile(file: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(file);
  delete clone['exported_at'];
  return clone;
}

function readSource(rel: string): string {
  return readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
}

interface PromptShape {
  id: number;
  title: string;
  remember_variables: boolean;
  use_count: number;
  user_prompt: string;
  system_prompt: string;
}

// ══════════════ A. 服务端字段与迁移 ══════════════

test('AC-123 ①：008 迁移在「已有数据」的库上执行后，所有存量提示词都是「记住」', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pm-stage61-mig-'));
  const oldMigrations = path.join(root, 'migrations-001-007');
  mkdirSync(oldMigrations, { recursive: true });
  const allMigrations = readdirSync(path.join(PROJECT_ROOT, 'migrations')).filter((f) => f.endsWith('.sql'));
  // 只放 001–007：模拟"本次改动之前就已经在用、里面有数据的库"
  for (const file of allMigrations.filter((f) => /^00[1-7][-_]/.test(f))) {
    cpSync(path.join(PROJECT_ROOT, 'migrations', file), path.join(oldMigrations, file));
  }
  assert.equal(allMigrations.length, 8, 'migrations/ 里应有 8 个迁移文件（001–007 + 008）');

  const db = openDatabase(loadConfig({ DATA_DIR: path.join(root, 'data') }));
  try {
    const before = runMigrations(db, oldMigrations);
    assert.equal(before.version, 7, '旧库先停在 v7');

    // 存量数据：**不写** remember_variables 列（旧库里根本没这一列）
    const insert = db.prepare(
      'insert into prompts (title, user_prompt, system_prompt, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    insert.run('存量甲', '老提示词 {{a}}', '', '', now, now);
    insert.run('存量乙', '老提示词 {{b}}', '', '', now, now);

    // 跑真实 migrations/（含 008）—— 就是升级路径
    const after = runMigrations(db, path.join(PROJECT_ROOT, 'migrations'));
    assert.equal(after.version, 8, '升级后 schema 版本 = 8（008_remember-variables.sql）');

    const columns = (db.prepare('pragma table_info(prompts)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(columns.includes('remember_variables'), `prompts 应多出 remember_variables 列（实际：${columns.join(',')}）`);

    const rows = db.prepare('select title, remember_variables as r from prompts order by id').all() as Array<{
      title: string;
      r: number;
    }>;
    assert.equal(rows.length, 2, '存量数据不能被迁移弄丢');
    for (const row of rows) {
      assert.equal(row.r, 1, `存量提示词「${row.title}」必须是「记住」（默认值 1）`);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('AC-123 ②③：读取接口（列表 + 详情）带该字段且默认「记住」；更新接口可改、改完再读一致', async () => {
  const fx = await makeFixture({}, { withUser: true });
  try {
    const cookie = await authed(fx);
    const created = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '开关夹具', user_prompt: '{{a}}' },
      })
    ).json() as PromptShape;

    assert.equal(created.remember_variables, true, '新建默认「记住」（AC-123 ②）');

    const listed = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items: PromptShape[];
    };
    assert.equal(listed.items[0]?.remember_variables, true, '列表也带该字段');

    const detail = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(created.id)}`, headers: { cookie } })
    ).json() as PromptShape;
    assert.equal(detail.remember_variables, true, '详情也带该字段');

    // ③ 改成「不记住」，再读一致
    const updated = (
      await fx.app.inject({
        method: 'PUT',
        url: `/api/prompts/${String(created.id)}`,
        headers: { cookie },
        payload: { remember_variables: false },
      })
    ).json() as PromptShape;
    assert.equal(updated.remember_variables, false, 'PUT 后返回值是 false');

    const reread = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(created.id)}`, headers: { cookie } })
    ).json() as PromptShape;
    assert.equal(reread.remember_variables, false, '改完再读一致（AC-123 ③）');

    const relisted = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items: PromptShape[];
    };
    assert.equal(relisted.items[0]?.remember_variables, false, '列表读出来也一致');

    // 只改其它字段时，本字段保持不动（部分更新语义）
    const untouched = (
      await fx.app.inject({
        method: 'PUT',
        url: `/api/prompts/${String(created.id)}`,
        headers: { cookie },
        payload: { title: '改标题' },
      })
    ).json() as PromptShape;
    assert.equal(untouched.remember_variables, false, '未传该字段 ⇒ 保持原值');

    // 类型不对 ⇒ 400（与 favorite 同口径：布尔）
    const bad = await fx.app.inject({
      method: 'PUT',
      url: `/api/prompts/${String(created.id)}`,
      headers: { cookie },
      payload: { remember_variables: 'no' },
    });
    assert.equal(bad.statusCode, 400, `非布尔值必须 400（实际 ${String(bad.statusCode)}）`);
  } finally {
    await fx.close();
  }
});

test('AC-123 ④：该字段随导出 / 导入往返（含「不记住」的条目，逐字一致）', async () => {
  const fx = await makeFixture({}, { withUser: true });
  try {
    const cookie = await authed(fx);
    const p1 = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '记住的', user_prompt: '甲 {{a}}' },
      })
    ).json() as PromptShape;
    const p2 = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '不记住的', user_prompt: '乙 {{b}}', remember_variables: false },
      })
    ).json() as PromptShape;
    assert.equal(p1.remember_variables, true);
    assert.equal(p2.remember_variables, false, '创建时就能指定 false');

    const first = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as Record<
      string,
      unknown
    >;
    const exported = first['prompts'] as Array<{ title: string; remember_variables: boolean }>;
    assert.equal(exported.find((p) => p.title === '记住的')?.remember_variables, true, '导出必须写该字段');
    assert.equal(exported.find((p) => p.title === '不记住的')?.remember_variables, false);

    const imported = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'replace', data: first },
    });
    assert.equal(imported.statusCode, 200, imported.body);

    const second = (await fx.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } })).json() as Record<
      string,
      unknown
    >;
    assert.deepEqual(
      stripVolatile(second),
      stripVolatile(first),
      '导出 → 导入 → 再导出 必须逐字一致（AC-123 ④）',
    );

    // 老文件（没有该字段）导入 ⇒ 默认「记住」
    const legacy = {
      app: 'promptmanager',
      schema_version: 1,
      folders: [],
      tags: [],
      prompts: [
        {
          id: 1,
          title: '老文件条目',
          user_prompt: '旧 {{a}}',
          system_prompt: '',
          notes: '',
          folder_id: null,
          tags: [],
          favorite: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          versions: [
            {
              version_no: 1,
              title: '老文件条目',
              user_prompt: '旧 {{a}}',
              system_prompt: '',
              notes: '',
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    };
    const legacyImport = await fx.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: { mode: 'replace', data: legacy },
    });
    assert.equal(legacyImport.statusCode, 200, legacyImport.body);
    const afterLegacy = (await fx.app.inject({ method: 'GET', url: '/api/prompts', headers: { cookie } })).json() as {
      items: PromptShape[];
    };
    assert.equal(afterLegacy.items[0]?.remember_variables, true, '缺该字段的老文件 ⇒ 按「记住」处理');
  } finally {
    await fx.close();
  }
});

test('AC-123 ⑥：「不记住」在服务端没有额外副作用（渲染 / 变量提取 / 取用记账完全相同）', async () => {
  const fx = await makeFixture({}, { withUser: true });
  try {
    const cookie = await authed(fx);
    const text = { user_prompt: '语气：{{语气 | default(专业)}}；{{未填}}', system_prompt: 'S={{未填}}' };
    const on = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '记住', ...text },
      })
    ).json() as PromptShape;
    const off = (
      await fx.app.inject({
        method: 'POST',
        url: '/api/prompts',
        headers: { cookie },
        payload: { title: '不记住', remember_variables: false, ...text },
      })
    ).json() as PromptShape;
    assert.equal(on.remember_variables, true);
    assert.equal(off.remember_variables, false);

    const varsOn = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(on.id)}/variables`, headers: { cookie } })
    ).json();
    const varsOff = (
      await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(off.id)}/variables`, headers: { cookie } })
    ).json();
    assert.deepEqual(varsOff, varsOn, '变量提取必须完全相同');

    const renderOn = (
      await fx.app.inject({
        method: 'POST',
        url: `/api/prompts/${String(on.id)}/render`,
        headers: { cookie },
        payload: { values: {} },
      })
    ).json();
    const renderOff = (
      await fx.app.inject({
        method: 'POST',
        url: `/api/prompts/${String(off.id)}/render`,
        headers: { cookie },
        payload: { values: {} },
      })
    ).json();
    assert.deepEqual(renderOff, renderOn, '渲染结果必须完全相同');

    // 取用记账：两条各复制一次 ⇒ use_count 都是 1
    for (const id of [on.id, off.id]) {
      const copied = await fx.app.inject({
        method: 'POST',
        url: `/api/prompts/${String(id)}/copy`,
        headers: { cookie },
        payload: {},
      });
      assert.equal(copied.statusCode, 204, copied.body);
    }
    // 取用记账：各 1 次渲染（`/render` 也计入，FR-19 / FR-114）+ 1 次 `/copy` ⇒ 都是 2。
    const counts: number[] = [];
    for (const [label, id] of [
      ['记住', on.id],
      ['不记住', off.id],
    ] as const) {
      const detail = (
        await fx.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } })
      ).json() as PromptShape;
      assert.equal(detail.use_count, 2, `${label}：1 次渲染 + 1 次复制 = 2 次取用`);
      counts.push(detail.use_count);
    }
    assert.deepEqual(counts, [2, 2], '「记住」与「不记住」的取用记账口径必须完全相同');
  } finally {
    await fx.close();
  }
});

// ══════════════ B/C. 界面开关与一键清空（可在 node 里机械验证的部分） ══════════════

test('AC-123 ⑨⑩：记忆存储助手 —— 写入 / 读取 / 删除，键仍是 pm-vars:<id>', () => {
  const store = fakeStorage();
  assert.equal(VARS_STORAGE_PREFIX, 'pm-vars:');
  assert.equal(varsStorageKey(7), 'pm-vars:7');

  writeRememberedVars(7, { a: '甲', b: '乙' }, store);
  assert.deepEqual(readRememberedVars(7, store), { a: '甲', b: '乙' }, '⑩ 勾选状态下写入仍照旧');

  removeRememberedVars(7, store);
  assert.equal(store.data.has('pm-vars:7'), false, '⑨ 删除后 localStorage 里不再有该键');
  assert.deepEqual(readRememberedVars(7, store), {}, '删掉后再读 = 空（再打开弹窗不预填）');

  // 记忆按提示词分开：删 7 不影响 8
  writeRememberedVars(8, { a: '丙' }, store);
  removeRememberedVars(7, store);
  assert.deepEqual(readRememberedVars(8, store), { a: '丙' }, '记忆必须按 prompt 分开');

  // 坏数据 / 非字符串值一律忽略，不抛
  const broken = fakeStorage({ 'pm-vars:9': '{not json', 'pm-vars:10': '{"a":"甲","b":3,"c":null}' });
  assert.deepEqual(readRememberedVars(9, broken), {}, '坏 JSON ⇒ 空对象');
  assert.deepEqual(readRememberedVars(10, broken), { a: '甲' }, '只留字符串值');

  // 没有 localStorage 时静默（不抛）
  assert.deepEqual(readRememberedVars(11), {});
  assert.doesNotThrow(() => {
    writeRememberedVars(11, { a: 'x' });
    removeRememberedVars(11);
  });
});

test('AC-123 ⑫：弹窗标题 —— 记住时含「自动记忆」，不记住时不含', () => {
  assert.equal(varsDialogTitle(true), '请填写变量值（自动记忆）', '记住时沿用原文案，一字不变');
  const off = varsDialogTitle(false);
  assert.equal(off.includes('自动记忆'), false, '不记住时不得出现「自动记忆」字样');
  assert.equal(off, '请填写变量值');
});

test('AC-123 ⑯⑰：missing 计数与「清空」按钮置灰 —— 纯函数口径', () => {
  // ⑯ 清空后（values = {}）计数回到"全部未填"；有默认值的不算未填（FR-126 不变）
  assert.deepEqual(missingVariables(['a', 'b', 'c'], {}, {}), ['a', 'b', 'c']);
  assert.deepEqual(missingVariables(['a', 'b', 'c'], { a: '甲' }, {}), ['b', 'c']);
  assert.deepEqual(missingVariables(['a', 'b', 'c'], {}, { b: '默认' }), ['a', 'c'], '有默认值的不进 missing');
  assert.deepEqual(missingVariables(['a', 'b', 'c'], { a: '', b: '乙' }, {}), ['a', 'c'], '空串 = 未填');

  // ⑰ 本来就全空 ⇒ 按钮置灰（values 里没有非空值）
  assert.equal(hasAnyFilled({}), false);
  assert.equal(hasAnyFilled({ a: '' }), false, '空串不算"填了"');
  assert.equal(hasAnyFilled({ a: '甲' }), true);
  assert.equal(hasAnyFilled({ a: '', b: '乙' }), true);
});

test('AC-123 ⑦⑧⑪⑭⑮⑰⑱：组件源码级 —— 勾选框 / 清空按钮 / 同一字段 / 无二次确认', () => {
  const dialog = readSource('web/src/components/VarsDialog.tsx');
  // ⑦ 勾选框存在，且初值来自服务端字段（默认勾上）
  assert.match(dialog, /data-testid="pm-vars-remember"/, '弹窗里必须有勾选框锚点');
  assert.match(dialog, /Checkbox/, '用组件库的 Checkbox（D-11）');
  assert.match(dialog, /target\.remember_variables/, '初值必须读服务端字段');
  assert.match(dialog, /removeRememberedVars\(/, '⑧⑨ 取消勾选即删已存记忆（即时生效）');
  assert.match(dialog, /writeRememberedVars\(/, '⑩ 勾选时仍照旧写入');
  assert.match(dialog, /onRememberChange/, '勾选框改动要回传调用方（写服务端 + 同步其它视图）');

  // ⑭⑮ 清空按钮：文案是「清空」、一次点击清表单 + 删记忆
  assert.match(dialog, /data-testid="pm-vars-clear"/, '弹窗底部必须有清空按钮锚点');
  assert.match(dialog, /清空/, '文案必须明确到「清空」');
  // 只盯**按钮自身的文案**（注释里出现"重置"不算问题）：锚点之后 200 字符内不得是「重置」。
  assert.equal(
    /data-testid="pm-vars-clear"[\s\S]{0,200}?重置/.test(dialog),
    false,
    '按钮文案不得用含糊的「重置」',
  );
  assert.match(dialog, /hasAnyFilled\(/, '⑰ 全空时置灰');
  assert.match(dialog, /disabled=/, '按钮要有 disabled 态');
  assert.equal(/Modal\.confirm|Popconfirm/.test(dialog), false, '⑱ 不得有二次确认弹窗');

  // ⑫ 标题走纯函数（记住/不记住两种文案）
  assert.match(dialog, /varsDialogTitle\(/, '标题必须按开关切换');

  // ⑯ missing 走纯函数（清空后计数立刻变准）
  assert.match(dialog, /missingVariables\(/, 'missing 计数走同一个纯函数');

  // ⑪ 编辑页有同义开关，读写同一字段
  const editor = readSource('web/src/components/PromptEditor.tsx');
  assert.match(editor, /remember_variables/, '编辑页开关必须读写同一字段');
  assert.match(editor, /data-testid="editor-remember-variables"/, '编辑页开关要有锚点');
  assert.match(editor, /记住变量值/, '编辑页开关要有中文标签');

  // 编辑页表单把该字段一起提交（否则勾了不落库）
  assert.match(editor, /remember_variables: source\.remember_variables/, '打开编辑器时填入该字段');
  assert.match(editor, /remember_variables: values\.remember_variables/, '保存时提交该字段');
});

test('AC-123 ㉒：所有触发位置共用同一个弹窗（只有一处 VarsDialog 实现）', () => {
  const workspace = readSource('web/src/components/Workspace.tsx');
  assert.match(workspace, /LazyVarsDialog/, 'Workspace 渲染的是同一个共享弹窗');
  assert.match(workspace, /onRememberChange=/, '共享弹窗接上「改开关」的回传');
  assert.match(workspace, /remember_variables/, 'Workspace 负责把改动写回服务端并同步本地视图');
  // 只有一处组件文件
  const dialogFiles = readdirSync(path.join(PROJECT_ROOT, 'web/src/components')).filter((f) => /Vars.*Dialog/.test(f));
  assert.deepEqual(dialogFiles, ['VarsDialog.tsx'], '弹窗只能有一份实现');
});

// ══════════════ E. 文档 ══════════════

test('AC-123 ㉓：README / docs/api.md 补字段说明；docs/traps.md 补「为什么开关放服务端」', () => {
  const readme = readSource('README.md');
  assert.match(readme, /remember_variables/, 'README 要写清字段名');
  assert.match(readme, /记住变量值/, 'README 要有中文说明');

  const apiDoc = readSource('docs/api.md');
  assert.match(apiDoc, /remember_variables/, 'api.md 要写该字段');
  assert.match(apiDoc, /不记住|记住变量值/, 'api.md 要写「不记住」的语义');

  const traps = readSource('docs/traps.md');
  assert.match(traps, /remember_variables/, 'traps.md 要提到该字段');
  assert.match(traps, /localStorage/, 'traps.md 要讲清存储介质的分工');
});
