/**
 * SYSTEM_OPTIMIZATION_PLAN SU-1：火山引擎录音文件识别（极速版）适配器
 * - 公网 URL 音频 + 已配置火山语音三件套 → 走火山 flash 极速版（utterances 毫秒时间戳）
 * - Blob 输入 / 未配置 / 请求失败 / 结果为空 → 转交 fallback（DashScopeAsrAdapter 保持真实转录）
 */
import { describe, expect, it, vi } from 'vitest';
import { VolcengineAsrAdapter } from '../../adapters/outbound/api/VolcengineAsrAdapter';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';
import type { IWhisperPort } from '../../domain/ports/PostProcessPorts';

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeConfig(configured: boolean) {
  return {
    load: vi.fn(() => ({
      volcVoiceAppId: configured ? 'app-1' : '',
      volcVoiceAccessToken: configured ? 'token-1' : '',
    })),
  } as unknown as { load: ReturnType<typeof vi.fn> };
}

function makeFallback(): IWhisperPort & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async () => { }),
    isLoaded: vi.fn(() => true),
    transcribe: vi.fn(async (audio: Blob | string) =>
      typeof audio === 'string'
        ? [{ start: 100, end: 200, text: 'fallback url text' }]
        : [{ start: 0, end: 100, text: 'fallback blob text' }],
    ),
  } as never;
}

interface FetchCall {
  input: unknown;
  init?: { body?: string };
}

/** 从已 stub 的 global fetch 中取调用参数 */
function fetchCallAt(index: number): FetchCall {
  const f = globalThis.fetch as unknown as { mock: { calls: Array<[unknown, { body?: string } | undefined]> } };
  const call = f.mock.calls[index];
  return { input: call[0], init: call[1] };
}

function stubFlashResponse(statusCode: string, message: string, payload: string) {
  const mock = vi.fn(async () => ({
    ok: true,
    headers: { get: (k: string) => (k === 'X-Api-Status-Code' ? statusCode : k === 'X-Api-Message' ? message : null) },
    text: vi.fn(async () => payload),
  }));
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
}

describe('VolcengineAsrAdapter（SU-1）', () => {
  it('公网 URL + 已配置火山语音：走 flash 极速版并返回句子时间戳', async () => {
    const config = makeConfig(true);
    const fallback = makeFallback();
    const adapter = new VolcengineAsrAdapter(config as never, makeLogger(), fallback);
    stubFlashResponse('20000000', 'OK', JSON.stringify({
      result: {
        text: '你好世界',
        utterances: [
          { text: '你好', start_time: 100, end_time: 900 },
          { text: '世界', start_time: 1000, end_time: 1900 },
        ],
      },
    }));

    const segments = await adapter.transcribe('https://cdn.example.com/a.mp3', 'zh');
    expect(segments.length).toBe(2);
    expect(segments[0]).toEqual({ start: 100, end: 900, text: '你好' });
    expect(fallback.transcribe).not.toHaveBeenCalled();
    const body = JSON.parse(fetchCallAt(0).init?.body ?? '{}');
    expect(body.request.model_name).toBe('bigmodel');
    expect(body.request.show_utterances).toBe(true);
    expect(body.request.language).toBe('zh-CN');
  });

  it('Blob 输入转交 fallback（火山极速版需公网 URL）', async () => {
    const adapter = new VolcengineAsrAdapter(makeConfig(true) as never, makeLogger(), makeFallback());
    const segments = await adapter.transcribe(new Blob(['audio'], { type: 'audio/mp3' }), 'zh');
    expect(segments.length).toBe(1);
    expect(segments[0].text).toBe('fallback blob text');
  });

  it('未配置火山语音时转交 fallback', async () => {
    const fallback = makeFallback();
    const adapter = new VolcengineAsrAdapter(makeConfig(false) as never, makeLogger(), fallback);
    const segments = await adapter.transcribe('https://cdn.example.com/a.mp3', 'zh');
    expect(segments[0].text).toBe('fallback url text');
  });

  it('请求失败（状态码非 20000000）转交 fallback', async () => {
    const fallback = makeFallback();
    const adapter = new VolcengineAsrAdapter(makeConfig(true) as never, makeLogger(), fallback);
    stubFlashResponse('40100001', 'AUTH_FAILED', '{}');
    const segments = await adapter.transcribe('https://cdn.example.com/a.mp3', 'zh');
    expect(segments[0].text).toBe('fallback url text');
  });

  it('无 fallback 时降级为空数组（字幕平均分配兜底）', async () => {
    const adapter = new VolcengineAsrAdapter(makeConfig(false) as never, makeLogger());
    const segments = await adapter.transcribe('https://cdn.example.com/a.mp3', 'zh');
    expect(segments).toEqual([]);
  });
});
