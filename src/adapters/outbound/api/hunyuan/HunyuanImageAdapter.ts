import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { UnsupportedCapabilityError } from '../../../../domain/errors/UnsupportedCapabilityError';
import { HunyuanHttpClient } from './HunyuanHttpClient';
import { withRetry } from './HunyuanErrorUtils';

/**
 * 腾讯混元 Hunyuan 图片生成适配器。
 *
 * Endpoint（Action 模式）：
 *   - 提交：Action=SubmitHunyuanImageJob
 *     Body: { Prompt, Model, ImageBase64?, ImageUrl?, Width, Height, Num }
 *   - 查询：Action=QueryHunyuanImageJob
 *     Body: { JobId }
 *     JobStatus: WAIT / PROCESSING / SUCCESS / FAIL
 *
 * Model 取值：
 *   - hunyuan-image（默认）
 *   - hunyuan-image-v2.0（升级版）
 *
 * 同步备选 Action：TextToImageLite（同步返回，适合短文案快速预览）。
 */
export class HunyuanImageAdapter implements IImageGeneratorPort {
  private http: HunyuanHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new HunyuanHttpClient(config);
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    // ── API Key 缺失：抛能力不支持错误，禁止返回占位图 ──
    if (!this.config.hunyuanSecretId || !this.config.hunyuanSecretKey) {
      throw new UnsupportedCapabilityError('hunyuan', 'image');
    }

    const model = (context.model as string) || 'hunyuan-image';
    const dims = this.resolveDimensions(context.aspectRatio);

    // 使用同步版 TextToImageLite（适合快速预览）
    const payload: Record<string, unknown> = {
      Prompt: context.prompt,
      Model: model,
      Width: dims.width,
      Height: dims.height,
      Num: context.n ?? 1,
    };

    if (context.seed !== undefined) {
      payload.Seed = context.seed;
    }

    const result = await withRetry(() =>
      this.http.call<{
        Response: {
          ResultImage: string; // base64 PNG
          RequestId: string;
        };
        RequestId: string;
      }>('TextToImageLite', payload),
    );

    const b64 = result.Response?.ResultImage;
    if (!b64) {
      throw new Error('混元图片生成未返回结果');
    }

    return {
      imageDataUri: `data:image/png;base64,${b64}`,
      metadata: { successCount: 1, failedCount: 0 },
    };
  }

  /**
   * 把宽高比字符串解析为具体像素
   */
  private resolveDimensions(ratio?: string): { width: number; height: number } {
    const defaults: Record<string, [number, number]> = {
      '1:1': [1024, 1024],
      '16:9': [1280, 720],
      '4:3': [1280, 960],
      '3:2': [1536, 1024],
      '2:3': [1024, 1536],
      '3:4': [960, 1280],
      '9:16': [720, 1280],
      '21:9': [1680, 720],
    };
    const dims = defaults[ratio ?? '1:1'] ?? [1024, 1024];
    return { width: dims[0], height: dims[1] };
  }
}