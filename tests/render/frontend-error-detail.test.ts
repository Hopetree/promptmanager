/**
 * 常驻回归（阶段 71 / FR-153 / AC-133 C12）。
 *
 * 判据：服务端返回**字段级说明**（`{error:'invalid_body', details:[{path,message}]}`，可能没有顶层 `message`）时，
 * 用户必须看到字段级文案 —— 不许只显示 `HTTP 400 invalid_body`（N15：`describeError` 吞掉 details）。
 *
 * 同时钉住"既有映射不许被改坏"：`unauthorized` / `invalid_credentials` / `rate_limited` / `folder_not_empty`
 * 四条人话文案与 `serverMessage` 优先规则都还在。
 */
import { element, mountRegistry, releaseLoaderPort, resetRoutes, route, waitFor } from './harness.ts';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { act } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';

const { default: SyncModal } = await import('../../web/src/components/SyncModal.tsx');
const { ApiError, describeError } = await import('../../web/src/api.ts');

const { mountTracked, unmountAll } = mountRegistry();

afterEach(unmountAll);

after(() => {
  releaseLoaderPort();
});

test('常驻：describeError 优先服务端 message，其次 details 字段级说明，再退回错误码/消息', () => {
  // ① 顶层 message（FR-67 那类规则说明）优先
  assert.equal(
    describeError(new ApiError(400, 'invalid_password', 'HTTP 400 invalid_password', undefined, '密码至少 8 位')),
    '密码至少 8 位',
  );
  // ② 服务端字段级 details（ajv / InvalidBodyError）必须被渲染出来
  const fieldLevel = describeError(
    new ApiError(400, 'invalid_body', 'HTTP 400 invalid_body', [{ path: '/repo', message: '仓库格式不正确' }]),
  );
  assert.equal(fieldLevel.includes('仓库格式不正确'), true, `字段级说明被吞了：${fieldLevel}`);
  assert.equal(fieldLevel.includes('invalid_body'), false, `用户仍看到裸错误码：${fieldLevel}`);
  assert.equal(fieldLevel.includes('HTTP 400'), false, `用户仍看到 HTTP 状态码：${fieldLevel}`);
  // ③ 多条 details 都要出现
  const twoFields = describeError(
    new ApiError(400, 'invalid_body', 'HTTP 400 invalid_body', [
      { path: '/repo', message: '仓库格式不正确' },
      { path: '/path', message: '路径不能为空' },
    ]),
  );
  assert.equal(twoFields.includes('仓库格式不正确') && twoFields.includes('路径不能为空'), true, `多条字段级说明没有都给：${twoFields}`);
  // ④ details 是字符串数组（import 那类）也要能渲染
  const strings = describeError(new ApiError(400, 'invalid_import', 'HTTP 400 invalid_import', ['第 2 行标签重复']));
  assert.equal(strings.includes('第 2 行标签重复'), true, `字符串数组 details 被吞了：${strings}`);
  // ⑤ 既有映射不许改坏
  assert.equal(describeError(new ApiError(401, 'unauthorized', 'HTTP 401 unauthorized')), '会话已失效，请重新登录');
  assert.equal(describeError(new ApiError(401, 'invalid_credentials', 'HTTP 401 invalid_credentials')), '用户名或密码不正确');
  assert.equal(describeError(new ApiError(429, 'rate_limited', 'HTTP 429 rate_limited')), '尝试过于频繁，请稍后再试（登录失败次数超过阈值）');
  assert.equal(describeError(new ApiError(409, 'folder_not_empty', 'HTTP 409 folder_not_empty')), '文件夹下还有子文件夹或 prompt，不能删除');
  // ⑥ 无 code / 非 ApiError 时仍有兜底文案
  assert.equal(describeError(new ApiError(500, undefined, 'HTTP 500')), 'HTTP 500');
  assert.equal(describeError(new Error('boom')), 'boom');
  assert.equal(describeError('boom'), 'boom');
});

test('常驻：字段级校验失败时界面显示的是字段说明，不是 invalid_body', async () => {
  resetRoutes();
  window.localStorage.clear();
  route('GET', /^\/api\/sync\/config$/, () => ({
    status: 200,
    body: { configured: true, repo: 'a/b', instance: '', path: 'promptmanager/pm.json', branch: '', token_set: true, token_tail: 'abcd' },
  }));
  route('PUT', /^\/api\/sync\/config$/, () => ({
    status: 400,
    body: { error: 'invalid_body', details: [{ path: '/repo', message: '仓库格式不正确（应为 owner/repo）' }] },
  }));
  const mounted = await mountTracked(element(ConfigProvider, { theme: { token: { motion: false } } }, element(AntdApp, {}, element(SyncModal, {
    open: true,
    onClose: () => undefined,
    onPulled: () => undefined,
  }))));
  await waitFor(() => document.querySelector('[data-testid="sync-save"]') !== null, '保存按钮出现', 3000);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="sync-save"]')?.click();
  });
  await waitFor(() => document.querySelector('.ant-message-notice') !== null, '失败后应出现提示', 3000);
  const toast = document.querySelector('.ant-message-notice')?.textContent ?? '';
  assert.equal(toast.includes('仓库格式不正确'), true, `提示里没有字段级说明：${toast}`);
  assert.equal(toast.includes('invalid_body'), false, `提示里出现了裸错误码：${toast}`);
});
