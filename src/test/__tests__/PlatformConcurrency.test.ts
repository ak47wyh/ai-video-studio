/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 P-3：统一并发限流
 * - PLATFORM_CONCURRENCY 平台差异化并发表
 * - resolveConcurrency：显式优先，回退平台默认，钳制 [1,16]
 * - isRateLimitError 429 识别
 * - retryOnceOnRateLimit：限流退避重试一次
 */
import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_CONCURRENCY, getPlatformConcurrency, resolveConcurrency, isRateLimitError, retryOnceOnRateLimit } from '../../domain/services/platformConcurrency';

describe('P-3 统一并发限流', () => {
  it('平台并发表覆盖全部注册平台且值 >= 1', () => {
    const ids = Object.keys(PLATFORM_CONCURRENCY);
    expect(ids).toContain('minimax');
    expect(ids).toContain('kling');
    for (const id of ids) {
      expect(PLATFORM_CONCURRENCY[id as keyof typeof PLATFORM_CONCURRENCY]).toBeGreaterThanOrEqual(1);
    }
    expect(PLATFORM_CONCURRENCY.minimax).toBe(3);
    expect(PLATFORM_CONCURRENCY.kling).toBe(1);
  });

  it('getPlatformConcurrency 未注册平台回退 fallback', () => {
    expect(getPlatformConcurrency('minimax')).toBe(3);
    expect(getPlatformConcurrency('unknown' as never, 2)).toBe(2);
  });

  it('resolveConcurrency：显式优先，回退平台默认，钳制范围', () => {
    expect(resolveConcurrency('kling')).toBe(1);
    expect(resolveConcurrency('minimax')).toBe(3);
    expect(resolveConcurrency('kling', 5)).toBe(5);
    expect(resolveConcurrency('minimax', 0)).toBe(1);
    expect(resolveConcurrency('minimax', 99)).toBe(16);
  });

  it('isRateLimitError 识别 429 / rate limit / 限流', () => {
    expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('请求过于频繁，触发限流'))).toBe(true);
    expect(isRateLimitError(new Error('bad gateway'))).toBe(false);
    expect(isRateLimitError('boom')).toBe(false);
  });

  it('retryOnceOnRateLimit：限流后退避重试一次成功', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValueOnce('ok');
    await expect(retryOnceOnRateLimit(fn, 10)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retryOnceOnRateLimit：非限流错误直接抛出不重试', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('network down'));
    await expect(retryOnceOnRateLimit(fn, 10)).rejects.toThrow('network down');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retryOnceOnRateLimit：重试仍限流则抛原始错误', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 429 Too Many Requests'));
    await expect(retryOnceOnRateLimit(fn, 10)).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
