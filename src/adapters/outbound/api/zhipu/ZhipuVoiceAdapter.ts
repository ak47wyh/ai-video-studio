import type {
  IVoicePort, VoiceCloneContext, VoiceCloneResult, T2AAsyncContext, T2AAsyncResult,
  T2AAsyncStatus, T2ASyncContext, T2ASyncResult, VoiceDesignResult, VoiceType,
  VoiceListResult, FileUploadResult, T2AStreamCallbacks, T2AStreamHandle,
  VoiceConversionContext, VoiceConversionResult,
} from '../../../../domain/ports/OutboundPorts';
import { CapabilityNotSupportedError } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';

/**
 * 智谱语音合成适配器（GLM-TTS）。
 *
 * 仅实现核心 TTS 能力（synthesizeSpeechSync / synthesizeSpeechStream）。
 * 声音克隆/设计/列表等高级能力智谱不支持，抛 NotImplementedError。
 *
 * Endpoint: POST /audio/speech
 * Body: { model: 'glm-tts', input, voice, response_format }
 * Response: 音频二进制流（默认 mp3）
 */
export class ZhipuVoiceAdapter implements IVoicePort {
  readonly voiceCapabilities: import('../../../../domain/ports/OutboundPorts').VoiceCapabilities = {
    supportsClone: false,
    supportsDesign: false,
    supportsDelete: false,
    supportsStream: false,
    supportsConversion: false,
  };

  async convertVoice(_context: VoiceConversionContext): Promise<VoiceConversionResult> {
    throw new CapabilityNotSupportedError('zhipu', 'supportsConversion');
  }

  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  async synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult> {
    // ── Mock 模式 ──
    if (!this.config.zhipuApiKey) {
      console.warn('[ZhipuVoiceAdapter] No API key — returning mock audio.');
      return { audioUrl: 'mock://zhipu-tts', audioLength: 3000, audioSize: 0, usageCharacters: 0 };
    }

    const payload: Record<string, unknown> = {
      model: 'glm-tts',
      input: context.text,
      voice: context.voiceId || 'tongtong',
      response_format: context.audioFormat || 'mp3',
    };
    if (context.speed) payload.speed = context.speed;

    // 智谱返回二进制音频，需通过 axios responseType 处理
    const axios = (await import('axios')).default;
    const response = await axios.post(
      `${this.config.zhipuBaseUrl.replace(/\/+$/, '')}/audio/speech`,
      payload,
      {
        headers: { 'Authorization': `Bearer ${this.config.zhipuApiKey}`, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
      },
    );

    const audioBytes = response.data as ArrayBuffer;
    const base64 = btoa(String.fromCharCode(...new Uint8Array(audioBytes)));
    return {
      audioHex: base64,
      audioLength: 0,
      audioSize: audioBytes.byteLength,
      usageCharacters: context.text.length,
    };
  }

  synthesizeSpeechStream(context: T2ASyncContext, callbacks: T2AStreamCallbacks): T2AStreamHandle {
    const controller = new AbortController();

    if (!this.config.zhipuApiKey) {
      callbacks.onError?.(new Error('智谱 API Key 未配置'));
      return { close: () => controller.abort() };
    }

    const payload: Record<string, unknown> = {
      model: 'glm-tts',
      input: context.text,
      voice: context.voiceId || 'tongtong',
      response_format: context.audioFormat || 'mp3',
    };

    (async () => {
      try {
        const response = await fetch(`${this.config.zhipuBaseUrl.replace(/\/+$/, '')}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.zhipuApiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`智谱 TTS 请求失败 (HTTP ${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法获取音频流');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) callbacks.onAudioChunk(value.buffer);
        }
        callbacks.onComplete?.();
      } catch (err) {
        if (!controller.signal.aborted) {
          callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return {
      close: () => controller.abort(),
    };
  }

  // ===== 以下能力智谱不支持，统一抛 NotImplementedError =====

  async uploadFile(_file: File, _purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult> {
    throw new Error('智谱不支持文件上传');
  }

  async cloneVoice(_context: VoiceCloneContext): Promise<VoiceCloneResult> {
    throw new Error('智谱不支持声音克隆');
  }

  async createT2ATask(_context: T2AAsyncContext): Promise<T2AAsyncResult> {
    throw new Error('智谱不支持异步 TTS 任务');
  }

  async queryT2ATask(_taskId: string): Promise<T2AAsyncStatus> {
    throw new Error('智谱不支持异步 TTS 任务查询');
  }

  getFileUrl(_fileId: string): string {
    throw new Error('智谱不支持文件管理');
  }

  async fetchAudioAsBlobUrl(_audioUrl: string): Promise<string> {
    throw new Error('智谱不支持音频文件下载');
  }

  async designVoice(_prompt: string, _previewText: string, _voiceId?: string, _aigcWatermark?: boolean): Promise<VoiceDesignResult> {
    throw new Error('智谱不支持声音设计');
  }

  async getAvailableVoices(_voiceType: VoiceType): Promise<VoiceListResult> {
    // 返回智谱内置音色列表
    return {
      systemVoices: [
        { voiceId: 'tongtong', description: '通用女声', voiceName: '童童', type: 'system', isActive: true },
        { voiceId: 'yichi', description: '沉稳男声', voiceName: '一弛', type: 'system', isActive: true },
      ],
    };
  }

  async deleteVoice(_voiceType: 'voice_cloning' | 'voice_generation', _voiceId: string): Promise<void> {
    throw new Error('智谱不支持声音删除');
  }
}
