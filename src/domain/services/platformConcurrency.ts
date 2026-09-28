/**
 * platformConcurrency —— 平台差异化并发度（P-3 统一并发限流）
 *
 * 单一数据源：各平台 API 的 QPS 容忍度不同，Pipeline 内 PromisePool
 * 默认并发以此表为准；调用方可传入显式 concurrency 覆盖。
 */

import type { PlatformId } from '../entities/platform';

export const PLATFORM_CONCURRENCY: Record<PlatformId, number> = {
  minimax: 3,
  volcengine: 2,
  kling: 1,
  wan: 2,
  hunyuan: 1,
  zhipu: 2,
  vidu: 1,
};

export const DEFAULT_CONCURRENCY = 3;

/** 获取平台默认并发度（未注册平台回退 fallback） */
export function getPlatformConcurrency(platform: PlatformId, fallback = 1): number {
  return PLATFORM_CONCURRENCY[platform] ?? fallback;
}

/**
 * 解析有效并发度：显式 options.concurrency 优先，否则平台默认值。
 * 保证任意输入都落在 [1, 16] 安全区间。
 */
export function resolveConcurrency(platform: PlatformId, explicit?: number): number {
  const base = explicit ?? getPlatformConcurrency(platform, DEFAULT_CONCURRENCY);
  return Math.max(1, Math.min(16, Math.round(base)));
}

/** 判断错误是否为限流（429 / rate limit / 限流） */
export function isRateLimitError(e: unknown): boolean {
  if (e instanceof Error) {
    return /429|rate limit|限流|too many requests/i.test(e.message);
  }
  return false;
}

/**
 * 429 限流退避重试：首次失败若为限流则等待 backoffMs 后重试一次，
 * 仍失败则抛出原始错误（不吞错、不无限重试）。
 */
export async function retryOnceOnRateLimit<T>(fn: () => Promise<T>, backoffMs = 5000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isRateLimitError(e)) throw e;
    await new Promise(resolve => setTimeout(resolve, backoffMs));
    return fn();
  }
}
