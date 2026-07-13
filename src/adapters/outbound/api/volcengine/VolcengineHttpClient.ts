import type { ApiConfig } from '../../config/ApiConfigStore';
import { BaseHttpClient } from '../_base/BaseHttpClient';
import { parseVolcengineError, VolcengineApiError } from './VolcengineErrorUtils';

/**
 * 火山引擎 HTTP 客户端。
 *
 * 双协议支持：
 *  - openai:     Base URL = volcArkBaseUrl，            鉴权头 Authorization: Bearer <key>
 *  - anthropic:  Base URL = volcArkAnthropicBaseUrl,   鉴权头 x-api-key + anthropic-version
 *
 * 协议类型在构造时根据 config.volcArkProtocol 确定，运行时无额外开销。
 *
 * Phase 4 DRY：继承 BaseHttpClient，stream<T> 委托 readSseStream。
 */
export class VolcengineHttpClient extends BaseHttpClient {
  private readonly config: ApiConfig;
  /** 是否为 Anthropic 协议（Agent Plan 接入） */
  readonly isAnthropic: boolean;

  constructor(config: ApiConfig) {
    const isAnthropic = config.volcArkProtocol === 'anthropic';
    const baseUrl = isAnthropic
      ? config.volcArkAnthropicBaseUrl
      : config.volcArkBaseUrl;
    const headers: Record<string, string> = isAnthropic
      ? {
          'x-api-key': config.volcArkApiKey,
          'anthropic-version': '2023-06-01',
        }
      : {
          'Authorization': `Bearer ${config.volcArkApiKey}`,
        };

    super({ baseUrl, headers, parseError: parseVolcengineError });

    this.config = config;
    this.isAnthropic = isAnthropic;

    // Phase 7：保留初始化日志（替换为 console.info 以保持 Adapter 无 logger 注入的简洁性）
    console.info('[VolcengineHttpClient] 初始化', {
      protocol: config.volcArkProtocol,
      baseUrl,
      hasApiKey: !!config.volcArkApiKey.trim(),
    });
  }

  /**
   * 获取当前协议下的鉴权头（供需要原生 fetch 的适配器使用）。
   */
  getAuthHeaders(): Record<string, string> {
    if (this.isAnthropic) {
      return {
        'x-api-key': this.config.volcArkApiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    return {
      'Authorization': `Bearer ${this.config.volcArkApiKey}`,
    };
  }

  /**
   * 获取当前协议下的 Base URL（已去除尾部斜杠）。
   */
  getBaseUrl(): string {
    const url = this.isAnthropic
      ? this.config.volcArkAnthropicBaseUrl
      : this.config.volcArkBaseUrl;
    return url.replace(/\/+$/, '');
  }

  /**
   * SSE 流式请求。
   * 使用原生 fetch + ReadableStream，返回 AsyncIterable。
   */
  async *stream<T>(path: string, data: unknown): AsyncIterable<T> {
    yield* this.readSseStream<T>(path, data);
  }

  protected override parseStreamError(status: number, body: string): Error {
    return new VolcengineApiError(status, `HTTP ${status}`, body);
  }
}
