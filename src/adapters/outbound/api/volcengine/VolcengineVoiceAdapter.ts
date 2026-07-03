import type {
  IVoicePort, T2ASyncContext, T2ASyncResult, T2AAsyncContext, T2AAsyncResult, T2AAsyncStatus,
  VoiceCloneContext, VoiceCloneResult, VoiceDesignResult, VoiceListResult, VoiceType,
  FileUploadResult, T2AStreamCallbacks, T2AStreamHandle
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';
import { createTrackedObjectUrl } from '../../../../utils/objectUrlRegistry';

/**
 * 火山引擎语音合成适配器（豆包 TTS）。
 *
 * Endpoint：
 *   - 同步：POST /audio/speech（OpenAI 兼容协议）
 *     Body: { model, input, voice }
 *   - 异步：POST /audio/async/create + /audio/async/retrieve
 *     适合长文本 + 流式场景
 *
 * Model 映射：
 *   - 同步：doubao-tts-base / doubao-tts-pro / doubao-tts-pro-max
 *   - 异步：speech-2.8-hd / speech-2.8-turbo（与 MiniMax 命名一致）
 *
 * 限制：
 *   - Voice Clone 暂不支持（火山引擎豆包 TTS 不提供克隆能力）
 *   - Voice Design 暂不支持
 *   - 流式 TTS 需要 WebSocket，暂不实现
 *
 * 未实现的方法统一抛 NotImplementedError，调用方应通过 UI 入口判断能力可用性。
 */
export class VolcengineVoiceAdapter implements IVoicePort {
  readonly voiceCapabilities: import('../../../../domain/ports/OutboundPorts').VoiceCapabilities = {
    supportsClone: false,
    supportsDesign: false,
    supportsDelete: false,
    supportsStream: false,
  };

  private http: VolcengineHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new VolcengineHttpClient(config);
  }

  // ==================== 同步合成（OpenAI 兼容）====================

  /** Anthropic 协议（Agent Plan）不支持语音合成 */
  private ensureOpenAIProtocol(): void {
    if (this.config.volcArkProtocol === 'anthropic') {
      throw new Error('Anthropic 协议（Agent Plan）不支持语音合成，请切换至 OpenAI 协议（标准后付费模式）');
    }
    if (!this.config.volcArkApiKey.trim()) {
      throw new Error('火山引擎语音合成未配置 API Key，请在设置页面配置标准后付费模式 API Key');
    }
  }

  async synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult> {
    this.ensureOpenAIProtocol();

    const text = context.text;

    console.log('[VolcengineVoiceAdapter] sync TTS 入参', {
      text,
      textLength: text.length,
      voiceId: context.voiceId,
      model: context.model ?? 'doubao-tts-base',
    });

    const result = await withRetry(() =>
      this.http.post<ArrayBuffer>('/audio/speech', {
        model: context.model ?? 'doubao-tts-base',
        input: text,
        voice: context.voiceId ?? 'zh_male_narration',
        response_format: 'mp3',
      }, { responseType: 'arraybuffer' }),
    );

    console.log('[VolcengineVoiceAdapter] sync TTS 出参', {
      audioSize: result.byteLength,
      usageCharacters: text.length,
    });

    return {
      audioUrl: createTrackedObjectUrl(new Blob([result], { type: 'audio/mpeg' })),
      audioSize: result.byteLength,
      usageCharacters: text.length,
    };
  }

  synthesizeSpeechStream(_context: T2ASyncContext, _callbacks: T2AStreamCallbacks): T2AStreamHandle {
    // 流式 TTS（火山引擎）需要 WebSocket，暂不实现
    return { close: () => {} };
  }

  // ==================== 异步合成 ====================

  async createT2ATask(context: T2AAsyncContext): Promise<T2AAsyncResult> {
    this.ensureOpenAIProtocol();

    const text = context.text ?? '';

    console.log('[VolcengineVoiceAdapter] async TTS 入参', {
      text,
      textLength: text.length,
      voiceId: context.voiceId,
      model: context.model ?? 'doubao-tts-pro',
    });

    const result = await withRetry(() =>
      this.http.post<{ id: string }>('/audio/async/create', {
        model: context.model ?? 'doubao-tts-pro',
        input: text,
        voice: context.voiceId ?? 'zh_male_narration',
        response_format: 'mp3',
      }),
    );

    console.log('[VolcengineVoiceAdapter] async TTS 出参', {
      taskId: result.id,
      usageCharacters: text.length,
    });

    return {
      taskId: result.id,
      usageCharacters: text.length,
    };
  }

  async queryT2ATask(taskId: string): Promise<T2AAsyncStatus> {
    const result = await withRetry(() =>
      this.http.get<{ id: string; status: string; audio_url?: string; error?: string }>(
        `/audio/async/retrieve?task_id=${encodeURIComponent(taskId)}`,
      ),
    );
    const statusMap: Record<string, T2AAsyncStatus['status']> = {
      'processing': 'processing',
      'success': 'success',
      'failed': 'failed',
    };
    return {
      status: statusMap[result.status] ?? 'processing',
      audioUrl: result.audio_url,
      errorMessage: result.error,
    };
  }

  // ==================== 不支持的能力 ====================

  async uploadFile(_file: File, _purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult> {
    throw new Error('VolcengineVoiceAdapter: voice_clone/prompt_audio upload not supported by Doubao TTS');
  }

  async cloneVoice(_context: VoiceCloneContext): Promise<VoiceCloneResult> {
    throw new Error('VolcengineVoiceAdapter: voice cloning is not supported by Doubao TTS');
  }

  getFileUrl(_fileId: string): string {
    throw new Error('VolcengineVoiceAdapter: file URL retrieval not supported by Doubao TTS');
  }

  async fetchAudioAsBlobUrl(audioUrl: string): Promise<string> {
    // 直接返回 URL（已经是公网 URL）
    return audioUrl;
  }

  async designVoice(_prompt: string, _previewText: string, _voiceId?: string, _aigcWatermark?: boolean): Promise<VoiceDesignResult> {
    throw new Error('VolcengineVoiceAdapter: voice design not supported by Doubao TTS');
  }

  async getAvailableVoices(_voiceType: VoiceType): Promise<VoiceListResult> {
    // 提供预定义的几个常用声音
    return {
      systemVoices: [
        { voiceId: 'zh_male_narration', voiceName: '中文男声 - 旁白', description: '中文男声，旁白风格', type: 'system' as const },
        { voiceId: 'zh_female_gentle', voiceName: '中文女声 - 温柔', description: '中文女声，温柔风格', type: 'system' as const },
        { voiceId: 'en_male_narration', voiceName: 'English Male - Narration', description: 'English male, narration style', type: 'system' as const },
        { voiceId: 'en_female_gentle', voiceName: 'English Female - Gentle', description: 'English female, gentle style', type: 'system' as const },
      ],
    };
  }

  async deleteVoice(_voiceType: 'voice_cloning' | 'voice_generation', _voiceId: string): Promise<void> {
    throw new Error('VolcengineVoiceAdapter: voice deletion not supported by Doubao TTS');
  }
}