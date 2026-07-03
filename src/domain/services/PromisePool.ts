/**
 * PromisePool —— 通用并发执行池
 *
 * 用于批量执行可并发的异步任务（如 Pipeline 阶段 5 的多分镜视频生成）。
 * 控制最大并发度，避免一次性提交所有任务打爆平台 QPS 限制。
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
  status: 'ok' | 'error';
}

export interface PromisePoolOptions {
  /** 最大并发度，默认 3 */
  concurrency?: number;
  /** 单任务超时（ms），0 表示不限制，默认 0 */
  taskTimeoutMs?: number;
  /** 失败时是否中止后续任务（默认 false，所有任务都会执行） */
  failFast?: boolean;
}

/**
 * 并发执行多个异步任务
 *
 * @param items 输入任务数组
 * @param worker 任务执行函数，接收 (item, index)，返回 Promise<T>
 * @param onProgress 进度回调，参数为 (doneCount, total, currentIndex)
 * @returns 与输入数组同序的结果数组
 *
 * @example
 * ```ts
 * const segments = [...];
 * const results = await PromisePool.run(
 *   segments,
 *   (seg) => generateVideo(seg),
 *   (done, total, idx) => console.log(`done ${done}/${total}, last=${idx}`),
 *   { concurrency: 3 },
 * );
 * ```
 */
export class PromisePool {
  static async run<T, R>(
    items: T[],
    worker: (item: T, index: number) => Promise<R>,
    onProgress?: (done: number, total: number, currentIndex: number) => void,
    options?: PromisePoolOptions,
  ): Promise<PromisePoolResult<R>[]> {
    const concurrency = Math.max(1, options?.concurrency ?? 3);
    const taskTimeoutMs = options?.taskTimeoutMs ?? 0;
    const failFast = options?.failFast ?? false;

    const total = items.length;
    const results: PromisePoolResult<R>[] = new Array(total);
    let cursor = 0;
    let done = 0;

    // 空输入快速返回
    if (total === 0) return [];

    // 包装单个任务：附加超时 + 错误隔离
    const runOne = async (index: number): Promise<void> => {
      const item = items[index];
      try {
        let value: R;
        if (taskTimeoutMs > 0) {
          value = await Promise.race([
            worker(item, index),
            new Promise<R>((_, reject) =>
              setTimeout(() => reject(new Error(`task timeout after ${taskTimeoutMs}ms`)), taskTimeoutMs),
            ),
          ]);
        } else {
          value = await worker(item, index);
        }
        results[index] = { index, value, status: 'ok' };
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        results[index] = { index, error, status: 'error' };
        if (failFast) throw error;
      } finally {
        done++;
        onProgress?.(done, total, index);
      }
    };

    // Worker 池：从队首不断取任务执行，直到任务耗尽
    const runWorker = async (): Promise<void> => {
      while (true) {
        const myIndex = cursor++;
        if (myIndex >= total) return;
        await runOne(myIndex);
      }
    };

    // 启动 N 个 worker
    const workerCount = Math.min(concurrency, total);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(runWorker());
    }

    if (failFast) {
      // failFast 模式：任一任务抛错立即抛出，等待其他 worker 退出
      await Promise.all(workers);
    } else {
      // 默认模式：所有任务都执行完，无论失败与否
      await Promise.allSettled(workers);
    }

    return results;
  }
}
