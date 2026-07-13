import type { AxiosError } from 'axios';
import { withRetry as baseWithRetry } from '../_base/withRetry';
import { BaseApiError } from '../_base/BaseApiError';

/**
 * 可灵 Kling API 错误类。
 *
 * Phase 4 DRY：继承 BaseApiError，复用全局 429 + 5xx 重试语义，
 * 仅保留平台文案映射与 AxiosError 解析。
 */
export class KlingApiError extends BaseApiError {
  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
  ) {
    super(httpStatus, errorCode, rawMessage, 'Kling',
      KlingApiError.toUserMessage(httpStatus, errorCode, rawMessage));
  }

  private static toUserMessage(status: number, _code: string, raw: string): string {
    switch (status) {
      case 400:
        return `请求参数错误：${raw}。请检查输入内容是否符合可灵接口要求。`;
      case 401:
        return '可灵鉴权失败：请检查 AccessKey/SecretKey 配置。';
      case 403:
        return '当前 Token 无权访问此功能，请检查可灵 API 权限配置。';
      case 429:
        return '请求过于频繁或并发达到上限，请稍后重试。';
      case 500:
      case 502:
      case 503:
      case 504:
        return '可灵服务暂时不可用，请稍后重试。';
      default:
        return `可灵请求失败 (${status}): ${raw}`;
    }
  }
}

export function parseKlingError(error: AxiosError): KlingApiError {
  const status = error.response?.status ?? 0;
  const data = error.response?.data as KlingErrorBody | undefined;
  const errorCode = data?.code ?? 'UNKNOWN';
  const rawMessage = data?.message ?? error.message ?? 'Unknown error';
  return new KlingApiError(status, errorCode, rawMessage);
}

interface KlingErrorBody {
  code?: string;
  message?: string;
  request_id?: string;
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
    isRetryable: error => error instanceof KlingApiError && error.isRetryable,
  });
}
