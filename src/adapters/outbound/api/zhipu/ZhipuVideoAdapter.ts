import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult,
  VideoAgentContext, VideoAgentTaskResult, VideoSubjectReference,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { ZhipuHttpClient } from './ZhipuHttpClient';
import { withRetry } from './ZhipuErrorUtils';

/**
 * 智谱视频生成适配器。
 *
 * 统一入口：POST /videos/generations
 *   - T2V：model=cogvideox-2 / cogvideox-flash，仅需 prompt
 *   - I2V：model=vidu2-image，需 image_url(string)
 *   - 首尾帧：model=vidu2-start-end，需 image_url(string[])（2 张）
 *   - 参考生：model=vidu2-reference，需 image_url(string[])（1-3 张）
 *
 * 查询：GET /videos/generations/{id}
 *   - task_status: SUCCESS / PROCESSING / FAIL
 *
 * 注意：智谱无 Agent 模板概念，createAgentTask / queryAgentTask 抛 NotImplementedError。
 */
export class ZhipuVideoAdapter implements IVideoGeneratorPort {
  private http: ZhipuHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new ZhipuHttpClient(config);
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    if (!this.config.zhipuApiKey) {
      throw new Error('请先在设置中配置智谱 AI 的 API Key');
    }

    const payload = this.buildPayload(context);
    const result = await withRetry(() =>
      this.http.post<{ id: string; task_status?: string }>('/videos/generations', payload),
    );
    if (!result?.id) {
      throw new Error('智谱 API 未返回任务 ID');
    }
    return result.id;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    if (!this.config.zhipuApiKey) {
      throw new Error('请先在设置中配置智谱 AI 的 API Key');
    }

    const result = await this.http.get<ZhipuVideoTaskResponse>(`/videos/generations/${taskId}`);
    const status = this.mapStatus(result.task_status);

    if (status === 'SUCCESS') {
      const videoResult = result.video_result?.[0];
      return {
        status: 'SUCCESS',
        videoUrl: videoResult?.url,
        fileId: videoResult?.id,
        videoWidth: videoResult?.width,
        videoHeight: videoResult?.height,
      };
    }
    if (status === 'FAILED') {
      return { status: 'FAILED', errorMessage: result.task_failure_reason || '视频生成失败' };
    }
    return { status: 'PROCESSING' };
  }

  async downloadVideo(url: string): Promise<VideoDownloadResult> {
    // 智谱返回的是直接 video_url，无需额外下载接口
    return {
      downloadUrl: url,
      filename: `zhipu-video-${Date.now()}.mp4`,
      bytes: 0,
      createdAt: Date.now(),
    };
  }

  // 智谱无 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('智谱视频生成不支持 Agent 模板模式');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('智谱视频生成不支持 Agent 模板模式');
  }

  // ===== 私有方法 =====

  private buildPayload(context: VideoPromptContext): Record<string, unknown> {
    const mode = context.mode || this.inferMode(context);
    const model = context.model || this.getDefaultModel(mode, context);

    const payload: Record<string, unknown> = {
      model,
      prompt: context.prompt,
    };

    // 时长（智谱支持 4/8s）
    if (context.duration) {
      payload.duration = context.duration === 6 ? 4 : context.duration === 10 ? 8 : context.duration;
    } else {
      payload.duration = 4;
    }

    // 尺寸
    if (context.resolution) {
      payload.size = this.mapResolutionToSize(context.resolution);
    } else {
      payload.size = '1280x720';
    }

    // 镜头运动幅度
    payload.movement_amplitude = 'auto';

    // 音频（部分模型支持）
    payload.with_audio = true;

    // 图片输入处理（I2V / 首尾帧 / 参考生）
    if (mode === 'i2v' && context.firstFrameImage) {
      payload.image_url = context.firstFrameImage;
    } else if (mode === 'fl2v') {
      const urls: string[] = [];
      if (context.firstFrameImage) urls.push(context.firstFrameImage);
      if (context.lastFrameImage) urls.push(context.lastFrameImage);
      if (urls.length > 0) payload.image_url = urls;
    } else if (mode === 's2v' && context.subjectReference) {
      const urls = context.subjectReference.flatMap((r: VideoSubjectReference) => r.image || []);
      if (urls.length > 0) payload.image_url = urls;
    }

    return payload;
  }

  private inferMode(context: VideoPromptContext): 't2v' | 'i2v' | 'fl2v' | 's2v' {
    if (context.subjectReference && context.subjectReference.length > 0) return 's2v';
    if (context.firstFrameImage && context.lastFrameImage) return 'fl2v';
    if (context.firstFrameImage) return 'i2v';
    return 't2v';
  }

  private getDefaultModel(mode: 't2v' | 'i2v' | 'fl2v' | 's2v', context: VideoPromptContext): string {
    // 若用户传入的 model 已指定，优先使用
    if (context.model) return context.model;
    switch (mode) {
      case 'i2v': return 'vidu2-image';
      case 'fl2v': return 'vidu2-start-end';
      case 's2v': return 'vidu2-reference';
      case 't2v':
      default: return 'cogvideox-2';
    }
  }

  private mapResolutionToSize(resolution: string): string {
    const map: Record<string, string> = {
      '512P': '896x512',
      '720P': '1280x720',
      '768P': '1024x768',
      '1080P': '1920x1080',
    };
    return map[resolution] || '1280x720';
  }

  private mapStatus(taskStatus: string): 'SUCCESS' | 'PROCESSING' | 'FAILED' {
    switch (taskStatus) {
      case 'SUCCESS': return 'SUCCESS';
      case 'FAIL':
      case 'FAILED': return 'FAILED';
      case 'PROCESSING':
      case 'PENDING':
      default: return 'PROCESSING';
    }
  }
}

/** 智谱视频任务查询响应 */
interface ZhipuVideoTaskResponse {
  id: string;
  model: string;
  task_status: string;
  task_failure_reason?: string;
  video_result?: Array<{
    id: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
  }>;
}
