import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  ImageEnhanceOptions,
  PdfEnhanceOptions,
  VideoEnhanceOptions,
  EnhanceMode,
  ImageScale,
  VideoScale,
  ImageOutputFormat,
  PdfOutputForm,
  PdfPageRange,
  VideoOutputCodec,
} from '../../domain/ports/EnhancementPorts';
import {
  imageEnhanceAdapter,
  pdfEnhanceAdapter,
  videoEnhanceAdapter,
} from '../../dependencies';

/** 处理类型 */
type ProcessType = 'image' | 'pdf' | 'video';

/** 上次处理的参数快照（用于重试） */
interface LastProcessParams {
  type: ProcessType;
  file: File;
  options: ImageEnhanceOptions | PdfEnhanceOptions | VideoEnhanceOptions;
}

/** 自动重试配置（对齐 useWatermarkRemoval） */
const AUTO_RETRY_CONFIG = {
  maxRetries: 2, // 失败后自动重试次数（不含首次）
  baseDelayMs: 400, // 重试间隔基数
};

interface UseEnhancementResult {
  /** 处理进度 0-1 */
  progress: number;
  /** 是否正在处理 */
  isProcessing: boolean;
  /** 错误信息 */
  error: string | null;
  /** 结果 Blob URL */
  resultUrl: string | null;
  /** 结果 Blob */
  resultBlob: Blob | null;
  /** 结果尺寸（图片用） */
  resultSize: { width: number; height: number } | null;
  /** 当前重试次数（0 表示首次处理） */
  retryCount: number;
  /** 是否正在自动降级重试中 */
  isFallbackRetry: boolean;
  /** 执行图片增强 */
  processImage: (file: File, options: ImageEnhanceOptions) => Promise<void>;
  /** 执行 PDF 增强 */
  processPdf: (file: File, options: PdfEnhanceOptions) => Promise<void>;
  /** 执行视频增强 */
  processVideo: (file: File, options: VideoEnhanceOptions) => Promise<void>;
  /** 使用上次参数重试（手动触发） */
  retry: () => Promise<void>;
  /** 取消处理 */
  cancel: () => void;
  /** 重置状态 */
  reset: () => void;
}

export function useEnhancement(): UseEnhancementResult {
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultSize, setResultSize] = useState<{ width: number; height: number } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isFallbackRetry, setIsFallbackRetry] = useState(false);

  const cancelledRef = useRef(false);
  const lastParamsRef = useRef<LastProcessParams | null>(null);
  // V2 P0-4.3.1：用 ref 跟踪最新 resultUrl，卸载时兜底 revoke
  const resultUrlRef = useRef<string | null>(null);
  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);
  // 组件卸载时释放当前 Blob URL，避免视频增强结果（数十 MB）泄漏
  useEffect(() => {
    return () => {
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
    };
  }, []);

  /** 释放上一次结果 URL */
  const releaseResultUrl = useCallback((url: string | null) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  /** sleep（支持软取消） */
  const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (cancelledRef.current) {
        reject(new Error('CANCELLED'));
        return;
      }
      const timer = setTimeout(() => {
        if (cancelledRef.current) {
          reject(new Error('CANCELLED'));
        } else {
          resolve();
        }
      }, ms);
      void timer;
    });
  };

  /** 包装处理函数：带自动重试（对齐 useWatermarkRemoval 的 processWithRetry） */
  const processWithRetry = useCallback(async (
    type: ProcessType,
    file: File,
    options: ImageEnhanceOptions | PdfEnhanceOptions | VideoEnhanceOptions,
  ): Promise<void> => {
    setIsProcessing(true);
    setError(null);
    setProgress(0);
    setRetryCount(0);
    setIsFallbackRetry(false);
    cancelledRef.current = false;

    // 保存参数快照供手动重试
    lastParamsRef.current = { type, file, options };

    let lastErr: unknown = null;
    let attemptSuccess = false;

    const maxAttempts = 1 + AUTO_RETRY_CONFIG.maxRetries;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (cancelledRef.current) break;

      try {
        if (attempt > 0) {
          setRetryCount(attempt);
          setIsFallbackRetry(true);
          const delay = AUTO_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
          await sleep(delay);
        }

        if (cancelledRef.current) break;

        if (type === 'image') {
          const bitmap = await createImageBitmap(file);
          try {
            const result = await imageEnhanceAdapter.enhance(bitmap, options as ImageEnhanceOptions, (p) => {
              if (cancelledRef.current) throw new Error('CANCELLED');
              setProgress(p);
            });
            if (cancelledRef.current) break;
            releaseResultUrl(resultUrl);
            const url = URL.createObjectURL(result.blob);
            setResultBlob(result.blob);
            setResultUrl(url);
            setResultSize({ width: result.width, height: result.height });
            setProgress(1);
            attemptSuccess = true;
            break;
          } finally {
            bitmap.close?.();
          }
        } else if (type === 'pdf') {
          const blob = await pdfEnhanceAdapter.enhance(file, options as PdfEnhanceOptions, (p) => {
            if (cancelledRef.current) throw new Error('CANCELLED');
            setProgress(p);
          });
          if (cancelledRef.current) break;
          releaseResultUrl(resultUrl);
          const url = URL.createObjectURL(blob);
          setResultBlob(blob);
          setResultUrl(url);
          setResultSize(null);
          setProgress(1);
          attemptSuccess = true;
          break;
        } else if (type === 'video') {
          const blob = await videoEnhanceAdapter.enhance(file, options as VideoEnhanceOptions, (p) => {
            if (cancelledRef.current) throw new Error('CANCELLED');
            setProgress(p);
          });
          if (cancelledRef.current) break;
          releaseResultUrl(resultUrl);
          const url = URL.createObjectURL(blob);
          setResultBlob(blob);
          setResultUrl(url);
          setResultSize(null);
          setProgress(1);
          attemptSuccess = true;
          break;
        }
      } catch (e) {
        if (e instanceof Error && e.message === 'CANCELLED') {
          attemptSuccess = true; // 跳出循环
          break;
        }
        lastErr = e;
      }
      if (cancelledRef.current) break;
    }

    setIsFallbackRetry(false);

    if (!attemptSuccess && !cancelledRef.current) {
      const message = lastErr instanceof Error ? lastErr.message : '清晰度提升处理失败';
      setError(message);
    }

    setIsProcessing(false);
  }, [resultUrl, releaseResultUrl]);

  const processImage = useCallback(async (
    file: File,
    options: ImageEnhanceOptions,
  ): Promise<void> => {
    await processWithRetry('image', file, options);
  }, [processWithRetry]);

  const processPdf = useCallback(async (
    file: File,
    options: PdfEnhanceOptions,
  ): Promise<void> => {
    await processWithRetry('pdf', file, options);
  }, [processWithRetry]);

  const processVideo = useCallback(async (
    file: File,
    options: VideoEnhanceOptions,
  ): Promise<void> => {
    await processWithRetry('video', file, options);
  }, [processWithRetry]);

  /** 手动重试：使用上次的参数重新执行 */
  const retry = useCallback(async (): Promise<void> => {
    const params = lastParamsRef.current;
    if (!params) return;
    setError(null);
    if (params.type === 'image') {
      await processImage(params.file, params.options as ImageEnhanceOptions);
    } else if (params.type === 'pdf') {
      await processPdf(params.file, params.options as PdfEnhanceOptions);
    } else if (params.type === 'video') {
      await processVideo(params.file, params.options as VideoEnhanceOptions);
    }
  }, [processImage, processPdf, processVideo]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const reset = useCallback(() => {
    releaseResultUrl(resultUrl);
    setResultUrl(null);
    setResultBlob(null);
    setResultSize(null);
    setProgress(0);
    setError(null);
    setRetryCount(0);
    setIsFallbackRetry(false);
    lastParamsRef.current = null;
  }, [resultUrl, releaseResultUrl]);

  return {
    progress,
    isProcessing,
    error,
    resultUrl,
    resultBlob,
    resultSize,
    retryCount,
    isFallbackRetry,
    processImage,
    processPdf,
    processVideo,
    retry,
    cancel,
    reset,
  };
}

// ==================== 选项工厂辅助函数 ====================
// 便于 UI 层快速构造 Options 对象，避免散落构造逻辑

export function buildImageOptions(
  mode: EnhanceMode,
  scale: ImageScale,
  sharpenStrength: number,
  denoiseStrength: number,
  outputFormat: ImageOutputFormat,
): ImageEnhanceOptions {
  return {
    mode,
    scale,
    sharpenStrength,
    denoiseStrength,
    outputFormat,
    quality: outputFormat === 'jpeg' ? 0.85 : 1,
  };
}

export function buildPdfOptions(
  outputDpi: 96 | 150 | 300,
  mode: EnhanceMode,
  sharpenStrength: number,
  pageRange: PdfPageRange,
  outputForm: PdfOutputForm,
): PdfEnhanceOptions {
  return { outputDpi, mode, sharpenStrength, pageRange, outputForm };
}

export function buildVideoOptions(
  mode: EnhanceMode,
  scale: VideoScale,
  sharpenStrength: number,
  denoiseStrength: number,
  outputCodec: VideoOutputCodec,
  frameInterpolation: boolean,
): VideoEnhanceOptions {
  return { mode, scale, sharpenStrength, denoiseStrength, outputCodec, frameInterpolation };
}
