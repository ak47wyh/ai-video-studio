/**
 * P3-1 任务队列看板：PipelineService 队列能力测试
 *
 * 覆盖：
 * - updatePriority：钳制到 1-10、排队任务立即重排、终态任务忽略、持久化调用、通知订阅者
 * - subscribeAll：全局订阅任意任务变更（含 createTask 新增）、取消订阅后不再通知
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

function makeRepo() {
  return {
    findActive: vi.fn(async (): Promise<PipelineTask[]> => []),
    save: vi.fn(async (): Promise<void> => { }),
  };
}

function makeService(overrides: { repo?: ReturnType<typeof makeRepo> } = {}) {
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
    logger: makeLogger(),
    configStore: {},
    ...(overrides.repo ? { pipelineTaskRepo: overrides.repo } : {}),
  } as unknown as ConstructorParameters<typeof PipelineService>[0];
  return new PipelineService(deps);
}

describe('PipelineService.updatePriority（P3-1）', () => {
  it('更新排队任务优先级并立即重排队列（高优先级先出队）', () => {
    const service = makeService();
    service.createTask('s-1');
    service.createTask('s-2');
    service.createTask('s-3');
    const [t1, t2, t3] = service.listTasks().map(t => t.id);
    service.updatePriority(t3, 10);
    service.updatePriority(t2, 1);
    expect(service.listTasks().find(t => t.id === t3)?.priority).toBe(10);
    expect(service.listTasks().find(t => t.id === t2)?.priority).toBe(1);
    const sorted = PipelineService.sortByPriority(service.listTasks());
    expect(sorted.map(t => t.id)).toEqual([t3, t1, t2]);
  });

  it('优先级钳制到 1-10', () => {
    const service = makeService();
    const t = service.createTask('s-1');
    service.updatePriority(t.id, 99);
    expect(service.listTasks().find(x => x.id === t.id)?.priority).toBe(10);
    service.updatePriority(t.id, -5);
    expect(service.listTasks().find(x => x.id === t.id)?.priority).toBe(1);
  });

  it('终态任务忽略优先级更新', () => {
    const service = makeService();
    const done = service.createTask('s-1');
    service.markComplete(done.id, 'url');
    service.updatePriority(done.id, 9);
    expect(service.listTasks().find(t => t.id === done.id)?.priority ?? 5).toBe(5);
  });

  it('updatePriority 触发全局订阅通知', () => {
    const service = makeService();
    const t = service.createTask('s-1');
    const seen: PipelineTask[] = [];
    service.subscribeAll(task => seen.push(task));
    service.updatePriority(t.id, 8);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].priority).toBe(8);
  });
});

describe('PipelineService.subscribeAll（P3-1）', () => {
  it('全局订阅收到新任务创建与状态变更', () => {
    const service = makeService();
    const seen: PipelineTask[] = [];
    const unsub = service.subscribeAll(task => seen.push(task));
    const t = service.createTask('s-1');
    service.markComplete(t.id, 'url');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.some(x => x.id === t.id && x.status === 'complete')).toBe(true);
    unsub();
  });

  it('取消订阅后不再收到通知', () => {
    const service = makeService();
    const seen: PipelineTask[] = [];
    const unsub = service.subscribeAll(task => seen.push(task));
    service.createTask('s-1');
    const before = seen.length;
    unsub();
    service.createTask('s-2');
    expect(seen.length).toBe(before);
  });

  it('createTask 持久化调用（优先级落库）', () => {
    const repo = makeRepo();
    const service = makeService({ repo });
    const t = service.createTask('s-1');
    service.updatePriority(t.id, 7);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: t.id, priority: 7 }));
  });
});
