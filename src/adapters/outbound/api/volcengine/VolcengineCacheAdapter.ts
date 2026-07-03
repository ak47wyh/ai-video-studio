import type { IContextCachePort, ChatCompletionResult, ChatStreamChunk } from '../../../../domain/ports/VolcenginePorts';
import type { CacheCreateParams, CacheResult, CacheChatParams } from '../../../../domain/entities/models';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';
import type { VolcengineChatCompletionResponse } from './VolcengineTextAdapter';

export class VolcengineCacheAdapter implements IContextCachePort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new VolcengineHttpClient(config);
  }

  /** 上下文缓存依赖 OpenAI 兼容端点，Anthropic 协议不支持 */
  private ensureOpenAIProtocol(): void {
    if (this.config.volcArkProtocol === 'anthropic') {
      throw new Error('Anthropic 协议（Agent Plan）不支持上下文缓存，请切换至 OpenAI 协议（标准后付费模式）');
    }
  }

  async createCache(params: CacheCreateParams): Promise<CacheResult> {
    this.ensureOpenAIProtocol();

    console.log('[VolcengineCacheAdapter] createCache 入参', {
      model: params.model,
      messagesCount: params.messages?.length ?? 0,
      ttl: params.ttl,
    });

    const result = await withRetry(() =>
      this.http.post<{ id: string }>('/context/caches', {
        model: params.model,
        messages: params.messages,
        ...(params.ttl && { ttl: params.ttl }),
      }),
    );

    console.log('[VolcengineCacheAdapter] createCache 出参', {
      cacheId: result.id,
    });

    return {
      cacheId: result.id,
      model: params.model,
      createdAt: Date.now(),
      expiresAt: Date.now() + (params.ttl ?? 604800) * 1000,
    };
  }

  async chatWithCache(params: CacheChatParams): Promise<ChatCompletionResult> {
    this.ensureOpenAIProtocol();

    console.log('[VolcengineCacheAdapter] chatWithCache 入参', {
      model: params.model,
      cacheId: params.cacheId,
      messagesCount: params.messages?.length ?? 0,
    });

    const result = await withRetry(() =>
      this.http.post<VolcengineChatCompletionResponse>('/chat/completions', {
        model: params.model,
        messages: params.messages,
        context_id: params.cacheId,
      }),
    );

    console.log('[VolcengineCacheAdapter] chatWithCache 出参', {
      contentLength: result.choices?.[0]?.message?.content?.length ?? 0,
      usage: result.usage,
    });

    return {
      content: result.choices?.[0]?.message?.content ?? '',
      usage: result.usage ? {
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
      } : undefined,
      finishReason: result.choices?.[0]?.finish_reason,
    };
  }

  async *chatWithCacheStream(params: CacheChatParams): AsyncIterable<ChatStreamChunk> {
    const payload = {
      model: params.model,
      messages: params.messages,
      context_id: params.cacheId,
      stream: true,
    };
    for await (const chunk of this.http.stream<VolcengineChatCompletionResponse>('/chat/completions', payload)) {
      yield {
        delta: chunk.choices?.[0]?.delta?.content ?? '',
        finishReason: chunk.choices?.[0]?.finish_reason,
      };
    }
  }
}