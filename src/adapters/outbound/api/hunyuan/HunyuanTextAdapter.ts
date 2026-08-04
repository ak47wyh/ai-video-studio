import type {
  ITextGenerationPort,
  TextGenerationContext,
  TextGenerationResult,
  TextStreamCallbacks,
  TextGenerationMessage,
} from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { HunyuanHttpClient } from './HunyuanHttpClient';
import { withRetry } from './HunyuanErrorUtils';

/**
 * 腾讯混元 Hunyuan 文本生成适配器。
 *
 * 接口：Action=ChatCompletions
 *   Body: { Model, Messages: [{Role, Content}], Stream?, Temperature?, TopP? }
 *   Models: hunyuan-turbos-latest / hunyuan-standard / hunyuan-lite
 *   Response: { Response: { Choices: [{Message: {Role, Content}, FinishReason}], Usage } }
 *
 * 混元的流式输出通过 SSE 返回，本适配器简化处理：非流式调用同步返回。
 */
export class HunyuanTextAdapter implements ITextGenerationPort {
  private http: HunyuanHttpClient;
  private config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    this.http = new HunyuanHttpClient(config);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'HunyuanTextAdapter', ...extra };
  }

  async chatCompletion(context: TextGenerationContext): Promise<TextGenerationResult> {
    return this.chatCompletionInternal(context);
  }

  /**
   * 内部方法：接受可选 signal，允许流式模拟场景真正中断 HTTP 请求（P2-8）。
   */
  private async chatCompletionInternal(
    context: TextGenerationContext,
    signal?: AbortSignal,
  ): Promise<TextGenerationResult> {
    // ── Mock 模式 ──
    if (!this.config.hunyuanSecretId || !this.config.hunyuanSecretKey) {
      this.logger?.warn('No SecretId/SecretKey - returning mock result', this.ctx({}));
      return {
        content: '[Mock] 请配置腾讯混元 SecretId/SecretKey 以使用文本生成功能。',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    const payload = this.buildPayload(context);
    const result = await withRetry(() =>
      this.http.call<HunyuanChatResponse>('ChatCompletions', payload, signal),
    );

    const choice = result?.Response?.Choices?.[0];
    const usage = result?.Response?.Usage;
    return {
      content: choice?.Message?.Content ?? '',
      usage: usage ? {
        promptTokens: usage.PromptTokens ?? 0,
        completionTokens: usage.CompletionTokens ?? 0,
      } : undefined,
    };
  }

  chatCompletionStream(context: TextGenerationContext, callbacks: TextStreamCallbacks): AbortController {
    const controller = new AbortController();

    if (!this.config.hunyuanSecretId || !this.config.hunyuanSecretKey) {
      callbacks.onError(new Error('混元 SecretId/SecretKey 未配置'));
      return controller;
    }

    // 混元流式需通过 SSE 端点，签名逻辑复杂，这里降级为非流式后逐字推送
    // P2-8：把 controller.signal 传入底层 HTTP，取消时真正中断请求而非仅前端节流
    (async () => {
      try {
        const result = await this.chatCompletionInternal(context, controller.signal);
        if (controller.signal.aborted) return;

        // 逐字符推送模拟流式效果
        const content = result.content;
        const chunkSize = 2;
        for (let i = 0; i < content.length; i += chunkSize) {
          if (controller.signal.aborted) return;
          callbacks.onTextDelta(content.slice(i, i + chunkSize));
          await new Promise(r => setTimeout(r, 16));
        }
        callbacks.onComplete(result);
      } catch (err) {
        if (!controller.signal.aborted) {
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return controller;
  }

  // ===== 私有方法 =====

  private buildPayload(context: TextGenerationContext): Record<string, unknown> {
    const model = context.model || 'hunyuan-turbos-latest';

    // 腾讯云混元消息格式：{ Role: 'system'|'user'|'assistant', Content: string }
    const messages = context.messages.map((m: TextGenerationMessage) => ({
      Role: m.role,
      Content: typeof m.content === 'string'
        ? m.content
        : (m.content as Array<{ type: string; text?: string }>)
            .map(b => b.type === 'text' ? b.text : '')
            .join(''),
    }));

    const payload: Record<string, unknown> = {
      Model: model,
      Messages: messages,
    };
    if (context.maxTokens) payload.MaxTokens = context.maxTokens;
    if (context.temperature !== undefined) payload.Temperature = context.temperature;
    if (context.topP !== undefined) payload.TopP = context.topP;
    return payload;
  }
}

interface HunyuanChatResponse {
  Response: {
    Choices?: Array<{
      Message: { Role: string; Content: string };
      FinishReason?: string;
    }>;
    Usage?: {
      PromptTokens?: number;
      CompletionTokens?: number;
      TotalTokens?: number;
    };
    RequestId?: string;
  };
}
