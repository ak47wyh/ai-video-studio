/**
 * SYSTEM_OPTIMIZATION_PLAN V-2：轮询超时自动重试
 * - 首次轮询超时（60×3s）不直接 FAILED，置 retryCount=1 并等待 30s 后重启轮询
 * - 重试轮询仍超时才标记 FAILED（单次网络抖动不导致分镜失败）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { VideoGenerationService } from '../../domain/services/VideoGenerationService';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';
import type { IVideoTaskRepository } from '../../domain/ports/OutboundPorts';
import type { VideoTask } from '../../domain/entities/models';
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

function makeConfig(): ApiConfig {
  return {
    activePlatform: 'volcengine',
    minimaxApiKey: 'k',
    minimaxGroupId: 'g',
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

interface RepoMocks {
  save: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  findByStatuses: ReturnType<typeof vi.fn>;
}

function makeRepo(): RepoMocks & IVideoTaskRepository {
  const m = {
    save: vi.fn(async () => { }),
    findById: vi.fn(async (id: string) => {
      const t: VideoTask = { id, segmentId: 'seg-1', targetPlatform: 'volcengine', status: 'PROCESSING', externalTaskId: 'ext-1', createdAt: 0, retryCount: 0 };
      return t;
    }),
    updateStatus: vi.fn(async () => { }),
    findByStatuses: vi.fn(async () => []),
  };
  return {
    ...m,
    save: m.save,
    findById: m.findById,
    updateStatus: m.updateStatus,
    findByStatuses: m.findByStatuses,
    findBySegmentId: vi.fn(async () => []),
    findLatestBySegmentId: vi.fn(async () => null),
    deleteBySegmentIds: vi.fn(async () => { }),
  } as unknown as IVideoTaskRepository & RepoMocks;
}

function makeService(repo: IVideoTaskRepository, routerOverride?: unknown) {
  const router = routerOverride ?? {
    resolve: vi.fn(() => ({
      submitVideoTask: vi.fn(async () => 'ext-1'),
      queryTaskStatus: vi.fn(async () => ({ status: 'PROCESSING' })),
    })),
    resolveVideo: vi.fn(() => ({
      submitVideoTask: vi.fn(async () => 'ext-1'),
      queryTaskStatus: vi.fn(async () => ({ status: 'PROCESSING' })),
    })),
    resolveImage: vi.fn(),
    resolveText: vi.fn(),
    resolveVoice: vi.fn(),
    resolveMusic: vi.fn(),
    onChange: vi.fn(() => () => { }),
  } as unknown as ConstructorParameters<typeof VideoGenerationService>[3];
  const configStore = { load: vi.fn(() => makeConfig()) } as unknown as ConstructorParameters<typeof VideoGenerationService>[5];
  const segmentRepo = {
    findByStoryId: vi.fn(async () => [{ id: 'seg-1', storyId: 's-1', mentionedCharacters: [], content: '测试', order: 1, selectedBackgroundId: 'bg-1' }]),
  };
  const svc = new VideoGenerationService(
    repo,
    segmentRepo as never,
    {} as never,
    { findById: vi.fn(async () => null) } as never,
    router as never,
    () => ({ storeBlob: vi.fn(async () => { }), blobExists: vi.fn(async () => false), getObjectUrl: vi.fn(() => '') }) as never,
    configStore as never,
    makeLogger(),
  );
  return svc;
}

describe('VideoGenerationService 超时自动重试（V-2）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次轮询超时后保存 retryCount=1 并安排 30s 后重试（不直接 FAILED）', async () => {
    const repo = makeRepo();
    const svc = makeService(repo);
    // 通过私有轮询入口的等价路径：直接提交任务（processTask 内部 pollTaskStatus）
    await svc.generateVideo('seg-1', 's-1', 'volcengine');
    // 60 次轮询（3s 间隔）→ 超时
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    const saved = repo.save.mock.calls.map(c => c[0] as VideoTask);
    expect(saved.some(t => t.retryCount === 1)).toBe(true);
    // 未标记 FAILED（等待重试中）
    expect(repo.updateStatus).not.toHaveBeenCalledWith('seg-1', 'FAILED', undefined, expect.anything());
  });

  it('重试轮询仍超时后标记 FAILED（retryCount 达上限）', async () => {
    const repo = makeRepo();
    // findById 返回已重试 1 次的任务
    repo.findById.mockImplementation(async (id: string) => {
      const t: VideoTask = { id, segmentId: 'seg-1', targetPlatform: 'volcengine', status: 'PROCESSING', externalTaskId: 'ext-1', createdAt: 0, retryCount: 1 };
      return t;
    });
    const svc = makeService(repo);
    await svc.generateVideo('seg-1', 's-1', 'volcengine');
    // 第一轮超时（retryCount 已=1 → 不再重试 → 直接 FAILED）
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    const failedCalls = repo.updateStatus.mock.calls.filter(c => c[1] === 'FAILED');
    expect(failedCalls.length).toBe(1);
    expect(String(failedCalls[0][3])).toContain('Polling timeout');
  });

  it('任务成功时不触发重试逻辑', async () => {
    const repo = makeRepo();
    const router = {
      resolve: vi.fn(() => ({
        submitVideoTask: vi.fn(async () => 'ext-1'),
        queryTaskStatus: vi.fn(async () => ({ status: 'SUCCESS', videoUrl: 'https://x/v.mp4' })),
      })),
      resolveVideo: vi.fn(() => ({
        submitVideoTask: vi.fn(async () => 'ext-1'),
        queryTaskStatus: vi.fn(async () => ({ status: 'SUCCESS', videoUrl: 'https://x/v.mp4' })),
      })),
    } as unknown;
    const svc = makeService(repo, router);
    await svc.generateVideo('seg-1', 's-1', 'volcengine');
    await vi.advanceTimersByTimeAsync(1000);
    const successCalls = repo.updateStatus.mock.calls.filter(c => c[1] === 'SUCCESS');
    expect(successCalls.length).toBe(1);
    expect(successCalls[0][2]).toBe('https://x/v.mp4');
    expect(repo.save.mock.calls.some(c => (c[0] as VideoTask).retryCount === 1)).toBe(false);
  });
});
