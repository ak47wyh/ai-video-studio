/**
 * C1 补充：PromisePool 通用并发池（A3 并发生成基础设施）
 *
 * 覆盖：
 * - 空输入快速返回
 * - 并发限制（活跃 worker 数不超过 concurrency）
 * - 结果顺序与输入一致
 * - 单任务失败隔离（其他任务照常完成）
 * - failFast 首错中止
 * - taskTimeoutMs 超时标记
 * - 外部 AbortSignal：未分派任务标 aborted / 已 abort 直接返回
 * - onProgress 进度回调
 */
import { describe, it, expect, vi } from 'vitest';
import { PromisePool } from '../../domain/services/PromisePool';

const tick = (ms = 1) => new Promise(r => setTimeout(r, ms));

describe('PromisePool — 并发执行池（A3）', () => {
  it('空输入立即返回空数组', async () => {
    const result = await PromisePool.run([], vi.fn());
    expect(result).toEqual([]);
  });

  it('并发限制：活跃 worker 数不超过 concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const worker = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(20);
      active--;
      return 'done';
    });
    await PromisePool.run([1, 2, 3, 4, 5, 6], worker, undefined, { concurrency: 2 });
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it('结果顺序与输入顺序一致', async () => {
    const worker = vi.fn(async (item: number, index: number) => {
      await tick(30 - index * 5); // 慢的在前，快的在后，验证顺序保持
      return item * 10;
    });
    const result = await PromisePool.run([1, 2, 3], worker, undefined, { concurrency: 3 });
    expect(result.map(r => ({ ...r, value: r.value }))).toEqual([
      { index: 0, value: 10, status: 'ok' },
      { index: 1, value: 20, status: 'ok' },
      { index: 2, value: 30, status: 'ok' },
    ]);
  });

  it('单任务失败不影响其他任务（错误隔离）', async () => {
    const worker = vi.fn(async (item: number) => {
      await tick();
      if (item === 2) throw new Error('boom-2');
      return item;
    });
    const result = await PromisePool.run([1, 2, 3], worker, undefined, { concurrency: 3 });
    expect(result[0]).toMatchObject({ index: 0, status: 'ok', value: 1 });
    expect(result[1]).toMatchObject({ index: 1, status: 'error' });
    expect((result[1].error as Error).message).toBe('boom-2');
    expect(result[2]).toMatchObject({ index: 2, status: 'ok', value: 3 });
  });

  it('failFast：首个任务失败后中止后续分派', async () => {
    const worker = vi.fn(async (item: number) => {
      await tick();
      if (item === 1) throw new Error('first-fail');
      return item;
    });
    await expect(
      PromisePool.run([1, 2, 3], worker, undefined, { concurrency: 3, failFast: true }),
    ).rejects.toThrow('first-fail');
  });

  it('taskTimeoutMs：超时任务标记为 error 且消息含 timeout', async () => {
    // 超时依赖 worker 响应 AbortSignal——模拟会因 signal.abort 而 reject 的 worker
    const worker = vi.fn(async (_item: number, _index: number, signal?: AbortSignal) => {
      await new Promise<number>((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error('worker slow')), 50);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted by signal')); });
      });
      return 1;
    });
    const result = await PromisePool.run([1], worker, undefined, { concurrency: 1, taskTimeoutMs: 5 });
    expect(result[0].status).toBe('error');
    expect((result[0].error as Error).message).toContain('timeout');
  });

  it('外部 signal 已 abort：全部任务标记 aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await PromisePool.run([1, 2], vi.fn(), undefined, { signal: controller.signal });
    expect(result.every(r => r.status === 'aborted')).toBe(true);
    expect(result[0].error?.message).toContain('Aborted');
  });

  it('外部 signal 运行中 abort：未完成任务标记 aborted', async () => {
    const controller = new AbortController();
    const worker = vi.fn(async (item: number) => {
      await tick(30);
      return item;
    });
    const run = PromisePool.run([1, 2, 3, 4], worker, undefined, { concurrency: 2, signal: controller.signal });
    await tick(5);
    controller.abort();
    const result = await run;
    expect(result.some(r => r.status === 'aborted')).toBe(true);
    expect(result.filter(r => r.status === 'ok').length + result.filter(r => r.status === 'aborted').length).toBe(4);
  });

  it('onProgress 按完成进度回调', async () => {
    const progress = vi.fn();
    await PromisePool.run([1, 2, 3], async i => { await tick(5); return i; }, progress, { concurrency: 3 });
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls[0][0]).toBe(1); // done
    expect(progress.mock.calls[0][1]).toBe(3); // total
    expect(progress.mock.calls[2][0]).toBe(3);
  });
});
