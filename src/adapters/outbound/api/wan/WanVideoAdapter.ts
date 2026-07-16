import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult,
  VideoAgentContext, VideoAgentTaskResult, VideoSubjectReference,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { WanHttpClient } from './WanHttpClient';
import { withRetry } from './WanErrorUtils';

/**
 * 通义万相视频生成适配器（DashScope）。
 *
 * 接口映射：
 *   submitVideoTask → POST /services/aigc/video-generation/video-synthesis
 *                     Header: X-DashScope-Async: enable
 *                     返回 output.task_id
 *   queryTaskStatus → GET  /tasks/{task_id}
 *                     返回 output.task_status / output.video_url
 *   downloadVideo   → 从 queryTask 结果提取 video_url
 *
 * 模型：
 *   - wanx2.1-t2v-turbo / wanx2.1-t2v-plus（T2V）
 *   - wanx2.1-i2v-turbo / wanx2.1-i2v-plus（I2V）
 *   - wanx2.1-vace（首尾帧/参考生）
 */
export class WanVideoAdapter implements IVideoGeneratorPort {
  private http: WanHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new WanHttpClient(config);
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    if (!this.config.wanApiKey) {
      throw new Error('请先在设置中配置通义万相的 API Key');
    }

    const payload = this.buildPayload(context);
    const result = await withRetry(() =>
      this.http.post<WanAsyncCreateResponse>(
        '/services/aigc/video-generation/video-synthesis',
        payload,
        { headers: { 'X-DashScope-Async': 'enable' } },
      ),
    );
    const taskId = result?.output?.task_id;
    if (!taskId) {
      throw new Error('通义万相 API 未返回任务 ID');
    }
    return taskId;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    if (!this.config.wanApiKey) {
      throw new Error('请先在设置中配置通义万相的 API Key');
    }

    const result = await this.http.get<WanTaskResponse>(`/tasks/${taskId}`);
    const status = result?.output?.task_status ?? '';

    if (status === 'SUCCEEDED') {
      const videoUrl = result.output?.video_url;
      return { status: 'SUCCESS', videoUrl, fileId: taskId };
    }
    if (status === 'FAILED') {
      return { status: 'FAILED', errorMessage: result.output?.message || '通义万相视频生成失败' };
    }
    return { status: 'PROCESSING' };
  }

  async downloadVideo(url: string): Promise<VideoDownloadResult> {
    // 万相返回的是直接 video_url，无需额外下载接口
    return {
      downloadUrl: url,
      filename: `wan-video-${Date.now()}.mp4`,
      bytes: 0,
      createdAt: Date.now(),
    };
  }

  // 万相不支持 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('通义万相视频生成不支持 Agent 模板模式');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('通义万相视频生成不支持 Agent 模板模式');
  }

  // ===== 私有方法 =====

  private buildPayload(context: VideoPromptContext): Record<string, unknown> {
    const mode = context.mode || this.inferMode(context);
    const model = context.model || this.getDefaultModel(mode);

    const input: Record<string, unknown> = {
      prompt: context.prompt,
    };

    // 图片输入
    if (mode === 'i2v' && context.firstFrameImage) {
      input.img_url = context.firstFrameImage;
    } else if (mode === 'fl2v') {
      if (context.firstFrameImage) input.first_frame = context.firstFrameImage;
      if (context.lastFrameImage) input.last_frame = context.lastFrameImage;
    } else if (mode === 's2v' && context.subjectReference) {
      const urls = context.subjectReference.flatMap((r: VideoSubjectReference) => r.image || []);
      if (urls.length > 0) input.reference = urls;
    }

    const parameters: Record<string, unknown> = {};
    if (context.resolution) {
      parameters.size = this.mapResolutionToSize(context.resolution);
    } else {
      parameters.size = '1280*720';
    }
    if (context.duration) {
      parameters.duration = context.duration;
    }

    return { model, input, parameters };
  }

  private inferMode(context: VideoPromptContext): 't2v' | 'i2v' | 'fl2v' | 's2v' {
    if (context.subjectReference && context.subjectReference.length > 0) return 's2v';
    if (context.firstFrameImage && context.lastFrameImage) return 'fl2v';
    if (context.firstFrameImage) return 'i2v';
    return 't2v';
  }

  private getDefaultModel(mode: 't2v' | 'i2v' | 'fl2v' | 's2v'): string {
    switch (mode) {
      case 'i2v': return 'wanx2.1-i2v-turbo';
      case 'fl2v':
      case 's2v': return 'wanx2.1-vace';
      case 't2v':
      default: return 'wanx2.1-t2v-turbo';
    }
  }

  private mapResolutionToSize(resolution: string): string {
    const map: Record<string, string> = {
      '512P': '832*480',
      '720P': '1280*720',
      '768P': '1024*768',
      '1080P': '1920*1080',
    };
    return map[resolution] || '1280*720';
  }
}

interface WanAsyncCreateResponse {
  output?: { task_id: string };
  request_id?: string;
}

interface WanTaskResponse {
  output?: {
    task_id: string;
    task_status: string;
    video_url?: string;
    message?: string;
  };
  request_id?: string;
}
