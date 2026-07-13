import axios, { type AxiosInstance, isAxiosError } from 'axios';
import type { ApiConfig } from '../../config/ApiConfigStore';
import type { T2AStreamCallbacks, T2AStreamHandle } from '../../../../domain/ports/OutboundPorts';
import { parseCloneError, parseTtsError, type SpeakerStatus } from './VolcengineVoiceErrorUtils';
import { VolcengineApiError } from './VolcengineErrorUtils';

/** 火山引擎语音技术基础域名（与方舟 Ark 域名分离） */
const SPEECH_BASE_URL = 'https://openspeech.bytedance.com';

/**
 * P0 修复：从未知错误中提取 HTTP 状态码。
 * - AxiosError 且有 response：返回 response.status（如 429/500/502/503/504）
 * - AxiosError 无 response（网络错误/超时）：返回 503（视为服务不可用，可重试）
 * - 非 axios 错误：返回 0（不可重试，保持原行为）
 */
function extractHttpStatus(err: unknown): number {
  if (isAxiosError(err)) {
    return err.response?.status ?? 503;
  }
  return 0;
}

/** 声音复刻资源 ID（固定值，区分 ICL 版本） */
const RESOURCE_ID = 'seed-icl-1.0';

/** 声音复刻 upload 接口响应 */
export interface SpeakerUploadResult {
  statusCode: number;
  statusMessage: string;
  speakerId: string;
}

/** 声音复刻 status 接口响应 */
export interface SpeakerStatusResult {
  status: SpeakerStatus;
  demoAudio?: string;
  version?: string;
  createTime?: number;
}

/** TTS 合成结果（HTTP 非流式） */
export interface TtsSyncResult {
  audioBase64: string;
  duration?: string;
  reqid: string;
}

/**
 * 火山引擎原生语音技术 HTTP / WebSocket 客户端。
 *
 * 与 VolcengineHttpClient（方舟 Ark）分离的原因：
 *  - 域名不同：openspeech.bytedance.com vs ark.cn-beijing.volces.com
 *  - 鉴权不同：`Authorization: Bearer;<Token>` + AppID + Cluster
 *    （注意 Bearer 与 Token 之间用分号分隔，与标准 Bearer Token 不同）
 *  - 错误码不同：声音复刻 1001/1101/1106 等，TTS 3001/3050 等
 *
 * 能力范围：
 *  - 声音复刻：上传训练音频 + 查询训练状态
 *  - 大模型 TTS：HTTP 非流式 + WebSocket V1 二进制流式
 *
 * 文档参考：
 *  - 声音复刻：https://www.volcengine.com/docs/6561/1305191
 *  - 大模型 TTS：https://www.volcengine.com/docs/6561/1257584
 *  - WebSocket 协议：https://www.volcengine.com/docs/6561/79821
 */
export class VolcengineSpeechClient {
  private config: ApiConfig;
  private client: AxiosInstance;

  constructor(config: ApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: SPEECH_BASE_URL,
      timeout: 60_000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer;${config.volcVoiceAccessToken}`,
        'Resource-Id': RESOURCE_ID,
      },
    });
  }

  /** 校验语音技术配置完整性（AppID / Token / Cluster 三件套） */
  ensureConfigured(): void {
    if (!this.config.volcVoiceAppId.trim() ||
        !this.config.volcVoiceAccessToken.trim() ||
        !this.config.volcVoiceCluster.trim()) {
      throw new VolcengineApiError(
        0,
        'VOICE_NOT_CONFIGURED',
        '火山引擎语音技术未配置完整，请在设置页填写 AppID / Access Token / Cluster',
      );
    }
  }

  /** 上传训练音频（声音复刻）— 训练为异步过程，需轮询 querySpeakerStatus */
  async uploadSpeakerAudio(params: {
    speakerId: string;
    audioBytes: string;  // base64 编码
    audioFormat: string;
    language?: number;
    modelType?: number;
    extraParams?: Record<string, unknown>;
  }): Promise<SpeakerUploadResult> {
    this.ensureConfigured();
    const body = {
      appid: this.config.volcVoiceAppId,
      speaker_id: params.speakerId,
      audios: [{
        audio_bytes: params.audioBytes,
        audio_format: params.audioFormat,
      }],
      source: 2,
      language: params.language ?? 0,
      model_type: params.modelType ?? this.config.volcVoiceCloneModelType,
      extra_params: JSON.stringify(params.extraParams ?? {}),
    };
    try {
      const resp = await this.client.post('/api/v1/mega_tts/audio/upload', body);
      const statusCode: number = resp.data?.BaseResp?.StatusCode ?? -1;
      const statusMessage: string = resp.data?.BaseResp?.StatusMessage ?? '';
      if (statusCode !== 0) {
        throw parseCloneError(statusCode, statusMessage, 200);
      }
      return {
        statusCode,
        statusMessage,
        speakerId: resp.data.speaker_id,
      };
    } catch (err) {
      if (err instanceof VolcengineApiError) throw err;
      throw parseCloneError(-1, (err as Error).message, extractHttpStatus(err));
    }
  }

  /** 查询声音复刻训练状态 */
  async querySpeakerStatus(speakerId: string): Promise<SpeakerStatusResult> {
    this.ensureConfigured();
    const body = { appid: this.config.volcVoiceAppId, speaker_id: speakerId };
    try {
      const resp = await this.client.post('/api/v1/mega_tts/status', body);
      return {
        status: (resp.data?.status ?? 0) as SpeakerStatus,
        demoAudio: resp.data?.demo_audio,
        version: resp.data?.version,
        createTime: resp.data?.create_time,
      };
    } catch (err) {
      if (err instanceof VolcengineApiError) throw err;
      throw parseCloneError(-1, (err as Error).message, extractHttpStatus(err));
    }
  }

  /** HTTP 非流式 TTS（operation=query，一次性返回完整音频） */
  async synthesizeSync(params: {
    text: string;
    voiceType: string;
    encoding?: string;
    speedRatio?: number;
    volumeRatio?: number;
  }): Promise<TtsSyncResult> {
    this.ensureConfigured();
    const reqid = this.generateReqid();
    const body = {
      app: {
        appid: this.config.volcVoiceAppId,
        token: 'access_token',  // token 已在 Header 中鉴权，body 内 token 字段仅占位
        cluster: this.config.volcVoiceCluster,
      },
      user: { uid: 'ai-video-studio' },
      audio: {
        voice_type: params.voiceType,
        encoding: params.encoding ?? 'mp3',
        speed_ratio: params.speedRatio ?? 1.0,
        volume_ratio: params.volumeRatio ?? 1.0,
      },
      request: {
        reqid,
        text: params.text,
        text_type: 'plain',
        operation: 'query',
      },
    };
    try {
      const resp = await this.client.post('/api/v1/tts', body);
      const code: number = resp.data?.code ?? -1;
      if (code !== 3000) {
        throw parseTtsError(code, resp.data?.message ?? 'TTS synthesis failed', 200);
      }
      return {
        audioBase64: resp.data.data,
        duration: resp.data?.addition?.duration,
        reqid: resp.data?.reqid ?? reqid,
      };
    } catch (err) {
      if (err instanceof VolcengineApiError) throw err;
      throw parseTtsError(-1, (err as Error).message, extractHttpStatus(err));
    }
  }

  /**
   * 创建 WebSocket V1 流式 TTS 连接（二进制协议）。
   *
   * 协议要点（参考 https://www.volcengine.com/docs/6561/79821）：
   *  - 报头 4 字节：协议版本(4bit) + 报头大小(4bit) + 消息类型(4bit) + 消息标志(4bit)
   *                  + 序列化方法(4bit) + 压缩方法(4bit) + 保留(8bit)
   *  - 客户端请求消息类型 = 0b0001（full client request），序列化 = 0b0001（JSON）
   *  - 服务端响应消息类型 = 0b1011（audio-only），0b1111（error）
   *  - sequence < 0 表示合成完毕
   *
   * @returns T2AStreamHandle 用于关闭连接
   */
  createStreamWebSocket(params: {
    text: string;
    voiceType: string;
    encoding?: string;
  }, callbacks: T2AStreamCallbacks): T2AStreamHandle {
    this.ensureConfigured();
    const wsUrl = `wss://openspeech.bytedance.com/api/v1/tts/ws_binary`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    let closed = false;

    ws.onopen = () => {
      const reqid = this.generateReqid();
      const payload = JSON.stringify({
        app: {
          appid: this.config.volcVoiceAppId,
          token: 'access_token',
          cluster: this.config.volcVoiceCluster,
        },
        user: { uid: 'ai-video-studio' },
        audio: {
          voice_type: params.voiceType,
          encoding: params.encoding ?? 'mp3',
        },
        request: {
          reqid,
          text: params.text,
          operation: 'submit',
        },
      });
      // 构造二进制报文：4 字节报头 + JSON payload
      // 报头：00010001 00010000 00010000 00000000
      //       protocol=1, headerSize=1, msgType=1(full request), flags=0, serialization=1(JSON), compression=0
      const header = new Uint8Array([0x11, 0x10, 0x10, 0x00]);
      const payloadBytes = new TextEncoder().encode(payload);
      const msg = new Uint8Array(header.length + payloadBytes.length);
      msg.set(header, 0);
      msg.set(payloadBytes, header.length);
      ws.send(msg);
    };

    ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer;
      const view = new DataView(data);
      if (data.byteLength < 4) return;
      // 第 1 字节高 4 位 = 协议版本，第 1 字节低 4 位 = 报头大小
      // 第 2 字节高 4 位 = 消息类型，第 2 字节低 4 位 = 消息标志
      const msgType = (view.getUint8(1) >> 4) & 0x0F;
      const flags = view.getUint8(1) & 0x0F;

      if (msgType === 0b1011) {
        // audio-only response
        const hasSeq = flags === 0b0001 || flags === 0b0010 || flags === 0b0011;
        let audioOffset = 4;
        let seq = 0;
        if (hasSeq && data.byteLength >= 8) {
          seq = view.getInt32(4, false);  // 大端序
          audioOffset = 8;
        }
        const audioBytes = new Uint8Array(data, audioOffset);
        if (audioBytes.byteLength > 0) {
          callbacks.onAudioChunk(audioBytes.buffer);
        }
        if (seq < 0) {
          callbacks.onComplete?.();
          if (!closed) {
            closed = true;
            ws.close();
          }
        }
      } else if (msgType === 0b1111) {
        // error response
        const errorPayload = new TextDecoder().decode(new Uint8Array(data, 4));
        callbacks.onError?.(new Error(`Volcengine TTS stream error: ${errorPayload}`));
        if (!closed) {
          closed = true;
          ws.close();
        }
      }
    };

    ws.onerror = () => {
      if (!closed) {
        closed = true;
        callbacks.onError?.(new Error('Volcengine TTS WebSocket error'));
      }
    };

    ws.onclose = () => {
      if (!closed) {
        closed = true;
        callbacks.onComplete?.();
      }
    };

    return {
      close: () => {
        if (!closed && ws.readyState === WebSocket.OPEN) {
          closed = true;
          ws.close();
        }
      },
    };
  }

  /** 生成 UUID v4 作为 reqid（兼容 crypto.randomUUID 不存在的环境） */
  private generateReqid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ==================== 声音转换 (Voice Conversion) ====================

  /**
   * 流式声音转换（WebSocket V1 二进制协议）。
   *
   * 协议参考：https://www.volcengine.com/docs/6561/215896
   *  - 接口：wss://openspeech.bytedance.com/api/v1/voice_conv/ws
   *  - 鉴权：Authorization: Bearer;{token}（浏览器 WS 不支持自定义头，通过 body app.token 鉴权）
   *  - 输入：PCM 16k 16bit 单声道（由调用方解码并重采样）
   *  - 输出：wav/pcm/mp3/ogg_opus
   *
   * 报文格式（大端序）：
   *  - Full client request: Header(4B) + PayloadSize(4B) + Payload(JSON)
   *  - Audio-only client request: Header(4B) + Sequence(4B) + PayloadSize(4B) + Payload(raw PCM)
   *  - Audio-only server response: Header(4B) + [Sequence(4B)] + PayloadSize(4B) + Payload(raw audio)
   *
   * @returns 转换后的音频字节与编码格式
   */
  convertVoiceStream(params: {
    pcmBytes: Uint8Array;
    voiceType: string;
    encoding?: string;
    rate?: number;
    pitchRatio?: number;
    volumeRatio?: number;
  }): Promise<{ audioBytes: Uint8Array; encoding: string }> {
    this.ensureConfigured();

    const encoding = params.encoding ?? 'mp3';
    const rate = params.rate ?? 24000;
    const wsUrl = 'wss://openspeech.bytedance.com/api/v1/voice_conv/ws';

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      let closed = false;
      const audioChunks: Uint8Array[] = [];

      const cleanup = () => {
        if (!closed) {
          closed = true;
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        }
      };

      ws.onopen = () => {
        // 1. 发送 full client request（JSON 配置）
        const reqid = this.generateReqid();
        const config = JSON.stringify({
          app: {
            appid: this.config.volcVoiceAppId,
            token: this.config.volcVoiceAccessToken,
            cluster: this.config.volcVoiceCluster,
          },
          user: { uid: 'ai-video-studio' },
          audio: {
            voice: 'other',
            voice_type: params.voiceType,
            encoding,
            rate,
            pitch_ratio: params.pitchRatio ?? 1.0,
            volume_ratio: params.volumeRatio ?? 1.0,
          },
          request: {
            reqid,
            operation: 'submit',
            sequence: 0,
          },
        });
        this.sendFullClientRequest(ws, config);

        // 2. 等待 ACK 后分片发送 PCM 音频
        // ACK 到达后由 onmessage 触发 startStreaming
      };

      let streamingStarted = false;

      ws.onmessage = (event) => {
        const data = event.data as ArrayBuffer;
        if (data.byteLength < 4) return;
        const view = new DataView(data);
        const msgType = (view.getUint8(1) >> 4) & 0x0F;
        const flags = view.getUint8(1) & 0x0F;

        if (msgType === 0b1111) {
          // 错误响应
          const errorPayload = new TextDecoder().decode(new Uint8Array(data, 4));
          cleanup();
          reject(new VolcengineApiError(0, 'VC_ERROR', `声音转换失败: ${errorPayload}`));
          return;
        }

        if (msgType === 0b1011) {
          // audio-only server response
          if (flags === 0b0000) {
            // ACK（full client request 的确认），开始流式发送音频
            if (!streamingStarted) {
              streamingStarted = true;
              this.streamAudioChunks(ws, params.pcmBytes, () => {
                // 外层不再跟踪 seq,序列号由 streamAudioChunks 内部管理
              });
            }
            return;
          }

          // 提取音频数据：flags 指示是否有 sequence
          const hasSeq = flags === 0b0001 || flags === 0b0010 || flags === 0b0011;
          let offset = 4; // 跳过 header
          if (hasSeq && data.byteLength >= 8) {
            const serverSeq = view.getInt32(4, false); // 大端序
            offset = 8;
            if (serverSeq < 0) {
              // 最后一包：提取剩余音频后完成
              this.extractAudioPayload(data, offset, audioChunks);
              const merged = this.mergeUint8Arrays(audioChunks);
              cleanup();
              resolve({ audioBytes: merged, encoding });
              return;
            }
          }
          // 普通音频包
          this.extractAudioPayload(data, offset, audioChunks);
        }
      };

      ws.onerror = () => {
        if (!closed) {
          cleanup();
          reject(new VolcengineApiError(0, 'VC_WS_ERROR', '声音转换 WebSocket 连接失败'));
        }
      };

      ws.onclose = () => {
        if (!closed) {
          // 连接关闭但未收到结束包，若已有数据则返回
          if (audioChunks.length > 0) {
            const merged = this.mergeUint8Arrays(audioChunks);
            resolve({ audioBytes: merged, encoding });
          } else {
            reject(new VolcengineApiError(0, 'VC_CLOSED', '声音转换连接异常关闭'));
          }
        }
      };

      // 超时保护（60 秒）
      setTimeout(() => {
        if (!closed) {
          cleanup();
          reject(new VolcengineApiError(0, 'VC_TIMEOUT', '声音转换超时'));
        }
      }, 60_000);
    });
  }

  /** 发送 full client request（Header + PayloadSize + Payload） */
  private sendFullClientRequest(ws: WebSocket, jsonPayload: string): void {
    const header = new Uint8Array([0x11, 0x10, 0x10, 0x00]); // proto=1, headerSize=1, msgType=1(full), flags=0, serial=1(JSON), compress=0
    const payloadBytes = new TextEncoder().encode(jsonPayload);
    const payloadSize = new ArrayBuffer(4);
    new DataView(payloadSize).setUint32(0, payloadBytes.byteLength, false); // 大端序
    const msg = new Uint8Array(header.length + 4 + payloadBytes.length);
    msg.set(header, 0);
    msg.set(new Uint8Array(payloadSize), header.length);
    msg.set(payloadBytes, header.length + 4);
    ws.send(msg);
  }

  /** 分片发送 PCM 音频（audio-only request，每片 ~200ms = 6400 bytes） */
  private streamAudioChunks(ws: WebSocket, pcmBytes: Uint8Array, onSeq: (seq: number) => void): void {
    const CHUNK_SIZE = 6400; // 16k * 16bit * 0.2s = 6400 bytes
    let offset = 0;
    let seq = 1;

    const sendNext = () => {
      if (offset >= pcmBytes.byteLength) return;
      const end = Math.min(offset + CHUNK_SIZE, pcmBytes.byteLength);
      const isLast = end >= pcmBytes.byteLength;
      const chunk = pcmBytes.slice(offset, end);
      const currentSeq = isLast ? -seq : seq;

      // Header: msgType=0b0010(audio-only), flags=0b0001(seq>0) 或 0b0011(seq<0, last)
      const flags = isLast ? 0b0011 : 0b0001;
      const header = new Uint8Array([0x11, (0x02 << 4) | flags, 0x00, 0x00]);

      const seqBuf = new ArrayBuffer(4);
      new DataView(seqBuf).setInt32(0, currentSeq, false); // 大端序

      const payloadSize = new ArrayBuffer(4);
      new DataView(payloadSize).setUint32(0, chunk.byteLength, false);

      const msg = new Uint8Array(header.length + 4 + 4 + chunk.byteLength);
      msg.set(header, 0);
      msg.set(new Uint8Array(seqBuf), header.length);
      msg.set(new Uint8Array(payloadSize), header.length + 4);
      msg.set(chunk, header.length + 8);

      ws.send(msg);

      seq++;
      onSeq(seq);
      offset = end;

      if (!isLast) {
        // 间隔 ~100ms 发送下一片，避免服务端过载
        setTimeout(sendNext, 100);
      } else {
        // 发送完毕，等待服务端返回最后一包
      }
    };

    sendNext();
  }

  /** 从服务端响应中提取音频 payload（跳过 header + 可选 sequence + payloadSize） */
  private extractAudioPayload(data: ArrayBuffer, offset: number, chunks: Uint8Array[]): void {
    // offset 已跳过 header 和可能的 sequence，接下来 4 字节是 payloadSize
    if (data.byteLength < offset + 4) return;
    const payloadSize = new DataView(data).getUint32(offset, false);
    const payloadStart = offset + 4;
    if (payloadSize > 0 && data.byteLength >= payloadStart + payloadSize) {
      chunks.push(new Uint8Array(data, payloadStart, payloadSize));
    } else if (data.byteLength > payloadStart) {
      // payloadSize 为 0 或不匹配时，取剩余全部
      chunks.push(new Uint8Array(data, payloadStart));
    }
  }

  /** 合并多个 Uint8Array */
  private mergeUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((sum, arr) => sum + arr.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
      merged.set(arr, offset);
      offset += arr.byteLength;
    }
    return merged;
  }
}
