/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 P-4：进度回调节流
 * - createThrottledProgress：100ms 窗口合并 + 阶段切换立即刷新
 * - nowFn 注入保证确定性（不依赖 Date.now spy）
 */
import { describe, expect, it, vi } from 'vitest';
import { createThrottledProgress } from '../../ui/hooks/useStoryFilm';

describe('P-4 进度回调节流', () => {
  it('100ms 窗口内相同阶段合并为一次回调', () => {
    let now = 0;
    const handler = vi.fn();
    const fn = createThrottledProgress(handler, 100, () => now);
    fn('generating_images', 10, 'a'); now = 30; fn('generating_images', 20, 'b'); now = 80; fn('generating_images', 30, 'c');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ stage: 'generating_images', percent: 10, message: 'a' });
  });

  it('超过 100ms 窗口后再次回调', () => {
    let now = 0;
    const handler = vi.fn();
    const fn = createThrottledProgress(handler, 100, () => now);
    fn('generating_images', 10, 'a'); now = 150; fn('generating_images', 50, 'b');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1]?.[0]).toMatchObject({ percent: 50 });
  });

  it('阶段切换立即刷新（不等窗口）', () => {
    let now = 0;
    const handler = vi.fn();
    const fn = createThrottledProgress(handler, 100, () => now);
    fn('generating_images', 10, 'a'); now = 10; fn('generating_audio', 20, 'b');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('同 stage 但阶段切换后首个回调被记录为窗口起点', () => {
    let now = 0;
    const handler = vi.fn();
    const fn = createThrottledProgress(handler, 100, () => now);
    fn('generating_images', 10, 'a'); now = 200; fn('generating_audio', 20, 'b'); now = 210; fn('generating_audio', 30, 'c');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('throttleMs 可自定义（如 0 = 全部透传）', () => {
    let now = 0;
    const handler = vi.fn();
    const fn = createThrottledProgress(handler, 0, () => now);
    fn('a' as never, 1, 'x'); now = 1; fn('a' as never, 2, 'y');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
