import type { IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult, VideoAgentContext, VideoAgentTaskResult } from '../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../config/ApiConfigStore';
import { getMiniMaxErrorMessage } from './MiniMaxErrorUtils';
import axios from 'axios';

/**
 * Adapter for MiniMax Video Generation API.
 *
 * Supports 4 generation modes:
 *   - T2V (Text-to-Video): prompt-only, supports Hailuo-2.3/Hailuo-02/T2V-01-Director/T2V-01
 *   - I2V (Image-to-Video): first_frame_image + prompt, supports Hailuo-2.3/Hailuo-2.3-Fast/Hailuo-02/I2V-01-*
 *   - FL2V (First-Last-Frame): first_frame_image + last_frame_image, only Hailuo-02
 *   - S2V (Subject-Reference): subject_reference images, only S2V-01
 *
 * Also supports Video Agent (template-based generation, deprecated):
 *   - Create: POST /v1/video_template_generation
 *   - Query:  GET  /v1/query/video_template_generation
 *
 * API Endpoints:
 *   - Submit task: POST https://api.minimaxi.com/v1/video_generation
 *   - Query status: GET  https://api.minimaxi.com/v1/query/video_generation?task_id={id}
 *   - Download file: GET  https://api.minimaxi.com/v1/files/retrieve?file_id={id}
 *
 * Task statuses: Preparing → Queueing → Processing → Success / Fail
 */
export class MiniMaxVideoAdapter implements IVideoGeneratorPort {

  private readonly config: ApiConfig;
  private readonly logger?: ILoggerPort;

  constructor(config: ApiConfig, logger?: ILoggerPort) {
    this.config = config;
    this.logger = logger;
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'MiniMaxVideoAdapter', ...extra };
  }

  async submitVideoTask(context: VideoPromptContext): Promise<string> {
    const config = this.config;

    if (!config.minimaxApiKey) {
      throw new Error('请先在设置中配置 MiniMax 的 API Key');
    }

    // ── Build prompt from legacy fields if prompt not directly provided ─────
    const prompt = context.prompt || this.buildPrompt(context);

    // ── Determine mode and model ────────────────────────────────────────────
    const mode = context.mode || this.inferMode(context);
    const model = context.model || this.getDefaultModel(mode);

    // ── Build request payload ───────────────────────────────────────────────
    const payload: Record<string, unknown> = {
      model,
      prompt,
      prompt_optimizer: context.promptOptimizer !== undefined ? context.promptOptimizer : true,
    };

    // Mode-specific fields
    if (mode === 'i2v') {
      if (!context.firstFrameImage) {
        throw new Error('I2V mode requires firstFrameImage');
      }
      payload.first_frame_image = context.firstFrameImage;
    } else if (mode === 'fl2v') {
      if (!context.firstFrameImage) {
        throw new Error('FL2V mode requires firstFrameImage');
      }
      payload.first_frame_image = context.firstFrameImage;
      if (context.lastFrameImage) {
        payload.last_frame_image = context.lastFrameImage;
      }
    } else if (mode === 's2v') {
      if (!context.subjectReference || context.subjectReference.length === 0) {
        throw new Error('S2V mode requires subjectReference');
      }
      payload.subject_reference = context.subjectReference;
    }

    // Common optional fields
    if (context.fastPretreatment !== undefined && (
      model === 'MiniMax-Hailuo-2.3' || model === 'MiniMax-Hailuo-2.3-Fast' || model === 'MiniMax-Hailuo-02'
    )) {
      payload.fast_pretreatment = context.fastPretreatment;
    }
    if (context.duration) {
      payload.duration = context.duration;
    }
    if (context.resolution) {
      payload.resolution = context.resolution;
    }
    if (context.callbackUrl) {
      payload.callback_url = context.callbackUrl;
    }
    if (context.aigcWatermark !== undefined) {
      payload.aigc_watermark = context.aigcWatermark;
    }

    // Voice and BGM (T2V mode with Director model)
    if (context.characterVoiceIds && Object.keys(context.characterVoiceIds).length > 0) {
      payload.character_voice_ids = context.characterVoiceIds;
    }
    if (context.bgmAudioUrl) {
      payload.bgm_audio_url = context.bgmAudioUrl;
    }

    this.logger?.debug('Submitting video task', this.ctx({ mode: mode.toUpperCase(), model }));

    // ── Real API call ───────────────────────────────────────────────────────
    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const response = await axios.post(
      `${baseUrl}/video_generation`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${config.minimaxApiKey}`,
          'Content-Type': 'application/json',
        },
        params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
      }
    );

    const data = response.data;
    const statusCode = data?.base_resp?.status_code;
    const statusMsg = data?.base_resp?.status_msg || '';
    const error = getMiniMaxErrorMessage(statusCode, statusMsg);
    if (error) throw new Error(error);

    const taskId: string = data?.task_id;
    if (!taskId) {
      this.logger?.error('Video API returned no task_id', undefined, this.ctx({}));
      throw new Error('MiniMax API did not return a task_id. Please check your API Key and Group ID configuration.');
    }
    return taskId;
  }

  async queryTaskStatus(externalTaskId: string): Promise<VideoTaskResult> {
    const config = this.config;

    if (!config.minimaxApiKey) {
      throw new Error('请先在设置中配置 MiniMax 的 API Key');
    }

    // ── Real API call ───────────────────────────────────────────────────────
    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const response = await axios.get(
      `${baseUrl}/query/video_generation`,
      {
        params: {
          task_id: externalTaskId,
          ...(config.minimaxGroupId ? { group_id: config.minimaxGroupId } : {}),
        },
        headers: {
          Authorization: `Bearer ${config.minimaxApiKey}`,
        },
      }
    );

    const data = response.data;
    const status: string = data?.status ?? '';

    // Check for API-level errors
    const statusCode = data?.base_resp?.status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      if (statusCode === 1002) {
        return { status: 'PROCESSING' };
      }
      const statusMsg = data?.base_resp?.status_msg || `API error (code ${statusCode})`;
      return { status: 'FAILED', errorMessage: statusMsg };
    }

    if (status === 'Success') {
      const fileId = data?.file_id;
      const videoWidth = data?.video_width;
      const videoHeight = data?.video_height;
      // Use download API to get the actual download URL
      let videoUrl: string | undefined;
      if (fileId) {
        try {
          const downloadResult = await this.downloadVideo(String(fileId));
          videoUrl = downloadResult.downloadUrl;
        } catch {
          // Fallback: construct URL from file_id
          videoUrl = `${baseUrl}/files/${fileId}`;
        }
      }
      return { status: 'SUCCESS', videoUrl, fileId: fileId ? String(fileId) : undefined, videoWidth, videoHeight };
    }
    if (status === 'Fail') {
      const failMsg = data?.base_resp?.status_msg || 'Video generation failed';
      return { status: 'FAILED', errorMessage: failMsg };
    }
    // Preparing / Queueing / Processing → all map to PROCESSING
    return { status: 'PROCESSING' };
  }

  async downloadVideo(fileId: string): Promise<VideoDownloadResult> {
    const config = this.config;

    if (!config.minimaxApiKey) {
      throw new Error('API key is required to download videos');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const response = await axios.get(
      `${baseUrl}/files/retrieve`,
      {
        params: {
          file_id: fileId,
          ...(config.minimaxGroupId ? { group_id: config.minimaxGroupId } : {}),
        },
        headers: {
          Authorization: `Bearer ${config.minimaxApiKey}`,
        },
      }
    );

    const data = response.data;
    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg);
    if (error) throw new Error(error);

    const file = data?.file;
    if (!file?.download_url) {
      throw new Error('No download URL returned from file retrieval API');
    }

    return {
      downloadUrl: file.download_url,
      filename: file.filename || 'output_aigc.mp4',
      bytes: file.bytes || 0,
      createdAt: file.created_at || 0,
    };
  }

  async createAgentTask(context: VideoAgentContext): Promise<string> {
    const config = this.config;

    if (!config.minimaxApiKey) {
      throw new Error('请先在设置中配置 MiniMax 的 API Key');
    }

    const payload: Record<string, unknown> = {
      template_id: context.templateId,
    };
    if (context.textInputs?.length) payload.text_inputs = context.textInputs;
    if (context.mediaInputs?.length) payload.media_inputs = context.mediaInputs;
    if (context.callbackUrl) payload.callback_url = context.callbackUrl;

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const response = await axios.post(
      `${baseUrl}/video_template_generation`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${config.minimaxApiKey}`,
          'Content-Type': 'application/json',
        },
        params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
      }
    );

    const data = response.data;
    const error = getMiniMaxErrorMessage(data?.base_resp?.status_code, data?.base_resp?.status_msg);
    if (error) throw new Error(error);

    const taskId = data?.task_id;
    if (!taskId) throw new Error('Agent API did not return task_id');
    return taskId;
  }

  async queryAgentTask(taskId: string): Promise<VideoAgentTaskResult> {
    const config = this.config;

    if (!config.minimaxApiKey) {
      throw new Error('请先在设置中配置 MiniMax 的 API Key');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const response = await axios.get(
      `${baseUrl}/query/video_template_generation`,
      {
        params: {
          task_id: taskId,
          ...(config.minimaxGroupId ? { group_id: config.minimaxGroupId } : {}),
        },
        headers: { Authorization: `Bearer ${config.minimaxApiKey}` },
      }
    );

    const data = response.data;
    const status: string = data?.status ?? '';

    if (status === 'Success') {
      return { status: 'Success', videoUrl: data?.video_url };
    }
    if (status === 'Fail') {
      return { status: 'Fail', errorMessage: data?.base_resp?.status_msg || 'Agent task failed' };
    }
    return { status: 'Processing' };
  }

  /**
   * Build prompt from legacy context fields (characters, background, actionContent).
   */
  private buildPrompt(context: VideoPromptContext): string {
    const parts: string[] = [];

    if (context.characters && context.characters.length > 0) {
      const charDescs = context.characters.map(c => {
        let desc = c.appearancePrompt;
        if (c.personalityPrompt) desc += `, ${c.personalityPrompt}`;
        return desc;
      });
      parts.push(charDescs.join(' and '));
    }
    if (context.background) {
      parts.push(`in ${context.background.environmentPrompt}`);
    }
    if (context.actionContent) {
      parts.push(context.actionContent);
    }

    return parts.join(', ') + '.';
  }

  /**
   * Infer generation mode from context fields.
   */
  private inferMode(context: VideoPromptContext): 't2v' | 'i2v' | 'fl2v' | 's2v' {
    if (context.subjectReference && context.subjectReference.length > 0) return 's2v';
    if (context.firstFrameImage && context.lastFrameImage) return 'fl2v';
    if (context.firstFrameImage) return 'i2v';
    return 't2v';
  }

  /**
   * Get default model for a given mode.
   */
  private getDefaultModel(mode: 't2v' | 'i2v' | 'fl2v' | 's2v'): string {
    switch (mode) {
      case 'i2v': return 'I2V-01';
      case 'fl2v': return 'MiniMax-Hailuo-02';
      case 's2v': return 'S2V-01';
      case 't2v':
      default: return 'MiniMax-Hailuo-2.3';
    }
  }
}
