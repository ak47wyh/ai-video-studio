import type { ITextGenerationPort, RefineResult } from '../ports/OutboundPorts';
import type { IApiConfigStore, IModelRegistry } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';
import { recordTextGenUsage } from '../../utils/cacheMonitor';

export class TextGenerationService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private modelRegistry: IModelRegistry;
  private costMeter?: ICostMeter;
  private logger: ILoggerPort;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    costMeter?: ICostMeter,
    modelRegistry?: IModelRegistry,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.costMeter = costMeter;
    this.logger = logger;
    this.modelRegistry = modelRegistry ?? {
      resolveTextModel: () => 'MiniMax-M2.5-highspeed',
      resolveImageModel: () => 'image-01',
      resolveVideoModel: () => 'T2V-01-Director',
    };
    // 注:resolveImageModel 的默认值 'image-01' 为 MiniMax 默认模型,
    // 实际运行时由 PlatformModelRegistry.resolveImageModel() 从注册表读取真实 ID。
  }

  /**
   * 记录一次文本调用到成本计量（P1-21）。
   * 仅在 costMeter 注入时生效；usage 缺失时仅记录调用次数。
   */
  private recordTextCost(
    model: string,
    usage: { promptTokens?: number; completionTokens?: number } | undefined,
  ): void {
    if (!this.costMeter) return;
    const config = this.configStore.load();
    this.costMeter.record({
      platform: config.activePlatform,
      model,
      callType: 'text',
      usage: usage
        ? {
            inputTokens: usage.promptTokens ?? 0,
            outputTokens: usage.completionTokens ?? 0,
            totalTokens: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
          }
        : undefined,
    });
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    const config = this.configStore.load();
    return this.router.resolve('text', config);
  }

  /** 统一日志 ctx（Phase 5：激活原本闲置的 _logger 占位） */
  private ctx(method: string, extra: Record<string, unknown> = {}) {
    return { service: 'TextGenerationService', method, ...extra };
  }

  /**
   * Refine a prompt (character appearance/personality/background description)
   * to be more professional and suitable for AI image generation.
   */
  async refinePrompt(
    rawPrompt: string,
    type: 'character_appearance' | 'character_personality' | 'background'
  ): Promise<RefineResult> {
    this.logger.info('refinePrompt', this.ctx('refinePrompt', { type, len: rawPrompt.length }));
    const typeLabels: Record<string, string> = {
      character_appearance: '角色外貌',
      character_personality: '角色性格',
      background: '场景环境',
    };

    const model = this.modelRegistry.resolveTextModel('recommendation');
    const textPort = this.getTextPort();
    const result = await textPort.chatCompletion({
      model,
      messages: [
        {
          role: 'system',
          content: `你是一个专业的 AI 提示词工程师，擅长将粗略描述润色为高质量的 AI 图像/视频生成提示词。

任务：将以下${typeLabels[type]}描述润色为更专业、更有画面感的提示词。

要求：
- 使用英文输出（AI 生成模型对英文提示词效果更好）
- 描述要具体、有细节
- 包含视觉元素：光线、色彩、构图、氛围
- 长度控制在 50-200 个英文单词
- 只输出润色后的提示词，不要其他内容`,
          cache_control: { type: 'ephemeral' },
        },
        { role: 'user', content: rawPrompt },
      ],
      temperature: 0.7,
      maxTokens: 512,
    });

    recordTextGenUsage(`refine_${type}`, result.usage);
    this.recordTextCost(model, result.usage);

    return {
      content: result.content.trim(),
      cachedTokens: result.usage?.cachedTokens,
      totalTokens: result.usage ? result.usage.promptTokens + result.usage.completionTokens : undefined,
    };
  }

  /**
   * Refine story text to be more cinematic and visual.
   */
  async refineText(rawText: string): Promise<RefineResult> {
    this.logger.info('refineText', this.ctx('refineText', { len: rawText.length }));
    const model = this.modelRegistry.resolveTextModel('recommendation');
    const textPort = this.getTextPort();
    const result = await textPort.chatCompletion({
      model,
      messages: [
        {
          role: 'system',
          content: `你是一个专业的视频剧本编剧，擅长将故事文本润色为画面感强的视频剧本。

任务：将以下故事文本润色为更适合视频制作的版本。

要求：
- 增强画面感，让读者能"看到"场景
- 保留原始故事的核心内容和情节
- 适当增加环境描写和人物动作细节
- 语言简洁有力，适合旁白朗读
- 只输出润色后的文本，不要其他内容`,
          cache_control: { type: 'ephemeral' },
        },
        { role: 'user', content: rawText },
      ],
      temperature: 0.6,
      maxTokens: 4096,
    });

    recordTextGenUsage('refine_text', result.usage);
    this.recordTextCost(model, result.usage);

    return {
      content: result.content.trim(),
      cachedTokens: result.usage?.cachedTokens,
      totalTokens: result.usage ? result.usage.promptTokens + result.usage.completionTokens : undefined,
    };
  }

  /**
   * Suggest a BGM style description based on segment content.
   */
  async suggestBGMStyle(segmentContent: string): Promise<RefineResult> {
    this.logger.info('suggestBGMStyle', this.ctx('suggestBGMStyle', { len: segmentContent.length }));
    const model = this.modelRegistry.resolveTextModel('recommendation');
    const textPort = this.getTextPort();
    const result = await textPort.chatCompletion({
      model,
      messages: [
        {
          role: 'system',
          content: `你是一个专业的视频配乐师，擅长根据故事内容推荐合适的背景音乐风格。

任务：根据以下故事段落内容，推荐一个合适的背景音乐风格描述。

要求：
- 使用英文输出
- 描述应包含：音乐类型、情绪、节奏、乐器等
- 格式示例："Cinematic, Epic, Orchestral, Dark, Tension, Strings and Brass"
- 长度控制在 10-50 个英文单词
- 只输出风格描述，不要其他内容`,
          cache_control: { type: 'ephemeral' },
        },
        { role: 'user', content: segmentContent },
      ],
      temperature: 0.8,
      maxTokens: 128,
    });

    recordTextGenUsage('bgm_style', result.usage);
    this.recordTextCost(model, result.usage);

    return {
      content: result.content.trim(),
      cachedTokens: result.usage?.cachedTokens,
      totalTokens: result.usage ? result.usage.promptTokens + result.usage.completionTokens : undefined,
    };
  }

  /**
   * Optimize a video generation prompt based on segment content,
   * character descriptions, and background.
   */
  async optimizeVideoPrompt(
    segmentContent: string,
    characterDescriptions: string[],
    backgroundDescription?: string
  ): Promise<RefineResult> {
    this.logger.info('optimizeVideoPrompt', this.ctx('optimizeVideoPrompt', {
      segmentLen: segmentContent.length,
      characterCount: characterDescriptions.length,
      hasBackground: Boolean(backgroundDescription),
    }));
    const contextParts = [
      `段落内容：${segmentContent}`,
      characterDescriptions.length > 0
        ? `角色描述：${characterDescriptions.join('; ')}`
        : '',
      backgroundDescription
        ? `背景描述：${backgroundDescription}`
        : '',
    ].filter(Boolean).join('\n');

    const model = this.modelRegistry.resolveTextModel('chat');
    const textPort = this.getTextPort();
    const result = await textPort.chatCompletion({
      model,
      messages: [
        {
          role: 'system',
          content: `你是一个专业的 AI 视频生成提示词工程师，擅长将故事内容转化为高质量的视频生成提示词。

任务：根据以下故事段落信息，生成一个优化的视频生成提示词。

要求：
- 使用英文输出
- 提示词应包含：场景描述、角色动作、镜头运动、光线氛围
- 确保提示词能生成与故事内容一致的视频
- 长度控制在 50-300 个英文单词
- 只输出提示词，不要其他内容`,
          cache_control: { type: 'ephemeral' },
        },
        { role: 'user', content: contextParts },
      ],
      temperature: 0.6,
      maxTokens: 512,
    });

    recordTextGenUsage('video_prompt', result.usage);
    this.recordTextCost(model, result.usage);

    return {
      content: result.content.trim(),
      cachedTokens: result.usage?.cachedTokens,
      totalTokens: result.usage ? result.usage.promptTokens + result.usage.completionTokens : undefined,
    };
  }
}