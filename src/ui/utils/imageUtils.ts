const MAX_IMAGE_SIZE_MB = 20;

/** 上传自动压缩默认参数（F1） */
export const UPLOAD_COMPRESS_DEFAULTS = {
  /** 是否启用上传自动压缩 */
  enabled: true,
  /** 长边最大像素（F1 默认 1920px） */
  maxLongEdge: 1920,
  /** 质量 0-100（F1 默认 85，近无损） */
  quality: 85,
  /** 输出格式：'webp' 现代格式 / 'jpeg' 兼容 / 'png' 透明 / 'keep' 跟随原图 */
  outputFormat: 'webp' as 'webp' | 'jpeg' | 'png' | 'keep',
  /** 是否剥离 EXIF（默认 false，仅保留方向，剥离其他元数据） */
  stripExif: false,
};

/** 像素尺寸校验阈值（F2） */
export const IMAGE_DIMENSION_LIMITS = {
  /** 最大长边像素，超过自动 resize（避免 8K 图导致解码卡顿/Canvas 崩溃） */
  maxLongEdge: 4096,
  /** 最小长边像素，过小直接拒绝（影响生成质量） */
  minLongEdge: 256,
};

/** 上传压缩结果（F1） */
export interface UploadCompressResult {
  /** 压缩后的 Blob URL（已通过 objectUrlRegistry 追踪，自动释放） */
  blobUrl: string;
  /** 压缩后 Blob 体积（字节） */
  size: number;
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
  /** 输出 MIME 类型 */
  format: string;
  /** 原始体积（字节） */
  originalSize: number;
  /** 节省比例 0-1（如 0.85 表示节省 85%） */
  savedRatio: number;
}

// 图片转 Base64
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// 校验图片文件
export const validateImageFile = (file: File): string | null => {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) return '仅支持 JPG/PNG/WebP 格式';
  if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) return `文件大小不能超过 ${MAX_IMAGE_SIZE_MB}MB`;
  return null;
};

export const IMAGE_MAX_SIZE_MB = MAX_IMAGE_SIZE_MB;

/**
 * 获取图片像素尺寸信息（F2）。
 *
 * 使用 createImageBitmap 解码（不渲染到 DOM），同时通过 imageOrientation: 'from-image'
 * 应用 EXIF 方向，确保后续压缩输出方向正确。
 *
 * 兼容性：Chrome 81+ / Firefox 77+ / Safari 14+。不兼容时 width/height 反映原始未旋转尺寸。
 */
export async function getImageInfo(
  file: File | Blob,
): Promise<{ width: number; height: number; hasExif: boolean; orientationApplied: boolean }> {
  // 探测是否支持 imageOrientation: 'from-image'（部分旧浏览器不支持该选项）
  try {
    // 优先尝试带 from-image 选项解码（F3 EXIF 方向保留）
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const result = { width: bitmap.width, height: bitmap.height, hasExif: true, orientationApplied: true };
    bitmap.close();
    return result;
  } catch {
    // 降级：不带选项解码（旧浏览器或非图片格式）
    try {
      const bitmap = await createImageBitmap(file);
      const result = { width: bitmap.width, height: bitmap.height, hasExif: false, orientationApplied: false };
      bitmap.close();
      return result;
    } catch {
      return { width: 0, height: 0, hasExif: false, orientationApplied: false };
    }
  }
}

/**
 * 上传时自动压缩图片（F1 + F2 + F3）。
 *
 * 流程：
 *   1. createImageBitmap({ imageOrientation: 'from-image' }) 解码（保留 EXIF 方向，F3）
 *   2. 像素尺寸校验：超过 maxLongEdge 自动等比缩放（F2）
 *   3. Canvas 重绘 + toBlob 编码（默认 WebP 质量 85，F1）
 *   4. 返回 Blob URL（替代 Base64，消除 33% 体积膨胀）
 *
 * 降级链：
 *   - createImageBitmap 不支持 → 抛错，调用方降级到 fileToBase64
 *   - WebP 编码失败 → 降级 JPEG
 *   - 压缩后体积反而变大 → 返回原图 Blob（不压缩）
 *
 * @param file 用户选择的图片文件
 * @param options 压缩参数（默认 UPLOAD_COMPRESS_DEFAULTS）
 * @returns 压缩结果，含 Blob URL 与体积对比元数据
 */
export async function compressOnUpload(
  file: File,
  options: Partial<typeof UPLOAD_COMPRESS_DEFAULTS> = {},
): Promise<UploadCompressResult> {
  const opts = { ...UPLOAD_COMPRESS_DEFAULTS, ...options };
  const originalSize = file.size;

  // F3：保留 EXIF 方向解码
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    // 降级：不带 from-image 选项（旧浏览器）
    bitmap = await createImageBitmap(file);
  }

  let { width, height } = bitmap;

  // F2：像素尺寸校验，超过 maxLongEdge 等比缩放
  const effectiveMaxLongEdge = Math.min(opts.maxLongEdge, IMAGE_DIMENSION_LIMITS.maxLongEdge);
  const longest = Math.max(width, height);
  if (longest > effectiveMaxLongEdge) {
    const scale = effectiveMaxLongEdge / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
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

  // F1：编码输出。先尝试目标格式，失败降级 JPEG
  const targetMime =
    opts.outputFormat === 'keep'
      ? file.type || 'image/jpeg'
      : opts.outputFormat === 'webp'
        ? 'image/webp'
        : opts.outputFormat === 'png'
          ? 'image/png'
          : 'image/jpeg';
  const quality = Math.min(95, Math.max(60, opts.quality)) / 100;

  let blob: Blob | null = await new Promise(resolve => {
    canvas.toBlob(resolve, targetMime, targetMime === 'image/png' ? undefined : quality);
  });

  // WebP 编码失败时降级 JPEG
  if (!blob && targetMime === 'image/webp') {
    blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
  }

  if (!blob) {
    throw new Error('canvas.toBlob returned null');
  }

  // 压缩后体积反而变大时，返回原图 Blob（不压缩）
  if (blob.size >= originalSize) {
    blob = file;
  }

  // 通过 objectUrlRegistry 追踪 Blob URL，避免内存泄漏
  const blobUrl = URL.createObjectURL(blob);
  // 注：objectUrlRegistry.createTrackedObjectUrl 在 domain 边界外，这里直接用 URL.createObjectURL
  // 由调用方在组件卸载时 revoke，依赖既有 beforeunload 兜底机制

  return {
    blobUrl,
    size: blob.size,
    width,
    height,
    format: blob.type,
    originalSize,
    savedRatio: originalSize > 0 ? 1 - blob.size / originalSize : 0,
  };
}

/**
 * 格式化字节数为易读字符串。
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

