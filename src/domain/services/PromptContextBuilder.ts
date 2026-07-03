/**
 * PromptContextBuilder —— 视频生成上下文构建器
 *
 * 落地 System_Design.md §5 描述的 PromptContextBuilder。
 * 职责：
 *   1. 文学 → 镜头描述翻译（"他仰天长啸" → "男人面部特写，张嘴怒吼，仰视镜头"）
 *   2. 注入 CinematographyService 建议的景别 / 运镜
 *   3. 组装统一的 VideoPromptContext（角色 / 背景 / 风格 / 镜头）
 *
 * 设计原则：
 *   - 输出统一上下文，由各平台适配器各自翻译为平台专有参数
 *   - Service 层不关心平台差异
 *   - 失败时降级：保留原文 prompt + 不附加镜头增强
 */

import type {
  ITextGenerationPort,
  VideoPromptContext,
  TextGenerationMessage,
} from '../ports/OutboundPorts';
import type { StorySegment, Character, Background, VideoGenerationMode, VideoModel, VideoResolution } from '../entities/models';
import type { IApiConfigStore, IModelRegistry } from '../ports/PlatformPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';
import type { CinematographyService, ShotSuggestion } from './CinematographyService';

/** 透传给适配器的统一上下文附加元数据 */
export interface PromptBuildContext {
  /** 文学性原段落（保留用于角色一致性参考） */
  rawContent: string;
  /** 翻译后的镜头动作描述（视频模型实际消费的 prompt） */
  cinematicAction: string;
  /** 镜头建议（景别 + 运镜），可选 */
  shotSuggestion?: ShotSuggestion;
  /** 角色外貌 Prompt 列表 */
  characters: Array<{ id: string; name: string; appearancePrompt: string; referenceImageUrl?: string }>;
  /** 背景环境 Prompt */
  background?: { id: string; name: string; environmentPrompt: string; referenceImageUrl?: string };
  /** 视频风格模板 */
  videoStyle?: string;
}

const TRANSLATE_SYSTEM_PROMPT = `你是一个专业的影视镜头描述师。给定一段文学性故事文本，将其翻译为具有客观镜头感的画面描述语言，便于 AI 视频生成模型理解。

要求：
- 输出英文，便于跨平台视频模型消费
- 包含主体（人物/物体）、动作、表情、镜头角度
- 长度 30-80 词，不要过度扩展
- 保留原段落的情绪与节奏
- 不要包含角色名（视频模型不识别人名），改为"man/woman/young girl/old man"等

只输出翻译后的画面描述，不要解释。`;

/**
 * PromptContextBuilder
 *
 * v1.0 实现：
 * - 调用 LLM 做文学→镜头翻译（可缓存）
 * - 调用 CinematographyService 建议镜头
 * - 失败时降级到原文 + 无镜头建议
 */
export class PromptContextBuilder {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private cinematography: CinematographyService;
  private logger: ILoggerPort;
  private modelRegistry?: IModelRegistry;

  /** 翻译结果缓存（按段落内容 hash），避免重复调用 LLM */
  private translateCache = new Map<string, string>();

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    cinematography: CinematographyService,
    logger: ILoggerPort,
    modelRegistry?: IModelRegistry,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.cinematography = cinematography;
    this.logger = logger;
    this.modelRegistry = modelRegistry;
  }

  /** 解析当前翻译任务应使用的模型 ID（M3.3：走 PlatformRouter） */
  private resolveTranslateModel(): string {
    return this.modelRegistry?.resolveTextModel('translation') ?? 'MiniMax-M2.5-highspeed';
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    return this.router.resolveText(this.configStore.load());
  }

  /**
   * 构建视频生成上下文
   *
   * @param seg 故事分镜
   * @param characters 出场角色（来自 seg.mentionedCharacters 解析）
   * @param background 选定的背景（来自 seg.selectedBackgroundId 解析）
   * @param options 视频生成参数（mode/model/resolution/duration 等）
   */
  async build(
    seg: StorySegment,
    characters: Character[],
    background?: Background,
    options?: {
      mode?: VideoGenerationMode;
      model?: VideoModel;
      resolution?: VideoResolution;
      duration?: 6 | 10;
      promptOptimizer?: boolean;
      videoStyle?: string;
      /** 是否启用镜头建议（默认 true，关闭时跳过 CinematographyService 调用，节省 token） */
      enableCinematography?: boolean;
    },
  ): Promise<{ context: VideoPromptContext; buildInfo: PromptBuildContext }> {
    const enableCinematography = options?.enableCinematography !== false;
    this.logger.info('PromptContextBuilder.build start', {
      service: 'PromptContextBuilder',
      method: 'build',
      segmentId: seg.id,
      characterCount: characters.length,
      hasBackground: !!background,
      enableCinematography,
    });

    // 1. 文学 → 镜头描述翻译（带缓存）
    const cinematicAction = await this.translateToCinematic(seg.content);

    // 2. 镜头建议（可选）
    let shotSuggestion: ShotSuggestion | undefined;
    if (enableCinematography && characters.length > 0) {
      try {
        const shots = await this.cinematography.suggestShots(seg, characters.map(c => c.name));
        // 取第一个建议作为主镜头（如果多个，UI 可让用户选择）
        shotSuggestion = shots[0];
      } catch (e) {
        this.logger.warn('cinematography suggest failed, skip shot enhancement', {
          service: 'PromptContextBuilder',
          method: 'build',
          segmentId: seg.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 3. 组装最终 prompt（拼接镜头动作 + 镜头增强）
    let finalPrompt = cinematicAction;
    if (shotSuggestion?.promptEnhancement) {
      finalPrompt = `${cinematicAction}. ${shotSuggestion.promptEnhancement}`;
    }

    // 4. 构建统一上下文
    const context: VideoPromptContext = {
      mode: options?.mode || 't2v',
      model: options?.model,
      prompt: finalPrompt,
      actionContent: cinematicAction,
      characters,
      background,
      videoStyle: options?.videoStyle,
      duration: options?.duration,
      resolution: options?.resolution,
      promptOptimizer: options?.promptOptimizer ?? true,
      // I2V / FL2V 模式下，首帧图片由调用方传入
      firstFrameImage: seg.firstFrameImage,
    };

    const buildInfo: PromptBuildContext = {
      rawContent: seg.content,
      cinematicAction,
      shotSuggestion,
      characters: characters.map(c => ({
        id: c.id,
        name: c.name,
        appearancePrompt: c.appearancePrompt,
        referenceImageUrl: c.referenceImageUrl,
      })),
      background: background ? {
        id: background.id,
        name: background.name,
        environmentPrompt: background.environmentPrompt,
        referenceImageUrl: background.referenceImageUrl,
      } : undefined,
      videoStyle: options?.videoStyle,
    };

    this.logger.info('PromptContextBuilder.build done', {
      service: 'PromptContextBuilder',
      method: 'build',
      segmentId: seg.id,
      promptLength: finalPrompt.length,
      hasShotSuggestion: !!shotSuggestion,
    });

    return { context, buildInfo };
  }

  /**
   * 文学 → 镜头描述翻译
   * 内部带缓存，避免同一段落重复调用 LLM
   */
  private async translateToCinematic(content: string): Promise<string> {
    const trimmed = content.trim();
    if (!trimmed) return '';

    // 命中缓存
    const cached = this.translateCache.get(trimmed);
    if (cached) {
      this.logger.debug('translate cache hit', {
        service: 'PromptContextBuilder',
        method: 'translateToCinematic',
        contentLength: trimmed.length,
      });
      return cached;
    }

    const messages: TextGenerationMessage[] = [
      { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
      { role: 'user', content: trimmed },
    ];

    try {
      const result = await this.getTextPort().chatCompletion({
        model: this.resolveTranslateModel(),
        messages,
        temperature: 0.4,
        maxTokens: 256,
      });
      const translated = result.content.trim();

      // 写入缓存（限制 100 条，避免内存膨胀）
      if (this.translateCache.size >= 100) {
        const firstKey = this.translateCache.keys().next().value;
        if (firstKey) this.translateCache.delete(firstKey);
      }
      this.translateCache.set(trimmed, translated);

      this.logger.info('translate success', {
        service: 'PromptContextBuilder',
        method: 'translateToCinematic',
        originalLength: trimmed.length,
        translatedLength: translated.length,
      });
      return translated;
    } catch (e) {
      this.logger.warn('translate failed, fallback to original content', {
        service: 'PromptContextBuilder',
        method: 'translateToCinematic',
        error: e instanceof Error ? e.message : String(e),
      });
      // 降级：返回原文（适配器仍可消费中文）
      return trimmed;
    }
  }

  /** 清空翻译缓存 */
  clearCache(): void {
    this.translateCache.clear();
  }
}
