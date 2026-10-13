/**
 * 常驻回归（阶段 71 / FR-151 ① / AC-133 A2）。
 *
 * 判据：连续点两条 prompt 时，**后发起的那次选择必须赢** —— 先发出的慢 `GET /api/prompts/:id`
 * 不得把右栏 / 编辑器改回先点的那条。
 *
 * 来源：`var/review-2/frontend-detail-race.test.ts`（评审探针，改前 fail）。原探针的断言原样保留，
 * 并新增两条**更强**的断言：① 详情正文必须**正面**等于最后点击那条；② `openEditor`（AC-133 A2 点名的入口）。
 */
import { calls, element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor, type Mounted } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Prompt } from '../../web/src/types.ts';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

/** 断言中途失败也要卸载：否则上一棵 DOM 会留给下一条用例（详见 harness 的 mountRegistry）。 */
const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function makePrompt(id: number, title: string, body: string): Prompt {
  return {
    id,
    title,
    user_prompt: body,
    system_prompt: '',
    notes: '',
    folder_id: null,
    tags: [],
    favorite: false,
    remember_variables: true,
    created_at: '2026-10-11T00:00:00.000Z',
    updated_at: '2026-10-11T00:00:00.000Z',
    version_no: 1,
    use_count: 0,
    last_used_at: null,
  };
}

function install(): void {
  route('GET', /^\/api\/me$/, () => ({ status: 200, body: { username: 'admin' } }));
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/prompts$/, () => ({
    status: 200,
    body: {
      total: 2,
      limit: 20,
      offset: 0,
      items: [makePrompt(1, '甲', '正文甲'), makePrompt(2, '乙', '正文乙')],
    },
  }));
  route('GET', /^\/api\/prompts\/\d+$/, async (request) => {
    const id = Number(request.path.split('/').pop());
    if (id === 1) await new Promise((resolve) => setTimeout(resolve, 400));
    return { status: 200, body: makePrompt(id, id === 1 ? '甲' : '乙', id === 1 ? '正文甲' : '正文乙') };
  });
  route('GET', /^\/api\/prompts\/\d+\/versions$/, () => ({ status: 200, body: { items: [] } }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>m</p>' } }));
}

async function mountTable(): Promise<Mounted> {
  const mounted: Mounted = await mountTracked(
    element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(Workspace, {
      themeMode: 'light',
      onCycleTheme: () => undefined,
      onSignedOut: () => undefined,
    }))),
  );
  await waitFor(() => document.querySelector('[data-testid="pm-edit-1"]') !== null, '表格行出现', 3000);
  return mounted;
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.localStorage.setItem('pm-view-mode', 'table');
});

test('常驻：连续点两条时慢的详情响应不得覆盖后点的那条', async () => {
  install();
  const mounted = await mountTable();
  // 表格行本体可点（onRow → onSelect）；先点甲（慢 400ms），再点乙（立刻）
  const rowOf = (id: number): HTMLElement | null =>
    document.querySelector(`[data-testid="pm-fav-table-${String(id)}"]`)?.closest('tr') ?? null;
  const row1 = rowOf(1);
  const row2 = rowOf(2);
  assert.ok(row1 !== null && row2 !== null, '找不到表格行');

  await act(async () => {
    row1.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  });
  await act(async () => {
    row2.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  const plain = document.querySelector<HTMLButtonElement>('[data-testid="pm-detail-plain"]');
  if (plain !== null) {
    await act(async () => {
      plain.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  assert.ok(
    calls.filter((c) => c.path.startsWith('/api/prompts/')).length >= 2,
    '前提不成立：两条详情请求没有都发出去',
  );
  const detailText = document.body.textContent ?? '';
  const hasJia = detailText.includes('正文甲');
  const hasYi = detailText.includes('正文乙');
  // 原探针断言（原样保留）
  assert.equal(
    hasJia && !detailText.includes('正文乙'),
    false,
    `右栏显示的是先点的那条（慢响应覆盖）：has甲=${String(hasJia)} has乙=${String(hasYi)}`,
  );
  // 新增（更强）：必须**正面**是最后点击的那条
  assert.equal(hasYi, true, `右栏没有显示最后点击的那条（正文乙）：has甲=${String(hasJia)} has乙=${String(hasYi)}`);
});

test('常驻：连续点两条「编辑」时慢的 openEditor 响应不得覆盖后点的那条', async () => {
  install();
  const mounted = await mountTable();
  const edit = (id: number): HTMLElement => {
    const button = document.querySelector<HTMLElement>(`[data-testid="pm-edit-${String(id)}"]`);
    assert.ok(button !== null, `找不到 pm-edit-${String(id)}`);
    return button;
  };
  await act(async () => {
    edit(1).click();
  });
  await act(async () => {
    edit(2).click();
  });
  await waitFor(() => document.querySelector('[data-testid="editor-user-prompt"]') !== null, '编辑器出现', 3000);
  // 等先发那条（400ms）的响应落地 —— 它必须被丢弃
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  const title = document.querySelector<HTMLInputElement>('[data-testid="editor-title"]')?.value ?? '(none)';
  const body = document.querySelector<HTMLTextAreaElement>('[data-testid="editor-user-prompt"]')?.value ?? '(none)';
  assert.equal(title, '乙', `编辑器停在了先点的那条（慢响应覆盖）：title=${JSON.stringify(title)}`);
  assert.equal(body, '正文乙', `编辑器正文是先点的那条：body=${JSON.stringify(body)}`);
});
