import type {
  ThreeDSubmitParams, ThreeDTaskResult, ThreeDTaskStatus, ThreeDTaskListResult,
  CacheCreateParams, CacheResult, CacheChatParams,
  ResponseCreateParams, ResponseResult, ResponseStreamChunk, ResponseContextResult,
  TaskListFilter,
} from '../entities/models';

// ==========================================
// 3D 生成端口
// ==========================================

/**
 * 3D 模型生成端口。
 * 异步任务模式：submitTask → 轮询 queryTask → 获取结果。
 * 实现者：Volcengine3DAdapter（含 Seed3D / 影眸 / 数美三个子提供商）。
 */
export interface IThreeDGenerationPort {
  /** 提交 3D 生成任务，返回任务 ID */
  submitTask(params: ThreeDSubmitParams): Promise<ThreeDTaskResult>;

  /** 查询单个任务状态 */
  queryTask(taskId: string): Promise<ThreeDTaskStatus>;

  /** 查询任务列表（可选，部分平台可能不支持） */
  queryTaskList?(filters?: TaskListFilter): Promise<ThreeDTaskListResult>;

  /** 取消或删除任务（可选） */
  cancelTask?(taskId: string): Promise<void>;
}

// ==========================================
// 上下文缓存端口
// ==========================================

/**
 * 上下文缓存端口。
 * 火山引擎独有能力：缓存重复前缀内容以降低 Token 成本。
 */
export interface IContextCachePort {
  /** 创建上下文缓存，返回缓存 ID */
  createCache(params: CacheCreateParams): Promise<CacheResult>;

  /** 使用缓存进行对话（同步） */
  chatWithCache(params: CacheChatParams): Promise<ChatCompletionResult>;

  /** 使用缓存进行对话（流式） */
  chatWithCacheStream(params: CacheChatParams): AsyncIterable<ChatStreamChunk>;
}

// ==========================================
// 模型响应端口
// ==========================================

/**
 * 模型响应端口（Responses API）。
 * OpenAI 兼容的 Responses API，支持多轮上下文、缓存、深度推理。
 */
export interface IModelResponsePort {
  /** 创建模型响应（同步） */
  createResponse(params: ResponseCreateParams): Promise<ResponseResult>;

  /** 创建模型响应（流式） */
  createResponseStream(params: ResponseCreateParams): AsyncIterable<ResponseStreamChunk>;

  /** 查询已创建的响应 */
  getResponse(responseId: string): Promise<ResponseResult>;

  /** 获取响应上下文 */
  getResponseContext(responseId: string): Promise<ResponseContextResult>;

  /** 删除响应并清除缓存 */
  deleteResponse(responseId: string): Promise<void>;
}

// ==========================================
// 缓存对话复用类型
// ==========================================

/**
 * 缓存对话结果类型。
 * 注意：OutboundPorts 中已有 TextGenerationResult（用于 ITextGenerationPort），
 * 此处为 IContextCachePort 专用，字段命名与 TextGenerationResult.usage 保持一致
 * （promptTokens / completionTokens），避免引入额外转换层。
 */
export interface ChatCompletionResult {
  content: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface ChatStreamChunk {
  delta: string;
  finishReason?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}