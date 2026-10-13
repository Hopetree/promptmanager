/**
 * 常驻回归（阶段 71 / FR-153 / AC-133 C10·C11）。
 *
 * 判据：同步配置**保存失败后**表单 / DOM 里不得残留明文 GitHub 令牌；关闭再打开也不残留；
 * `localStorage` 里不得出现任何凭据。
 *
 * 来源：`var/review-2/frontend-sync-token.test.ts`（评审探针，改前 fail：`TOKEN AFTER FAILED SAVE: "github_pat_SUPERSECRET123"`）。
 */
import { element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';

const { default: SyncModal } = await import('../../web/src/components/SyncModal.tsx');

/** 断言中途失败也要卸载：否则上一棵 DOM 会留给下一条用例（详见 harness 的 mountRegistry）。 */
const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

const SECRET = 'github_pat_SUPERSECRET123';

after(() => {
  releaseLoaderPort();
});

function install(): void {
  route('GET', /^\/api\/sync\/config$/, () => ({
    status: 200,
    body: { configured: true, repo: 'a/b', instance: '', path: 'promptmanager/pm.json', branch: '', token_set: true, token_tail: 'abcd' },
  }));
  route('PUT', /^\/api\/sync\/config$/, () => ({ status: 400, body: { error: 'invalid_body', message: '仓库格式不正确' } }));
}

function view(open: boolean): ReturnType<typeof element> {
  return element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(SyncModal, {
    open,
    onClose: () => undefined,
    onPulled: () => undefined,
  })));
}

function tokenValue(): string {
  return document.querySelector<HTMLInputElement>('[data-testid="sync-token"]')?.value ?? '(gone)';
}

function typeSecret(): void {
  const input = document.querySelector<HTMLInputElement>('[data-testid="sync-token"]');
  assert.ok(input !== null, '找不到 sync-token');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, SECRET);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function localStorageDump(): string {
  const entries: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index) ?? '';
    entries.push(`${key}=${window.localStorage.getItem(key) ?? ''}`);
  }
  return entries.join('\n');
}

test('常驻（原探针）：保存失败后 GitHub 令牌不留在表单里，关闭再打开也不残留', async () => {
  resetRoutes();
  window.localStorage.clear();
  install();
  const mounted = await mountTracked(view(true));
  await waitFor(() => document.querySelector('[data-testid="sync-token"]') !== null, 'token 输入框出现', 3000);
  await act(async () => {
    typeSecret();
  });
  assert.equal(tokenValue().includes('SUPERSECRET'), true, '前置不成立：令牌没进输入框');
  // 提交（表单 htmlType=submit）→ 服务端 400
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="sync-save"]')?.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  const still = tokenValue();
  assert.equal(still.includes('SUPERSECRET'), false, `保存失败后令牌仍留在表单里：${still}`);
  assert.equal(localStorageDump().includes('SUPERSECRET'), false, '令牌进了 localStorage');

  // 关闭 → 再打开：仍不得残留
  await act(async () => {
    mounted.root.render(view(false));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await act(async () => {
    mounted.root.render(view(true));
  });
  await waitFor(() => document.querySelector('[data-testid="sync-token"]') !== null, '重新打开后结算框出现', 3000);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert.equal(tokenValue().includes('SUPERSECRET'), false, `关闭再打开后令牌又出现了：${tokenValue()}`);
});
