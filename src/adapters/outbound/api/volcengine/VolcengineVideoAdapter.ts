import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult, VideoAgentContext, VideoAgentTaskResult,
} from '../../../../domain/ports/OutboundPorts';
import type { VideoResolution } from '../../../../domain/entities/models';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';

/**
 * 火山引擎视频生成适配器（Seedance 系列模型）。
 *
 * 接口映射：
 *   IVideoGeneratorPort.submitVideoTask  → POST /contents/generations/tasks（返回 task_id 字符串）
 *   IVideoGeneratorPort.queryTaskStatus  → GET  /contents/generations/tasks/{task_id}
 *   IVideoGeneratorPort.downloadVideo    → 从 queryTask 结果中提取 video_url
 *
 * 双协议并存架构（澄清项 1）：
 *   - 本 Adapter 永远走 OpenAI 协议（火山方舟视频生成仅支持 OpenAI 兼容端点），
 *     与 config.volcArkTextProtocol 选择无关。
 *   - 协议选择由 VolcengineHttpClient.createOpenAI 显式注入。
 *
 * 多模态支持（澄清项 2）：
 *   - 人物形象：content[].type='image_url' + role='reference_image'（1-9 张）
 *   - 人物音色：content[].type='audio_url' + role='reference_audio'（1-3 段，mp3/wav，≤15s，仅 Seedance 2.0 系列）
 *   - 自动配音：body 字段 generate_audio=true（与 reference_audio 互斥）
 *
 * 注意：
 *   - 火山引擎无 createAgentTask / queryAgentTask 概念，这两个方法抛出 NotImplementedError
 *   - video_url 有效期 24 小时
 */
export class VolcengineVideoAdapter implements IVideoGeneratorPort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;
  private logger: ILoggerPort;

  constructor(config: ApiConfig, logger: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    // 双协议并存架构：Video 永远走 OpenAI 协议
    this.http = VolcengineHttpClient.createOpenAI(config);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'VolcengineVideoAdapter', ...extra };
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    if (!this.config.volcArkOpenAiApiKey.trim()) {
      throw new Error('请先在设置中配置火山引擎的 API Key');
    }

    const payload = this.buildPayload(context);

    this.logger.info('submitVideoTask 入参', this.ctx({
      method: 'submitVideoTask',
      prompt: context.prompt,
      promptLength: context.prompt?.length ?? 0,
      model: payload.model as string,
      hasFirstFrame: !!context.firstFrameImage,
      hasLastFrame: !!context.lastFrameImage,
      hasSubjectRef: !!(context.subjectReference && context.subjectReference.length > 0),
      hasReferenceAudio: !!(context.referenceAudioUrls && context.referenceAudioUrls.length > 0),
      referenceAudioCount: context.referenceAudioUrls?.length ?? 0,
      generateAudio: context.generateAudio ?? false,
      resolution: payload.resolution,
      duration: payload.duration,
      ratio: payload.ratio,
      watermark: payload.watermark,
    }));

    const result = await withRetry(() =>
      this.http.post<{ id: string }>('/contents/generations/tasks', payload),
    );

    this.logger.info('submitVideoTask 出参', this.ctx({
      method: 'submitVideoTask',
      taskId: result.id,
    }));

    return result.id;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    if (!this.config.volcArkOpenAiApiKey.trim()) {
      throw new Error('请先在设置中配置火山引擎的 API Key');
    }

    const result = await this.http.get<VolcengineTaskResponse>(`/contents/generations/tasks/${taskId}`);

    this.logger.info('queryTaskStatus 出参', this.ctx({
      method: 'queryTaskStatus',
      taskId,
      status: result.status,
      hasVideoUrl: !!result.content?.video_url,
      hasLastFrameUrl: !!result.content?.last_frame_url,
      usageTokens: result.usage?.completion_tokens,
      seed: result.seed,
      resolution: result.resolution,
      ratio: result.ratio,
      duration: result.duration,
    }));

    return {
      status: this.mapStatus(result.status),
      videoUrl: result.content?.video_url,
      lastFrameUrl: result.content?.last_frame_url,
      usageTokens: result.usage?.completion_tokens,
      seed: result.seed,
      resolution: result.resolution,
      ratio: result.ratio,
      duration: result.duration,
      errorMessage: result.error?.message,
    };
  }

  async downloadVideo(fileIdOrUrl: string): Promise<VideoDownloadResult> {
    // 火山引擎返回的是直接 video_url，无需额外下载接口
    return {
      downloadUrl: fileIdOrUrl,
      filename: `volc-video-${Date.now()}.mp4`,
      bytes: 0,
      createdAt: Date.now(),
    };
  }

  // 火山引擎不支持 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('火山引擎视频生成不支持 Agent 模板模式');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('火山引擎视频生成不支持 Agent 模板模式');
  }

  // ===== 私有方法 =====

  /**
   * 将 VideoPromptContext 转换为火山引擎 API 请求体。
   * Seedance API 使用 content[] 数组格式（多模态输入：text + image_url + audio_url）。
   */
  private buildPayload(context: VideoPromptContext): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [];

    // 文本提示词（直接透传原始 prompt，不做截断）
    if (context.prompt) {
      content.push({ type: 'text', text: context.prompt });
    }

    // 首帧图片
    if (context.firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: context.firstFrameImage },
        role: 'first_frame',
      });
    }

    // 尾帧图片
    if (context.lastFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: context.lastFrameImage },
        role: 'last_frame',
      });
    }

    // 参考图（人物形象，1-9 张，role=reference_image）
    if (context.subjectReference && context.subjectReference.length > 0) {
      for (const ref of context.subjectReference) {
        if (ref.image && ref.image.length > 0) {
          content.push({
            type: 'image_url',
            image_url: { url: ref.image[0] },
            role: 'reference_image',
          });
        }
      }
    }

    // 参考音频（人物音色，1-3 段，mp3/wav，≤15s，仅 Seedance 2.0 系列）
    if (context.referenceAudioUrls && context.referenceAudioUrls.length > 0) {
      // 火山引擎限制最多 3 段，超出截断前 3 段
      const audioUrls = context.referenceAudioUrls.slice(0, 3);
      for (const audioUrl of audioUrls) {
        content.push({
          type: 'audio_url',
          audio_url: { url: audioUrl },
          role: 'reference_audio',
        });
      }
    }

    const model = context.model || 'doubao-seedance-2-0-260128';
    const isSeedance2 = model.startsWith('doubao-seedance-2-0');

    // Seedance 1.0 系列不支持参考音频，自动忽略并告警
    if (!isSeedance2 && content.some(c => c.type === 'audio_url')) {
      this.logger.warn('referenceAudioUrls provided but model is not Seedance 2.0, ignoring audio', this.ctx({
        method: 'buildPayload',
        model,
      }));
      // 移除已添加的 audio_url 条目
      for (let i = content.length - 1; i >= 0; i--) {
        if (content[i].type === 'audio_url') {
          content.splice(i, 1);
        }
      }
    }

    const payload: Record<string, unknown> = {
      model,
      content,
    };

    // === 官方推荐：request body 直接传参（强校验）===
    // 分辨率（480p / 720p / 1080p / 4k）
    if (context.resolution) {
      payload.resolution = this.mapResolution(context.resolution);
    }

    // 时长（火山引擎区间 [4, 15]，UI 提供 6/10 选项直接透传）
    if (context.duration) {
      payload.duration = context.duration;
    }

    // 宽高比（默认 16:9 横屏）
    payload.ratio = this.inferRatio();

    // 水印（aigcWatermark 默认 true，与平台默认行为一致）
    payload.watermark = context.aigcWatermark ?? true;

    // 回调 URL（可选）
    if (context.callbackUrl) {
      payload.callback_url = context.callbackUrl;
    }

    // === generate_audio（与 referenceAudioUrls 互斥）===
    const hasReferenceAudio = isSeedance2
      && content.some(c => c.type === 'audio_url');
    if (context.generateAudio && !hasReferenceAudio) {
      payload.generate_audio = true;
    }

    return payload;
  }

  /** 系统内部 resolution → 火山引擎 resolution 映射 */
  private mapResolution(resolution: VideoResolution): string {
    // VideoResolution 类型为 '512P' | '720P' | '768P' | '1080P'（大写 P 后缀）
    // 火山引擎接受小写：480p / 720p / 1080p / 4k
    const map: Record<string, string> = {
      '512P': '480p',
      '720P': '720p',
      '768P': '720p',
      '1080P': '1080p',
    };
    return map[resolution] || '720p';
  }

  /** 推断默认 ratio（UI 无显式 ratio 选项时使用，默认 16:9 横屏） */
  private inferRatio(): string {
    return '16:9';
  }

  /** 状态映射：火山引擎 → 系统内部 */
  private mapStatus(volcStatus: string): VideoTaskResult['status'] {
    const mapping: Record<string, VideoTaskResult['status']> = {
      queued: 'PENDING',
      running: 'PROCESSING',
      succeeded: 'SUCCESS',
      failed: 'FAILED',
      expired: 'FAILED',
      cancelled: 'FAILED',
    };
    const mapped = mapping[volcStatus];
    if (mapped) return mapped;

    // 未知状态映射为 FAILED，避免无限轮询（官方明确列举 6 种状态）
    this.logger.warn('Unknown volcengine task status, mapping to FAILED', this.ctx({
      method: 'mapStatus',
      volcStatus,
    }));
    return 'FAILED';
  }
}

/** 火山引擎任务查询 API 响应结构（对齐官方文档） */
export interface VolcengineTaskResponse {
  id: string;
  model?: string;
  status: string;
  content?: {
    video_url?: string;
    /** 尾帧图像 URL（return_last_frame=true 时返回，24h 有效，用于多段连续生成） */
    last_frame_url?: string;
    // 以下字段为旧版响应字段，保留以兼容历史模型
    model_url?: string;
    preview_image_url?: string;
    format?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  framespersecond?: number;
  service_tier?: string;
  execution_expires_after?: number;
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
  created_at?: number;
  updated_at?: number;
}
