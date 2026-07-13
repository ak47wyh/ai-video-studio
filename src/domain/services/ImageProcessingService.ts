import type { ILoggerPort, LogContext } from '../ports/CrossCuttingPorts';
import type {
  IImageProcessorPort,
  CompressOptions,
  CompressResult,
  ImageInfo,
  CompressOutputFormat,
} from '../ports/ImageProcessingPorts';

/**
 * 压缩策略枚举（字面量联合，不用 enum）。
 *
 * - size-first: 体积优先，质量 70，长边 1280，WebP
 * - quality-first: 画质优先，质量 92，长边 2560，WebP
 * - balanced: 平衡（默认），质量 85，长边 1920，WebP
 * - custom: 自定义（用户在 UI 层提供 options）
 */
export type CompressStrategy = 'size-first' | 'quality-first' | 'balanced' | 'custom';

/** 策略预设参数（domain 层定义，Adapter 不感知策略） */
export const STRATEGY_PRESETS: Record<Exclude<CompressStrategy, 'custom'>, CompressOptions> = {
  'size-first': { quality: 70, outputFormat: 'webp', maxLongEdge: 1280, stripExif: false, keepOrientation: true },
  'quality-first': { quality: 92, outputFormat: 'webp', maxLongEdge: 2560, stripExif: false, keepOrientation: true },
  'balanced': { quality: 85, outputFormat: 'webp', maxLongEdge: 1920, stripExif: false, keepOrientation: true },
};

/** 上传时自动压缩默认参数（F1） */
export const UPLOAD_DEFAULTS: CompressOptions = {
  quality: 85,
  outputFormat: 'webp',
  maxLongEdge: 1920,
  stripExif: false,
  keepOrientation: true,
};

/** 像素尺寸校验阈值（F2） */
export const IMAGE_DIMENSION_LIMITS = {
  maxLongEdge: 4096,
  minLongEdge: 256,
} as const;

/** 处理后的图片（F1 上传压缩返回值） */
export interface ProcessedFile {
  /** 压缩后 Blob */
  blob: Blob;
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
  /** 输出 MIME */
  format: string;
  /** 原始体积 */
  originalSize: number;
  /** 压缩后体积 */
  compressedSize: number;
  /** 节省比例 0-1 */
  savedRatio: number;
}

/** 批量压缩单条结果 */
export interface BatchCompressItem {
  /** 输入标识（调用方传入，用于回溯） */
  id: string;
  /** 是否成功 */
  success: boolean;
  /** 原始体积 */
  originalSize: number;
  /** 压缩后体积 */
  compressedSize: number;
  /** 节省比例 0-1 */
  ratio: number;
  /** 失败原因（success=false 时有值） */
  error?: string;
  /** 压缩结果（success=true 时有值） */
  result?: CompressResult;
}

/** 批量压缩汇总报告 */
export interface CompressReport {
  /** 总数 */
  total: number;
  /** 成功数 */
  success: number;
  /** 失败数 */
  failed: number;
  /** 原始总体积 */
  totalOriginalSize: number;
  /** 压缩后总体积 */
  totalCompressedSize: number;
  /** 平均节省比例 0-1 */
  averageRatio: number;
  /** 逐条结果 */
  items: BatchCompressItem[];
}

/** 单图压缩预览（F9，不落盘） */
export interface CompressPreview {
  /** 原始图片信息 */
  original: ImageInfo;
  /** 压缩后结果 */
  compressed: CompressResult;
  /** 应用的参数 */
  options: CompressOptions;
}

/**
 * 图片处理领域服务 —— 编排 IImageProcessorPort，提供业务语义化方法。
 *
 * 职责：
 *   - 策略映射（CompressStrategy → CompressOptions）
 *   - 上传时压缩（F1）
 *   - 批量压缩（F11），返回报告
 *   - 单图压缩预览（F9），不落盘
 *   - 日志走 ILoggerPort，统一 ctx() 工厂附加 service 字段
 *
 * 不含平台决策（如 Worker / 主线程降级），由 Adapter 自行处理。
 *
 * 设计决策（F7）：
 *   - 不依赖 IFileStoragePort，落盘由调用方（如 AssetLibraryService）负责
 *   - compressBatch 接受 inputs 数组（Blob | URL），不感知素材库仓储
 *   - 错误处理：业务校验失败 throw new Error('英文短句')，
 *     平台错误由 Adapter 归一化为 ImageProcessingError
 */
export class ImageProcessingService {
  private readonly processor: IImageProcessorPort;
  private readonly logger: ILoggerPort;

  constructor(
    processor: IImageProcessorPort,
    logger: ILoggerPort,
  ) {
    this.processor = processor;
    this.logger = logger.child({ service: 'ImageProcessingService' });
  }

  /** 日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'ImageProcessingService', ...extra };
  }

  /**
   * 上传时自动压缩（F1）。
   *
   * 应用 UPLOAD_DEFAULTS 默认参数（1920px / WebP / 质量 85 / 保留 EXIF 方向）。
   * 调用方负责落盘（如 ImageUploadField 仅用 Blob URL，AssetLibraryService 负责持久化）。
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param overrides 覆盖默认参数（可选）
   */
  async compressOnUpload(
    input: Blob | string,
    overrides: Partial<CompressOptions> = {},
  ): Promise<ProcessedFile> {
    const options: CompressOptions = { ...UPLOAD_DEFAULTS, ...overrides };
    this.logger.info('compressOnUpload start', this.ctx({ options, inputType: typeof input }));

    try {
      const result = await this.processor.compress(input, options);
      this.logger.info('compressOnUpload done', this.ctx({
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        ratio: result.compressionRatio,
      }));
      return {
        blob: result.blob,
        width: result.width,
        height: result.height,
        format: result.format,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savedRatio: result.compressionRatio,
      };
    } catch (e) {
      this.logger.error('compressOnUpload failed', e, this.ctx({}));
      throw e;
    }
  }

  /**
   * 按策略压缩单张图片。
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param strategy 压缩策略（custom 时使用 overrides）
   * @param overrides 自定义参数（仅 strategy='custom' 时生效）
   */
  async compressWithStrategy(
    input: Blob | string,
    strategy: CompressStrategy,
    overrides: Partial<CompressOptions> = {},
  ): Promise<CompressResult> {
    const options = strategy === 'custom'
      ? overrides
      : STRATEGY_PRESETS[strategy];
    this.logger.info('compressWithStrategy start', this.ctx({ strategy, options }));
    return this.processor.compress(input, options);
  }

  /**
   * 批量压缩（F11），返回汇总报告。
   *
   * 串行处理（Adapter 内部已用 Worker，避免并发触发过多解码）。
   * 单张失败不影响其他，最终汇总到 CompressReport。
   *
   * @param inputs 输入数组（每项含 id 与 Blob/URL）
   * @param strategy 压缩策略
   * @param overrides 自定义参数（仅 strategy='custom' 时生效）
   * @param onProgress 进度回调（已完成数 / 总数）
   */
  async compressBatch(
    inputs: Array<{ id: string; input: Blob | string }>,
    strategy: CompressStrategy,
    overrides: Partial<CompressOptions> = {},
    onProgress?: (current: number, total: number) => void,
  ): Promise<CompressReport> {
    const options = strategy === 'custom'
      ? overrides
      : STRATEGY_PRESETS[strategy];

    this.logger.info('compressBatch start', this.ctx({
      count: inputs.length,
      strategy,
    }));

    const items: BatchCompressItem[] = [];
    let totalOriginal = 0;
    let totalCompressed = 0;

    for (let i = 0; i < inputs.length; i++) {
      const { id, input } = inputs[i];
      try {
        const result = await this.processor.compress(input, options);
        items.push({
          id,
          success: true,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          ratio: result.compressionRatio,
          result,
        });
        totalOriginal += result.originalSize;
        totalCompressed += result.compressedSize;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.logger.warn('compressBatch item failed', this.ctx({ id, index: i, error }));
        items.push({
          id,
          success: false,
          originalSize: 0,
          compressedSize: 0,
          ratio: 0,
          error,
        });
      }
      onProgress?.(i + 1, inputs.length);
    }

    const success = items.filter(i => i.success).length;
    const failed = items.length - success;
    const averageRatio = totalOriginal > 0 ? 1 - totalCompressed / totalOriginal : 0;

    const report: CompressReport = {
      total: inputs.length,
      success,
      failed,
      totalOriginalSize: totalOriginal,
      totalCompressedSize: totalCompressed,
      averageRatio,
      items,
    };

    this.logger.info('compressBatch done', this.ctx({
      total: report.total,
      success: report.success,
      failed: report.failed,
      averageRatio: report.averageRatio,
    }));

    return report;
  }

  /**
   * 单图压缩预览（F9），不落盘。
   *
   * 用于 CompressPreviewDialog 左右对比 + 滑块调参实时预览。
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param options 压缩参数
   */
  async previewCompress(
    input: Blob | string,
    options: CompressOptions,
  ): Promise<CompressPreview> {
    this.logger.info('previewCompress start', this.ctx({ options }));
    const [original, compressed] = await Promise.all([
      this.processor.getImageInfo(input),
      this.processor.compress(input, options),
    ]);
    return { original, compressed, options };
  }

  /**
   * 获取图片信息（F2 像素尺寸校验用）。
   */
  async getImageInfo(input: Blob | string): Promise<ImageInfo> {
    return this.processor.getImageInfo(input);
  }

  /**
   * 校验像素尺寸是否在合理范围（F2）。
   *
   * @returns null 表示通过，否则返回英文短句错误
   */
  validateDimension(info: ImageInfo): string | null {
    const longest = Math.max(info.width, info.height);
    if (longest === 0) return 'image decode failed';
    if (longest < IMAGE_DIMENSION_LIMITS.minLongEdge) {
      return `image too small: ${info.width}x${info.height}, minimum long edge ${IMAGE_DIMENSION_LIMITS.minLongEdge}px`;
    }
    return null;
  }

  /**
   * 根据用户偏好解析最终输出格式。
   * 当用户选 'keep' 时按源 MIME 决定，PNG 透明图保留 PNG。
   */
  resolveOutputFormat(sourceMime: string, preferred: CompressOutputFormat): Exclude<CompressOutputFormat, 'keep'> {
    if (preferred !== 'keep') return preferred;
    // 跟随原图；PNG 透明图保留 PNG（JPEG 不支持透明）
    return sourceMime === 'image/png' ? 'png' : 'webp';
  }
}
