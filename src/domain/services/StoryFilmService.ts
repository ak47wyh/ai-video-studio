import type { VideoStyle } from '../entities/models';
import type { PipelineOptions, PipelineStatus } from './PipelineService';
import type { ILoggerPort, LogContext } from '../ports/CrossCuttingPorts';
import type { StoryService } from './StoryService';
import { TextGenerationService } from './TextGenerationService';
import type { PipelineService } from './PipelineService';

/** AI 故事成片选项 */
export interface StoryFilmOptions {
  /** 直接提供的故事文本（与 theme 二选一） */
  storyText?: string;
  /** 故事主题（与 storyText 二选一，由 AI 生成故事） */
  theme?: string;
  /** 主题的关键要点提示 */
  keyPoints?: string[];
  /** 画面风格预设 */
  videoStyle: VideoStyle;
  /** 角色旁白音色 ID */
  voiceId?: string;
  /** 画面宽高比 */
  aspectRatio?: '16:9' | '9:16';
  /** 视频时长（秒） */
  videoDuration?: 6 | 10;
  /** 是否包含 BGM（默认 true） */
  includeBGM?: boolean;
  /** 是否包含字幕（默认 true） */
  includeSubtitles?: boolean;
  /** 工作空间 ID */
  spaceId: string;
  /** 故事标题（不提供时由主题或文本自动生成） */
  title?: string;
  /** 进度回调 */
  onProgress?: (stage: PipelineStatus, percent: number, message: string) => void;
}

/** AI 故事成片结果 */
export interface StoryFilmResult {
  storyId: string;
  pipelineTaskId: string;
}

/**
 * StoryFilmService —— AI 故事成片编排服务
 *
 * 职责：端到端编排"主题/文本 → 故事 → 成片"的一键流程。
 *
 * 依赖项：
 * - TextGenerationService：故事文本生成（theme → storyText）
 * - PipelineService：全流程管线执行（拆分 → 图片 → 音频 → 视频 → 后期）
 * - StoryService：故事实体创建与管理
 * - ILoggerPort：结构化日志
 *
 * 关键设计决策：
 * - storyText 与 theme 二选一：storyText 直接使用，theme 经 AI 生成故事文本
 * - videoStyle 注入到 PipelineOptions 扩展字段，供图片/视频 prompt 追加风格后缀
 * - 业务校验失败抛 Error('English short sentence')，面向用户文案交 UI 层 i18n
 */
export class StoryFilmService {
  private textGenerationService: TextGenerationService;
  private pipelineService: PipelineService;
  private storyService: StoryService;
  private logger: ILoggerPort;

  constructor(
    textGenerationService: TextGenerationService,
    pipelineService: PipelineService,
    storyService: StoryService,
    logger: ILoggerPort,
  ) {
    this.textGenerationService = textGenerationService;
    this.pipelineService = pipelineService;
    this.storyService = storyService;
    this.logger = logger;
  }

  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'StoryFilmService', ...extra };
  }

  /**
   * 一键故事成片：从主题或文本生成完整视频
   *
   * 流程：生成故事文本 → 创建 Story → 启动 Pipeline → 返回任务 ID
   */
  async createStoryFilm(options: StoryFilmOptions): Promise<StoryFilmResult> {
    if (!options.storyText && !options.theme) {
      throw new Error('Either storyText or theme must be provided');
    }

    // 1. 确定故事文本
    let storyText: string;
    if (options.storyText) {
      storyText = options.storyText;
      this.logger.info('using provided story text', this.ctx({ method: 'createStoryFilm' }));
    } else {
      this.logger.info('generating story text from theme', this.ctx({
        method: 'createStoryFilm',
        theme: options.theme,
      }));
      storyText = await this.generateStoryText(
        options.theme!,
        options.keyPoints ?? [],
      );
    }

    // 2. 创建 Story
    const title = options.title ?? options.theme ?? storyText.slice(0, 50);
    const story = await this.storyService.createStory(
      options.spaceId,
      title,
      storyText,
    );
    this.logger.info('story created', this.ctx({
      method: 'createStoryFilm',
      storyId: story.id,
      spaceId: options.spaceId,
    }));

    // 3. 构建 PipelineOptions 并注入 videoStyle
    const pipelineOptions: PipelineOptions & { videoStyle?: VideoStyle } = {
      videoDuration: options.videoDuration,
      includeBGM: options.includeBGM ?? true,
      includeSubtitles: options.includeSubtitles ?? true,
      videoStyle: options.videoStyle,
      onProgress: options.onProgress,
    };

    // 4. 启动 Pipeline
    const pipelineTask = await this.pipelineService.runFullPipeline(
      story.id,
      pipelineOptions,
    );
    this.logger.info('pipeline started', this.ctx({
      method: 'createStoryFilm',
      storyId: story.id,
      pipelineTaskId: pipelineTask.id,
    }));

    return {
      storyId: story.id,
      pipelineTaskId: pipelineTask.id,
    };
  }

  /**
   * 根据主题和关键要点生成故事文本
   *
   * 使用 TextGenerationService.refinePrompt() 配合故事生成 prompt
   */
  async generateStoryText(theme: string, keyPoints: string[]): Promise<string> {
    this.logger.info('generating story text', this.ctx({
      method: 'generateStoryText',
      theme,
      keyPointCount: keyPoints.length,
    }));

    const keyPointsText = keyPoints.length > 0
      ? `\n\n关键要点：\n${keyPoints.map(p => `- ${p}`).join('\n')}`
      : '';

    const rawPrompt = `主题：${theme}${keyPointsText}`;

    const result = await this.textGenerationService.refinePrompt(
      rawPrompt,
      'character_appearance',
    );

    if (!result.content) {
      throw new Error('Story text generation returned empty result');
    }

    this.logger.info('story text generated', this.ctx({
      method: 'generateStoryText',
      theme,
      textLength: result.content.length,
    }));

    return result.content;
  }
}
