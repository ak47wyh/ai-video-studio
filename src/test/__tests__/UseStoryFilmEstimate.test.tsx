/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 U-2：长任务预计剩余时间
 * - 纯函数 estimateRemainingSec：确定性数值断言
 * - Hook 集成：首 30s 内 estimating（真实时间，稳定）；未知阶段不估算
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStoryFilm, estimateRemainingSec } from '../../ui/hooks/useStoryFilm';
import type { PipelineStatus } from '../../domain/services/PipelineService';

const hoisted = vi.hoisted(() => {
  let cb: ((stage: PipelineStatus, percent: number, message: string) => void) | undefined;
  let resolve: (v: { storyId: string; pipelineTaskId: string }) => void = () => { };
  return {
    getCb: () => cb,
    resolveFilm: (v: { storyId: string; pipelineTaskId: string }) => { resolve(v); },
    createStoryFilmMock: vi.fn((opts: {
      onProgress: (stage: PipelineStatus, percent: number, message: string) => void;
    }) => {
      cb = opts.onProgress;
      return new Promise<{ storyId: string; pipelineTaskId: string }>((res) => { resolve = res; });
    }),
  };
});

vi.mock('../../dependencies', () => ({
  pipelineService: { cancelTask: vi.fn() },
  storyFilmService: { createStoryFilm: hoisted.createStoryFilmMock, generateStoryText: vi.fn() },
}));
vi.mock('../../ui/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

const TOTAL_STAGES = 8;

describe('estimateRemainingSec（纯函数）', () => {
  it('elapsed 40s @ stage0 → 40s/阶段 × 7 = 280s', () => {
    expect(estimateRemainingSec(40_000, 0, TOTAL_STAGES)).toBeCloseTo(280, 1);
  });

  it('elapsed 40s @ stage4 → 8s/阶段 × 3 = 24s', () => {
    expect(estimateRemainingSec(40_000, 4, TOTAL_STAGES)).toBeCloseTo(24, 1);
  });

  it('elapsed < 30s 返回 null（估算起步期）', () => {
    expect(estimateRemainingSec(5_000, 0, TOTAL_STAGES)).toBeNull();
  });

  it('stageIndex 越界或为最后阶段返回 null', () => {
    expect(estimateRemainingSec(40_000, -1, TOTAL_STAGES)).toBeNull();
    expect(estimateRemainingSec(40_000, 8, TOTAL_STAGES)).toBeNull();
    expect(estimateRemainingSec(40_000, 7, TOTAL_STAGES)).toBeNull();
  });
});

describe('useStoryFilm U-2 hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('首进度回调处于估算起步期（estimating=true，剩余时间为 null）', () => {
    const { result } = renderHook(() => useStoryFilm());
    act(() => { void result.current.startFilm({ videoStyle: 'cinematic', spaceId: 's-1' }); });
    act(() => { hoisted.getCb()?.('splitting', 5, ''); });
    expect(result.current.isEstimating).toBe(true);
    expect(result.current.estimatedRemainingSec).toBeNull();
  });

  it('未知阶段（idx<0）不估算', () => {
    const { result } = renderHook(() => useStoryFilm());
    act(() => { void result.current.startFilm({ videoStyle: 'cinematic', spaceId: 's-1' }); });
    act(() => { hoisted.getCb()?.('unknown_stage' as PipelineStatus, 5, ''); });
    expect(result.current.isEstimating).toBe(false);
    expect(result.current.estimatedRemainingSec).toBeNull();
  });

  it('生成完成进入 preview 并清理估算状态', async () => {
    const { result } = renderHook(() => useStoryFilm());
    act(() => { void result.current.startFilm({ videoStyle: 'cinematic', spaceId: 's-1' }); });
    await act(async () => { hoisted.resolveFilm({ storyId: 's-1', pipelineTaskId: 'p-1' }); });
    expect(result.current.step).toBe('preview');
    expect(result.current.estimatedRemainingSec).toBeNull();
    expect(result.current.isEstimating).toBe(false);
  });
});
