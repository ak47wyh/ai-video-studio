import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 网络错误（fetch TypeError / CORS / DNS / 无法解析）。
 * 与 AuthError/RateLimitError 分开处理，UI 应提示"网络异常"并允许重试。
 */
export class NetworkError extends DomainError {
  readonly code: DomainErrorCode = 'NETWORK';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Network error', ...options });
  }
}
