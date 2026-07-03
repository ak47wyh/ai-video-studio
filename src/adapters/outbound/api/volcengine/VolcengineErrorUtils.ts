import type { AxiosError } from 'axios';

/**
 * 火山引擎 API 错误类。
 * 携带 HTTP 状态码和平台错误信息，供 UI 层展示。
 */
export class VolcengineApiError extends Error {
  public readonly httpStatus: number;
  public readonly errorCode: string;
  public readonly rawMessage: string;

  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
  ) {
    super(VolcengineApiError.toUserMessage(httpStatus, errorCode, rawMessage));
    this.name = 'VolcengineApiError';
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.rawMessage = rawMessage;
  }

  /** 生成用户可读的错误信息 */
  private static toUserMessage(status: number, _code: string, raw: string): string {
    switch (status) {
      case 400:
        return `请求参数错误：${raw}。请检查输入内容是否符合接口要求。`;
      case 401:
        return '火山引擎 API Key 无效或已过期，请前往配置中心重新配置。';
      case 403:
        return '当前 Token 无权访问此功能，请检查 Token 权限配置。';
      case 429:
        return '请求过于频繁，请稍后重试。';
      case 503:
        return '火山引擎服务暂时不可用，请稍后重试。';
      default:
        return `火山引擎请求失败 (${status}): ${raw}`;
    }
  }

  /** 是否可重试（429 限流 + 5xx 服务端错误 + 网关错误） */
  get isRetryable(): boolean {
    return this.httpStatus === 429
      || this.httpStatus === 500
      || this.httpStatus === 502
      || this.httpStatus === 503
      || this.httpStatus === 504;
  }
}

/** 从 AxiosError 解析为 VolcengineApiError */
export function parseVolcengineError(error: AxiosError): VolcengineApiError {
  const status = error.response?.status ?? 0;
  const data = error.response?.data as VolcengineErrorBody | undefined;
  const errorCode = data?.error?.code ?? data?.error?.type ?? 'UNKNOWN';
  const rawMessage = data?.error?.message ?? error.message ?? 'Unknown error';
  return new VolcengineApiError(status, errorCode, rawMessage);
}

/** 火山引擎错误响应体结构 */
interface VolcengineErrorBody {
  error?: {
    code?: string;
    type?: string;
    message?: string;
  };
}

/**
 * 带指数退避的重试包装器。
 * 对以下错误重试：
 *  - HTTP 429（限流）
 *  - HTTP 500/502/503/504（服务端错误/网关错误）
 *  - 网络错误（ECONNRESET/ETIMEDOUT/ENOTFOUND 等 AxiosError 无 response 的场景）
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (retryable && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn('[VolcengineRetry] 第 %d 次重试（%dms 后）', attempt + 1, delay, {
          errorName: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
        });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/** 判断错误是否可重试 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof VolcengineApiError) {
    return error.isRetryable;
  }
  // 网络错误（无 HTTP 响应）：AxiosError 的 code 字段标识网络层错误
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNABORTED') {
      return true;
    }
  }
  return false;
}