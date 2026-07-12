import type { AxiosError } from 'axios';
import { withRetry as baseWithRetry } from '../_base/withRetry';

/**
 * Vidu API 错误类。
 */
export class ViduApiError extends Error {
  readonly httpStatus: number;
  readonly errorCode: string;
  readonly rawMessage: string;

  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
  ) {
    super(ViduApiError.toUserMessage(httpStatus, errorCode, rawMessage));
    this.name = 'ViduApiError';
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.rawMessage = rawMessage;
  }

  private static toUserMessage(status: number, _code: string, raw: string): string {
    switch (status) {
      case 400:
        return `请求参数错误：${raw}。请检查输入内容是否符合 Vidu 接口要求。`;
      case 401:
        return 'Vidu API Key 无效或已过期，请前往配置中心重新配置。';
      case 403:
        return '当前 Token 无权访问此功能，请检查 Vidu Token 权限配置。';
      case 429:
        return '请求过于频繁或并发达到上限，请稍后重试。';
      case 500:
      case 502:
      case 503:
        return 'Vidu 服务暂时不可用，请稍后重试。';
      default:
        return `Vidu 请求失败 (${status}): ${raw}`;
    }
  }

  get isRetryable(): boolean {
    return this.httpStatus === 429;
  }
}

export function parseViduError(error: AxiosError): ViduApiError {
  const status = error.response?.status ?? 0;
  const data = error.response?.data as ViduErrorBody | undefined;
  const errorCode = data?.error?.code ?? data?.error?.type ?? 'UNKNOWN';
  const rawMessage = data?.error?.message ?? data?.message ?? error.message ?? 'Unknown error';
  return new ViduApiError(status, errorCode, rawMessage);
}

interface ViduErrorBody {
  error?: { code?: string; type?: string; message?: string };
  message?: string;
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
    isRetryable: error => error instanceof ViduApiError && error.isRetryable,
  });
}
