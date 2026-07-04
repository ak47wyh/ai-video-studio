import type { IWhisperPort } from '../ports/PostProcessPorts';
import type { ITextGenerationPort } from '../ports/OutboundPorts';
import type { IApiConfigStore, IModelRegistry } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter } from '../ports/CrossCuttingPorts';
import type { StorySegment } from '../entities/models';
import type { PlatformRouter } from './PlatformRouter';

export interface SrtEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * SubtitleService — AI 字幕生成服务
 *
 * 流程：
 * 1. Whisper 转录音频 → 时间戳片段
 * 2. Chat Completion 将片段对齐到段落边界
 * 3. 格式化为 SRT
 *
 * 实际使用需要将 Whisper 适配器替换为真实实现（whisper.cpp / 远程 API）。
 */
export class SubtitleService {
  private whisperPort: IWhisperPort;
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private costMeter?: ICostMeter;
  private modelRegistry?: IModelRegistry;
  // @ts-expect-error Logger injected for future use
  private _logger: ILoggerPort;

  constructor(
    whisperPort: IWhisperPort,
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    costMeter?: ICostMeter,
    modelRegistry?: IModelRegistry,
  ) {
    this.whisperPort = whisperPort;
    this.router = router;
    this.configStore = configStore;
    this._logger = logger;
    this.costMeter = costMeter;
    this.modelRegistry = modelRegistry;
  }

  /** 解析当前对齐任务应使用的模型 ID（M3.3：走 PlatformRouter） */
  private resolveAlignmentModel(): string {
    return this.modelRegistry?.resolveTextModel('alignment') ?? 'MiniMax-M2.5-highspeed';
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    return this.router.resolveText(this.configStore.load());
  }

  /**
   * 从音频和段落生成 SRT 字幕
   */
  async generateSrtFromSegments(
    audio: Blob | string,
    segments: StorySegment[],
    language = 'zh'
  ): Promise<string> {
    await this.whisperPort.load();

    // Step 1: transcribe audio (placeholder returns empty if no real Whisper)
    const transcripts = await this.whisperPort.transcribe(audio, language);

    // Step 2: align to segments using AI (or fallback to even distribution)
    const aligned = transcripts.length > 0
      ? await this.alignToSegments(transcripts, segments)
      : this.distributeEvenly(segments);

    // Step 3: format as SRT
    return this.formatSrt(aligned);
  }

  /**
   * 用 Chat Completion 把 Whisper 输出的转录片段对齐到段落边界
   */
  private async alignToSegments(
    transcripts: Array<{ start: number; end: number; text: string }>,
    segments: StorySegment[]
  ): Promise<SrtEntry[]> {
    if (segments.length === 0) return [];
    if (transcripts.length === 0) return this.distributeEvenly(segments);

    // Build prompt: ask AI to merge whisper transcripts into segment boundaries
    const transcriptText = transcripts
      .map((t, i) => `[${i}] (${t.start}-${t.end}ms) ${t.text}`)
      .join('\n');
    const segmentText = segments
      .map((s, i) => `[S${i}] ${s.content}`)
      .join('\n');

    const result = await this.getTextPort().chatCompletion({
      model: this.resolveAlignmentModel(),
      messages: [
        {
          role: 'system',
          content: `You are a subtitle alignment assistant. Given a list of whisper transcripts with timestamps and a list of story segments, map each transcript to a segment and output the start/end times for each segment.

Output JSON array of objects: { "segmentIndex": number, "startMs": number, "endMs": number }.
- Distribute transcripts sequentially to segments
- Use the earliest transcript start as the segment start
- Use the latest transcript end as the segment end
- Segments should be contiguous (no gaps)
- Output ONLY the JSON array, no other text.`,
          cache_control: { type: 'ephemeral' }
        },
        {
          role: 'user',
          content: `Transcripts:\n${transcriptText}\n\nSegments:\n${segmentText}`
        }
      ],
      temperature: 0.1,
      maxTokens: 2048,
      useAnthropicEndpoint: true
    });

    this.costMeter?.record({
      platform: this.configStore.load().activePlatform,
      model: this.resolveAlignmentModel(),
      callType: 'subtitle_align',
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokens ?? 0,
            outputTokens: result.usage.completionTokens ?? 0,
            totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
          }
        : undefined,
    });

    try {
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return this.distributeEvenly(segments);
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ segmentIndex: number; startMs: number; endMs: number }>;
      return parsed.map((p) => {
        const seg = segments[p.segmentIndex];
        if (!seg) return null;
        return {
          index: p.segmentIndex,
          startMs: p.startMs,
          endMs: p.endMs,
          text: seg.content
        };
      }).filter((x): x is SrtEntry => x !== null);
    } catch {
      return this.distributeEvenly(segments);
    }
  }

  /**
   * 平均分配时间（无 Whisper 时的降级方案）
   */
  private distributeEvenly(segments: StorySegment[]): SrtEntry[] {
    const totalChars = segments.reduce((sum, s) => sum + s.content.length, 0);
    if (totalChars === 0) return [];
    const totalDurationMs = segments.length * 6000; // 估算每段 6s
    let cursor = 0;
    return segments.map((seg, i) => {
      const duration = Math.round((seg.content.length / totalChars) * totalDurationMs);
      const start = cursor;
      const end = cursor + duration;
      cursor = end;
      return { index: i, startMs: start, endMs: end, text: seg.content };
    });
  }

  /**
   * 格式化为 SRT 字符串
   */
  formatSrt(entries: SrtEntry[]): string {
    return entries
      .map(entry => {
        const start = this.formatTimestamp(entry.startMs);
        const end = this.formatTimestamp(entry.endMs);
        return `${entry.index}\n${start} --> ${end}\n${entry.text}\n`;
      })
      .join('\n');
  }

  /**
   * 毫秒转 SRT 时间戳格式: HH:MM:SS,mmm
   */
  private formatTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const millis = ms % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  /**
   * 解析 SRT 字符串为条目数组
   */
  parseSrt(srt: string): SrtEntry[] {
    const blocks = srt.trim().split(/\n\s*\n/);
    const entries: SrtEntry[] = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) continue;
      const index = parseInt(lines[0], 10);
      const timeLine = lines[1];
      const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!match) continue;
      const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
      const startMs = (+h1) * 3600000 + (+m1) * 60000 + (+s1) * 1000 + (+ms1);
      const endMs = (+h2) * 3600000 + (+m2) * 60000 + (+s2) * 1000 + (+ms2);
      const text = lines.slice(2).join('\n');
      entries.push({ index, startMs, endMs, text });
    }
    return entries;
  }

  /**
   * 翻译 SRT 字幕到目标语言
   */
  async translateSrt(srt: string, targetLanguage: string): Promise<string> {
    const entries = this.parseSrt(srt);
    if (entries.length === 0) return srt;

    const languageMap: Record<string, string> = {
      'en': 'English',
      'ja': 'Japanese',
      'ko': 'Korean',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'ru': 'Russian',
      'zh-TW': 'Traditional Chinese',
    };
    const langName = languageMap[targetLanguage] ?? targetLanguage;

    const numbered = entries.map((e, i) => `[${i}] ${e.text}`).join('\n');

    const result = await this.getTextPort().chatCompletion({
      model: this.resolveAlignmentModel(),
      messages: [
        {
          role: 'system',
          content: `你是一个专业字幕翻译。将以下编号字幕翻译为${langName}，保持编号一致。\n- 保持原文语气和风格\n- 翻译自然流畅，符合${langName}表达习惯\n- 输出格式：每行 "[编号] 翻译文本"\n- 只输出翻译结果，不要其他内容`,
          cache_control: { type: 'ephemeral' }
        },
        { role: 'user', content: numbered }
      ],
      temperature: 0.3,
      maxTokens: 4096,
      useAnthropicEndpoint: true,
    });

    this.costMeter?.record({
      platform: this.configStore.load().activePlatform,
      model: this.resolveAlignmentModel(),
      callType: 'subtitle_translate',
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokens ?? 0,
            outputTokens: result.usage.completionTokens ?? 0,
            totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
          }
        : undefined,
    });

    const translatedEntries = this.parseTranslatedResult(result.content, entries);
    return this.formatSrt(translatedEntries);
  }

  private parseTranslatedResult(result: string, original: SrtEntry[]): SrtEntry[] {
    const lines = result.trim().split('\n');
    const translated = new Map<number, string>();
    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        translated.set(idx, match[2].trim());
      }
    }
    return original.map((e, i) => ({
      ...e,
      text: translated.get(i) ?? e.text,
    }));
  }
}
