import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { ViduHttpClient } from './ViduHttpClient';
import { withRetry } from './ViduErrorUtils';

/**
 * 生数科技 Vidu 图片生成适配器。
 *
 * Endpoint：POST /v1/images/generations
 * Model:    viduq1 / vidu-studio
 *
 * 请求格式（OpenAI 兼容）：
 *   {
 *     model: 'viduq1',
 *     prompt: '...',
 *     n: 1,
 *     aspect_ratio: '1:1',
 *     reference_image_urls?: ['...']  // 参考图
 *   }
 *
 * 响应格式：
 *   {
 *     created: 1234567890,
 *     data: [{ url: 'https://...' }]
 *   }
 */
export class ViduImageAdapter implements IImageGeneratorPort {
  private logger?: ILoggerPort;
  private http: ViduHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.logger = logger;
    this.config = config;
    this.http = new ViduHttpClient(config);
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    // ── Mock 模式 ──
    if (!this.config.viduApiKey) {
      this.logger?.warn('[ViduImageAdapter] No API Key — returning placeholder image.');
      const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      return { imageDataUri: `data:image/png;base64,${mockBase64}` };
    }

    const model = (context.model as string) || 'viduq1';
    this.logger?.info('[ViduImageAdapter] generateImage 入参', {
      promptLength: context.prompt.length,
      model,
    });
    const payload: Record<string, unknown> = {
      model,
      prompt: context.prompt,
      n: context.n ?? 1,
    };

    // 宽高比（Vidu 支持 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 21:9）
    if (context.aspectRatio) {
      payload.aspect_ratio = context.aspectRatio;
    }

    // 种子
    if (context.seed !== undefined) {
      payload.seed = context.seed;
    }

    const result = await withRetry(() =>
      this.http.post<{
        created: number;
        data: Array<{ url?: string; b64_json?: string }>;
      }>('/v1/images/generations', payload),
    );

    const urls = (result.data || []).map(item => item.url).filter(Boolean) as string[];
    if (urls.length === 0) {
      const b64 = result.data?.find(item => item.b64_json)?.b64_json;
      if (b64) {
        return {
          imageDataUri: `data:image/png;base64,${b64}`,
          metadata: { successCount: 1, failedCount: 0 },
        };
      }
      throw new Error('Vidu 图片生成未返回 URL');
    }

    return {
      imageUrls: urls,
      metadata: { successCount: urls.length, failedCount: 0 },
    };
  }
}