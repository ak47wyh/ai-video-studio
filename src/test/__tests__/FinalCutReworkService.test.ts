/**
 * P0-3 成片回改闭环：FinalCutReworkService
 *
 * 覆盖：
 * - snapshotOptions 只持久化可复现字段（剔除 onProgress/concurrency）
 * - rework 以新配置重跑 pipeline 并写入版本溯源（version+1 / sourceVersionId / 配置快照）
 * - rework 无产物时抛错
 * - listVersions 按 createdAt 倒序
 */
import { describe, it, expect, vi } from 'vitest';
import { FinalCutReworkService } from '../../domain/services/FinalCutReworkService';
import type { FinalCut } from '../../domain/entities/models';
import type { IFinalCutRepository } from '../../domain/ports/OutboundPorts';
import type { PipelineService } from '../../domain/services/PipelineService';

function makeDeps() {
  const repo: IFinalCutRepository = {
    save: vi.fn(async () => { }),
    findById: vi.fn(async (): Promise<FinalCut | undefined> => undefined),
    findByStoryIds: vi.fn(async (): Promise<FinalCut[]> => []),
    delete: vi.fn(async () => { }),
  };
  const pipeline: PipelineService = {
    runFullPipeline: vi.fn(async () => ({ id: 'task-1' }) as never),
    resumePipeline: vi.fn(async () => ({ id: 'task-1' }) as never),
  } as unknown as PipelineService;
  return { svc: new FinalCutReworkService(repo, pipeline), repo, pipeline };
}

function fakeCut(partial: Partial<FinalCut> = {}): FinalCut {
  return {
    id: 'fc-1',
    storyId: 'st-1',
    pipelineTaskId: 'task-1',
    videoBlob: new Blob(['v']),
    duration: 3000,
    size: 10,
    hasSubtitles: false,
    createdAt: 1000,
    source: 'pipeline',
    version: 1,
    ...partial,
  };
}

describe('FinalCutReworkService — 成片回改（P0-3）', () => {
  it('snapshotOptions 剔除运行时字段', () => {
    const { svc } = makeDeps();
    const snap = svc.snapshotOptions({
      videoStyle: 'cinematic',
      includeNarration: true,
      onProgress: () => {},
      concurrency: 4,
    });
    expect(snap.videoStyle).toBe('cinematic');
    expect(snap.includeNarration).toBe(true);
    expect('onProgress' in snap).toBe(false);
    expect('concurrency' in snap).toBe(false);
  });

  it('rework 重跑 pipeline 并写入版本溯源', async () => {
    const { svc, repo, pipeline } = makeDeps();
    const source = fakeCut({ version: 2, pipelineOptions: { videoStyle: 'anime' } });
    const produced = fakeCut({ id: 'fc-3', createdAt: Date.now() + 10, version: undefined });
    (repo.findByStoryIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([source, produced]);

    const result = await svc.rework(source, { videoStyle: 'scifi', includeBGM: true });

    expect(pipeline.runFullPipeline).toHaveBeenCalledWith('st-1', { videoStyle: 'scifi', includeBGM: true });
    expect(result.id).toBe('fc-3');
    expect(result.version).toBe(3); // source.version(2) + 1
    expect(result.sourceVersionId).toBe('fc-1');
    expect(result.pipelineOptions?.videoStyle).toBe('scifi');
    expect(result.pipelineOptions?.includeBGM).toBe(true);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('rework 无产物时抛错', async () => {
    const { svc, repo } = makeDeps();
    const source = fakeCut();
    (repo.findByStoryIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([source]);
    await expect(svc.rework(source, { videoStyle: 'anime' })).rejects.toThrow('no final cut produced');
  });

  it('listVersions 按 createdAt 倒序', async () => {
    const { svc, repo } = makeDeps();
    const v1 = fakeCut({ id: 'v1', createdAt: 1000, version: 1 });
    const v2 = fakeCut({ id: 'v2', createdAt: 3000, version: 2, sourceVersionId: 'v1' });
    (repo.findByStoryIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([v1, v2]);
    const list = await svc.listVersions('st-1');
    expect(list.map(c => c.id)).toEqual(['v2', 'v1']);
  });
});
