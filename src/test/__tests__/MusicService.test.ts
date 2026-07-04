/**
 * MusicService 单元测试
 *
 * 验证 Phase 2 反转后的依赖注入：
 * - 构造器接受 configStore + logger 注入
 * - getMusicPort 通过 router.resolveMusic 调用
 * - logger 用于告警（不写 console）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MusicService } from '../../domain/services/MusicService';
import type { IMusicPort, IStorySegmentRepository, MusicModel } from '../../domain/ports/OutboundPorts';
import type { IFileStoragePort } from '../../domain/ports/FileStoragePorts';
import type { IApiConfigStore } from '../../domain/ports/PlatformPorts';
import type { ApiConfig } from '../../adapters/outbound/config/ApiConfigStore';
import type { PlatformRouter } from '../../domain/services/PlatformRouter';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';

function makeMockConfig(): ApiConfig {
  return {
    activePlatform: 'minimax',
    minimaxApiKey: '',
    minimaxGroupId: '',
    minimaxBaseUrl: '',
    minimaxAnthropicBaseUrl: '',
    volcArkApiKey: '',
    volcArkBaseUrl: '',
    volcArkAnthropicBaseUrl: '',
    volcArkProtocol: 'openai',
    volcArkAnthropicModel: '',
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

function makeMockSegmentRepo(): IStorySegmentRepository {
  return {
    findById: vi.fn().mockResolvedValue({ id: 'seg1', bgmPrompt: '' }),
    findByStoryId: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    deleteByStoryId: vi.fn(),
  };
}

function makeMockRouter(musicPort: IMusicPort): PlatformRouter {
  return {
    resolve: vi.fn(),
    resolveVideo: vi.fn(),
    resolveImage: vi.fn(),
    resolveText: vi.fn(),
    resolveVoice: vi.fn(),
    resolveMusic: vi.fn().mockReturnValue(musicPort),
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
    blobExists: vi.fn(),
    getObjectUrl: vi.fn().mockResolvedValue('blob:test/music'),
    revokeObjectUrl: vi.fn(),
    initialize: vi.fn(),
    getStats: vi.fn(),
    evictLRU: vi.fn(),
    clearAll: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
    getStorageType: vi.fn().mockReturnValue('opfs'),
  };
}

function makeMockMusicPort(): IMusicPort {
  return {
    generateMusic: vi.fn().mockResolvedValue({
      audioUrl: 'https://example.com/audio.mp3',
      duration: 30,
      sampleRate: 44100,
      bitrate: 256000,
      channel: 2,
      size: 1024,
      status: 200,
    }),
    generateLyrics: vi.fn(),
    preprocessCover: vi.fn(),
  };
}

describe('MusicService', () => {
  let segmentRepo: IStorySegmentRepository;
  let router: PlatformRouter;
  let configStore: IApiConfigStore;
  let fileStorage: IFileStoragePort;
  let musicPort: IMusicPort;
  let logger: ILoggerPort & LoggerCalls;
  let service: MusicService;

  beforeEach(() => {
    segmentRepo = makeMockSegmentRepo();
    musicPort = makeMockMusicPort();
    router = makeMockRouter(musicPort);
    configStore = makeMockConfigStore();
    fileStorage = makeMockFileStorage();
    logger = makeMockLogger();
    service = new MusicService(
      router,
      configStore,
      segmentRepo,
      fileStorage,
      logger,
    );
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['x'], { type: 'audio/mpeg' })),
    }) as unknown as typeof fetch;
  });

  it('uses injected configStore to read current config', async () => {
    await service.generateBGM('seg1', 'happy bgm', { model: 'music-2.6' as MusicModel });

    expect(configStore.load).toHaveBeenCalled();
    expect(router.resolveMusic).toHaveBeenCalled();
  });

  it('generates BGM and persists to fileStorage', async () => {
    await service.generateBGM('seg1', 'happy bgm', { model: 'music-2.6' as MusicModel });

    expect(musicPort.generateMusic).toHaveBeenCalled();
    expect(fileStorage.storeBlob).toHaveBeenCalled();
    expect(segmentRepo.save).toHaveBeenCalled();
  });

  it('logs warning when caching BGM fails', async () => {
    (fileStorage.storeBlob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('storage full'));

    await service.generateBGM('seg1', 'sad bgm', { model: 'music-2.6' as MusicModel });

    expect(logger.calls.some((c) => c[0] === 'warn')).toBe(true);
  });
});