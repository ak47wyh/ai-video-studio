/**
 * CrossCuttingPorts —— 横切关注点 Port 抽象
 *
 * 把日志、事件总线、指标、韧性、通知、确认等"基础设施级"能力
 * 从 Service 中解耦出来，使 Service 可独立测试、可替换后端。
 *
 * 与具体技术无关：
 * - ILoggerPort → Console / Sentry / Datadog 任选
 * - IEventBus → 内存 / BroadcastChannel / WebSocket 任选
 * - IResiliencePort → 简单 retry / resilience4j 任选
 */

// ==========================================
// 日志
// ==========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  service?: string;
  method?: string;
  platform?: string;
  taskId?: string;
  spaceId?: string;
  userId?: string;
  [key: string]: unknown;
}

/**
 * 结构化日志端口。
 * 默认实现：ConsoleLoggerAdapter。
 * 后续可替换：SentryLoggerAdapter / RemoteLoggerAdapter。
 *
 * 安全约束：实现方不得在日志中输出完整 API Key / Token。
 */
export interface ILoggerPort {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  /** 创建一个带预设上下文的子 logger（链式） */
  child(context: LogContext): ILoggerPort;
}

// ==========================================
// 领域事件总线
// ==========================================

export type DomainEvent =
  | { type: 'video.task.submitted'; taskId: string; spaceId: string; platform: string }
  | { type: 'video.task.completed'; taskId: string; videoUrl: string }
  | { type: 'video.task.failed'; taskId: string; error: string }
  | { type: 'voice.cloned'; voiceId: string }
  | { type: 'platform.changed'; from: string; to: string }
  | { type: 'space.snapshot.created'; snapshotId: string; spaceId: string }
  | { type: 'space.deleted'; spaceId: string }
  | { type: 'asset.saved'; kind: 'image' | 'voice' | 'prompt'; id: string };

export type EventListener<T extends DomainEvent['type']> = (
  payload: Extract<DomainEvent, { type: T }>
) => void;

/**
 * 领域事件总线端口。
 *
 * 用途：解耦 Service 间强依赖。
 * 例：PipelineService 提交视频后 emit('video.task.submitted')，
 *     VideoTaskPoller 订阅 'video.task.completed' 后推进状态。
 *
 * 约束：
 * - emit 不阻塞（同步触发所有 handler）
 * - handler 抛错时记录日志但不中断后续 handler
 * - on 返回的函数调用后取消订阅
 */
export interface IEventBus {
  emit<T extends DomainEvent['type']>(
    type: T,
    payload: Extract<DomainEvent, { type: T }>
  ): void;
  on<T extends DomainEvent['type']>(
    type: T,
    handler: EventListener<T>
  ): () => void;
  /** 订阅所有事件（调试 / 监控用） */
  onAny(handler: (event: DomainEvent) => void): () => void;
}

// ==========================================
// 指标
// ==========================================

export interface Counter {
  inc(delta?: number, tags?: Record<string, string>): void;
}

export interface Histogram {
  observe(value: number, tags?: Record<string, string>): void;
}

/**
 * 指标端口。
 * 默认实现：NoopMetricsAdapter。
 * 后续可接入：Prometheus 推送 / 自研埋点。
 */
export interface IMetricsPort {
  counter(name: string, tags?: Record<string, string>): Counter;
  histogram(name: string, tags?: Record<string, string>): Histogram;
}

// ==========================================
// 韧性（限流 / 重试 / 熔断）
// ==========================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  backoff?: 'linear' | 'exponential';
  retryOn?: (err: unknown) => boolean;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

/**
 * 韧性操作端口。
 * 取代 utils/retryUtils.ts 中的散装函数。
 * 后续可在 Service 层统一加 retry/circuit-breaker。
 */
export interface IResiliencePort {
  retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
  withCircuitBreaker<T>(key: string, fn: () => Promise<T>, options: CircuitBreakerOptions): Promise<T>;
}

// ==========================================
// 通知 / 确认（Service → UI 副作用）
// ==========================================

export type ToastVariant = 'success' | 'info' | 'warn' | 'error';

export interface ToastInput {
  variant: ToastVariant;
  message: string;
  durationMs?: number;
}

export interface ConfirmInput {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

/**
 * 通知端口：让 Service 层主动弹 Toast 而不耦合 React。
 * 默认实现：ReactNotificationAdapter（包装 ToastContext）。
 */
export interface INotificationPort {
  toast(input: ToastInput): string;
  dismiss(toastId: string): void;
}

/**
 * 确认对话框端口：让 Service 层发起"是否继续"询问。
 * 默认实现：ReactConfirmAdapter（包装 ConfirmContext）。
 */
export interface IConfirmPort {
  ask(input: ConfirmInput): Promise<boolean>;
}

// ==========================================
// HTTP 抓取（下载素材/资源）
// ==========================================

/**
 * HTTP 请求可选项。
 * 领域层不感知具体实现（fetch / XHR / axios），只描述通用能力。
 */
export interface HttpFetchOptions {
  /** 请求头 */
  headers?: Record<string, string>;
  /** 超时时间（毫秒），默认 30_000 */
  timeoutMs?: number;
  /** 取消信号（外部 AbortController） */
  signal?: AbortSignal;
  /** 是否忽略 HTTP 错误状态码（默认 false，>=400 抛错） */
  ignoreStatus?: boolean;
}

/**
 * HTTP 抓取端口。
 *
 * 用于领域层下载素材（视频/音频/图片）到本地存储，
 * 取代 Service 层直接使用 `fetch()` 造成的架构边界违规
 * （详见 System_Architecture_Refactor_Design.md §B-02）。
 *
 * 实现方约束：
 *  - HTTP >= 400 且未设置 `ignoreStatus` 时应归一化为 NetworkError
 *  - 网络异常（DNS/CORS/TypeError）应归一化为 NetworkError
 *  - 超时应归一化为 TimeoutError
 *
 * 默认实现：BrowserFetchAdapter（基于 fetch + AbortController）
 */
export interface IHttpFetchPort {
  /** 下载 Blob（视频/音频/图片二进制） */
  fetchBlob(url: string, options?: HttpFetchOptions): Promise<Blob>;
  /** 下载文本（SVG / TXT / M3U8） */
  fetchText(url: string, options?: HttpFetchOptions): Promise<string>;
  /** 下载并 JSON 解析（外部 REST 接口） */
  fetchJson<T = unknown>(url: string, options?: HttpFetchOptions): Promise<T>;
}

// ==========================================
// 成本计量（M3.4 成本可视化）
// ==========================================

import type { TokenUsageInfo } from '../entities/models';

/**
 * 单条成本记录。
 * 每次 AI 调用（文本/图片/视频/语音/音乐）产生一条记录。
 */
export interface CostRecord {
  /** 唯一 ID */
  id: string;
  /** 平台 ID（minimax / volcengine / ...） */
  platform: string;
  /** 模型 ID */
  model: string;
  /** 调用类型（text / image / video / voice / music / agent_chat / bgm_recommendation / cinematography / subtitle_align / subtitle_translate） */
  callType: 'text' | 'image' | 'video' | 'voice' | 'music' | 'agent_chat' | 'bgm_recommendation' | 'cinematography' | 'subtitle_align' | 'subtitle_translate';
  /** Token 用量（仅 text 类型有值） */
  usage?: TokenUsageInfo;
  /** 调用时间戳 */
  timestamp: number;
  /** 关联的空间 ID（可选，用于按空间统计） */
  spaceId?: string;
  /** 关联的故事 ID（可选，用于按故事统计） */
  storyId?: string;
  /** 关联的 Pipeline 任务 ID（可选，用于按任务统计） */
  pipelineTaskId?: string;
}

/**
 * 成本汇总。
 */
export interface CostSummary {
  /** 总调用次数 */
  totalCalls: number;
  /** 总 Token 数（仅文本调用） */
  totalTokens: number;
  /** 输入 Token 数 */
  totalInputTokens: number;
  /** 输出 Token 数 */
  totalOutputTokens: number;
  /** 按平台分组统计 */
  byPlatform: Record<string, { calls: number; tokens: number }>;
  /** 按模型分组统计 */
  byModel: Record<string, { calls: number; tokens: number }>;
  /** 按调用类型分组统计 */
  byCallType: Record<string, { calls: number; tokens: number }>;
  /** 时间范围（首末调用时间戳） */
  period: { start: number; end: number };
}

/**
 * 成本计量端口。
 *
 * 用于聚合所有 AI 调用的 Token 用量，提供成本可视化（EVOLUTION_DESIGN.md §7.4）：
 *   - Pipeline 启动前预估总成本
 *   - Pipeline 运行中实时累计
 *   - Dashboard 成本看板
 *
 * 默认实现：InMemoryCostMeter（内存，重启清空）。
 * 未来可扩展：DexieCostMeter（持久化到 IndexedDB）。
 */
export interface ICostMeter {
  /** 记录一次 AI 调用的 Token 用量 */
  record(record: Omit<CostRecord, 'id' | 'timestamp'>): void;
  /** 获取汇总（可选按空间/故事/任务过滤） */
  getSummary(filter?: { spaceId?: string; storyId?: string; pipelineTaskId?: string }): CostSummary;
  /** 获取原始记录列表（分页） */
  getRecords(filter?: { spaceId?: string; storyId?: string; pipelineTaskId?: string }, limit?: number): CostRecord[];
  /** 清空记录 */
  clear(): void;
}
