import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 业务参数校验错误。
 * 表单级红字提示或输入框标红使用，可在 context.field 上带上字段名。
 */
export class ValidationError extends DomainError {
  readonly code: DomainErrorCode = 'VALIDATION';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Validation failed', ...options });
  }
}
