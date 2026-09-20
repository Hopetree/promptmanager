/**
 * 写剪贴板（FR-65）：全仓**唯一**接触浏览器 async clipboard 的地方
 * （即 `navigator` 的 `clipboard` 属性；本文件里只出现一次，便于 `grep` 机械核对 AC-65 ③）。
 *
 * 为什么必须有兜底：浏览器只在**安全上下文**（HTTPS / localhost / 127.0.0.1）提供 async clipboard；
 * 内网用 `http://192.168.x.x:<port>` 访问时实测 `window.isSecureContext === false` 且该 API 根本不存在
 * —— 直接调它会抛错/失败。本机 `document.execCommand('copy')` 不受安全上下文限制，是这条路的兜底。
 *
 * 约定（AC-65）：所有复制入口（`use-copy.ts` 的复制逻辑、`VariablePanel` 等）**统一走这里**；
 * 谁都不许再自己直连 async clipboard，否则内网 HTTP 下那条路径必然失效。
 * 返回值语义：`true` = 已写入剪贴板；`false` = 两条路都失败（调用方据此提示"请手动选中复制"）。
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard?.writeText !== undefined) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 有 async clipboard 但被拒绝（权限/非激活）→ 继续走下面的兜底 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
