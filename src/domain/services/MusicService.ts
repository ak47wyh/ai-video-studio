import type { IMusicPort, IStorySegmentRepository, MusicGenerationContext, MusicModel, LyricsGenerationContext, LyricsGenerationResult, CoverPreprocessResult } from '../ports/OutboundPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter, IHttpFetchPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';

export class MusicService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  segmentRepo: IStorySegmentRepository;
  private getFileStorage: () => IFileStoragePort;
  private costMeter?: ICostMeter;
  /** P1-2：可选注入的 HTTP 抓取 Port */
  private httpFetch?: IHttpFetchPort;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    segmentRepo: IStorySegmentRepository,
    fileStorage: IFileStoragePort | (() => IFileStoragePort),
    logger: ILoggerPort,
    costMeter?: ICostMeter,
    httpFetch?: IHttpFetchPort,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.segmentRepo = segmentRepo;
    this.getFileStorage = typeof fileStorage === 'function' ? fileStorage : () => fileStorage;
    this.logger = logger;
    this.costMeter = costMeter;
    this.httpFetch = httpFetch;
  }

  /** 获取当前配置对应的音乐生成适配器 */
  private getMusicPort(): IMusicPort {
    return this.router.resolveMusic(this.configStore.load());
  }

  /**
   * 记录一次音乐调用到成本计量（P1-21）。
   * 音乐调用无 token 概念，仅记录调用次数。
   */
  private recordMusicCost(model: string): void {
    if (!this.costMeter) return;
    const config = this.configStore.load();
    this.costMeter.record({
      platform: config.activePlatform,
      model,
      callType: 'music',
    });
  }

  /**
   * Generate BGM for a segment and bind it.
   * Returns the audio URL.
   */
  async generateBGM(
    segmentId: string,
    prompt: string,
    options?: {
      isInstrumental?: boolean;
      lyrics?: string;
      lyricsOptimizer?: boolean;
      model?: MusicModel;
    }
  ): Promise<string> {
    const model = options?.model || 'music-2.6';
    const context: MusicGenerationContext = {
      prompt,
      lyrics: options?.lyrics,
      isInstrumental: options?.isInstrumental ?? true,
      lyricsOptimizer: options?.lyricsOptimizer,
      model,
      outputFormat: 'url',
      audioSetting: {
        sampleRate: 44100,
        bitrate: 256000,
        format: 'mp3',
      },
    };

    const result = await this.getMusicPort().generateMusic(context);
    this.recordMusicCost(model);

    if (!result.audioUrl) {
      throw new Error('Music generation completed but no audio URL returned');
    }

    // Bind to segment
    await this.bindBGMToSegment(
      segmentId,
      result.audioUrl,
      prompt,
      options?.lyrics,
      options?.isInstrumental ?? true
    );

    return result.audioUrl;
  }

  /**
   * Generate cover song BGM (two-step flow):
   * 1. Preprocess the reference audio to get cover_feature_id
   * 2. Generate cover music using the feature ID
   */
  async generateCoverBGM(
    segmentId: string,
    referenceAudioUrl: string,
    prompt: string,
    options?: {
      lyrics?: string;
      model?: MusicModel;
    }
  ): Promise<string> {
    const model = options?.model || 'music-cover';

    // Step 1: Preprocess reference audio
    const preprocessResult = await this.preprocessCover(referenceAudioUrl);

    // Step 2: Generate cover music with preprocessed feature
    const context: MusicGenerationContext = {
      prompt,
      lyrics: options?.lyrics || preprocessResult.formattedLyrics,
      model,
      outputFormat: 'url',
      coverFeatureId: preprocessResult.coverFeatureId,
      audioSetting: {
        sampleRate: 44100,
        bitrate: 256000,
        format: 'mp3',
      },
    };

    const result = await this.getMusicPort().generateMusic(context);
    this.recordMusicCost(model);

    if (!result.audioUrl) {
      throw new Error('Cover music generation completed but no audio URL returned');
    }

    // Bind to segment
    await this.bindBGMToSegment(
      segmentId,
      result.audioUrl,
      prompt,
      options?.lyrics || preprocessResult.formattedLyrics,
      false // Cover songs are not instrumental
    );

    return result.audioUrl;
  }

  /**
   * Generate lyrics based on a prompt.
   */
  async generateLyrics(prompt: string): Promise<LyricsGenerationResult> {
    const context: LyricsGenerationContext = {
      mode: 'write_full_song',
      prompt,
    };

    return this.getMusicPort().generateLyrics(context);
  }

  /**
   * Preprocess a reference audio for cover song generation.
   */
  async preprocessCover(audioUrl: string): Promise<CoverPreprocessResult> {
    return this.getMusicPort().preprocessCover(audioUrl);
  }

  /**
   * Bind a BGM audio URL to a segment.
   * 同时尝试下载音频 Blob 持久化到 OPFS（Phase 2-B），
   * 失败时保留 bgmAudioUrl 降级显示。
   */
  async bindBGMToSegment(
    segmentId: string,
    audioUrl: string,
    prompt: string,
    lyrics?: string,
    isInstrumental?: boolean
  ): Promise<void> {
    const segment = await this.segmentRepo.findById(segmentId);
    if (!segment) throw new Error('Segment not found');

    segment.bgmAudioUrl = audioUrl;
    segment.bgmPrompt = prompt;
    segment.bgmLyrics = lyrics;
    segment.bgmIsInstrumental = isInstrumental;

    // Phase 2-B：尝试下载音频并持久化到 OPFS
    if (!audioUrl.startsWith('mock://')) {
      try {
        // P1-2：优先走 IHttpFetchPort（自动 NetworkError/TimeoutError 归一化）
        const blob = this.httpFetch
          ? await this.httpFetch.fetchBlob(audioUrl)
          : await (async () => {
              const res = await fetch(audioUrl);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.blob();
            })();
        const storagePath = `audio/bgm_${segmentId}.mp3`;
        await this.getFileStorage().storeBlob(storagePath, blob);
        segment.bgmStoragePath = storagePath;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.warn(`Failed to cache BGM for segment ${segmentId}`, {
          service: 'MusicService',
          method: 'generateBGM',
          segmentId,
          error: err.message,
        });
      }
    }

    await this.segmentRepo.save(segment);
  }

  /**
   * 优先从本地缓存读取 BGM Blob URL，否则降级到外部 URL。
   * UI 层播放 BGM 时调用。
   */
  async getBGMPlaybackUrl(segment: { bgmAudioUrl?: string; bgmStoragePath?: string }): Promise<string | null> {
    if (segment.bgmStoragePath) {
      const fileStorage = this.getFileStorage();
      const exists = await fileStorage.blobExists(segment.bgmStoragePath);
      if (exists) {
        return fileStorage.getObjectUrl(segment.bgmStoragePath);
      }
    }
    return segment.bgmAudioUrl || null;
  }

  /**
   * Remove BGM from a segment.
   */
  async removeBGMFromSegment(segmentId: string): Promise<void> {
    const segment = await this.segmentRepo.findById(segmentId);
    if (!segment) return;

    segment.bgmAudioUrl = undefined;
    segment.bgmPrompt = undefined;
    segment.bgmLyrics = undefined;
    segment.bgmIsInstrumental = undefined;

    await this.segmentRepo.save(segment);
  }
}
