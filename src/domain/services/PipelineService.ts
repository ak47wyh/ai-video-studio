import { v4 as uuidv4 } from 'uuid';
import type { PipelineTask, PipelineStatus, PipelineStep, StorySegment, VideoTask, Character, Background, FinalCut } from '../entities/models';
import type {
  IVideoTaskRepository,
  IStoryRepository,
  IStorySegmentRepository,
  ICharacterRepository,
  IBackgroundRepository,
  IFinalCutRepository,
  IImageGeneratorPort,
  IVideoGeneratorPort,
  IVoicePort,
  IStoryBreakdownPort,
  VideoGenerationMode,
  VideoModel,
  VideoResolution
} from '../ports/OutboundPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IPipelineTaskRepository } from '../ports/PersistencePorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort, IEventBus } from '../ports/CrossCuttingPorts';
import type { PostProcessService } from './PostProcessService';
import { createTrackedObjectUrl } from '../../utils/objectUrlRegistry';
import type { SubtitleService } from './SubtitleService';
import type { PlatformRouter } from './PlatformRouter';
import type { PromptContextBuilder } from './PromptContextBuilder';
import type { MusicService } from './MusicService';
import type { BGMRecommendationService } from './BGMRecommendationService';
import { PromisePool } from './PromisePool';
import { getStylePromptSuffix } from '../data/stylePresets';

export type { PipelineTask, PipelineStatus, PipelineStep };

export interface PipelineOptions {
  videoMode?: VideoGenerationMode;
  videoModel?: VideoModel;
  videoResolution?: VideoResolution;
  videoDuration?: 6 | 10;
  promptOptimizer?: boolean;
  includeNarration?: boolean;
  includeBGM?: boolean;
  includeSubtitles?: boolean;
  concurrency?: number;
  onProgress?: (stage: PipelineStatus, percent: number, message: string) => void;
  /** 画面风格预设（AI 故事成片），追加到图片/视频 prompt 末尾 */
  videoStyle?: import('../entities/models').VideoStyle;
}

interface PipelineDeps {
  storyRepo: IStoryRepository;
  segmentRepo: IStorySegmentRepository;
  characterRepo: ICharacterRepository;
  backgroundRepo: IBackgroundRepository;
  videoTaskRepo: IVideoTaskRepository;
  finalCutRepo: IFinalCutRepository;
  router: PlatformRouter;
  postProcess: PostProcessService;
  subtitle: SubtitleService;
  fileStorage: IFileStoragePort | (() => IFileStoragePort);
  logger: ILoggerPort;
  eventBus?: IEventBus;
  /** Phase 2 反转：注入 IApiConfigStore，替代 ApiConfigStore 单例 */
  configStore: IApiConfigStore;
  // ===== Phase 1 业务闭环新增依赖（EVOLUTION_DESIGN.md §5.1）=====
  /** 故事智能拆分（替代朴素 text.split 切分） */
  storyBreakdownPort?: IStoryBreakdownPort;
  /** 视频生成 Prompt 上下文构建器（替代 seg.content.slice 作 prompt） */
  promptContextBuilder?: PromptContextBuilder;
  /** BGM 推荐服务（阶段 4 真实生成 BGM） */
  bgmRecommendationService?: BGMRecommendationService;
  /** 音乐生成服务（阶段 4 真实生成 BGM） */
  musicService?: MusicService;
  // ===== M3.1 持久化与恢复（EVOLUTION_DESIGN.md §7.1）=====
  /** Pipeline 任务仓储（持久化到 IndexedDB，解决刷新即丢） */
  pipelineTaskRepo?: IPipelineTaskRepository;
}

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120;

/**
 * 业务管线服务（全流程编排）
 *
 * v2.0 架构升级：
 * - 接入 ILoggerPort（替换 console.log）
 * - 接入 IEventBus（提交视频任务时 emit，外部可订阅）
 * - 视频任务阶段改为"事件驱动 + 兜底轮询"双模式
 */
export class PipelineService {
  private tasks: Map<string, PipelineTask> = new Map();
  private subscribers: Map<string, Set<(task: PipelineTask) => void>> = new Map();
  private videoPollers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private pendingVideoTasks: Map<string, Set<string>> = new Map(); // pipelineTaskId → externalTaskIds

  private deps: PipelineDeps;
  private logger: ILoggerPort;
  private eventBus: IEventBus | undefined;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    this.eventBus = deps.eventBus;

    // 订阅 video.task.completed/failed 事件（事件驱动）
    this.eventBus?.on('video.task.completed', (payload) => {
      this.handleVideoTaskCompleted(payload.taskId, payload.videoUrl);
    });
    this.eventBus?.on('video.task.failed', (payload) => {
      this.handleVideoTaskFailed(payload.taskId, payload.error);
    });
  }

  private getImagePort(): IImageGeneratorPort {
    return this.deps.router.resolveImage(this.deps.configStore.load());
  }

  private getVideoPort(): IVideoGeneratorPort {
    return this.deps.router.resolveVideo(this.deps.configStore.load());
  }

  private getVoicePort(): IVoicePort {
    return this.deps.router.resolveVoice(this.deps.configStore.load());
  }

  subscribe(taskId: string, callback: (task: PipelineTask) => void): () => void {
    if (!this.subscribers.has(taskId)) this.subscribers.set(taskId, new Set());
    this.subscribers.get(taskId)!.add(callback);
    return () => {
      this.subscribers.get(taskId)?.delete(callback);
    };
  }

  getTask(taskId: string): PipelineTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  listTasks(): PipelineTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  private notify(task: PipelineTask): void {
    this.tasks.set(task.id, { ...task });
    this.subscribers.get(task.id)?.forEach(cb => cb(task));
    // M3.1 持久化：所有状态变更统一写库（fire-and-forget，不阻塞主流程）
    this.persistTask(task);
  }

  /** 持久化 PipelineTask 到 IndexedDB（静默失败，不影响主流程） */
  private persistTask(task: PipelineTask): void {
    if (!this.deps.pipelineTaskRepo) return;
    this.deps.pipelineTaskRepo.save(task).catch(e => {
      this.logger.warn('persist PipelineTask failed', {
        service: 'PipelineService',
        method: 'persistTask',
        taskId: task.id,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  /**
   * M3.1 恢复运行中的 Pipeline 任务
   *
   * 启动时调用，从 IndexedDB 加载所有未完成的任务。
   * 恢复策略：
   *   - 视频任务还在跑 → 由 VideoGenerationService.resumeActivePolling() 独立恢复
   *   - Pipeline 处于中间阶段 → 标记为 failed（无法准确恢复执行点），提供"重试"按钮
   *   - 已 complete / failed 的任务 → 仅加载到内存，供历史查询
   *
   * @returns 恢复的任务列表（含需要用户处理的失败任务）
   */
  async restoreActiveTasks(): Promise<PipelineTask[]> {
    if (!this.deps.pipelineTaskRepo) {
      this.logger.info('pipelineTaskRepo not injected, skip restore', {
        service: 'PipelineService',
        method: 'restoreActiveTasks',
      });
      return [];
    }

    const activeTasks = await this.deps.pipelineTaskRepo.findActive();
    if (activeTasks.length === 0) {
      this.logger.info('no active Pipeline tasks to restore', {
        service: 'PipelineService',
        method: 'restoreActiveTasks',
      });
      return [];
    }

    const restored: PipelineTask[] = [];
    for (const task of activeTasks) {
      // 加载到内存
      this.tasks.set(task.id, { ...task });
      restored.push(task);

      // 处于中间阶段的任务无法准确恢复执行点，标记为 failed 供用户重试
      if (task.status !== 'idle' && task.status !== 'complete') {
        const errorMsg = `页面刷新中断，任务恢复失败（原阶段: ${task.status}）`;
        task.error = errorMsg;
        task.currentStep = '需要用户手动重试';
        // 标记当前阶段为 failed
        const currentStep = task.steps.find(s => s.name === task.status);
        if (currentStep) {
          currentStep.status = 'failed';
          currentStep.error = errorMsg;
        }
        task.status = 'failed';
        this.notify(task);

        this.logger.warn('Pipeline task restored as failed (interrupted by refresh)', {
          service: 'PipelineService',
          method: 'restoreActiveTasks',
          taskId: task.id,
          storyId: task.storyId,
          interruptedStage: task.status,
        });
      }
    }

    this.logger.info('Pipeline tasks restored', {
      service: 'PipelineService',
      method: 'restoreActiveTasks',
      totalRestored: restored.length,
      failedCount: restored.filter(t => t.status === 'failed').length,
    });

    return restored;
  }

  private setStage(task: PipelineTask, stage: PipelineStatus, currentStep: string, progress: number): void {
    task.status = stage;
    task.currentStep = currentStep;
    task.progress = progress;
    const step = task.steps.find(s => s.name === stage);
    if (step) {
      step.status = 'running';
      step.startedAt = Date.now();
    }
    this.notify(task);
    this.logger.info(`pipeline stage update`, {
      service: 'PipelineService',
      method: 'setStage',
      taskId: task.id,
      stage,
      currentStep,
      progress,
    });
  }

  private completeStage(task: PipelineTask, stage: PipelineStatus, error?: string): void {
    const step = task.steps.find(s => s.name === stage);
    if (step) {
      step.status = error ? 'failed' : 'done';
      step.completedAt = Date.now();
      if (error) step.error = error;
    }
    this.notify(task);
  }

  private initTask(storyId: string): PipelineTask {
    const stages: PipelineStatus[] = [
      'splitting',
      'generating_images',
      'generating_audio',
      'generating_bgm',
      'generating_videos',
      'post_processing',
      'generating_srt',
      'burning_subtitles',
      'complete'
    ];
    return {
      id: uuidv4(),
      storyId,
      status: 'idle',
      progress: 0,
      currentStep: 'Initializing',
      steps: stages.map(name => ({ name, status: 'pending' as const })),
      createdAt: Date.now()
    };
  }

  createTask(storyId: string): PipelineTask {
    const task = this.initTask(storyId);
    this.tasks.set(task.id, task);
    this.notify(task);
    return task;
  }

  markComplete(taskId: string, finalVideoUrl: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    ['post_processing', 'generating_srt', 'burning_subtitles', 'complete'].forEach(s => {
      this.completeStage(task, s as PipelineStatus);
    });
    task.status = 'complete';
    task.progress = 100;
    task.currentStep = 'Complete';
    task.finalVideoUrl = finalVideoUrl;
    task.completedAt = Date.now();
    this.notify(task);
    this.cleanupPollers(taskId);
    this.logger.info('pipeline completed', { service: 'PipelineService', method: 'markComplete', taskId });
  }

  markFailed(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.error = error;
    task.currentStep = `Failed: ${error}`;
    task.completedAt = Date.now();
    const runningStep = task.steps.find(s => s.status === 'running');
    if (runningStep) {
      runningStep.status = 'failed';
      runningStep.error = error;
      runningStep.completedAt = Date.now();
    }
    this.notify(task);
    this.cleanupPollers(taskId);
    this.logger.error('pipeline failed', new Error(error), { service: 'PipelineService', method: 'markFailed', taskId });
  }

  startStage(taskId: string, stage: PipelineStatus, currentStep: string, progress = 0): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    this.setStage(task, stage, currentStep, progress);
    return true;
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.error = 'Cancelled by user';
    task.completedAt = Date.now();
    this.notify(task);
    this.cleanupPollers(taskId);
  }

  private cleanupPollers(taskId: string): void {
    const poller = this.videoPollers.get(taskId);
    if (poller) {
      clearInterval(poller);
      this.videoPollers.delete(taskId);
    }
    this.pendingVideoTasks.delete(taskId);
  }

  /**
   * End-to-end 一键成片 — 从 Story 实体到 FinalCut 完整链路
   * 阶段：splitting → generating_images → generating_audio → generating_bgm
   *       → generating_videos → post_processing → generating_srt → burning_subtitles → complete
   */
  async runFullPipeline(storyId: string, options: PipelineOptions = {}): Promise<PipelineTask> {
    const task = this.createTask(storyId);
    const onProgress = options.onProgress;
    const emitProgress = (stage: PipelineStatus, percent: number, msg: string) => {
      const t = this.tasks.get(task.id);
      if (t) {
        t.progress = percent;
        t.currentStep = msg;
        t.status = stage;
        this.notify(t);
      }
      onProgress?.(stage, percent, msg);
    };

    const { includeNarration = true, includeBGM = true, includeSubtitles = true } = options;
    const styleSuffix = options.videoStyle ? getStylePromptSuffix(options.videoStyle) : '';

    try {
      const story = await this.deps.storyRepo.findById(storyId);
      if (!story) throw new Error('Story not found');

      // 阶段 1: 拆分 (5%)
      // Phase 1 改造（EVOLUTION_DESIGN.md §5.1.1）：接入真实 AI 故事拆分
      // 优先调用 storyBreakdownPort.breakdownStory()，失败时降级到原朴素切分
      this.startStage(task.id, 'splitting', '加载分镜', 2);
      let segments = await this.deps.segmentRepo.findByStoryId(storyId);
      if (segments.length === 0) {
        emitProgress('splitting', 4, 'AI 拆分故事为分镜...');
        segments = await this.splitStoryWithAI(story, emitProgress);
      }
      this.completeStage(task, 'splitting');
      emitProgress('splitting', 5, `已加载 ${segments.length} 个分镜`);

      // 阶段 2: 生成图片 (10% → 20%)
      // Phase 1 改造（EVOLUTION_DESIGN.md §5.1.3）：接入 PromptContextBuilder
      // 用结构化上下文替代 seg.content.slice(0, 500) 作 prompt
      this.startStage(task.id, 'generating_images', '生成角色/背景图片', 10);
      let imageCount = 0;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg.firstFrameImage && seg.content) {
          try {
            // 优先用 PromptContextBuilder 构建结构化 prompt
            let imagePrompt = seg.content.slice(0, 500);
            if (this.deps.promptContextBuilder) {
              try {
                const characters = await this.loadSegmentCharacters(seg);
                const background = await this.loadSegmentBackground(seg);
                const { context } = await this.deps.promptContextBuilder.build(
                  seg, characters, background,
                  { videoStyle: story.title, enableCinematography: false }, // 图片阶段不开镜头建议
                );
                imagePrompt = context.prompt;
              } catch (e) {
                this.logger.warn('PromptContextBuilder failed, fallback to raw content', {
                  service: 'PipelineService',
                  method: 'runFullPipeline',
                  stage: 'generating_images',
                  segmentId: seg.id,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
            if (styleSuffix) imagePrompt += styleSuffix;
            const imgResult = await this.getImagePort().generateImage({
              prompt: imagePrompt,
              aspectRatio: '16:9',
              model: 'image-01-live',
            });
            if (imgResult.imageUrls?.[0] || imgResult.imageDataUri) {
              seg.firstFrameImage = imgResult.imageUrls?.[0] || imgResult.imageDataUri;
              await this.deps.segmentRepo.save(seg);
              imageCount++;
            }
          } catch (e) {
            this.logger.warn('image generation failed', {
              service: 'PipelineService',
              method: 'runFullPipeline',
              stage: 'generating_images',
              segmentId: seg.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        const progress = 10 + Math.round((i + 1) / segments.length * 10);
        emitProgress('generating_images', progress, `已生成 ${i + 1}/${segments.length} 张图片`);
      }
      this.completeStage(task, 'generating_images');
      emitProgress('generating_images', 20, imageCount > 0 ? `已生成 ${imageCount} 张图片` : '图片就绪');

      // 阶段 3: 生成旁白 (25% → 40%)
      // P0 修复：旁白音频持久化到 OPFS（原仅计数 narrationCount，刷新即丢，合成无声）
      if (includeNarration) {
        this.startStage(task.id, 'generating_audio', '生成旁白音频', 25);
        let narrationCount = 0;
        const fileStorage = typeof this.deps.fileStorage === 'function' ? this.deps.fileStorage() : this.deps.fileStorage;
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          if (!seg.mentionedCharacters || seg.mentionedCharacters.length === 0) continue;
          const character = await this.findCharacterForSegment(seg);
          if (character?.voiceId) {
            try {
              const result = await this.getVoicePort().synthesizeSpeechSync({
                model: 'speech-2.8-turbo',
                text: seg.content,
                voiceId: character.voiceId,
                outputFormat: 'url',
              });
              if (result.audioUrl) {
                // 持久化到 OPFS：audioUrl → Blob → 存储 → 更新 segment.narrationAudioStoragePath
                try {
                  const audioBlob = await (await fetch(result.audioUrl)).blob();
                  const storagePath = `audio/narration_${seg.id}.mp3`;
                  await fileStorage.storeBlob(storagePath, audioBlob);
                  seg.narrationAudioStoragePath = storagePath;
                  await this.deps.segmentRepo.save(seg);
                } catch (persistErr) {
                  // 持久化失败不阻断流程，降级使用原始 URL（由 assembleFinalVideo 兜底）
                  this.logger.warn('narration persist failed, fallback to url', {
                    service: 'PipelineService',
                    method: 'runFullPipeline',
                    stage: 'generating_audio',
                    segmentId: seg.id,
                    error: persistErr instanceof Error ? persistErr.message : String(persistErr),
                  });
                }
                narrationCount++;
              }
            } catch (e) {
              this.logger.warn('narration synthesis failed', {
                service: 'PipelineService',
                method: 'runFullPipeline',
                stage: 'generating_audio',
                segmentId: seg.id,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
          const progress = 25 + Math.round((i + 1) / segments.length * 15);
          emitProgress('generating_audio', progress, `已生成 ${i + 1}/${segments.length} 个旁白`);
        }
        this.completeStage(task, 'generating_audio');
        emitProgress('generating_audio', 40, `已生成 ${narrationCount} 个旁白`);
      } else {
        this.completeStage(task, 'generating_audio');
        emitProgress('generating_audio', 40, '跳过旁白生成');
      }

      // 阶段 4: 生成 BGM (45% → 50%)
      // Phase 1 改造（EVOLUTION_DESIGN.md §5.1.4）：接入真实 BGM 生成
      // 调用 BGMRecommendationService.recommend + MusicService.generateBGM
      if (includeBGM) {
        this.startStage(task.id, 'generating_bgm', '生成背景音乐', 45);
        let bgmCount = 0;
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          // 已有 BGM 的分镜跳过
          if (seg.bgmAudioUrl || seg.bgmStoragePath) {
            bgmCount++;
            continue;
          }
          try {
            if (this.deps.bgmRecommendationService && this.deps.musicService) {
              const recommendation = await this.deps.bgmRecommendationService.recommend(seg.content);
              const bgmUrl = await this.deps.musicService.generateBGM(
                seg.id,
                recommendation.prompt,
                {
                  isInstrumental: recommendation.useInstrumental,
                  lyrics: undefined, // Pipeline 默认纯音乐
                },
              );
              if (bgmUrl) bgmCount++;
              this.logger.info('BGM generated for segment', {
                service: 'PipelineService',
                method: 'runFullPipeline',
                stage: 'generating_bgm',
                segmentId: seg.id,
                category: recommendation.category,
                bgmUrl: bgmUrl?.slice(0, 80),
              });
            } else {
              this.logger.warn('BGM services not injected, skip BGM generation', {
                service: 'PipelineService',
                method: 'runFullPipeline',
                stage: 'generating_bgm',
              });
            }
          } catch (e) {
            this.logger.warn('BGM generation failed', {
              service: 'PipelineService',
              method: 'runFullPipeline',
              stage: 'generating_bgm',
              segmentId: seg.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          const progress = 45 + Math.round((i + 1) / segments.length * 5);
          emitProgress('generating_bgm', progress, `BGM 进度 ${i + 1}/${segments.length}`);
        }
        this.completeStage(task, 'generating_bgm');
        emitProgress('generating_bgm', 50, bgmCount > 0 ? `已生成 ${bgmCount} 个 BGM` : 'BGM 完成');
      } else {
        this.completeStage(task, 'generating_bgm');
        emitProgress('generating_bgm', 50, '跳过 BGM');
      }

      // 阶段 5: 提交视频任务（事件驱动 + 兜底轮询）
      // Phase 1 改造（EVOLUTION_DESIGN.md §5.1.3 + M3.2）：接入 PromptContextBuilder + 并发池
      this.startStage(task.id, 'generating_videos', '生成视频', 55);
      const videoTasks: VideoTask[] = [];
      const externalTaskIds: string[] = [];
      const activePlatform = this.deps.configStore.load().activePlatform;
      this.pendingVideoTasks.set(task.id, new Set(externalTaskIds));

      // 预构建每个分镜的视频 prompt（含镜头建议）
      const segPromptResults = await PromisePool.run(
        segments,
        async (seg: StorySegment, _index: number) => {
          // 优先用 PromptContextBuilder 构建结构化 prompt
          if (this.deps.promptContextBuilder) {
            try {
              const characters = await this.loadSegmentCharacters(seg);
              const background = await this.loadSegmentBackground(seg);
              const { context } = await this.deps.promptContextBuilder.build(
                seg, characters, background,
                {
                  mode: options.videoMode,
                  model: options.videoModel,
                  resolution: options.videoResolution,
                  duration: options.videoDuration,
                  promptOptimizer: options.promptOptimizer,
                  videoStyle: story.title,
                  enableCinematography: true, // 视频阶段开启镜头建议
                },
              );
              return { seg, prompt: context.prompt, buildInfo: 'builder' as const };
            } catch (e) {
              this.logger.warn('PromptContextBuilder failed for video, fallback to raw content', {
                service: 'PipelineService',
                method: 'runFullPipeline',
                stage: 'generating_videos',
                segmentId: seg.id,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
          return { seg, prompt: seg.content, buildInfo: 'raw' as const };
        },
        (done, total) => {
          const progress = 55 + Math.round((done / total) * 5);
          emitProgress('generating_videos', progress, `构建视频 prompt ${done}/${total}`);
        },
        { concurrency: 3 },
      );

      // 提交视频任务（并发池，控制平台 QPS）
      const segPromptOkItems = segPromptResults
        .filter(r => r.status === 'ok' && r.value)
        .map(r => r.value as { seg: StorySegment; prompt: string; buildInfo: string });
      const submitResults = await PromisePool.run(
        segPromptOkItems,
        async (item: { seg: StorySegment; prompt: string; buildInfo: string }, _index: number) => {
          try {
            const videoPrompt = styleSuffix ? item.prompt + styleSuffix : item.prompt;
            const externalTaskId = await this.getVideoPort().submitVideoTask({
              mode: options.videoMode || 't2v',
              model: options.videoModel,
              prompt: videoPrompt,
              firstFrameImage: item.seg.firstFrameImage,
              duration: options.videoDuration || 6,
              resolution: options.videoResolution || '768P',
              promptOptimizer: options.promptOptimizer !== false,
            });
            const taskEntity: VideoTask = {
              id: uuidv4(),
              segmentId: item.seg.id,
              // P0 修复：从 configStore 动态读取激活平台（原硬编码 'MINIMAX'）
              targetPlatform: this.deps.configStore.load().activePlatform,
              status: 'PENDING',
              externalTaskId,
              mode: options.videoMode || 't2v',
              model: options.videoModel,
              resolution: options.videoResolution || '768P',
              duration: options.videoDuration || 6,
              promptOptimizer: options.promptOptimizer !== false,
              firstFrameImage: item.seg.firstFrameImage,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            await this.deps.videoTaskRepo.save(taskEntity);
            this.eventBus?.emit('video.task.submitted', {
              type: 'video.task.submitted' as const,
              taskId: externalTaskId,
              spaceId: item.seg.storyId,
              platform: activePlatform as string,
            });
            return { taskEntity, externalTaskId };
          } catch (e) {
            this.logger.warn('video submit failed', {
              service: 'PipelineService',
              method: 'runFullPipeline',
              stage: 'generating_videos',
              segmentId: item.seg.id,
              error: e instanceof Error ? e.message : String(e),
            });
            throw e;
          }
        },
        (done, total) => {
          const progress = 60 + Math.round((done / total) * 5);
          emitProgress('generating_videos', progress, `已提交 ${done}/${total} 个视频任务`);
        },
        { concurrency: options.concurrency ?? 3 },
      );

      for (const r of submitResults) {
        if (r.status === 'ok' && r.value) {
          videoTasks.push(r.value.taskEntity);
          externalTaskIds.push(r.value.externalTaskId);
        }
      }

      // 更新待处理任务集合
      this.pendingVideoTasks.set(task.id, new Set(externalTaskIds));

      // 兜底轮询（如果外部没有事件触发，由本服务兜底拉取）
      await this.pollVideoTasks(task.id, videoTasks, (done, total) => {
        const progress = 65 + Math.round((done / total) * 15);
        emitProgress('generating_videos', progress, `视频进度 ${done}/${total}`);
      });
      this.completeStage(task, 'generating_videos');
      emitProgress('generating_videos', 80, '视频生成完成');

      // 阶段 6: 后期处理 (85%)
      // Phase 1 改造（EVOLUTION_DESIGN.md §5.1.6）：调用真实 assembleFinalVideo
      this.startStage(task.id, 'post_processing', '后期合成', 82);
      let finalCut: FinalCut | null = null;
      try {
        finalCut = await this.assembleFinalVideo(storyId, {}, (p, msg) => {
          const progress = 82 + Math.round(p * 0.08);
          emitProgress('post_processing', progress, msg);
        });
        this.logger.info('assembleFinalVideo done', {
          service: 'PipelineService',
          method: 'runFullPipeline',
          stage: 'post_processing',
          finalCutId: finalCut.id,
          duration: finalCut.duration,
          hasSubtitles: finalCut.hasSubtitles,
        });
      } catch (e) {
        this.logger.error('assembleFinalVideo failed', e, {
          service: 'PipelineService',
          method: 'runFullPipeline',
          stage: 'post_processing',
        });
        throw e;
      }
      this.completeStage(task, 'post_processing');
      emitProgress('post_processing', 90, '后期完成');

      // 阶段 7-8: 字幕生成与烧录
      // 说明：assembleFinalVideo 内部已包含字幕生成与烧录逻辑
      // P2-6: 当 includeSubtitles=false 时合并跳过，避免进度条卡顿
      if (includeSubtitles) {
        this.startStage(task.id, 'generating_srt', '生成字幕', 91);
        this.completeStage(task, 'generating_srt');
        emitProgress('generating_srt', 92, '字幕就绪');
        this.completeStage(task, 'burning_subtitles');
        emitProgress('burning_subtitles', 95, '字幕烧录完成');
      } else {
        this.completeStage(task, 'generating_srt');
        this.completeStage(task, 'burning_subtitles');
        emitProgress('burning_subtitles', 95, '跳过字幕');
      }

      // 阶段 9: 完成
      // Phase 1 改造（EVOLUTION_DESIGN.md §5.1.8）：使用真实成片 URL
      if (finalCut) {
        const finalUrl = finalCut.videoStoragePath
          ?? (finalCut.videoBlob ? createTrackedObjectUrl(finalCut.videoBlob) : undefined)
          ?? finalCut.thumbnailUrl;
        this.markComplete(task.id, finalUrl ?? `pipeline-${task.id}-complete`);
        // 把 finalCutId 关联到 PipelineTask（便于 ExportCenter 反查）
        const t = this.tasks.get(task.id);
        if (t) {
          (t as PipelineTask & { finalCutId?: string }).finalCutId = finalCut.id;
          this.notify(t);
        }
      } else {
        this.markComplete(task.id, `pipeline-${task.id}-complete`);
      }

      return this.tasks.get(task.id)!;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.markFailed(task.id, errMsg);
      throw e;
    }
  }

  /**
   * 事件驱动回调：当某个 external video task 完成时由外部 emit
   */
  private handleVideoTaskCompleted(externalTaskId: string, videoUrl: string): void {
    void this.deps.videoTaskRepo.findBySegmentId('').then(async () => {
      // 找到对应的 VideoTask 并更新
      const allTasks = await this.deps.videoTaskRepo.findByStatuses(['PENDING', 'PROCESSING']);
      const target = allTasks.find(vt => vt.externalTaskId === externalTaskId);
      if (!target) return;

      target.status = 'SUCCESS';
      target.videoUrl = videoUrl;
      target.updatedAt = Date.now();
      await this.deps.videoTaskRepo.save(target);

      // 通知 pipeline 进度
      const pipelineTaskId = Array.from(this.pendingVideoTasks.entries())
        .find(([, ids]) => ids.has(externalTaskId))?.[0];
      if (pipelineTaskId) {
        this.logger.info('video task completed via event', {
          service: 'PipelineService',
          method: 'handleVideoTaskCompleted',
          pipelineTaskId,
          externalTaskId,
        });
      }
    });
  }

  /**
   * 事件驱动回调：当某个 external video task 失败时
   */
  private handleVideoTaskFailed(externalTaskId: string, error: string): void {
    this.logger.warn('video task failed via event', {
      service: 'PipelineService',
      method: 'handleVideoTaskFailed',
      externalTaskId,
      error,
    });
  }

  /**
   * 业务闭环核心：将故事分镜、视频、音频通过 FFmpeg 拼接为成片
   *
   * PRD §10：接入真实后期处理：
   * - 段间应用 fade 转场（offsetSec = 前段时长 - 0.5s）
   * - 旁白 / BGM 优先从 OPFS 读取（narrationAudioStoragePath / bgmStoragePath），降级到远程 URL
   * - 字幕：用 segment.content 作为字幕文本，按时序生成 SRT 并烧录
   * - 真实时长：累加各段视频时长（扣除转场重叠）
   */
  async assembleFinalVideo(
    storyId: string,
    narrationUrls: Record<string, string>,
    onProgress?: (progress: number, message: string) => void
  ): Promise<FinalCut> {
    const story = await this.deps.storyRepo.findById(storyId);
    if (!story) throw new Error('Story not found');

    const segments = await this.deps.segmentRepo.findByStoryId(storyId);
    segments.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    if (segments.length === 0) throw new Error('No segments found for this story');

    const TRANSITION_DUR_SEC = 0.5;
    const fileStorage = typeof this.deps.fileStorage === 'function' ? this.deps.fileStorage() : this.deps.fileStorage;

    // 收集每段的视频 Blob + 音频 Blob + 时长 + 字幕文本
    interface SegmentClip { video: Blob; audio?: Blob; durationSec: number; subtitleText: string; startSec: number; }
    const segmentClips: SegmentClip[] = [];
    let processedCount = 0;

    if (!this.deps.postProcess.isFFmpegLoaded()) {
      onProgress?.(5, '加载后期处理引擎...');
      await this.deps.postProcess.ensureLoaded();
    }

    for (const seg of segments) {
      const task = await this.deps.videoTaskRepo.findLatestBySegmentId(seg.id);
      if (!task || task.status !== 'SUCCESS' || !task.videoUrl) {
        throw new Error(`分镜 ${seg.sequenceOrder + 1} 的视频未生成`);
      }

      onProgress?.(10 + Math.round((processedCount / segments.length) * 30), `正在下载分镜 ${seg.sequenceOrder + 1} 视频...`);

      // 视频优先 OPFS，降级远程 URL
      let videoBlob: Blob;
      if (task.videoStoragePath) {
        const opfsBlob = await fileStorage.getBlob(task.videoStoragePath);
        if (opfsBlob) videoBlob = opfsBlob;
        else {
          const res = await fetch(task.videoUrl);
          videoBlob = await res.blob();
        }
      } else {
        const res = await fetch(task.videoUrl);
        videoBlob = await res.blob();
      }

      // 音频：旁白优先（narrationUrls 或 narrationAudioStoragePath），其次 BGM
      let audioBlob: Blob | undefined;
      const narrationUrl = narrationUrls[seg.id];
      if (narrationUrl) {
        try {
          const audioRes = await fetch(narrationUrl);
          audioBlob = await audioRes.blob();
        } catch (e) {
          this.logger.warn('narration fetch failed', {
            service: 'PipelineService', method: 'assembleFinalVideo',
            segmentId: seg.id, error: e instanceof Error ? e.message : String(e),
          });
        }
      } else if (seg.narrationAudioStoragePath) {
        audioBlob = await fileStorage.getBlob(seg.narrationAudioStoragePath) ?? undefined;
      }
      // BGM 作为辅助混音
      let bgmBlob: Blob | undefined;
      if (seg.bgmStoragePath) {
        bgmBlob = await fileStorage.getBlob(seg.bgmStoragePath) ?? undefined;
      } else if (seg.bgmAudioUrl) {
        try {
          const bgmRes = await fetch(seg.bgmAudioUrl);
          bgmBlob = await bgmRes.blob();
        } catch (e) {
          this.logger.warn('bgm fetch failed', {
            service: 'PipelineService', method: 'assembleFinalVideo',
            segmentId: seg.id, error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // 音频混音：旁白 + BGM
      let finalAudio: Blob | undefined;
      if (audioBlob && bgmBlob) {
        try {
          finalAudio = await this.deps.postProcess.mixBGM(audioBlob, bgmBlob, 0.3);
        } catch (e) {
          this.logger.warn('mixBGM failed, fallback to narration only', {
            service: 'PipelineService', method: 'assembleFinalVideo',
            segmentId: seg.id, error: e instanceof Error ? e.message : String(e),
          });
          finalAudio = audioBlob;
        }
      } else {
        finalAudio = audioBlob ?? bgmBlob;
      }

      // 视频 + 音频 merge
      let finalClip = videoBlob;
      if (finalAudio) {
        onProgress?.(10 + Math.round((processedCount / segments.length) * 30), `正在合并分镜 ${seg.sequenceOrder + 1} 音频...`);
        try {
          finalClip = await this.deps.postProcess.mergeVideoAudio(videoBlob, finalAudio);
        } catch (e) {
          this.logger.warn('audio merge failed', {
            service: 'PipelineService', method: 'assembleFinalVideo',
            segmentId: seg.id, error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      segmentClips.push({
        video: finalClip,
        durationSec: task.duration ?? 6,
        subtitleText: seg.content?.trim() ?? '',
        startSec: 0, // 后面计算
      });
      processedCount++;
    }

    // 段间应用 fade 转场，并累加真实时长
    onProgress?.(55, '正在应用段间转场...');
    let finalVideoBlob: Blob = segmentClips[0].video;
    let cursorSec = segmentClips[0].durationSec;
    segmentClips[0].startSec = 0;

    for (let i = 1; i < segmentClips.length; i++) {
      const prev = segmentClips[i - 1];
      const cur = segmentClips[i];
      // offset = 前段时长 - 转场时长（修复原 offset 硬编码 3s 的 bug）
      const offsetSec = Math.max(0, prev.durationSec - TRANSITION_DUR_SEC);
      try {
        finalVideoBlob = await this.deps.postProcess.applyTransition(
          finalVideoBlob, cur.video, 'fade', TRANSITION_DUR_SEC, offsetSec,
        );
      } catch (e) {
        this.logger.warn('transition failed, fallback to concat', {
          service: 'PipelineService', method: 'assembleFinalVideo',
          error: e instanceof Error ? e.message : String(e),
        });
        finalVideoBlob = await this.deps.postProcess.concatClips([finalVideoBlob, cur.video]);
      }
      // 转场重叠后实际推进 = 当前段时长 - 转场时长
      cur.startSec = cursorSec - TRANSITION_DUR_SEC;
      cursorSec = cur.startSec + cur.durationSec;
    }
    const realDurationSec = Math.max(1, cursorSec);

    // 烧录字幕（基于 segment.content + 时序）
    onProgress?.(75, '正在烧录字幕...');
    let hasSubtitles = false;
    const srt = this.buildSrtFromSegments(segmentClips);
    if (srt) {
      try {
        finalVideoBlob = await this.deps.postProcess.burnSubtitles(finalVideoBlob, srt);
        hasSubtitles = true;
      } catch (e) {
        this.logger.warn('burn subtitles failed', {
          service: 'PipelineService', method: 'assembleFinalVideo',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    onProgress?.(90, '正在生成最终成片...');

    const finalCutId = uuidv4();

    let thumbnailUrl = '';
    try {
      const firstFrameBlob = await this.deps.postProcess.extractFrame(finalVideoBlob, 0);
      // 缩略图 URL 会随 finalCut 返回给 UI 层,统一通过 ObjectUrlRegistry 追踪,
      // 由消费方在不再使用时释放(或页面卸载时兜底释放)。
      thumbnailUrl = createTrackedObjectUrl(firstFrameBlob);
    } catch (e) {
      this.logger.warn('thumbnail extract failed', {
        service: 'PipelineService',
        method: 'assembleFinalVideo',
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const finalCut: FinalCut = {
      id: finalCutId,
      storyId,
      pipelineTaskId: '',
      videoBlob: finalVideoBlob!,
      thumbnailUrl,
      duration: Math.round(realDurationSec * 1000),
      size: finalVideoBlob!.size,
      hasSubtitles,
      createdAt: Date.now(),
      // M2.4 统一成片路径：标记来源为 pipeline
      source: 'pipeline',
      sourcePlatform: this.deps.configStore.getActivePlatform(),
    };
    await this.deps.finalCutRepo.save(finalCut);

    onProgress?.(100, '成片完成');
    return finalCut;
  }

  /** 从分镜内容生成 SRT 字幕（按时序累加） */
  private buildSrtFromSegments(clips: Array<{ subtitleText: string; startSec: number; durationSec: number }>): string {
    const entries = clips
      .filter(c => c.subtitleText && c.subtitleText.trim())
      .map((c, i) => {
        const start = this.formatSrtTime(c.startSec);
        const end = this.formatSrtTime(c.startSec + c.durationSec);
        return `${i + 1}\n${start} --> ${end}\n${c.subtitleText}`;
      });
    return entries.join('\n\n');
  }

  private formatSrtTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  private async findCharacterForSegment(seg: StorySegment): Promise<Character | null> {
    if (!seg.mentionedCharacters || seg.mentionedCharacters.length === 0) return null;
    for (const charId of seg.mentionedCharacters) {
      const ch = await this.deps.characterRepo.findById(charId);
      if (ch?.voiceId) return ch;
    }
    return null;
  }

  /**
   * Phase 1 新增：AI 智能拆分故事（替代朴素 text.split 切分）
   * 优先调用 storyBreakdownPort.breakdownStory()
   * 失败时降级到原朴素切分（保持向后兼容）
   */
  private async splitStoryWithAI(
    story: { id: string; originalText: string; spaceId: string; title: string },
    emitProgress: (stage: PipelineStatus, percent: number, msg: string) => void,
  ): Promise<StorySegment[]> {
    // 优先尝试 AI 拆分
    if (this.deps.storyBreakdownPort) {
      try {
        emitProgress('splitting', 3, 'AI 分析故事结构与角色...');
        const breakdown = await this.deps.storyBreakdownPort.breakdownStory(story.originalText);

        // 自动创建/复用角色与背景，并保存分镜
        const segments: StorySegment[] = [];
        const existingCharacters = await this.deps.characterRepo.findBySpaceId(story.spaceId);
        const existingBackgrounds = await this.deps.backgroundRepo.findBySpaceId(story.spaceId);

        const charNameToId = new Map<string, string>(existingCharacters.map(c => [c.name, c.id]));
        const bgNameToId = new Map<string, string>(existingBackgrounds.map(b => [b.name, b.id]));

        // 创建缺失的角色
        for (const charDraft of breakdown.characters) {
          if (!charNameToId.has(charDraft.name)) {
            const newChar: Character = {
              id: uuidv4(),
              spaceId: story.spaceId,
              name: charDraft.name,
              appearancePrompt: charDraft.appearancePrompt,
              personalityPrompt: charDraft.personalityPrompt,
              characterBackground: charDraft.characterBackground,
              createdAt: Date.now(),
            };
            await this.deps.characterRepo.save(newChar);
            charNameToId.set(newChar.name, newChar.id);
          }
        }

        // 创建缺失的背景
        for (const bgDraft of breakdown.backgrounds) {
          if (!bgNameToId.has(bgDraft.name)) {
            const newBg: Background = {
              id: uuidv4(),
              spaceId: story.spaceId,
              name: bgDraft.name,
              environmentPrompt: bgDraft.environmentPrompt,
              createdAt: Date.now(),
            };
            await this.deps.backgroundRepo.save(newBg);
            bgNameToId.set(newBg.name, newBg.id);
          }
        }

        // 创建分镜，绑定角色与背景
        for (let i = 0; i < breakdown.segments.length; i++) {
          const draft = breakdown.segments[i];
          const mentionedCharIds = (draft.mentionedCharacterNames || [])
            .map(name => charNameToId.get(name))
            .filter((id): id is string => !!id);
          const selectedBgId = bgNameToId.get(draft.suggestedBackgroundName);
          const seg: StorySegment = {
            id: uuidv4(),
            storyId: story.id,
            sequenceOrder: i,
            content: draft.content,
            mentionedCharacters: mentionedCharIds,
            selectedBackgroundId: selectedBgId,
          };
          await this.deps.segmentRepo.save(seg);
          segments.push(seg);
        }

        emitProgress('splitting', 5, `AI 拆分完成：${segments.length} 段，${breakdown.characters.length} 角色，${breakdown.backgrounds.length} 场景`);
        return segments;
      } catch (e) {
        this.logger.warn('AI story breakdown failed, fallback to naive split', {
          service: 'PipelineService',
          method: 'splitStoryWithAI',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 降级：朴素文本切分（保持与原实现一致的兼容行为）
    this.logger.info('fallback to naive text split', {
      service: 'PipelineService',
      method: 'splitStoryWithAI',
    });
    const parts = story.originalText
      .split(/[。！？\n]/)
      .filter(s => s.trim().length > 5)
      .slice(0, 8); // Phase 1 调整：从 6 段放宽到 8 段
    const segments: StorySegment[] = [];
    for (let i = 0; i < parts.length; i++) {
      const seg: StorySegment = {
        id: uuidv4(),
        storyId: story.id,
        sequenceOrder: i,
        content: parts[i].trim(),
        mentionedCharacters: [],
      };
      await this.deps.segmentRepo.save(seg);
      segments.push(seg);
    }
    return segments;
  }

  /** 加载分镜涉及的角色列表 */
  private async loadSegmentCharacters(seg: StorySegment): Promise<Character[]> {
    const characters: Character[] = [];
    for (const charId of seg.mentionedCharacters || []) {
      const ch = await this.deps.characterRepo.findById(charId);
      if (ch) characters.push(ch);
    }
    return characters;
  }

  /** 加载分镜选定的背景 */
  private async loadSegmentBackground(seg: StorySegment): Promise<Background | undefined> {
    if (!seg.selectedBackgroundId) return undefined;
    const bg = await this.deps.backgroundRepo.findById(seg.selectedBackgroundId);
    return bg ?? undefined;
  }

  private async pollVideoTasks(
    taskId: string,
    videoTasks: VideoTask[],
    onProgress: (done: number, total: number) => void
  ): Promise<void> {
    const total = videoTasks.length;
    if (total === 0) {
      onProgress(0, 0);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const poller = setInterval(async () => {
        attempts++;
        try {
          let done = 0;
          for (const vt of videoTasks) {
            if (vt.status === 'SUCCESS' || vt.status === 'FAILED') {
              done++;
              continue;
            }
            if (!vt.externalTaskId) continue;
            const status = await this.getVideoPort().queryTaskStatus(vt.externalTaskId);
            if (status.status === 'SUCCESS') {
              vt.status = 'SUCCESS';
              vt.videoUrl = status.videoUrl;
              vt.fileId = status.fileId;
              vt.videoWidth = status.videoWidth;
              vt.videoHeight = status.videoHeight;
              vt.updatedAt = Date.now();
              await this.deps.videoTaskRepo.save(vt);

              // emit 事件（让其他订阅者也能感知）
              this.eventBus?.emit('video.task.completed', {
                type: 'video.task.completed' as const,
                taskId: vt.externalTaskId,
                videoUrl: status.videoUrl ?? '',
              });
              done++;
            } else if (status.status === 'FAILED') {
              vt.status = 'FAILED';
              vt.errorMessage = status.errorMessage;
              vt.updatedAt = Date.now();
              await this.deps.videoTaskRepo.save(vt);

              this.eventBus?.emit('video.task.failed', {
                type: 'video.task.failed' as const,
                taskId: vt.externalTaskId,
                error: status.errorMessage ?? 'Unknown error',
              });
              done++;
            }
          }
          onProgress(done, total);

          if (done === total) {
            clearInterval(poller);
            this.videoPollers.delete(taskId);
            resolve();
          } else if (attempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(poller);
            this.videoPollers.delete(taskId);
            reject(new Error(`Video generation timed out after ${attempts} attempts`));
          }
        } catch (e) {
          clearInterval(poller);
          this.videoPollers.delete(taskId);
          this.logger.error('video polling failed', e, {
            service: 'PipelineService',
            method: 'pollVideoTasks',
            taskId,
          });
          reject(e);
        }
      }, POLL_INTERVAL_MS);

      this.videoPollers.set(taskId, poller);
    });
  }
}