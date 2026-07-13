import type { ApiConfig } from '../../config/ApiConfigStore';
import { BaseHttpClient } from '../_base/BaseHttpClient';
import { parseWanError, WanApiError } from './WanErrorUtils';

/**
 * 通义万相（DashScope）HTTP 客户端。
 *
 * 鉴权：HTTP Header `Authorization: Bearer <API-Key>`
 * Base URL：https://dashscope.aliyuncs.com/api/v1
 *
 * 异步任务接口需附加 Header `X-DashScope-Async: enable`。
 * 兼容 OpenAI 格式：`/compatible-mode/v1/chat/completions`。
 *
 * Phase 4 DRY：继承 BaseHttpClient，stream<T> 委托 readSseStream。
 */
export class WanHttpClient extends BaseHttpClient {
  constructor(config: ApiConfig) {
    super({
      baseUrl: config.wanBaseUrl,
      headers: { 'Authorization': `Bearer ${config.wanApiKey}` },
      parseError: parseWanError,
    });
  }

  /**
   * SSE 流式请求（OpenAI 兼容 chat/completions）。
   */
  async *stream<T>(path: string, data: unknown): AsyncIterable<T> {
    yield* this.readSseStream<T>(path, data);
  }

  protected override parseStreamError(status: number, body: string): Error {
    return new WanApiError(status, 'STREAM_ERROR', body);
  }
}
