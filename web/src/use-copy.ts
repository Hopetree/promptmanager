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
 * 「一键复制」的共用逻辑（FR-41a）：
 * - 无变量条目 → `GET /api/prompts/:id`（服务端按 FR-19 记一次 session 取用）→ 复制返回的 `user_prompt`；
 * - 含变量条目 → 打开填值对话框，点「复制结果」时走 `POST /api/prompts/:id/render`（同样记取用）→ 复制服务端渲染结果。
 * 这样"复制"就等价于"取用"，**不需要新增任何接口**，usage 统计也不会漏记。
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
        const fresh = await api.getPrompt(prompt.id); // 记一次 session 取用（FR-19）
        await copyText(fresh.user_prompt, '提示词');
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
