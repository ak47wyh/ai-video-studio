/**
 * withRetry —— 通用指数退避重试包装器（Phase 2 P2-1）。
 *
 * 各平台 HttpClient 原本各自实现同构的 `withRetry`（6 份重复），本模块统一收口：
 *   - 循环 (maxRetries+1) 次
 *   - 由 `isRetryable(error, attempt)` 回调决定是否可重试
 *   - 每次退避 `baseDelayMs * 2^attempt`
 *
 * 平台特有的可重试判定（如 429 / 5xx / CORS 排除等）通过入参 `isRetryable`
 * 注入，保持行为不变。
 *
 * 备注：项目内已有 `IResiliencePort`（`CrossCuttingPorts.ts`）承载 domain 层
 * 韧性抽象。此函数属 adapter 层通用工具（无需通过 Port 暴露给 domain），
 * 只服务于 API HttpClient 内部的网络重试。
 */
export interface WithRetryOptions {
  /** 最多重试次数（不含首次尝试），默认 3 */
  maxRetries?: number;
  /** 首次退避（毫秒），默认 1000。第 n 次退避为 baseDelayMs * 2^n */
  baseDelayMs?: number;
  /** 平台特定的可重试判定 */
  isRetryable: (error: unknown, attempt: number) => boolean;
  /** 可选：调试日志前缀（如 '[VolcengineRetry]'） */
  logTag?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const { isRetryable, maxRetries = 3, baseDelayMs = 1000, logTag } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryable(error, attempt)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        if (logTag) {
          // TODO: P2 注入 ILoggerPort（需扩展 WithRetryOptions 并由各调用方透传）
          console.warn(`${logTag} 第 ${attempt + 1} 次重试（${delay}ms 后）`, {
            errorName: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
