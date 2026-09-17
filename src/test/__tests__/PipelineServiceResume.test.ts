/**
 * C1 补充：PipelineService 断点续跑恢复（A3）
 *
 * 覆盖 restoreActiveTasks 全部分支：
 * - 未注入 pipelineTaskRepo → 跳过恢复返回 []
 * - 无活动任务 → []
 * - idle/complete 任务原样载入内存
 * - 中断任务（splitting）→ 标记 failed + 对应 step failed + error 文案 + notify 订阅者
 */
import { describe, it, expect, vi } from 'vitest';
import { PipelineService } from '../../domain/services/PipelineService';
import type { PipelineTask } from '../../domain/entities/models';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeTask(overrides: Partial<PipelineTask> = {}): PipelineTask {
  return {
    id: 't-1',
    storyId: 's-1',
    status: 'idle',
    progress: 0,
    currentStep: '待开始',
    steps: [
      { name: 'splitting', status: 'pending' },
      { name: 'generating_images', status: 'pending' },
    ],
    createdAt: 1700000000000,
    ...overrides,
  };
}

interface Deps {
  pipelineTaskRepo?: { findActive: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  logger?: ILoggerPort;
}

function makeRepo() {
  return {
    findActive: vi.fn(async (): Promise<PipelineTask[]> => []),
    save: vi.fn(async (): Promise<void> => { }),
  };
}

function makeService(overrides: Deps = {}) {
  const deps = {
    storyRepo: {},
    segmentRepo: {},
    characterRepo: {},
    backgroundRepo: {},
    videoTaskRepo: {},
    finalCutRepo: {},
    router: {},
    postProcess: {},
    subtitle: {},
    fileStorage: {},
    logger: overrides.logger ?? makeLogger(),
    configStore: {},
    ...(overrides.pipelineTaskRepo ? { pipelineTaskRepo: overrides.pipelineTaskRepo } : {}),
  } as unknown as ConstructorParameters<typeof PipelineService>[0];
  return new PipelineService(deps);
}

describe('PipelineService.restoreActiveTasks — 断点续跑恢复（A3）', () => {
  it('未注入 pipelineTaskRepo 时跳过恢复并返回空数组', async () => {
    const service = makeService();
    const result = await service.restoreActiveTasks();
    expect(result).toEqual([]);
  });

  it('仓库无活动任务时返回空数组', async () => {
    const repo = makeRepo();
    const service = makeService({ pipelineTaskRepo: repo });
    const result = await service.restoreActiveTasks();
    expect(result).toEqual([]);
    expect(repo.findActive).toHaveBeenCalledTimes(1);
  });

  it('idle 任务原样载入内存并返回', async () => {
    const task = makeTask();
    const repo = makeRepo();
    vi.mocked(repo.findActive).mockResolvedValue([task]);
    const service = makeService({ pipelineTaskRepo: repo });
    const result = await service.restoreActiveTasks();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('idle');
    // 载入内存后可 getTask 取到
    expect(service.getTask('t-1')).not.toBeNull();
  });

  it('complete 任务不被标记失败', async () => {
    const task = makeTask({ status: 'complete', progress: 100, currentStep: '已完成' });
    const repo = makeRepo();
    vi.mocked(repo.findActive).mockResolvedValue([task]);
    const service = makeService({ pipelineTaskRepo: repo });
    const result = await service.restoreActiveTasks();
    expect(result[0].status).toBe('complete');
    expect(result[0].error).toBeUndefined();
  });

  it('中断任务（splitting）标记 failed 且对应 step 置 failed', async () => {
    const task = makeTask({ status: 'splitting', progress: 12, currentStep: '拆分中' });
    const repo = makeRepo();
    vi.mocked(repo.findActive).mockResolvedValue([task]);
    const service = makeService({ pipelineTaskRepo: repo });
    const result = await service.restoreActiveTasks();
    expect(result[0].status).toBe('failed');
    expect(result[0].error).toContain('splitting');
    const splittingStep = result[0].steps.find(s => s.name === 'splitting');
    expect(splittingStep?.status).toBe('failed');
    expect(splittingStep?.error).toContain('splitting');
  });

  it('中断任务恢复时通过 subscribe 通知订阅者', async () => {
    const task = makeTask({ status: 'generating_videos', progress: 50, currentStep: '生成视频中' });
    const repo = makeRepo();
    vi.mocked(repo.findActive).mockResolvedValue([task]);
    const service = makeService({ pipelineTaskRepo: repo });
    const listener = vi.fn();
    service.subscribe('t-1', listener);
    await service.restoreActiveTasks();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].status).toBe('failed');
  });

  it('混合任务：仅中断任务被标记失败，idle/complete 保持原状', async () => {
    const interrupted = makeTask({ id: 't-a', status: 'post_processing', progress: 80 });
    const idle = makeTask({ id: 't-b', status: 'idle' });
    const done = makeTask({ id: 't-c', status: 'complete', progress: 100 });
    const repo = makeRepo();
    vi.mocked(repo.findActive).mockResolvedValue([interrupted, idle, done]);
    const service = makeService({ pipelineTaskRepo: repo });
    const result = await service.restoreActiveTasks();
    expect(result.find(t => t.id === 't-a')?.status).toBe('failed');
    expect(result.find(t => t.id === 't-b')?.status).toBe('idle');
    expect(result.find(t => t.id === 't-c')?.status).toBe('complete');
  });
});
