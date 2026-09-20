/**
 * 明暗主题模式（FR-44 / AC-42）：单个图标按钮在 **亮 → 暗 → 跟随系统** 之间循环。
 *
 * - 默认（首次进入 / 清空 localStorage）= `system`（跟随 `prefers-color-scheme`）；
 * - 选择写进 localStorage（键 `pm-theme`），刷新后保持；
 * - `colorScheme` 由 App 落到 `<html>`：system = 移除该内联属性（交回系统），light/dark = 显式。
 *
 * 这里只放**无 React / 无 DOM 依赖**的纯逻辑（storage 注入），便于 node:test 直接单测。
 */

export type ThemeMode = 'light' | 'dark' | 'system';

/** localStorage 键（新） */
export const THEME_MODE_KEY = 'pm-theme';
/** 旧键：v17（FR-43）起界面只有一套，旧的界面偏好键统一清理 */
export const LEGACY_KEYS = ['pm-mode'] as const;

/** 点击循环顺序：亮 → 暗 → 跟随系统 → 亮 … */
export const THEME_CYCLE: readonly ThemeMode[] = ['light', 'dark', 'system'];

export interface ThemeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** 循环的下一态。默认（未知当前值）= system，保证"首次即跟随系统"。 */
export function nextThemeMode(current: unknown): ThemeMode {
  const index = THEME_CYCLE.indexOf(isThemeMode(current) ? current : 'system');
  const next = THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
  return next ?? 'system';
}

/** 读本地记忆；缺失/坏值 → system（FR-44 的默认值）。 */
export function readThemeMode(storage: ThemeStorage): ThemeMode {
  try {
    const raw = storage.getItem(THEME_MODE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemeMode(storage: ThemeStorage, mode: ThemeMode): void {
  try {
    storage.setItem(THEME_MODE_KEY, mode);
  } catch {
    /* 隐私模式下写不进就算了（本次会话仍然生效） */
  }
}

/** 清理 v17 之前的遗留 localStorage 键（已被取消的旧界面偏好）。 */
export function cleanupLegacyKeys(storage: ThemeStorage): void {
  try {
    for (const key of LEGACY_KEYS) storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 当前模式在当前系统偏好下实际是亮还是暗。 */
export function resolveDark(mode: ThemeMode, prefersDark: boolean): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return prefersDark;
}

/** 图标按钮的 `title` / 文案（跟随系统用中性表述）。 */
export function themeModeLabel(mode: ThemeMode): string {
  if (mode === 'light') return '亮色';
  if (mode === 'dark') return '暗色';
  return '跟随系统';
}

/** 点击后会切到的下一态，用来写 tooltip（"主题：跟随系统 → 亮色"）。 */
export function themeToggleTitle(mode: ThemeMode): string {
  return `主题：${themeModeLabel(mode)}（点击切换到${themeModeLabel(nextThemeMode(mode))}）`;
}

/** `<html>` 的 colorScheme 值：system → 空串（移除内联，交回系统）。 */
export function colorSchemeFor(mode: ThemeMode): string {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return '';
}
