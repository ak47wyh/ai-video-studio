import type {
  ITextGenerationPort,
  TextGenerationContext,
  TextGenerationResult,
  TextStreamCallbacks,
  TextContentBlock,
  TextGenerationMessage,
} from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { ZhipuHttpClient } from './ZhipuHttpClient';
import { ZhipuApiError } from './ZhipuErrorUtils';

/**
 * 智谱文本生成适配器（GLM 系列）。
 *
 * 兼容 OpenAI Chat Completions 格式：
 *   POST /chat/completions
 *   Body: { model, messages, max_tokens, temperature, top_p, stream, tools }
 *   Models: glm-4-plus / glm-4-air / glm-4-flash / glm-4-long
 */
export class ZhipuTextAdapter implements ITextGenerationPort {
  private http: ZhipuHttpClient;
  private config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    this.http = new ZhipuHttpClient(config);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'ZhipuTextAdapter', ...extra };
  }

  async chatCompletion(context: TextGenerationContext): Promise<TextGenerationResult> {
    // ── Mock 模式 ──
    if (!this.config.zhipuApiKey) {
      this.logger?.warn('No API Key - returning mock result', this.ctx({}));
      return {
        content: '[Mock] 请配置智谱 API Key 以使用文本生成功能。',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    const payload = this.buildPayload(context, false);
    const result = await this.http.post<ZhipuChatResponse>('/chat/completions', payload);

    const choice = result.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      usage: result.usage ? {
        promptTokens: result.usage.prompt_tokens ?? 0,
        completionTokens: result.usage.completion_tokens ?? 0,
      } : undefined,
    };
  }

  chatCompletionStream(context: TextGenerationContext, callbacks: TextStreamCallbacks): AbortController {
    const controller = new AbortController();

    if (!this.config.zhipuApiKey) {
      callbacks.onError(new Error('智谱 API Key 未配置'));
      return controller;
    }

    const payload = this.buildPayload(context, true);

    (async () => {
      try {
        for await (const event of this.http.stream<ZhipuStreamEvent>('/chat/completions', payload)) {
          if (controller.signal.aborted) break;

          const delta = event.choices?.[0]?.delta;
          if (delta?.content) {
            callbacks.onTextDelta(delta.content);
          }
          if (delta?.reasoning_content) {
            callbacks.onThinkingDelta(delta.reasoning_content);
          }
          if (event.choices?.[0]?.finish_reason === 'stop' || event.choices?.[0]?.finish_reason === 'length') {
            break;
          }
        }
        callbacks.onComplete({ content: '' });
      } catch (err) {
        callbacks.onError(err instanceof Error ? err : new ZhipuApiError(0, 'STREAM', String(err)));
      }
    })();

    return controller;
  }

  // ===== 私有方法 =====

  private buildPayload(context: TextGenerationContext, stream: boolean): Record<string, unknown> {
    const model = context.model || 'glm-4-plus';

    const messages = context.messages.map((m: TextGenerationMessage) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      // 多模态消息
      const content = (m.content as TextContentBlock[]).map(b => {
        if (b.type === 'text') return { type: 'text', text: b.text };
        return {
          type: 'image_url',
          image_url: { url: (b as { source: { url: string } }).source.url },
        };
      });
      return { role: m.role, content };
    });

    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: context.maxTokens ?? 4096,
      stream,
    };
    if (context.temperature !== undefined) payload.temperature = context.temperature;
    if (context.topP !== undefined) payload.top_p = context.topP;
    if (context.tools?.length) payload.tools = context.tools;
    return payload;
  }
}

interface ZhipuChatResponse {
  id: string;
  choices?: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ZhipuStreamEvent {
  choices?: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string;
  }>;
}
