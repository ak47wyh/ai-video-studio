import type { IHttpFetchPort, HttpFetchOptions } from '../../../domain/ports/CrossCuttingPorts';
import { NetworkError, TimeoutError } from '../../../domain/errors';

/**
 * BrowserFetchAdapter —— 浏览器 fetch 的领域端口实现。
 *
 * 职责：
 *  1. 用 fetch + AbortController 实现 `IHttpFetchPort`
 *  2. 把 fetch 层抛出的 TypeError / CORS / DNS 错误归一化为 `NetworkError`
 *  3. 把超时归一化为 `TimeoutError`
 *  4. 把 HTTP >= 400 归一化为 `NetworkError`（携带 httpStatus）
 *
 * 使 Domain Service 不再直接调用 `fetch()`，遵守六边形依赖方向铁律。
 */
export class BrowserFetchAdapter implements IHttpFetchPort {
  private async doFetch(url: string, options?: HttpFetchOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 30_000;

    // 组合外部 signal 与内部超时 signal
    const externalSignal = options?.signal;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortHandler = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      const response = await fetch(url, {
        headers: options?.headers,
        signal: controller.signal,
      });
      if (!options?.ignoreStatus && response.status >= 400) {
        throw new NetworkError({
          message: `HTTP ${response.status} ${response.statusText}`,
          context: { url, httpStatus: response.status },
        });
      }
      return response;
    } catch (err) {
      if (err instanceof NetworkError || err instanceof TimeoutError) throw err;
      // AbortError → 判定是超时还是外部取消
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (externalSignal?.aborted) {
          throw new NetworkError({ message: 'Request aborted', context: { url }, cause: err });
        }
        throw new TimeoutError({
          message: `Request timed out after ${timeoutMs}ms`,
          context: { url, timeoutMs },
          cause: err,
        });
      }
      // fetch TypeError（CORS / DNS / 无网络）
      throw new NetworkError({
        message: err instanceof Error ? err.message : 'Network request failed',
        context: { url },
        cause: err,
      });
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', abortHandler);
    }
  }

  async fetchBlob(url: string, options?: HttpFetchOptions): Promise<Blob> {
    const response = await this.doFetch(url, options);
    return response.blob();
  }

  async fetchText(url: string, options?: HttpFetchOptions): Promise<string> {
    const response = await this.doFetch(url, options);
    return response.text();
  }

  async fetchJson<T = unknown>(url: string, options?: HttpFetchOptions): Promise<T> {
    const response = await this.doFetch(url, options);
    return response.json() as Promise<T>;
  }
}
