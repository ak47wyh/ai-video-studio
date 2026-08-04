import type { IStoryBreakdownPort, StoryBreakdownResult, ITextGenerationPort } from '../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../domain/ports/CrossCuttingPorts';

const BREAKDOWN_SYSTEM_PROMPT = `你是一个专业的视频剧本分析师，擅长从故事中提取角色、场景和分镜。

任务：分析以下故事文本，提取：

1. 角色：每个角色的名称、外貌描述、性格特点、背景故事
2. 场景/背景：每个场景的名称、环境描述
3. 段落/分镜：每段的内容、提及的角色、建议的背景

要求：
- 外貌描述要具体、有画面感，适合用于 AI 图像生成
- 性格描述要突出特点，适合用于角色一致性维护
- 环境描述要有氛围感，适合用于 AI 背景图生成
- 段落内容保留原文，增强画面感

输出格式：
{
  "characters": [{
    "name": "角色名",
    "appearancePrompt": "Appearance description in English, suitable for AI image generation",
    "personalityPrompt": "Personality description",
    "characterBackground": "Character background story"
  }],
  "backgrounds": [{
    "name": "Scene name",
    "environmentPrompt": "Environment description in English, suitable for AI background generation"
  }],
  "segments": [{
    "content": "Segment content",
    "mentionedCharacterNames": ["Character name"],
    "suggestedBackgroundName": "Scene name"
  }]
}

注意：只返回 JSON，不要返回其他内容。不要用 markdown 代码块包裹。`;

interface RawBreakdownResult {
  characters?: Array<{
    name?: string;
    appearancePrompt?: string;
    personalityPrompt?: string;
    characterBackground?: string;
  }>;
  backgrounds?: Array<{
    name?: string;
    environmentPrompt?: string;
  }>;
  segments?: Array<{
    content?: string;
    mentionedCharacterNames?: string[];
    suggestedBackgroundName?: string;
  }>;
}

export class MiniMaxStoryBreakdownAdapter implements IStoryBreakdownPort {
  textPort: ITextGenerationPort;
  fallback: IStoryBreakdownPort;
  private readonly logger?: ILoggerPort;

  constructor(textPort: ITextGenerationPort, fallback: IStoryBreakdownPort, logger?: ILoggerPort) {
    this.textPort = textPort;
    this.fallback = fallback;
    this.logger = logger;
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'MiniMaxStoryBreakdownAdapter', ...extra };
  }

  async breakdownStory(text: string): Promise<StoryBreakdownResult> {
    try {
      const result = await this.textPort.chatCompletion({
        model: 'MiniMax-M2.5',
        messages: [
          { role: 'system', content: BREAKDOWN_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.4,
        maxTokens: 8192,
      });

      const parsed = this.parseJSON<RawBreakdownResult>(result.content);
      if (!parsed || !parsed.characters || !parsed.segments) {
        throw new Error('AI returned invalid breakdown data');
      }

      // Normalize and validate
      const characters = (parsed.characters || []).map(c => ({
        name: String(c.name || 'Unknown').trim(),
        appearancePrompt: String(c.appearancePrompt || '').trim(),
        personalityPrompt: String(c.personalityPrompt || '').trim(),
        characterBackground: String(c.characterBackground || '').trim(),
      })).filter(c => c.name.length > 0);

      const backgrounds = (parsed.backgrounds || []).map(b => ({
        name: String(b.name || 'Unknown Scene').trim(),
        environmentPrompt: String(b.environmentPrompt || '').trim(),
      }));

      // Fallback if no backgrounds
      if (backgrounds.length === 0) {
        backgrounds.push({
          name: 'Default Scene',
          environmentPrompt: 'A generic indoor scene with soft lighting',
        });
      }

      const segments = (parsed.segments || []).map(s => ({
        content: String(s.content || '').trim(),
        mentionedCharacterNames: Array.isArray(s.mentionedCharacterNames)
          ? s.mentionedCharacterNames.map(String)
          : [],
        suggestedBackgroundName: String(s.suggestedBackgroundName || backgrounds[0].name).trim(),
      })).filter(s => s.content.length > 0);

      if (characters.length === 0 || segments.length === 0) {
        throw new Error('AI returned empty breakdown');
      }

      return { characters, backgrounds, segments };
    } catch (e) {
      this.logger?.warn('AI breakdown failed, falling back to mock', this.ctx({ error: e instanceof Error ? e.message : String(e) }));
      return this.fallback.breakdownStory(text);
    }
  }

  private parseJSON<T>(content: string): T | null {
    try {
      return JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]); } catch { /* continue */ }
      }
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try { return JSON.parse(objectMatch[0]); } catch { /* continue */ }
      }
      return null;
    }
  }
}
