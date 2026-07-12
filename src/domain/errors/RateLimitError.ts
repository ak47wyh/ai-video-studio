import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 请求限流（HTTP 429 / QPS 超限）。
 * context.retryAfterSec 由 Adapter 从 `Retry-After` 头或平台错误体中解析。
 * UI 应展示"请稍后重试（Nx 秒后）"并可自动退避。
 */
export class RateLimitError extends DomainError {
  readonly code: DomainErrorCode = 'RATE_LIMIT';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Rate limit exceeded', ...options });
  }
}
