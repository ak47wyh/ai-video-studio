/**
 * 图片处理端口 —— 封装压缩/缩放/格式转换/EXIF 处理等纯客户端能力。
 *
 * 设计决策（F6）：
 *   - 不走 PlatformRouter，因为是平台无关的本地能力（不依赖外部 API）
 *   - 在 dependencies.ts 直接装配，作为单例注入 ImageProcessingService
 *   - Adapter 内部决定 Worker / 主线程降级（F8）
 *   - domain 层零 React / fetch / axios / Canvas API 依赖，通过 Port 抽象副作用
 *
 * 调用关系：
 *   ImageProcessingService → IImageProcessorPort ← BrowserImageProcessorAdapter
 *
 * 与 FileStoragePort 的边界：
 *   - IImageProcessorPort 负责图片内容的编解码与转换（输入 Blob/URL，输出 Blob）
 *   - IFileStoragePort 负责二进制持久化（OPFS / Local）
 *   - ImageProcessingService 编排两者：压缩 → 落盘 → 元数据
 */

/** 压缩输出格式（'keep' 跟随原图 MIME） */
export type CompressOutputFormat = 'webp' | 'jpeg' | 'png' | 'keep';

/** 压缩参数（F1 默认参数见 ImageProcessingService.UPLOAD_DEFAULTS） */
export interface CompressOptions {
  /** 目标质量 0-100，默认 85（仅 JPEG/WebP 有效；PNG 无损忽略） */
  quality?: number;
  /** 目标格式，默认 'keep'（跟随原图 MIME，PNG 透明图保留 PNG） */
  outputFormat?: CompressOutputFormat;
  /** 长边最大像素，默认 undefined（不限制；F1 默认 1920，F2 上限 4096） */
  maxLongEdge?: number;
  /** 是否剥离 EXIF 元数据（GPS/设备/拍摄时间），默认 false（保留方向，剥离其他） */
  stripExif?: boolean;
  /** 是否保留 EXIF 方向（默认 true，竖拍照片不变横） */
  keepOrientation?: boolean;
}

/** 压缩/转换结果 */
export interface CompressResult {
  /** 输出 Blob（已编码为目标格式） */
  blob: Blob;
  /** 输出宽度（像素） */
  width: number;
  /** 输出高度（像素） */
  height: number;
  /** 实际输出 MIME 类型 */
  format: string;
  /** 原始体积（字节） */
  originalSize: number;
  /** 压缩后体积（字节） */
  compressedSize: number;
  /** 节省比例 0-1（如 0.85 表示节省 85%，0 表示无节省） */
  compressionRatio: number;
}

/** 图片元信息（F2 像素尺寸校验用） */
export interface ImageInfo {
  /** 原始宽度（像素，已应用 EXIF 方向） */
  width: number;
  /** 原始高度（像素，已应用 EXIF 方向） */
  height: number;
  /** 文件体积（字节） */
  size: number;
  /** MIME 类型 */
  type: string;
  /** 是否包含 EXIF 元数据 */
  hasExif: boolean;
  /** EXIF 方向（1=正常，3=180°，6=顺时针 90°，8=逆时针 90°） */
  orientation?: 1 | 3 | 6 | 8;
}

/**
 * 图片处理端口 —— 平台无关的本地图片编解码能力。
 *
 * 实现层（Adapter）负责具体的 Canvas / createImageBitmap / OffscreenCanvas 调用，
 * 并自行决定 Worker / 主线程降级（F8）。
 *
 * domain 层 Service 通过此 Port 编排业务逻辑（策略选择、降级编排、报告生成）。
 */
export interface IImageProcessorPort {
  /**
   * 获取图片元信息（F2 像素尺寸校验用）。
   *
   * @param input 图片 Blob 或可解析的 URL（http/https/blob/data）
   * @returns 图片元信息；解析失败时 width/height 为 0
   */
  getImageInfo(input: Blob | string): Promise<ImageInfo>;

  /**
   * 压缩图片（F1/F2/F3）。
   *
   * 流程：
   *   1. createImageBitmap({ imageOrientation: 'from-image' }) 解码（保留 EXIF 方向，F3）
   *   2. 像素尺寸校验：超过 maxLongEdge 自动等比缩放（F2）
   *   3. Canvas 重绘 + toBlob 编码（F1）
   *   4. 压缩后体积反而变大时返回原 Blob（不压缩）
   *
   * 降级链由 Adapter 内部处理：
   *   - createImageBitmap 不支持 → HTMLImageElement + Canvas
   *   - WebP 编码失败 → 降级 JPEG
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param options 压缩参数
   */
  compress(input: Blob | string, options: CompressOptions): Promise<CompressResult>;

  /**
   * 等比缩放到指定长边（不改变格式）。
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param targetLongEdge 目标长边像素
   */
  resize(input: Blob | string, targetLongEdge: number): Promise<CompressResult>;

  /**
   * 格式转换（不压缩，仅转码）。
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param targetFormat 目标格式
   * @param quality 质量 0-100（仅 JPEG/WebP 有效）
   */
  convertFormat(
    input: Blob | string,
    targetFormat: Exclude<CompressOutputFormat, 'keep'>,
    quality?: number,
  ): Promise<CompressResult>;

  /**
   * 剥离 EXIF 元数据（可选保留方向）。
   *
   * Canvas 重绘天然丢弃所有 EXIF，但方向需通过 imageOrientation: 'from-image' 应用。
   *
   * @param input 图片 Blob 或可解析的 URL
   * @param keepOrientation 是否保留方向（默认 true）
   */
  stripExif(input: Blob | string, keepOrientation?: boolean): Promise<CompressResult>;
}
