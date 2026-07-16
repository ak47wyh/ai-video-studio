import type {
  IVoicePort, T2ASyncContext, T2ASyncResult, T2AAsyncContext, T2AAsyncResult, T2AAsyncStatus,
  VoiceCloneContext, VoiceCloneResult, VoiceDesignResult, VoiceListResult, VoiceType,
  FileUploadResult, T2AStreamCallbacks, T2AStreamHandle, VoiceCapabilities, VoiceInfo,
  VoiceConversionContext, VoiceConversionResult,
} from '../../../../domain/ports/OutboundPorts';
import { CapabilityNotSupportedError } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { ApiConfigStore } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { VolcengineSpeechClient } from './VolcengineSpeechClient';
import { withRetry } from './VolcengineErrorUtils';
import { VolcengineApiError } from './VolcengineErrorUtils';
import { isSpeakerReady } from './VolcengineVoiceErrorUtils';
import { createTrackedObjectUrl } from '../../../../utils/objectUrlRegistry';

/**
 * 火山引擎语音适配器（组合 Ark TTS + 原生语音技术）。
 *
 * 设计决策：在单一适配器内部组合两个 Client，对外仍实现 IVoicePort。
 * 原因：
 *  1. PlatformRouter.resolveVoice 返回单个 IVoicePort，拆分需改动 Port 接口签名
 *  2. 用户视角：火山引擎是一个平台，不应暴露内部双体系
 *  3. 子能力由 voiceCapabilities 声明，UI 层统一处理
 *
 * 双体系说明：
 *  - 方舟 Ark TTS（VolcengineHttpClient）：OpenAI 兼容协议，仅标准音色，Bearer Token 鉴权
 *  - 原生语音技术（VolcengineSpeechClient）：声音复刻 + 大模型 TTS，Bearer;Token + AppID + Cluster
 *
 * 能力声明：
 *  - supportsClone: true  → 走原生语音 mega_tts/audio/upload
 *  - supportsStream: true → 走原生语音 WebSocket V1 二进制协议
 *  - supportsDesign: false → 火山引擎无音色设计能力
 *  - supportsDelete: false → 火山引擎无删除音色 API（仅本地 SavedVoice 可删）
 *
 * 错误处理：
 *  - 不支持的能力抛 CapabilityNotSupportedError（带 platform + capability）
 *  - 平台错误码归一化为 VolcengineApiError
 */
export class VolcengineVoiceAdapter implements IVoicePort {
  readonly voiceCapabilities: VoiceCapabilities = {
    supportsClone: true,
    supportsDesign: false,
    supportsDelete: false,
    supportsStream: true,
    supportsConversion: true,
  };

  private arkHttp: VolcengineHttpClient;
  private speechClient: VolcengineSpeechClient;
  private config: ApiConfig;
  /** fileId → base64 音频字节的内存缓存（火山引擎不需要预上传到服务端，base64 内联到 clone 请求） */
  private audioBytesCache: Map<string, string> = new Map();

  constructor(config: ApiConfig) {
    this.config = config;
    // 方舟 Ark TTS 永远走 OpenAI 协议（标准音色）
    this.arkHttp = VolcengineHttpClient.createOpenAI(config);
    this.speechClient = new VolcengineSpeechClient(config);
  }

  // ==================== 同步合成 ====================

  /**
   * 同步 TTS：按音色类型与模型路由。
   *  - 复刻音色（S_ 开头）→ 原生语音 V1（cluster 用配置值 volcano_icl）
   *  - doubao-seed-tts-2.0 模型 → 原生语音 V3 plan 端点（Resource-Id: seed-tts-2.0）
   *  - 其他标准音色 → 优先方舟 Ark，降级原生语音 V1（cluster 覆盖为 volcano_tts）
   *
   * P0 修复：
   *  - 标准音色降级路径新增 clusterOverride: 'volcano_tts'，原用配置中的 volcano_icl 导致 BV001 等无法合成
   *  - 复刻音色路径新增 capability: 'clone'，确保 Resource-Id 为 seed-icl-1.0
   */
  async synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult> {
    const text = context.text;
    const voiceId = context.voiceId;

    // 复刻音色（S_ 开头）必须走原生语音技术
    if (voiceId.startsWith('S_')) {
      const result = await this.speechClient.synthesizeSync({
        text,
        voiceType: voiceId,
        encoding: context.audioFormat || 'mp3',
        speedRatio: context.speed ?? 1.0,
        volumeRatio: context.volume ?? 1.0,
        capability: 'clone',  // 复刻用 seed-icl-1.0
      });
      return {
        audioUrl: `data:audio/${context.audioFormat || 'mp3'};base64,${result.audioBase64}`,
        audioSize: Math.floor(result.audioBase64.length * 0.75),
        usageCharacters: text.length,
      };
    }

    // P2 新增：豆包语音合成 2.0 走专属 V3 plan 端点（不支持 Auto 切换，必须显式路由）
    // P0 修复：模型 ID 判断改为使用配置中的 volcSeedTtsModel(默认 doubao-seed-tts-2.0),
    //          原硬编码 'doubao-seed-tts-2-0' 与配置默认值 'doubao-seed-tts-2.0' 不匹配(点号 vs 连字符)
    if (this.config.volcSeedTtsEnabled && context.model === this.config.volcSeedTtsModel) {
      return this.synthesizeViaSeedTtsV2(context);
    }

    // 标准音色：优先走方舟 Ark（若配置了 OpenAI API Key）
    // 双协议并存：Ark TTS 永远走 OpenAI 协议，只需 OpenAI Key
    if (this.config.volcArkOpenAiApiKey.trim()) {
      return this.synthesizeViaArk(context);
    }

    // 降级：走原生语音技术 + 标准音色 cluster
    // P0 修复：标准音色必须用 volcano_tts 集群，原实现用配置中的 volcano_icl 导致 404/空音频
    const result = await this.speechClient.synthesizeSync({
      text,
      voiceType: voiceId,
      encoding: context.audioFormat || 'mp3',
      speedRatio: context.speed ?? 1.0,
      volumeRatio: context.volume ?? 1.0,
      clusterOverride: 'volcano_tts',  // 标准音色强制用 volcano_tts
      capability: 'tts',
    });
    return {
      audioUrl: `data:audio/${context.audioFormat || 'mp3'};base64,${result.audioBase64}`,
      audioSize: Math.floor(result.audioBase64.length * 0.75),
      usageCharacters: text.length,
    };
  }

  /**
   * 豆包语音合成 2.0（doubao-seed-tts-2.0）专属路由。
   * 走原生语音 /api/v3/plan/tts 端点，Resource-Id 为 seed-tts-2.0。
   */
  private async synthesizeViaSeedTtsV2(context: T2ASyncContext): Promise<T2ASyncResult> {
    const text = context.text;
    const result = await this.speechClient.synthesizeSeedTtsV2({
      text,
      voiceType: context.voiceId,
      encoding: context.audioFormat || 'mp3',
      speedRatio: context.speed ?? 1.0,
      volumeRatio: context.volume ?? 1.0,
      pitchRatio: context.pitch ?? 1.0,
      emotion: context.emotion,
    });
    return {
      audioUrl: `data:audio/${context.audioFormat || 'mp3'};base64,${result.audioBase64}`,
      audioSize: Math.floor(result.audioBase64.length * 0.75),
      usageCharacters: text.length,
    };
  }

  /** 方舟 Ark OpenAI 兼容协议 TTS */
  private async synthesizeViaArk(context: T2ASyncContext): Promise<T2ASyncResult> {
    const text = context.text;
    const result = await withRetry(() =>
      this.arkHttp.post<ArrayBuffer>('/audio/speech', {
        model: context.model ?? 'doubao-tts-base',
        input: text,
        voice: context.voiceId,
        response_format: 'mp3',
      }, { responseType: 'arraybuffer' }),
    );
    return {
      audioUrl: createTrackedObjectUrl(new Blob([result], { type: 'audio/mpeg' })),
      audioSize: result.byteLength,
      usageCharacters: text.length,
    };
  }

  // ==================== 流式合成 ====================

  /**
   * WebSocket 流式 TTS。
   * 路由策略:
   *  - Seed TTS V2 模型(doubao-seed-tts-2.0)→ V3 unidirectional/stream(支持新模型音色)
   *  - 其他音色(复刻 S_ / 标准音色)→ V1 ws_binary(兼容旧协议)
   *
   * 走原生语音技术,与方舟协议无关。
   */
  synthesizeSpeechStream(context: T2ASyncContext, callbacks: T2AStreamCallbacks): T2AStreamHandle {
    // P0 修复:Seed TTS V2 模型必须走 V3 端点,V1 不支持 doubao-seed-tts-2.0 音色(返回 404)
    const useV3 = this.config.volcSeedTtsEnabled && context.model === this.config.volcSeedTtsModel;
    return this.speechClient.createStreamWebSocket({
      text: context.text,
      voiceType: context.voiceId,
      encoding: context.audioFormat || 'mp3',
      ...(useV3 ? { useV3: true, clusterOverride: 'volcano_tts' } : {}),
    }, callbacks);
  }

  // ==================== 声音转换 ====================

  /**
   * 声音转换：将源音频的音色转换为目标音色。
   *
   * 流程：
   *  1. 解码源音频（mp3/wav/m4a 等）→ AudioBuffer
   *  2. 重采样到 16k 单声道 → PCM 16bit 小端序
   *  3. 通过 WebSocket 流式发送 PCM，接收转换后音频
   *  4. 合并输出 → Blob URL
   *
   * 浏览器 AudioContext 解码能力有限（无法解码 pcm raw），调用方应提供常见编码格式。
   */
  async convertVoice(context: VoiceConversionContext): Promise<VoiceConversionResult> {
    this.speechClient.ensureConfigured();

    // 1. 获取音频 ArrayBuffer
    const arrayBuffer = await this.fetchAudioArrayBuffer(context.audio);
    // 2. 解码 + 重采样到 16k PCM
    const pcmBytes = await this.decodeToPcm16kMono(arrayBuffer);
    // 3. 流式转换
    const encoding = context.outputEncoding ?? 'mp3';
    const { audioBytes } = await this.speechClient.convertVoiceStream({
      pcmBytes,
      voiceType: context.targetVoiceType,
      encoding,
      rate: context.outputRate ?? 24000,
      pitchRatio: context.pitchRatio,
      volumeRatio: context.volumeRatio,
    });
    // 4. 转 Blob URL
    const mimeType = encoding === 'mp3' ? 'audio/mpeg'
      : encoding === 'wav' ? 'audio/wav'
      : encoding === 'ogg_opus' ? 'audio/ogg'
      : 'audio/pcm';
    // TS6 严格模式下 Uint8Array<ArrayBufferLike> 不兼容 BlobPart(SharedArrayBuffer 不兼容 ArrayBuffer),
    // 运行时 Uint8Array 是合法 BlobPart,用类型断言逃逸
    const blob = new Blob([audioBytes as unknown as BlobPart], { type: mimeType });
    return {
      audioUrl: createTrackedObjectUrl(blob),
      audioSize: audioBytes.byteLength,
      encoding,
    };
  }

  /** 获取音频 ArrayBuffer（支持 Blob 或 URL） */
  private async fetchAudioArrayBuffer(audio: Blob | string): Promise<ArrayBuffer> {
    if (typeof audio === 'string') {
      const res = await fetch(audio);
      return res.arrayBuffer();
    }
    return audio.arrayBuffer();
  }

  /**
   * 解码音频并重采样到 16k 单声道 PCM 16bit 小端序。
   * 使用 OfflineAudioContext 进行重采样，兼容 mp3/wav/m4a 等浏览器可解码格式。
   */
  private async decodeToPcm16kMono(arrayBuffer: ArrayBuffer): Promise<Uint8Array> {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const decodeCtx = new AudioCtx();
    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    decodeCtx.close();

    // 重采样到 16k 单声道
    const targetRate = 16000;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetRate), targetRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const rendered = await offlineCtx.startRendering();

    // AudioBuffer → Int16 PCM 小端序
    const floatData = rendered.getChannelData(0);
    const pcm16 = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      const s = Math.max(-1, Math.min(1, floatData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return new Uint8Array(pcm16.buffer);
  }

  // ==================== 异步合成（不支持，火山引擎方舟无异步端点）====================

  async createT2ATask(_context: T2AAsyncContext): Promise<T2AAsyncResult> {
    throw new CapabilityNotSupportedError('volcengine', 'supportsStream');
  }

  async queryT2ATask(_taskId: string): Promise<T2AAsyncStatus> {
    throw new CapabilityNotSupportedError('volcengine', 'supportsStream');
  }

  // ==================== 音色克隆 ====================

  /**
   * 上传文件用于声音克隆。
   * 火山引擎不需要预上传到服务端，base64 直接内联到 clone 请求。
   * 这里把 File 转 base64 存入内存缓存，返回 fileId 供 cloneVoice 读取。
   */
  async uploadFile(file: File, purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult> {
    if (purpose !== 'voice_clone') {
      throw new CapabilityNotSupportedError('volcengine', 'supportsClone');
    }
    const audioBytes = await this.fileToBase64(file);
    const fileId = `volc_${Date.now()}_${file.name}`;
    this.audioBytesCache.set(fileId, audioBytes);
    return { fileId };
  }

  /**
   * 声音复刻：上传训练音频 + 轮询训练状态。
   *
   * 流程：
   *  1. 从内存缓存读取 fileId 对应的 base64 音频字节
   *  2. 调用 mega_tts/audio/upload 上传训练
   *  3. 轮询 mega_tts/status 直到训练完成（2 秒间隔，最长 2 分钟）
   *  4. 返回 voiceId + demo_audio 预览
   *
   * 注意：火山引擎的训练是异步过程，upload 接口立即返回 success 仅表示上传成功。
   */
  async cloneVoice(context: VoiceCloneContext): Promise<VoiceCloneResult> {
    this.speechClient.ensureConfigured();

    // 从内存缓存读取 base64 音频字节
    const audioBytes = this.audioBytesCache.get(context.fileId) || '';
    if (!audioBytes) {
      throw new VolcengineApiError(0, 'AUDIO_BYTES_MISSING', '声音复刻缺少音频数据，请重新上传音频文件');
    }
    // 用完即清，避免内存堆积
    this.audioBytesCache.delete(context.fileId);

    const speakerId = context.voiceId || `S_${this.generateSpeakerId()}`;
    const audioFormat = this.detectAudioFormat(context.model);

    // 上传训练
    const uploadResult = await this.speechClient.uploadSpeakerAudio({
      speakerId,
      audioBytes,
      audioFormat,
      language: this.mapLanguage(context.languageBoost),
      modelType: this.config.volcVoiceCloneModelType,
      extraParams: {
        enable_audio_denoise: context.needNoiseReduction ?? false,
      },
    });

    if (uploadResult.statusCode !== 0) {
      throw new VolcengineApiError(0, uploadResult.statusMessage || 'CLONE_FAILED', uploadResult.statusMessage);
    }

    // 轮询训练状态（2 秒间隔，最长 2 分钟 = 60 次）
    const status = await this.pollSpeakerStatus(speakerId, 60, 2000);
    if (!isSpeakerReady(status.status)) {
      throw new VolcengineApiError(
        0,
        'CLONE_TRAINING_FAILED',
        `声音复刻训练失败，最终状态：${status.status}`,
      );
    }

    return {
      voiceId: speakerId,
      previewAudioUrl: status.demoAudio,
    };
  }

  /** 轮询训练状态，直到成功/失败/超时 */
  private async pollSpeakerStatus(
    speakerId: string,
    maxAttempts: number,
    intervalMs: number,
  ): Promise<{ status: 0 | 1 | 2 | 3 | 4; demoAudio?: string }> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(intervalMs);
      const status = await this.speechClient.querySpeakerStatus(speakerId);
      // 0=未找到, 1=训练中, 2=成功, 3=失败, 4=已激活
      if (status.status === 2 || status.status === 4) {
        return { status: status.status, demoAudio: status.demoAudio };
      }
      if (status.status === 3) {
        return { status: 3 };
      }
      // 0=未找到 或 1=训练中 → 继续轮询
    }
    return { status: 1 };  // 超时，仍在训练中
  }

  // ==================== 文件管理（不支持）====================

  getFileUrl(_fileId: string): string {
    throw new CapabilityNotSupportedError('volcengine', 'supportsClone');
  }

  async fetchAudioAsBlobUrl(audioUrl: string): Promise<string> {
    // 火山引擎返回的 demo_audio 是公网 URL，直接返回
    return audioUrl;
  }

  // ==================== 音色设计（不支持）====================

  async designVoice(
    _prompt: string,
    _previewText: string,
    _voiceId?: string,
    _aigcWatermark?: boolean,
  ): Promise<VoiceDesignResult> {
    throw new CapabilityNotSupportedError('volcengine', 'supportsDesign');
  }

  // ==================== 音色列表 ====================

  /**
   * 获取可用音色列表。
   * 火山引擎无「列出已克隆音色」API，speaker_id 需用户自己保存。
   * 返回硬编码的标准音色（官方公开音色），克隆音色由 VoiceService 从 SavedVoiceRepository 补充。
   */
  async getAvailableVoices(_voiceType: VoiceType): Promise<VoiceListResult> {
    return {
      systemVoices: VOLCENGINE_SYSTEM_VOICES,
      clonedVoices: [],  // 由 VoiceService 层从 SavedVoiceRepository 补充
    };
  }

  // ==================== 删除音色（不支持）====================

  async deleteVoice(
    _voiceType: 'voice_cloning' | 'voice_generation',
    _voiceId: string,
  ): Promise<void> {
    throw new CapabilityNotSupportedError('volcengine', 'supportsDelete');
  }

  // ==================== 辅助方法 ====================

  /** 生成 speaker_id（16 位字母数字） */
  private generateSpeakerId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  /** 读取 File 为 base64 字符串（不含 data:URI 前缀） */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // FileReader.readAsDataURL 返回 "data:audio/wav;base64,xxxx" 形式，去掉前缀
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error(`读取音频文件失败: ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  /** 从 model 字段推断音频格式 */
  private detectAudioFormat(model?: string): string {
    if (!model) return 'wav';
    const lower = model.toLowerCase();
    if (lower.includes('mp3')) return 'mp3';
    if (lower.includes('ogg')) return 'ogg';
    if (lower.includes('m4a')) return 'm4a';
    if (lower.includes('aac')) return 'aac';
    if (lower.includes('pcm')) return 'pcm';
    return 'wav';
  }

  /** languageBoost 字符串映射到火山引擎数字编码 */
  private mapLanguage(languageBoost?: string): number {
    if (!languageBoost || languageBoost === 'auto') return 0;
    const map: Record<string, number> = {
      'zh': 0, 'cn': 0, 'chinese': 0,
      'en': 1, 'english': 1,
      'ja': 2, 'japanese': 2,
      'ko': 3, 'korean': 3,
    };
    return map[languageBoost.toLowerCase()] ?? 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/** 火山引擎公开标准音色（官方文档可查） */
const VOLCENGINE_SYSTEM_VOICES: VoiceInfo[] = [
  { voiceId: 'BV001', voiceName: '通用女声', description: '通用场景女声', type: 'system' },
  { voiceId: 'BV002', voiceName: '通用男声', description: '通用场景男声', type: 'system' },
  { voiceId: 'BV700_streaming', voiceName: '灿灿', description: '亲和女声，适合旁白', type: 'system' },
  { voiceId: 'BV701_streaming', voiceName: '擎苍', description: '磁性男声，适合叙事', type: 'system' },
  { voiceId: 'BV704_streaming', voiceName: '熠彤', description: '活力女声，适合广告', type: 'system' },
  { voiceId: 'BV405_streaming', voiceName: '奶泡泡', description: '童声，适合儿童内容', type: 'system' },
];

/** 检查火山引擎语音技术配置是否完整（供 UI 层判断 Tab 是否可用） */
export function isVolcVoiceConfigured(): boolean {
  return ApiConfigStore.isVolcVoiceConfigured();
}
