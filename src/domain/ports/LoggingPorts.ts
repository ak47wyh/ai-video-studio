/**
 * LoggingPorts —— 日志"汇（Sink）"抽象
 *
 * 与 CrossCuttingPorts 中的 ILoggerPort 配合：
 * - ILoggerPort：业务侧入口（logger.info/error/...）
 * - ILogSinkPort：基础设施侧目的地（控制台 / 内存 RingBuffer / 远程上报）
 *
 * 解耦原则：
 * - UI 组件只依赖 ILogSinkPort，不直接依赖具体适配器
 * - 后续接入 Sentry / LogRocket 仅需新增适配器，零业务改动
 */

import type { LogContext, LogLevel } from './CrossCuttingPorts';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * 日志汇端口：作为 ILoggerPort 的下游目的地。
 *
 * 默认实现：RingBufferLogSinkAdapter（内存循环缓冲）。
 * 可选实现：IndexedDbLogSinkAdapter（持久化，暂未实现）。
 */
export interface ILogSinkPort {
  /** 写入一条日志 */
  write(entry: LogEntry): void;
  /** 订阅新条目；返回 unsubscribe */
  subscribe(listener: (entry: LogEntry) => void): () => void;
  /** 返回最近 N 条（默认全部），用于初始化 UI */
  snapshot(limit?: number): LogEntry[];
  /** 清空缓冲 */
  clear(): void;
  /** 当前缓冲条数 */
  size(): number;
}

