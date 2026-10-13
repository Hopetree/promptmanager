import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * FR-152 / AC-133 B6·B7：未保存编辑的保护。
 *
 * 判据是"**绝不允许内容没了且无任何提示**"：任何"切换 / 关闭编辑器"的路径都必须走
 * `requestLeave(action)` —— 没有未保存修改就直接执行；有就先弹确认，用户点「放弃修改」
 * 之后才真正执行那件事。浏览器关闭 / 刷新由 `beforeunload` 兜住。
 *
 * 为什么不做自动保存：那会改掉"版本 = 内容真变化才 +1"的口径（FR-127 / D-59）。
 */
export interface UnsavedGuard {
  /** 确认弹窗是否打开（只在打开时挂载弹窗，DOM 上"有确认"与"没确认"才分得清）。 */
  asking: boolean;
  /** `PromptEditor` 上报"当前有没有未保存的修改"。 */
  reportDirty: (dirty: boolean) => void;
  /** **唯一**的离开入口：被拦下的那次 `action` 交给「放弃修改」执行。 */
  requestLeave: (action: () => void) => void;
  /** 用户选「继续编辑」：什么都不做，留在编辑器里（被拦下的 action 作废）。 */
  keepEditing: () => void;
  /** 用户选「放弃修改」：执行被拦下的那件事。 */
  discardChanges: () => void;
  /** 编辑器正常关掉（没有未保存内容）：把守卫复位。 */
  reset: () => void;
}

export function useUnsavedGuard(): UnsavedGuard {
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  /** 用户点「放弃修改」后真正要执行的那件事，由调用方决定（切到哪条 / 关编辑器）。 */
  const actionRef = useRef<(() => void) | null>(null);

  const requestLeave = useCallback(
    (action: () => void): void => {
      if (!dirty) {
        action();
        return;
      }
      actionRef.current = action;
      setAsking(true);
    },
    [dirty],
  );

  const keepEditing = useCallback((): void => {
    actionRef.current = null;
    setAsking(false);
  }, []);

  const discardChanges = useCallback((): void => {
    const action = actionRef.current;
    actionRef.current = null;
    setAsking(false);
    setDirty(false);
    action?.();
  }, []);

  const reset = useCallback((): void => {
    actionRef.current = null;
    setAsking(false);
    setDirty(false);
  }, []);

  // beforeunload 只在真有未保存修改时挂：刷新 / 关标签页同样不许静默丢弃
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return { asking, reportDirty: setDirty, requestLeave, keepEditing, discardChanges, reset };
}
