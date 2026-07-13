/**
 * imageCompress —— 主线程 Canvas 图片压缩工具
 *
 * 近无损压缩策略：
 *   1. createImageBitmap 解码源 Blob
 *   2. 按最长边缩放（可选）→ 绘制到 canvas
 *   3. canvas.toBlob(mime, quality) 编码
 *
 * PNG 透明图自动保留 PNG 格式（不转 JPEG）。
 * 零依赖，符合"简化"偏好。
 *
 * 日志：遵循用户规则，所有入参/出参经 logger 打印
 */

import { createLogger } from '../../dependencies';

const logger = createLogger('imageCompress');

export interface CompressOptions {
  /** 质量 60-95，仅 JPEG/WebP 有效；PNG 透明图忽略此值 */
  quality: number;
  /** 最长边上限（像素），不传或 <=0 表示不缩放 */
  maxDimension?: number;
  /** 输出格式：'original'=跟随原图 | 'jpeg' | 'webp' */
  outputFormat?: 'original' | 'jpeg' | 'webp';
  /** 是否移除 EXIF（默认 true；canvas 重绘天然丢弃 EXIF） */
  removeExif?: boolean;
}

export interface CompressResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  ratio: number; // 0-1，压缩后 / 原图
  width: number;
  height: number;
  mimeType: string;
  durationMs: number;
}

/**
 * 压缩单个图片 Blob。
 *
 * @param source 源图片 Blob
 * @param options 压缩选项
 * @returns 压缩结果（含体积对比元数据）
 */
export async function compressImage(
  source: Blob,
  options: CompressOptions,
): Promise<CompressResult> {
  const startTime = Date.now();
  const originalSize = source.size;
  const sourceMime = source.type || 'image/png';
  logger.info('[compressImage] 入参', {
    originalSize,
    sourceMime,
    options,
  });

  // 决定输出 MIME
  let outMime: string;
  if (options.outputFormat && options.outputFormat !== 'original') {
    outMime = options.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
  } else {
    // 跟随原图；PNG 透明图保留 PNG（JPEG 不支持透明）
    outMime = sourceMime === 'image/png' ? 'image/png' : sourceMime;
    // 如果原图是 PNG 但不透明，可考虑转 JPEG 更省——这里保守保留原格式
  }

  // 解码
  const bitmap = await createImageBitmap(source);
  let { width, height } = bitmap;

  // 缩放（可选）
  if (options.maxDimension && options.maxDimension > 0) {
    const longest = Math.max(width, height);
    if (longest > options.maxDimension) {
      const scale = options.maxDimension / longest;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
  }

  // 绘制到 canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[imageCompress] 无法创建 canvas 2d 上下文');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // 编码
  // PNG 是无损格式，quality 参数无效；非 PNG 才传 quality
  const needsQuality = outMime !== 'image/png';
  const quality = needsQuality ? Math.min(95, Math.max(60, options.quality)) / 100 : undefined;

  const blob: Blob | null = await new Promise(resolve => {
    canvas.toBlob(resolve, outMime, quality);
  });

  if (!blob) {
    throw new Error('[imageCompress] canvas.toBlob 返回 null');
  }

  const compressedSize = blob.size;
  const ratio = originalSize > 0 ? compressedSize / originalSize : 0;
  const durationMs = Date.now() - startTime;

  logger.info('[compressImage] 出参', {
    compressedSize,
    ratio,
    width,
    height,
    outMime,
    durationMs,
  });

  return {
    blob,
    originalSize,
    compressedSize,
    ratio,
    width,
    height,
    mimeType: outMime,
    durationMs,
  };
}

/**
 * 批量压缩工具（逐张处理，每张之间让出主线程）。
 *
 * @param sources 源 Blob 数组
 * @param options 压缩选项
 * @param onProgress 进度回调（已完成数 / 总数）
 * @returns 每张结果（成功/失败 + 体积对比）
 */
export async function compressImagesBatch(
  sources: Blob[],
  options: CompressOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Array<{ success: boolean; result?: CompressResult; error?: string }>> {
  const results: Array<{ success: boolean; result?: CompressResult; error?: string }> = [];
  logger.info('[compressImagesBatch] 入参', {
    count: sources.length,
    options,
  });

  for (let i = 0; i < sources.length; i++) {
    try {
      const result = await compressImage(sources[i], options);
      results.push({ success: true, result });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ success: false, error });
      logger.warn('[compressImagesBatch] 单张失败', { index: i, error });
    }
    onProgress?.(i + 1, sources.length);
    // 让出主线程
    await new Promise(r => setTimeout(r, 0));
  }

  const totalOriginal = results.reduce((s, r) => s + (r.result?.originalSize ?? 0), 0);
  const totalCompressed = results.reduce((s, r) => s + (r.result?.compressedSize ?? 0), 0);
  const avgRatio = totalOriginal > 0 ? totalCompressed / totalOriginal : 0;
  logger.info('[compressImagesBatch] 出参', {
    total: sources.length,
    successCount: results.filter(r => r.success).length,
    failCount: results.filter(r => !r.success).length,
    totalOriginal,
    totalCompressed,
    avgRatio,
  });

  return results;
}
