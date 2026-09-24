import { App as AntdApp } from 'antd';
import { useCallback, useState } from 'react';
import { api, ApiError, describeError } from './api';
import { writeClipboard } from './clipboard';
import { hasVariables } from './pure';
import type { Prompt } from './types';

/**
 * 写剪贴板（FR-65）：实现放在 `./clipboard`（纯 DOM、可被 node:test 直接单测），
 * 这里**再导出**给所有调用方 —— 全站只允许一个实现，避免再有入口绕过内网 HTTP 的兜底。
 */
export { writeClipboard };

export interface PromptCopier {
  copyText: (text: string, label?: string) => Promise<boolean>;
  copyPrompt: (prompt: Prompt) => Promise<void>;
  copyRendered: (prompt: Prompt, values: Record<string, string>) => Promise<void>;
  varsPrompt: Prompt | null;
  closeVars: () => void;
  busyId: number | null;
}

/**
 * 「一键复制」的共用逻辑（FR-41a / **FR-113 修正**）：
 * - **无变量条目** → 直接复制**调用方传进来的** `prompt.user_prompt`（数据本来就在手里），
 *   复制成功后调一次 `POST /api/prompts/:id/copy` **记账**（FR-115：只记一次 `copy`，不取正文）；
 * - **含变量条目** → 打开填值对话框，点「复制结果」时走 `POST /api/prompts/:id/render` → 复制服务端渲染结果
 *   （**这一步记一次取用，保留**）。
 *
 * ⚠️ **为什么不再 `GET /api/prompts/:id` 拿正文（FR-113 的根因）**：
 * 那个端点在服务端是"**打开详情算取用**"的同一条路由（`src/server/routes/prompts.ts` 里会 `recordUsage`）。
 * 旧实现为了拿正文而调它 ⇒ 用户一次「点开条目 + 复制结果」就产生 **两条**使用记录（实测 +2，用户报障）。
 * 现在改成**复用已加载的数据**：列表/详情返回的 `Prompt` 本来就带 `user_prompt`
 * （服务端列表查询是 `selectAll('p')`），所以正文不必再取一次 ⇒ **一次复制只记一次**。
 *
 * 两条路径**各自恰好记 1 条**：无变量 = `copy` 端点记 1 条；含变量 = `render` 记 1 条
 * （弹窗阶段只 `GET …/variables`，**不记账**）。这样既不会 +2（FR-113），也不会 +0（FR-115）。
 */
export function usePromptCopy(onUnauthorized: () => void): PromptCopier {
  const { message } = AntdApp.useApp();
  const [varsPrompt, setVarsPrompt] = useState<Prompt | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const handleError = useCallback(
    (error: unknown): void => {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }
      message.error(describeError(error));
    },
    [message, onUnauthorized],
  );

  const copyText = useCallback(
    async (text: string, label = '提示词'): Promise<boolean> => {
      const ok = await writeClipboard(text);
      if (ok) message.success(`已复制${label}`);
      else message.warning('浏览器拒绝了剪贴板访问，请手动选中复制');
      return ok;
    },
    [message],
  );

  const copyPrompt = useCallback(
    async (prompt: Prompt): Promise<void> => {
      if (hasVariables(prompt.user_prompt, prompt.system_prompt)) {
        setVarsPrompt(prompt);
        return;
      }
      setBusyId(prompt.id);
      try {
        /**
         * FR-113：**直接用手里这条数据**，不要再 `GET /api/prompts/:id`。
         * 那个端点是"打开详情记取用"的同一路由 ⇒ 再调一次就多记一条（用户报障的 +2）。
         * 正文（`user_prompt`）在列表/详情响应里本来就有。
         *
         * FR-115：但**"本地复制"也需要告诉后端一次**，否则「取用 N 次」永远不涨（用户报障）。
         * 所以复制**成功后**调一次 `POST /api/prompts/:id/copy` —— 它只记账、不返回正文，
         * 记的是**计入型**（`copy`），**不是** `view`（绝不用 "打开详情" 来兼职记账）。
         * 顺序：**先写剪贴板、后记账** —— 剪贴板写入需要用户激活，不能被网络请求拖过期。
         */
        const ok = await copyText(prompt.user_prompt, '提示词');
        if (ok) await api.recordCopy(prompt.id);
      } catch (error) {
        handleError(error);
      } finally {
        setBusyId(null);
      }
    },
    [copyText, handleError],
  );

  const copyRendered = useCallback(
    async (prompt: Prompt, values: Record<string, string>): Promise<void> => {
      setBusyId(prompt.id);
      try {
        const rendered = await api.render(prompt.id, values); // 记一次 session 取用（FR-19）
        await copyText(rendered.user_prompt, '渲染结果');
        setVarsPrompt(null);
      } catch (error) {
        handleError(error);
      } finally {
        setBusyId(null);
      }
    },
    [copyText, handleError],
  );

  return {
    copyText,
    copyPrompt,
    copyRendered,
    varsPrompt,
    closeVars: () => setVarsPrompt(null),
    busyId,
  };
}
