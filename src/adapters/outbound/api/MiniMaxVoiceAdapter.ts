import type {
  IVoicePort,
  VoiceCloneContext,
  VoiceCloneResult,
  T2AAsyncContext,
  T2AAsyncResult,
  T2AAsyncStatus,
  T2ASyncContext,
  T2ASyncResult,
  VoiceDesignResult,
  VoiceType,
  VoiceListResult,
  FileUploadResult,
  T2AStreamCallbacks,
  T2AStreamHandle,
  VoiceConversionContext,
  VoiceConversionResult,
} from '../../../domain/ports/OutboundPorts';
import { CapabilityNotSupportedError } from '../../../domain/ports/OutboundPorts';
import { ApiConfigStore } from '../config/ApiConfigStore';
import { getMiniMaxErrorMessage } from './MiniMaxErrorUtils';
import { createTrackedObjectUrl } from '../../../utils/objectUrlRegistry';
import axios from 'axios';

export class MiniMaxVoiceAdapter implements IVoicePort {
  readonly voiceCapabilities: import('../../../domain/ports/OutboundPorts').VoiceCapabilities = {
    supportsClone: true,
    supportsDesign: true,
    supportsDelete: true,
    supportsStream: true,
    supportsConversion: false,
  };

  async convertVoice(_context: VoiceConversionContext): Promise<VoiceConversionResult> {
    throw new CapabilityNotSupportedError('minimax', 'supportsConversion');
  }

  async uploadFile(file: File, purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input'): Promise<FileUploadResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot upload file');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const formData = new FormData();
    formData.append('purpose', purpose);
    formData.append('file', file);

    const response = await axios.post(`${baseUrl}/files/upload`, formData, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const fileId = response.data?.file?.file_id;
    if (!fileId) {
      console.error('[MiniMaxVoiceAdapter] Upload response:', JSON.stringify(response.data));
      throw new Error('Failed to upload file — no file_id returned');
    }

    return { fileId };
  }

  // --- Voice Clone (enhanced) ---

  async cloneVoice(context: VoiceCloneContext): Promise<VoiceCloneResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot clone voice');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const payload: Record<string, unknown> = {
      file_id: context.fileId,
      voice_id: context.voiceId,
    };

    // 试听参数
    if (context.text) {
      console.log('[MiniMaxVoiceAdapter] clone voice text 入参', {
        text: context.text,
        length: context.text.length,
      });
      payload.text = context.text;
      payload.model = context.model || 'speech-2.8-hd';
    }

    // 示例音频
    if (context.promptAudioFileId) {
      if (context.promptText) {
        console.log('[MiniMaxVoiceAdapter] clone prompt_text 入参', {
          promptText: context.promptText,
          length: context.promptText.length,
        });
      }
      payload.clone_prompt = {
        prompt_audio: context.promptAudioFileId,
        ...(context.promptText ? { prompt_text: context.promptText } : {}),
      };
    }

    // 音频处理选项
    if (context.needNoiseReduction) payload.need_noise_reduction = true;
    if (context.needVolumeNormalization) payload.need_volume_normalization = true;
    if (context.languageBoost) payload.language_boost = context.languageBoost;
    if (context.aigcWatermark) payload.aigc_watermark = true;

    console.log('[MiniMaxVoiceAdapter] Cloning voice:', context.voiceId);

    const response = await axios.post(`${baseUrl}/voice_clone`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Voice Clone error');
    if (error) throw new Error(error);

    const previewAudioUrl = data?.demo_audio || data?.data?.audio_url || data?.extra_info?.audio_url;
    const extraInfo = data?.extra_info;

    return {
      voiceId: context.voiceId,
      previewAudioUrl,
      previewAudioHex: data?.data?.audio,
      inputSensitive: data?.input_sensitive,
      inputSensitiveType: data?.input_sensitive_type,
      usageCharacters: extraInfo?.usage_characters,
      audioLength: extraInfo?.audio_length,
    };
  }

  // --- Async T2A (enhanced) ---

  async createT2ATask(context: T2AAsyncContext): Promise<T2AAsyncResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot create T2A task');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const payload: Record<string, unknown> = {
      model: context.model || 'speech-2.8-hd',
      voice_setting: {
        voice_id: context.voiceId,
        speed: context.speed ?? 1,
        vol: context.vol ?? 1,
        pitch: context.pitch ?? 0,
      },
      audio_setting: {
        audio_sample_rate: context.sampleRate ?? 32000,
        bitrate: 128000,
        format: context.audioFormat || 'mp3',
        channel: context.channel ?? 1,
      },
      // P1 修复：language_boost 仅在用户显式指定时传递，原实现强制 'auto' 导致无法关闭语言增强
      ...(context.languageBoost ? { language_boost: context.languageBoost } : {}),
    };

    // 文本输入：直接文本 或 文件 ID
    if (context.textFileId) {
      payload.text_file_id = context.textFileId;
    } else if (context.text) {
      payload.text = context.text;
    }

    if (context.pronunciationDict) payload.pronunciation_dict = context.pronunciationDict;
    if (context.voiceModify) payload.voice_modify = context.voiceModify;
    if (context.aigcWatermark) payload.aigc_watermark = true;

    console.log('[MiniMaxVoiceAdapter] Creating T2A task, voice:', context.voiceId, 'text length:', context.text?.length || 0);

    const response = await axios.post(`${baseUrl}/t2a_async_v2`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax T2A error');
    if (error) throw new Error(error);

    const taskId = data?.data?.task_id || data?.task_id;
    if (!taskId) {
      console.error('[MiniMaxVoiceAdapter] T2A response:', JSON.stringify(data));
      throw new Error('T2A task creation failed — no task_id returned');
    }

    return {
      taskId,
      taskToken: data?.data?.task_token || data?.task_token,
      fileId: data?.data?.file_id || data?.file_id,
      usageCharacters: data?.data?.usage_characters || data?.usage_characters,
    };
  }

  async queryT2ATask(taskId: string): Promise<T2AAsyncStatus> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const response = await axios.get(`${baseUrl}/query/t2a_async_query_v2`, {
      params: {
        task_id: taskId,
        ...(config.minimaxGroupId ? { group_id: config.minimaxGroupId } : {}),
      },
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
      },
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const apiError = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg);
    if (apiError) {
      return {
        status: 'failed',
        errorMessage: apiError,
      };
    }

    const taskStatus = (data?.data?.status || data?.status || '').toLowerCase();

    if (taskStatus === 'success') {
      const audioFileId = data?.data?.audio_file_id || data?.file_id;
      const audioUrl = audioFileId ? this.getFileUrl(audioFileId) : undefined;
      const audioDuration = data?.data?.audio_duration;

      return {
        status: 'success',
        fileId: audioFileId,
        audioUrl,
        audioDuration,
      };
    }

    if (taskStatus === 'failed' || taskStatus === 'fail') {
      return {
        status: 'failed',
        errorMessage: data?.data?.error_msg || 'T2A task failed',
      };
    }

    if (taskStatus === 'expired') {
      return {
        status: 'expired',
        errorMessage: '任务已过期',
      };
    }

    // processing / pending / running / preparing / queueing
    return { status: 'processing' };
  }

  getFileUrl(fileId: string): string {
    const config = ApiConfigStore.load();
    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    return `${baseUrl}/files/retrieve_content?file_id=${fileId}`;
  }

  /**
   * 带 Bearer 认证下载音频文件，返回 Blob URL
   * MiniMax API 返回的音频 URL 和文件下载 URL 均需要 Authorization header，
   * 浏览器 <audio> 标签无法携带自定义 header，因此需要先 fetch 再创建 Blob URL。
   */
  async fetchAudioAsBlobUrl(audioUrl: string): Promise<string> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot fetch audio');
    }

    console.log('[MiniMaxVoiceAdapter] Fetching audio as blob:', audioUrl.substring(0, 80));

    const response = await axios.get(audioUrl, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
      responseType: 'arraybuffer',
    });

    // 验证响应是否为音频数据（而非 JSON 错误响应）
    const contentType = String(response.headers?.['content-type'] || '');
    const data = response.data as ArrayBuffer;

    // 如果响应是 JSON（错误响应），解析错误信息
    if (contentType.includes('application/json') || (data.byteLength < 1024 && this.isJsonArrayBuffer(data))) {
      const text = new TextDecoder().decode(data);
      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      if (parsed) {
        const statusCode = (parsed?.base_resp as Record<string, unknown>)?.status_code;
        const statusMsg = (parsed?.base_resp as Record<string, unknown>)?.status_msg;
        const errorMsg = getMiniMaxErrorMessage(statusCode as number, statusMsg as string, 'Audio fetch error');
        throw new Error(errorMsg || `Audio fetch failed: ${text.substring(0, 200)}`);
      }
    }

    // 确定正确的 MIME type：优先使用响应头，降级为 audio/mpeg
    const audioContentType = contentType.startsWith('audio/') ? contentType : 'audio/mpeg';
    const blob = new Blob([data], { type: audioContentType });
    return createTrackedObjectUrl(blob);
  }

  /** 检测 ArrayBuffer 是否为 JSON 内容 */
  private isJsonArrayBuffer(data: ArrayBuffer): boolean {
    try {
      const text = new TextDecoder().decode(data);
      return text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
    } catch {
      return false;
    }
  }

  // --- Synchronous T2A ---
  // 所有模型（含 speech-2.8）统一使用 MiniMax 官方端点 POST /v1/t2a_v2
  // 参考文档: https://platform.minimaxi.com/docs/api-reference/speech-t2a-http

  async synthesizeSpeechSync(context: T2ASyncContext): Promise<T2ASyncResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot synthesize speech');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const model = context.model || 'speech-2.8-turbo';

    const voiceSetting: Record<string, unknown> = {
      voice_id: context.voiceId,
      speed: context.speed ?? 1,
      vol: context.volume ?? 1,
      pitch: context.pitch ?? 0,
    };
    if (context.emotion) voiceSetting.emotion = context.emotion;

    // MiniMax 同步 TTS：直接透传原始文本
    const text = context.text;

    const payload: Record<string, unknown> = {
      model,
      text,
      voice_setting: voiceSetting,
      audio_setting: {
        sample_rate: context.sampleRate ?? 32000,
        bitrate: 128000,
        format: context.audioFormat || 'mp3',
        channel: context.channel ?? 1,
      },
      output_format: context.outputFormat || 'url',
      // P1 修复：language_boost 仅在用户显式指定时传递，原实现强制 'auto' 导致无法关闭语言增强
      ...(context.languageBoost ? { language_boost: context.languageBoost } : {}),
      ...(context.aigcWatermark !== undefined ? { aigc_watermark: context.aigcWatermark } : {}),
    };

    if (context.pronunciationDict) payload.pronunciation_dict = context.pronunciationDict;
    if (context.voiceModify) payload.voice_modify = context.voiceModify;
    if (context.subtitleEnable) {
      payload.subtitle_enable = true;
      if (context.subtitleType) payload.subtitle_type = context.subtitleType;
    }

    console.log('[MiniMaxVoiceAdapter] Sync T2A, model:', model, 'voice:', context.voiceId, 'text length:', context.text.length);

    const response = await axios.post(`${baseUrl}/t2a_v2`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Sync T2A error');
    if (error) throw new Error(error);

    // 音频数据解析：hex 优先（最可靠），URL 降级
    // MiniMax API 响应结构：
    //   - data.audio: hex 编码音频（output_format='hex' 时）或 URL 字符串（output_format='url' 时）
    //   - data.audio_url: 部分版本返回的 URL 字段
    //   - extra_info.audio_url: 部分版本返回的 URL 字段
    const rawAudio = data?.data?.audio;
    const audioUrl = data?.data?.audio_url || data?.extra_info?.audio_url;
    const audioHex = (rawAudio && !rawAudio.startsWith('http')) ? rawAudio : undefined;
    const resolvedAudioUrl = (rawAudio && rawAudio.startsWith('http')) ? rawAudio : audioUrl;
    const extraInfo = data?.extra_info;

    // 解析字幕
    let subtitles: Array<{ text: string; startTime: number; endTime: number }> | undefined;
    const subtitleData = data?.data?.subtitle || data?.subtitle;
    if (subtitleData && Array.isArray(subtitleData)) {
      subtitles = subtitleData.map((s: Record<string, unknown>) => ({
        text: s.text as string || s.content as string || '',
        startTime: s.begin_time as number || s.startTime as number || 0,
        endTime: s.end_time as number || s.endTime as number || 0,
      }));
    }

    return {
      audioUrl: resolvedAudioUrl,
      audioHex,
      audioLength: extraInfo?.audio_length,
      audioSize: extraInfo?.audio_size,
      usageCharacters: extraInfo?.usage_characters,
      subtitles,
    };
  }

  // --- WebSocket Streaming T2A (enhanced: proper task_start/task_continue/task_finish protocol) ---

  synthesizeSpeechStream(context: T2ASyncContext, callbacks: T2AStreamCallbacks): T2AStreamHandle {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      const error = new Error('API Key not configured — cannot stream speech');
      callbacks.onError?.(error);
      return { close: () => {} };
    }

    // WebSocket 端点: wss://api.minimaxi.com/ws/v1/t2a_v2
    // 注意: baseUrl 是 https://api.minimaxi.com/v1，需要去掉 /v1 再拼接 /ws/v1/t2a_v2
    // P1 修复：WebSocket 握手无法设置 Authorization 头，通过 URL query 传递 apikey 鉴权
    const baseHost = config.minimaxBaseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
    const wsBaseUrl = `${baseHost.replace(/^https?:/, (m) => m === 'https:' ? 'wss:' : 'ws:')}/ws/v1/t2a_v2`;
    const wsUrl = `${wsBaseUrl}?apikey=${encodeURIComponent(config.minimaxApiKey)}`;

    let ws: WebSocket | null = null;
    let closed = false;
    let taskStarted = false;

    const close = () => {
      if (closed) return;
      closed = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      ws = null;
    };

    const sendText = (text: string) => {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN || !taskStarted) return;
      try {
        ws.send(JSON.stringify({ event: 'task_continue', text }));
      } catch (e) {
        callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const finish = () => {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN || !taskStarted) return;
      try {
        ws.send(JSON.stringify({ event: 'task_finish' }));
      } catch (e) {
        callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
      return { close, sendText, finish };
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (closed || !ws) return;
      // 发送 task_start 事件
      const voiceSetting: Record<string, unknown> = {
        voice_id: context.voiceId,
        speed: context.speed ?? 1,
        vol: context.volume ?? 1,
        pitch: context.pitch ?? 0,
      };
      if (context.emotion) voiceSetting.emotion = context.emotion;

      const payload: Record<string, unknown> = {
        event: 'task_start',
        model: context.model || 'speech-2.8-turbo',
        voice_setting: voiceSetting,
        audio_setting: {
          audio_sample_rate: context.sampleRate ?? 32000,
          bitrate: 128000,
          format: context.audioFormat || 'mp3',
          channel: context.channel ?? 1,
        },
        // P1 修复：WebSocket task_start 携带 group_id 辅助鉴权（与 URL apikey 双重保障）
        ...(config.minimaxGroupId ? { group_id: config.minimaxGroupId } : {}),
        // P1 修复：language_boost 仅在显式指定时传递，不再强制 'auto'
        ...(context.languageBoost ? { language_boost: context.languageBoost } : {}),
      };

      if (context.pronunciationDict) payload.pronunciation_dict = context.pronunciationDict;

      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
        close();
      }
    };

    ws.onmessage = (event) => {
      if (closed) return;

      if (event.data instanceof ArrayBuffer) {
        callbacks.onAudioChunk(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then(buf => callbacks.onAudioChunk(buf)).catch(() => {});
        return;
      }

      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          const eventType = parsed.event;

          if (eventType === 'connected_success') {
            // 建连成功
            return;
          }

          if (eventType === 'task_started') {
            taskStarted = true;
            // 如果有初始文本，发送 task_continue
            if (context.text) {
              try {
                ws?.send(JSON.stringify({ event: 'task_continue', text: context.text }));
              } catch (e) {
                callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
              }
            }
            return;
          }

          if (eventType === 'task_continued') {
            // 收到音频 chunk
            if (parsed.data?.audio) {
              // hex 编码音频
              const hex = parsed.data.audio as string;
              const bytes = new Uint8Array(hex.length / 2);
              for (let i = 0; i < hex.length; i += 2) {
                bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
              }
              callbacks.onAudioChunk(bytes.buffer);
            }

            // 字幕
            if (parsed.data?.subtitle) {
              const sub = parsed.data.subtitle;
              if (Array.isArray(sub)) {
                for (const s of sub) {
                  callbacks.onSubtitle?.({
                    text: s.text || s.content || '',
                    startTime: s.begin_time || s.startTime || 0,
                    endTime: s.end_time || s.endTime || 0,
                  });
                }
              }
            }

            if (parsed.is_final) {
              callbacks.onComplete?.(parsed.extra_info?.audio_length);
              close();
            }
            return;
          }

          if (eventType === 'task_finished') {
            callbacks.onComplete?.();
            close();
            return;
          }

          if (eventType === 'task_failed') {
            const msg = getMiniMaxErrorMessage(parsed.base_resp?.status_code, parsed.base_resp?.status_msg, 'T2A Stream task failed');
            callbacks.onError?.(new Error(msg || 'T2A stream task failed'));
            close();
            return;
          }

          // 兼容旧协议
          if (parsed.base_resp?.status_code && parsed.base_resp.status_code !== 0) {
            const msg = getMiniMaxErrorMessage(parsed.base_resp.status_code, parsed.base_resp.status_msg, 'T2A Stream error');
            if (msg) {
              callbacks.onError?.(new Error(msg));
              close();
            }
          } else if (parsed.type === 'done' || parsed.audio_length) {
            callbacks.onComplete?.(parsed.audio_length);
            close();
          }
        } catch {
          // ignore non-JSON messages
        }
      }
    };

    ws.onerror = (event) => {
      if (closed) return;
      const message = (event as ErrorEvent).message || 'WebSocket error';
      callbacks.onError?.(new Error(message));
    };

    ws.onclose = () => {
      if (closed) return;
      closed = true;
      callbacks.onComplete?.();
    };

    return { close, sendText, finish };
  }

  // --- Voice Design (enhanced) ---

  async designVoice(prompt: string, previewText: string, voiceId?: string, aigcWatermark?: boolean): Promise<VoiceDesignResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot design voice');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    console.log('[MiniMaxVoiceAdapter] design voice 入参', {
      prompt,
      promptLength: prompt.length,
      previewText,
      previewLength: previewText.length,
    });

    const payload: Record<string, unknown> = {
      prompt,
      preview_text: previewText,
    };

    if (voiceId) {
      payload.voice_id = voiceId;
    }

    if (aigcWatermark) {
      payload.aigc_watermark = true;
    }

    const response = await axios.post(`${baseUrl}/voice_design`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Voice Design error');
    if (error) throw new Error(error);

    const resultVoiceId = data?.data?.voice_id || data?.voice_id;
    const trialAudioHex = data?.data?.trial_audio || data?.trial_audio;

    if (!resultVoiceId) {
      console.error('[MiniMaxVoiceAdapter] Voice Design response:', JSON.stringify(data));
      throw new Error('Voice Design failed — no voice_id returned');
    }

    return {
      voiceId: resultVoiceId,
      trialAudioHex: trialAudioHex || '',
    };
  }

  // --- Get Available Voices (enhanced) ---

  async getAvailableVoices(voiceType: VoiceType): Promise<VoiceListResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot get voices');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const payload: Record<string, unknown> = {
      voice_type: voiceType,
    };

    console.log('[MiniMaxVoiceAdapter] getAvailableVoices request:', JSON.stringify({ url: `${baseUrl}/get_voice`, payload }));

    const response = await axios.post(`${baseUrl}/get_voice`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    console.log('[MiniMaxVoiceAdapter] getAvailableVoices response:', JSON.stringify(data));

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Get Voice error');
    if (error) throw new Error(error);

    const result: VoiceListResult = {};

    // 防御性辅助：安全地将单条原始 voice 映射为 VoiceInfo
    const mapVoice = (v: unknown, type: 'system' | 'voice_cloning' | 'voice_generation') => {
      const obj = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
      const voiceId = String(obj.voice_id ?? obj.voiceId ?? '');
      const descRaw = obj.description ?? obj.voice_desc;
      const description = Array.isArray(descRaw)
        ? descRaw.join('；')
        : (typeof descRaw === 'string' ? descRaw : '');
      return {
        voiceId,
        description,
        voiceName: String(obj.voice_name ?? obj.name ?? obj.voice_id ?? ''),
        createdTime: (obj.created_time ?? obj.create_time) as string | undefined,
        type,
        isActive: true,
      };
    };

    const systemVoices = data?.data?.system_voice || data?.system_voice;
    if (Array.isArray(systemVoices)) {
      result.systemVoices = systemVoices
        .filter((v): v is Record<string, unknown> => v != null && typeof v === 'object')
        .map((v) => mapVoice(v, 'system'));
    }

    const clonedVoices = data?.data?.voice_cloning || data?.voice_cloning;
    if (Array.isArray(clonedVoices)) {
      result.clonedVoices = clonedVoices
        .filter((v): v is Record<string, unknown> => v != null && typeof v === 'object')
        .map((v) => mapVoice(v, 'voice_cloning'));
    }

    const designedVoices = data?.data?.voice_generation || data?.voice_generation;
    if (Array.isArray(designedVoices)) {
      result.designedVoices = designedVoices
        .filter((v): v is Record<string, unknown> => v != null && typeof v === 'object')
        .map((v) => mapVoice(v, 'voice_generation'));
    }

    return result;
  }

  // --- Delete Voice ---

  async deleteVoice(voiceType: 'voice_cloning' | 'voice_generation', voiceId: string): Promise<void> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot delete voice');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const payload = {
      voice_type: voiceType,
      voice_id: voiceId,
    };

    console.log('[MiniMaxVoiceAdapter] Deleting voice:', voiceId, 'type:', voiceType);

    const response = await axios.post(`${baseUrl}/delete_voice`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Delete Voice error');
    if (error) throw new Error(error);
  }
}
