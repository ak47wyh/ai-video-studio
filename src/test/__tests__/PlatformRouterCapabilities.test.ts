/**
 * C1 补充：PlatformRouter 五类能力注册/路由/缓存（A2 平台路由全覆盖）
 *
 * 覆盖（与 PlatformResumeAsr.test.ts 的 model 能力互补）：
 * - video/image/text/voice/music 五类能力在各平台的注册完备性
 * - resolveImage/resolveText/resolveVoice/resolveMusic 返回对应 Port 实例
 * - 同平台缓存复用（同一实例）
 * - 平台切换触发 onPlatformChange → reset → 新实例
 * - 未注册组合抛 UnsupportedCapabilityError
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlatformRouter } from '../../domain/services/PlatformRouter';
import { UnsupportedCapabilityError } from '../../domain/errors/UnsupportedCapabilityError';
import { platformCapabilitiesAdapter } from '../../adapters/outbound/infrastructure/PlatformCapabilitiesAdapter';
import type { IApiConfigStore } from '../../domain/ports/PlatformPorts';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';
import type { ApiConfig } from '../../domain/entities/platform';

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeConfig(activePlatform: string): ApiConfig {
  return {
    activePlatform,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PlatformRouter — 五类能力注册完备性（A2）', () => {
  function makeRouter() {
    return new PlatformRouter(makeConfigStore(makeConfig('volcengine')), platformCapabilitiesAdapter, makeLogger());
  }

  it('video 能力：volcengine/kling/wan/hunyuan/zhipu/vidu/minimax 全部注册', () => {
    const router = makeRouter();
    for (const p of ['volcengine', 'kling', 'wan', 'hunyuan', 'zhipu', 'vidu', 'minimax'] as const) {
      expect(router.hasRegistered(p, 'video')).toBe(true);
    }
  });

  it('image 能力：7 平台全部注册', () => {
    const router = makeRouter();
    for (const p of ['volcengine', 'kling', 'wan', 'hunyuan', 'zhipu', 'vidu', 'minimax'] as const) {
      expect(router.hasRegistered(p, 'image')).toBe(true);
    }
  });

  it('text 能力：volcengine/wan/hunyuan/zhipu/minimax 注册（kling/vidu 不注册）', () => {
    const router = makeRouter();
    for (const p of ['volcengine', 'wan', 'hunyuan', 'zhipu', 'minimax'] as const) {
      expect(router.hasRegistered(p, 'text')).toBe(true);
    }
    expect(router.hasRegistered('kling', 'text')).toBe(false);
    expect(router.hasRegistered('vidu', 'text')).toBe(false);
  });

  it('voice/music/model 能力注册符合预期', () => {
    const router = makeRouter();
    // voice：volcengine + minimax
    expect(router.hasRegistered('volcengine', 'voice')).toBe(true);
    expect(router.hasRegistered('minimax', 'voice')).toBe(true);
    // music：minimax
    expect(router.hasRegistered('minimax', 'music')).toBe(true);
    expect(router.hasRegistered('volcengine', 'music')).toBe(false);
    // model：minimax
    expect(router.hasRegistered('minimax', 'model')).toBe(true);
    expect(router.hasRegistered('volcengine', 'model')).toBe(false);
  });
});

describe('PlatformRouter — resolve 路由返回对应 Port（A2）', () => {
  function makeRouter() {
    return new PlatformRouter(makeConfigStore(makeConfig('volcengine')), platformCapabilitiesAdapter, makeLogger());
  }

  it('resolveImage(volcengine) 返回含 generateImage 的 Port', () => {
    const port = makeRouter().resolveImage(makeConfig('volcengine'));
    expect(typeof (port as { generateImage?: unknown }).generateImage).toBe('function');
  });

  it('resolveText(wan) 返回含 chatCompletion 的 Port', () => {
    const port = makeRouter().resolveText(makeConfig('wan'));
    expect(typeof (port as { chatCompletion?: unknown }).chatCompletion).toBe('function');
  });

  it('resolveVoice(volcengine) 返回含 synthesizeSpeech 的 Port', () => {
    const port = makeRouter().resolveVoice(makeConfig('volcengine'));
    expect(typeof (port as { synthesizeSpeechSync?: unknown }).synthesizeSpeechSync).toBe('function');
  });

  it('resolveMusic(minimax) 返回含 recommendMusic 的 Port', () => {
    const port = makeRouter().resolveMusic(makeConfig('minimax'));
    expect(typeof (port as { generateMusic?: unknown }).generateMusic).toBe('function');
  });

  it('同平台同能力二次 resolve 命中缓存返回同一实例', () => {
    const router = makeRouter();
    const a = router.resolveImage(makeConfig('volcengine'));
    const b = router.resolveImage(makeConfig('volcengine'));
    expect(a).toBe(b);
  });

  it('平台切换（onPlatformChange 回调）后缓存失效，返回新实例', () => {
    const store = makeConfigStore(makeConfig('volcengine'));
    const router = new PlatformRouter(store, platformCapabilitiesAdapter, makeLogger());
    const changeCb = vi.mocked(store.onPlatformChange).mock.calls[0][0];
    const a = router.resolveImage(makeConfig('volcengine'));
    changeCb('volcengine', 'kling'); // 模拟平台切换 → reset
    const b = router.resolveImage(makeConfig('volcengine'));
    expect(a).not.toBe(b);
  });

  it('未注册组合（kling music）抛 UnsupportedCapabilityError', () => {
    const router = makeRouter();
    expect(() => router.resolveMusic(makeConfig('kling'))).toThrow(UnsupportedCapabilityError);
  });

  it('未注册组合（volcengine model）抛 UnsupportedCapabilityError', () => {
    const router = makeRouter();
    expect(() => router.resolveModel(makeConfig('volcengine'))).toThrow(UnsupportedCapabilityError);
  });
});
