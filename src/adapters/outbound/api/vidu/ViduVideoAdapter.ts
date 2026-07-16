import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult,
  VideoAgentContext, VideoAgentTaskResult, VideoSubjectReference,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { ViduHttpClient } from './ViduHttpClient';
import { withRetry } from './ViduErrorUtils';

/**
 * Vidu 视频生成适配器（生数科技）。
 *
 * 接口映射：
 *   submitVideoTask → POST /v1/video/generations（返回 task_id）
 *   queryTaskStatus → GET  /v1/videos/{id}
 *   downloadVideo   → 从 queryTask 结果提取 video_url
 *
 * 支持四种生成模式：
 *   - text：纯文本生视频（viduq1 / vidu-1 / vidu-2）
 *   - image：图生视频（首帧）
 *   - start_end_frame：首尾帧
 *   - reference：参考生
 *
 * Vidu 仅支持视频生成，不支持 Agent 模板。
 */
export class ViduVideoAdapter implements IVideoGeneratorPort {
  private http: ViduHttpClient;
  private readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.http = new ViduHttpClient(config);
    this.config = config;
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    if (!this.config.viduApiKey) {
      throw new Error('请先在设置中配置 Vidu 生数科技的 API Key');
    }

    const payload = this.buildPayload(context);
    const result = await withRetry(() =>
      this.http.post<ViduCreateResponse>('/v1/video/generations', payload),
    );
    if (!result?.id) {
      throw new Error('Vidu API 未返回任务 ID');
    }
    return result.id;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    if (!this.config.viduApiKey) {
      throw new Error('请先在设置中配置 Vidu 生数科技的 API Key');
    }

    const result = await this.http.get<ViduTaskResponse>(`/v1/videos/${taskId}`);
    const state = result.state || result.status || '';

    if (state === 'success' || state === 'SUCCESS' || state === 'completed') {
      const videoUrl = result.video_url || result.video?.[0]?.url;
      return {
        status: 'SUCCESS',
        videoUrl,
        fileId: result.id,
      };
    }
    if (state === 'failed' || state === 'FAIL' || state === 'error') {
      return { status: 'FAILED', errorMessage: result.err_msg || 'Vidu 视频生成失败' };
    }
    return { status: 'PROCESSING' };
  }

  async downloadVideo(url: string): Promise<VideoDownloadResult> {
    // Vidu 返回的是直接 video_url，无需额外下载接口
    return {
      downloadUrl: url,
      filename: `vidu-video-${Date.now()}.mp4`,
      bytes: 0,
      createdAt: Date.now(),
    };
  }

  // Vidu 不支持 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('Vidu 视频生成不支持 Agent 模板模式');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('Vidu 视频生成不支持 Agent 模板模式');
  }

  // ===== 私有方法 =====

  private buildPayload(context: VideoPromptContext): Record<string, unknown> {
    const mode = context.mode || this.inferMode(context);
    const model = context.model || 'viduq1';

    // Vidu 使用 input.type 描述生成模式
    const typeMap: Record<string, string> = {
      't2v': 'text',
      'i2v': 'image',
      'fl2v': 'start_end_frame',
      's2v': 'reference',
    };

    const input: Record<string, unknown> = {
      type: typeMap[mode] || 'text',
      prompt: context.prompt,
    };

    // 图片输入
    if (mode === 'i2v' && context.firstFrameImage) {
      input.image = context.firstFrameImage;
    } else if (mode === 'fl2v') {
      const images: string[] = [];
      if (context.firstFrameImage) images.push(context.firstFrameImage);
      if (context.lastFrameImage) images.push(context.lastFrameImage);
      if (images.length > 0) input.image = images;
    } else if (mode === 's2v' && context.subjectReference) {
      const images = context.subjectReference.flatMap((r: VideoSubjectReference) => r.image || []);
      if (images.length > 0) input.image = images;
    }

    const payload: Record<string, unknown> = {
      model,
      input,
    };

    // 时长（Vidu 支持 4/8s）
    if (context.duration) {
      payload.duration = context.duration === 6 ? 4 : context.duration === 10 ? 8 : context.duration;
    } else {
      payload.duration = 4;
    }

    // 分辨率
    if (context.resolution) {
      payload.resolution = this.mapResolution(context.resolution);
    } else {
      payload.resolution = '720p';
    }

    // 镜头运动幅度
    payload.movement_amplitude = 'auto';

    return payload;
  }

  private inferMode(context: VideoPromptContext): 't2v' | 'i2v' | 'fl2v' | 's2v' {
    if (context.subjectReference && context.subjectReference.length > 0) return 's2v';
    if (context.firstFrameImage && context.lastFrameImage) return 'fl2v';
    if (context.firstFrameImage) return 'i2v';
    return 't2v';
  }

  private mapResolution(resolution: string): string {
    const map: Record<string, string> = {
      '512P': '360p',
      '720P': '720p',
      '768P': '720p',
      '1080P': '1080p',
    };
    return map[resolution] || '720p';
  }
}

interface ViduCreateResponse {
  id: string;
  state?: string;
}

interface ViduTaskResponse {
  id: string;
  state?: string;
  status?: string;
  video_url?: string;
  video?: Array<{ url: string }>;
  err_msg?: string;
}
