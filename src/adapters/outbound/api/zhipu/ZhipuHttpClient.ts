import type { ApiConfig } from '../../config/ApiConfigStore';
import { BaseHttpClient } from '../_base/BaseHttpClient';
import { parseZhipuError, ZhipuApiError } from './ZhipuErrorUtils';

/**
 * 智谱 AI HTTP 客户端。
 *
 * 鉴权：Bearer API-Key
 * Base URL：https://open.bigmodel.cn/api/paas/v4
 *
 * 支持视频/图片/文本/语音模态。
 *
 * Phase 4 DRY：继承 BaseHttpClient，stream<T> 委托 readSseStream。
 */
export class ZhipuHttpClient extends BaseHttpClient {
  constructor(config: ApiConfig) {
    super({
      baseUrl: config.zhipuBaseUrl,
      headers: { 'Authorization': `Bearer ${config.zhipuApiKey}` },
      parseError: parseZhipuError,
    });
  }

  /**
   * SSE 流式请求（用于文本 chatCompletionStream）。
   * 返回 AsyncIterable<T>，每个 yield 是一个 SSE 事件 payload。
   */
  async *stream<T>(path: string, data: unknown): AsyncIterable<T> {
    yield* this.readSseStream<T>(path, data);
  }

  protected override parseStreamError(status: number, body: string): Error {
    return new ZhipuApiError(status, 'STREAM_ERROR', body);
  }
}
