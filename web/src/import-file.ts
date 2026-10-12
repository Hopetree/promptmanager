/** 导出文件的解析与校验（阶段 70 / FR-148：从 `pure.ts` 按关注点拆出，纯搬迁）。 */

/** BRIEF FR-11b 要求的 replace 二次确认文案（逐字，界面与测试共用同一常量） */
export const REPLACE_WARNING = '将清空现有全部 prompt / 文件夹 / 标签 / 版本历史';

export interface ImportCounts {
  folders: number;
  tags: number;
  prompts: number;
}

export interface ImportFileShape {
  app: string;
  schema_version: number;
  folders?: unknown;
  tags?: unknown;
  prompts?: unknown;
}

export type ImportAnalysis =
  | { ok: true; counts: ImportCounts; file: ImportFileShape }
  | { ok: false; error: string };

function readArray(file: ImportFileShape, key: 'folders' | 'tags' | 'prompts'): unknown[] | string {
  const value = file[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) return `导出文件的 ${key} 必须是数组`;
  return value;
}

/**
 * 导出文件的身份（BRIEF §6.4）：`app` 契约值固定为全小写 `promptmanager`，**不许改**——
 * 改了会破坏已有导出文件的兼容（FR-60 白名单②）。这里给它一个唯一可信来源，展示层只读它做比对，
 * 避免契约值散落成裸字面量。
 */
export const SUPPORTED_EXPORT_FILE = { app: 'promptmanager', schema_version: 1 } as const;

/**
 * 解析用户选中的导出 JSON，供导入界面显示"将新增多少条"（FR-11b 的 merge 计数）。
 * 只做**预览级**校验（与服务端 `POST /api/import` 的严格校验互为补充，不重复实现字段级规则）：
 * 坏 JSON / `app` 契约值不符 / schema_version 过高 / 三个顶层字段不是数组 → 拒绝并给出可读原因。
 */
export function analyzeImportFile(text: string): ImportAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '导出文件必须是 JSON 对象' };
  }
  const file = parsed as ImportFileShape;
  if (file.app !== SUPPORTED_EXPORT_FILE.app) {
    return { ok: false, error: `不是 PromptManager 的导出文件（app=${String(file.app)}）` };
  }
  if (
    typeof file.schema_version !== 'number' ||
    !Number.isInteger(file.schema_version) ||
    file.schema_version > SUPPORTED_EXPORT_FILE.schema_version
  ) {
    return {
      ok: false,
      error: `不支持的 schema_version=${String(file.schema_version)}（本服务支持 ≤ ${String(SUPPORTED_EXPORT_FILE.schema_version)}）`,
    };
  }
  const folders = readArray(file, 'folders');
  if (typeof folders === 'string') return { ok: false, error: folders };
  const tags = readArray(file, 'tags');
  if (typeof tags === 'string') return { ok: false, error: tags };
  const prompts = readArray(file, 'prompts');
  if (typeof prompts === 'string') return { ok: false, error: prompts };

  return {
    ok: true,
    file,
    counts: { folders: folders.length, tags: tags.length, prompts: prompts.length },
  };
}

/**
 * 服务端 `invalid_import` 的 `details` → 界面可读的逐条说明。
 * 前端**不复刻校验**（BRIEF FR-10b：校验在后端做死），只把后端给出的原因如实显示出来，
 * 避免出现"本地预览看着没问题、提交后被后端拒绝却只说 invalid_import"的不一致。
 */
export function formatImportDetails(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details.map((item) => {
    if (typeof item !== 'object' || item === null) return String(item);
    const { path, message } = item as { path?: unknown; message?: unknown };
    const where = typeof path === 'string' && path !== '' ? path : 'data';
    const what = typeof message === 'string' ? message : JSON.stringify(item);
    return `${where}：${what}`;
  });
}
