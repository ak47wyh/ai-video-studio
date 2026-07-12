import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 轮询超时或任务执行超时。
 * 替代原来 `throw new Error('Polling timeout')` 的字符串错误，
 * 使 UI 可以按 code 精准处理"超时"分支（例如提供手动查询按钮）。
 */
export class TimeoutError extends DomainError {
  readonly code: DomainErrorCode = 'TIMEOUT';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Operation timed out', ...options });
  }
}
