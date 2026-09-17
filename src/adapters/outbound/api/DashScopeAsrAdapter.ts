/**
 * DashScopeAsrAdapter —— A1 真实云端 ASR（阿里云 DashScope Paraformer）
 *
 * 背景：原 WhisperAdapter 为占位实现（transcribe 返回空数组），字幕时间戳只能
 * 按字数平均分配，无法与语音对齐。本适配器复用 Wan 平台已配置的 DashScope API Key，
 * 走 Paraformer 文件转录 REST 流程：
 *   1. 上传音频（本地 Blob）→ 获取可访问 URL
 *   2. 提交转录任务（paraformer-v2，按语言传 language_hints）
 *   3. 轮询任务状态 → 拉取句子级时间戳
 *
 * 降级链：任何失败（未配置 Key / 网络错误 / API 错误 / 解析失败）均返回空数组，
 * 由 SubtitleService 降级到 distributeEvenly()，保证字幕功能始终可用。
 *
 * 说明：DashScope 句子级 begin_time / end_time 单位为毫秒，与 IWhisperPort
 * （SubtitleService 按 ms 处理）对齐。
 */
import type { IWhisperPort, TranscriptSegment } from '../../../domain/ports/PostProcessPorts';
import type { IApiConfigStore } from '../../../domain/ports/PlatformPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;

/** 语言代码 → DashScope language_hints */
const LANGUAGE_HINTS: Record<string, string> = {
  zh: 'zh',
  'zh-CN': 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
};

interface DashScopeSentence {
  begin_time?: number;
  end_time?: number;
  text?: string;
  confidence?: number;
}

export class DashScopeAsrAdapter implements IWhisperPort {
  private configStore: IApiConfigStore;
  private logger?: ILoggerPort;

  constructor(configStore: IApiConfigStore, logger?: ILoggerPort) {
    this.configStore = configStore;
    this.logger = logger;
  }

  /** 云端 ASR 无需本地加载模型，始终就绪 */
  isLoaded(): boolean {
    return true;
  }

  async load(): Promise<void> {
    // no-op：鉴权与资源均按需在 transcribe 中解析
  }

  async transcribe(audio: Blob | string, language = 'zh'): Promise<TranscriptSegment[]> {
    const apiKey = this.configStore.getToken('wan');
    if (!apiKey) {
      this.logger?.warn('DashScopeAsr: wanApiKey 未配置，字幕降级为平均分配', {
        service: 'DashScopeAsrAdapter',
        method: 'transcribe',
      });
      return [];
    }

    try {
      const fileUrl = this.isHttpUrl(audio)
        ? (audio as string)
        : await this.uploadAudio(apiKey, audio as Blob);
      const taskId = await this.submitTranscription(apiKey, fileUrl, language);
      const sentences = await this.pollTranscription(apiKey, taskId);
      return sentences.map((s) => ({
        start: s.begin_time ?? 0,
        end: s.end_time ?? 0,
        text: (s.text ?? '').trim(),
        confidence: s.confidence,
      })).filter((s) => s.text.length > 0);
    } catch (e) {
      this.logger?.warn('DashScopeAsr: 转录失败，字幕降级为平均分配', {
        service: 'DashScopeAsrAdapter',
        method: 'transcribe',
        language,
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  private isHttpUrl(audio: Blob | string): boolean {
    return typeof audio === 'string' && /^https?:\/\//.test(audio);
  }

  /**
   * 上传本地音频到 DashScope，返回可被转录任务引用的文件 URL。
   * 端点：POST /api/v1/uploads（multipart，X-DashScope-Async: enable）
   */
  private async uploadAudio(apiKey: string, blob: Blob): Promise<string> {
    const form = new FormData();
    const filename = `audio_${Date.now()}.mp3`;
    form.append('file', blob, filename);

    const res = await fetch(`${DASHSCOPE_BASE}/uploads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: form,
    });
    const body = await this.parseJson(res);
    const data = body?.data as { upload_url?: string; file_url?: string } | undefined;
    const fileUrl: string | undefined = data?.upload_url ?? data?.file_url;
    if (!fileUrl) {
      throw new Error(`DashScope upload failed: ${JSON.stringify(body).slice(0, 200)}`);
    }
    this.logger?.debug('DashScopeAsr upload ok', {
      service: 'DashScopeAsrAdapter',
      method: 'uploadAudio',
      fileUrl: fileUrl.slice(0, 80),
    });
    return fileUrl;
  }

  /** 提交文件转录任务，返回 task_id */
  private async submitTranscription(apiKey: string, fileUrl: string, language: string): Promise<string> {
    const hint = LANGUAGE_HINTS[language] ?? 'zh';
    const res = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: { file_urls: [fileUrl] },
        parameters: { language_hints: [hint] },
      }),
    });
    const body = await this.parseJson(res);
    const taskId: string | undefined = (body?.output as { task_id?: string } | undefined)?.task_id;
    if (!taskId) {
      throw new Error(`DashScope submit failed: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return taskId;
  }

  /** 轮询转录任务直至成功，返回句子级时间戳 */
  private async pollTranscription(apiKey: string, taskId: string): Promise<DashScopeSentence[]> {
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      const res = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription/${taskId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = await this.parseJson(res);
      const output = body?.output as { task_status?: string; message?: string; results?: unknown[] } | undefined;
      const status: string | undefined = output?.task_status;

      if (status === 'SUCCEEDED') {
        const results = Array.isArray(output?.results) ? output.results : [];
        const first = results[0] as { transcription?: { sentences?: unknown[] } } | undefined;
        const transcription = first?.transcription;
        const sentences: DashScopeSentence[] = Array.isArray(transcription?.sentences)
          ? transcription.sentences as DashScopeSentence[]
          : [];
        this.logger?.info('DashScopeAsr transcription succeeded', {
          service: 'DashScopeAsrAdapter',
          method: 'pollTranscription',
          taskId: taskId.slice(0, 8),
          sentenceCount: sentences.length,
          attempts: attempt,
        });
        return sentences;
      }
      if (status === 'FAILED') {
        throw new Error(`DashScope transcription failed: ${output?.message ?? 'unknown'}`);
      }
      if (attempt === MAX_POLL_ATTEMPTS) {
        throw new Error(`DashScope transcription timeout after ${attempt} attempts`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return [];
  }

  private async parseJson(res: Response): Promise<Record<string, unknown> | null> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    if (!res.ok) {
      throw new Error(`DashScope HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}
