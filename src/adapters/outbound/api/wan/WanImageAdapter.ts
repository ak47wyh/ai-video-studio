import type { IImageGeneratorPort, ImageGenerationContext, ImageGenerationResult } from '../../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { UnsupportedCapabilityError } from '../../../../domain/errors/UnsupportedCapabilityError';
import { WanHttpClient } from './WanHttpClient';
import { withRetry } from './WanErrorUtils';

/**
 * 通义万相图片生成适配器。
 *
 * Endpoint: POST /services/aigc/text2image/image-synthesis
 *           Header: X-DashScope-Async: enable（异步任务）
 *           提交后返回 task_id，需轮询 GET /tasks/{task_id} 获取结果
 * Models: wanx2.1-t2i-turbo / wanx-v1
 */
export class WanImageAdapter implements IImageGeneratorPort {
  private http: WanHttpClient;
  private config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
    this.http = new WanHttpClient(config);
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'WanImageAdapter', ...extra };
  }

  async generateImage(context: ImageGenerationContext): Promise<ImageGenerationResult> {
    // ── API Key 缺失：抛能力不支持错误，禁止返回占位图 ──
    if (!this.config.wanApiKey) {
      throw new UnsupportedCapabilityError('wan', 'image');
    }

    const model = context.model || 'wanx2.1-t2i-turbo';
    const parameters: Record<string, unknown> = {
      size: this.mapAspectRatioToSize(context.aspectRatio),
      n: context.n ?? 1,
    };

    this.logger?.debug('generateImage 入参', this.ctx({
      promptLength: context.prompt.length,
      model,
    }));

    const payload = {
      model,
      input: { prompt: context.prompt },
      parameters,
    };

    // Step 1: 提交异步任务
    const createResult = await withRetry(() =>
      this.http.post<WanImageCreateResponse>(
        '/services/aigc/text2image/image-synthesis',
        payload,
        { headers: { 'X-DashScope-Async': 'enable' } },
      ),
    );
    const taskId = createResult?.output?.task_id;
    if (!taskId) throw new Error('通义万相图片任务未返回 task_id');

    // Step 2: 轮询任务状态
    const urls = await this.pollImageTask(taskId);
    if (urls.length === 0) throw new Error('通义万相图片生成未返回结果 URL');

    return {
      imageUrls: urls,
      metadata: { successCount: urls.length, failedCount: 0 },
    };
  }

  /** 轮询图片任务直至完成或超时 */
  private async pollImageTask(taskId: string, maxAttempts = 60, intervalMs = 2000): Promise<string[]> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      const result = await this.http.get<WanImageTaskResponse>(`/tasks/${taskId}`);
      const status = result?.output?.task_status;
      if (status === 'SUCCEEDED') {
        return (result.output?.results || []).map(r => r.url).filter(Boolean) as string[];
      }
      if (status === 'FAILED') {
        throw new Error(result.output?.message || '通义万相图片生成失败');
      }
      // PENDING / RUNNING 继续轮询
    }
    throw new Error('通义万相图片生成超时');
  }

  private mapAspectRatioToSize(ratio?: string): string {
    const map: Record<string, string> = {
      '1:1': '1024*1024',
      '16:9': '1280*720',
      '4:3': '1024*768',
      '3:2': '1152*768',
      '2:3': '768*1152',
      '3:4': '768*1024',
      '9:16': '720*1280',
      '21:9': '1280*544',
    };
    return map[ratio || '1:1'] || '1024*1024';
  }
}

interface WanImageCreateResponse {
  output?: { task_id: string };
  request_id?: string;
}

interface WanImageTaskResponse {
  output?: {
    task_id: string;
    task_status: string;
    results?: Array<{ url: string }>;
    message?: string;
  };
}
