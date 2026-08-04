import { v4 as uuidv4 } from 'uuid';
import type { VideoTask } from '../entities/models';
import type {
  IVideoTaskRepository,
  IVideoGeneratorPort,
  IStorySegmentRepository,
  ICharacterRepository,
  IBackgroundRepository,
  VideoPromptContext,
  VideoGenerationMode,
  VideoModel,
  VideoResolution
} from '../ports/OutboundPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';
import type { PlatformId } from '../entities/platform';
import type { IHttpFetchPort } from '../ports/CrossCuttingPorts';
import { TimeoutError } from '../errors';

/**
 * 领域层错误消息提取工具（原从 ui/utils/errorUtils 引入，违反依赖方向）。
 * 保持与 UI 层同名同签名，避免调用方修改。
 */
function getErrorMessage(e: unknown, fallback = 'Unknown error'): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}

export interface VideoGenerationOptions {
  mode?: VideoGenerationMode;
  model?: VideoModel;
  resolution?: VideoResolution;
  duration?: 6 | 10;
  promptOptimizer?: boolean;
  firstFrameImage?: string;
  lastFrameImage?: string;
  /** 是否启用模型自动生成音频（火山引擎 Seedance 2.0 系列，与参考音频互斥） */
  generateAudio?: boolean;
}

/**
 * VideoGenerationService
 * - Phase 2 反转：依赖注入 IApiConfigStore + ILoggerPort，移除对
 *   ApiConfigStore 单例和 defaultLogger 的硬编码引用。
 * - P1-21：注入 ICostMeter 记录视频调用成本。
 */
export class VideoGenerationService {
  private videoTaskRepo: IVideoTaskRepository;
  private segmentRepo: IStorySegmentRepository;
  private characterRepo: ICharacterRepository;
  private backgroundRepo: IBackgroundRepository;
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  private getFileStorage: () => IFileStoragePort;
  private costMeter?: ICostMeter;
  /** HTTP 抓取 Port */
  private httpFetch: IHttpFetchPort;

  private activePollers = new Map<string, AbortController>();

  constructor(
    videoTaskRepo: IVideoTaskRepository,
    segmentRepo: IStorySegmentRepository,
    characterRepo: ICharacterRepository,
    backgroundRepo: IBackgroundRepository,
    router: PlatformRouter,
    fileStorage: IFileStoragePort | (() => IFileStoragePort),
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    httpFetch: IHttpFetchPort,
    costMeter?: ICostMeter,
  ) {
    this.videoTaskRepo = videoTaskRepo;
    this.segmentRepo = segmentRepo;
    this.characterRepo = characterRepo;
    this.backgroundRepo = backgroundRepo;
    this.router = router;
    this.getFileStorage = typeof fileStorage === 'function' ? fileStorage : () => fileStorage;
    this.configStore = configStore;
    this.logger = logger;
    this.costMeter = costMeter;
    this.httpFetch = httpFetch;
  }

  /** 获取当前配置对应的视频生成适配器 */
  private getVideoPort(): IVideoGeneratorPort {
    const config = this.configStore.load();
    return this.router.resolve('video', config);
  }

  /**
   * 记录一次视频调用到成本计量（P1-21）。
   * 视频调用无 token 概念，仅记录调用次数。
   */
  private recordVideoCost(model: string, platform: PlatformId): void {
    if (!this.costMeter) return;
    this.costMeter.record({
      platform,
      model,
      callType: 'video',
    });
  }

  /** 公开访问器（供 UI 轮询 hook 使用） */
  get videoGeneratorPort(): IVideoGeneratorPort {
    return this.getVideoPort();
  }

  async generateVideo(
    segmentId: string,
    storyId: string,
    targetPlatform?: PlatformId,
    options?: VideoGenerationOptions
  ): Promise<VideoTask> {
    // P1 修复：默认从 configStore 读取激活平台（原硬编码 'MINIMAX'）
    const platform = targetPlatform ?? this.configStore.load().activePlatform;
    const segments = await this.segmentRepo.findByStoryId(storyId);
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) throw new Error('Segment not found');
    if (!segment.selectedBackgroundId && !options?.firstFrameImage) {
      throw new Error('Please select a background for this segment before generating video');
    }

    const mode = options?.mode || 't2v';

    const task: VideoTask = {
      id: uuidv4(),
      segmentId,
      targetPlatform: platform,
      status: 'PENDING',
      createdAt: Date.now(),
      mode,
      model: options?.model,
      resolution: options?.resolution,
      duration: options?.duration,
      promptOptimizer: options?.promptOptimizer,
      firstFrameImage: options?.firstFrameImage,
      lastFrameImage: options?.lastFrameImage,
    };
    await this.videoTaskRepo.save(task);

    // Build Context
    const characters = [];
    for (const charId of segment.mentionedCharacters) {
      const char = await this.characterRepo.findById(charId);
      if (char) characters.push(char);
    }

    let background = undefined;
    if (segment.selectedBackgroundId) {
      const bg = await this.backgroundRepo.findById(segment.selectedBackgroundId);
      if (bg) background = bg;
    }

    const characterVoiceIds: Record<string, string> = {};
    for (const char of characters) {
      if (char.voiceId) {
        characterVoiceIds[char.name] = char.voiceId;
      }
    }

    // Build subject reference for S2V mode
    let subjectReference;
    if (mode === 's2v') {
      const charImages = characters
        .filter(c => c.referenceImageUrl)
        .map(c => c.referenceImageUrl!);
      if (charImages.length > 0) {
        subjectReference = [{ type: 'character', image: charImages }];
      }
    }

    // 收集角色参考音频 URL（用于视频生成时音色继承，火山引擎 Seedance 2.0 系列）
    const referenceAudioUrls = characters
      .map(c => c.referenceAudioUrl)
      .filter((url): url is string => !!url && url.length > 0);

    // Build prompt
    const promptParts: string[] = [];
    if (characters.length > 0) {
      const charDescs = characters.map(c => {
        let desc = c.appearancePrompt;
        if (c.personalityPrompt) desc += `, ${c.personalityPrompt}`;
        return desc;
      });
      promptParts.push(charDescs.join(' and '));
    }
    if (background) {
      promptParts.push(`in ${background.environmentPrompt}`);
    }
    promptParts.push(segment.content);
    const prompt = promptParts.join(', ') + '.';

    const context: VideoPromptContext = {
      mode,
      model: options?.model,
      prompt,
      promptOptimizer: options?.promptOptimizer,
      duration: options?.duration,
      resolution: options?.resolution,
      // FL2V fields
      firstFrameImage: options?.firstFrameImage,
      lastFrameImage: options?.lastFrameImage,
      // S2V fields
      subjectReference,
      // Voice and BGM
      characterVoiceIds: Object.keys(characterVoiceIds).length > 0 ? characterVoiceIds : undefined,
      bgmAudioUrl: segment.bgmAudioUrl,
      // 参考音频（人物音色，火山引擎 Seedance 2.0 系列）
      referenceAudioUrls: referenceAudioUrls.length > 0 ? referenceAudioUrls : undefined,
      generateAudio: options?.generateAudio,
      // Legacy fields for backward compatibility
      actionContent: segment.content,
      characters,
      background,
    };

    this.processTask(task, context).catch(err => 
      this.logger.error('processTask failed', err instanceof Error ? err : new Error(String(err)))
    );

    return task;
  }

  async getLatestTaskForSegment(segmentId: string): Promise<VideoTask | null> {
    return this.videoTaskRepo.findLatestBySegmentId(segmentId);
  }

  /** Resume polling for all active (PENDING/PROCESSING) tasks after page reload */
  async resumeActivePolling(): Promise<void> {
    const allTasks = await this.videoTaskRepo.findByStatuses(['PENDING', 'PROCESSING']);
    for (const task of allTasks) {
      if (task.externalTaskId && !this.activePollers.has(task.id)) {
        this.pollTaskStatus(task.id, task.externalTaskId);
      }
    }
    // 刷新后回填已完成但未缓存的视频（Phase 2-B）
    const successTasks = await this.videoTaskRepo.findByStatuses(['SUCCESS']);
    for (const task of successTasks) {
      if (task.videoUrl && !task.videoStoragePath) {
        this.cacheVideoInBackground(task);
      }
    }
  }

  /** Cancel all active polling intervals (call on app teardown) */
  cancelAllPolling(): void {
    for (const [taskId, controller] of this.activePollers) {
      controller.abort();
      this.activePollers.delete(taskId);
    }
  }

  /**
   * V2 P0-4.4.1：显式全局销毁入口。
   *
   * SPA 路由切换或页面 beforeunload 时调用，遍历清理所有 activePollers。
   * 相较 cancelAllPolling 语义更明确（应用生命周期终点，而非仅"暂停轮询"），
   * 供 dependencies.ts 或 App 顶层统一挂载 beforeunload 事件消费。
   */
  destroy(): void {
    this.cancelAllPolling();
  }

  /**
   * P1-8：判断某个 taskId 是否已经被 Service 侧的轮询器追踪。
   *
   * 用于 UI 层 `useVideoTaskPolling` 消除双轮询：UI Hook 检测到某任务已在
   * Service 侧 activePollers 中时跳过独立的 queryTaskStatus 请求，仅从
   * `videoTaskRepo`（由 Service 在 poller 内 updateStatus）派生的响应式数据
   * 中读取最新状态即可。
   */
  isPollingActive(taskId: string): boolean {
    return this.activePollers.has(taskId);
  }

  private async processTask(task: VideoTask, context: VideoPromptContext) {
    try {
      await this.videoTaskRepo.updateStatus(task.id, 'PROCESSING');
      const videoPort = this.getVideoPort();
      const externalTaskId = await videoPort.submitVideoTask(context);
      // P1-21：记录视频调用成本（按任务创建时的目标平台）
      this.recordVideoCost(task.model || 'video-default', task.targetPlatform);

      task.externalTaskId = externalTaskId;
      await this.videoTaskRepo.save(task);

      this.pollTaskStatus(task.id, externalTaskId);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Submit failed');
      await this.videoTaskRepo.updateStatus(task.id, 'FAILED', undefined, message);
    }
  }

  private pollTaskStatus(taskId: string, externalTaskId: string) {
    const existing = this.activePollers.get(taskId);
    if (existing) existing.abort();

    const abortController = new AbortController();
    this.activePollers.set(taskId, abortController);

    const pollInterval = 3000;
    const maxRetries = 60;
    let retries = 0;

    const poll = async () => {
      if (abortController.signal.aborted) return;

      try {
        retries++;
        const videoPort = this.getVideoPort();
        const result = await videoPort.queryTaskStatus(externalTaskId);

        if (result.status === 'SUCCESS' || result.status === 'FAILED') {
          this.activePollers.delete(taskId);
          await this.videoTaskRepo.updateStatus(taskId, result.status, result.videoUrl, result.errorMessage);
          if (result.status === 'SUCCESS' && result.videoUrl) {
            const candidates = await this.videoTaskRepo.findByStatuses(['SUCCESS']);
            const fresh = candidates.find(t => t.id === taskId);
            if (fresh && !fresh.videoStoragePath) {
              this.cacheVideoInBackground(fresh);
            }
          }
          return;
        }

        if (retries >= maxRetries) {
          this.activePollers.delete(taskId);
          const timeoutErr = new TimeoutError({
            message: 'Polling timeout',
            context: { taskId, externalTaskId, retries, pollIntervalMs: pollInterval },
          });
          await this.videoTaskRepo.updateStatus(taskId, 'FAILED', undefined, timeoutErr.message);
          return;
        }

        setTimeout(poll, pollInterval);
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Poll failed');
        this.activePollers.delete(taskId);
        await this.videoTaskRepo.updateStatus(taskId, 'FAILED', undefined, message);
      }
    };

    setTimeout(poll, 0);
  }

  /**
   * 后台缓存视频到 OPFS（Phase 2-B）。
   * - 不阻塞 UI，失败时保留 videoUrl 降级显示
   * - 文件大小超过 200MB 时跳过，避免占用过多 OPFS 配额
   */
  private cacheVideoInBackground(task: VideoTask): void {
    if (!task.videoUrl || task.videoStoragePath) return;

    const storagePath = `video/${task.id}.mp4`;

    (async () => {
      try {
        const blob = await this.httpFetch.fetchBlob(task.videoUrl!);
        if (blob.size > 200 * 1024 * 1024) {
          this.logger.warn(`Video too large (${blob.size} bytes), skip caching`, { service: 'VideoGenerationService' });
          return;
        }
        await this.getFileStorage().storeBlob(storagePath, blob);
        task.videoStoragePath = storagePath;
        await this.videoTaskRepo.save(task);
      } catch (e) {
        this.logger.warn(`Failed to cache video ${task.id}`, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  }

  /**
   * 优先从本地缓存读取视频 Blob URL，否则降级到外部 URL。
   * UI 层播放视频时调用。
   */
  async getVideoPlaybackUrl(task: VideoTask): Promise<string> {
    if (task.videoStoragePath) {
      const fileStorage = this.getFileStorage();
      const exists = await fileStorage.blobExists(task.videoStoragePath);
      if (exists) {
        return fileStorage.getObjectUrl(task.videoStoragePath);
      }
    }
    return task.videoUrl || '';
  }
}