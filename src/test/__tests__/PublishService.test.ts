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
import type { PublishTask, FinalCut } from '../../domain/entities/models';
import type { IPublishTaskRepository } from '../../domain/ports/PublishPorts';
import type { IFinalCutRepository } from '../../domain/ports/OutboundPorts';
import { PublishChannelRegistry } from '../../domain/services/PublishChannels';

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


describe('PublishService — P3-7 排期与发布回执', () => {
  it('scheduleTask 设置未来排期时间并落库', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    const future = Date.now() + 3600_000;
    const scheduled = await svc.scheduleTask(task.id, future);
    expect(scheduled.scheduledAt).toBe(future);
    expect(repo.save).toHaveBeenCalled();
  });

  it('scheduleTask 拒绝非未来时间与终态任务', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await expect(svc.scheduleTask(task.id, Date.now() - 1000)).rejects.toThrow('in the future');
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    const pub = await svc.advance(task.id, 'published');
    await expect(svc.scheduleTask(pub.id, Date.now() + 3600_000)).rejects.toThrow('terminal');
  });

  it('getDueTasks 仅返回已到期且未终态的任务', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const now = Date.now();
    const due = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 'due' });
    const future = await svc.createTask({ finalCutId: 'fc-2', platform: 'bilibili', title: 'future' });
    const published = await svc.createTask({ finalCutId: 'fc-3', platform: 'generic', title: 'pub' });
    await svc.scheduleTask(due.id, now + 1000);
    await svc.scheduleTask(future.id, now + 3600_000);
    await svc.scheduleTask(published.id, now + 3600_000);
    await svc.advance(published.id, 'ready');
    await svc.advance(published.id, 'exported');
    await svc.advance(published.id, 'published');
    const result = await svc.getDueTasks(now + 2000);
    expect(result.map(x => x.id)).toEqual([due.id]);
  });

  it('publishNow 快捷推进到 published', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    const pub = await svc.publishNow(task.id);
    expect(pub.status).toBe('published');
  });

  it('发布回执写回成片生命周期（lifecycle/publishedAt/publishChannel）', async () => {
    const { repo } = makeRepo();
    const cutStore = new Map<string, FinalCut>();
    const finalCutRepo: IFinalCutRepository = {
      findById: vi.fn(async (id: string) => cutStore.get(id)),
      save: vi.fn(async (cut: FinalCut) => { cutStore.set(cut.id, cut); }),
      findByStoryIds: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    };
    const svc = new PublishService(repo, finalCutRepo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'bilibili', title: 't' });
    cutStore.set('fc-1', { id: 'fc-1', storyId: 's-1', videoBlob: new Blob(), duration: 10, size: 1, hasSubtitles: false, createdAt: 1, lifecycle: 'ready' });
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    const published = await svc.advance(task.id, 'published');
    const cut = cutStore.get('fc-1');
    if (!cut) throw new Error('cut not saved');
    expect(cut.lifecycle).toBe('published');
    expect(cut.publishedAt).toBe(published.updatedAt);
    expect(cut.publishChannel).toBe('bilibili');
  });
});


describe('PublishService — P3-8 数据回传', () => {
  it('updateStats 仅 published 任务可写并落库（含 collectedAt）', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    await svc.advance(task.id, 'published');
    const updated = await svc.updateStats(task.id, { views: 1000, likes: 50, comments: 10, shares: 5 });
    expect(updated.stats?.views).toBe(1000);
    expect(updated.stats?.likes).toBe(50);
    expect(updated.stats?.collectedAt).toBeGreaterThan(0);
  });

  it('updateStats 拒绝未发布任务与非法数字', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await expect(svc.updateStats(task.id, { views: 1, likes: 0, comments: 0, shares: 0 })).rejects.toThrow('published');
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    await svc.advance(task.id, 'published');
    await expect(svc.updateStats(task.id, { views: -1, likes: 0, comments: 0, shares: 0 })).rejects.toThrow('non-negative');
  });

  it('updateStats 未知任务抛错', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo);
    await expect(svc.updateStats('nope', { views: 1, likes: 0, comments: 0, shares: 0 })).rejects.toThrow('not found');
  });
});


describe('PublishService — P3-9 通道化发布', () => {
  const config = (over: Record<string, string> = {}) => ({
    activePlatform: 'volcengine' as const,
    minimaxApiKey: '', minimaxGroupId: '', minimaxBaseUrl: '', minimaxAnthropicBaseUrl: '',
    volcArkOpenAiApiKey: '', volcArkAnthropicApiKey: '', volcArkBaseUrl: '', volcArkAgentPlanBaseUrl: '',
    volcArkAnthropicBaseUrl: '', volcArkTextProtocol: 'openai' as const, volcArkAnthropicModel: '', volcArkAutoFallback: true,
    volcArkImageModel: '', volcVoiceAppId: '', volcVoiceAccessToken: '', volcVoiceCluster: '',
    volcVoiceCloneModelType: 0 as const, volcSeedTtsModel: '', volcSeedTtsEnabled: false,
    klingAccessKey: '', klingSecretKey: '', klingBaseUrl: '', wanApiKey: '', wanBaseUrl: '',
    hunyuanSecretId: '', hunyuanSecretKey: '', hunyuanBaseUrl: '', zhipuApiKey: '', zhipuBaseUrl: '',
    viduApiKey: '', viduBaseUrl: '', theme: 'light' as const, vconsoleEnabled: false,
    ...over,
  });
  const channels = new PublishChannelRegistry();

  it('executePublish generic 直接发布并回执成片生命周期', async () => {
    const { repo } = makeRepo();
    const cutStore = new Map<string, FinalCut>();
    const finalCutRepo: IFinalCutRepository = {
      findById: vi.fn(async (id: string) => cutStore.get(id)),
      save: vi.fn(async (cut: FinalCut) => { cutStore.set(cut.id, cut); }),
      findByStoryIds: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    };
    const svc = new PublishService(repo, finalCutRepo, channels, { config: config() });
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'generic', title: 't' });
    cutStore.set('fc-1', { id: 'fc-1', storyId: 's-1', videoBlob: new Blob(), duration: 1, size: 1, hasSubtitles: false, createdAt: 1, lifecycle: 'ready' });
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    const result = await svc.executePublish(task.id);
    expect(result.task.status).toBe('published');
    expect(result.manual).toBeUndefined();
    const cut = cutStore.get('fc-1');
    if (!cut) throw new Error('cut not saved');
    expect(cut.lifecycle).toBe('published');
  });

  it('executePublish douyin 无凭据时被通道阻止且不推进', async () => {
    const { repo, store } = makeRepo();
    const svc = new PublishService(repo, undefined, channels, { config: config() });
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    await expect(svc.executePublish(task.id)).rejects.toThrow('请先配置');
    expect(store.get(task.id)?.status).toBe('exported');
  });

  it('executePublish douyin 凭据就绪时半自动放行（needsManual）', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo, undefined, channels, { config: config({ publishDouyinAppKey: 'k', publishDouyinAccessToken: 't' }) });
    const task = await svc.createTask({ finalCutId: 'fc-1', platform: 'douyin', title: 't' });
    await svc.advance(task.id, 'ready');
    await svc.advance(task.id, 'exported');
    const result = await svc.executePublish(task.id);
    expect(result.task.status).toBe('published');
    expect(result.manual).toBe(true);
  });

  it('setChannelContext 可更新通道上下文', async () => {
    const { repo } = makeRepo();
    const svc = new PublishService(repo, undefined, channels, { config: config() });
    svc.setChannelContext({ config: config({ publishBilibiliAppKey: 'b', publishBilibiliAccessToken: 't' }) });
    expect(channels.isReady('bilibili', config({ publishBilibiliAppKey: 'b', publishBilibiliAccessToken: 't' }))).toBe(true);
  });
});
