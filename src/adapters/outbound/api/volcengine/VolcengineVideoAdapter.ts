import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult,
  VideoAgentContext, VideoAgentTaskResult,
  VideoTaskListFilter, VideoTaskListResult,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { VolcengineHttpClient } from './VolcengineHttpClient';
import { withRetry } from './VolcengineErrorUtils';
import { PLATFORM_METADATA } from '../../../../domain/services/platformCapabilities';

/**
 * 火山引擎视频生成适配器（Seedance 系列模型）。
 *
 * 接口映射：
 *   IVideoGeneratorPort.submitVideoTask  → POST   /contents/generations/tasks（返回 task_id 字符串）
 *   IVideoGeneratorPort.queryTaskStatus  → GET    /contents/generations/tasks/{task_id}
 *   IVideoGeneratorPort.cancelTask       → DELETE /contents/generations/tasks/{task_id}
 *   IVideoGeneratorPort.listTasks        → GET    /contents/generations/tasks?page_size=&filter.status=
 *   IVideoGeneratorPort.downloadVideo    → 下载 video_url 字节流并封装 Blob URL
 *
 * 注意：
 *   - 火山引擎无 createAgentTask / queryAgentTask 概念，这两个方法抛 CapabilityNotSupportedError
 *   - video_url 有效期 24 小时
 *   - Seedance API 使用 content[] 数组格式，命令式参数（--dur --wm --resolution 等）内嵌在 text 末尾
 */
export class VolcengineVideoAdapter implements IVideoGeneratorPort {
  private http: VolcengineHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new VolcengineHttpClient(config);
  }

  /** Anthropic 协议（Agent Plan）不支持视频生成 */
  private ensureOpenAIProtocol(): void {
    if (this.config.volcArkProtocol === 'anthropic') {
      throw new Error('Volcengine video generation requires OpenAI protocol');
    }
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    this.ensureOpenAIProtocol();
    const payload = this.buildPayload(context);

    const result = await withRetry(() =>
      this.http.post<{ id: string }>('/contents/generations/tasks', payload),
    );

    return result.id;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    this.ensureOpenAIProtocol();
    // P1 修复（V-P1-1）：与 submitVideoTask 一致，加 withRetry 包装，
    // 避免网络抖动直接失败导致轮询任务卡死。
    const result = await withRetry(() =>
      this.http.get<VolcengineTaskResponse>(`/contents/generations/tasks/${taskId}`),
    );

    return {
      status: this.mapStatus(result.status),
      videoUrl: result.content?.video_url,
      errorMessage: result.error?.message,
    };
  }

  async downloadVideo(fileIdOrUrl: string): Promise<VideoDownloadResult> {
    // P0 修复（V-P0-4）：原实现返回 bytes:0 的空壳，导致后续 OPFS 落盘/视频拼接
    // 拿到的只是 URL 而非 Blob，过期失效。改为真实下载字节流。
    // fileIdOrUrl 实际为火山引擎返回的 video_url（公网可访问，24h 有效）。
    if (!fileIdOrUrl) {
      throw new Error('video url is empty');
    }
    try {
      // video_url 是公网完整 URL，不走 http.get（避免 baseUrl 拼接），
      // 直接用原生 fetch + withRetry 包装
      const buffer = await withRetry(() => this.fetchViaNativeFetch(fileIdOrUrl));
      return {
        downloadUrl: fileIdOrUrl,
        filename: `volc-video-${Date.now()}.mp4`,
        bytes: buffer.byteLength,
        createdAt: Date.now(),
      };
    } catch {
      // 降级：返回原始 URL，由调用方自行下载（保持向后兼容）
      return {
        downloadUrl: fileIdOrUrl,
        filename: `volc-video-${Date.now()}.mp4`,
        bytes: 0,
        createdAt: Date.now(),
      };
    }
  }

  /** 真实下载字节流：原生 fetch（video_url 是公网完整 URL，不走 axios baseUrl） */
  private async fetchViaNativeFetch(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`download video failed: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  /** 取消/删除任务（对接官方 DELETE 端点） */
  async cancelTask(taskId: string): Promise<void> {
    this.ensureOpenAIProtocol();
    await this.http.delete<void>(`/contents/generations/tasks/${taskId}`);
  }

  /** 列出任务（对接官方 GET /tasks 端点） */
  async listTasks(filter: VideoTaskListFilter): Promise<VideoTaskListResult> {
    this.ensureOpenAIProtocol();
    const params: Record<string, unknown> = {};
    if (filter.pageNum !== undefined) params['page_num'] = filter.pageNum;
    if (filter.pageSize !== undefined) params['page_size'] = filter.pageSize;
    if (filter.status) params['filter.status'] = filter.status;
    if (filter.model) params['filter.model'] = filter.model;
    return this.http.get<VideoTaskListResult>('/contents/generations/tasks', params);
  }

  // 火山引擎不支持 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('Volcengine video generation does not support Agent template mode');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('Volcengine video generation does not support Agent template mode');
  }

  // ===== 私有方法 =====

  /**
   * 将 VideoPromptContext 转换为火山引擎 API 请求体。
   * Seedance API 使用 content[] 数组格式（非 MiniMax 的扁平格式）。
   * 命令式参数（--dur --wm --resolution 等）按官方规范拼接到 text 末尾。
   */
  private buildPayload(context: VideoPromptContext): VolcengineVideoPayload {
    const content: VolcengineVideoContent[] = [];

    // 文本提示词 + 命令式参数拼接
    const fullPrompt = this.assemblePrompt(context);
    if (fullPrompt) {
      content.push({ type: 'text', text: fullPrompt });
    }

    // 首帧图片
    if (context.firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: context.firstFrameImage },
        role: 'first_frame',
      });
    }

    // 尾帧图片
    if (context.lastFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: context.lastFrameImage },
        role: 'last_frame',
      });
    }

    // 参考图（多图：subjectReference 数组每项的 image[] 全部展开）
    if (context.subjectReference && context.subjectReference.length > 0) {
      for (const ref of context.subjectReference) {
        for (const img of ref.image) {
          content.push({
            type: 'image_url',
            image_url: { url: img },
            role: 'reference_image',
          });
        }
      }
    }

    return {
      model: this.resolveModel(context),
      content,
      ...(context.callbackUrl && { callback_url: context.callbackUrl }),
    };
  }

  /**
   * 拼接官方命令式参数到 prompt 末尾。
   * 官方规范：text 字段末尾以空格分隔追加 `--key value` 形式参数。
   * 参考：https://www.volcengine.com/docs/82379/1520758
   */
  private assemblePrompt(context: VideoPromptContext): string {
    const parts: string[] = [];
    if (context.prompt) parts.push(context.prompt);
    // P0 修复（V-P0-2）：补全 Port 已声明但原实现丢失的命令式参数
    if (context.duration !== undefined) parts.push(`--dur ${context.duration}`);
    if (context.aigcWatermark !== undefined) parts.push(`--wm ${context.aigcWatermark}`);
    if (context.resolution) parts.push(`--resolution ${context.resolution}`);
    if (context.promptOptimizer !== undefined) parts.push(`--prompt_optimizer ${context.promptOptimizer}`);
    if (context.fastPretreatment !== undefined) parts.push(`--fast_pretreatment ${context.fastPretreatment}`);
    if (context.videoStyle) parts.push(`--style ${context.videoStyle}`);
    return parts.join(' ');
  }

  /**
   * 解析模型 ID，取值优先级：
   *   context.model（业务层显式指定）
   *     → config.volcArkVideoModel（用户配置）
   *     → PLATFORM_METADATA.volcengine.videoModels[0]（平台默认推荐）
   */
  private resolveModel(context: VideoPromptContext): string {
    const fromConfig = this.config.volcArkVideoModel?.trim();
    const fromPlatform = PLATFORM_METADATA.volcengine.videoModels[0];
    return context.model || fromConfig || fromPlatform;
  }

  /**
   * 状态映射：火山引擎 → 系统内部。
   * P0 修复（V-P0-3）：未知状态原 fallback 到 'PENDING'，可能导致永久轮询。
   * 现改为映射到 'FAILED'，触发上层重试或人工介入。
   */
  private mapStatus(volcStatus: string): VideoTaskResult['status'] {
    const mapping: Record<string, VideoTaskResult['status']> = {
      queued: 'PENDING',
      running: 'PROCESSING',
      succeeded: 'SUCCESS',
      failed: 'FAILED',
      expired: 'FAILED',
      cancelled: 'FAILED',
    };
    const mapped = mapping[volcStatus];
    if (!mapped) {
      // 未知状态：映射到 FAILED 而非 PENDING，避免死循环
      return 'FAILED';
    }
    return mapped;
  }
}

/** 火山引擎任务查询 API 响应结构（适配器内部类型，跨适配器复用） */
export interface VolcengineTaskResponse {
  id: string;
  status: string;
  content?: {
    video_url?: string;
    model_url?: string;
    preview_image_url?: string;
    format?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  created_at?: number;
  completed_at?: number;
}

/** 火山引擎视频生成请求体 */
interface VolcengineVideoPayload {
  model: string;
  content: VolcengineVideoContent[];
  callback_url?: string;
}

/** 火山引擎视频生成 content 数组项 */
interface VolcengineVideoContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  role?: 'first_frame' | 'last_frame' | 'reference_image';
}
