import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  InpaintRegion,
  InpaintOptions,
  InpaintAlgorithm,
  PdfOptions,
  VideoOptions,
  VideoInpaintMode,
} from '../../domain/ports/WatermarkRemovalPorts';
import {
  imageInpaintAdapter,
  pdfWatermarkAdapter,
  delogoVideoInpaintAdapter,
  qualityVideoInpaintAdapter,
} from '../../dependencies';

/** 处理类型 */
type ProcessType = 'image' | 'pdf' | 'video';

/** 上次处理的参数快照（用于重试） */
interface LastProcessParams {
  type: ProcessType;
  file: File;
  regions: InpaintRegion[];
  algorithm?: InpaintAlgorithm; // 图片
  dpi?: number; // PDF
  videoMode?: VideoInpaintMode; // 视频
}

/** 备选算法链：当主算法失败时按顺序自动尝试其他算法 */
const FALLBACK_ALGORITHMS: InpaintAlgorithm[] = [
  'edge_interpolation',
  'texture_synthesis',
  'telea',
  'navier_stokes',
  'fast_fill',
];

/** 自动重试配置 */
const AUTO_RETRY_CONFIG = {
  maxRetries: 2, // 失败后自动重试次数（不含首次）
  baseDelayMs: 400, // 重试间隔基数
};

interface UseWatermarkRemovalResult {
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
  /** 当前重试次数（0 表示首次处理） */
  retryCount: number;
  /** 当前正在尝试的算法（自动降级时与原始算法不同） */
  currentAlgorithm: InpaintAlgorithm | null;
  /** 是否正在自动降级重试中 */
  isFallbackRetry: boolean;
  /** 执行图片去水印 */
  processImage: (file: File, regions: InpaintRegion[], algorithm: InpaintAlgorithm) => Promise<void>;
  /** 执行 PDF 去水印 */
  processPdf: (file: File, regions: InpaintRegion[], dpi: number) => Promise<void>;
  /** 执行视频去水印 */
  processVideo: (file: File, regions: InpaintRegion[], mode: VideoInpaintMode) => Promise<void>;
  /** 使用上次参数重试（手动触发） */
  retry: () => Promise<void>;
  /** 取消处理 */
  cancel: () => void;
  /** 重置状态 */
  reset: () => void;
}

export function useWatermarkRemoval(): UseWatermarkRemovalResult {
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [currentAlgorithm, setCurrentAlgorithm] = useState<InpaintAlgorithm | null>(null);
  const [isFallbackRetry, setIsFallbackRetry] = useState(false);

  const cancelledRef = useRef(false);
  const lastParamsRef = useRef<LastProcessParams | null>(null);
  // V2 P0-4.3.2：ref 跟踪 resultUrl，卸载时兜底 revoke
  const resultUrlRef = useRef<string | null>(null);
  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);
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
      // 用 cancelledRef 做软中断：直接在取消时让等待 promise reject
      // (此处无法主动 clearTimeout，但 reject 会跳过 resolve)
      void timer;
    });
  };

  /** 包装处理函数：带自动重试 + 算法降级 */
  const processWithRetry = useCallback(async (
    type: ProcessType,
    file: File,
    regions: InpaintRegion[],
    algorithm: InpaintAlgorithm | undefined,
    dpi: number | undefined,
    videoMode: VideoInpaintMode | undefined,
  ): Promise<void> => {
    setIsProcessing(true);
    setError(null);
    setProgress(0);
    setRetryCount(0);
    setIsFallbackRetry(false);
    cancelledRef.current = false;

    // 保存参数快照供手动重试
    lastParamsRef.current = { type, file, regions, algorithm, dpi, videoMode };

    // 图片类型支持算法降级；PDF/视频固定算法
    const algorithmChain: (InpaintAlgorithm | undefined)[] =
      type === 'image'
        ? [algorithm, ...FALLBACK_ALGORITHMS.filter(a => a !== algorithm)]
        : [algorithm];

    let lastErr: unknown = null;
    let attemptSuccess = false;

    for (let algoIdx = 0; algoIdx < algorithmChain.length && !attemptSuccess; algoIdx++) {
      const currentAlgo = algorithmChain[algoIdx];
      if (currentAlgo) setCurrentAlgorithm(currentAlgo);
      setIsFallbackRetry(algoIdx > 0);

      const maxAttempts = 1 + AUTO_RETRY_CONFIG.maxRetries;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (cancelledRef.current) break;

        try {
          if (attempt > 0) {
            setRetryCount(attempt);
            // 指数退避等待
            const delay = AUTO_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
            await sleep(delay);
          }

          if (cancelledRef.current) break;

          let blob: Blob | null = null;
          if (type === 'image' && currentAlgo) {
            const bitmap = await createImageBitmap(file);
            try {
              const options: InpaintOptions = { algorithm: currentAlgo, quality: 0.85 };
              const result = await imageInpaintAdapter.inpaint(bitmap, regions, options, (p) => {
                if (cancelledRef.current) throw new Error('CANCELLED');
                setProgress(p);
              });
              blob = result.blob;
            } finally {
              bitmap.close?.();
            }
          } else if (type === 'pdf' && dpi !== undefined) {
            const options: PdfOptions = { renderDpi: dpi, regionStrategy: 'global' };
            blob = await pdfWatermarkAdapter.removeWatermark(file, regions, options, (p) => {
              if (cancelledRef.current) throw new Error('CANCELLED');
              setProgress(p);
            });
          } else if (type === 'video') {
            const mode = videoMode ?? 'quality';
            const options: VideoOptions = {
              watermarkType: 'static',
              sampleStrategy: 'keyframes_only',
              outputCodec: 'h264',
              mode,
            };
            // 根据 mode 选择适配器：fast → delogo，quality → 逐帧
            const adapter = mode === 'fast' ? delogoVideoInpaintAdapter : qualityVideoInpaintAdapter;
            blob = await adapter.inpaintVideo(file, regions, options, (p) => {
              if (cancelledRef.current) throw new Error('CANCELLED');
              setProgress(p);
            });
          }

          if (cancelledRef.current) break;

          if (blob) {
            releaseResultUrl(resultUrl);
            const url = URL.createObjectURL(blob);
            setResultBlob(blob);
            setResultUrl(url);
            setProgress(1);
            attemptSuccess = true;
            break;
          }
        } catch (e) {
          if (e instanceof Error && e.message === 'CANCELLED') {
            // 用户主动取消，不视为错误
            attemptSuccess = true; // 跳出双重循环
            break;
          }
          lastErr = e;
          // 继续下一次尝试
        }
      }
      if (cancelledRef.current) break;
    }

    setIsFallbackRetry(false);

    if (!attemptSuccess && !cancelledRef.current) {
      const message = lastErr instanceof Error ? lastErr.message : '去水印处理失败';
      setError(message);
    }

    setIsProcessing(false);
  }, [resultUrl, releaseResultUrl]);

  const processImage = useCallback(async (
    file: File,
    regions: InpaintRegion[],
    algorithm: InpaintAlgorithm,
  ): Promise<void> => {
    await processWithRetry('image', file, regions, algorithm, undefined, undefined);
  }, [processWithRetry]);

  const processPdf = useCallback(async (
    file: File,
    regions: InpaintRegion[],
    dpi: number,
  ): Promise<void> => {
    await processWithRetry('pdf', file, regions, undefined, dpi, undefined);
  }, [processWithRetry]);

  const processVideo = useCallback(async (
    file: File,
    regions: InpaintRegion[],
    mode: VideoInpaintMode,
  ): Promise<void> => {
    await processWithRetry('video', file, regions, undefined, undefined, mode);
  }, [processWithRetry]);

  /** 手动重试：使用上次的参数重新执行 */
  const retry = useCallback(async (): Promise<void> => {
    const params = lastParamsRef.current;
    if (!params) return;
    // 重置错误状态
    setError(null);
    // 直接调用对应处理函数（processXxx 内部会再次重置 retryCount 等）
    if (params.type === 'image' && params.algorithm) {
      await processImage(params.file, params.regions, params.algorithm);
    } else if (params.type === 'pdf' && params.dpi !== undefined) {
      await processPdf(params.file, params.regions, params.dpi);
    } else if (params.type === 'video' && params.videoMode) {
      await processVideo(params.file, params.regions, params.videoMode);
    }
  }, [processImage, processPdf, processVideo]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const reset = useCallback(() => {
    releaseResultUrl(resultUrl);
    setResultUrl(null);
    setResultBlob(null);
    setProgress(0);
    setError(null);
    setRetryCount(0);
    setCurrentAlgorithm(null);
    setIsFallbackRetry(false);
    lastParamsRef.current = null;
  }, [resultUrl, releaseResultUrl]);

  return {
    progress,
    isProcessing,
    error,
    resultUrl,
    resultBlob,
    retryCount,
    currentAlgorithm,
    isFallbackRetry,
    processImage,
    processPdf,
    processVideo,
    retry,
    cancel,
    reset,
  };
}
