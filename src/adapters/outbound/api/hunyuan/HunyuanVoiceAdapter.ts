import type {
  IVoicePort, VoiceCloneContext, VoiceCloneResult, T2AAsyncContext, T2AAsyncResult,
  T2AAsyncStatus, T2ASyncContext, T2ASyncResult, VoiceDesignResult, VoiceType,
  VoiceListResult, FileUploadResult, T2AStreamCallbacks, T2AStreamHandle,
  VoiceConversionContext, VoiceConversionResult,
} from '../../../../domain/ports/OutboundPorts';
import { CapabilityNotSupportedError } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { HunyuanHttpClient } from './HunyuanHttpClient';
import { withRetry } from './HunyuanErrorUtils';

/**
 * 腾讯混元 Hunyuan 语音合成适配器。
 *
 * 接口：Action=TextToVoice
 *   Body: { Text, SessionId?, VoiceType?, Speed?, Volume?, SampleRate?, Codec? }
 *   Response: { Response: { Audio: base64string, SessionId, RequestId } }
 *
 * 仅实现核心 TTS 能力（synthesizeSpeechSync）。
 * 声音克隆/设计/异步 T2A 等高级能力混元不支持，抛 NotImplementedError。
 */
export class HunyuanVoiceAdapter implements IVoicePort {
  readonly voiceCapabilities: import('../../../../domain/ports/OutboundPorts').VoiceCapabilities = {
    supportsClone: false,
    supportsDesign: false,
    supportsDelete: false,
    supportsStream: false,
    supportsConversion: false,
  };

  async convertVoice(_context: VoiceConversionContext): Promise<VoiceConversionResult> {
    throw new CapabilityNotSupportedError('hunyuan', 'supportsConversion');
  }

  private http: HunyuanHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new HunyuanHttpClient(config);
  }

  async synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult> {
    if (!this.config.hunyuanSecretId || !this.config.hunyuanSecretKey) {
      throw new Error('请先在设置中配置腾讯混元的 SecretId 和 SecretKey');
    }

    const payload: Record<string, unknown> = {
      Text: context.text,
      VoiceType: this.mapVoiceId(context.voiceId),
    };
    if (context.speed) payload.Speed = context.speed;
    if (context.volume) payload.Volume = context.volume;
    if (context.sampleRate) payload.SampleRate = context.sampleRate;
    payload.Codec = context.audioFormat || 'mp3';

    const result = await withRetry(() =>
      this.http.call<HunyuanTTSResponse>('TextToVoice', payload),
    );

    const audio = result?.Response?.Audio;
    if (!audio) {
      throw new Error('混元语音合成未返回音频数据');
    }

    return {
      audioHex: audio,
      audioLength: 0,
      audioSize: 0,
      usageCharacters: context.text.length,
    };
  }

  synthesizeSpeechStream(context: T2ASyncContext, callbacks: T2AStreamCallbacks): T2AStreamHandle {
    const controller = new AbortController();

    (async () => {
      try {
        const result = await this.synthesizeSpeechSync(context);
        if (controller.signal.aborted) return;

        // 混元返回完整 base64 音频，转为 ArrayBuffer 后整体推送
        const binary = atob(result.audioHex || '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        callbacks.onAudioChunk(bytes.buffer);
        callbacks.onComplete?.(bytes.byteLength);
      } catch (err) {
        if (!controller.signal.aborted) {
          callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return { close: () => controller.abort() };
  }

  // ===== 以下能力混元不支持，统一抛 NotImplementedError =====

  async uploadFile(_file: File, _purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult> {
    throw new Error('混元不支持文件上传');
  }

  async cloneVoice(_context: VoiceCloneContext): Promise<VoiceCloneResult> {
    throw new Error('混元不支持声音克隆');
  }

  async createT2ATask(_context: T2AAsyncContext): Promise<T2AAsyncResult> {
    throw new Error('混元不支持异步 TTS 任务');
  }

  async queryT2ATask(_taskId: string): Promise<T2AAsyncStatus> {
    throw new Error('混元不支持异步 TTS 任务查询');
  }

  getFileUrl(_fileId: string): string {
    throw new Error('混元不支持文件管理');
  }

  async fetchAudioAsBlobUrl(_audioUrl: string): Promise<string> {
    throw new Error('混元不支持音频文件下载');
  }

  async designVoice(_prompt: string, _previewText: string, _voiceId?: string, _aigcWatermark?: boolean): Promise<VoiceDesignResult> {
    throw new Error('混元不支持声音设计');
  }

  async getAvailableVoices(_voiceType: VoiceType): Promise<VoiceListResult> {
    // 返回腾讯云内置音色列表（部分）
    return {
      systemVoices: [
        { voiceId: '101001', description: '通用女声', voiceName: '智瑜', type: 'system', isActive: true },
        { voiceId: '101002', description: '通用男声', voiceName: '智聆', type: 'system', isActive: true },
        { voiceId: '101003', description: '成熟男声', voiceName: '智云', type: 'system', isActive: true },
      ],
    };
  }

  async deleteVoice(_voiceType: 'voice_cloning' | 'voice_generation', _voiceId: string): Promise<void> {
    throw new Error('混元不支持声音删除');
  }

  // ===== 私有方法 =====

  /** 将系统音色 ID 映射为腾讯云 VoiceType 数字编码 */
  private mapVoiceId(voiceId?: string): string {
    // 腾讯云 TTS VoiceType 为数字字符串；默认 101001（智瑜-女声）
    return voiceId || '101001';
  }
}

interface HunyuanTTSResponse {
  Response: {
    Audio?: string;      // base64 编码的音频数据
    SessionId?: string;
    RequestId?: string;
  };
}
