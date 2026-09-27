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
  /** S-1 故事文本生成失败时是否降级到模板（默认 true；false 时抛错给 UI） */
  fallbackToTemplate?: boolean;
}

/** AI 故事成片结果 */
export interface StoryFilmResult {
  storyId: string;
  pipelineTaskId: string;
  /** S-1 文本生成失败时是否使用了模板故事降级 */
  usedTemplate?: boolean;
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
/** S-1 模板故事库：文本生成不可用时降级（关键词命中或通用模板） */
const TEMPLATE_STORIES: ReadonlyArray<{ keyword: string; theme: string; text: string }> = [
  {
    keyword: '冒险',
    theme: '冒险',
    text: '少年林澈收到一封来自祖父的旧信，信中提到群山深处藏着一座失落的观星台。他与好友小雨踏上旅程，穿越迷雾峡谷、渡过月光河，在一次次考验中解开家族守护的星图秘密，最终点亮了沉睡百年的观星台，也找到了属于自己的勇气与方向。',
  },
  {
    keyword: '科幻',
    theme: '科幻',
    text: '公元 2147 年，地球进入数字黎明时代。研究员苏晓在维护旧档案库时，发现了一段被遗忘的信号。她追查信号源，穿越星际门户抵达废弃空间站，在 AI 伙伴的协助下还原了十年前那场实验的真相，并亲手按下重启星门的开关，让人类文明与远方殖民地重新相连。',
  },
  {
    keyword: '悬疑',
    theme: '悬疑',
    text: '深夜的图书馆里，管理员陈默发现一本会自己翻页的旧书。每一次翻页，书页上都会浮现出明天才会发生的场景。为了弄清真相，他跟踪书中的线索，揭开三十年前一场火灾的尘封往事，最终发现守护秘密的人正是自己早已过世的祖父。',
  },
  {
    keyword: '爱情',
    theme: '爱情',
    text: '雨天，旧书店的橱窗前，女孩阿夏捡到一本夹着车票的日记。她循着日记里的足迹走过城市的每一条街道，遇见那位总在同一家咖啡馆写字的男生。当最后一张车票被归还时，两段错过的青春在雨后的黄昏重新交汇。',
  },
  {
    keyword: '日常',
    theme: '日常',
    text: '巷口早餐店的老周每天凌晨四点起床，揉面、熬粥、等第一位客人。这天，一位摄影系学生把他的小店拍进了毕业作品，也让老周重新想起自己年轻时开店的初心。一碗热粥的温度，连接起整条巷子的人情冷暖。',
  },
];

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
    let usedTemplate = false;
    if (options.storyText) {
      storyText = options.storyText;
      this.logger.info('using provided story text', this.ctx({ method: 'createStoryFilm' }));
    } else {
      this.logger.info('generating story text from theme', this.ctx({
        method: 'createStoryFilm',
        theme: options.theme,
      }));
      try {
        storyText = await this.generateStoryText(
          options.theme!,
          options.keyPoints ?? [],
        );
      } catch (e) {
        if (options.fallbackToTemplate === false) throw e;
        storyText = StoryFilmService.pickTemplateStory(options.theme!);
        usedTemplate = true;
        this.logger.warn('story text generation failed, falling back to template', this.ctx({
          method: 'createStoryFilm',
          theme: options.theme,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    // 2. 创建 Story
    // P0-1 修复：StoryService.createStory 签名为 (title, originalText, spaceId)，
    // 之前误按 (spaceId, title, storyText) 顺序传入，导致 Story 被创建到错误的
    // 空间（用 storyText 当 spaceId）。一键成片流程彻底断裂。
    const title = options.title ?? options.theme ?? storyText.slice(0, 50);
    const story = await this.storyService.createStory(
      title,
      storyText,
      options.spaceId,
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
      usedTemplate: usedTemplate || undefined,
    };
  }

  /** S-1 模板故事库访问（供 UI 展示/测试） */
  static getTemplateStories(): ReadonlyArray<{ keyword: string; theme: string; text: string }> {
    return TEMPLATE_STORIES;
  }

  /** S-1 按主题关键词选择模板，未命中时返回通用模板 */
  static pickTemplateStory(theme: string): string {
    const hit = TEMPLATE_STORIES.find(t => theme.includes(t.keyword));
    return hit?.text ?? TEMPLATE_STORIES[TEMPLATE_STORIES.length - 1].text;
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
