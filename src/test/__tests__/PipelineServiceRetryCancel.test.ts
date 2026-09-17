import { describe, expect, it, vi } from 'vitest';
import { PipelineService } from '../../domain/services/PipelineService';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';
import type { PipelineTask } from '../../domain/entities/models';

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
  storyRepo?: { findById: ReturnType<typeof vi.fn> };
  segmentRepo?: { findByStoryId: ReturnType<typeof vi.fn> };
  logger?: ILoggerPort;
}

function makeService(overrides: Deps = {}) {
  const deps = {
    storyRepo: overrides.storyRepo ?? {},
    segmentRepo: overrides.segmentRepo ?? {},
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

describe('PipelineService 重试策略（P1-7）', () => {
  it('maxRetries=0 时不重试（attempt 1 即失败）', () => {
    expect(PipelineService.shouldRetry(1, 0)).toBe(false);
  });

  it('attempt 不超过 maxRetries 时继续重试', () => {
    expect(PipelineService.shouldRetry(1, 2)).toBe(true);
    expect(PipelineService.shouldRetry(2, 2)).toBe(true);
  });

  it('attempt 超过 maxRetries 时不再重试', () => {
    expect(PipelineService.shouldRetry(3, 2)).toBe(false);
  });

  it('退避时间按 backoffMs × 2^(attempt-1) 指数增长', () => {
    expect(PipelineService.retryDelayMs(1, 1000)).toBe(1000);
    expect(PipelineService.retryDelayMs(2, 1000)).toBe(2000);
    expect(PipelineService.retryDelayMs(3, 1000)).toBe(4000);
  });

  it('backoffMs=0 时无退避', () => {
    expect(PipelineService.retryDelayMs(5, 0)).toBe(0);
  });

  it('退避上限 30 秒', () => {
    expect(PipelineService.retryDelayMs(6, 1000)).toBe(30000);
  });
});

describe('PipelineService 队列优先级排序（P1-7）', () => {
  it('priority 降序排列，高优先级先执行', () => {
    const tasks = [
      makeTask({ id: 'low', priority: 1, createdAt: 100 }),
      makeTask({ id: 'high', priority: 9, createdAt: 200 }),
      makeTask({ id: 'mid', priority: 5, createdAt: 150 }),
    ];
    const sorted = PipelineService.sortByPriority(tasks);
    expect(sorted.map(t => t.id)).toEqual(['high', 'mid', 'low']);
  });

  it('同优先级按 createdAt 升序（先提交先执行）', () => {
    const tasks = [
      makeTask({ id: 'b', priority: 5, createdAt: 200 }),
      makeTask({ id: 'a', priority: 5, createdAt: 100 }),
    ];
    const sorted = PipelineService.sortByPriority(tasks);
    expect(sorted.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('未设置 priority 时按默认值 5 参与排序', () => {
    const tasks = [
      makeTask({ id: 'default', createdAt: 300 }),
      makeTask({ id: 'p9', priority: 9, createdAt: 100 }),
      makeTask({ id: 'p1', priority: 1, createdAt: 200 }),
    ];
    const sorted = PipelineService.sortByPriority(tasks);
    expect(sorted.map(t => t.id)).toEqual(['p9', 'default', 'p1']);
  });

  it('排序不修改原数组', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    PipelineService.sortByPriority(tasks);
    expect(tasks.map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('PipelineService 任务级取消（P1-7）', () => {
  it('markCancelled 置 cancelled 状态并记录原因', () => {
    const service = makeService();
    const task = service.createTask('s-1');
    service.markCancelled(task.id, '用户取消');
    const got = service.getTask(task.id);
    expect(got?.status).toBe('cancelled');
    expect(got?.error).toBe('用户取消');
    expect(got?.completedAt).toBeDefined();
  });

  it('cancelTask 对已完成任务无效（状态保持 complete）', () => {
    const service = makeService();
    const task = service.createTask('s-1');
    service.markComplete(task.id, 'https://example.com/v.mp4');
    service.cancelTask(task.id, '太迟了');
    expect(service.getTask(task.id)?.status).toBe('complete');
    expect(service.getTask(task.id)?.cancelRequested).toBeUndefined();
  });

  it('cancelTask 对未知任务无副作用', () => {
    const service = makeService();
    expect(() => service.cancelTask('nope')).not.toThrow();
  });

  it('排队中的任务被取消后直接从队列移除并标记 cancelled', async () => {
    // 第一个任务卡在 loadStory（永不 resolve），占住串行调度
    const never = new Promise(() => {});
    // prepareSegments 第一步 segmentRepo.findByStoryId 卡住，任务保持执行中
    const segmentRepo = { findByStoryId: vi.fn(() => never) };
    const service = makeService({ segmentRepo });
    const first = await service.runFullPipeline('s-1');
    // 等待调度器进入 running（第一个任务已出队执行）
    await Promise.resolve();
    await Promise.resolve();
    const second = await service.runFullPipeline('s-2');
    service.cancelTask(second.id, '排队太久');
    expect(service.getTask(second.id)?.status).toBe('cancelled');
    expect(service.getTask(second.id)?.error).toBe('排队太久');
    expect(service.getTask(first.id)?.status).not.toBe('cancelled');
  });

  it('执行中任务取消仅置取消标志，不改变运行中状态', async () => {
    const never = new Promise(() => {});
    const segmentRepo = { findByStoryId: vi.fn(() => never) };
    const service = makeService({ segmentRepo });
    const task = await service.runFullPipeline('s-1');
    await Promise.resolve();
    service.cancelTask(task.id, '用户取消');
    const got = service.getTask(task.id);
    expect(got?.cancelRequested).toBe(true);
    // 卡在阶段执行中，状态尚未变成 cancelled（由阶段间检查决定）
    expect(got?.status).not.toBe('complete');
  });
});
