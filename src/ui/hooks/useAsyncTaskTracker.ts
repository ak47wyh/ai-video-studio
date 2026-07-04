/**
 * useAsyncTaskTracker —— 统一异步任务追踪 Hook
 *
 * P1-1：消除 VideoLab / VoiceLab 长文本 / StoryWorkbench 三套并行轮询实现。
 *
 * 设计目标：
 *   1. 任务持久化到 sessionStorage，刷新页面后自动恢复进行中任务的轮询
 *   2. 统一 API：addTask / updateTask / removeTask / startPolling / stopPolling / resumeAll
 *   3. 组件卸载时自动清理所有轮询定时器
 *   4. 支持 5 分钟超时自动标记失败
 *
 * 用法：
 * ```ts
 * const tracker = useAsyncTaskTracker<MyTask>({
 *   storageKey: 'videoLabTasks',
 *   pollIntervalMs: 3000,
 *   timeoutMs: 300000,
 *   pollFn: async (task) => {
 *     const status = await api.getTaskStatus(task.id);
 *     return { status: status.state, result: status.url };
 *   },
 * });
 * ```
 *
 * 注意：sessionStorage 选择而非 IndexedDB，因为 Lab 任务是"会话级"临时数据，
 * 用户关闭标签页即清理，避免长期堆积。需要跨会话保留的任务应走 videoTasks 表。
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface AsyncTaskBase {
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'timeout';
  createdAt: number;
  errorMessage?: string;
}

export interface AsyncTaskTrackerOptions<T extends AsyncTaskBase> {
  /** sessionStorage 存储 key，不同 Lab 用不同 key 避免冲突 */
  storageKey: string;
  /** 轮询间隔 ms，默认 3000 */
  pollIntervalMs?: number;
  /** 单任务超时 ms，默认 300000（5 分钟） */
  timeoutMs?: number;
  /** 轮询函数：接收当前任务，返回部分更新字段（如 status/result） */
  pollFn: (task: T) => Promise<Partial<T>>;
  /** 任务完成（success/failed）时的回调 */
  onComplete?: (task: T) => void;
}

export interface AsyncTaskTrackerResult<T extends AsyncTaskBase> {
  tasks: T[];
  addTask: (task: T) => void;
  updateTask: (id: string, patch: Partial<T>) => void;
  removeTask: (id: string) => void;
  startPolling: (id: string) => void;
  stopPolling: (id: string) => void;
  /** 刷新后调用：恢复所有 processing 状态任务的轮询 */
  resumeAll: () => void;
  clearAll: () => void;
}

export function useAsyncTaskTracker<T extends AsyncTaskBase>(
  options: AsyncTaskTrackerOptions<T>
): AsyncTaskTrackerResult<T> {
  const { storageKey, pollFn, onComplete } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 300000;

  const [tasks, setTasks] = useState<T[]>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  });

  // tasks 的 ref，供轮询闭包内读取最新值（必须先于 startPolling 声明）
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const pollFnRef = useRef(pollFn);
  const onCompleteRef = useRef(onComplete);
  pollFnRef.current = pollFn;
  onCompleteRef.current = onComplete;

  // 持久化到 sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(tasks));
    } catch {
      // sessionStorage 满或不可用，静默降级
    }
  }, [tasks, storageKey]);

  // 组件卸载时清理所有轮询
  useEffect(() => {
    return () => {
      pollingRef.current.forEach(handle => clearInterval(handle));
      pollingRef.current.clear();
    };
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<T>) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    const handle = pollingRef.current.get(id);
    if (handle) {
      clearInterval(handle);
      pollingRef.current.delete(id);
    }
  }, []);

  const addTask = useCallback((task: T) => {
    setTasks(prev => [...prev, task]);
  }, []);

  const stopPolling = useCallback((id: string) => {
    const handle = pollingRef.current.get(id);
    if (handle) {
      clearInterval(handle);
      pollingRef.current.delete(id);
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    // 避免重复轮询
    if (pollingRef.current.has(id)) return;

    const handle = setInterval(async () => {
      try {
        const current = tasksRef.current.find(t => t.id === id);
        if (!current) {
          stopPolling(id);
          return;
        }

        // 超时检测
        if (Date.now() - current.createdAt > timeoutMs) {
          updateTask(id, { status: 'timeout', errorMessage: '任务超时' } as Partial<T>);
          stopPolling(id);
          onCompleteRef.current?.({ ...current, status: 'timeout' });
          return;
        }

        const patch = await pollFnRef.current(current);
        updateTask(id, patch);

        // 终态检测：成功或失败都停止轮询
        if (patch.status === 'success' || patch.status === 'failed') {
          stopPolling(id);
          const updated = { ...current, ...patch };
          onCompleteRef.current?.(updated);
        }
      } catch {
        // 单次轮询失败不终止，下次重试
      }
    }, pollIntervalMs);

    pollingRef.current.set(id, handle);
  }, [pollIntervalMs, timeoutMs, updateTask, stopPolling]);

  const resumeAll = useCallback(() => {
    tasksRef.current.forEach(t => {
      if (t.status === 'processing' || t.status === 'pending') {
        startPolling(t.id);
      }
    });
  }, [startPolling]);

  const clearAll = useCallback(() => {
    pollingRef.current.forEach(handle => clearInterval(handle));
    pollingRef.current.clear();
    setTasks([]);
  }, []);

  return {
    tasks,
    addTask,
    updateTask,
    removeTask,
    startPolling,
    stopPolling,
    resumeAll,
    clearAll,
  };
}
