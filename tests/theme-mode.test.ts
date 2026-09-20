// FR-44 / AC-42 的纯逻辑单测：主题三态（亮 → 暗 → 跟随系统）循环、默认值、localStorage 记忆、
// `<html>` 的 colorScheme 取值、旧键清理。都是无 DOM 依赖的纯函数（storage 注入）。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_KEYS,
  THEME_MODE_KEY,
  cleanupLegacyKeys,
  colorSchemeFor,
  isThemeMode,
  nextThemeMode,
  readThemeMode,
  resolveDark,
  themeModeLabel,
  themeToggleTitle,
  writeThemeMode,
  type ThemeStorage,
} from '../web/src/theme-mode.ts';

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

test('nextThemeMode：亮 → 暗 → 跟随系统 → 亮（未知当前值默认回到 system）', () => {
  assert.equal(nextThemeMode('light'), 'dark');
  assert.equal(nextThemeMode('dark'), 'system');
  assert.equal(nextThemeMode('system'), 'light');
  assert.equal(nextThemeMode('nonsense'), 'light');
});

test('默认（无记忆 / 坏值）= 跟随系统；写入后可读回（localStorage 记忆）', () => {
  const empty = fakeStorage();
  assert.equal(readThemeMode(empty), 'system');
  const broken = fakeStorage({ [THEME_MODE_KEY]: 'rainbow' });
  assert.equal(readThemeMode(broken), 'system');

  writeThemeMode(empty, 'dark');
  assert.equal(empty.data[THEME_MODE_KEY], 'dark');
  assert.equal(readThemeMode(empty), 'dark');
});

test('cleanupLegacyKeys 清掉 v17 之前的 pm-mode 旧键', () => {
  const storage = fakeStorage({ 'pm-mode': 'manage', 'pm-view-mode': 'table' });
  cleanupLegacyKeys(storage);
  assert.equal(storage.data['pm-mode'], undefined);
  assert.equal(storage.data['pm-view-mode'], 'table', '不应误删仍在用的偏好');
  assert.ok(LEGACY_KEYS.includes('pm-mode'));
});

test('resolveDark / colorSchemeFor：system 交回系统（空串），light/dark 显式', () => {
  assert.equal(resolveDark('system', true), true);
  assert.equal(resolveDark('system', false), false);
  assert.equal(resolveDark('dark', false), true);
  assert.equal(resolveDark('light', true), false);

  assert.equal(colorSchemeFor('light'), 'light');
  assert.equal(colorSchemeFor('dark'), 'dark');
  assert.equal(colorSchemeFor('system'), '');
});

test('图标按钮的 title 体现当前态与下一态（跟随系统用中性表述）', () => {
  assert.equal(themeModeLabel('system'), '跟随系统');
  assert.equal(themeModeLabel('light'), '亮色');
  assert.equal(themeModeLabel('dark'), '暗色');
  assert.equal(themeToggleTitle('system'), '主题：跟随系统（点击切换到亮色）');
  assert.equal(themeToggleTitle('light'), '主题：亮色（点击切换到暗色）');
  assert.equal(themeToggleTitle('dark'), '主题：暗色（点击切换到跟随系统）');
});

test('isThemeMode 只认三态', () => {
  assert.equal(isThemeMode('light'), true);
  assert.equal(isThemeMode('dark'), true);
  assert.equal(isThemeMode('system'), true);
  assert.equal(isThemeMode('auto'), false);
  assert.equal(isThemeMode(null), false);
});
