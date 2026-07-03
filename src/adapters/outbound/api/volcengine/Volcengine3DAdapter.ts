import type { IThreeDGenerationPort } from '../../../../domain/ports/VolcenginePorts';
import type {
  ThreeDSubmitParams, ThreeDTaskResult, ThreeDTaskStatus,
  ThreeDTaskListResult, ThreeDPlatformId, ThreeDTaskStatusType, ThreeDOutputFormat,
  TaskListFilter,
} from '../../../../domain/entities/models';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';
import type { VolcengineTaskResponse } from './VolcengineVideoAdapter';

/**
 * 火山引擎 3D 生成适配器。
 * 一个类覆盖三个子提供商（Seed3D / 影眸 / 数美），通过 provider 参数区分。
 *
 * 三个提供商共享相同的 API 端点结构，仅 model 字段（端点 ID）不同。
 */
export class Volcengine3DAdapter implements IThreeDGenerationPort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;
  private provider: ThreeDPlatformId;

  constructor(config: ApiConfig, provider: ThreeDPlatformId) {
    this.config = config;
    this.http = new VolcengineHttpClient(config);
    this.provider = provider;
  }

  /** Anthropic 协议（Agent Plan）不支持 3D 生成 */
  private ensureOpenAIProtocol(): void {
    if (this.config.volcArkProtocol === 'anthropic') {
      throw new Error('Anthropic 协议（Agent Plan）不支持 3D 生成，请切换至 OpenAI 协议（标准后付费模式）');
    }
  }

  async submitTask(params: ThreeDSubmitParams): Promise<ThreeDTaskResult> {
    this.ensureOpenAIProtocol();
    const payload = this.buildPayload(params);

    console.log('[Volcengine3DAdapter] submitTask 入参', {
      provider: this.provider,
      prompt: params.prompt,
      promptLength: params.prompt?.length ?? 0,
      imageCount: params.imageUrls?.length ?? 0,
      modelEndpointId: params.modelEndpointId,
    });

    const result = await withRetry(() =>
      this.http.post<{ id: string; status: string }>('/contents/generations/tasks', payload),
    );

    console.log('[Volcengine3DAdapter] submitTask 出参', {
      taskId: result.id,
      status: result.status,
    });

    return {
      taskId: result.id,
      status: result.status as ThreeDTaskStatusType,
      platform: this.provider,
    };
  }

  async queryTask(taskId: string): Promise<ThreeDTaskStatus> {
    this.ensureOpenAIProtocol();
    const result = await this.http.get<VolcengineTaskResponse>(`/contents/generations/tasks/${taskId}`);

    console.log('[Volcengine3DAdapter] queryTask 出参', {
      taskId,
      status: result.status,
      hasModelUrl: !!result.content?.model_url,
    });

    return {
      taskId: result.id,
      status: result.status as ThreeDTaskStatusType,
      modelUrl: result.content?.model_url,
      previewImageUrl: result.content?.preview_image_url,
      format: result.content?.format as ThreeDOutputFormat | undefined,
      error: result.error,
      createdAt: result.created_at,
      completedAt: result.completed_at,
    };
  }

  async queryTaskList(filters?: TaskListFilter): Promise<ThreeDTaskListResult> {
    const result = await this.http.get<{ total: number; items: VolcengineTaskResponse[] }>('/contents/generations/tasks', {
      page_num: filters?.pageNum ?? 1,
      page_size: filters?.pageSize ?? 20,
      ...(filters?.status && { 'filter.status': filters.status }),
    });
    return { total: result.total, items: (result.items ?? []) as unknown as ThreeDTaskStatus[] };
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.http.delete(`/contents/generations/tasks/${taskId}`);
  }

  private buildPayload(params: ThreeDSubmitParams): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [];

    if (params.prompt) {
      content.push({ type: 'text', text: params.prompt });
    }
    if (params.imageUrls) {
      for (const url of params.imageUrls) {
        content.push({ type: 'image_url', image_url: { url } });
      }
    }

    return {
      model: params.modelEndpointId || this.getDefaultModel(),
      content,
      // Seed3D 特有参数
      ...(this.provider === 'volcengine-seed3d' && {
        coarse_to_fine: params.coarseToFine,
        pbr_output: params.pbrOutput,
      }),
    };
  }

  private getDefaultModel(): string {
    // 实际端点 ID 需用户在火山方舟控制台创建推理接入点后获取
    // 此处为占位，运行时从配置或参数中获取
    switch (this.provider) {
      case 'volcengine-seed3d': return 'seed3d-2.0';
      case 'volcengine-yingmou': return 'yingmou-hyper3d-gen2';
      case 'volcengine-shumei': return 'shumei-hitem3d-2.0';
      default: throw new Error(`不支持的 3D 提供商: ${this.provider}`);
    }
  }
}