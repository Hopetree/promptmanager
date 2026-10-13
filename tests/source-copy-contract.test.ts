/**
 * 常驻回归（阶段 74 / FR-165 / AC-136 —— 源码级与接口级判据）。
 *
 * 覆盖渲染级测不到的三件事：
 * 1. **位置与等级的源码形状**：新入口在正文区工具行、不在底部主操作条、不是 primary（「复制提示词」仍是 primary）；
 * 2. **A1 的静态保证**：`copySource` 的实现块里**没有任何 `api.` 调用**（记账 / 渲染都不可能发生）；
 * 3. **C1 的边界**：列表 / 卡片（`UseView.tsx`）没有被动过；编辑器两个字段入口都有可见文字。
 *
 * 另加接口级对照（⑦⑨）：`view` 不推高 `use_count`，只有 `copy` / `render` 端点会 —— 这正是
 * "复制源码不发请求" ⇒ "`use_count` 不变"的因果链。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSource } from './source-text.ts';
import { cookieOf, login, makeFixture } from './helpers.ts';
import type { Prompt } from '../web/src/types.ts';

/** 取一条 prompt 的 `use_count`（`GET /api/prompts/:id` 记的是 `view`，不计入 `use_count`）。 */
async function useCountOf(app: Parameters<typeof login>[0], cookie: string, id: number): Promise<number> {
  const response = await app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
  assert.equal(response.statusCode, 200, '读详情必须 200');
  return (response.json() as Prompt).use_count;
}

test('AC-136 ①②：新入口在正文区工具行、不在底部主操作条，且等级弱于「复制提示词」（源码级）', () => {
  const detail = readSource('web/src/components/PromptDetail.tsx');

  const fieldsAt = detail.indexOf('data-testid="pm-detail-fields"');
  const bodyAt = detail.indexOf('data-testid="pm-detail-body"');
  const actionsAt = detail.indexOf('data-testid="pm-detail-actions"');
  assert.ok(fieldsAt > 0 && bodyAt > fieldsAt && actionsAt > bodyAt, '详情面的锚点顺序必须是 工具行 → 正文区 → 底部操作条');

  const fieldsBlock = detail.slice(fieldsAt, bodyAt);
  const actionsBlock = detail.slice(actionsAt);
  assert.ok(fieldsBlock.includes('pm-detail-copy-source'), '「复制源码」必须写在正文区工具行里');
  assert.equal(actionsBlock.includes('pm-detail-copy-source'), false, '「复制源码」不许进底部主操作条（用户明确要求不同处）');

  // 等级：新入口是次要形态（type="text"），「复制提示词」仍是 primary
  const sourceAt = detail.indexOf('data-testid="pm-detail-copy-source"');
  const sourceButton = detail.slice(detail.lastIndexOf('<Button', sourceAt), detail.indexOf('</Button>', sourceAt));
  assert.ok(sourceButton.includes('type="text"'), `「复制源码」必须是次要形态，实际 ${sourceButton}`);
  assert.equal(sourceButton.includes('type="primary"'), false, '「复制源码」不许是 primary');

  const copyAt = detail.indexOf('data-testid="pm-detail-copy"');
  const copyButton = detail.slice(detail.lastIndexOf('<Button', copyAt), detail.indexOf('</Button>', copyAt));
  assert.ok(copyButton.includes('type="primary"'), '「复制提示词」必须仍是 primary（等级对照的基准）');

  // 内容跟着当前字段走（B1）：复制的是 fieldText，而不是写死 user_prompt
  assert.ok(/onCopySource\(fieldText/.test(detail), '复制源码必须取当前字段的文本（详情跟页签走）');
});

test('AC-136 ⑧（A1 静态保证）：copySource 的实现块里没有任何 api 调用；既有复制语义未动', () => {
  const copy = readSource('web/src/use-copy.ts');

  const sourceAt = copy.indexOf('const copySource');
  assert.ok(sourceAt > 0, '`use-copy.ts` 必须新增 `copySource`（复制源码的唯一入口）');
  const sourceBlock = copy.slice(sourceAt, copy.indexOf('const copyPrompt', sourceAt));
  assert.equal(/api\./.test(sourceBlock), false, `复制源码不许碰 api（A1：不记账、不渲染），实际块：${sourceBlock}`);
  assert.equal(/recordCopy|render\(|fetch\(/.test(sourceBlock), false, '复制源码不许有记账 / 渲染 / 网络调用');

  // 不回归：「复制提示词」仍记账、含变量仍走 render
  const promptAt = copy.indexOf('const copyPrompt');
  const promptBlock = copy.slice(promptAt, copy.indexOf('const copyRendered', promptAt));
  assert.ok(promptBlock.includes('api.recordCopy'), '「复制提示词」仍必须记一次取用（FR-115）');
  assert.ok(copy.slice(copy.indexOf('const copyRendered')).includes('api.render('), '含变量仍必须走 /api/prompts/:id/render');
});

test('AC-136 ⑩⑪（C1 边界）：列表/卡片没被加，编辑器两个字段入口都有可见文字', () => {
  const useView = readSource('web/src/components/UseView.tsx');
  assert.equal(useView.includes('复制源码'), false, 'C1：列表 / 卡片不许加「复制源码」');
  assert.equal(useView.includes('copySource'), false, 'C1：列表 / 卡片不许接 copySource');

  const editor = readSource('web/src/components/PromptEditor.tsx');
  for (const testid of ['editor-copy-user', 'editor-copy-system']) {
    const at = editor.indexOf(testid);
    assert.ok(at > 0, `编辑器缺少 ${testid}`);
    const button = editor.slice(editor.lastIndexOf('<Button', at), editor.indexOf('</Button>', at));
    assert.ok(button.includes('复制源码'), `${testid} 必须有可见文字「复制源码」（改的是可发现性），实际 ${button}`);
    assert.ok(button.includes('type="text"'), `${testid} 仍应是次要形态`);
  }
  // 编辑器复制的仍是**表单当前值**（未保存的改动也算）—— 语义未变
  assert.equal(
    (editor.match(/form\.getFieldValue\('(?:user_prompt|system_prompt)'\)/g) ?? []).length >= 2,
    true,
    '编辑器两个入口都必须复制表单当前值（不是 prompt 对象上的旧值）',
  );
});

test('AC-136 ⑦⑨（接口级对照）：view 不推高 use_count，copy / render 各推高一次', async () => {
  const fixture = await makeFixture();
  try {
    const cookie = cookieOf(await login(fixture.app));
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api/prompts',
      headers: { cookie },
      payload: { title: '甲', user_prompt: '正文甲 {{名字 | default(甲)}}', system_prompt: '你是{{角色}}助手' },
    });
    assert.equal(created.statusCode, 201, '建夹具失败');
    const id = (created.json() as Prompt).id;

    assert.equal(await useCountOf(fixture.app, cookie, id), 0, '新建后 use_count = 0');

    // 打开详情 = `view` 留痕，但**不计入** use_count（聚合侧只统计 copy / mcp）
    await fixture.app.inject({ method: 'GET', url: `/api/prompts/${String(id)}`, headers: { cookie } });
    assert.equal(await useCountOf(fixture.app, cookie, id), 0, 'view 不许推高 use_count');

    // 复制提示词（无变量路径）走的记账端点
    await fixture.app.inject({ method: 'POST', url: `/api/prompts/${String(id)}/copy`, headers: { cookie } });
    assert.equal(await useCountOf(fixture.app, cookie, id), 1, 'copy 端点必须 +1');

    // 复制提示词（含变量路径）走的渲染端点
    await fixture.app.inject({
      method: 'POST',
      url: `/api/prompts/${String(id)}/render`,
      headers: { cookie },
      payload: { values: { 名字: '甲' } },
    });
    assert.equal(await useCountOf(fixture.app, cookie, id), 2, 'render 端点必须 +1');
  } finally {
    await fixture.close();
  }
});
