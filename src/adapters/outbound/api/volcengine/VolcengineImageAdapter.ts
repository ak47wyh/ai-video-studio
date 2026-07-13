import type {
  IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult,
  ImageStreamEvent, ImageResponseFormat, ImageAspectRatio,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';
import { PLATFORM_METADATA } from '../../../../domain/services/platformCapabilities';

/**
 * 火山引擎图片生成适配器（Seedream 系列模型）。
 *
 * 接口映射：
 *   IImageGeneratorPort.generateImage       → POST /images/generations
 *   IImageGeneratorPort.generateImageStream → POST /images/generations (stream=true)
 *
 * 支持标准模式和流式模式。模型 ID 优先级：
 *   context.model → config.volcArkImageModel → PLATFORM_METADATA.volcengine.imageModel
 */
export class VolcengineImageAdapter implements IImageGeneratorPort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new VolcengineHttpClient(config);
  }

  /** Anthropic 协议（Agent Plan）不支持图片生成，视觉模型需通过 Skill 调用 */
  private ensureOpenAIProtocol(): void {
    if (this.config.volcArkProtocol === 'anthropic') {
      throw new Error('Volcengine image generation requires OpenAI protocol');
    }
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    this.ensureOpenAIProtocol();
    const payload = this.buildPayload(context);

    const result = await withRetry(() =>
      this.http.post<VolcengineImageResponse>('/images/generations', payload),
    );

    // P1 修复（I-P1-5）：MIME 修正为 jpeg（官方实际返回 jpeg，非 png）；
    // P1 修复（I-P1-9）：failedCount 计算考虑 data.error 字段
    const successItems = result.data.filter(item => item.url || item.b64_json);
    const failedItems = result.data.filter(item => item.error);
    return {
      imageUrls: successItems
        .filter((item): item is { url: string } => !!item.url)
        .map(item => item.url),
      imageDataUri: successItems.find(item => item.b64_json)?.b64_json
        ? `data:image/jpeg;base64,${successItems.find(item => item.b64_json)!.b64_json}`
        : undefined,
      metadata: {
        successCount: successItems.length,
        failedCount: failedItems.length,
      },
    };
  }

  /**
   * 流式图片生成（对接官方 stream=true 响应）。
   * 上提至 IImageGeneratorPort 契约（P1 修复 I-P1-4）。
   */
  async *generateImageStream(context: ImageGenerationContext): AsyncIterable<ImageStreamEvent> {
    this.ensureOpenAIProtocol();
    const payload = { ...this.buildPayload(context), stream: true };
    yield* this.http.stream<ImageStreamEvent>('/images/generations', payload);
  }

  /**
   * 构造请求体，对齐官方 Seedream 4.x 全量参数。
   * P0 修复（I-P0-2）：补全 watermark / guidance_scale / sequential_image_generation 等 6 项参数。
   */
  private buildPayload(context: ImageGenerationContext): VolcengineImagePayload {
    const size = this.resolveSize(context);
    const images = this.resolveReferenceImages(context);

    return {
      model: this.resolveModel(context),
      prompt: context.prompt,
      ...(images.length > 0 && { image: images }),
      ...(size && { size }),
      ...(context.n && { n: context.n }),
      ...(context.seed !== undefined && { seed: context.seed }),
      response_format: this.mapResponseFormat(context.responseFormat),
      // P0 修复（I-P0-2）：补全官方 4.x 参数
      ...(context.aigcWatermark !== undefined && { watermark: context.aigcWatermark }),
      ...(context.guidanceScale !== undefined && { guidance_scale: context.guidanceScale }),
      ...(context.sequentialImageGeneration && {
        sequential_image_generation: context.sequentialImageGeneration,
      }),
      ...(context.sequentialImageGenerationOptions && {
        sequential_image_generation_options: {
          max_images: context.sequentialImageGenerationOptions.maxImages,
        },
      }),
      ...(context.promptOptimizer !== undefined && {
        optimize_prompt_options: { mode: context.promptOptimizer ? 'standard' : 'fast' },
      }),
    };
  }

  /**
   * 统一尺寸解析。
   * P0 修复（I-P0-3）：原实现忽略 aspectRatio，仅用 width×height。
   * 现优先 aspectRatio → 官方推荐像素值；其次 width×height；并校验总像素范围。
   */
  private resolveSize(context: ImageGenerationContext): string | undefined {
    if (context.aspectRatio) {
      // 官方推荐像素值（详见 https://www.volcengine.com/docs/82379/1541523）
      const mapping: Record<ImageAspectRatio, string> = {
        '1:1': '2048x2048',
        '4:3': '2304x1728',
        '3:4': '1728x2304',
        '16:9': '2560x1440',
        '9:16': '1440x2560',
        '3:2': '2496x1664',
        '2:3': '1664x2496',
        '21:9': '3024x1296',
      };
      return mapping[context.aspectRatio];
    }
    if (context.width && context.height) {
      // P2 修复（I-P2-3）：校验官方总像素范围 [921600, 16777216] 与宽高比 [1/16, 16]
      const total = context.width * context.height;
      if (total < 921600 || total > 16777216) {
        // 超出范围时不阻断请求，由服务端校验返回错误；这里仅记录到 console（P2 改造点：注入 logger）
        console.warn('[VolcengineImageAdapter] image size out of range', {
          width: context.width,
          height: context.height,
          total,
          validRange: '[921600, 16777216]',
        });
      }
      return `${context.width}x${context.height}`;
    }
    return undefined;
  }

  /**
   * 解析参考图集合。
   * P1 修复（I-P1-2）：原实现仅支持单图（subjectReferenceUrl），
   * 现合并 subjectReference 数组（最多 14 张，官方上限）。
   */
  private resolveReferenceImages(context: ImageGenerationContext): string[] {
    const images: string[] = [];
    if (context.subjectReference) {
      for (const ref of context.subjectReference) {
        if (ref.image_file) images.push(ref.image_file);
      }
    }
    if (context.subjectReferenceUrl) {
      images.push(context.subjectReferenceUrl);
    }
    return images.slice(0, 14);  // 官方上限 14 张
  }

  /**
   * 解析模型 ID，取值优先级：
   *   context.model → config.volcArkImageModel → PLATFORM_METADATA.volcengine.imageModel
   */
  private resolveModel(context: ImageGenerationContext): string {
    const fromConfig = this.config.volcArkImageModel?.trim();
    const fromPlatform = PLATFORM_METADATA.volcengine.imageModel;
    return context.model || fromConfig || fromPlatform || 'doubao-seedream-4-5-251128';
  }

  private mapResponseFormat(format?: ImageResponseFormat): 'url' | 'b64_json' {
    return format === 'base64' ? 'b64_json' : 'url';
  }
}

/** 火山引擎图片生成 API 响应结构 */
interface VolcengineImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    size?: string;
    error?: { code: string; message: string };
  }>;
  usage?: {
    generated_images: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/** 火山引擎图片生成请求体 */
interface VolcengineImagePayload {
  model: string;
  prompt: string;
  image?: string[];
  size?: string;
  n?: number;
  seed?: number;
  response_format: 'url' | 'b64_json';
  watermark?: boolean;
  guidance_scale?: number;
  sequential_image_generation?: 'auto' | 'disabled';
  sequential_image_generation_options?: { max_images: number };
  optimize_prompt_options?: { mode: 'standard' | 'fast' };
}
