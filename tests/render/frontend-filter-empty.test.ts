/**
 * 常驻回归（阶段 71 / FR-154 / AC-133 D14）。
 *
 * 判据：空态文案必须与**当前生效的筛选**（`filters.q`，即结果对应的那次请求）同源 ——
 * 不许用还没生效的输入框内容（`query`）去描述一份旧结果（N18）。
 *
 * 红基线：改前 `hasActiveFilter` / `emptyHint` 读的是未防抖的 `query`，所以"打完字还没发请求"
 * 这一段界面就会说「没有匹配「zz」的条目」—— 而此刻渲染的列表是上一次（未筛选）的结果。
 */
import { element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';

const { default: Workspace } = await import('../../web/src/components/Workspace.tsx');

/** 断言中途失败也要卸载：否则上一棵 DOM 会留给下一条用例（详见 harness 的 mountRegistry）。 */
const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

function install(): void {
  route('GET', /^\/api\/me$/, () => ({ status: 200, body: { username: 'admin' } }));
  route('GET', /^\/api\/folders$/, () => ({ status: 200, body: { items: [] } }));
  route('GET', /^\/api\/tags$/, () => ({ status: 200, body: { items: [] } }));
  // 列表永远为空：这样空态一直可见，文案考的就是"跟哪次筛选说话"
  route('GET', /^\/api\/prompts$/, () => ({ status: 200, body: { total: 0, limit: 20, offset: 0, items: [] } }));
  route('POST', /^\/api\/render\/markdown$/, () => ({ status: 200, body: { html: '<p>m</p>' } }));
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  resetRoutes();
  window.localStorage.clear();
  window.localStorage.setItem('pm-view-mode', 'split');
});

test('常驻：空态文案跟"当前生效的筛选"走，不用还没生效的输入', async () => {
  install();
  const mounted = await mountTracked(element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(Workspace, {
    themeMode: 'light',
    onCycleTheme: () => undefined,
    onSignedOut: () => undefined,
  }))));
  await waitFor(() => document.querySelector('[data-testid="pm-search-input"]') !== null, '搜索框出现', 3000);
  await waitFor(() => bodyText().includes('还没有可用的 prompt'), '初始（无筛选）空态出现', 3000);

  const input = document.querySelector<HTMLInputElement>('[data-testid="pm-search-input"]');
  assert.ok(input !== null, '找不到搜索框');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'zz');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  // 防抖窗口内（请求还没发出去）：界面仍对应"上一次筛选" ⇒ 文案不许说「zz」
  const immediate = bodyText();
  assert.equal(
    immediate.includes('没有匹配「zz」'),
    false,
    '空态文案用了还没生效的输入（N18）：此刻渲染的结果对应的是未筛选的那次请求',
  );
  assert.equal(immediate.includes('还没有可用的 prompt'), true, `防抖窗口内空态文案被改写了：${immediate.slice(0, 200)}`);

  // 防抖 + 请求落地后：生效筛选 = q=zz，文案必须换成它
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  await waitFor(() => bodyText().includes('没有匹配「zz」'), '生效筛选后的空态文案', 3000);
});
