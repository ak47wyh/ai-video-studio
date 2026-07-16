import type { ApiConfig } from '../../config/ApiConfigStore';
import type { VolcArkProtocol } from '../../../../domain/entities/platform';
import { BaseHttpClient } from '../_base/BaseHttpClient';
import { parseVolcengineError, VolcengineApiError } from './VolcengineErrorUtils';

/**
 * 火山引擎 HTTP 客户端。
 *
 * 双协议并存架构（澄清项 1）：
 *  - openai:     Base URL = volcArkBaseUrl，            鉴权头 Authorization: Bearer <volcArkOpenAiApiKey>
 *  - anthropic:  Base URL = volcArkAnthropicBaseUrl,   鉴权头 x-api-key + anthropic-version
 *
 * 协议由调用方（Adapter）显式传入，不再从 config.volcArkTextProtocol 全局锁定。
 * 每种能力（video/image/text）由 Adapter 自行决定走哪个协议：
 *   - VolcengineVideoAdapter / VolcengineImageAdapter → 永远走 openai
 *   - VolcengineTextAdapter → 按 config.volcArkTextProtocol 选择
 *
 * 双协议并存：OpenAI Key 与 Anthropic Key 独立配置，互不干扰。
 *
 * Phase 4 DRY：继承 BaseHttpClient，stream<T> 委托 readSseStream。
 */
export class VolcengineHttpClient extends BaseHttpClient {
  private readonly config: ApiConfig;
  /** 是否为 Anthropic 协议（Agent Plan 接入） */
  readonly isAnthropic: boolean;

  constructor(config: ApiConfig, protocol: VolcArkProtocol) {
    const isAnthropic = protocol === 'anthropic';
    const baseUrl = isAnthropic
      ? config.volcArkAnthropicBaseUrl
      : config.volcArkBaseUrl;

    // 双协议并存：按协议取对应的 Key 字段
    const apiKey = isAnthropic
      ? config.volcArkAnthropicApiKey
      : config.volcArkOpenAiApiKey;
    const headers: Record<string, string> = isAnthropic
      ? {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }
      : {
          'Authorization': `Bearer ${apiKey}`,
        };

    super({ baseUrl, headers, parseError: parseVolcengineError });

    this.config = config;
    this.isAnthropic = isAnthropic;

    console.info('[VolcengineHttpClient] 初始化', {
      protocol,
      baseUrl,
      hasApiKey: !!apiKey.trim(),
    });
  }

  /** 工厂方法：创建 OpenAI 协议 HttpClient（Video/Image Adapter 强制使用） */
  static createOpenAI(config: ApiConfig): VolcengineHttpClient {
    return new VolcengineHttpClient(config, 'openai');
  }

  /** 工厂方法：创建 Anthropic 协议 HttpClient */
  static createAnthropic(config: ApiConfig): VolcengineHttpClient {
    return new VolcengineHttpClient(config, 'anthropic');
  }

  /**
   * 获取当前协议下的鉴权头（供需要原生 fetch 的适配器使用）。
   */
  getAuthHeaders(): Record<string, string> {
    if (this.isAnthropic) {
      return {
        'x-api-key': this.config.volcArkAnthropicApiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    return {
      'Authorization': `Bearer ${this.config.volcArkOpenAiApiKey}`,
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
