import type {
  IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult,
  VideoAgentContext, VideoAgentTaskResult,
} from '../../../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { HunyuanHttpClient } from './HunyuanHttpClient';
import { withRetry } from './HunyuanErrorUtils';

/**
 * 腾讯混元 Hunyuan 视频生成适配器。
 *
 * 接口（腾讯云 Action 模式）：
 *   - 提交：Action=SubmitHunyuanToVideoJob
 *     Body: { Prompt, Model, Image? }
 *     Model: hunyuan-video (T2V) / hunyuan-video-i2v (I2V)
 *   - 查询：Action=QueryHunyuanVideoJob
 *     Body: { JobId }
 *     JobStatus: SUBMITTED / PROCESSING / SUCCESS / FAILED
 *
 * 不支持 Agent 模板 → createAgentTask / queryAgentTask 抛 NotImplementedError。
 */
export class HunyuanVideoAdapter implements IVideoGeneratorPort {
  private http: HunyuanHttpClient;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.http = new HunyuanHttpClient(config);
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    if (!this.config.hunyuanSecretId || !this.config.hunyuanSecretKey) {
      throw new Error('请先在设置中配置腾讯混元的 SecretId 和 SecretKey');
    }

    const isI2v = !!context.firstFrameImage;
    const model = context.model || (isI2v ? 'hunyuan-video-i2v' : 'hunyuan-video');

    const payload: Record<string, unknown> = {
      Prompt: context.prompt,
      Model: model,
    };
    if (isI2v && context.firstFrameImage) {
      payload.Image = context.firstFrameImage;
    }

    const result = await withRetry(() =>
      this.http.call<HunyuanSubmitResponse>('SubmitHunyuanToVideoJob', payload),
    );

    const jobId = result?.Response?.JobId;
    if (!jobId) {
      throw new Error('混元 API 未返回任务 ID');
    }
    return jobId;
  }

  async queryTaskStatus(taskId: string): Promise<VideoTaskResult> {
    if (!this.config.hunyuanSecretId || !this.config.hunyuanSecretKey) {
      throw new Error('请先在设置中配置腾讯混元的 SecretId 和 SecretKey');
    }

    const result = await this.http.call<HunyuanQueryResponse>('QueryHunyuanVideoJob', { JobId: taskId });
    const resp = result?.Response;
    if (!resp) return { status: 'PROCESSING' };

    const status = this.mapStatus(resp.JobStatus);

    if (status === 'SUCCESS') {
      return {
        status: 'SUCCESS',
        videoUrl: resp.ResultVideoUrl,
        fileId: resp.JobId,
      };
    }
    if (status === 'FAILED') {
      return {
        status: 'FAILED',
        errorMessage: resp.ErrorMessage || '混元视频生成失败',
      };
    }
    return { status: 'PROCESSING' };
  }

  async downloadVideo(url: string): Promise<VideoDownloadResult> {
    return {
      downloadUrl: url,
      filename: `hunyuan-video-${Date.now()}.mp4`,
      bytes: 0,
      createdAt: Date.now(),
    };
  }

  // 混元无 Agent 模板模式
  async createAgentTask(_context: VideoAgentContext): Promise<string> {
    throw new Error('混元视频生成不支持 Agent 模板模式');
  }

  async queryAgentTask(_taskId: string): Promise<VideoAgentTaskResult> {
    throw new Error('混元视频生成不支持 Agent 模板模式');
  }

  // ===== 私有方法 =====

  private mapStatus(jobStatus?: string): 'SUCCESS' | 'PROCESSING' | 'FAILED' {
    switch ((jobStatus || '').toUpperCase()) {
      case 'SUCCESS':
      case 'SUCCEED':
        return 'SUCCESS';
      case 'FAILED':
      case 'FAIL':
        return 'FAILED';
      case 'PROCESSING':
      case 'PENDING':
      case 'SUBMITTED':
      case 'QUEUE':
      default:
        return 'PROCESSING';
    }
  }
}

interface HunyuanSubmitResponse {
  Response: {
    JobId: string;
    RequestId?: string;
  };
}

interface HunyuanQueryResponse {
  Response: {
    JobId: string;
    JobStatus?: string;
    ResultVideoUrl?: string;
    ErrorMessage?: string;
    RequestId?: string;
  };
}
