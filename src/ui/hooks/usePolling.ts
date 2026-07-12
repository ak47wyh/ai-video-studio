/**
 * usePolling — 通用 Polling Hook
 *
 * V2 P0-2.1.1 + P0-2.1.2 修复：
 *   1. 用 ref 计数器代替 state 计数（原实现 setAttempts 异步生效，
 *      同一 tick 多次触发时 currentAttempt 计算错误，maxAttempts 完全失效）
 *   2. 改用递归 setTimeout 自调度（原 setInterval + async 会重入，
 *      fetcher 耗时 > intervalMs 时多个 tick 并发，请求覆盖）
 *   3. shouldStop/onError/fetcher 用 ref 保存，避免依赖数组抖动导致 effect 频繁重启
 *      同时闭包内始终读取最新回调
 *
 * 自动管理 setTimeout 生命周期，组件卸载即时终止调度。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePollingOptions {
  /** 是否启用 polling */
  enabled?: boolean;
  /** 轮询间隔（ms） */
  intervalMs?: number;
  /** 最多轮询次数（达到后自动停止） */
  maxAttempts?: number;
  /** 满足条件时停止的判断函数 */
  shouldStop?: (result: unknown) => boolean;
  /** 错误回调 */
  onError?: (err: unknown) => void;
}

export interface UsePollingResult<T> {
  data: T | null;
  error: unknown | null;
  attempts: number;
  isRunning: boolean;
  stop: () => void;
  restart: () => void;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options: UsePollingOptions = {}
): UsePollingResult<T> {
  const {
    enabled = true,
    intervalMs = 5000,
    maxAttempts = 120,
    shouldStop,
    onError,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  // 计数器 ref：与 state 解耦，避免 setState 异步生效导致 maxAttempts 失效
  const attemptsRef = useRef(0);
  // 停止标志
  const stoppedRef = useRef(false);
  // 递归 setTimeout 句柄（P0-2.1.2 改用自调度模式）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 回调 ref：避免 fetcher/shouldStop/onError 引用变化触发 effect 重启（P1-2.1.11）
  const fetcherRef = useRef(fetcher);
  const shouldStopRef = useRef(shouldStop);
  const onErrorRef = useRef(onError);
  // 在 effect 中同步最新回调到 ref，保持 ref 与 props 一致（避开渲染期写 ref 的 lint 规则）
  useEffect(() => {
    fetcherRef.current = fetcher;
    shouldStopRef.current = shouldStop;
    onErrorRef.current = onError;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearTimer();
    setIsRunning(false);
  }, [clearTimer]);

  const restart = useCallback(() => {
    stop();
    stoppedRef.current = false;
    attemptsRef.current = 0;
    setAttempts(0);
    setData(null);
    setError(null);
  }, [stop]);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stop();
      return;
    }

    stoppedRef.current = false;
    attemptsRef.current = 0;
    setIsRunning(true);

    // 自调度递归：前一次完成后再 setTimeout 下一次，避免 setInterval 重入
    const tick = async (): Promise<void> => {
      if (stoppedRef.current) return;
      const currentAttempt = ++attemptsRef.current; // ref 原子递增，无 state 时序问题
      try {
        const result = await fetcherRef.current();
        if (stoppedRef.current) return;
        setData(result);
        setError(null);
        setAttempts(currentAttempt);

        if (shouldStopRef.current?.(result) || currentAttempt >= maxAttempts) {
          stop();
          return;
        }
      } catch (e) {
        if (stoppedRef.current) return;
        setError(e);
        onErrorRef.current?.(e);
        setAttempts(currentAttempt);
        if (currentAttempt >= maxAttempts) {
          stop();
          return;
        }
      }
      // 只有当次 tick 完成后才调度下一次，天然消除重入
      if (!stoppedRef.current) {
        timerRef.current = setTimeout(() => void tick(), intervalMs);
      }
    };

    // 立即执行首次
    void tick();

    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, maxAttempts, ...deps]);

  return { data, error, attempts, isRunning, stop, restart };
}
