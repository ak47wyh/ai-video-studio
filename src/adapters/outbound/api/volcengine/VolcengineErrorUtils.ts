import type { AxiosError } from 'axios';
import { withRetry as baseWithRetry } from '../_base/withRetry';

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

/**
 * CORS 跨域拦截错误。
 *
 * 触发场景：浏览器直连火山引擎 Anthropic 端点时，预检响应未将
 * `anthropic-version` 列入 `Access-Control-Allow-Headers`，导致实际请求被拦截。
 *
 * 浏览器不会暴露 CORS 详情，只能通过错误类型/消息启发式识别：
 *  - 原生 fetch：`TypeError: Failed to fetch` / `NetworkError when attempting to fetch resource`
 *  - axios：`ERR_NETWORK`（无 response）
 */
export class CorsBlockedError extends VolcengineApiError {
  constructor(rawMessage: string = 'Browser CORS preflight blocked the request.') {
    super(0, 'CORS_BLOCKED', rawMessage);
    this.name = 'CorsBlockedError';
  }
}

/**
 * 判断错误是否为浏览器 CORS 拦截。
 *
 * 启发式识别（浏览器不暴露 CORS 细节）：
 *  - 原生 fetch 抛 TypeError，message 含 "Failed to fetch" / "NetworkError"
 *  - axios 网络层错误 code 为 ERR_NETWORK 且无 response
 *  - 排除明显的网络中断（abort / timeout 已在 axios 层另行处理）
 */
export function isCorsError(error: unknown): boolean {
  if (error instanceof CorsBlockedError) return true;
  // 原生 fetch 的 CORS 拦截：TypeError + 经典文案
  if (error instanceof TypeError) {
    return /Failed to fetch|NetworkError/i.test(error.message);
  }
  // axios 网络层错误：ERR_NETWORK 且无 HTTP 响应（区别于 5xx 的 ERR_NETWORK）
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    const hasResponse = !!(error as { response?: unknown }).response;
    if (code === 'ERR_NETWORK' && !hasResponse) return true;
  }
  return false;
}

/**
 * 把疑似 CORS 的网络错误归一化为 CorsBlockedError，其它错误原样返回。
 *
 * 用于适配器层在调用 fetch / axios 后做错误归一化，让 UI 层
 * 可以通过 `error instanceof CorsBlockedError` 识别 CORS 场景。
 */
export function classifyNetworkError(error: unknown): Error {
  if (isCorsError(error) && !(error instanceof CorsBlockedError)) {
    const raw = error instanceof Error ? error.message : String(error);
    return new CorsBlockedError(raw);
  }
  return error instanceof Error ? error : new Error(String(error));
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
 *
 * 注意：CORS 拦截错误（CorsBlockedError）不可重试 —— 浏览器预检失败是确定性失败。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  // P2-1：委托到公共 withRetry，保持函数签名与原语义不变
  return baseWithRetry(fn, {
    maxRetries,
    baseDelayMs,
    isRetryable: isRetryableError,
    logTag: '[VolcengineRetry]',
  });
}

/** 判断错误是否可重试 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof VolcengineApiError) {
    return error.isRetryable;
  }
  // CORS 拦截不可重试（浏览器预检失败是确定性失败）
  if (isCorsError(error)) return false;
  // 网络错误（无 HTTP 响应）：AxiosError 的 code 字段标识网络层错误
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNABORTED') {
      return true;
    }
  }
  return false;
}
