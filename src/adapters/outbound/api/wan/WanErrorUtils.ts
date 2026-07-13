import type { AxiosError } from 'axios';
import { withRetry as baseWithRetry } from '../_base/withRetry';
import { BaseApiError } from '../_base/BaseApiError';

/**
 * 通义万相（DashScope）API 错误类。
 *
 * Phase 4 DRY：继承 BaseApiError，复用全局 429 + 5xx 重试语义。
 */
export class WanApiError extends BaseApiError {
  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
  ) {
    super(httpStatus, errorCode, rawMessage, 'Wan',
      WanApiError.toUserMessage(httpStatus, errorCode, rawMessage));
  }

  private static toUserMessage(status: number, _code: string, raw: string): string {
    switch (status) {
      case 400:
        return `请求参数错误：${raw}。请检查输入内容是否符合 DashScope 接口要求。`;
      case 401:
        return '通义万相 API Key 无效或已过期，请前往配置中心重新配置。';
      case 403:
        return '当前 Token 无权访问此功能，请检查 DashScope Token 权限配置。';
      case 429:
        return '请求过于频繁或并发达到上限，请稍后重试。';
      case 500:
      case 502:
      case 503:
      case 504:
        return '通义万相服务暂时不可用，请稍后重试。';
      default:
        return `通义万相请求失败 (${status}): ${raw}`;
    }
  }
}

export function parseWanError(error: AxiosError): WanApiError {
  const status = error.response?.status ?? 0;
  const data = error.response?.data as WanErrorBody | undefined;
  const errorCode = data?.code ?? 'UNKNOWN';
  const rawMessage = data?.message ?? data?.message ?? error.message ?? 'Unknown error';
  return new WanApiError(status, errorCode, rawMessage);
}

interface WanErrorBody {
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
    isRetryable: error => error instanceof WanApiError && error.isRetryable,
  });
}
