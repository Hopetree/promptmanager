// 阶段 19 / FR-64（BRIEF v25 §4 + §8 AC-64）：
// 版本 diff **不得**把「没改过的备注」显示成变更 —— 根因是尾换行/尾空白未归一化
// （`snapshotText` 不以 \n 结尾 + 字段值尾部空白未裁剪 → jsdiff 的 "No newline at end of file" 语义把尾部差异当成内容变更）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotText } from '../dist/services/versions.js';
import { cookieOf, login, makeFixture } from './helpers.ts';

/** 只保留真正的变更行（去掉 --- / +++ 文件头） */
function changeLines(diff: string): string[] {
  return diff
    .split('\n')
    .filter((line) => (line.startsWith('-') && !line.startsWith('---')) || (line.startsWith('+') && !line.startsWith('+++')));
}

async function newPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const res = await fx.app.inject({ method: 'POST', url: '/api/prompts', headers: { cookie }, payload });
  assert.equal(res.statusCode, 201, res.body);
  return Number((res.json() as { id: number }).id);
}

async function putPrompt(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  id: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fx.app.inject({ method: 'PUT', url: `/api/prompts/${String(id)}`, headers: { cookie }, payload });
  assert.equal(res.statusCode, 200, res.body);
}

async function diffOf(
  fx: Awaited<ReturnType<typeof makeFixture>>,
  cookie: string,
  id: number,
  from: number,
  to: number,
): Promise<string> {
  const res = await fx.app.inject({
    method: 'GET',
    url: `/api/prompts/${String(id)}/diff?from=${String(from)}&to=${String(to)}`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { diff: string }).diff;
}

test('AC-64 单元：snapshotText 以 \\n 结尾，且字段尾部空白不影响结果', () => {
  const base = { title: 'T', user_prompt: 'U', system_prompt: 'S', notes: 'N' };
  const text = snapshotText(base);
  assert.ok(text.endsWith('\n'), 'snapshotText 必须以换行结尾（否则 jsdiff 会报 No newline at end of file）');
  assert.equal(snapshotText({ ...base, notes: 'N\n' }), text, '备注尾部换行不应改变快照文本');
  assert.equal(snapshotText({ ...base, notes: 'N   ' }), text, '备注尾部空格不应改变快照文本');
  assert.equal(snapshotText({ ...base, notes: 'N\n\n  ' }), text, '备注尾部多个换行/空格也不应改变快照文本');
  assert.notEqual(snapshotText({ ...base, notes: 'N2' }), text, '真的改了备注必须改变快照文本');
});

test('AC-64 ①：仅备注尾部换行不同 → diff 不得出现 [notes] 的 -/+ 行', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const id = await newPrompt(fx, cookie, {
      title: 'AC64 夹具',
      user_prompt: 'U1',
      system_prompt: 'S',
      notes: 'N',
    });
    await putPrompt(fx, cookie, id, { notes: 'N\n' }); // v2：仅多一个尾换行
    const diff = await diffOf(fx, cookie, id, 1, 2);
    assert.deepEqual(changeLines(diff), [], `尾换行不应产生变更行，实际 diff：\n${diff}`);
    assert.equal(diff.includes('\\ No newline at end of file'), false, `diff 里不应再出现 No newline 标记：\n${diff}`);
    assert.equal(diff.includes('[notes]'), false, '完全相同时连 hunk 都不该有（更不该提到 [notes]）');
  } finally {
    await fx.close();
  }
});

test('AC-64 ①补充：仅备注尾部空格不同 → 同样不得出现变更行', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const id = await newPrompt(fx, cookie, { title: 'AC64 空白', user_prompt: 'U', notes: 'N2' });
    await putPrompt(fx, cookie, id, { notes: 'N2  ' });
    await putPrompt(fx, cookie, id, { notes: 'N2\n\n  ' });
    for (const [from, to] of [
      [1, 2],
      [2, 3],
    ] as const) {
      const diff = await diffOf(fx, cookie, id, from, to);
      assert.deepEqual(changeLines(diff), [], `v${String(from)}→v${String(to)} 尾空白不应产生变更行：\n${diff}`);
    }
  } finally {
    await fx.close();
  }
});

test('AC-64 ②：备注真的改了 → diff 必须仍正确显示 -N / +N2', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const id = await newPrompt(fx, cookie, { title: 'AC64 反例', user_prompt: 'U', notes: 'N' });
    await putPrompt(fx, cookie, id, { notes: 'N2' });
    const diff = await diffOf(fx, cookie, id, 1, 2);
    assert.match(diff, /@@/);
    assert.ok(changeLines(diff).includes('-N'), `应含 -N：\n${diff}`);
    assert.ok(changeLines(diff).includes('+N2'), `应含 +N2：\n${diff}`);
  } finally {
    await fx.close();
  }
});

test('AC-64 ③：正文真变更 + 其它字段不变时，只出现该字段的变更行（备注不再陪跑）', async () => {
  const fx = await makeFixture();
  try {
    const cookie = cookieOf(await login(fx.app));
    const id = await newPrompt(fx, cookie, {
      title: 'AC64 正文',
      user_prompt: 'U1',
      system_prompt: 'S',
      notes: 'N',
    });
    await putPrompt(fx, cookie, id, { user_prompt: 'U2' }); // 只改正文
    await putPrompt(fx, cookie, id, { user_prompt: 'U2' }); // 再存一次同样的正文（备注尾部换行历史版本不受影响）
    const diff = await diffOf(fx, cookie, id, 1, 2);
    assert.ok(changeLines(diff).includes('-U1') && changeLines(diff).includes('+U2'), `正文变更要显示：\n${diff}`);
    assert.equal(changeLines(diff).some((line) => line === '-N' || line === '+N'), false, `备注不应陪跑：\n${diff}`);
    assert.equal(diff.includes('\\ No newline at end of file'), false, `不应再有 No newline 标记：\n${diff}`);
  } finally {
    await fx.close();
  }
});
