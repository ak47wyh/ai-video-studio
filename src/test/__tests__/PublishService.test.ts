/**
 * P0-1 发布中心：PublishService 状态机
 *
 * 覆盖：
 * - createTask 默认 draft
 * - 合法流转 draft→ready→exported→published
 * - failed 记录原因且可重试回 ready
 * - 非法流转抛错且不落库
 * - 未知任务抛错
 */
import { describe, it, expect, vi } from 'vitest';
import { PublishService } from '../../domain/services/PublishService';
import type { PublishTask } from '../../domain/entities/models';
import type { IPublishTaskRepository } from '../../domain/ports/PublishPorts';

function makeRepo() {
  const store = new Map<string, PublishTask>();
  const repo: IPublishTaskRepository = {
    save: vi.fn(async (t: PublishTask) => { store.set(t.id, t); }),
    getById: vi.fn(async (id: string) => store.get(id)),
    query: vi.fn(async () => [...store.values()]),
    delete: vi.fn(async (id: string) => { store.delete(id); }),
    count: vi.fn(async () => store.size),
  };
  return { repo, store };
}

describe('PublishService — 发布任务状态机（P0-1）', () => {
  it('createTask 生成 draft 状态任务', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: '我的视频' });
    expect(task.status).toBe('draft');
    expect(task.finalCutId).toBe('fc-1');
    expect(task.tags).toEqual([]);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('合法流转 draft→ready→exported→published', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'bilibili', title: 't' });
    const ready = await svc.advance(task.id, 'ready');
    expect(ready.status).toBe('ready');
    const exported = await svc.advance(task.id, 'exported');
    expect(exported.status).toBe('exported');
    const published = await svc.advance(task.id, 'published');
    expect(published.status).toBe('published');
    expect(ready.updatedAt).toBeLessThanOrEqual(exported.updatedAt);
  });

  it('failed 记录失败原因，且可重试回 ready', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await svc.advance(task.id, 'ready');
    const failed = await svc.advance(task.id, 'failed', '平台接口超时');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('平台接口超时');
    const retried = await svc.advance(task.id, 'ready');
    expect(retried.status).toBe('ready');
    expect(retried.error).toBeUndefined();
  });

  it('非法流转抛错且状态不变', async () => {
    const { repo, store } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'generic', title: 't' });
    await expect(svc.advance(task.id, 'published')).rejects.toThrow('Invalid transition draft -> published');
    expect(store.get(task.id)?.status).toBe('draft');
    // draft 也不能直接 failed
    await expect(svc.advance(task.id, 'failed')).rejects.toThrow('Invalid transition');
  });

  it('未知任务抛错', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    await expect(svc.advance('nope', 'ready')).rejects.toThrow('not found');
  });

  it('listTasks / deleteTask 透传仓库', async () => {
    const { repo, store } = makeRepo();
    const svc = new PublishService(repo);
    const t1 = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 'a' });
    await svc.createTask({ finalCutId: 'fc-2', platform: 'bilibili', title: 'b' });
    const list = await svc.listTasks();
    expect(list).toHaveLength(2);
    await svc.deleteTask(t1.id);
    expect(store.size).toBe(1);
  });
});
