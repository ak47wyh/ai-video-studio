import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { UnsupportedCapabilityError } from '../../../../domain/errors/UnsupportedCapabilityError';
import { KlingHttpClient } from './KlingHttpClient';
import { withRetry } from './KlingErrorUtils';

/**
 * 可灵 Kling 图片生成适配器。
 *
 * Endpoint: POST /v1/images/generations
 * Model:    kling-v1（默认）
 * Response: data.images[].url 数组
 *
 * 与可灵视频共用 JWT 鉴权（KlingHttpClient 内部统一处理）。
 */
export class KlingImageAdapter implements IImageGeneratorPort {
  private http: KlingHttpClient;

  private config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    this.http = new KlingHttpClient(config);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'KlingImageAdapter', ...extra };
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    // ── API Key 缺失：抛能力不支持错误，禁止返回占位图 ──
    if (!this.config.klingAccessKey || !this.config.klingSecretKey) {
      throw new UnsupportedCapabilityError('kling', 'image');
    }

    const model = context.model || 'kling-v1';
    this.logger?.debug('generateImage 入参', this.ctx({
      promptLength: context.prompt.length,
      model,
    }));
    const payload: Record<string, unknown> = {
      model,
      prompt: context.prompt,
    };

    // 宽高比（可灵支持 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 21:9）
    payload.aspect_ratio = context.aspectRatio || '1:1';

    // 张数
    payload.n = context.n ?? 1;

    const result = await withRetry(() =>
      this.http.post<KlingImageResponse>('/v1/images/generations', payload),
    );

    const urls = (result?.data?.images || []).map(img => img.url).filter(Boolean) as string[];
    if (urls.length === 0) {
      throw new Error('可灵图片生成未返回 URL');
    }
    return {
      imageUrls: urls,
      metadata: { successCount: urls.length, failedCount: 0 },
    };
  }
}

interface KlingImageResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    images: Array<{
      id: string;
      url: string;
      width?: number;
      height?: number;
    }>;
  };
}
