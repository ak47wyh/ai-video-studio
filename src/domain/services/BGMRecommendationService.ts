import type { ITextGenerationPort } from '../ports/OutboundPorts';
import type { IApiConfigStore, IModelRegistry } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';

export type BGMCategory =
  | 'cinematic-epic'    // 史诗/电影感
  | 'lighthearted'      // 轻松/日常
  | 'suspense'          // 紧张/悬疑
  | 'melancholic'       // 悲伤/抒情
  | 'upbeat'            // 欢快/活泼
  | 'romantic'          // 浪漫
  | 'mystery'           // 神秘
  | 'epic-action'       // 动作/战争
  | 'sci-fi-tech'       // 科幻/电子
  | 'fantasy-mythic'    // 奇幻/神话
  | 'horror-dark'       // 恐怖/黑暗
  | 'documentary';      // 纪录片/中性

export interface BGMRecommendation {
  category: BGMCategory;
  prompt: string;
  emotion: string;
  tempo: 'slow' | 'medium' | 'fast';
  instruments: string[];
  useInstrumental: boolean;
  reasoning: string;
  duration: number;
  confidence: number;
}

const CATEGORY_DESCRIPTIONS: Record<BGMCategory, { emotion: string; tempo: string; typicalInstruments: string[] }> = {
  'cinematic-epic': { emotion: '宏伟、壮丽', tempo: 'medium', typicalInstruments: ['orchestra', 'timpani', 'choir'] },
  'lighthearted': { emotion: '愉悦、轻松', tempo: 'medium', typicalInstruments: ['acoustic guitar', 'piano', 'ukulele'] },
  'suspense': { emotion: '紧张、不安', tempo: 'slow', typicalInstruments: ['strings', 'bass', 'dissonant piano'] },
  'melancholic': { emotion: '悲伤、忧郁', tempo: 'slow', typicalInstruments: ['piano', 'violin', 'cello'] },
  'upbeat': { emotion: '欢快、兴奋', tempo: 'fast', typicalInstruments: ['drums', 'electric guitar', 'saxophone'] },
  'romantic': { emotion: '浪漫、温馨', tempo: 'slow', typicalInstruments: ['piano', 'strings', 'harp'] },
  'mystery': { emotion: '神秘、悬疑', tempo: 'medium', typicalInstruments: ['pads', 'synthesizer', 'low strings'] },
  'epic-action': { emotion: '激烈、英雄', tempo: 'fast', typicalInstruments: ['drums', 'brass', 'electric guitar'] },
  'sci-fi-tech': { emotion: '未来、电子', tempo: 'medium', typicalInstruments: ['synthesizer', 'electronic beats', 'pads'] },
  'fantasy-mythic': { emotion: '神秘、传奇', tempo: 'medium', typicalInstruments: ['harp', 'flute', 'orchestra'] },
  'horror-dark': { emotion: '恐怖、阴森', tempo: 'slow', typicalInstruments: ['dissonant strings', 'low choir', 'atmosphere'] },
  'documentary': { emotion: '中性、客观', tempo: 'medium', typicalInstruments: ['piano', 'subtle strings'] },
};

export class BGMRecommendationService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private costMeter?: ICostMeter;
  private modelRegistry?: IModelRegistry;
  // @ts-expect-error Logger injected for future use
  private _logger: ILoggerPort;
  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    costMeter?: ICostMeter,
    modelRegistry?: IModelRegistry,
  ) {
    this.router = router;
    this.configStore = configStore;
    this._logger = logger;
    this.costMeter = costMeter;
    this.modelRegistry = modelRegistry;
  }

  /** 解析当前推荐任务应使用的模型 ID（M3.3：走 PlatformRouter） */
  private resolveRecommendationModel(): string {
    return this.modelRegistry?.resolveTextModel('recommendation') ?? 'MiniMax-M2.5';
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    return this.router.resolveText(this.configStore.load());
  }

  /**
   * Analyze video segment content and recommend the best BGM style.
   * Returns a structured recommendation with category, prompt, and metadata.
   */
  async recommend(segmentContent: string, characterNames: string[] = []): Promise<BGMRecommendation> {
    const result = await this.getTextPort().chatCompletion({
      model: this.resolveRecommendationModel(),
      messages: [
        {
          role: 'system',
          content: `你是专业影视配乐师。根据以下故事段落内容分析并推荐合适的背景音乐(BGM)。

请分析以下维度并输出 JSON：
- category: ${Object.keys(CATEGORY_DESCRIPTIONS).join('|')}
- emotion: 情绪描述(10-20字)
- tempo: slow/medium/fast
- instruments: 适合的乐器列表(3-5个英文)
- useInstrumental: true(纯音乐)/false(带歌词)
- reasoning: 推荐理由(30-50字)
- duration: 建议时长(秒)
- confidence: 0-1

只输出 JSON。`,
          cache_control: { type: 'ephemeral' }
        },
        {
          role: 'user',
          content: `段落内容：${segmentContent}\n涉及角色：${characterNames.join(', ') || '无'}`
        }
      ],
      temperature: 0.5,
      maxTokens: 512,
      useAnthropicEndpoint: true,
    });

    this.costMeter?.record({
      platform: this.configStore.load().activePlatform,
      model: this.resolveRecommendationModel(),
      callType: 'bgm_recommendation',
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokens ?? 0,
            outputTokens: result.usage.completionTokens ?? 0,
            totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
          }
        : undefined,
    });

    return this.parseRecommendation(result.content);
  }

  /**
   * Recommend a sequence of BGMs for multiple segments that maintains
   * emotional continuity across the story.
   */
  async recommendSequence(segments: string[]): Promise<BGMRecommendation[]> {
    const prompt = `你是专业影视配乐师。以下是一个故事的连续段落，请为每个段落推荐 BGM 风格，输出 JSON 数组：

要求：
- 段落间情绪可平滑过渡，避免突兀
- 整体风格应符合故事主题
- 每个段落包含：category, emotion, tempo, instruments(数组), useInstrumental, reasoning, duration, confidence(0-1)

只输出 JSON 数组，元素数量与段落数量一致。

段落列表：\n${segments.map((s, i) => `[${i}] ${s}`).join('\n')}`;

    const result = await this.getTextPort().chatCompletion({
      model: 'MiniMax-M2.5',
      messages: [
        { role: 'system', content: '你是专业影视配乐师，擅长为连续故事段落推荐有情绪连贯性的背景音乐。只输出 JSON 数组。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      maxTokens: 2048,
      useAnthropicEndpoint: true,
    });

    this.costMeter?.record({
      platform: this.configStore.load().activePlatform,
      model: 'MiniMax-M2.5',
      callType: 'bgm_recommendation',
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokens ?? 0,
            outputTokens: result.usage.completionTokens ?? 0,
            totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
          }
        : undefined,
    });

    return this.parseSequence(result.content, segments.length);
  }

  /**
   * Generate a ready-to-use music prompt string for a BGM style.
   * Returns an English prompt suitable for music-2.6 generation.
   */
  buildPrompt(category: BGMCategory, customEmotion?: string): string {
    const desc = CATEGORY_DESCRIPTIONS[category];
    const emotion = customEmotion ?? desc.emotion;
    const instruments = desc.typicalInstruments.join(', ');
    return `${emotion}, ${category}, ${instruments}, ${desc.tempo} tempo, professional background music for video`;
  }

  /**
   * Get category description for UI display.
   */
  getCategoryMeta(category: BGMCategory): { emotion: string; tempo: string; typicalInstruments: string[] } {
    return CATEGORY_DESCRIPTIONS[category];
  }

  /**
   * Get all available categories.
   */
  getAllCategories(): BGMCategory[] {
    return Object.keys(CATEGORY_DESCRIPTIONS) as BGMCategory[];
  }

  private parseRecommendation(result: string): BGMRecommendation {
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.fallbackRecommendation();
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const category = this.parseCategory(String(parsed.category));
      const meta = CATEGORY_DESCRIPTIONS[category];
      return {
        category,
        prompt: this.buildPrompt(category, String(parsed.emotion || meta.emotion)),
        emotion: String(parsed.emotion || meta.emotion),
        tempo: this.parseTempo(String(parsed.tempo)),
        instruments: this.parseInstruments(parsed.instruments, meta.typicalInstruments),
        useInstrumental: Boolean(parsed.useInstrumental ?? true),
        reasoning: String(parsed.reasoning || ''),
        duration: Number(parsed.duration) || 30,
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      };
    } catch {
      return this.fallbackRecommendation();
    }
  }

  private parseSequence(result: string, expectedCount: number): BGMRecommendation[] {
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return Array.from({ length: expectedCount }, () => this.fallbackRecommendation());
      const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
      return parsed.map(p => {
        const category = this.parseCategory(String(p.category));
        const meta = CATEGORY_DESCRIPTIONS[category];
        return {
          category,
          prompt: this.buildPrompt(category, String(p.emotion || meta.emotion)),
          emotion: String(p.emotion || meta.emotion),
          tempo: this.parseTempo(String(p.tempo)),
          instruments: this.parseInstruments(p.instruments, meta.typicalInstruments),
          useInstrumental: Boolean(p.useInstrumental ?? true),
          reasoning: String(p.reasoning || ''),
          duration: Number(p.duration) || 30,
          confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0.5)),
        };
      });
    } catch {
      return Array.from({ length: expectedCount }, () => this.fallbackRecommendation());
    }
  }

  private parseCategory(s: string): BGMCategory {
    const valid: BGMCategory[] = ['cinematic-epic', 'lighthearted', 'suspense', 'melancholic', 'upbeat', 'romantic', 'mystery', 'epic-action', 'sci-fi-tech', 'fantasy-mythic', 'horror-dark', 'documentary'];
    return valid.includes(s as BGMCategory) ? s as BGMCategory : 'lighthearted';
  }

  private parseTempo(s: string): 'slow' | 'medium' | 'fast' {
    return ['slow', 'medium', 'fast'].includes(s) ? s as 'slow' | 'medium' | 'fast' : 'medium';
  }

  private parseInstruments(v: unknown, fallback: string[]): string[] {
    if (Array.isArray(v)) return v.map(i => String(i));
    return fallback;
  }

  private fallbackRecommendation(): BGMRecommendation {
    return {
      category: 'lighthearted',
      prompt: this.buildPrompt('lighthearted'),
      emotion: '愉悦、轻松',
      tempo: 'medium',
      instruments: CATEGORY_DESCRIPTIONS['lighthearted'].typicalInstruments,
      useInstrumental: true,
      reasoning: '默认推荐',
      duration: 30,
      confidence: 0.3,
    };
  }
}
