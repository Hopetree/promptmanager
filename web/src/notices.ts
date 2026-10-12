/** 面向用户的提示文案（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

/** 回滚完成后的提示：`kind` 决定用 `message.info` 还是 `message.success`。 */
export interface RollbackNotice {
  kind: 'success' | 'info';
  text: string;
}

/**
 * 回滚结果提示（FR-129 / D-60）。
 *
 * ⚠️ 回滚**不一定**产生新版本：回滚到「内容与当前完全相同」的那一版（最典型的是只有 v1 时点回滚，
 * 或手动改回原样后再回滚）时，服务端**不产生新版本、不更新 `updated_at`**（判据见
 * `src/services/prompts.ts` 的 `hasContentChange`）。所以提示必须**按服务端返回的 `version_no` 分支** ——
 * 否则用户会看到"已生成新版本"却什么都没变，以为回滚失败、或以为多了一版而反复操作。
 *
 * 提成纯函数是为了能被 `node:test` 机械验证（组件里的 `message.xxx(...)` 无法直接断言）。
 *
 * @param targetVersionNo 用户点的那个版本号（提示里回显它，代表"内容回到哪一版"）
 * @param beforeVersionNo 回滚**前**这条提示词的 `version_no`
 * @param afterVersionNo  回滚**后**服务端返回的 `version_no`
 */
export function rollbackNotice(
  targetVersionNo: number,
  beforeVersionNo: number,
  afterVersionNo: number,
): RollbackNotice {
  if (afterVersionNo === beforeVersionNo) {
    return {
      kind: 'info',
      text: `已回滚到 v${String(targetVersionNo)}（内容与当前相同，未生成新版本）`,
    };
  }
  return { kind: 'success', text: `已回滚到 v${String(targetVersionNo)}（已生成新版本）` };
}

/**
 * FR-134：把「这次导入 / 恢复把取用历史怎么了」说成**一句人话** —— 导入弹窗与云端恢复弹窗共用。
 *
 * 关键词是「不静默」（D-62 ③）：`replace` 会 `DELETE FROM prompts` ⇒ `usage_events` 被
 * `ON DELETE CASCADE` 连带清空。清空可以是有意的取舍，但必须①说清去向与条数②给得出备份落点。
 * 所以这里**不吞掉** `backup`：有存档就把路径一并报出来（用户才知道去哪儿捞）。
 */
export function usageHistoryNotice(history: {
  action: 'cleared' | 'kept';
  count: number;
  backup: string | null;
}): string {
  if (history.action === 'kept') {
    return `取用历史：原样保留 ${String(history.count)} 条`;
  }
  if (history.count === 0) {
    return '取用历史：本来就没有记录';
  }
  const backup = history.backup === null ? '' : `；清空前已留档：${history.backup}`;
  return `取用历史：已清空 ${String(history.count)} 条（replace 会重建数据）${backup}`;
}
