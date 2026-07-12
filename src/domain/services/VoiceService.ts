import type { IVoicePort, T2AAsyncContext, T2AAsyncStatus, T2ASyncContext, T2ASyncModel, T2ASyncResult, T2AStreamCallbacks, T2AStreamHandle, VoiceDesignResult, VoiceType, VoiceListResult } from '../ports/OutboundPorts';
import type { ICharacterRepository, IStorySegmentRepository } from '../ports/OutboundPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter, IHttpFetchPort } from '../ports/CrossCuttingPorts';
import type { StorySegment } from '../entities/models';
import type { ISavedVoiceRepository } from '../ports/AssetLibraryPorts';
import type { PlatformRouter } from './PlatformRouter';

/** Max text length for synchronous T2A (short text = instant response) */
const SYNC_T2A_MAX_LENGTH = 500;

/** Clone voice options */
export interface CloneVoiceOptions {
  needNoiseReduction?: boolean;
  needVolumeNormalization?: boolean;
  languageBoost?: string;
  model?: string;
  aigcWatermark?: boolean;
}

/**
 * VoiceService
 * - Phase 2 反转：依赖注入 IApiConfigStore + ILoggerPort，移除对
 *   ApiConfigStore 单例和 defaultLogger 的硬编码引用。
 * - P1-21：注入 ICostMeter 记录语音调用成本。
 */
export class VoiceService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  characterRepo: ICharacterRepository;
  segmentRepo: IStorySegmentRepository;
  private getFileStorage: () => IFileStoragePort;
  private costMeter?: ICostMeter;
  private savedVoiceRepo?: ISavedVoiceRepository;
  /** P1-2：可选注入的 HTTP 抓取 Port（用于 blob:/http 音频统一读取） */
  private httpFetch?: IHttpFetchPort;

  constructor(
    router: PlatformRouter,
    characterRepo: ICharacterRepository,
    segmentRepo: IStorySegmentRepository,
    fileStorage: IFileStoragePort | (() => IFileStoragePort),
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    costMeter?: ICostMeter,
    savedVoiceRepo?: ISavedVoiceRepository,
    httpFetch?: IHttpFetchPort,
  ) {
    this.router = router;
    this.characterRepo = characterRepo;
    this.segmentRepo = segmentRepo;
    this.getFileStorage = typeof fileStorage === 'function' ? fileStorage : () => fileStorage;
    this.configStore = configStore;
    this.logger = logger;
    this.costMeter = costMeter;
    this.savedVoiceRepo = savedVoiceRepo;
    this.httpFetch = httpFetch;
  }

  /** 获取当前配置对应的语音合成适配器 */
  private getVoicePort(): IVoicePort {
    return this.router.resolveVoice(this.configStore.load());
  }

  /**
   * 查询当前激活平台的语音子能力声明。
   * UI 层（VoiceLab）据此动态置灰不支持的 Tab，避免用户点击后才发现不支持。
   * 失败时返回全 false 的降级值，保证 UI 不中断。
   */
  async getVoiceCapabilities(): Promise<import('../ports/OutboundPorts').VoiceCapabilities> {
    try {
      return this.getVoicePort().voiceCapabilities;
    } catch {
      return { supportsClone: false, supportsDesign: false, supportsDelete: false, supportsStream: false };
    }
  }

  /**
   * 按平台解析默认 TTS 模型，避免硬编码 MiniMax 模型名导致火山引擎激活时无效。
   * - volcengine: doubao-tts-base（同步）/ doubao-tts-pro（异步）
   * - 其他平台: speech-2.8-turbo / speech-2.8-hd（MiniMax 命名）
   */
  private resolveDefaultModel(scenario: 'sync' | 'async'): T2ASyncModel {
    const platform = this.configStore.getActivePlatform();
    if (platform === 'volcengine') {
      return scenario === 'async' ? 'doubao-tts-pro' : 'doubao-tts-base';
    }
    return scenario === 'async' ? 'speech-2.8-hd' : 'speech-2.8-turbo';
  }

  /**
   * 记录一次语音调用到成本计量（P1-21）。
   * 语音调用无 token 概念，仅记录调用次数。
   */
  private recordVoiceCost(model: string): void {
    if (!this.costMeter) return;
    const config = this.configStore.load();
    this.costMeter.record({
      platform: config.activePlatform,
      model,
      callType: 'voice',
    });
  }

  /**
   * Clone a voice from an audio file and bind it to an existing character.
   */
  async cloneVoiceForCharacter(
    characterId: string,
    audioFile: File,
    customVoiceId: string,
    text?: string,
    promptAudioFile?: File,
    promptText?: string,
    options?: CloneVoiceOptions
  ): Promise<string> {
    const character = await this.characterRepo.findById(characterId);
    if (!character) throw new Error('Character not found');

    const voiceId = await this.cloneVoice(
      audioFile,
      customVoiceId,
      text || character.personalityPrompt || character.appearancePrompt || '你好，我是' + character.name,
      promptAudioFile,
      promptText,
      options
    );

    character.voiceId = voiceId;
    await this.characterRepo.save(character);

    return voiceId;
  }

  /**
   * Clone a voice from an audio file without binding to a character.
   */
  async cloneVoice(
    audioFile: File,
    customVoiceId: string,
    text?: string,
    promptAudioFile?: File,
    promptText?: string,
    options?: CloneVoiceOptions
  ): Promise<string> {
    const { fileId } = await this.getVoicePort().uploadFile(audioFile, 'voice_clone');

    let promptAudioFileId: string | undefined;
    if (promptAudioFile) {
      const result = await this.getVoicePort().uploadFile(promptAudioFile, 'prompt_audio');
      promptAudioFileId = result.fileId;
    }

    const cloneResult = await this.getVoicePort().cloneVoice({
      fileId,
      voiceId: customVoiceId,
      text,
      promptAudioFileId,
      promptText,
      ...options,
    });

    // 风控检测
    if (cloneResult.inputSensitive) {
      this.logger.warn('[VoiceService] Cloned audio triggered content moderation', { service: 'VoiceService' });
    }

    return cloneResult.voiceId;
  }

  /**
   * Bind a voiceId to an existing character.
   */
  async bindVoiceToCharacter(characterId: string, voiceId: string): Promise<void> {
    const character = await this.characterRepo.findById(characterId);
    if (!character) throw new Error('Character not found');
    character.voiceId = voiceId;
    await this.characterRepo.save(character);
  }

  async setSystemVoiceForCharacter(characterId: string, voiceId: string): Promise<void> {
    const character = await this.characterRepo.findById(characterId);
    if (!character) throw new Error('Character not found');

    character.voiceId = voiceId;
    await this.characterRepo.save(character);
  }

  /**
   * Smart narration generation: short text uses sync T2A (instant),
   * long text uses async T2A (polling required).
   */
  async generateNarrationAudio(text: string, voiceId: string): Promise<{ taskId?: string; audioUrl?: string }> {
    if (text.length <= SYNC_T2A_MAX_LENGTH) {
      const result = await this.synthesizeSync(text, voiceId);
      return { audioUrl: result.audioUrl };
    }

    const taskId = await this.createAsyncTask(text, voiceId);
    return { taskId };
  }

  /**
   * Synchronous T2A — instant response, best for short text (≤500 chars).
   */
  async synthesizeSync(
    text: string,
    voiceId: string,
    model?: T2ASyncContext['model'],
    options?: Partial<Omit<T2ASyncContext, 'text' | 'voiceId' | 'model'>>
  ): Promise<T2ASyncResult> {
    const context: T2ASyncContext = {
      model: model || this.resolveDefaultModel('sync'),
      text,
      voiceId,
      speed: options?.speed ?? 1,
      volume: options?.volume ?? 1,
      audioFormat: options?.audioFormat || 'mp3',
      sampleRate: options?.sampleRate ?? 32000,
      outputFormat: options?.outputFormat || 'url',
      languageBoost: options?.languageBoost || 'auto',
      ...options,
    };

    const result = await this.getVoicePort().synthesizeSpeechSync(context);
    this.recordVoiceCost(context.model ?? this.resolveDefaultModel('sync'));
    return result;
  }

  /**
   * WebSocket 流式 T2A — 边生成边播放，最佳实时体验。
   */
  synthesizeStream(
    text: string,
    voiceId: string,
    callbacks: T2AStreamCallbacks,
    options?: Partial<Omit<T2ASyncContext, 'text' | 'voiceId'>>
  ): T2AStreamHandle {
    const context: T2ASyncContext = {
      model: options?.model || this.resolveDefaultModel('sync'),
      text,
      voiceId,
      speed: options?.speed ?? 1,
      volume: options?.volume ?? 1,
      audioFormat: options?.audioFormat || 'mp3',
      sampleRate: options?.sampleRate ?? 32000,
      stream: true,
      outputFormat: options?.outputFormat || 'hex',
      languageBoost: options?.languageBoost || 'auto',
      ...options,
    };
    return this.getVoicePort().synthesizeSpeechStream(context, callbacks);
  }

  /**
   * Async T2A — create task, then poll for result.
   */
  async createAsyncTask(
    text: string,
    voiceId: string,
    options?: Partial<Omit<T2AAsyncContext, 'text' | 'voiceId'>>
  ): Promise<string> {
    const context: T2AAsyncContext = {
      text,
      voiceId,
      model: options?.model || this.resolveDefaultModel('async'),
      speed: options?.speed ?? 1,
      audioFormat: options?.audioFormat || 'mp3',
      sampleRate: options?.sampleRate ?? 32000,
      ...options,
    };

    const result = await this.getVoicePort().createT2ATask(context);
    this.recordVoiceCost(context.model ?? this.resolveDefaultModel('async'));
    return result.taskId;
  }

  /**
   * 从文件创建异步 T2A 任务
   */
  async createAsyncTaskFromFile(
    fileId: string,
    voiceId: string,
    options?: Partial<Omit<T2AAsyncContext, 'textFileId' | 'voiceId'>>
  ): Promise<string> {
    const context: T2AAsyncContext = {
      textFileId: fileId,
      voiceId,
      model: options?.model || this.resolveDefaultModel('async'),
      speed: options?.speed ?? 1,
      audioFormat: options?.audioFormat || 'mp3',
      sampleRate: options?.sampleRate ?? 32000,
      ...options,
    };

    const result = await this.getVoicePort().createT2ATask(context);
    return result.taskId;
  }

  async queryNarrationStatus(taskId: string): Promise<T2AAsyncStatus> {
    return this.getVoicePort().queryT2ATask(taskId);
  }

  /**
   * Design a new voice using text description.
   */
  async designVoice(prompt: string, previewText: string, voiceId?: string, aigcWatermark?: boolean): Promise<VoiceDesignResult> {
    return this.getVoicePort().designVoice(prompt, previewText, voiceId, aigcWatermark);
  }

  /**
   * Design a voice and bind it to a character.
   */
  async designVoiceForCharacter(characterId: string, prompt: string, previewText: string): Promise<string> {
    const character = await this.characterRepo.findById(characterId);
    if (!character) throw new Error('Character not found');

    const voiceId = `design_${Date.now()}`;
    const result = await this.getVoicePort().designVoice(prompt, previewText, voiceId);

    character.voiceId = result.voiceId;
    await this.characterRepo.save(character);

    return result.voiceId;
  }

  /**
   * 激活克隆/设计音色（用该音色调用一次 T2A）
   */
  async activateVoice(voiceId: string): Promise<void> {
    await this.synthesizeSync('音色激活测试', voiceId, this.resolveDefaultModel('sync'));
  }

  /**
   * 试听音色（使用指定音色合成短文本）
   * 返回可直接播放的 Blob URL
   */
  async previewVoice(voiceId: string, text?: string): Promise<string> {
    const previewText = text || '这是一段试听文本，用于展示该音色的效果。';
    const result = await this.synthesizeSync(previewText, voiceId);
    return this.resolveAudioUrl(result);
  }

  /**
   * 将 T2ASyncResult 解析为可播放的 Blob URL（不持久化，仅临时播放）
   * - 如果返回的是 hex 编码，直接转 Blob URL
   * - 如果返回的是 URL，通过 fetchAudioAsBlobUrl 带 auth 下载后转 Blob URL
   */
  async resolveAudioUrl(result: T2ASyncResult): Promise<string> {
    if (result.audioHex) {
      return this.hexToBlobUrl(result.audioHex);
    }
    if (result.audioUrl) {
      return this.getVoicePort().fetchAudioAsBlobUrl(result.audioUrl);
    }
    throw new Error('未返回音频数据');
  }

  /**
   * 为分镜生成旁白并持久化到 OPFS（Phase 2-A）。
   *
   * 数据流：
   *   1. 同步合成音频
   *   2. hex/URL → Blob
   *   3. 写入 OPFS：audio/narration_{segmentId}.mp3
   *   4. 写入 segment.narrationAudioStoragePath
   *   5. segmentRepo.save 持久化元数据
   *   6. 返回 Object URL 供当前会话播放
   *
   * 刷新后组件可从 segment.narrationAudioStoragePath 通过 getNarrationAudioUrl() 恢复。
   */
  async generateAndPersistNarration(segmentId: string, text: string, voiceId: string): Promise<string> {
    const segment = await this.segmentRepo.findById(segmentId);
    if (!segment) throw new Error('Segment not found');

    const result = await this.synthesizeSync(text, voiceId);
    const blob = await this.resultToAudioBlob(result);

    const storagePath = `audio/narration_${segmentId}.mp3`;
    await this.getFileStorage().storeBlob(storagePath, blob);

    segment.narrationAudioStoragePath = storagePath;
    await this.segmentRepo.save(segment);

    return this.getFileStorage().getObjectUrl(storagePath);
  }

  /**
   * 异步版：创建长文异步任务，轮询完成后持久化（Phase 2-A）。
   */
  async generateAndPersistNarrationAsync(
    segmentId: string,
    text: string,
    voiceId: string,
    onProgress?: (status: T2AAsyncStatus) => void,
  ): Promise<string> {
    const segment = await this.segmentRepo.findById(segmentId);
    if (!segment) throw new Error('Segment not found');

    if (text.length <= SYNC_T2A_MAX_LENGTH) {
      return this.generateAndPersistNarration(segmentId, text, voiceId);
    }

    const taskId = await this.createAsyncTask(text, voiceId);

    let status: T2AAsyncStatus;
    do {
      await new Promise(r => setTimeout(r, 3000));
      status = await this.queryNarrationStatus(taskId);
      onProgress?.(status);
    } while (status.status === 'processing');

    if (status.status !== 'success' || !status.audioUrl) {
      throw new Error(status.errorMessage || '异步 T2A 任务失败');
    }

    const audioBlobUrl = await this.getVoicePort().fetchAudioAsBlobUrl(status.audioUrl);
    let blob: Blob;
    try {
      // P1-2：优先走 IHttpFetchPort（blob: URL 也可通过 fetch API 读取）
      blob = this.httpFetch
        ? await this.httpFetch.fetchBlob(audioBlobUrl)
        : await (await fetch(audioBlobUrl)).blob();
    } finally {
      this.getFileStorage().revokeObjectUrl(audioBlobUrl);
    }

    const storagePath = `audio/narration_${segmentId}.mp3`;
    await this.getFileStorage().storeBlob(storagePath, blob);

    segment.narrationAudioStoragePath = storagePath;
    await this.segmentRepo.save(segment);

    return this.getFileStorage().getObjectUrl(storagePath);
  }

  /**
   * 从已持久化的分镜恢复旁白 Object URL。
   * 若 segment 未持久化或文件已失效，返回 null。
   */
  async getNarrationAudioUrl(segment: StorySegment): Promise<string | null> {
    if (!segment.narrationAudioStoragePath) return null;
    const fileStorage = this.getFileStorage();
    const exists = await fileStorage.blobExists(segment.narrationAudioStoragePath);
    if (!exists) return null;
    return fileStorage.getObjectUrl(segment.narrationAudioStoragePath);
  }

  /**
   * 下载音频文件到本地
   */
  async downloadAudio(audioUrl: string, filename: string): Promise<void> {
    // 先获取 Blob URL（带认证）
    const blobUrl = await this.getVoicePort().fetchAudioAsBlobUrl(audioUrl);
    try {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      // 下载完成后释放 Blob URL
      URL.revokeObjectURL(blobUrl);
    }
  }

  /** hex 编码音频转 Blob */
  private hexToAudioBlob(hex: string, format = 'mp3'): Blob {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return new Blob([bytes], { type: `audio/${format}` });
  }

  /** hex 编码音频转 Blob URL */
  private hexToBlobUrl(hex: string, format = 'mp3'): string {
    return URL.createObjectURL(this.hexToAudioBlob(hex, format));
  }

  /** T2ASyncResult → 音频 Blob */
  private async resultToAudioBlob(result: T2ASyncResult): Promise<Blob> {
    if (result.audioHex) {
      return this.hexToAudioBlob(result.audioHex);
    }
    if (result.audioUrl) {
      const blobUrl = await this.getVoicePort().fetchAudioAsBlobUrl(result.audioUrl);
      try {
        // P1-2：优先走 IHttpFetchPort
        if (this.httpFetch) return await this.httpFetch.fetchBlob(blobUrl);
        const res = await fetch(blobUrl);
        return await res.blob();
      } finally {
        this.getFileStorage().revokeObjectUrl(blobUrl);
      }
    }
    throw new Error('未返回音频数据');
  }

  /**
   * Get available voices from the API.
   */
  async getAvailableVoices(voiceType: VoiceType): Promise<VoiceListResult> {
    return this.getVoicePort().getAvailableVoices(voiceType);
  }

  /**
   * 获取音色使用情况（哪些角色在使用）
   */
  async getVoiceUsage(voiceId: string): Promise<string[]> {
    const allCharacters = await this.characterRepo.findAll();
    return allCharacters.filter(c => c.voiceId === voiceId).map(c => c.name);
  }

  /**
   * Delete a cloned or designed voice.
   * Also unbinds it from any character currently using it.
   */
  async deleteVoice(voiceType: 'voice_cloning' | 'voice_generation', voiceId: string): Promise<void> {
    await this.getVoicePort().deleteVoice(voiceType, voiceId);

    // Unbind from any character using this voice
    const allCharacters = await this.characterRepo.findAll();
    for (const char of allCharacters) {
      if (char.voiceId === voiceId) {
        char.voiceId = undefined;
        await this.characterRepo.save(char);
      }
    }
  }

  /**
   * 批量生成故事旁白：为所有分镜创建异步任务
   * 返回 Map<segmentId, taskId>
   */
  async batchGenerateNarration(segments: StorySegment[], voiceId: string): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    for (const seg of segments) {
      if (!seg.content?.trim()) continue;
      try {
        const taskId = await this.createAsyncTask(seg.content, voiceId);
        results.set(seg.id, taskId);
      } catch (e) {
        this.logger.error(`[VoiceService] Failed to create T2A task for segment ${seg.id}`, e, { service: 'VoiceService', segmentId: seg.id });
      }
    }
    return results;
  }

  /**
   * 重命名已保存的音色（本地操作，不调用平台 API）
   *
   * @param savedVoiceId SavedVoice 记录的 ID（非 voiceId）
   * @param newName 新名称（1-20 字符）
   */
  async renameVoice(savedVoiceId: string, newName: string): Promise<void> {
    if (!this.savedVoiceRepo) throw new Error('SavedVoiceRepository not injected');
    const savedVoice = await this.savedVoiceRepo.getById(savedVoiceId);
    if (!savedVoice) throw new Error('SavedVoice not found');

    if (!newName.trim()) throw new Error('Voice name cannot be empty');
    if (newName.length > 20) throw new Error('Voice name too long');

    savedVoice.name = newName.trim();
    await this.savedVoiceRepo.save(savedVoice);

    this.logger.info('Voice renamed', {
      service: 'VoiceService',
      method: 'renameVoice',
      savedVoiceId,
      newName,
    });
  }
}
