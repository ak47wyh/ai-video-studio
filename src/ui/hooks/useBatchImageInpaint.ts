/**
 * useBatchImageInpaint —— 批量图片去水印 hook
 *
 * 功能：
 * - 多文件管理（添加/移除/清空）
 * - 统一选区为主 + 可单独调整
 * - 用户可选并发数（1/3/5）
 * - 任务队列调度（限并发执行）
 * - 部分失败容错（继续其他，失败可重试）
 * - 统一算法应用
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  InpaintRegion,
  InpaintAlgorithm,
} from '../../domain/ports/WatermarkRemovalPorts';
import { imageInpaintAdapter } from '../../dependencies';

/** 单个任务状态 */
export type BatchTaskState = 'pending' | 'processing' | 'success' | 'error';

/** 批量任务项 */
export interface BatchImageTask {
  id: string;
  file: File;
  /** 缩略图 URL */
  thumbnailUrl: string;
  /** 原始尺寸 */
  naturalSize: { w: number; h: number };
  /** 显示尺寸 */
  displaySize: { w: number; h: number };
  /** 该任务的选区（undefined 表示使用统一选区） */
  regions?: InpaintRegion[];
  /** 任务状态 */
  state: BatchTaskState;
  /** 进度 0-1 */
  progress: number;
  /** 错误信息 */
  error: string | null;
  /** 结果 Blob */
  resultBlob: Blob | null;
  /** 结果预览 URL */
  resultUrl: string | null;
}

/** 批量处理整体状态 */
export type BatchState = 'idle' | 'ready' | 'processing' | 'done';

const MAX_DIMENSION = 400;

/** 生成唯一 id */
function genId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取图片元数据 */
function loadImageMeta(file: File): Promise<{
  url: string;
  naturalSize: { w: number; h: number };
  displaySize: { w: number; h: number };
}> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const naturalSize = { w: img.naturalWidth, h: img.naturalHeight };
      const ratio = img.naturalWidth / img.naturalHeight;
      let dw = MAX_DIMENSION;
      let dh = MAX_DIMENSION / ratio;
      if (dh > MAX_DIMENSION) {
        dh = MAX_DIMENSION;
        dw = MAX_DIMENSION * ratio;
      }
      resolve({ url, naturalSize, displaySize: { w: Math.round(dw), h: Math.round(dh) } });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

interface UseBatchImageInpaintResult {
  /** 任务列表 */
  tasks: BatchImageTask[];
  /** 整体状态 */
  batchState: BatchState;
  /** 统一选区 */
  unifiedRegions: InpaintRegion[];
  /** 当前算法 */
  algorithm: InpaintAlgorithm;
  /** 并发数 */
  concurrency: number;
  /** 已完成数 / 总数 */
  completedCount: number;
  /** 失败数 */
  failedCount: number;
  /** 是否正在处理 */
  isProcessing: boolean;
  /** 添加文件 */
  addFiles: (files: File[]) => Promise<void>;
  /** 移除任务 */
  removeTask: (id: string) => void;
  /** 清空所有任务 */
  clearAll: () => void;
  /** 设置统一选区 */
  setUnifiedRegions: (regions: InpaintRegion[]) => void;
  /** 设置某任务的单独选区 */
  setTaskRegions: (id: string, regions: InpaintRegion[]) => void;
  /** 清除某任务的单独选区（回退到统一选区） */
  clearTaskRegions: (id: string) => void;
  /** 设置算法 */
  setAlgorithm: (algo: InpaintAlgorithm) => void;
  /** 设置并发数 */
  setConcurrency: (n: number) => void;
  /** 获取任务实际使用的选区（单独选区优先，否则统一选区） */
  getEffectiveRegions: (id: string) => InpaintRegion[];
  /** 开始批量处理 */
  processAll: () => Promise<void>;
  /** 重试失败的任务 */
  retryFailed: () => Promise<void>;
  /** 取消处理 */
  cancel: () => void;
}

export function useBatchImageInpaint(): UseBatchImageInpaintResult {
  const [tasks, setTasks] = useState<BatchImageTask[]>([]);
  const [batchState, setBatchState] = useState<BatchState>('idle');
  const [unifiedRegions, setUnifiedRegionsState] = useState<InpaintRegion[]>([]);
  const [algorithm, setAlgorithmState] = useState<InpaintAlgorithm>('edge_interpolation');
  const [concurrency, setConcurrencyState] = useState(3);
  const [isProcessing, setIsProcessing] = useState(false);

  const cancelledRef = useRef(false);

  // V2 P0-4.3.3：ref 跟踪最新 tasks，卸载时统一 revoke 全部 thumbnail/result URL
  const tasksRef = useRef<BatchImageTask[]>([]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    return () => {
      // 批量任务下每 task 至多 2 个 URL（thumbnail + result），20 张图 = 40 个 URL 泄漏点
      for (const t of tasksRef.current) {
        if (t.thumbnailUrl) URL.revokeObjectURL(t.thumbnailUrl);
        if (t.resultUrl) URL.revokeObjectURL(t.resultUrl);
      }
      tasksRef.current = [];
    };
  }, []);

  const completedCount = tasks.filter(t => t.state === 'success').length;
  const failedCount = tasks.filter(t => t.state === 'error').length;

  /** 添加文件 */
  const addFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const newTasks: BatchImageTask[] = [];
    for (const file of imageFiles) {
      try {
        const meta = await loadImageMeta(file);
        newTasks.push({
          id: genId(),
          file,
          thumbnailUrl: meta.url,
          naturalSize: meta.naturalSize,
          displaySize: meta.displaySize,
          state: 'pending',
          progress: 0,
          error: null,
          resultBlob: null,
          resultUrl: null,
        });
      } catch {
        // 跳过加载失败的图片
      }
    }
    setTasks(prev => [...prev, ...newTasks]);
    setBatchState(prev => prev === 'idle' && newTasks.length > 0 ? 'ready' : prev);
  }, []);

  /** 移除任务 */
  const removeTask = useCallback((id: string) => {
    setTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (task) {
        if (task.thumbnailUrl) URL.revokeObjectURL(task.thumbnailUrl);
        if (task.resultUrl) URL.revokeObjectURL(task.resultUrl);
      }
      const next = prev.filter(t => t.id !== id);
      return next;
    });
  }, []);

  /** 清空所有任务 */
  const clearAll = useCallback(() => {
    setTasks(prev => {
      prev.forEach(t => {
        if (t.thumbnailUrl) URL.revokeObjectURL(t.thumbnailUrl);
        if (t.resultUrl) URL.revokeObjectURL(t.resultUrl);
      });
      return [];
    });
    setUnifiedRegionsState([]);
    setBatchState('idle');
  }, []);

  /** 设置统一选区 */
  const setUnifiedRegions = useCallback((regions: InpaintRegion[]) => {
    setUnifiedRegionsState(regions);
  }, []);

  /** 设置某任务的单独选区 */
  const setTaskRegions = useCallback((id: string, regions: InpaintRegion[]) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, regions: [...regions] } : t));
  }, []);

  /** 清除某任务的单独选区 */
  const clearTaskRegions = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, regions: undefined } : t));
  }, []);

  /** 设置算法 */
  const setAlgorithm = useCallback((algo: InpaintAlgorithm) => {
    setAlgorithmState(algo);
  }, []);

  /** 设置并发数 */
  const setConcurrency = useCallback((n: number) => {
    setConcurrencyState(n);
  }, []);

  /** 获取任务实际使用的选区 */
  const getEffectiveRegions = useCallback((id: string): InpaintRegion[] => {
    const task = tasks.find(t => t.id === id);
    if (!task) return unifiedRegions;
    return task.regions ?? unifiedRegions;
  }, [tasks, unifiedRegions]);

  /** 处理单个任务 */
  const processTask = useCallback(async (task: BatchImageTask): Promise<void> => {
    const regions = task.regions ?? unifiedRegions;
    if (regions.length === 0) {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, state: 'error', error: '未选择水印区域' } : t));
      return;
    }

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, state: 'processing', progress: 0, error: null } : t));

    try {
      const bitmap = await createImageBitmap(task.file);
      try {
        const result = await imageInpaintAdapter.inpaint(bitmap, regions, {
          algorithm,
          quality: 0.85,
        }, (p) => {
          if (cancelledRef.current) throw new Error('CANCELLED');
          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, progress: p } : t));
        });
        const url = URL.createObjectURL(result.blob);
        setTasks(prev => prev.map(t => t.id === task.id ? {
          ...t,
          state: 'success',
          progress: 1,
          resultBlob: result.blob,
          resultUrl: url,
        } : t));
      } finally {
        bitmap.close?.();
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'CANCELLED') return;
      setTasks(prev => prev.map(t => t.id === task.id ? {
        ...t,
        state: 'error',
        error: e instanceof Error ? e.message : '处理失败',
      } : t));
    }
  }, [unifiedRegions, algorithm]);

  /** 批量处理（限并发） */
  const processAll = useCallback(async () => {
    if (tasks.length === 0 || unifiedRegions.length === 0) return;
    setIsProcessing(true);
    setBatchState('processing');
    cancelledRef.current = false;

    // 重置所有任务为 pending
    setTasks(prev => prev.map(t => ({
      ...t,
      state: 'pending' as BatchTaskState,
      progress: 0,
      error: null,
      resultBlob: null,
      resultUrl: t.resultUrl ? (URL.revokeObjectURL(t.resultUrl), null) : null,
    })));

    // 限并发调度
    const queue = [...tasks];
    const running: Promise<void>[] = [];

    const runNext = async (): Promise<void> => {
      const task = queue.shift();
      if (!task) return;
      if (cancelledRef.current) return;
      await processTask(task);
      if (!cancelledRef.current) await runNext();
    };

    // 启动 N 个并发 worker
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      running.push(runNext());
    }
    await Promise.all(running);

    setIsProcessing(false);
    setBatchState('done');
  }, [tasks, unifiedRegions, concurrency, processTask]);

  /** 重试失败的任务 */
  const retryFailed = useCallback(async () => {
    const failedIds = new Set(tasks.filter(t => t.state === 'error').map(t => t.id));
    if (failedIds.size === 0) return;
    setIsProcessing(true);
    setBatchState('processing');
    cancelledRef.current = false;

    // 重置失败任务为 pending
    setTasks(prev => prev.map(t => failedIds.has(t.id) ? { ...t, state: 'pending', progress: 0, error: null } : t));

    const queue = tasks.filter(t => failedIds.has(t.id));
    const running: Promise<void>[] = [];

    const runNext = async (): Promise<void> => {
      const task = queue.shift();
      if (!task) return;
      if (cancelledRef.current) return;
      await processTask(task);
      if (!cancelledRef.current) await runNext();
    };

    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      running.push(runNext());
    }
    await Promise.all(running);

    setIsProcessing(false);
    setBatchState('done');
  }, [tasks, concurrency, processTask]);

  /** 取消处理 */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setIsProcessing(false);
    setBatchState('ready');
  }, []);

  return {
    tasks,
    batchState,
    unifiedRegions,
    algorithm,
    concurrency,
    completedCount,
    failedCount,
    isProcessing,
    addFiles,
    removeTask,
    clearAll,
    setUnifiedRegions,
    setTaskRegions,
    clearTaskRegions,
    setAlgorithm,
    setConcurrency,
    getEffectiveRegions,
    processAll,
    retryFailed,
    cancel,
  };
}
