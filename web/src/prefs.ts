/**
 * 本地偏好读写（视图 / 排序 / 收藏置顶等都记住；不新增接口）。v17（FR-43）起界面只有一套，没有模式开关。
 *
 * 从 `components/Workspace.tsx` 抽出来：①「存储里有且合法才用存储值」这条判据只需要**一处实现**
 * （FR-92 ② 的源码级断言按函数体切片检查）；② Workspace 有行数棘轮（AC-127 D13）。
 */

export function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下写不进就算了 */
  }
}
