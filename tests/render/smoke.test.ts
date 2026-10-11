/**
 * 渲染级测试基建的自证（阶段 65 / AC-127 A1）：
 * 证明 `node --test` 里真的能把一个 antd 组件挂到 jsdom 上、点得动、断言得到 DOM。
 * 这条用例不测产品行为，只测"测试网本身能工作"—— 后面所有 FR-136 / FR-137 的用例都靠它。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prompt } from '../../web/src/types.ts';
import { byTestId, element, mount } from './harness.ts';

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 1,
    title: '基建自证',
    user_prompt: '正文',
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
    ...overrides,
  };
}

test('AC-127 A1：jsdom + react-dom/client 能挂起真实组件，并断言 DOM 与交互', async () => {
  const { default: FavoriteStar } = await import('../../web/src/components/FavoriteStar.tsx');
  const toggled: Prompt[] = [];
  const mounted = await mount(
    element(FavoriteStar, {
      prompt: makePrompt(),
      testid: 'pm-fav-smoke',
      onToggle: (prompt: Prompt) => toggled.push(prompt),
    }),
  );

  const star = byTestId('pm-fav-smoke');
  assert.equal(star.getAttribute('aria-label'), '收藏', '未收藏时应渲染「收藏」星标');

  star.click();
  assert.equal(toggled.length, 1, '点击必须回调 onToggle');

  await mounted.unmount();
});
