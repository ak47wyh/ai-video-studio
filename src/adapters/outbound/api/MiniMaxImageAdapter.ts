import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../domain/ports/OutboundPorts';
import type { ImageStyleKey } from '../../../domain/data/imageStylePresets';
import { findImageModel, getDefaultImageModel } from '../../../domain/services/platformCapabilities';
import { ApiConfigStore } from '../config/ApiConfigStore';
import { getMiniMaxErrorMessage } from './MiniMaxErrorUtils';
import axios from 'axios';

/**
 * Adapter for MiniMax Image Generation API.
 *
 * Supports both T2I (Text-to-Image) and I2I (Image-to-Image with subject_reference).
 *
 * API Docs:
 *   - T2I: https://platform.minimaxi.com/docs/api-reference/image-generation-t2i
 *   - I2I: https://platform.minimaxi.com/docs/api-reference/image-generation-i2i
 *
 * Endpoint: POST https://api.minimaxi.com/v1/image_generation
 * Models: image-01, image-01-live
 * Response format: url (24h validity) or base64
 *
 * 关键改造点（P2）：
 *   - 模型默认值改为从注册表 getDefaultImageModel('minimax') 读取
 *   - 模型能力判断改为基于 ImageModelDescriptor,不再硬编码 model === 'image-01-live'
 *   - 风格透传接入统一抽象风格映射(MINIMAX_STYLE_MAP),不支持的画风降级为空
 */
export class MiniMaxImageAdapter implements IImageGeneratorPort {

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    const config = ApiConfigStore.load();

    // ── Mock mode ─────────────────────────────────────────────────────────
    if (!config.minimaxApiKey) {
      console.warn('[MiniMaxImageAdapter] No API key — returning placeholder image.');
      const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      return { imageDataUri: `data:image/png;base64,${mockBase64}` };
    }

    // ── 解析模型 ID:context.model → 注册表默认值 ────────────────────────────
    const model = context.model || getDefaultImageModel('minimax');

    // 从注册表查询模型能力(替代硬编码 if model === 'image-01-live')
    const descriptor = findImageModel('minimax', model);

    const responseFormat = context.responseFormat || 'url';

    const payload: Record<string, unknown> = {
      model,
      prompt: context.prompt,
    };

    // Response format (API default is 'url')
    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    // 尺寸:基于描述符能力,而非硬编码模型名
    // P1 修复:aspect_ratio 与 width/height 同时设置时,官方优先使用 aspect_ratio
    // 因此仅在未设置 aspect_ratio 时才透传 width/height,避免冗余字段冲突
    if (context.aspectRatio) {
      if (!descriptor?.supportedAspectRatios.includes(context.aspectRatio)) {
        console.warn(`[MiniMaxImageAdapter] aspect_ratio "${context.aspectRatio}" not supported by ${model}, falling back to 16:9`);
        payload.aspect_ratio = '16:9';
      } else {
        payload.aspect_ratio = context.aspectRatio;
      }
    } else if (descriptor?.capabilities.customSize && context.width && context.height) {
      // 自定义尺寸:仅 customSize 能力为 true 的模型支持,且未设置 aspect_ratio 时才生效
      payload.width = context.width;
      payload.height = context.height;
    }

    // Number of images
    if (context.n && context.n > 1) {
      payload.n = context.n;
    }

    // Seed for reproducibility
    if (context.seed !== undefined) {
      payload.seed = context.seed;
    }

    // Prompt optimizer
    if (context.promptOptimizer !== undefined) {
      payload.prompt_optimizer = context.promptOptimizer;
    }

    // Watermark
    if (context.aigcWatermark !== undefined) {
      payload.aigc_watermark = context.aigcWatermark;
    }

    // Subject reference (I2V: image-to-image)
    const subjectRef = context.subjectReference ||
      (context.subjectReferenceUrl ? [{ type: 'character', image_file: context.subjectReferenceUrl }] : undefined);
    if (subjectRef && subjectRef.length > 0) {
      payload.subject_reference = subjectRef;
    }

    // 风格:基于描述符能力,映射为 MiniMax 原生 style key
    // P1 修复:官方 style 参数类型为 object(非 string),仅 image-01-live 生效
    // 官方文档:https://platform.minimaxi.com/docs/api-reference/image-generation-t2i
    if (descriptor?.capabilities.style && context.style?.style) {
      const nativeStyle = MINIMAX_STYLE_MAP[context.style.style as ImageStyleKey];
      if (nativeStyle) {
        // 官方 style 为 object 类型,字段结构为 { style: string }
        payload.style = { style: nativeStyle };
      }
    }

    console.log(`[MiniMaxImageAdapter] Generating image, model: ${model}, format: ${responseFormat}`);
    console.log(`[MiniMaxImageAdapter] Payload:`, JSON.stringify(payload, null, 2));

    // ── Real API call ─────────────────────────────────────────────────────
    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const response = await axios.post(
      `${baseUrl}/image_generation`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${config.minimaxApiKey}`,
          'Content-Type': 'application/json',
        },
        params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
      }
    );

    const data = response.data;

    // Check base_resp error codes
    const statusCode = data?.base_resp?.status_code;
    const statusMsg = data?.base_resp?.status_msg;
    const error = getMiniMaxErrorMessage(statusCode, statusMsg, 'MiniMax Image Generation error');
    if (error) {
      console.error(`[MiniMaxImageAdapter] API error: status_code=${statusCode}, status_msg=${statusMsg}`);
      console.error(`[MiniMaxImageAdapter] Request payload was:`, JSON.stringify(payload, null, 2));
      throw new Error(error);
    }

    // Parse metadata
    const metadata = data?.metadata ? {
      successCount: Number(data.metadata.success_count || 0),
      failedCount: Number(data.metadata.failed_count || 0),
    } : undefined;

    // Parse response based on format
    if (responseFormat === 'url') {
      const imageUrls: string[] = data?.data?.image_urls;
      if (!imageUrls || imageUrls.length === 0) {
        throw new Error('MiniMax Image API did not return any image URLs.');
      }
      return { imageUrls, metadata };
    }

    // base64 format
    const images: string[] = data?.data?.image_base64;
    if (!images || images.length === 0) {
      console.error('[MiniMaxImageAdapter] Unexpected response:', JSON.stringify(data));
      throw new Error('MiniMax Image API did not return any images.');
    }

    if (images.length === 1) {
      return {
        imageDataUri: `data:image/jpeg;base64,${images[0]}`,
        metadata,
      };
    }

    // Multiple base64 images — return first as imageDataUri, all as imageUrls with data URI prefix
    return {
      imageDataUri: `data:image/jpeg;base64,${images[0]}`,
      imageUrls: images.map(img => `data:image/jpeg;base64,${img}`),
      metadata,
    };
  }
}

/**
 * 统一抽象风格 → MiniMax 原生 style key 映射。
 * MiniMax 仅 image-01-live 支持 style,且官方明确支持前 6 种;
 * 不支持的画风(国画/赛博朋克/像素艺术)降级为空字符串,等同默认,避免 API 报错。
 */
const MINIMAX_STYLE_MAP: Record<ImageStyleKey, string> = {
  '': '',
  photorealistic: 'photorealistic',
  anime: 'anime',
  oil_painting: 'oil_painting',
  watercolor: 'watercolor',
  sketch: 'sketch',
  '3d_render': '3d_render',
  chinese_painting: '',
  cyberpunk: '',
  pixel_art: '',
};

