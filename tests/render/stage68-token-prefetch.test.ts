/**
 * 阶段 68 / FR-142（AC-130 ⑨⑩⑪，渲染级）：Token 抽屉不再每次全量预取明文。
 *
 * 问题（设计评审 F17）：`load()` 每次都对**全部可查看行**重发 reveal —— 打开抽屉、创建、撤销各来一轮
 * ⇒ 同一场景的 reveal 次数随行数翻倍。现在 `load()` 只补**缓存里没有的**行。
 *
 * 为什么必须渲染级：判据是「同一场景 reveal 请求次数下降」——请求流水是前端行为；
 * 「明文只留内存」也只能在真挂起来的组件上读 `localStorage` / DOM 来证明。
 */
// ⚠️ `./harness.ts` 必须**第一个**被 import（它要在 `react-dom` 求值前把 jsdom 全局装好）。
import { byTestId, calls, element, mount, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp } from 'antd';
import type { TokenSummary } from '../../web/src/types.ts';

const { default: TokenDrawer } = await import('../../web/src/components/TokenDrawer.tsx');

after(() => {
  releaseLoaderPort();
});

const SECRET = (id: number): string => `pm_secret_${String(id)}_do_not_leak`;

function makeToken(overrides: Partial<TokenSummary> & { id: number }): TokenSummary {
  return {
    name: `令牌 ${String(overrides.id)}`,
    created_at: '2026-10-12T00:00:00.000Z',
    last_used_at: null,
    revoked_at: null,
    revealable: true,
    scope: 'read',
    ...overrides,
  };
}

interface State {
  tokens: TokenSummary[];
  nextId: number;
}

function installRoutes(state: State): void {
  route('GET', /^\/api\/tokens$/, () => ({ status: 200, body: { items: state.tokens } }));
  route('POST', /^\/api\/tokens$/, () => {
    const created = makeToken({ id: state.nextId, name: `新令牌 ${String(state.nextId)}` });
    state.nextId += 1;
    state.tokens = [...state.tokens, created];
    return { status: 201, body: { ...created, token: SECRET(created.id) } };
  });
  route('POST', /^\/api\/tokens\/\d+\/reveal$/, (request) => {
    const id = Number(request.path.split('/')[3]);
    return { status: 200, body: { token: SECRET(id) } };
  });
  route('DELETE', /^\/api\/tokens\/\d+\/permanent$/, (request) => {
    const id = Number(request.path.split('/')[3]);
    state.tokens = state.tokens.filter((token) => token.id !== id);
    return { status: 204, body: undefined };
  });
  route('DELETE', /^\/api\/tokens\/\d+$/, (request) => {
    const id = Number(request.path.split('/')[3]);
    state.tokens = state.tokens.map((token) =>
      token.id === id ? { ...token, revoked_at: '2026-10-12T01:00:00.000Z' } : token,
    );
    return { status: 204, body: undefined };
  });
}

function revealCalls(): number[] {
  return calls
    .filter((call) => call.method === 'POST' && /^\/api\/tokens\/\d+\/reveal$/.test(call.path))
    .map((call) => Number(call.path.split('/')[3]));
}

function listCalls(): number {
  return calls.filter((call) => call.method === 'GET' && call.path === '/api/tokens').length;
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

async function openDrawer(state: State): Promise<Mounted> {
  installRoutes(state);
  const mounted = await mount(
    element(AntdApp, {}, element(TokenDrawer, { open: true, onClose: () => undefined })),
  );
  await waitFor(() => document.querySelectorAll('[data-testid^="pm-token-mask-"]').length === state.tokens.length, '令牌行应渲染出来');
  return mounted;
}

async function click(testid: string): Promise<void> {
  await act(async () => {
    byTestId(testid).click();
  });
}

/** 点 Popconfirm 的确认按钮（harness 只挂 antd 的 `App`、没有 zh 语言包 ⇒ 按钮是默认英文 OK）。 */
async function confirmPopconfirm(): Promise<void> {
  await waitFor(() => document.querySelector('.ant-popconfirm') !== null, 'Popconfirm 应弹出来');
  await act(async () => {
    const buttons = [...document.querySelectorAll('.ant-popconfirm .ant-btn')];
    const confirm = buttons.find((button) => /OK|确定/i.test(button.textContent ?? ''));
    assert.ok(confirm !== undefined, 'Popconfirm 必须有确认按钮');
    (confirm as HTMLElement).click();
  });
}

/** 往受控输入框里写字（绕过 React 的 value tracker，模拟真人输入）。 */
async function typeInto(testid: string, value: string): Promise<void> {
  await act(async () => {
    const field = byTestId(testid) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    assert.ok(setter !== undefined, 'input 必须有原生 value setter');
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('AC-130 ⑨：打开 → 创建 → 撤销 的 reveal 次数（改前每步都全量重发，改后只补缺失）', async () => {
  const state: State = {
    tokens: [
      makeToken({ id: 1, name: '甲' }),
      makeToken({ id: 2, name: '乙', revoked_at: '2026-10-01T00:00:00.000Z' }), // 已撤销：仍要预取（FR-100）
      makeToken({ id: 3, name: '丙' }),
    ],
    nextId: 4,
  };
  const mounted = await openDrawer(state);
  try {
    // 打开：3 行都还没有缓存 ⇒ 恰好 3 次 reveal（这是首次必须付的代价）
    assert.deepEqual(revealCalls(), [1, 2, 3], `打开时应对 3 行各 reveal 一次（实测 ${JSON.stringify(revealCalls())}）`);

    // 创建 1 个：只补**新行**（改前会把 4 行全部重发 ⇒ 累计 7 次）
    // 名称是必填项（`rules: required`）⇒ 先填再提交，否则 onFinish 根本不会被调用
    await typeInto('pm-token-name', '阶段68 新令牌');
    await click('pm-token-create');
    await waitFor(() => listCalls() === 2, '创建后应重拉一次列表');
    assert.equal(
      revealCalls().length,
      4,
      `创建只该多出 1 次 reveal（新行）；改前会把 4 行全部重发 ⇒ 累计 7 次。实测 ${String(revealCalls().length)} 次：${JSON.stringify(revealCalls())}`,
    );
    assert.deepEqual(revealCalls(), [1, 2, 3, 4], '创建只该多出 1 次 reveal（新行）');

    // 撤销 1 个：缓存里已有 ⇒ **0 次** reveal（改前会把 4 行全部重发 ⇒ 累计 11 次）
    await click('pm-token-revoke-1');
    await confirmPopconfirm(); // 撤销在 Popconfirm 里（二次确认是既有交互，不改）
    await waitFor(() => listCalls() === 3, '撤销后应重拉一次列表');
    assert.equal(
      revealCalls().length,
      4,
      `撤销只该改列表、不重取明文；改前会把 4 行全部重发 ⇒ 累计 11 次。实测 ${String(revealCalls().length)} 次：${JSON.stringify(revealCalls())}`,
    );

    // 列表请求数不变（打开 / 创建 / 撤销各一次）—— 本阶段减的是 reveal，不是列表
    assert.equal(listCalls(), 3, `列表请求应仍是 3 次（实测 ${String(listCalls())}）`);
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑩：明文只留内存 —— localStorage / sessionStorage / 页面文本里都搜不到', async () => {
  const state: State = { tokens: [makeToken({ id: 1 }), makeToken({ id: 2 })], nextId: 3 };
  const mounted = await openDrawer(state);
  try {
    await waitFor(() => revealCalls().length === 2, '两行都应已预取');
    // 内存里确实拿到了（掩码是"前 5 + … + 后 4"，明文不在 DOM 里）
    assert.equal(byTestId('pm-token-copy-1').getAttribute('data-prefetched'), '1');
    assert.match(byTestId('pm-token-mask-1').textContent ?? '', /^pm_se/);

    const dump = JSON.stringify(window.localStorage);
    assert.equal(dump.includes('pm_secret_'), false, `localStorage 里不得出现明文（实测 ${dump}）`);
    const sessionDump = JSON.stringify(window.sessionStorage);
    assert.equal(sessionDump.includes('pm_secret_'), false, `sessionStorage 里不得出现明文（实测 ${sessionDump}）`);
    assert.equal(
      (document.body.textContent ?? '').includes('pm_secret_'),
      false,
      '页面文本里不得出现明文（DOM 只显示掩码）',
    );
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑪：revealable=false 仍显示 — 且没有复制入口；已撤销行照常预取明文', async () => {
  const state: State = {
    tokens: [
      makeToken({ id: 1 }),
      makeToken({ id: 2, revoked_at: '2026-10-01T00:00:00.000Z' }),
      makeToken({ id: 3, revealable: false }), // 迁移前创建、没存密文 ⇒ 取不到
    ],
    nextId: 4,
  };
  const mounted = await openDrawer(state);
  try {
    await waitFor(() => revealCalls().length === 2, '只应对两行可查看的行 reveal（第三行 revealable=false）');
    assert.deepEqual(revealCalls(), [1, 2], `revealable=false 的行不该发 reveal（实测 ${JSON.stringify(revealCalls())}）`);

    // 取不到密文的行：Token 列是 —，且「使用」列没有复制按钮（FR-100 ③：不留白、不误导）
    assert.equal((byTestId('pm-token-mask-3').textContent ?? '').trim(), '—');
    assert.equal(document.querySelector('[data-testid="pm-token-copy-3"]'), null, 'revealable=false 不该有复制按钮');

    // 已撤销的行（id=2）：明文仍预取（撤销 ≠ 销毁），掩码照常显示、复制入口照常在
    assert.equal(byTestId('pm-token-copy-2').getAttribute('data-prefetched'), '1', '已撤销行仍要预取明文（FR-100）');
    assert.match(byTestId('pm-token-mask-2').textContent ?? '', /^pm_se/);
  } finally {
    await mounted.unmount();
  }
});

test('AC-130 ⑩（源码级）：TokenDrawer 不把明文写进任何 Web Storage，且预取是"只补缺失"', async () => {
  const { readWebSource } = await import('../source-text.ts');
  const source = readWebSource('components/TokenDrawer.tsx');
  assert.doesNotMatch(source, /localStorage|sessionStorage/, '明文组件不得碰 Web Storage（FR-142 / D-66 ④）');
  assert.match(source, /!cache\.has\(token\.id\)/, '预取必须跳过缓存里已有的行');
  assert.match(source, /plaintextsRef\.current = new Map\(\)/, '抽屉关闭要连 ref 里的缓存一起清');
});
