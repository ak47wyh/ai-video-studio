/**
 * DomainError —— 所有领域错误的基类。
 *
 * 设计目标：
 *   1. 统一错误分类（code），UI 层通过 `error.code` 走 i18n key，
 *      避免字符串匹配 error.message 造成的多语言破坏。
 *   2. 保留 cause（RFC 4906，Node 16.9+ / ES2022）以承载底层错误链。
 *   3. context 携带可序列化的上下文（platform、taskId、httpStatus 等），
 *      方便日志侧结构化输出。
 *
 * 使用规范：
 *   - 领域层与 Adapter 层归一化错误时抛出对应子类。
 *   - UI 层禁止 `message.includes('...')` 匹配；只用 `error.code` 与
 *     `error instanceof XxxError`。
 *   - 序列化到日志时使用 `toJSON()`，Adapter 层可覆写附加字段。
 */
export type DomainErrorCode =
  | 'UNSUPPORTED_CAPABILITY'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'QUOTA_EXHAUSTED'
  | 'VALIDATION'
  | 'ILLEGAL_STATE_TRANSITION'
  | 'UNKNOWN';

export interface DomainErrorContext {
  /** 平台标识（如 volcengine / minimax） */
  platform?: string;
  /** 相关任务 ID（视频/语音/图片） */
  taskId?: string;
  /** HTTP 状态码（Adapter 层归一化时填充） */
  httpStatus?: number;
  /** 平台原始错误码 */
  rawCode?: string | number;
  /** 建议 Retry-After（秒），RateLimitError 常用 */
  retryAfterSec?: number;
  /** 其它自由字段 */
  [key: string]: unknown;
}

export interface DomainErrorOptions {
  message?: string;
  cause?: unknown;
  context?: DomainErrorContext;
}

/**
 * 领域错误基类。子类必须提供 static readonly code 与默认 message。
 */
export abstract class DomainError extends Error {
  /** 稳定错误码，用于 UI 层 i18n key 与日志 grep */
  abstract readonly code: DomainErrorCode;
  readonly context: DomainErrorContext;
  readonly cause?: unknown;

  constructor(options: DomainErrorOptions = {}) {
    super(options.message ?? 'Domain error');
    this.name = new.target.name;
    this.context = options.context ?? {};
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /** 结构化序列化，供 ILoggerPort 记录 */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}
