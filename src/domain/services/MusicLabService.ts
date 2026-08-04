import type {
  IMusicPort,
  MusicGenerationContext,
  MusicGenerationResult,
  LyricsGenerationContext,
  LyricsGenerationResult,
  CoverPreprocessResult,
} from '../ports/OutboundPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort, IHttpFetchPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';

export interface ResolvedMusicResult {
  audioUrl: string;
  /** OPFS 存储路径（Phase 2-A 持久化），刷新后可用 restoreFromStorage() 恢复 */
  storagePath?: string;
  duration: number;
  sampleRate: number;
  bitrate: number;
  channel: number;
  size: number;
}

/**
 * 独立音乐实验室服务，仅注入 IMusicPort + IFileStoragePort。
 * 负责 hex → Blob URL 转换，并将生成的音频持久化到 OPFS（Phase 2-A），
 * 避免页面刷新后音乐丢失。
 *
 * Phase 2 反转：依赖注入 IApiConfigStore + ILoggerPort，移除对
 * ApiConfigStore 单例和 defaultLogger 的硬编码引用。
 */
export class MusicLabService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  private getFileStorage: () => IFileStoragePort;
  /** HTTP 抓取 Port */
  private httpFetch: IHttpFetchPort;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    fileStorage: IFileStoragePort | (() => IFileStoragePort),
    logger: ILoggerPort,
    httpFetch: IHttpFetchPort,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.logger = logger;
    this.getFileStorage = typeof fileStorage === 'function' ? fileStorage : () => fileStorage;
    this.httpFetch = httpFetch;
  }

  /** 获取当前配置对应的音乐生成适配器 */
  private getMusicPort(): IMusicPort {
    return this.router.resolveMusic(this.configStore.load());
  }

  /**
   * 生成音乐 — 返回可播放的 Blob URL 与 OPFS 存储路径。
   * 数据流：hex/URL → Blob → OPFS(audio/music_{id}.mp3) → Object URL
   */
  async generateMusic(context: MusicGenerationContext): Promise<ResolvedMusicResult> {
    const result: MusicGenerationResult = await this.getMusicPort().generateMusic({
      ...context,
      outputFormat: 'hex',
    });

    const audioBlob = await this.resultToAudioBlob(result);
    const id = `music_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const storagePath = `audio/${id}.mp3`;

    try {
      await this.getFileStorage().storeBlob(storagePath, audioBlob);
    } catch (e) {
      this.logger.warn('Failed to persist music to OPFS, falling back to in-memory Blob URL', {
        service: 'MusicLabService',
        method: 'generateMusic',
        storagePath,
        error: e instanceof Error ? e.message : String(e),
      });
      const audioUrl = URL.createObjectURL(audioBlob);
      return this.buildResult(audioUrl, undefined, result);
    }

    const audioUrl = await this.getFileStorage().getObjectUrl(storagePath);
    return this.buildResult(audioUrl, storagePath, result);
  }

  /** 歌词生成 */
  async generateLyrics(context: LyricsGenerationContext): Promise<LyricsGenerationResult> {
    return this.getMusicPort().generateLyrics(context);
  }

  /** 翻唱前处理 */
  async preprocessCover(audioUrl: string): Promise<CoverPreprocessResult> {
    return this.getMusicPort().preprocessCover(audioUrl);
  }

  /**
   * 翻唱生成 — 复用 generateMusic，传入 cover_feature_id
   */
  async generateCover(params: {
    coverFeatureId: string;
    lyrics: string;
    prompt: string;
    model?: 'music-cover' | 'music-cover-free';
    audioSetting?: MusicGenerationContext['audioSetting'];
  }): Promise<ResolvedMusicResult> {
    return this.generateMusic({
      model: params.model || 'music-cover',
      prompt: params.prompt,
      lyrics: params.lyrics,
      coverFeatureId: params.coverFeatureId,
      outputFormat: 'hex',
      audioSetting: params.audioSetting,
    });
  }

  /** 下载音乐文件 */
  downloadMusic(blobUrl: string, filename: string): void {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * 从已持久化的存储路径恢复 Object URL。
   * UI 层在页面挂载时调用，恢复刷新前生成的音乐。
   */
  async restoreFromStorage(storagePath: string): Promise<string | null> {
    const fileStorage = this.getFileStorage();
    const exists = await fileStorage.blobExists(storagePath);
    if (!exists) return null;
    return fileStorage.getObjectUrl(storagePath);
  }

  /** 删除已持久化的音乐文件 */
  async deleteFromStorage(storagePath: string): Promise<void> {
    await this.getFileStorage().deleteBlob(storagePath);
  }

  // ===== Private helpers =====

  private buildResult(audioUrl: string, storagePath: string | undefined, result: MusicGenerationResult): ResolvedMusicResult {
    return {
      audioUrl,
      storagePath,
      duration: result.duration || 0,
      sampleRate: result.sampleRate || 44100,
      bitrate: result.bitrate || 256000,
      channel: result.channel || 2,
      size: result.size || 0,
    };
  }

  /** MusicGenerationResult → 音频 Blob */
  private async resultToAudioBlob(result: MusicGenerationResult): Promise<Blob> {
    if (result.audioHex) {
      return this.hexToAudioBlob(result.audioHex);
    }
    if (result.audioUrl) {
      return this.httpFetch.fetchBlob(result.audioUrl);
    }
    throw new Error('音频生成失败：未返回音频数据');
  }

  /** hex 编码音频转 Blob */
  private hexToAudioBlob(hex: string): Blob {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return new Blob([bytes], { type: 'audio/mpeg' });
  }
}
