/**
 * 会话失效（401）的单点出口（FR-130 / AC-125 ①）。
 *
 * 为什么单独一个模块：
 * - **401 判断只允许出现在 `api.ts` 的 `request()` 里**（AC-125 ②）——组件层不再各自判断；
 * - 但「掉登录态就踢回登录页」需要动 `App.tsx` 的状态（`username`），而 `api.ts` 是纯 HTTP
 *   客户端、不该 import React ⇒ 用**模块级订阅**把两边解耦：`App.tsx` 注册处理器，
 *   `request()` 收到 401 时通知一次。
 * - 本文件**零 import**：`tests/**` 要能直接 `import ... from '../web/src/session.ts'` 做运行时
 *   单测，而 Node ESM 只认带显式扩展名的相对导入，且不会替你补 `./xxx` 的后缀。
 *
 * 通知语义：只调处理器、**不弹提示、不抛错**。用户看到的「会话已失效，请重新登录」由各调用点
 * 原有的通用分支（`describeError` 对 `unauthorized` 的文案）负责 —— 这里再弹一次就是双重 toast。
 */
export type SessionExpiredHandler = () => void;

let handler: SessionExpiredHandler | null = null;

/**
 * 注册（传 `null` 清空）会话失效处理器，返回**取消订阅**函数。
 * 取消订阅只在「当前注册的还是自己」时才清空，避免后注册者被先注册者的清理误伤。
 */
export function setSessionExpiredHandler(next: SessionExpiredHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** 通知「会话已失效」。没有处理器时静默返回（例如登录页上的登录失败也是 401）。 */
export function notifySessionExpired(): void {
  handler?.();
}
