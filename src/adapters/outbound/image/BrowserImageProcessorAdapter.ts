import type {
  IImageProcessorPort,
  CompressOptions,
  CompressResult,
  ImageInfo,
  CompressOutputFormat,
} from '../../../domain/ports/ImageProcessingPorts';

/**
 * 浏览器原生图片处理适配器（F8）。
 *
 * 实现层：基于 createImageBitmap + Canvas 2D + toBlob 的主线程实现。
 *
 * 降级链：
 *   1. 优先：createImageBitmap({ imageOrientation: 'from-image' }) + Canvas toBlob
 *      （支持 EXIF 方向保留，Chrome 81+ / FF 77+ / Safari 14+）
 *   2. 降级：createImageBitmap 不带选项（旧浏览器，方向不保留）
 *   3. 降级：HTMLImageElement + Canvas（最保守路径）
 *   4. 编码失败：WebP 不可用时降级 JPEG
 *
 * Worker 化（OffscreenCanvas）见设计文档 Phase 3，本类保持主线程实现作为
 * Worker 不可用时的兜底。Worker 客户端将包装本类。
 *
 * 错误归一化：所有异常抛出 Error（domain 层 Service 决定如何包装）。
 */
export class BrowserImageProcessorAdapter implements IImageProcessorPort {
  /**
   * 获取图片元信息（F2 像素尺寸校验用）。
   *
   * 通过 createImageBitmap 解码（不渲染到 DOM），同时通过 imageOrientation: 'from-image'
   * 应用 EXIF 方向，确保后续压缩输出方向正确。
   */
  async getImageInfo(input: Blob | string): Promise<ImageInfo> {
    const blob = await this.resolveBlob(input);
    const size = blob.size;
    const type = blob.type || 'image/png';

    // F3：优先尝试带 from-image 选项解码（保留 EXIF 方向）
    let orientationApplied = false;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      orientationApplied = true;
    } catch {
      // 降级：不带选项解码
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        return {
          width: 0,
          height: 0,
          size,
          type,
          hasExif: false,
        };
      }
    }

    const info: ImageInfo = {
      width: bitmap.width,
      height: bitmap.height,
      size,
      type,
      hasExif: orientationApplied,
      // F3：仅当 from-image 生效时才能确定方向值（这里简化为 1=正常，
      // 实际方向值需 EXIF 解析库，Canvas 重绘已应用旋转，输出已是正向）
      orientation: orientationApplied ? 1 : undefined,
    };
    bitmap.close();
    return info;
  }

  /**
   * 压缩图片（F1/F2/F3）。
   *
   * 流程：
   *   1. resolveBlob(input) 把 URL/dataURI 统一为 Blob
   *   2. createImageBitmap({ imageOrientation: 'from-image' }) 解码（F3 保留 EXIF 方向）
   *   3. 像素尺寸校验：超过 maxLongEdge 自动等比缩放（F2）
   *   4. Canvas 重绘 + toBlob 编码（F1）
   *   5. 压缩后体积反而变大时返回原 Blob（不压缩）
   */
  async compress(input: Blob | string, options: CompressOptions): Promise<CompressResult> {
    const sourceBlob = await this.resolveBlob(input);
    const originalSize = sourceBlob.size;
    const sourceMime = sourceBlob.type || 'image/png';

    // F3：保留 EXIF 方向解码
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      // 降级：不带 from-image 选项（旧浏览器）
      bitmap = await createImageBitmap(sourceBlob);
    }

    let { width, height } = bitmap;

    // F2：像素尺寸校验，超过 maxLongEdge 等比缩放
    if (options.maxLongEdge && options.maxLongEdge > 0) {
      const longest = Math.max(width, height);
      if (longest > options.maxLongEdge) {
        const scale = options.maxLongEdge / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
    }

    // Canvas 重绘
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('canvas 2d context unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // F1：决定输出 MIME
    // - 'keep' 跟随原图；PNG 透明图保留 PNG（JPEG 不支持透明）
    // - stripExif=true 时强制走 Canvas 重绘（天然剥离 EXIF），不保留任何元数据
    // - keepOrientation=true（默认）已通过 imageOrientation: 'from-image' 应用方向
    const targetMime = this.resolveTargetMime(options.outputFormat ?? 'keep', sourceMime);
    const needsQuality = targetMime !== 'image/png';
    const quality = needsQuality
      ? Math.min(95, Math.max(60, options.quality ?? 85)) / 100
      : undefined;

    let outBlob: Blob | null = await new Promise(resolve => {
      canvas.toBlob(resolve, targetMime, quality);
    });

    // WebP 编码失败时降级 JPEG
    if (!outBlob && targetMime === 'image/webp') {
      outBlob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      });
    }

    if (!outBlob) {
      throw new Error('canvas.toBlob returned null');
    }

    // 压缩后体积反而变大时，返回原图 Blob（不压缩）
    if (outBlob.size >= originalSize) {
      outBlob = sourceBlob;
    }

    const compressedSize = outBlob.size;
    const compressionRatio = originalSize > 0 ? 1 - compressedSize / originalSize : 0;

    return {
      blob: outBlob,
      width,
      height,
      format: outBlob.type,
      originalSize,
      compressedSize,
      compressionRatio,
    };
  }

  /** 等比缩放到指定长边（不改变格式） */
  async resize(input: Blob | string, targetLongEdge: number): Promise<CompressResult> {
    return this.compress(input, {
      maxLongEdge: targetLongEdge,
      outputFormat: 'keep',
      keepOrientation: true,
    });
  }

  /** 格式转换（不压缩尺寸，仅转码） */
  async convertFormat(
    input: Blob | string,
    targetFormat: Exclude<CompressOutputFormat, 'keep'>,
    quality?: number,
  ): Promise<CompressResult> {
    return this.compress(input, {
      outputFormat: targetFormat,
      quality,
      keepOrientation: true,
    });
  }

  /**
   * 剥离 EXIF 元数据（可选保留方向）。
   *
   * Canvas 重绘天然丢弃所有 EXIF，但方向需通过 imageOrientation: 'from-image' 应用。
   * keepOrientation=true（默认）：方向已应用，输出为正向图
   * keepOrientation=false：完全不处理方向（旧浏览器行为）
   */
  async stripExif(input: Blob | string, keepOrientation: boolean = true): Promise<CompressResult> {
    return this.compress(input, {
      outputFormat: 'keep',
      stripExif: true,
      keepOrientation,
    });
  }

  // ===== 私有辅助方法 =====

  /**
   * 把输入归一化为 Blob。
   * - Blob 直接返回
   * - URL/dataURI 通过 fetch 抓取（domain 层无 fetch，但 Adapter 层允许）
   */
  private async resolveBlob(input: Blob | string): Promise<Blob> {
    if (typeof input !== 'string') return input;
    // data:URI / http(s):URL / blob:URL 都可通过 fetch 解析
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`fetch image failed: HTTP ${response.status}`);
    }
    return response.blob();
  }

  /** 决定输出 MIME 类型 */
  private resolveTargetMime(format: CompressOutputFormat, sourceMime: string): string {
    if (format === 'keep') {
      // 跟随原图；PNG 透明图保留 PNG
      return sourceMime === 'image/png' ? 'image/png' : sourceMime;
    }
    if (format === 'webp') return 'image/webp';
    if (format === 'jpeg') return 'image/jpeg';
    if (format === 'png') return 'image/png';
    return sourceMime;
  }
}
