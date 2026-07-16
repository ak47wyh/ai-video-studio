import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult,
  VideoAgentContext, VideoAgentTaskResult, VideoSubjectReference,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { KlingHttpClient } from './KlingHttpClient';
import { withRetry } from './KlingErrorUtils';

/**
 * 可灵 Kling 视频生成适配器。
 *
 * 接口：
 *   - T2V 提交：POST /v1/videos/text2video
 *   - I2V / S2V 提交：POST /v1/videos/image2video
 *   - 查询：GET /v1/videos/text2video/{task_id} 或 GET /v1/videos/image2video/{task_id}
 *
 * 模型：kling-v2.1 / kling-v2-master / kling-v1.6
 * 参数：duration(5/10s)、aspect_ratio、negative_prompt、callback_url、external_task_id
 *
 * 模式判定：
 *   - subjectReference 非空 → S2V（image2video，传入多张参考图）
 *   - firstFrameImage 非空 → I2V（image2video）
 *   - 否则 → T2V（text2video）
 *
 * 可灵无 Agent 模板模式 → createAgentTask / queryAgentTask 抛 NotImplementedError。
 */
export class KlingVideoAdapter implements IVideoGeneratorPort {
  private http: KlingHttpClient;

  private config: ApiConfig;
  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new KlingHttpClient(config);
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    if (!this.config.klingAccessKey || !this.config.klingSecretKey) {
      throw new Error('请先在设置中配置可灵 Kling 的 AccessKey 和 SecretKey');
    }

    const mode = this.inferMode(context);
    const payload = this.buildPayload(context, mode);
    const endpoint = mode === 't2v' ? '/v1/videos/text2video' : '/v1/videos/image2video';

    const result = await withRetry(() =>
      this.http.post<KlingSubmitResponse>(endpoint, payload),
    );
    const taskId = result?.data?.task_id;
    if (!taskId) {
      throw new Error('可灵 API 未返回任务 ID');
    }
    return taskId;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    if (!this.config.klingAccessKey || !this.config.klingSecretKey) {
      throw new Error('请先在设置中配置可灵 Kling 的 AccessKey 和 SecretKey');
    }

    // 查询端点需与提交端点匹配；mock-task 之外的任务 id 优先用 text2video 查询
    // 实际使用中由调用方记录任务类型，这里用兼容方式：先尝试 text2video，再 fallback image2video
    let result: KlingQueryResponse;
    try {
      result = await this.http.get<KlingQueryResponse>(`/v1/videos/text2video/${taskId}`);
    } catch (err) {
      // 若 text2video 查询返回 404 / 任务不存在，尝试 image2video
      result = await this.http.get<KlingQueryResponse>(`/v1/videos/image2video/${taskId}`);
      void err;
    }

    const taskStatus = result?.data?.task_status;
    const status = this.mapStatus(taskStatus);

    if (status === 'SUCCESS') {
      const videos = result?.data?.task_result?.videos || [];
      const first = videos[0];
      return {
        status: 'SUCCESS',
        videoUrl: first?.url,
        fileId: first?.id,
        videoWidth: first?.width,
        videoHeight: first?.height,
      };
    }
    if (status === 'FAILED') {
      return {
        status: 'FAILED',
        errorMessage: result?.data?.task_failure_reason || '可灵视频生成失败',
      };
    }
    return { status: 'PROCESSING' };
  }

  async downloadVideo(url: string): Promise<VideoDownloadResult> {
    // 可灵返回的 video_url 为公网直链，无需额外下载接口
    return {
      downloadUrl: url,
      filename: `kling-video-${Date.now()}.mp4`,
      bytes: 0,
      createdAt: Date.now(),
    };
  }

  // 可灵无 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('可灵视频生成不支持 Agent 模板模式');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('可灵视频生成不支持 Agent 模板模式');
  }

  // ===== 私有方法 =====

  private inferMode(context: VideoPromptContext): 't2v' | 'i2v' | 's2v' {
    if (context.subjectReference && context.subjectReference.length > 0) return 's2v';
    if (context.firstFrameImage) return 'i2v';
    return 't2v';
  }

  private buildPayload(context: VideoPromptContext, mode: 't2v' | 'i2v' | 's2v'): Record<string, unknown> {
    const model = context.model || 'kling-v2.1';
    const payload: Record<string, unknown> = {
      model,
      prompt: context.prompt,
    };

    // 时长（可灵支持 5s / 10s）
    payload.duration = context.duration === 10 ? '10' : '5';

    // 宽高比
    payload.aspect_ratio = this.mapResolutionToAspectRatio(context.resolution);

    // 回调
    if (context.callbackUrl) payload.callback_url = context.callbackUrl;

    // I2V / S2V：图片输入
    if (mode === 'i2v' && context.firstFrameImage) {
      payload.image = context.firstFrameImage;
    } else if (mode === 's2v' && context.subjectReference) {
      // 参考生：取所有参考图的第一张作为 image，多张参考可使用 negative_prompt / 长尾字段
      const urls = context.subjectReference.flatMap((r: VideoSubjectReference) => r.image || []);
      if (urls.length > 0) payload.image = urls[0];
    }

    return payload;
  }

  /** 分辨率 → 可灵 aspect_ratio */
  private mapResolutionToAspectRatio(resolution?: string): string {
    const map: Record<string, string> = {
      '512P': '16:9',
      '720P': '16:9',
      '768P': '4:3',
      '1080P': '16:9',
    };
    return map[resolution || '720P'] || '16:9';
  }

  private mapStatus(taskStatus?: string): 'SUCCESS' | 'PROCESSING' | 'FAILED' {
    switch ((taskStatus || '').toUpperCase()) {
      case 'SUCCEED':
      case 'SUCCESS':
        return 'SUCCESS';
      case 'FAILED':
      case 'FAIL':
        return 'FAILED';
      case 'PROCESSING':
      case 'PENDING':
      case 'SUBMITTED':
      default:
        return 'PROCESSING';
    }
  }
}

/** 可灵任务提交响应 */
interface KlingSubmitResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: string;
  };
}

/** 可灵任务查询响应 */
interface KlingQueryResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: string;
    task_failure_reason?: string;
    task_result?: {
      videos: Array<{
        id: string;
        url: string;
        width?: number;
        height?: number;
        duration?: string;
      }>;
    };
  };
}
