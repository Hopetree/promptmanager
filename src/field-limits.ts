/**
 * FR-157 / AC-134 C10（N3）：**非 Prompt 列字段的长度上限的唯一来源**。
 *
 * 文件夹名的上限原来只写在路由的 JSON Schema 里（`src/server/routes/folders.ts` 的 200），
 * 而导入解析完全不看长度 ⇒ 同一份超长数据「HTTP 写 400、导入照收」，两个入口结论不同。
 *
 * Prompt 自己的上限不在这里：
 * - 文本列（title / user_prompt / system_prompt / notes）→ `src/prompt-columns.ts` 的 `maxLengthOf()`
 * - 标签名 → `src/prompt-columns.ts` 的 `TAG_NAME_MAX_LENGTH`（标签名是 prompt 可写字段 `tags` 的项）
 *
 * 这里把它们转发出来，是为了让路由与导入解析只认一个入口（`src/field-limits.ts`）。
 */
import { TAG_NAME_MAX_LENGTH } from './prompt-columns.js';

/** 文件夹名的最大长度（路由写路径 + 导入解析共用）。 */
export const FOLDER_NAME_MAX_LENGTH = 200;

/** 标签名的最大长度（定义在字段清单里，这里转发）。 */
export { TAG_NAME_MAX_LENGTH };
