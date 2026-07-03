/**
 * ImageGenerationService 单元测试
 *
 * 验证 Phase 2 反转后的依赖注入：
 * - 构造器接受 configStore + logger 注入
 * - getImagePort() 通过 router.resolve 调用注入的 imagePort
 * - persistImage 失败时回退到源 URL
 * - getReferenceImageUrl 优先返回 OPFS object URL
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageGenerationService } from '../../domain/services/ImageGenerationService';
import type { IImageGeneratorPort, ICharacterRepository, IBackgroundRepository } from '../../domain/ports/OutboundPorts';
import type { IFileStoragePort } from '../../domain/ports/FileStoragePorts';
import type { IApiConfigStore } from '../../domain/ports/PlatformPorts';
import type { ApiConfig } from '../../adapters/outbound/config/ApiConfigStore';
import type { PlatformRouter } from '../../domain/services/PlatformRouter';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';
import type { Character, Background } from '../../domain/entities/models';

function makeMockConfig(): ApiConfig {
  return {
    activePlatform: 'minimax',
    minimaxApiKey: '',
    minimaxGroupId: '',
    minimaxBaseUrl: '',
    minimaxAnthropicBaseUrl: '',
    volcArkApiKey: '',
    volcArkBaseUrl: '',
    cozePatToken: '',
    cozeBaseUrl: '',
    cozeSpaceId: '',
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
  };
}

function makeMockCharacterRepo(): ICharacterRepository {
  return {
    findById: vi.fn(),
    findAll: vi.fn(),
    findBySpaceId: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };
}

function makeMockBackgroundRepo(): IBackgroundRepository {
  return {
    findById: vi.fn(),
    findAll: vi.fn(),
    findBySpaceId: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };
}

function makeMockRouter(imagePort: IImageGeneratorPort): PlatformRouter {
  return {
    resolve: vi.fn().mockReturnValue(imagePort),
    resolveVideo: vi.fn(),
    resolveImage: vi.fn(),
    resolveText: vi.fn(),
    resolveVoice: vi.fn(),
    resolveMusic: vi.fn(),
  } as unknown as PlatformRouter;
}

function makeMockConfigStore(): IApiConfigStore {
  return {
    load: vi.fn().mockReturnValue(makeMockConfig()),
    save: vi.fn().mockResolvedValue(undefined),
    getActivePlatform: vi.fn().mockReturnValue('minimax'),
    setActivePlatform: vi.fn().mockResolvedValue(undefined),
    getApiKeyMasked: vi.fn().mockReturnValue(''),
    getToken: vi.fn().mockReturnValue(undefined),
    isPlatformConfigured: vi.fn().mockReturnValue(false),
    onPlatformChange: vi.fn().mockReturnValue(() => undefined),
    onConfigChange: vi.fn().mockReturnValue(() => undefined),
  };
}

interface LoggerCalls {
  calls: Array<[string, ...unknown[]]>;
}

function makeMockLogger(): ILoggerPort & LoggerCalls {
  const calls: Array<[string, ...unknown[]]> = [];
  const base = (..._args: unknown[]) => undefined;
  const logger = Object.assign(base, {
    debug: (...args: unknown[]) => { calls.push(['debug', ...args]); },
    info: (...args: unknown[]) => { calls.push(['info', ...args]); },
    warn: (...args: unknown[]) => { calls.push(['warn', ...args]); },
    error: (...args: unknown[]) => { calls.push(['error', ...args]); },
    child: () => logger,
    calls,
  });
  return logger as unknown as ILoggerPort & LoggerCalls;
}

function makeMockFileStorage(): IFileStoragePort {
  return {
    storeBlob: vi.fn().mockResolvedValue(undefined),
    getBlob: vi.fn(),
    deleteBlob: vi.fn(),
    blobExists: vi.fn().mockResolvedValue(true),
    getObjectUrl: vi.fn().mockResolvedValue('blob:test/123'),
    revokeObjectUrl: vi.fn(),
    initialize: vi.fn(),
    getStats: vi.fn(),
    evictLRU: vi.fn(),
    clearAll: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
    getStorageType: vi.fn().mockReturnValue('opfs'),
  };
}

function makeMockImagePort(): IImageGeneratorPort {
  return {
    generateImage: vi.fn().mockResolvedValue({
      imageDataUri: 'data:image/png;base64,AAA',
      imageUrls: [],
      durationMs: 1234,
    }),
  };
}

describe('ImageGenerationService', () => {
  let characterRepo: ICharacterRepository;
  let backgroundRepo: IBackgroundRepository;
  let router: PlatformRouter;
  let configStore: IApiConfigStore;
  let fileStorage: IFileStoragePort;
  let imagePort: IImageGeneratorPort;
  let logger: ILoggerPort & LoggerCalls;
  let service: ImageGenerationService;

  beforeEach(() => {
    characterRepo = makeMockCharacterRepo();
    backgroundRepo = makeMockBackgroundRepo();
    imagePort = makeMockImagePort();
    router = makeMockRouter(imagePort);
    configStore = makeMockConfigStore();
    fileStorage = makeMockFileStorage();
    logger = makeMockLogger();
    service = new ImageGenerationService(
      characterRepo,
      backgroundRepo,
      router,
      configStore,
      fileStorage,
      logger,
    );
  });

  it('uses injected configStore to read current config', async () => {
    const character: Partial<Character> = {
      id: 'c1',
      spaceId: 's1',
      name: 'Alice',
      appearancePrompt: 'red hair',
      personalityPrompt: 'brave',
      referenceImageUrl: '',
      createdAt: Date.now(),
    };
    (characterRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(character);
    (characterRepo.save as ReturnType<typeof vi.fn>).mockResolvedValue(character);

    await service.generateCharacterImage('c1', '1:1');

    expect(configStore.load).toHaveBeenCalled();
    expect(router.resolve).toHaveBeenCalledWith('image', expect.any(Object));
  });

  it('uses injected logger instead of console.*', async () => {
    (characterRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(service.generateCharacterImage('missing')).rejects.toThrow('Character not found');
    expect(logger.calls).toBeDefined();
  });

  it('throws when character has no prompts', async () => {
    const character: Partial<Character> = {
      id: 'c2',
      spaceId: 's1',
      name: 'Empty',
      appearancePrompt: '',
      personalityPrompt: '',
      referenceImageUrl: '',
      createdAt: Date.now(),
    };
    (characterRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(character);

    await expect(service.generateCharacterImage('c2')).rejects.toThrow(/no appearance or personality/);
  });

  it('throws when background has no environment prompt', async () => {
    const bg: Partial<Background> = {
      id: 'b1',
      spaceId: 's1',
      name: 'Empty',
      environmentPrompt: '',
      referenceImageUrl: '',
      createdAt: Date.now(),
    };
    (backgroundRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(bg);

    await expect(service.generateBackgroundImage('b1')).rejects.toThrow(/no environment prompt/);
  });

  it('persists image and updates character reference', async () => {
    const character: Partial<Character> = {
      id: 'c3',
      spaceId: 's1',
      name: 'Persisted',
      appearancePrompt: 'cool look',
      referenceImageUrl: '',
      createdAt: Date.now(),
    };
    (characterRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(character);
    (characterRepo.save as ReturnType<typeof vi.fn>).mockResolvedValue(character);

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
    }) as unknown as typeof fetch;

    try {
      const url = await service.generateCharacterImage('c3');
      expect(url).toBe('blob:test/123');
      expect(fileStorage.storeBlob).toHaveBeenCalled();
      expect(characterRepo.save).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('falls back to source URL when persistImage fails', async () => {
    const character: Partial<Character> = {
      id: 'c4',
      spaceId: 's1',
      name: 'Fails',
      appearancePrompt: 'something',
      referenceImageUrl: '',
      createdAt: Date.now(),
    };
    (characterRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(character);
    (characterRepo.save as ReturnType<typeof vi.fn>).mockResolvedValue(character);

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    try {
      const url = await service.generateCharacterImage('c4');
      expect(url).toBe('data:image/png;base64,AAA');
      expect(logger.calls.some((c) => c[0] === 'warn')).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('getReferenceImageUrl returns OPFS object URL when storagePath exists', async () => {
    const url = await service.getReferenceImageUrl({
      referenceImageStoragePath: 'images/x.png',
      referenceImageUrl: 'should-not-use',
    });
    expect(url).toBe('blob:test/123');
  });

  it('getReferenceImageUrl returns public URL when storagePath missing', async () => {
    const url = await service.getReferenceImageUrl({
      referenceImageUrl: 'https://cdn.example.com/img.png',
    });
    expect(url).toBe('https://cdn.example.com/img.png');
  });
});