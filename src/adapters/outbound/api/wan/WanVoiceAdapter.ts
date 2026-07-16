import type {
  IVoicePort, VoiceCloneContext, VoiceCloneResult, T2AAsyncContext, T2AAsyncResult,
  T2AAsyncStatus, T2ASyncContext, T2ASyncResult, VoiceDesignResult, VoiceType,
  VoiceListResult, FileUploadResult, T2AStreamCallbacks, T2AStreamHandle,
  VoiceConversionContext, VoiceConversionResult,
} from '../../../../domain/ports/OutboundPorts';
import { CapabilityNotSupportedError } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { WanHttpClient } from './WanHttpClient';

/**
 * 通义万相语音合成适配器（CosyVoice）。
 *
 * 仅实现核心 TTS 能力。
 * Endpoint: POST /services/aigc/text2audio
 *   Body: { model: 'cosyvoice-v1', input: { text }, parameters: { voice } }
 *   Response: output.audio（base64 编码）
 */
export class WanVoiceAdapter implements IVoicePort {
  readonly voiceCapabilities: import('../../../../domain/ports/OutboundPorts').VoiceCapabilities = {
    supportsClone: false,
    supportsDesign: false,
    supportsDelete: false,
    supportsStream: false,
    supportsConversion: false,
  };

  async convertVoice(_context: VoiceConversionContext): Promise<VoiceConversionResult> {
    throw new CapabilityNotSupportedError('wan', 'supportsConversion');
  }

  private http: WanHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new WanHttpClient(config);
  }

  async synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult> {
    if (!this.config.wanApiKey) {
      throw new Error('请先在设置中配置通义万相的 API Key');
    }

    const payload = {
      model: 'cosyvoice-v1',
      input: { text: context.text },
      parameters: {
        voice: context.voiceId || 'longxiaochun',
        format: context.audioFormat || 'mp3',
        ...(context.speed ? { speed: context.speed } : {}),
      },
    };

    const result = await this.http.post<WanTTSResponse>('/services/aigc/text2audio', payload);
    if (!result?.output?.audio) {
      throw new Error('通义万相 TTS 未返回音频');
    }
    return {
      audioHex: result.output.audio,
      audioLength: 0,
      audioSize: result.output.audio.length,
      usageCharacters: context.text.length,
    };
  }

  synthesizeSpeechStream(_context: T2ASyncContext, callbacks: T2AStreamCallbacks): T2AStreamHandle {
    // CosyVoice 流式接口需 WebSocket，本简化实现回退到同步合成 + 一次性推送
    const controller = new AbortController();
    callbacks.onError?.(new Error('通义万相流式 TTS 暂未实现，请使用同步合成'));
    return { close: () => controller.abort() };
  }

  // ===== 以下能力万相不支持，统一抛 NotImplementedError =====

  async uploadFile(_file: File, _purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult> {
    throw new Error('通义万相不支持文件上传');
  }

  async cloneVoice(_context: VoiceCloneContext): Promise<VoiceCloneResult> {
    throw new Error('通义万相不支持声音克隆');
  }

  async createT2ATask(_context: T2AAsyncContext): Promise<T2AAsyncResult> {
    throw new Error('通义万相不支持异步 TTS 任务');
  }

  async queryT2ATask(_taskId: string): Promise<T2AAsyncStatus> {
    throw new Error('通义万相不支持异步 TTS 任务查询');
  }

  getFileUrl(_fileId: string): string {
    throw new Error('通义万相不支持文件管理');
  }

  async fetchAudioAsBlobUrl(_audioUrl: string): Promise<string> {
    throw new Error('通义万相不支持音频文件下载');
  }

  async designVoice(_prompt: string, _previewText: string, _voiceId?: string, _aigcWatermark?: boolean): Promise<VoiceDesignResult> {
    throw new Error('通义万相不支持声音设计');
  }

  async getAvailableVoices(_voiceType: VoiceType): Promise<VoiceListResult> {
    return {
      systemVoices: [
        { voiceId: 'longxiaochun', description: '通用女声', voiceName: '龙小纯', type: 'system', isActive: true },
        { voiceId: 'longhua', description: '沉稳男声', voiceName: '龙华', type: 'system', isActive: true },
        { voiceId: 'longshuo', description: '清新女声', voiceName: '龙硕', type: 'system', isActive: true },
      ],
    };
  }

  async deleteVoice(_voiceType: 'voice_cloning' | 'voice_generation', _voiceId: string): Promise<void> {
    throw new Error('通义万相不支持声音删除');
  }
}

interface WanTTSResponse {
  output?: { audio: string; audio_format?: string };
  usage?: { characters?: number };
  request_id?: string;
}
