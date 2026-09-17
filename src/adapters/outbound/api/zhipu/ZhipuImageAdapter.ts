import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
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
  private logger?: ILoggerPort;
  private http: ZhipuHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.logger = logger;
    this.config = config;
    this.http = new ZhipuHttpClient(config);
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    // ── Mock 模式 ──
    if (!this.config.zhipuApiKey) {
      this.logger?.warn('[ZhipuImageAdapter] No API key — returning placeholder image.');
      const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      return { imageDataUri: `data:image/png;base64,${mockBase64}` };
    }

    const model = context.model || 'cogview-3-plus';
    this.logger?.info('[ZhipuImageAdapter] generateImage 入参', {
      promptLength: context.prompt.length,
      model,
    });
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
