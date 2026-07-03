import type { IWhisperPort, TranscriptSegment } from '../../../domain/ports/PostProcessPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

/**
 * WhisperAdapter —— 字幕转录适配器（带降级链路）
 *
 * Phase 1 改造（EVOLUTION_DESIGN.md §5.3）：
 *   当前为占位实现，但接口已对齐云端 ASR 协议，便于未来替换为：
 *   1. 阿里云 Paraformer（项目已接 Wan 平台，可复用鉴权）
 *   2. MiniMax ASR（如未来提供）
 *   3. 本地 whisper.cpp WASM（离线方案）
 *
 * 当前降级链路：
 *   transcribe() → 返回空数组 → SubtitleService 自动降级到 distributeEvenly()
 *   按字数平均分配时间戳（保证字幕与画面整体时序对齐，虽不精确但可用）
 *
 * 替换为真实 ASR 时：
 *   - 实现 IWhisperPort 接口的 transcribe 方法
 *   - 输入：Blob 或音频 URL
 *   - 输出：TranscriptSegment[]（含 start/end/text/confidence）
 *   - 失败时仍可返回空数组，由 SubtitleService 兜底
 */
export class WhisperAdapter implements IWhisperPort {
  private loaded = false;
  private logger?: ILoggerPort;

  constructor(logger?: ILoggerPort) {
    this.logger = logger;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    // 真实 ASR 实现需在此加载模型 / 鉴权
    this.loaded = true;
    this.logger?.info('WhisperAdapter loaded (placeholder mode)', {
      service: 'WhisperAdapter',
      method: 'load',
      mode: 'placeholder',
      note: 'See EVOLUTION_DESIGN.md §5.3 for real ASR integration plan',
    });
  }

  /**
   * 转录音频为字幕段
   *
   * 当前实现：占位，返回空数组
   * 真实实现：调用云端 ASR API 或本地 WASM
   *
   * @param audio 音频 Blob 或 URL
   * @param language 语言代码（默认 'zh'）
   * @returns TranscriptSegment[]，空数组表示转录失败，由调用方降级处理
   */
  async transcribe(audio: Blob | string, language = 'zh'): Promise<TranscriptSegment[]> {
    await this.load();

    this.logger?.warn('WhisperAdapter transcribe: placeholder mode, returning empty array', {
      service: 'WhisperAdapter',
      method: 'transcribe',
      language,
      audioType: typeof audio === 'string' ? 'url' : 'blob',
      audioSize: typeof audio === 'string' ? audio.length : audio.size,
      note: 'Caller should fallback to distributeEvenly() for subtitle timing',
    });

    // 占位实现：返回空数组
    // 真实实现示例（伪代码）：
    //   const formData = new FormData();
    //   formData.append('audio', audio);
    //   formData.append('language', language);
    //   const res = await fetch('https://api.example.com/asr', { method: 'POST', body: formData });
    //   const data = await res.json();
    //   return data.segments.map(s => ({ start: s.start, end: s.end, text: s.text, confidence: s.confidence }));
    return [];
  }
}
