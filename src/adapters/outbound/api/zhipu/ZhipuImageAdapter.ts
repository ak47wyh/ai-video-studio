import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { UnsupportedCapabilityError } from '../../../../domain/errors/UnsupportedCapabilityError';
import { ZhipuHttpClient } from './ZhipuHttpClient';
import { withRetry } from './ZhipuErrorUtils';

/**
 * 智谱图片生成适配器（CogView 系列）。
 *
 * Endpoint: POST /images/generations
 * Models: cogview-3-plus / cogview-3
 * Response: 默认返回 url 数组
 */
export class ZhipuImageAdapter implements IImageGeneratorPort {
  private http: ZhipuHttpClient;
  private config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    this.http = new ZhipuHttpClient(config);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'ZhipuImageAdapter', ...extra };
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    // ── API Key 缺失：抛能力不支持错误，禁止返回占位图 ──
    if (!this.config.zhipuApiKey) {
      throw new UnsupportedCapabilityError('zhipu', 'image');
    }

    const model = context.model || 'cogview-3-plus';
    this.logger?.debug('generateImage 入参', this.ctx({
      promptLength: context.prompt.length,
      model,
    }));
    const payload: Record<string, unknown> = {
      model,
      prompt: context.prompt,
    };
    if (context.n) payload.n = context.n;

    const result = await withRetry(() =>
      this.http.post<ZhipuImageResponse>('/images/generations', payload),
    );

    const urls = (result.data || []).map(item => item.url).filter(Boolean) as string[];
    if (urls.length === 0) {
      throw new Error('智谱图片生成未返回 URL');
    }
    return {
      imageUrls: urls,
      metadata: { successCount: urls.length, failedCount: 0 },
    };
  }
}

interface ZhipuImageResponse {
  data?: Array<{ url: string }>;
}
