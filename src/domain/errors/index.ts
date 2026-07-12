/**
 * 领域错误 —— 集中导出。
 *
 * 使用建议：
 *   import { AuthError, RateLimitError, TimeoutError } from '@/domain/errors';
 *
 * Adapter 层在归一化平台错误码时抛出对应子类；UI 层通过 `error instanceof DomainError`
 * + `error.code` 判定分派 i18n。
 */
export { DomainError } from './DomainError';
export type { DomainErrorCode, DomainErrorContext, DomainErrorOptions } from './DomainError';

export { AuthError } from './AuthError';
export { RateLimitError } from './RateLimitError';
export { NetworkError } from './NetworkError';
export { TimeoutError } from './TimeoutError';
export { QuotaExhaustedError } from './QuotaExhaustedError';
export { ValidationError } from './ValidationError';
export { IllegalStateTransitionError } from './IllegalStateTransitionError';
export { UnsupportedCapabilityError } from './UnsupportedCapabilityError';
export { VoiceSubCapabilityNotSupportedError } from './VoiceSubCapabilityNotSupportedError';
