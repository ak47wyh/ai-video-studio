import type { AxiosError } from 'axios';
import { withRetry as baseWithRetry } from '../_base/withRetry';
import { BaseApiError } from '../_base/BaseApiError';

/**
 * 智谱 AI API 错误类。
 *
 * Phase 4 DRY：继承 BaseApiError，复用全局 429 + 5xx 重试语义。
 */
export class ZhipuApiError extends BaseApiError {
  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
  ) {
    super(httpStatus, errorCode, rawMessage, 'Zhipu',
      ZhipuApiError.toUserMessage(httpStatus, errorCode, rawMessage));
  }

  private static toUserMessage(status: number, _code: string, raw: string): string {
    switch (status) {
      case 400:
        return `请求参数错误：${raw}。请检查输入内容是否符合智谱接口要求。`;
      case 401:
        return '智谱 API Key 无效或已过期，请前往配置中心重新配置。';
      case 403:
        return '当前 Token 无权访问此功能，请检查智谱 Token 权限配置。';
      case 429:
        return '请求过于频繁或并发达到上限，请稍后重试。';
      case 500:
      case 502:
      case 503:
      case 504:
        return '智谱服务暂时不可用，请稍后重试。';
      default:
        return `智谱请求失败 (${status}): ${raw}`;
    }
  }
}

/** 从 AxiosError 解析为 ZhipuApiError */
export function parseZhipuError(error: AxiosError): ZhipuApiError {
  const status = error.response?.status ?? 0;
  const data = error.response?.data as ZhipuErrorBody | undefined;
  const errorCode = data?.error?.code ?? 'UNKNOWN';
  const rawMessage = data?.error?.message ?? error.message ?? 'Unknown error';
  return new ZhipuApiError(status, errorCode, rawMessage);
}

interface ZhipuErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * 带指数退避的重试包装器。
 * 对 429 + 5xx 服务端错误重试，其他错误直接抛出。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  // P2-1：委托到公共 withRetry
  return baseWithRetry(fn, {
    maxRetries,
    baseDelayMs,
    isRetryable: error => error instanceof ZhipuApiError && error.isRetryable,
  });
}
