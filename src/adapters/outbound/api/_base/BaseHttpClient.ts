import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from 'axios';

/**
 * BaseHttpClient —— 平台 HTTP 客户端抽象基类。
 *
 * Phase 4 DRY 抽取：6 个平台 HttpClient（Volcengine/Kling/Vidu/Wan/Zhipu）
 * 共享 axios 实例创建、post/get/delete 调用、SSE 流解析样板代码。
 * 子类只需提供 baseUrl / headers / parseError，并保留各自的鉴权算法实现。
 *
 * 设计决策：
 *   - 子类负责构建鉴权头，通过 super({ baseUrl, headers, parseError }) 注入
 *   - SSE stream 实现统一抽取（fetch + ReadableStream + data: 行解析）
 *   - Hunyuan 因 TC3-HMAC-SHA256 签名 + call<T> 模式过于特殊，不继承本类
 *   - Kling 通过 request interceptor 动态注入 JWT，仍可继承本类（client 暴露为 protected）
 *
 * 公共 API 与原各平台 HttpClient 保持兼容：post<T> / get<T> / delete<T> / stream<T>
 */
export abstract class BaseHttpClient {
  protected readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly authHeaders: Record<string, string>;
  private readonly parseError: (error: AxiosError) => Error;

  constructor(opts: {
    baseUrl: string;
    headers: Record<string, string>;
    parseError: (error: AxiosError) => Error;
    /** 请求超时毫秒，默认 120s（视频/3D 生成可能耗时较长） */
    timeout?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authHeaders = opts.headers;
    this.parseError = opts.parseError;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: opts.timeout ?? 120_000,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });

    // 响应拦截器：统一错误归一化（委托子类提供的 parseError）
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => Promise.reject(this.parseError(error)),
    );
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
   * SSE 流式请求辅助方法（供子类 stream<T> 复用）。
   *
   * 使用原生 fetch + ReadableStream，按 `data:` 行前缀解析事件。
   * 兼容 `data: foo` 与 `data:foo` 两种格式（trim 后判断 [DONE]）。
   *
   * 子类通常这样实现：
   * ```ts
   * async *stream<T>(path: string, data: unknown): AsyncIterable<T> {
   *   yield* this.readSseStream<T>(path, data);
   * }
   * protected override parseStreamError(status, body) {
   *   return new XxxApiError(status, 'STREAM_ERROR', body);
   * }
   * ```
   */
  protected async *readSseStream<T>(
    path: string,
    data: unknown,
    extraHeaders?: Record<string, string>,
  ): AsyncIterable<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...this.authHeaders,
        ...extraHeaders,
      },
      body: JSON.stringify({ ...(data as object), stream: true }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw this.parseStreamError(response.status, errorBody);
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
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            yield JSON.parse(payload) as T;
          } catch {
            // 跳过无法解析的行（注释/心跳/不完整 JSON）
          }
        }
      }
    }
  }

  /**
   * 子类覆盖：SSE 流错误归一化。
   * 默认抛出普通 Error；子类应返回平台特定的 ApiError 子类。
   */
  protected parseStreamError(status: number, body: string): Error {
    return new Error(`Stream request failed: HTTP ${status}, body: ${body}`);
  }
}
