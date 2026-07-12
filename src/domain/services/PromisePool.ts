/**
 * PromisePool —— 通用并发执行池
 *
 * 用于批量执行可并发的异步任务（如 Pipeline 阶段 5 的多分镜视频生成）。
 * 控制最大并发度，避免一次性提交所有任务打爆平台 QPS 限制。
 *
 * V2 P0-2.2.1 + P0-2.2.2 + P1-2.2.6 修复：
 *   - 支持外部 AbortSignal：任一时刻可中止后续任务分派
 *   - 支持 signal 透传给 worker：worker 内部可主动响应取消
 *   - taskTimeoutMs 使用 AbortController 通知 worker 取消，且 worker 提前完成时 clearTimeout（避免 timer 泄漏）
 *   - failFast 模式设置内部 aborted 标志，Worker 循环入口检查后立即退出（原实现其他 worker 会继续消费 cursor）
 *
 * 设计：
 * - 顺序消费 + Worker 池模式：从队首取任务，立即分派给空闲 worker
 * - 失败隔离：单个任务失败不影响其他任务，结果以 { ok/error } 形式返回
 * - 进度回调：每完成一个任务触发 onProgress
 * - 顺序保证：返回结果数组顺序与输入顺序一致
 */

export interface PromisePoolResult<T> {
  /** 任务索引（对应输入数组下标） */
  index: number;
  /** 任务成功的结果（status='ok' 时有值） */
  value?: T;
  /** 任务失败的错误（status='error' 时有值） */
  error?: Error;
  /** 任务状态 */
  status: 'ok' | 'error' | 'aborted';
}

export interface PromisePoolOptions {
  /** 最大并发度，默认 3 */
  concurrency?: number;
  /** 单任务超时（ms），0 表示不限制，默认 0 */
  taskTimeoutMs?: number;
  /** 失败时是否中止后续任务（默认 false，所有任务都会执行） */
  failFast?: boolean;
  /**
   * V2 P0-2.2.2：外部取消信号。
   * signal.aborted 后：
   *   - 尚未分派的任务标记为 status='aborted' 直接完成
   *   - 已在执行的 worker 由 worker 内部检查 signal 决定是否响应
   */
  signal?: AbortSignal;
}

/** Worker 接收 signal，可用于向 fetch/DB 等透传取消 */
export type PoolWorker<T, R> = (item: T, index: number, signal?: AbortSignal) => Promise<R>;

/**
 * 并发执行多个异步任务
 */
export class PromisePool {
  static async run<T, R>(
    items: T[],
    worker: PoolWorker<T, R>,
    onProgress?: (done: number, total: number, currentIndex: number) => void,
    options?: PromisePoolOptions,
  ): Promise<PromisePoolResult<R>[]> {
    const concurrency = Math.max(1, options?.concurrency ?? 3);
    const taskTimeoutMs = options?.taskTimeoutMs ?? 0;
    const failFast = options?.failFast ?? false;
    const externalSignal = options?.signal;

    const total = items.length;
    const results: PromisePoolResult<R>[] = new Array(total);
    let cursor = 0;
    let done = 0;
    // 内部 abort 标志：failFast 触发或 externalSignal 触发时打开，Worker 循环入口检查
    let aborted = false;

    // 空输入快速返回
    if (total === 0) return [];

    // 若外部已 abort，直接标记全部为 aborted 返回
    if (externalSignal?.aborted) {
      for (let i = 0; i < total; i++) {
        results[i] = { index: i, status: 'aborted', error: new Error('Aborted before start') };
      }
      return results;
    }

    // 订阅外部信号 → 设置内部标志
    const onExternalAbort = (): void => {
      aborted = true;
    };
    externalSignal?.addEventListener('abort', onExternalAbort);

    // 包装单个任务：附加超时 + 错误隔离
    const runOne = async (index: number): Promise<void> => {
      const item = items[index];

      // V2 P0-2.2.1：taskTimeoutMs 用 AbortController 通知 worker，
      // 且 worker 完成后立即 clearTimeout，避免 timer 泄漏
      const timeoutController = new AbortController();
      // 合并外部 signal 与内部 timeout signal：任一 abort 都通知 worker
      const combinedSignal = mergeSignals(externalSignal, timeoutController.signal);
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;

      try {
        if (taskTimeoutMs > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            timeoutController.abort();
          }, taskTimeoutMs);
        }

        const value = await worker(item, index, combinedSignal);
        results[index] = { index, value, status: 'ok' };
      } catch (e) {
        if (timedOut) {
          const error = new Error(`task timeout after ${taskTimeoutMs}ms`);
          results[index] = { index, error, status: 'error' };
          if (failFast) throw error;
          return;
        }
        // 外部 abort → 标记 aborted
        if (externalSignal?.aborted) {
          results[index] = { index, status: 'aborted', error: e instanceof Error ? e : new Error('Aborted') };
          return;
        }
        const error = e instanceof Error ? e : new Error(String(e));
        results[index] = { index, error, status: 'error' };
        if (failFast) throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        done++;
        onProgress?.(done, total, index);
      }
    };

    // Worker 池：从队首不断取任务执行，直到任务耗尽或 aborted
    const runWorker = async (): Promise<void> => {
      while (true) {
        // V2 P1-2.2.6：aborted 时立即退出，不再消费 cursor
        if (aborted) return;
        const myIndex = cursor++;
        if (myIndex >= total) return;
        try {
          await runOne(myIndex);
        } catch (e) {
          if (failFast) {
            aborted = true;
            throw e;
          }
          // 非 failFast：runOne 内已保存到 results，此处不应有异常，为兜底 rethrow
          throw e;
        }
      }
    };

    // 启动 N 个 worker
    const workerCount = Math.min(concurrency, total);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(runWorker());
    }

    try {
      if (failFast) {
        // failFast 模式：任一任务抛错立即抛出，等待其他 worker 退出
        await Promise.all(workers);
      } else {
        // 默认模式：所有任务都执行完，无论失败与否
        await Promise.allSettled(workers);
      }
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }

    // 补齐未执行的槽位（aborted 提前退出时可能有 index 未被 runOne 覆盖）
    for (let i = 0; i < total; i++) {
      if (!results[i]) {
        results[i] = { index: i, status: 'aborted', error: new Error('Aborted before dispatch') };
      }
    }

    return results;
  }
}

/**
 * 合并多个 AbortSignal：任一 abort 时返回的 signal 也会 abort。
 * 用于把外部 signal 与内部 timeout signal 合成一个透传给 worker。
 */
function mergeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const validSignals = signals.filter((s): s is AbortSignal => s !== undefined);
  if (validSignals.length === 0) {
    // 返回一个永不 abort 的信号
    return new AbortController().signal;
  }
  if (validSignals.length === 1) {
    return validSignals[0];
  }
  const controller = new AbortController();
  for (const s of validSignals) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
