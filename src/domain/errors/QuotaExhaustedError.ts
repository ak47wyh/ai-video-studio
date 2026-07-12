import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 余额 / 额度 / 配额耗尽（HTTP 402 / 平台配额错误码）。
 * UI 应引导充值 / 切换平台。
 */
export class QuotaExhaustedError extends DomainError {
  readonly code: DomainErrorCode = 'QUOTA_EXHAUSTED';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Quota exhausted', ...options });
  }
}
