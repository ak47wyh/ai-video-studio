import type { ITextSplitterPort, SegmentDraft, ITextGenerationPort } from '../../../domain/ports/OutboundPorts';
import type { ILoggerPort, LogContext } from '../../../domain/ports/CrossCuttingPorts';

const SPLIT_SYSTEM_PROMPT = `你是一个专业的视频剧本编辑，擅长将故事文本按场景/情节拆分为独立段落。

任务：将以下故事文本拆分为多个段落，每个段落应该：
1. 是一个完整的场景，有明确的时空定位
2. 适合制作成一段 5-15 秒的短视频
3. 包含足够的画面描述信息

输出格式：JSON 数组
[{
  "content": "段落内容（保留原文，适当润色增强画面感）",
  "mentionedCharacters": ["角色名1", "角色名2"]
}]

注意：只返回 JSON 数组，不要返回其他内容。不要用 markdown 代码块包裹。`;

export class MiniMaxTextSplitterAdapter implements ITextSplitterPort {
  textPort: ITextGenerationPort;
  fallback: ITextSplitterPort;
  private readonly logger?: ILoggerPort;

  constructor(textPort: ITextGenerationPort, fallback: ITextSplitterPort, logger?: ILoggerPort) {
    this.textPort = textPort;
    this.fallback = fallback;
    this.logger = logger;
  }

  /** 统一日志上下文工厂 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'MiniMaxTextSplitterAdapter', ...extra };
  }

  async splitStoryToSegments(text: string, knownCharacterNames: string[]): Promise<SegmentDraft[]> {
    try {
      const result = await this.textPort.chatCompletion({
        model: 'MiniMax-M2.5-highspeed',
        messages: [
          { role: 'system', content: SPLIT_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
        maxTokens: 4096,
      });

      const segments = this.parseJSON<SegmentDraft[]>(result.content);
      if (!segments || !Array.isArray(segments) || segments.length === 0) {
        throw new Error('AI returned invalid segment data');
      }

      // Validate and normalize each segment
      return segments.map(seg => ({
        content: String(seg.content || '').trim(),
        mentionedCharacters: Array.isArray(seg.mentionedCharacters)
          ? seg.mentionedCharacters.map(String)
          : knownCharacterNames.filter(name => String(seg.content || '').includes(name)),
      })).filter(seg => seg.content.length > 0);
    } catch (e) {
      // warn 签名仅接受 (message, context)，错误信息收入 context 避免泄露完整对象
      this.logger?.warn('AI split failed, falling back to mock', this.ctx({ error: e instanceof Error ? e.message : String(e) }));
      return this.fallback.splitStoryToSegments(text, knownCharacterNames);
    }
  }

  /**
   * Parse JSON from AI response content.
   * Handles cases where AI wraps JSON in markdown code blocks.
   */
  private parseJSON<T>(content: string): T | null {
    // Try direct parse
    try {
      return JSON.parse(content);
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // Continue to next strategy
        }
      }

      // Try finding JSON array/object in content
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch {
          // Continue
        }
      }

      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          // Give up
        }
      }

      return null;
    }
  }
}
