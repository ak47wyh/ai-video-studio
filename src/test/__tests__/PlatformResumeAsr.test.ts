/**
 * C1 核心服务回归测试（A1/A2/A3 优化项）
 *
 * 覆盖：
 * - A2 PlatformRouter：model 能力注册、resolveModel 路由、非 MiniMax 抛 UnsupportedCapabilityError
 * - A2 ModelManagementService：懒加载 Port 提供器（构造不触发解析、fetchModels 实时解析）
 * - A1 DashScopeAsrAdapter：未配置 Key 返回 []、网络失败返回 []、成功路径映射毫秒时间戳
 * - A2 PlatformAwareTextSplitter / PlatformAwareStoryBreakdown：平台无 text 能力 → 降级 Mock
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlatformRouter } from '../../domain/services/PlatformRouter';
import { ModelManagementService } from '../../domain/services/ModelManagementService';
import { UnsupportedCapabilityError } from '../../domain/errors/UnsupportedCapabilityError';
import { DashScopeAsrAdapter } from '../../adapters/outbound/api/DashScopeAsrAdapter';
import { PlatformAwareTextSplitter } from '../../adapters/outbound/services/PlatformAwareTextSplitter';
import { PlatformAwareStoryBreakdown } from '../../adapters/outbound/services/PlatformAwareStoryBreakdown';
import { platformCapabilitiesAdapter } from '../../adapters/outbound/infrastructure/PlatformCapabilitiesAdapter';
import type { IApiConfigStore, IModelRegistry } from '../../domain/ports/PlatformPorts';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';
import type { IModelManagementPort, ITextSplitterPort, IStoryBreakdownPort, SegmentDraft, StoryBreakdownResult } from '../../domain/ports/OutboundPorts';
import type { ApiConfig } from '../../domain/entities/platform';

// ---------- 通用 mocks ----------

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    activePlatform: 'minimax',
    minimaxApiKey: 'test-key',
    minimaxGroupId: 'group-1',
    minimaxBaseUrl: 'https://api.minimaxi.com',
    minimaxAnthropicBaseUrl: 'https://api.minimax.io/anthropic',
    volcArkOpenAiApiKey: '',
    volcArkAnthropicApiKey: '',
    volcArkBaseUrl: '',
    volcArkAgentPlanBaseUrl: '',
    volcArkAnthropicBaseUrl: '',
    volcArkTextProtocol: 'openai',
    volcArkAnthropicModel: '',
    volcArkAutoFallback: true,
    volcArkImageModel: 'doubao-seedream-5.0-lite',
    volcVoiceAppId: '',
    volcVoiceAccessToken: '',
    volcVoiceCluster: 'volcano_icl',
    volcVoiceCloneModelType: 1,
    volcSeedTtsModel: 'doubao-seed-tts-2.0',
    volcSeedTtsEnabled: false,
    klingAccessKey: '',
    klingSecretKey: '',
    klingBaseUrl: '',
    wanApiKey: '',
    wanBaseUrl: '',
    hunyuanSecretId: '',
    hunyuanSecretKey: '',
    hunyuanBaseUrl: '',
    zhipuApiKey: '',
    zhipuBaseUrl: '',
    viduApiKey: '',
    viduBaseUrl: '',
    theme: 'dark',
    vconsoleEnabled: false,
    ...overrides,
  } as ApiConfig;
}

function makeConfigStore(config: ApiConfig): IApiConfigStore {
  return {
    load: vi.fn(() => config),
    save: vi.fn(async () => { }),
    autoSave: vi.fn(),
    getActivePlatform: vi.fn(() => config.activePlatform),
    setActivePlatform: vi.fn(async () => { }),
    getApiKeyMasked: vi.fn(() => '***'),
    getToken: vi.fn(() => undefined),
    isPlatformConfigured: vi.fn(() => false),
    onPlatformChange: vi.fn(() => () => { }),
  } as unknown as IApiConfigStore;
}

function makeMockTextPort() {
  return {
    chatCompletion: vi.fn(async () => ({
      content: JSON.stringify([{ content: '场景一', mentionedCharacters: ['张三'] }]),
    })),
    generateText: vi.fn(),
  };
}

function makeMockTextSplitter(): ITextSplitterPort {
  return {
    splitStoryToSegments: vi.fn(async (text: string): Promise<SegmentDraft[]> => [
      { content: text, mentionedCharacters: [] },
    ]),
  };
}

function makeMockStoryBreakdown(): IStoryBreakdownPort {
  return {
    breakdownStory: vi.fn(async (text: string): Promise<StoryBreakdownResult> => ({
      characters: [],
      backgrounds: [],
      segments: [{ content: text, mentionedCharacterNames: [], suggestedBackgroundName: '' }],
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- A2: PlatformRouter model 能力 ----------

describe('PlatformRouter — model 能力（A2）', () => {
  it('注册表声明 minimax 支持 model 能力', () => {
    const router = new PlatformRouter(makeConfigStore(makeConfig()), platformCapabilitiesAdapter, makeLogger());
    expect(router.hasRegistered('minimax', 'model')).toBe(true);
    expect(router.hasRegistered('volcengine', 'model')).toBe(false);
  });

  it('resolveModel 在 minimax 平台返回模型管理 Port', () => {
    const router = new PlatformRouter(makeConfigStore(makeConfig()), platformCapabilitiesAdapter, makeLogger());
    const port = router.resolveModel(makeConfig({ activePlatform: 'minimax' }));
    expect(port).toBeDefined();
    expect(typeof port.listModels).toBe('function');
    expect(typeof port.retrieveModel).toBe('function');
  });

  it('resolve 分发支持 model 能力', () => {
    const router = new PlatformRouter(makeConfigStore(makeConfig()), platformCapabilitiesAdapter, makeLogger());
    const port = router.resolve('model', makeConfig({ activePlatform: 'minimax' }));
    expect(typeof (port as IModelManagementPort).listModels).toBe('function');
  });

  it('非 MiniMax 平台 resolveModel 抛 UnsupportedCapabilityError', () => {
    const router = new PlatformRouter(makeConfigStore(makeConfig()), platformCapabilitiesAdapter, makeLogger());
    expect(() => router.resolveModel(makeConfig({ activePlatform: 'volcengine' }))).toThrow(UnsupportedCapabilityError);
  });
});

// ---------- A2: ModelManagementService 懒加载 provider ----------

describe('ModelManagementService — 懒加载 Port 提供器（A2）', () => {
  function makeModelPort(): IModelManagementPort {
    return {
      listModels: vi.fn(async () => ({ models: [{ id: 'm1', name: 'M1' }], hasMore: false })),
      retrieveModel: vi.fn(async () => ({ id: 'm1', name: 'M1' })),
    } as unknown as IModelManagementPort;
  }

  it('构造时不触发 provider 解析（懒加载）', () => {
    const provider = vi.fn(() => makeModelPort());
    new ModelManagementService(provider, { read: vi.fn(), write: vi.fn() } as never, makeLogger());
    expect(provider).not.toHaveBeenCalled();
  });

  it('fetchModels 通过 provider 实时解析当前平台 Port', async () => {
    const provider = vi.fn(() => makeModelPort());
    const service = new ModelManagementService(provider, { read: vi.fn(), write: vi.fn() } as never, makeLogger());
    const models = await service.fetchModels();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('m1');
  });

  it('provider 抛错时 fetchModels 向上传播（不静默吞掉）', async () => {
    const provider = vi.fn(() => {
      throw new UnsupportedCapabilityError('volcengine', 'model');
    });
    const service = new ModelManagementService(provider, { read: vi.fn(), write: vi.fn() } as never, makeLogger());
    await expect(service.fetchModels()).rejects.toThrow(UnsupportedCapabilityError);
  });
});

// ---------- A1: DashScopeAsrAdapter 降级链 ----------

describe('DashScopeAsrAdapter — 字幕 ASR 降级链（A1）', () => {
  function makeResponse(ok: boolean, body: unknown) {
    return {
      ok,
      status: ok ? 200 : 500,
      text: async () => JSON.stringify(body),
    } as Response;
  }

  it('未配置 wanApiKey 时返回空数组且不发请求', async () => {
    const store = makeConfigStore(makeConfig());
    vi.mocked(store.getToken).mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new DashScopeAsrAdapter(store, makeLogger());
    const result = await adapter.transcribe(new Blob(['audio']), 'zh');
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('上传/提交接口失败时返回空数组（降级平均分配）', async () => {
    const store = makeConfigStore(makeConfig());
    vi.mocked(store.getToken).mockReturnValue('wan-key');
    const fetchMock = vi.fn(async () => makeResponse(false, { message: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new DashScopeAsrAdapter(store, makeLogger());
    const result = await adapter.transcribe(new Blob(['audio']), 'zh');
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('成功路径：上传→提交→轮询 SUCCEEDED，映射毫秒时间戳', async () => {
    const store = makeConfigStore(makeConfig());
    vi.mocked(store.getToken).mockReturnValue('wan-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse(true, { data: { upload_url: 'https://oss/x.mp3' } })) // upload
      .mockResolvedValueOnce(makeResponse(true, { output: { task_id: 'task-1' } }))            // submit
      .mockResolvedValueOnce(makeResponse(true, {
        output: {
          task_status: 'SUCCEEDED',
          results: [{
            transcription: {
              sentences: [
                { begin_time: 100, end_time: 500, text: '你好' },
                { begin_time: 600, end_time: 900, text: '世界', confidence: 0.98 },
              ],
            },
          }],
        },
      })); // poll
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new DashScopeAsrAdapter(store, makeLogger());
    const result = await adapter.transcribe(new Blob(['audio']), 'zh');
    expect(result).toEqual([
      { start: 100, end: 500, text: '你好', confidence: undefined },
      { start: 600, end: 900, text: '世界', confidence: 0.98 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('URL 字符串输入跳过上传，直接提交', async () => {
    const store = makeConfigStore(makeConfig());
    vi.mocked(store.getToken).mockReturnValue('wan-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse(true, { output: { task_id: 'task-2' } }))            // submit
      .mockResolvedValueOnce(makeResponse(true, {
        output: { task_status: 'SUCCEEDED', results: [{ transcription: { sentences: [] } }] },
      })); // poll
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new DashScopeAsrAdapter(store, makeLogger());
    const result = await adapter.transcribe('https://cdn.example.com/a.mp3', 'en');
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------- A2: PlatformAware 拆分/分解降级 ----------

describe('PlatformAware 拆分/分解 — 平台路由降级（A2）', () => {
  it('平台无 text 能力时拆分降级到 Mock', async () => {
    const router = {
      resolveText: vi.fn(() => {
        throw new UnsupportedCapabilityError('kling', 'text');
      }),
    } as unknown as PlatformRouter;
    const configStore = makeConfigStore(makeConfig({ activePlatform: 'kling' }));
    const fallback = makeMockTextSplitter();
    const splitter = new PlatformAwareTextSplitter(router, configStore, fallback, undefined, makeLogger());
    const result = await splitter.splitStoryToSegments('测试文本', []);
    expect(result).toHaveLength(1);
    expect(fallback.splitStoryToSegments).toHaveBeenCalledWith('测试文本', []);
  });

  it('textPort 调用失败时拆分降级到 Mock', async () => {
    const textPort = {
      chatCompletion: vi.fn(async () => { throw new Error('AI 超时'); }),
      generateText: vi.fn(),
    };
    const router = { resolveText: vi.fn(() => textPort) } as unknown as PlatformRouter;
    const configStore = makeConfigStore(makeConfig());
    const fallback = makeMockTextSplitter();
    const modelRegistry = {
      resolveTextModel: vi.fn(() => 'MiniMax-M2.5'),
    } as unknown as IModelRegistry;
    const splitter = new PlatformAwareTextSplitter(router, configStore, fallback, modelRegistry, makeLogger());
    const result = await splitter.splitStoryToSegments('测试文本', []);
    expect(result).toHaveLength(1);
    expect(router.resolveText).toHaveBeenCalled();
    expect(fallback.splitStoryToSegments).toHaveBeenCalled();
  });

  it('AI 成功时返回真实拆分结果（不走 Mock）', async () => {
    const textPort = makeMockTextPort();
    const router = { resolveText: vi.fn(() => textPort) } as unknown as PlatformRouter;
    const configStore = makeConfigStore(makeConfig());
    const fallback = makeMockTextSplitter();
    const splitter = new PlatformAwareTextSplitter(router, configStore, fallback, undefined, makeLogger());
    const result = await splitter.splitStoryToSegments('故事文本', []);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('场景一');
    expect(fallback.splitStoryToSegments).not.toHaveBeenCalled();
  });

  it('平台无 text 能力时一键分解降级到 Mock', async () => {
    const router = {
      resolveText: vi.fn(() => {
        throw new UnsupportedCapabilityError('vidu', 'text');
      }),
    } as unknown as PlatformRouter;
    const configStore = makeConfigStore(makeConfig({ activePlatform: 'vidu' }));
    const fallback = makeMockStoryBreakdown();
    const breakdown = new PlatformAwareStoryBreakdown(router, configStore, fallback, undefined, makeLogger());
    const result = await breakdown.breakdownStory('测试故事');
    expect(result.segments).toHaveLength(1);
    expect(fallback.breakdownStory).toHaveBeenCalledWith('测试故事');
  });
});
