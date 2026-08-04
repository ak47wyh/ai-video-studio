import type {
  ITextGenerationPort, TextGenerationContext, TextGenerationResult,
  TextStreamCallbacks, TextContentBlock, TextGenerationMessage,
} from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry, isCorsError, classifyNetworkError } from './VolcengineErrorUtils';

/**
 * 火山引擎文本生成适配器。
 *
 * 双协议支持：
 *  - openai:     POST /chat/completions  （OpenAI 兼容格式，标准后付费模式）
 *  - anthropic:  POST /v1/messages       （Anthropic Messages 格式，Agent Plan 订阅）
 *
 * 协议类型由 config.volcArkTextProtocol 决定，构造时由 HttpClient 统一处理鉴权与 Base URL。
 */
export class VolcengineTextAdapter implements ITextGenerationPort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    // Text 按"偏好协议"选择（volcArkTextProtocol）
    this.http = new VolcengineHttpClient(config, config.volcArkTextProtocol, undefined, logger);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'VolcengineTextAdapter', ...extra };
  }

  async chatCompletion(context: TextGenerationContext): Promise<TextGenerationResult> {
    this.logger?.debug('chatCompletion 入参', this.ctx({
      protocol: this.config.volcArkTextProtocol,
      model: context.model,
      messagesCount: context.messages.length,
      maxTokens: context.maxTokens,
      temperature: context.temperature,
    }));

    const result = this.http.isAnthropic
      ? await this.chatCompletionAnthropic(context)
      : await this.chatCompletionOpenAI(context);

    this.logger?.debug('chatCompletion 出参', this.ctx({
      protocol: this.config.volcArkTextProtocol,
      contentLength: result.content.length,
      usage: result.usage,
    }));

    return result;
  }

  chatCompletionStream(context: TextGenerationContext, callbacks: TextStreamCallbacks): AbortController {
    const abortController = new AbortController();
    if (this.http.isAnthropic) {
      this.runStreamAnthropic(context, callbacks, abortController);
    } else {
      this.runStreamOpenAI(context, callbacks, abortController);
    }
    return abortController;
  }

  // ==================== OpenAI 协议分支 ====================

  private async chatCompletionOpenAI(context: TextGenerationContext): Promise<TextGenerationResult> {
    const payload = this.buildOpenAIPayload(context);
    const result = await withRetry(() =>
      this.http.post<VolcengineChatCompletionResponse>('/chat/completions', payload),
    );
    return {
      content: result.choices?.[0]?.message?.content ?? '',
      usage: result.usage ? {
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        cachedTokens: result.usage.prompt_tokens_details?.cached_tokens,
      } : undefined,
    };
  }

  private async runStreamOpenAI(
    context: TextGenerationContext,
    callbacks: TextStreamCallbacks,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const payload = { ...this.buildOpenAIPayload(context), stream: true };
      const url = `${this.http.getBaseUrl()}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.http.getAuthHeaders(),
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') {
              callbacks.onComplete({ content: '' });
              return;
            }
            try {
              const chunk = JSON.parse(payload) as VolcengineChatCompletionResponse;
              const delta = chunk.choices?.[0]?.delta?.content ?? '';
              if (delta) callbacks.onTextDelta(delta);
            } catch { /* skip */ }
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private buildOpenAIPayload(context: TextGenerationContext): Record<string, unknown> {
    return {
      model: context.model ?? 'doubao-pro-32k',
      messages: context.messages.map((m: TextGenerationMessage) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map((b: TextContentBlock) => b.type === 'text' ? b.text : '').join(''),
      })),
      ...(context.temperature !== undefined && { temperature: context.temperature }),
      ...(context.maxTokens && { max_tokens: context.maxTokens }),
      ...(context.topP !== undefined && { top_p: context.topP }),
      ...(context.tools && { tools: context.tools.map((t: { name: string; description: string; parameters: Record<string, unknown> }) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })) }),
    };
  }

  // ==================== Anthropic 协议分支（Agent Plan） ====================

  private async chatCompletionAnthropic(context: TextGenerationContext): Promise<TextGenerationResult> {
    const payload = this.buildAnthropicPayload(context);
    try {
      const result = await withRetry(() =>
        this.http.post<AnthropicMessagesResponse>('/v1/messages', payload),
      );

      // Anthropic 响应：content[] 数组，每项含 type + text
      const content = (result.content ?? [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      return {
        content,
        usage: result.usage ? {
          promptTokens: result.usage.input_tokens,
          completionTokens: result.usage.output_tokens,
        } : undefined,
      };
    } catch (error) {
      // CORS 拦截降级：Anthropic 端点预检失败时，尝试切换到 OpenAI 协议
      if (isCorsError(error) && this.canFallbackToOpenAI()) {
        this.logger?.warn('Anthropic CORS 拦截，降级到 OpenAI 协议', this.ctx({}));
        return this.chatCompletionOpenAI(context);
      }
      throw classifyNetworkError(error);
    }
  }

  /**
   * 判断是否允许从 Anthropic 协议降级到 OpenAI 协议。
   *
   * 条件：
   *  - 用户在设置页开启了 volcArkAutoFallback（默认 true）
   *  - OpenAI 协议 Base URL 非空（默认配置即满足）
   *  - OpenAI API Key 非空（双协议并存：降级需 OpenAI Key 独立配置）
   */
  private canFallbackToOpenAI(): boolean {
    return this.config.volcArkAutoFallback
      && !!this.config.volcArkBaseUrl.trim()
      && !!this.config.volcArkOpenAiApiKey.trim();
  }

  private async runStreamAnthropic(
    context: TextGenerationContext,
    callbacks: TextStreamCallbacks,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const payload = { ...this.buildAnthropicPayload(context), stream: true };
      const url = `${this.http.getBaseUrl()}/v1/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.http.getAuthHeaders(),
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') {
              callbacks.onComplete({ content: '' });
              return;
            }
            try {
              const event = JSON.parse(payload) as AnthropicStreamEvent;
              // Anthropic 流式事件类型：
              //  - content_block_delta: 增量文本
              //  - message_stop: 结束
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const delta = event.delta.text ?? '';
                if (delta) callbacks.onTextDelta(delta);
              } else if (event.type === 'message_stop') {
                callbacks.onComplete({ content: '' });
                return;
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // CORS 拦截降级：Anthropic 端点预检失败时，切换到 OpenAI 流式
      if (isCorsError(error) && this.canFallbackToOpenAI()) {
        this.logger?.warn('Anthropic 流式 CORS 拦截，降级到 OpenAI 流式', this.ctx({}));
        this.runStreamOpenAI(context, callbacks, abortController);
        return;
      }
      callbacks.onError(classifyNetworkError(error));
    }
  }

  /**
   * 构建 Anthropic Messages API 请求体。
   *
   * 格式规范：
   *  - system 消息提取为顶层 system 字段
   *  - 非 system 消息转换为 content blocks 数组
   *  - max_tokens 必填（Anthropic 要求）
   */
  private buildAnthropicPayload(context: TextGenerationContext): Record<string, unknown> {
    const model = context.model ?? this.config.volcArkAnthropicModel ?? 'doubao-seed-2.0-pro';
    const maxTokens = context.maxTokens ?? 4096;

    // 分离 system 消息与对话消息
    const systemMessages: string[] = [];
    const dialogMessages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];

    for (const m of context.messages) {
      const text = typeof m.content === 'string'
        ? m.content
        : m.content.map((b: TextContentBlock) => b.type === 'text' ? b.text : '').join('');

      if (m.role === 'system') {
        systemMessages.push(text);
      } else {
        dialogMessages.push({
          role: m.role,
          content: [{ type: 'text', text }],
        });
      }
    }

    return {
      model,
      max_tokens: maxTokens,
      ...(systemMessages.length > 0 && { system: systemMessages.join('\n\n') }),
      messages: dialogMessages,
      ...(context.temperature !== undefined && { temperature: context.temperature }),
      ...(context.topP !== undefined && { top_p: context.topP }),
    };
  }
}

/** 火山引擎 Chat Completion API 响应结构（OpenAI 兼容，适配器内部类型，跨适配器复用） */
export interface VolcengineChatCompletionResponse {
  choices?: Array<{
    message?: { content: string };
    delta?: { content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens: number };
  };
}

/** Anthropic Messages API 同步响应结构 */
interface AnthropicMessagesResponse {
  id?: string;
  type?: 'message';
  role?: 'assistant';
  content?: Array<{
    type: 'text';
    text: string;
  }>;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** Anthropic Messages API 流式事件 */
interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  delta?: {
    type?: 'text_delta';
    text?: string;
  };
}
