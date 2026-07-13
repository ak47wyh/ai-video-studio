import type { AxiosError } from 'axios';
import { withRetry as baseWithRetry } from '../_base/withRetry';
import { BaseApiError } from '../_base/BaseApiError';

/**
 * 腾讯混元 Hunyuan API 错误类。
 *
 * 腾讯云 API 错误响应体结构：
 * {
 *   "Response": {
 *     "Error": {
 *       "Code": "AuthFailure.SignatureFailure",
 *       "Message": "签名校验失败..."
 *     },
 *     "RequestId": "xxx"
 *   }
 * }
 *
 * Phase 4 修复：原本 isRetryable 仅看业务码（InternalError/RequestLimitExceeded），
 * 导致腾讯云网关 5xx 错误静默丢失重试机会。现继承 BaseApiError 默认实现
 * （429 + 5xx），并额外保留对 InternalError/RequestLimitExceeded 业务码的重试。
 */
export class HunyuanApiError extends BaseApiError {
  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
  ) {
    super(httpStatus, errorCode, rawMessage, 'Hunyuan',
      HunyuanApiError.toUserMessage(httpStatus, errorCode, rawMessage));
  }

  private static toUserMessage(status: number, code: string, raw: string): string {
    // 腾讯云错误码前缀分类
    if (code.startsWith('AuthFailure')) {
      if (code.includes('Signature')) {
        return '混元签名校验失败：请检查 SecretId/SecretKey 与系统时间是否正确。';
      }
      return '混元鉴权失败：请检查 SecretId/SecretKey 配置。';
    }
    switch (status) {
      case 400:
        return `请求参数错误：${raw}。请检查输入内容是否符合混元接口要求。`;
      case 401:
        return '混元鉴权失败：请检查 SecretId/SecretKey 配置。';
      case 403:
        return '当前账号无权访问此功能，请检查混元 API 权限配置。';
      case 429:
        return '请求过于频繁或并发达到上限，请稍后重试。';
      case 500:
      case 502:
      case 503:
      case 504:
        return '混元服务暂时不可用，请稍后重试。';
      default:
        if (code === 'LimitExceeded') return '混元请求次数超限，请稍后重试。';
        if (code === 'ResourceNotFound') return '混元资源不存在：' + raw;
        return `混元请求失败 (${status} ${code}): ${raw}`;
    }
  }

  /** 在全局 5xx 标准基础上，额外支持腾讯云业务码 InternalError / RequestLimitExceeded */
  get isRetryable(): boolean {
    return super.isRetryable
      || this.errorCode === 'InternalError'
      || this.errorCode === 'RequestLimitExceeded';
  }
}

export function parseHunyuanError(error: AxiosError): HunyuanApiError {
  const status = error.response?.status ?? 0;
  const data = error.response?.data as HunyuanErrorBody | undefined;
  const errInfo = data?.Response?.Error;
  const errorCode = errInfo?.Code ?? 'UNKNOWN';
  const rawMessage = errInfo?.Message ?? error.message ?? 'Unknown error';
  return new HunyuanApiError(status, errorCode, rawMessage);
}

interface HunyuanErrorBody {
  Response?: {
    Error?: {
      Code?: string;
      Message?: string;
    };
    RequestId?: string;
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  // P2-1：委托到公共 withRetry
  return baseWithRetry(fn, {
    maxRetries,
    baseDelayMs,
    isRetryable: error => error instanceof HunyuanApiError && error.isRetryable,
  });
}
