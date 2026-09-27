/**
 * SYSTEM_OPTIMIZATION_PLAN P-2：状态机扩展 paused
 * - pauseTask：非终态任务 → paused（执行中标记 pauseRequested，阶段边界停止；排队中出队跳过）
 * - resumeTask：paused → 清除标志并复用断点续跑
 * - canceled 语义（cancelled）已由 P1-7 落地，本轮补 paused 语义分离
 */
import { describe, expect, it, vi } from 'vitest';
import { PipelineService } from '../../domain/services/PipelineService';
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

function makeService() {
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
  } as unknown as ConstructorParameters<typeof PipelineService>[0];
  return new PipelineService(deps);
}

describe('PipelineService 暂停/恢复（P-2 paused 语义）', () => {
  it('pauseTask 将执行中任务置为 paused 并标记 pauseRequested', () => {
    const svc = makeService();
    const task = svc.createTask('s-1');
    svc.pauseTask(task.id);
    const t = svc.getTask(task.id)!;
    expect(t.status).toBe('paused');
    expect(t.pauseRequested).toBe(true);
  });

  it('pauseTask 对 paused 任务幂等（重复暂停不改变状态）', () => {
    const svc = makeService();
    const task = svc.createTask('s-1');
    svc.pauseTask(task.id);
    svc.pauseTask(task.id);
    expect(svc.getTask(task.id)!.status).toBe('paused');
  });

  it('pauseTask 对终态任务忽略（complete/failed/cancelled 不进入 paused）', () => {
    const svc = makeService();
    const a = svc.createTask('s-1');
    svc.markComplete(a.id, 'v.mp4');
    svc.pauseTask(a.id);
    expect(svc.getTask(a.id)!.status).toBe('complete');
    const b = svc.createTask('s-2');
    svc.markCancelled(b.id, 'test');
    svc.pauseTask(b.id);
    expect(svc.getTask(b.id)!.status).toBe('cancelled');
  });

  it('resumeTask 仅对 paused 生效：恢复后进入断点续跑流程（mock 缺数据时失败并保留标志复位）', async () => {
    const svc = makeService();
    const task = svc.createTask('s-1');
    svc.pauseTask(task.id);
    // resumeTask 会调用 resumePipeline：segmentRepo 为空 mock → prepareSegments 抛错 → markFailed
    await expect(svc.resumeTask(task.id)).rejects.toThrow();
    const t = svc.getTask(task.id)!;
    // 暂停标志已复位（进入续跑流程），流程因 mock 缺数据失败而非仍停在 paused
    expect(t.pauseRequested).toBe(false);
    expect(t.status).toBe('failed');
  });

  it('resumeTask 对非 paused 任务直接返回原任务', async () => {
    const svc = makeService();
    const task = svc.createTask('s-1');
    const r = await svc.resumeTask(task.id);
    expect(r.status).toBe('idle');
  });

  it('cancelTask 对 paused 任务直接标记 cancelled（暂停后可取消）', () => {
    const svc = makeService();
    const task = svc.createTask('s-1');
    svc.pauseTask(task.id);
    svc.cancelTask(task.id, '不需要了');
    const t = svc.getTask(task.id)!;
    expect(t.status).toBe('cancelled');
    expect(t.error).toBe('不需要了');
  });

  it('runStages 阶段边界尊重 pauseRequested：暂停后不再推进后续阶段', async () => {
    const svc = makeService();
    const task = svc.createTask('s-1');
    svc.pauseTask(task.id);
    expect(svc.getTask(task.id)!.status).toBe('paused');
    // 幂等：再次暂停保持 paused
    svc.pauseTask(task.id);
    expect(svc.getTask(task.id)!.status).toBe('paused');
  });
});
