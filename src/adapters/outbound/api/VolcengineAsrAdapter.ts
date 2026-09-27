/**
 * VolcengineAsrAdapter —— SU-1 火山引擎录音文件识别（极速版 HTTP）
 *
 * 协议（火山引擎豆包语音，2026-09 文档核实）：
 *   POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash
 *   鉴权（旧版控制台）：X-Api-App-Key（volcVoiceAppId）/ X-Api-Access-Key（volcVoiceAccessToken）
 *   Body: { audio: { url }, request: { model_name: 'bigmodel', show_utterances: true, ... } }
 *   响应: body.result.text + body.result.utterances[{ text, start_time, end_time }]（毫秒）
 *
 * 约束与降级链：
 * - 极速版要求 audio.url 为公网可访问 URL；本地 Blob 输入本适配器不支持（项目暂无对象存储
 *   上传通道），将转交 fallbackPort（DashScopeAsrAdapter 支持 Blob 直传，保持真实转录体验）。
 * - 未配置火山语音三件套（AppID/AccessToken）或请求失败时同样转交 fallbackPort；无 fallback
 *   时返回空数组，由 SubtitleService 降级到 distributeEvenly()，字幕功能始终可用。
 */
import type { IWhisperPort, TranscriptSegment } from '../../../domain/ports/PostProcessPorts';
import type { IApiConfigStore } from '../../../domain/ports/PlatformPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

const FLASH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const RESOURCE_ID = 'volc.bigasr.auc_turbo';

/** IWhisperPort 语言 → 火山识别语种（仅映射本项目字幕常用语种，其余回退自动识别） */
const LANGUAGE_MAP: Record<string, string> = {
  zh: 'zh-CN',
  'zh-CN': 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  es: 'es-MX',
  pt: 'pt-BR',
  de: 'de-DE',
  fr: 'fr-FR',
  ru: 'ru-RU',
  it: 'it-IT',
};

interface FlashUtterance {
  text?: string;
  start_time?: number;
  end_time?: number;
}

export class VolcengineAsrAdapter implements IWhisperPort {
  private configStore: IApiConfigStore;
  private logger?: ILoggerPort;
  private fallback?: IWhisperPort;

  constructor(configStore: IApiConfigStore, logger?: ILoggerPort, fallback?: IWhisperPort) {
    this.configStore = configStore;
    this.logger = logger;
    this.fallback = fallback;
  }

  isLoaded(): boolean {
    return true;
  }

  async load(): Promise<void> {
    // no-op：鉴权按需在 transcribe 中解析
  }

  async transcribe(audio: Blob | string, language = 'zh'): Promise<TranscriptSegment[]> {
    // 极速版要求公网 URL；Blob 输入转交 fallback（DashScope 支持 Blob 直传）
    if (typeof audio !== 'string' || !/^https?:\/\//.test(audio)) {
      this.logger?.warn('VolcengineAsr: 极速版需公网音频 URL，Blob 输入转交 fallback', {
        service: 'VolcengineAsrAdapter',
        method: 'transcribe',
      });
      return this.fallback?.transcribe(audio, language) ?? [];
    }

    const config = this.configStore.load();
    if (!config.volcVoiceAppId.trim() || !config.volcVoiceAccessToken.trim()) {
      this.logger?.warn('VolcengineAsr: 火山语音未配置（AppID/AccessToken），转交 fallback', {
        service: 'VolcengineAsrAdapter',
        method: 'transcribe',
      });
      return this.fallback?.transcribe(audio, language) ?? [];
    }

    try {
      const segments = await this.recognizeFlash(audio, language, config);
      if (segments.length > 0) {
        this.logger?.info('VolcengineAsr: flash recognition ok', {
          service: 'VolcengineAsrAdapter',
          method: 'transcribe',
          url: (audio as string).slice(0, 80),
          segmentCount: segments.length,
          language,
        });
        return segments;
      }
      this.logger?.warn('VolcengineAsr: 识别结果为空，转交 fallback', {
        service: 'VolcengineAsrAdapter',
        method: 'transcribe',
      });
      return this.fallback?.transcribe(audio, language) ?? [];
    } catch (e) {
      this.logger?.warn('VolcengineAsr: 转录失败，转交 fallback', {
        service: 'VolcengineAsrAdapter',
        method: 'transcribe',
        language,
        error: e instanceof Error ? e.message : String(e),
      });
      return this.fallback?.transcribe(audio, language) ?? [];
    }
  }

  private async recognizeFlash(
    url: string,
    language: string,
    config: { volcVoiceAppId: string; volcVoiceAccessToken: string },
  ): Promise<TranscriptSegment[]> {
    const res = await fetch(FLASH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Key': config.volcVoiceAppId,
        'X-Api-Access-Key': config.volcVoiceAccessToken,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Request-Id': this.uuid(),
        'X-Api-Sequence': '-1',
      },
      body: JSON.stringify({
        audio: { url },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
          show_utterances: true,
          ...(LANGUAGE_MAP[language] ? { language: LANGUAGE_MAP[language] } : {}),
        },
      }),
    });

    const statusCode = res.headers.get('X-Api-Status-Code') ?? '';
    const apiMessage = res.headers.get('X-Api-Message') ?? '';
    if (statusCode !== '20000000' && apiMessage !== 'OK') {
      throw new Error(`Volcengine flash status ${statusCode} ${apiMessage}`);
    }

    const body = await this.parseJson(res);
    const result = body?.result as { utterances?: FlashUtterance[] } | undefined;
    const utterances = Array.isArray(result?.utterances) ? result.utterances : [];
    return utterances
      .map((u) => ({
        start: u.start_time ?? 0,
        end: u.end_time ?? 0,
        text: (u.text ?? '').trim(),
      }))
      .filter((s) => s.text.length > 0);
  }

  private async parseJson(res: Response): Promise<Record<string, unknown> | null> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    if (!res.ok) {
      throw new Error(`Volcengine HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
