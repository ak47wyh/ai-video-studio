import type {
  ITextGenerationPort,
  TextGenerationContext,
  TextGenerationResult,
  TextStreamCallbacks,
  TextContentBlock,
} from '../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../config/ApiConfigStore';
import { getMiniMaxErrorMessage } from './MiniMaxErrorUtils';
import axios from 'axios';

export class MiniMaxTextAdapter implements ITextGenerationPort {

  private readonly config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'MiniMaxTextAdapter', ...extra };
  }

  async chatCompletion(context: TextGenerationContext): Promise<TextGenerationResult> {
    const config = this.config;
    if (!config.minimaxApiKey) {
      this.logger?.warn('No API Key configured - returning mock result', this.ctx({}));
      return {
        content: '[Mock] 请配置 MiniMax API Key 以使用文本生成功能。',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    // Use Anthropic endpoint when explicitly requested or when systemBlocks with cache_control are provided
    const useAnthropic = context.useAnthropicEndpoint ||
      (context.systemBlocks && context.systemBlocks.some(b => b.cache_control));

    if (useAnthropic) {
      return this.chatCompletionAnthropic(context, config);
    }

    return this.chatCompletionOpenAI(context, config);
  }

  /**
   * 流式输出 — 使用 Anthropic SSE 端点
   * 返回 AbortController 用于取消请求
   */
  chatCompletionStream(context: TextGenerationContext, callbacks: TextStreamCallbacks): AbortController {
    const controller = new AbortController();

    const config = this.config;
    if (!config.minimaxApiKey) {
      callbacks.onError(new Error('API Key not configured'));
      return controller;
    }

    const baseUrl = (config.minimaxAnthropicBaseUrl || 'https://api.minimaxi.com/anthropic').replace(/\/+$/, '');
    const model = context.model || 'MiniMax-M3';

    // Build system blocks
    const systemBlocks = context.systemBlocks || [];
    if (systemBlocks.length === 0) {
      const systemMsg = context.messages.find(m => m.role === 'system');
      if (systemMsg) {
        const text = typeof systemMsg.content === 'string' ? systemMsg.content : '';
        systemBlocks.push({ type: 'text', text, cache_control: systemMsg.cache_control });
      }
    }

    // Build messages (exclude system role)
    const anthropicMessages = context.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const content = typeof m.content === 'string'
          ? [{ type: 'text' as const, text: m.content }]
          : m.content.map((b: TextContentBlock) => {
              if (b.type === 'text') return { type: 'text' as const, text: b.text };
              // image block
              return { type: 'image' as const, source: b.source };
            });
        return { role: m.role as 'user' | 'assistant', content };
      });

    const payload: Record<string, unknown> = {
      model,
      max_tokens: context.maxTokens ?? 4096,
      messages: anthropicMessages,
      stream: true,
    };

    if (systemBlocks.length > 0) payload.system = systemBlocks;
    if (context.temperature !== undefined) payload.temperature = context.temperature;
    if (context.topP !== undefined) payload.top_p = context.topP;
    if (context.thinking) payload.thinking = context.thinking;
    if (context.serviceTier) payload.service_tier = context.serviceTier;

    this.logger?.debug('Stream Anthropic', this.ctx({ model }));

    // SSE streaming
    const url = `${baseUrl}/v1/messages`;

    (async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': config.minimaxApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text();
          callbacks.onError(new Error(`HTTP ${response.status}: ${errText}`));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError(new Error('No response body'));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let fullThinking = '';
        let usageData: TextGenerationResult['usage'];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'event: ping') continue;

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              if (jsonStr === '[DONE]') continue;

              try {
                const event = JSON.parse(jsonStr);
                this.handleSSEEvent(event, callbacks, {
                  onContent: (text: string) => { fullContent += text; },
                  onThinking: (text: string) => { fullThinking += text; },
                  onUsage: (u: TextGenerationResult['usage']) => { usageData = u; },
                });
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }

        // Stream complete
        callbacks.onComplete({
          content: fullContent,
          thinking: fullThinking || undefined,
          usage: usageData,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    return controller;
  }

  /**
   * Handle a single SSE event from Anthropic streaming
   */
  private handleSSEEvent(
    event: Record<string, unknown>,
    callbacks: TextStreamCallbacks,
    accumulators: {
      onContent: (text: string) => void;
      onThinking: (text: string) => void;
      onUsage: (u: TextGenerationResult['usage']) => void;
    },
  ): void {
    const type = event.type as string;

    if (type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) return;

      const deltaType = delta.type as string;
      if (deltaType === 'text_delta') {
        const text = String(delta.text || '');
        callbacks.onTextDelta(text);
        accumulators.onContent(text);
      } else if (deltaType === 'thinking_delta') {
        const thinking = String(delta.thinking || '');
        callbacks.onThinkingDelta(thinking);
        accumulators.onThinking(thinking);
      }
    } else if (type === 'message_delta') {
      const usage = event.usage as Record<string, number> | undefined;
      if (usage) {
        accumulators.onUsage({
          promptTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
          completionTokens: usage.output_tokens || 0,
          cachedTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
        });
      }
    } else if (type === 'message_start') {
      const message = event.message as Record<string, unknown> | undefined;
      if (message?.usage) {
        const u = message.usage as Record<string, number>;
        accumulators.onUsage({
          promptTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
          completionTokens: u.output_tokens || 0,
          cachedTokens: u.cache_read_input_tokens,
          cacheCreationTokens: u.cache_creation_input_tokens,
        });
      }
    } else if (type === 'error') {
      const error = event.error as Record<string, unknown> | undefined;
      callbacks.onError(new Error(String(error?.message || 'Stream error')));
    }
  }

  /**
   * OpenAI-compatible endpoint: POST /v1/chat/completions
   */
  private async chatCompletionOpenAI(
    context: TextGenerationContext,
    config: ApiConfig
  ): Promise<TextGenerationResult> {
    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const model = context.model || 'MiniMax-M2.5';

    const payload: Record<string, unknown> = {
      model,
      messages: context.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map(b => b.type === 'text' ? b.text : '[image]').join(' '),
      })),
      max_tokens: context.maxTokens ?? 4096,
      temperature: context.temperature ?? 0.7,
    };

    if (context.topP !== undefined) payload.top_p = context.topP;
    if (context.serviceTier) payload.service_tier = context.serviceTier;

    if (context.tools && context.tools.length > 0) {
      payload.tools = context.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    payload.reasoning_split = true;

    this.logger?.debug('OpenAI endpoint', this.ctx({ model, messagesCount: context.messages.length }));

    const response = await axios.post(`${baseUrl}/chat/completions`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
      timeout: 60000,
    });

    return this.parseOpenAIResponse(response.data);
  }

  /**
   * Anthropic-compatible endpoint: POST /anthropic/v1/messages
   */
  private async chatCompletionAnthropic(
    context: TextGenerationContext,
    config: ApiConfig
  ): Promise<TextGenerationResult> {
    const baseUrl = (config.minimaxAnthropicBaseUrl || 'https://api.minimaxi.com/anthropic').replace(/\/+$/, '');
    const model = context.model || 'MiniMax-M2.5';

    // Build system blocks
    const systemBlocks = context.systemBlocks || [];
    if (systemBlocks.length === 0) {
      const systemMsg = context.messages.find(m => m.role === 'system');
      if (systemMsg) {
        const text = typeof systemMsg.content === 'string' ? systemMsg.content : '';
        systemBlocks.push({ type: 'text', text, cache_control: systemMsg.cache_control });
      }
    }

    // Build messages (exclude system role)
    const anthropicMessages = context.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const content = typeof m.content === 'string'
          ? [{ type: 'text' as const, text: m.content }]
          : m.content.map((b: TextContentBlock) => {
              if (b.type === 'text') return { type: 'text' as const, text: b.text };
              return { type: 'image' as const, source: b.source };
            });
        return { role: m.role as 'user' | 'assistant', content };
      });

    const payload: Record<string, unknown> = {
      model,
      max_tokens: context.maxTokens ?? 4096,
      messages: anthropicMessages,
    };

    if (systemBlocks.length > 0) payload.system = systemBlocks;
    if (context.temperature !== undefined) payload.temperature = context.temperature;
    if (context.topP !== undefined) payload.top_p = context.topP;
    if (context.thinking) payload.thinking = context.thinking;
    if (context.serviceTier) payload.service_tier = context.serviceTier;

    if (context.tools && context.tools.length > 0) {
      payload.tools = context.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    this.logger?.debug('Anthropic endpoint', this.ctx({ model, messagesCount: anthropicMessages.length }));

    const response = await axios.post(`${baseUrl}/v1/messages`, payload, {
      headers: {
        'x-api-key': config.minimaxApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    return this.parseAnthropicResponse(response.data);
  }

  /**
   * Parse OpenAI-compatible response format.
   */
  private parseOpenAIResponse(data: Record<string, unknown>): TextGenerationResult {
    const baseResp = data?.base_resp as Record<string, unknown> | undefined;
    const statusCode = baseResp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode as number | undefined, baseResp?.status_msg as string, 'MiniMax Text Generation error');
    if (error) throw new Error(error);

    const choice = (data?.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message || {}) as Record<string, unknown>;

    const content = String(message.content || '');

    let thinking: string | undefined;
    const reasoningDetails = message.reasoning_details;
    if (Array.isArray(reasoningDetails)) {
      thinking = reasoningDetails
        .map((r: Record<string, unknown>) => String(r.summary || r.thinking || r.text || ''))
        .filter(Boolean)
        .join('\n');
    }

    let toolCalls: TextGenerationResult['toolCalls'];
    const rawToolCalls = message.tool_calls;
    if (Array.isArray(rawToolCalls)) {
      toolCalls = rawToolCalls.map((tc: Record<string, unknown>) => {
        const fn = tc.function as Record<string, unknown> | undefined;
        return { id: String(tc.id || ''), name: String(fn?.name || ''), arguments: String(fn?.arguments || '') };
      });
    }

    const usage = data?.usage as Record<string, number> | undefined;
    const promptDetails = usage?.prompt_tokens_details as Record<string, number> | undefined;

    return {
      content,
      thinking,
      toolCalls,
      usage: usage ? {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        cachedTokens: promptDetails?.cached_tokens,
      } : undefined,
    };
  }

  /**
   * Parse Anthropic-compatible response format.
   */
  private parseAnthropicResponse(data: Record<string, unknown>): TextGenerationResult {
    const contentBlocks = data?.content as Array<Record<string, unknown>> | undefined;

    let content = '';
    let thinking: string | undefined;
    let toolCalls: TextGenerationResult['toolCalls'];

    if (Array.isArray(contentBlocks)) {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const tcList: NonNullable<TextGenerationResult['toolCalls']> = [];

      for (const block of contentBlocks) {
        const type = block.type as string;
        if (type === 'text') {
          textParts.push(String(block.text || ''));
        } else if (type === 'thinking') {
          thinkingParts.push(String(block.thinking || ''));
        } else if (type === 'tool_use') {
          tcList.push({
            id: String(block.id || ''),
            name: String(block.name || ''),
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
          });
        }
      }

      content = textParts.join('\n');
      if (thinkingParts.length > 0) thinking = thinkingParts.join('\n');
      if (tcList.length > 0) toolCalls = tcList;
    }

    const usage = data?.usage as Record<string, number> | undefined;

    return {
      content,
      thinking,
      toolCalls,
      usage: usage ? {
        promptTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
        completionTokens: usage.output_tokens || 0,
        cachedTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
      } : undefined,
    };
  }
}
