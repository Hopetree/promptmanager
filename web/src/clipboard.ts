/**
 * 写剪贴板（FR-65；FR-95/FR-96 阶段 36 修正兜底实现）：全仓**唯一**接触浏览器 async clipboard 的地方
 * （即 `navigator` 的 `clipboard` 属性；本文件里只出现一次，便于 `grep` 机械核对 AC-65 ③）。
 *
 * 为什么必须有兜底：浏览器只在**安全上下文**（HTTPS / localhost / 127.0.0.1）提供 async clipboard；
 * 内网用 `http://192.168.x.x:<port>` 访问时实测 `window.isSecureContext === false` 且该 API 根本不存在
 * —— 直接调它会抛错/失败。本机 `document.execCommand('copy')` 不受安全上下文限制，是这条路的兜底。
 *
 * ⚠️ **调用约定（FR-95 起是硬要求）**：兜底路径依赖**用户激活**（transient activation）——
 * 必须在**点击的同步路径**里调用本函数；**调用前不得 await**（网络往返会让激活过期，
 * Chrome 会返回 `false` 或静默不写入）。见 `TokenDrawer` 的"预取明文 + 同步写"。
 *
 * 约定（AC-65）：所有复制入口（`use-copy.ts` 的复制逻辑、`VariablePanel` 等）**统一走这里**；
 * 谁都不许再自己直连 async clipboard，否则内网 HTTP 下那条路径必然失效。
 * 返回值语义：`true` = 已写入剪贴板；`false` = 所有路都失败（调用方据此提示"请手动选中复制"）。
 */

/**
 * 兜底路 ①：**Selection API + `execCommand('copy')`**。
 *
 * 为什么不是"隐藏 textarea + `select()`"（阶段 36 之前的实现，**实测在内网 HTTP 下写不进剪贴板**）：
 * 1. `execCommand('copy')` 复制的是**当前焦点元素**的选区；而 `select()` **不保证把焦点移过去** ——
 *    实测在 antd `Drawer` 里，抽屉的**焦点陷阱**会立刻把焦点抢回刚点的按钮 ⇒ 命令返回 `true`
 *    但**剪贴板里什么都没有**（用户报障的真根因；同一份代码在抽屉外能用，所以提示词复制正常）；
 * 2. 无用户激活时 Chrome 直接返回 `false`。
 *
 * 改成"把文本放进隐藏 `span` → `Range` 选中它 → 复制**文档选区**"：焦点在哪儿都不影响，
 * 实测在内网 IP + 抽屉焦点陷阱下仍能真正写入剪贴板。
 */
function copyViaSelection(text: string): boolean {
  try {
    const holder = document.createElement('span');
    holder.textContent = text;
    holder.setAttribute('aria-hidden', 'true');
    holder.style.position = 'fixed';
    holder.style.top = '-1000px';
    holder.style.left = '-1000px';
    holder.style.opacity = '0';
    holder.style.whiteSpace = 'pre';
    document.body.appendChild(holder);

    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    const previous = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ok = document.execCommand('copy');
    // 还原用户原本的选区（不留下我们造的选择）
    selection?.removeAllRanges();
    if (previous !== null) selection?.addRange(previous);
    document.body.removeChild(holder);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 兜底路 ②：隐藏 `textarea` + `select()`（老实现，作为最后手段保留）。
 * 注意它在"焦点被别处占用"时可能返回 `true` 却什么都没复制，所以**必须排在路 ① 之后**。
 */
function copyViaTextarea(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

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
  // 兜底：Selection API 优先（焦点无关），失败再退回 textarea
  if (copyViaSelection(text)) return true;
  return copyViaTextarea(text);
}
