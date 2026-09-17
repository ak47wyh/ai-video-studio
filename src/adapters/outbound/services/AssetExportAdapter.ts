/**
 * AssetExportAdapter —— IAssetExportPort 的 JSON 实现
 *
 * 提供空间数据的 JSON 导出/导入能力。
 * 数据格式：v1 schema，含 space + characters + backgrounds + stories + segments + videoTasks + finalCuts。
 *
 * 后续可实现：
 * - ZipExportAdapter（压缩包）
 * - EncryptedExportAdapter（加密备份）
 * - S3ExportAdapter（云备份）
 */

import type { IAssetExportPort } from '../../../domain/ports/DomainServicePorts';
import type {
  StorySpace, Character, Background, Story, StorySegment, VideoTask, FinalCut
} from '../../../domain/entities/models';

interface ExportBundle {
  version: 'v1';
  exportedAt: number;
  spaces: StorySpace[];
  characters: Character[];
  backgrounds: Background[];
  stories: Story[];
  segments: StorySegment[];
  videoTasks: VideoTask[];
  finalCuts: FinalCut[];
  /** B3 全量备份：Pipeline 任务（含历史终态）与成本记录（可选字段，向后兼容） */
  pipelineTasks?: PipelineTask[];
  costRecords?: CostRecord[];
}

interface SpaceBundle {
  version: 'v1';
  exportedAt: number;
  space: StorySpace;
  characters: Character[];
  backgrounds: Background[];
  stories: Story[];
  segments: StorySegment[];
  videoTasks: VideoTask[];
  finalCuts: FinalCut[];
}

import type { IStorySpaceRepository } from '../../../domain/ports/OutboundPorts';
import type { ICharacterRepository } from '../../../domain/ports/OutboundPorts';
import type { IBackgroundRepository } from '../../../domain/ports/OutboundPorts';
import type { IStoryRepository } from '../../../domain/ports/OutboundPorts';
import type { IStorySegmentRepository } from '../../../domain/ports/OutboundPorts';
import type { IVideoTaskRepository } from '../../../domain/ports/OutboundPorts';
import type { IFinalCutRepository } from '../../../domain/ports/OutboundPorts';
import type { IPipelineTaskRepository } from '../../../domain/ports/PersistencePorts';
import type { ICostMeter, CostRecord } from '../../../domain/ports/CrossCuttingPorts';
import type { PipelineTask } from '../../../domain/entities/models';

export class AssetExportAdapter implements IAssetExportPort {
  private spaceRepo: IStorySpaceRepository;
  private characterRepo: ICharacterRepository;
  private backgroundRepo: IBackgroundRepository;
  private storyRepo: IStoryRepository;
  private segmentRepo: IStorySegmentRepository;
  private videoTaskRepo: IVideoTaskRepository;
  private finalCutRepo: IFinalCutRepository;
  private pipelineTaskRepo?: IPipelineTaskRepository;
  private costMeter?: ICostMeter;

  constructor(
    spaceRepo: IStorySpaceRepository,
    characterRepo: ICharacterRepository,
    backgroundRepo: IBackgroundRepository,
    storyRepo: IStoryRepository,
    segmentRepo: IStorySegmentRepository,
    videoTaskRepo: IVideoTaskRepository,
    finalCutRepo: IFinalCutRepository,
    pipelineTaskRepo?: IPipelineTaskRepository,
    costMeter?: ICostMeter,
  ) {
    this.spaceRepo = spaceRepo;
    this.characterRepo = characterRepo;
    this.backgroundRepo = backgroundRepo;
    this.storyRepo = storyRepo;
    this.segmentRepo = segmentRepo;
    this.videoTaskRepo = videoTaskRepo;
    this.finalCutRepo = finalCutRepo;
    this.pipelineTaskRepo = pipelineTaskRepo;
    this.costMeter = costMeter;
  }

  async exportSpaceAsJson(spaceId: string): Promise<Blob> {
    const space = await this.spaceRepo.findById(spaceId);
    if (!space) throw new Error(`Space ${spaceId} not found`);

    const characters = await this.characterRepo.findBySpaceId(spaceId);
    const backgrounds = await this.backgroundRepo.findBySpaceId(spaceId);
    const stories = await this.storyRepo.findBySpaceId(spaceId);
    const storyIds = stories.map(s => s.id);

    // 聚合 segments 和 videoTasks
    const segmentsNested = await Promise.all(
      stories.map(s => this.segmentRepo.findByStoryId(s.id))
    );
    const segments = segmentsNested.flat();

    const videoTasksNested = await Promise.all(
      segments.map(seg => this.videoTaskRepo.findBySegmentId(seg.id))
    );
    const videoTasks = videoTasksNested.flat();

    const finalCutsNested = await Promise.all(
      storyIds.map(id => this.finalCutRepo.findByStoryIds([id]))
    );
    const finalCuts = finalCutsNested.flat();

    const bundle: SpaceBundle = {
      version: 'v1',
      exportedAt: Date.now(),
      space,
      characters,
      backgrounds,
      stories,
      segments,
      videoTasks,
      finalCuts,
    };
    return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  }

  async exportAllAsJson(): Promise<Blob> {
    const spaces = await this.spaceRepo.findAll();
    const characters = await Promise.all(spaces.map(s => this.characterRepo.findBySpaceId(s.id)));
    const backgrounds = await Promise.all(spaces.map(s => this.backgroundRepo.findBySpaceId(s.id)));
    const storiesNested = await Promise.all(spaces.map(s => this.storyRepo.findBySpaceId(s.id)));
    const stories = storiesNested.flat();
    const segmentsNested = await Promise.all(stories.map(s => this.segmentRepo.findByStoryId(s.id)));
    const segments = segmentsNested.flat();
    const videoTasksNested = await Promise.all(segments.map(seg => this.videoTaskRepo.findBySegmentId(seg.id)));
    const videoTasks = videoTasksNested.flat();
    const finalCutsNested = await Promise.all(
      stories.map(s => this.finalCutRepo.findByStoryIds([s.id]))
    );
    const finalCuts = finalCutsNested.flat();

    const pipelineTasks = this.pipelineTaskRepo ? await this.pipelineTaskRepo.findAll() : undefined;
    const costRecords = this.costMeter ? this.costMeter.getRecords(undefined, 10000) : undefined;

    const bundle: ExportBundle = {
      version: 'v1',
      exportedAt: Date.now(),
      spaces,
      characters: characters.flat(),
      backgrounds: backgrounds.flat(),
      stories,
      segments,
      videoTasks,
      finalCuts,
      pipelineTasks,
      costRecords,
    };
    return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  }

  async importFromJson(blob: Blob): Promise<{ spaceId: string; imported: number }> {
    const text = await blob.text();
    const bundle = JSON.parse(text) as ExportBundle | SpaceBundle;

    if (bundle.version !== 'v1') {
      throw new Error(`Unsupported export version: ${bundle.version}`);
    }

    if ('space' in bundle) {
      // SpaceBundle
      const sb = bundle as SpaceBundle;
      await this.spaceRepo.save(sb.space);
      await Promise.all(sb.characters.map(c => this.characterRepo.save(c)));
      await Promise.all(sb.backgrounds.map(b => this.backgroundRepo.save(b)));
      await Promise.all(sb.stories.map(s => this.storyRepo.save(s)));
      await Promise.all(sb.segments.map(s => this.segmentRepo.save(s)));
      await Promise.all(sb.videoTasks.map(t => this.videoTaskRepo.save(t)));
      await Promise.all(sb.finalCuts.map(c => this.finalCutRepo.save(c)));

      const imported =
        sb.characters.length +
        sb.backgrounds.length +
        sb.stories.length +
        sb.segments.length +
        sb.videoTasks.length +
        sb.finalCuts.length;
      return { spaceId: sb.space.id, imported };
    }

    // ExportBundle
    const eb = bundle as ExportBundle;
    await Promise.all(eb.spaces.map(s => this.spaceRepo.save(s)));
    await Promise.all(eb.characters.map(c => this.characterRepo.save(c)));
    await Promise.all(eb.backgrounds.map(b => this.backgroundRepo.save(b)));
    await Promise.all(eb.stories.map(s => this.storyRepo.save(s)));
    await Promise.all(eb.segments.map(s => this.segmentRepo.save(s)));
    await Promise.all(eb.videoTasks.map(t => this.videoTaskRepo.save(t)));
    await Promise.all(eb.finalCuts.map(c => this.finalCutRepo.save(c)));
    // B3：恢复 Pipeline 任务与成本记录（备份文件含这些字段时）
    if (eb.pipelineTasks && this.pipelineTaskRepo) {
      await Promise.all(eb.pipelineTasks.map(t => this.pipelineTaskRepo!.save(t)));
    }
    if (eb.costRecords) {
      this.costMeter?.restore?.(eb.costRecords);
    }

    const imported =
      eb.spaces.length +
      eb.characters.length +
      eb.backgrounds.length +
      eb.stories.length +
      eb.segments.length +
      eb.videoTasks.length +
      eb.finalCuts.length;
    return { spaceId: eb.spaces[0]?.id ?? '', imported };
  }
}