import type { IModelResponsePort } from '../../../../domain/ports/VolcenginePorts';
import type {
  ResponseCreateParams, ResponseResult, ResponseStreamChunk, ResponseContextResult,
} from '../../../../domain/entities/models';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';

export class VolcengineResponseAdapter implements IModelResponsePort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new VolcengineHttpClient(config);
  }

  /** Responses API 依赖 OpenAI 兼容端点，Anthropic 协议不支持 */
  private ensureOpenAIProtocol(): void {
    if (this.config.volcArkProtocol === 'anthropic') {
      throw new Error('Anthropic 协议（Agent Plan）不支持 Responses API，请切换至 OpenAI 协议（标准后付费模式）');
    }
  }

  async createResponse(params: ResponseCreateParams): Promise<ResponseResult> {
    this.ensureOpenAIProtocol();

    console.log('[VolcengineResponseAdapter] createResponse 入参', {
      model: params.model,
      hasInput: !!params.input,
      previousResponseId: params.previousResponseId,
    });

    const result = await withRetry(() =>
      this.http.post<ResponseResult>('/responses', this.buildPayload(params)),
    );

    console.log('[VolcengineResponseAdapter] createResponse 出参', {
      hasResult: !!result,
    });

    return result;
  }

  async *createResponseStream(params: ResponseCreateParams): AsyncIterable<ResponseStreamChunk> {
    yield* this.http.stream<ResponseStreamChunk>('/responses', {
      ...this.buildPayload(params),
      stream: true,
    });
  }

  async getResponse(responseId: string): Promise<ResponseResult> {
    return this.http.get<ResponseResult>(`/responses/${responseId}`);
  }

  async getResponseContext(responseId: string): Promise<ResponseContextResult> {
    return this.http.get<ResponseContextResult>(`/responses/${responseId}/context`);
  }

  async deleteResponse(responseId: string): Promise<void> {
    await this.http.delete(`/responses/${responseId}`);
  }

  private buildPayload(params: ResponseCreateParams): Record<string, unknown> {
    return {
      model: params.model,
      input: params.input,
      ...(params.previousResponseId && { previous_response_id: params.previousResponseId }),
      ...(params.caching && { caching: params.caching }),
      ...(params.store !== undefined && { store: params.store }),
      ...(params.thinking && { thinking: params.thinking }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.expireAt !== undefined && { expire_at: params.expireAt }),
    };
  }
}