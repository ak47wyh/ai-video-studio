import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from 'axios';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { parseVolcengineError, VolcengineApiError } from './VolcengineErrorUtils';

/**
 * 火山引擎 HTTP 客户端。
 *
 * 双协议支持：
 *  - openai:     Base URL = volcArkBaseUrl，            鉴权头 Authorization: Bearer <key>
 *  - anthropic:  Base URL = volcArkAnthropicBaseUrl,   鉴权头 x-api-key + anthropic-version
 *
 * 协议类型在构造时根据 config.volcArkProtocol 确定，运行时无额外开销。
 */
export class VolcengineHttpClient {
  private client: AxiosInstance;
  private config: ApiConfig;
  /** 是否为 Anthropic 协议（Agent Plan 接入） */
  readonly isAnthropic: boolean;

  constructor(config: ApiConfig) {
    this.config = config;
    this.isAnthropic = config.volcArkProtocol === 'anthropic';

    const baseUrl = this.isAnthropic
      ? config.volcArkAnthropicBaseUrl
      : config.volcArkBaseUrl;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.isAnthropic) {
      // Anthropic 协议鉴权（Agent Plan）
      headers['x-api-key'] = config.volcArkApiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      // OpenAI 协议鉴权（标准后付费）
      headers['Authorization'] = `Bearer ${config.volcArkApiKey}`;
    }

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 120_000, // 120s（视频/3D 生成可能耗时较长）
      headers,
    });

    // 响应拦截器：统一错误处理
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const parsed = parseVolcengineError(error);
        return Promise.reject(parsed);
      },
    );

    console.log('[VolcengineHttpClient] 初始化', {
      protocol: config.volcArkProtocol,
      baseUrl,
      hasApiKey: !!config.volcArkApiKey.trim(),
    });
  }

  async post<T>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(path, data, config);
    return response.data;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(path, { params });
    return response.data;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.client.delete<T>(path);
    return response.data;
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
    const url = `${this.getBaseUrl()}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({ ...data as object, stream: true }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new VolcengineApiError(response.status, `HTTP ${response.status}`, errorBody);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取响应流');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留未完成的行

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') return;
          try {
            yield JSON.parse(payload) as T;
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    }
  }
}
