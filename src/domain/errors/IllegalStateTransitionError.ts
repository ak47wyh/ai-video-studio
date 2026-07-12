import { DomainError, type DomainErrorCode, type DomainErrorOptions } from './DomainError';

/**
 * 非法状态转换（状态机违规）。
 * 例：Pipeline 任务从 completed 尝试回到 splitting。
 * 一般是编码 bug，UI 层可显示通用错误 + 记录日志。
 */
export class IllegalStateTransitionError extends DomainError {
  readonly code: DomainErrorCode = 'ILLEGAL_STATE_TRANSITION';
  constructor(options: DomainErrorOptions = {}) {
    super({ message: options.message ?? 'Illegal state transition', ...options });
  }
}
