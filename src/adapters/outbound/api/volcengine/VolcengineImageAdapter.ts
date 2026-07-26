import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult, ImageAspectRatio } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { getDefaultImageModel } from '../../../../domain/services/platformCapabilities';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';

/**
 * 火山引擎图片生成适配器（Agent Plan 套餐）。
 *
 * 接口映射：
 *   IImageGeneratorPort.generateImage -> POST /api/plan/v3/images/generations
 *
 * 仅支持 Agent Plan 套餐唯一图片模型 doubao-seedream-5.0-lite（官方文档 82379/2366394）。
 * 路由由 Vite proxy 智能 rewrite 处理：/images/* -> /api/plan/v3/images/*。
 *
 * 模型 ID 读取顺序：context.model -> config.volcArkImageModel -> 注册表默认值。
 */
export class VolcengineImageAdapter implements IImageGeneratorPort {
  private http: VolcengineHttpClient;
  private readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.http = VolcengineHttpClient.createAgentPlan(config);
    this.config = config;
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    const payload = this.buildPayload(context, this.config);

    console.log('[VolcengineImageAdapter] generateImage 入参', {
      model: payload.model,
      prompt: context.prompt,
      promptLength: context.prompt.length,
      size: payload.size,
      n: context.n,
    });

    const result = await withRetry(() =>
      this.http.post<{
        created: number;
        data: Array<{ url?: string; b64_json?: string; size?: string }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>('/images/generations', payload),
    );

    console.log('[VolcengineImageAdapter] generateImage 出参', {
      successCount: result.data.filter(item => item.url || item.b64_json).length,
      totalCount: result.data.length,
    });

    return {
      imageUrls: result.data.filter(item => item.url).map(item => item.url!),
      imageDataUri: result.data.find(item => item.b64_json)?.b64_json
        ? `data:image/png;base64,${result.data.find(item => item.b64_json)!.b64_json}`
        : undefined,
      metadata: {
        successCount: result.data.filter(item => item.url || item.b64_json).length,
        failedCount: result.data.length - result.data.filter(item => item.url || item.b64_json).length,
      },
    };
  }

  /**
   * 流式图片生成（扩展方法，不在 IImageGeneratorPort 中，供新 UI 使用）。
   */
  async *generateImageStream(context: ImageGenerationContext): AsyncIterable<VolcengineImageStreamEvent> {
    const payload = { ...this.buildPayload(context, this.config), stream: true };
    yield* this.http.stream<VolcengineImageStreamEvent>('/images/generations', payload);
  }

  /**
   * 解析模型 ID：context.model -> config.volcArkImageModel -> 注册表默认值。
   */
  private resolveModel(context: ImageGenerationContext, config: ApiConfig): string {
    return context.model
      || config.volcArkImageModel
      || getDefaultImageModel('volcengine');
  }

  /**
   * 解析尺寸：优先使用自定义 width/height,其次按 aspectRatio 映射为分辨率档位。
   *
   * Seedream 5.0 Lite 官方 size 参数接受分辨率档位(2K/4K)。
   */
  private resolveSize(context: ImageGenerationContext): string | undefined {
    if (context.width && context.height) {
      return `${context.width}x${context.height}`;
    }
    if (context.aspectRatio) {
      return VOLCENGINE_RESOLUTION_MAP[context.aspectRatio];
    }
    return undefined;
  }

  private buildPayload(context: ImageGenerationContext, config: ApiConfig): Record<string, unknown> {
    const model = this.resolveModel(context, config);
    const prompt = context.prompt;
    const size = this.resolveSize(context);

    // I2I: 通过 image 字段传递参考图
    const referenceImage = context.subjectReferenceUrl
      || context.subjectReference?.[0]?.image_file;

    return {
      model,
      prompt,
      ...(referenceImage && { image: [referenceImage] }),
      ...(size && { size }),
      ...(context.n && { n: context.n }),
      ...(context.seed !== undefined && { seed: context.seed }),
      ...(context.stream && { stream: true }),
      output_format: 'png',
      watermark: context.aigcWatermark ?? false,
      response_format: context.responseFormat === 'base64' ? 'b64_json' : 'url',
    };
  }
}

/** 流式图片生成事件（适配器内部类型） */
interface VolcengineImageStreamEvent {
  type: 'partial_success' | 'partial_failure' | 'completion';
  data?: { url?: string; b64_json?: string };
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * 火山引擎宽高比 -> 分辨率档位映射(Seedream 5.0 Lite 官方规范)。
 * 默认 2K(平衡质量与速度)。
 */
const VOLCENGINE_RESOLUTION_MAP: Record<ImageAspectRatio, string> = {
  '1:1':  '2K',
  '16:9': '2K',
  '9:16': '2K',
  '4:3':  '2K',
  '3:4':  '2K',
  '3:2':  '2K',
  '2:3':  '2K',
  '21:9': '4K',
};
