import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 鉴权失败（401 / 403 / Token 过期）。
 * UI 应引导用户到设置页高亮对应平台的 API Key 输入框。
 */
export class AuthError extends DomainError {
  readonly code: DomainErrorCode = 'AUTH';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Authentication failed', ...options });
  }
}
