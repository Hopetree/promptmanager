/**
 * 阶段 65 / FR-137 / AC-127 A·D 组：前端状态收敛的**机械断言**。
 *
 * 这里不渲染组件（渲染级用例在 `tests/render/stage65-frontend-state.test.ts`），只对源码做
 * 「副本还在不在」「写入口还剩几个」「有没有偷偷加状态管理库」这类可以被机器判定的事情 ——
 * 收敛最怕的不是写错，而是**过一阵子又被加回第五、第六份副本**。
 *
 * 本文件只读仓库内文件，不依赖 `dist/`。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const WORKSPACE = 'web/src/components/Workspace.tsx';
const EDITOR = 'web/src/components/PromptEditor.tsx';
const VARS_DIALOG = 'web/src/components/VarsDialog.tsx';
const USE_COPY = 'web/src/use-copy.ts';

test('AC-127 A1：仓库里必须有渲染级测试基建（jsdom + react-dom/client），不是只做字符串断言', () => {
  const harness = readSource('tests/render/harness.ts');
  assert.match(harness, /from 'react-dom\/client'/, 'harness 必须真的用 react-dom/client 挂载组件');
  assert.match(harness, /import '\.\/dom-env\.ts'/, 'harness 必须先把 jsdom 环境装成全局（react-dom 的 canUseDOM 时序）');

  const domEnv = readSource('tests/render/dom-env.ts');
  assert.match(domEnv, /from 'jsdom'/, 'dom-env 必须用 jsdom');
  assert.match(domEnv, /new JSDOM\(/, 'dom-env 必须真的建一个 jsdom window');

  const smoke = readSource('tests/render/smoke.test.ts');
  assert.match(smoke, /from '\.\/harness\.ts'/, '冒烟用例必须走渲染级基建');
  assert.match(
    smoke,
    /getAttribute\(|\.click\(\)/,
    '冒烟用例必须断言真实 DOM（元素属性 / 真实点击），不是只做字符串断言',
  );
});

test('AC-127 A3：没有引入状态管理库，也没有新增运行时依赖（jsdom / react-dom 本来就在依赖里）', () => {
  const pkg = JSON.parse(readSource('package.json')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const all = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];
  for (const banned of ['zustand', 'redux', '@reduxjs/toolkit', 'mobx', 'jotai', 'recoil', 'valtio', 'xstate']) {
    assert.equal(all.includes(banned), false, `FR-137 明确禁止引入状态管理库（${banned}）`);
  }
  assert.ok('jsdom' in pkg.dependencies, 'jsdom 应已在依赖里（阶段 65 未新增依赖）');
  assert.ok('react-dom' in pkg.dependencies, 'react-dom 应已在依赖里（阶段 65 未新增依赖）');
});

test('AC-127 D11：Workspace 的四个旧 state setter 归零，写入口只剩 mergePrompts / dropPrompts', () => {
  const source = readSource(WORKSPACE);
  for (const legacy of ['setData(', 'setSelected(', 'setDetail(', 'setEditing(']) {
    assert.equal(source.includes(legacy), false, `${legacy} 必须已删除（旧的四份副本就是它们维护的）`);
  }

  assert.equal(
    count(source, 'setPrompts('),
    2,
    'prompts 这个唯一数据源只能有 mergePrompts / dropPrompts 两个写入口',
  );
  assert.match(source, /const mergePrompts = useCallback\(/, 'mergePrompts 必须是 useCallback');
  assert.match(source, /const dropPrompts = useCallback\(/, 'dropPrompts 必须是 useCallback');
  assert.ok(
    count(source, 'mergePrompts(') >= 8,
    `mergePrompts 必须被各处写回复用（实测 ${String(count(source, 'mergePrompts('))} 次）`,
  );
  assert.match(
    source,
    /const \[prompts, setPrompts\] = useState<Map<number, Prompt>>/,
    '唯一数据源必须是 Map<id, Prompt>',
  );
  assert.match(source, /const selected = selectedId === null/, 'selected 必须是派生值，不是 state');
});

test('AC-127 D12：没有手写的「字段集各不相同的 merge」残留', () => {
  const source = readSource(WORKSPACE);
  assert.equal(source.includes('items.map((item)'), false, '不得再有手写 items 映射合并');
  assert.equal(/prev\.items|previous\.items/.test(source), false, '不得再对 items 数组做手工合并');
  assert.equal(/favorite: (updated|prompt|next)\.favorite/.test(source), false, '不得再逐字段搬运 Prompt');
  assert.equal(/remember_variables: (updated|prompt|next)\.remember_variables/.test(source), false, '不得再逐字段搬运 Prompt');

  for (const writer of ['toggleFavorite', 'setRememberVariables', 'patchPromptMeta']) {
    const start = source.indexOf(`const ${writer} = useCallback(`);
    assert.notEqual(start, -1, `${writer} 应存在`);
    const body = source.slice(start, start + 1200);
    assert.match(body, /mergePrompts\(updated\)/, `${writer} 必须把服务端回包交给 mergePrompts`);
  }
});

test('AC-127 D13：Workspace 行数必须比收敛前少（收敛前 941 行）', () => {
  const lines = readSource(WORKSPACE).split('\n').length;
  assert.ok(lines < 941, `收敛后行数应少于 941（实测 ${String(lines)}）`);
});

test('AC-127 D11（续）：填值弹窗不再是第 5 份副本 —— use-copy 只存 id，VarsDialog 只在换条目时 load', () => {
  const copy = readSource(USE_COPY);
  assert.match(copy, /useState<number \| null>\(null\)/, 'use-copy 只应存 varsPromptId');
  assert.equal(/useState<Prompt/.test(copy), false, 'use-copy 不得再持有 Prompt 对象副本');
  assert.match(
    copy,
    /varsPrompt: varsPromptId === null \? null : resolvePrompt\(varsPromptId\)/,
    'varsPrompt 必须每次从单一数据源反查',
  );

  const dialog = readSource(VARS_DIALOG);
  assert.match(dialog, /loadedIdRef/, 'VarsDialog 必须按 id 判断要不要 load');
  assert.match(
    dialog,
    /if \(loadedIdRef\.current === prompt\.id\) return;/,
    '同一条 prompt 换对象引用不得重跑 load（会把填了一半的变量值冲掉）',
  );
});

test('AC-127 D11（续 2）：编辑器表单只在「换了一条 prompt」时重填，回滚走显式重取', () => {
  const source = readSource(EDITOR);
  assert.match(source, /const lastFilled = useRef<Prompt \| null>\(null\)/, '必须有 lastFilled 稳定标识');
  assert.match(source, /\}, \[fill, isNew, prompt\]\);/, 'effect 依赖必须带上 isNew');
  assert.equal(
    /\}, \[fill, prompt\]\);/.test(source),
    false,
    '不得再依赖 prompt 对象引用（FR-136 ① 的原 bug）',
  );
  assert.match(source, /const reloadFromServer = useCallback\(/, '回滚必须走显式重取');
  assert.match(source, /const fresh = await api\.getPrompt\(prompt\.id\);/, 'reloadFromServer 必须真取服务端');
  assert.match(source, /fill\(fresh\);/, 'reloadFromServer 必须自己 fill');
  assert.match(source, /onRollbackDone=\{\(\) => void reloadFromServer\(\)\}/, '版本面板回滚后必须触发重取');
});

test('AC-127 B5（续）：编辑器左栏条目带 testid（渲染级用例要点它切条目）', () => {
  assert.match(
    readSource(WORKSPACE),
    /data-testid=\{`pm-editor-list-item-\$\{String\(prompt\.id\)\}`\}/,
    '新增 testid：pm-editor-list-item-<id>',
  );
});
