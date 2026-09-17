import type { FinalCut, FinalCutPipelineOptions } from '../entities/models';
import type { IFinalCutRepository } from '../ports/OutboundPorts';
import type { PipelineService, PipelineOptions } from './PipelineService';

/**
 * P0-3 成片回改闭环：
 * - rework：以新配置重跑 pipeline 生成新版本成片，并写入版本溯源（sourceVersionId/version）
 * - listVersions：同一故事下的版本列表（含回改链）
 * - snapshotOptions：把 PipelineOptions 收敛为可持久化快照（剔除 onProgress 等运行时字段）
 */
export class FinalCutReworkService {
  private readonly finalCutRepo: IFinalCutRepository;
  private readonly pipelineService: PipelineService;

  constructor(finalCutRepo: IFinalCutRepository, pipelineService: PipelineService) {
    this.finalCutRepo = finalCutRepo;
    this.pipelineService = pipelineService;
  }

  /** 仅保留可复现的配置字段（不持久化回调/并发等运行时参数） */
  snapshotOptions(options: PipelineOptions): FinalCutPipelineOptions {
    return {
      videoMode: options.videoMode,
      videoModel: options.videoModel,
      videoResolution: options.videoResolution,
      videoDuration: options.videoDuration,
      promptOptimizer: options.promptOptimizer,
      includeNarration: options.includeNarration,
      includeBGM: options.includeBGM,
      includeSubtitles: options.includeSubtitles,
      videoStyle: options.videoStyle,
    };
  }

  /**
   * 以新配置回改：跑完整 pipeline，产物成片写入版本链。
   * 关联方式：记录开始时间，完成后取该故事 createdAt 不早于开始时间的最新 pipeline 成片。
   */
  async rework(sourceCut: FinalCut, options: PipelineOptions): Promise<FinalCut> {
    const startedAt = Date.now();
    await this.pipelineService.runFullPipeline(sourceCut.storyId, options);
    const cuts = await this.finalCutRepo.findByStoryIds([sourceCut.storyId]);
    const produced = cuts
      .filter(c => c.createdAt >= startedAt && c.source === 'pipeline')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!produced) {
      throw new Error('Rework: pipeline completed but no final cut produced');
    }
    const nextVersion = (sourceCut.version ?? 1) + 1;
    const updated: FinalCut = {
      ...produced,
      sourceVersionId: sourceCut.id,
      version: nextVersion,
      pipelineOptions: this.snapshotOptions(options),
    };
    await this.finalCutRepo.save(updated);
    return updated;
  }

  /** 同一故事下的全部成片版本（createdAt 倒序） */
  async listVersions(storyId: string): Promise<FinalCut[]> {
    const cuts = await this.finalCutRepo.findByStoryIds([storyId]);
    return cuts.sort((a, b) => b.createdAt - a.createdAt);
  }
}
