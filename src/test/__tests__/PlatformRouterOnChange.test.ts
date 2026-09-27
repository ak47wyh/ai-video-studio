/**
 * SYSTEM_OPTIMIZATION_PLAN V-1：轮询器生命周期治理
 * - PlatformRouter.onChange：平台切换/配置变更触发 reset 时通知订阅者（轮询器联动清理）
 * - 退订语义：返回的取消函数使监听器不再触发
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlatformRouter } from '../../domain/services/PlatformRouter';
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

function makeConfig(): ApiConfig {
  return {
    activePlatform: 'volcengine',
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PlatformRouter.onChange — V-1 轮询器联动清理', () => {
  function makeRouter() {
    return new PlatformRouter(makeConfigStore(makeConfig()), platformCapabilitiesAdapter, makeLogger());
  }

  it('订阅者在 reset() 时收到通知（平台切换 → 清空轮询器）', () => {
    const router = makeRouter();
    const listener = vi.fn();
    router.onChange(listener);
    router.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('退订后 reset() 不再通知', () => {
    const router = makeRouter();
    const listener = vi.fn();
    const unsubscribe = router.onChange(listener);
    unsubscribe();
    router.reset();
    expect(listener).not.toHaveBeenCalled();
  });

  it('多个订阅者全部收到通知', () => {
    const router = makeRouter();
    const a = vi.fn();
    const b = vi.fn();
    router.onChange(a);
    router.onChange(b);
    router.reset();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('未订阅时 reset() 不抛错（构造函数内首次 reset 安全）', () => {
    const router = makeRouter();
    expect(() => router.reset()).not.toThrow();
  });

  it('同一监听器重复注册按 Set 幂等语义仅存一份，退订即全部退订', () => {
    const router = makeRouter();
    const listener = vi.fn();
    const un1 = router.onChange(listener);
    const un2 = router.onChange(listener);
    un2();
    router.reset();
    expect(listener).toHaveBeenCalledTimes(0);
    un1();
    router.reset();
    expect(listener).not.toHaveBeenCalled();
  });
});
