/** 视图档位（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

/** 档位取值集合（`localStorage['pm-view-mode']` 的取值集合不变，仍是这三个；不新增第四个档位）。 */
export const VIEW_MODE_VALUES = ['split', 'table', 'card'] as const;

export type ViewModeValue = (typeof VIEW_MODE_VALUES)[number];

const VIEW_MODE_LABELS: Record<ViewModeValue, string> = { split: '分栏', table: '表格', card: '卡片' };

/**
 * 档位开关的**选项顺序**（FR-92 ①，用户 2026-09-21）：
 * - **桌面（≥768px）** = `分栏 / 表格 / 卡片` —— 用户早先指定的顺序，**不得改**；
 * - **移动（<768px）** = `卡片 / 表格 / 分栏` —— 倒序；理由是"移动端卡片效果更好"。
 *
 * 顺序集中在这一个函数里（组件与单测都取它），避免"组件一处、断言一处"再次漂移。
 */
export function viewModeOptions(isMobile: boolean): Array<{ value: ViewModeValue; label: string }> {
  const order: ViewModeValue[] = isMobile ? ['card', 'table', 'split'] : ['split', 'table', 'card'];
  return order.map((value) => ({ value, label: VIEW_MODE_LABELS[value] }));
}

/**
 * 首次进入的**默认档位**（FR-92 ② / D-34 ②）：移动端 = `card`（卡片），桌面 = `split`（分栏）。
 * 只在 `localStorage` **没有**该键时生效 —— 用户已有的本地偏好一律不覆盖。
 */
export function defaultViewMode(isMobile: boolean): ViewModeValue {
  return isMobile ? 'card' : 'split';
}
