import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult, ImageAspectRatio } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import type { ImageStyleKey } from '../../../../domain/data/imageStylePresets';
import { findImageModel, getDefaultImageModel } from '../../../../domain/services/platformCapabilities';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';

/**
 * 火山引擎图片生成适配器（Seedream 系列模型）。
 *
 * 接口映射：
 *   IImageGeneratorPort.generateImage → POST /images/generations
 *
 * 模型 ID 读取顺序：context.model → config.volcArkImageModel → 注册表默认值
 * 支持标准模式和流式模式。
 *
 * 关键改造点（P0）：
 *   - size 参数改为分辨率档位(2K/4K),原像素值在 Seedream 4.0+ 上无效
 *   - 补充官方必需参数 output_format(png/jpeg)和 watermark(顶层布尔)
 *   - style 参数仅在模型 capabilities.style 为 true 时透传
 *
 * 官方文档参考:
 *   - Seedream 4.0-5.0 教程:https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1824121
 *   - doubao-seededit-3-0-i2i:https://www.volcengine.com/docs/82379/1729477
 */
export class VolcengineImageAdapter implements IImageGeneratorPort {
  private http: VolcengineHttpClient;
  private readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    // 双协议并存架构：Image 永远走 OpenAI 协议（火山方舟图片生成仅支持 OpenAI 兼容端点）
    this.http = VolcengineHttpClient.createOpenAI(config);
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
   * 解析模型 ID：context.model → config.volcArkImageModel → 注册表默认值。
   */
  private resolveModel(context: ImageGenerationContext, config: ApiConfig): string {
    return context.model
      || config.volcArkImageModel
      || getDefaultImageModel('volcengine');
  }

  /**
   * 解析尺寸：优先使用自定义 width/height,其次按 aspectRatio 映射为分辨率档位。
   *
   * P0 修复(Seedream 4.0-5.0):
   *  - 官方 size 参数接受分辨率档位(1K/2K/4K),非像素值
   *  - 旧像素值(如 1280x720)在 Seedream 4.0+ 上会导致 API 错误或被忽略
   *  - Seedream 3.0 t2i 仍可能支持像素值,通过模型 capabilities.sizeFormat 区分(当前默认全用档位)
   */
  private resolveSize(context: ImageGenerationContext): string | undefined {
    // 自定义尺寸优先(若用户显式指定 width/height,透传像素值)
    if (context.width && context.height) {
      return `${context.width}x${context.height}`;
    }
    // aspectRatio → 分辨率档位映射(Seedream 4.0-5.0 官方规范)
    if (context.aspectRatio) {
      return VOLCENGINE_RESOLUTION_MAP[context.aspectRatio];
    }
    return undefined;
  }

  private buildPayload(context: ImageGenerationContext, config: ApiConfig): Record<string, unknown> {
    const model = this.resolveModel(context, config);
    const prompt = context.prompt;
    const size = this.resolveSize(context);

    // 查询模型能力描述符(判断是否支持 style 参数)
    const descriptor = findImageModel('volcengine', model);

    // I2I: Seedream 4.5 / Seededit 3.0 使用 image 字段传递参考图
    const referenceImage = context.subjectReferenceUrl
      || context.subjectReference?.[0]?.image_file;

    // 统一抽象风格 → 火山引擎原生 style key(仅模型支持 style 时透传)
    const styleKey = context.style?.style as ImageStyleKey | undefined;
    const nativeStyle = (descriptor?.capabilities.style && styleKey)
      ? VOLCENGINE_STYLE_MAP[styleKey]
      : undefined;

    return {
      model,
      prompt,
      ...(referenceImage && { image: [referenceImage] }),
      ...(size && { size }),
      ...(context.n && { n: context.n }),
      ...(context.seed !== undefined && { seed: context.seed }),
      ...(nativeStyle && { style: nativeStyle }),
      ...(context.stream && { stream: true }),
      // P0 修复:补充官方必需参数
      // output_format:图片编码格式(png/jpeg),与 response_format(返回格式)是不同字段
      output_format: 'png',
      // watermark:顶层布尔字段,官方文档必需参数(原 aigcWatermark 未透传到顶层)
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
 * 火山引擎宽高比 → 分辨率档位映射(Seedream 4.0-5.0 官方规范)。
 *
 * P0 修复:原 VOLCENGINE_ASPECT_RATIO_MAP 使用像素值(如 1280x720),
 * 但 Seedream 4.0+ 的 size 参数接受分辨率档位(2K/4K),非像素值。
 * 官方文档:https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1824121
 *
 * 映射策略:
 *  - 默认 2K(平衡质量与速度)
 *  - 21:9 超宽屏用 4K(保证细节)
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

/**
 * 统一抽象风格 → 火山引擎原生 style key 映射。
 * 火山引擎 Seedream 4.5 通过 `style` 参数透传风格 key。
 * 注意:Seedream 5.0 Pro/Lite 官方文档未声明 style 参数,仅 4.5 及以下版本支持。
 */
const VOLCENGINE_STYLE_MAP: Record<ImageStyleKey, string> = {
  '': '',
  photorealistic: 'photorealistic',
  anime: 'anime',
  oil_painting: 'oil_painting',
  watercolor: 'watercolor',
  sketch: 'sketch',
  '3d_render': '3d_render',
  chinese_painting: 'chinese_painting',
  cyberpunk: 'cyberpunk',
  pixel_art: 'pixel_art',
};
