/** 领域错误：由 server 层的错误处理器映射成契约里的 JSON 形状。 */

export class InvalidBodyError extends Error {
  readonly details: unknown[];

  constructor(details: unknown[] = []) {
    super('invalid_body');
    this.name = 'InvalidBodyError';
    this.details = details;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'not_found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** 导入文件不合法（BRIEF §6.1/§6.4：400 {"error":"invalid_import","details":[…]})。 */
export class InvalidImportError extends Error {
  readonly details: unknown[];

  constructor(details: unknown[] = []) {
    super('invalid_import');
    this.name = 'InvalidImportError';
    this.details = details;
  }
}

/** 409：资源当前状态不允许该操作（如删除非空文件夹）；`code` 直接作为响应体的 error 值。 */
export class ConflictError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConflictError';
    this.code = code;
  }
}

/** better-sqlite3 的约束错误（外键/唯一）→ 视为请求体不合法。 */
export function isConstraintError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return code.startsWith('SQLITE_CONSTRAINT') || /constraint failed/i.test(message);
}
