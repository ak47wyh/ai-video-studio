import type { ApiConfig } from '../../config/ApiConfigStore';
import type { VolcArkProtocol } from '../../../../domain/entities/platform';
import type { ILoggerPort } from '../../../../domain/ports/CrossCuttingPorts';
import { BaseHttpClient } from '../_base/BaseHttpClient';
import { parseVolcengineError, VolcengineApiError } from './VolcengineErrorUtils';

/**
 * 火山引擎 HTTP 客户端。
 *
 * 双协议并存架构（澄清项 1）：
 *  - openai:     Base URL = volcArkBaseUrl，            鉴权头 Authorization: Bearer <volcArkOpenAiApiKey>
 *  - anthropic:  Base URL = volcArkAnthropicBaseUrl,   鉴权头 x-api-key + anthropic-version
 *
 * Agent Plan Base URL（澄清项 2）：
 *  - 图片/视频生成走 volcArkAgentPlanBaseUrl（/api/plan/v3），
 *    官方文档明确要求 Agent Plan 接口路径包含 /plan 段，不可与普通 baseUrl 混用。
 *
 * 协议与 Base URL 选择由调用方（Adapter）显式传入：
 *   - VolcengineVoiceAdapter / VolcengineTextAdapter → createOpenAI / createAnthropic（/api/v3）
 *   - VolcengineImageAdapter / VolcengineVideoAdapter → createAgentPlan（/api/plan/v3）
 *
 * 双协议并存：OpenAI Key 与 Anthropic Key 独立配置，互不干扰。
 *
 * Phase 4 DRY：继承 BaseHttpClient，stream<T> 委托 readSseStream。
 */
export class VolcengineHttpClient extends BaseHttpClient {
  private readonly config: ApiConfig;
  /** 当前生效的 Base URL（去除尾部斜杠） */
  private readonly activeBaseUrl: string;
  /** 是否为 Anthropic 协议（Agent Plan 接入） */
  readonly isAnthropic: boolean;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, protocol: VolcArkProtocol, baseUrlOverride?: string, logger?: ILoggerPort) {
    const isAnthropic = protocol === 'anthropic';
    // baseUrlOverride 用于 Agent Plan 等独立路径场景，优先级最高
    const baseUrl = baseUrlOverride
      ?? (isAnthropic ? config.volcArkAnthropicBaseUrl : config.volcArkBaseUrl);

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
    this.activeBaseUrl = baseUrl.replace(/\/+$/, '');
    this.logger = logger;

    this.logger?.info('VolcengineHttpClient 初始化', {
      service: 'VolcengineHttpClient',
      protocol,
      baseUrlSource: baseUrlOverride ? 'agent-plan-override' : (isAnthropic ? 'anthropic' : 'openai-default'),
      baseUrl,
      hasApiKey: !!apiKey.trim(),
    });
  }

  /** 工厂方法：创建 OpenAI 协议 HttpClient（Voice/Text Adapter 使用，走 /api/v3） */
  static createOpenAI(config: ApiConfig, logger?: ILoggerPort): VolcengineHttpClient {
    return new VolcengineHttpClient(config, 'openai', undefined, logger);
  }

  /** 工厂方法：创建 Anthropic 协议 HttpClient */
  static createAnthropic(config: ApiConfig, logger?: ILoggerPort): VolcengineHttpClient {
    return new VolcengineHttpClient(config, 'anthropic', undefined, logger);
  }

  /** 工厂方法：创建 Agent Plan HttpClient（Image/Video Adapter 使用）
   *  Base URL 与普通方舟相同（统一走 /volcengine-ark 代理），
   *  Vite proxy 通过请求路径智能分流到 /api/plan/v3。 */
  static createAgentPlan(config: ApiConfig, logger?: ILoggerPort): VolcengineHttpClient {
    return new VolcengineHttpClient(config, 'openai', config.volcArkBaseUrl, logger);
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
   * 获取当前生效的 Base URL（已去除尾部斜杠）。
   * 优先级：activeBaseUrl（构造时确定）> 对应协议字段。
   */
  getBaseUrl(): string {
    return this.activeBaseUrl;
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
