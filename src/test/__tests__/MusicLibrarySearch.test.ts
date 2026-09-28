/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 M-2：音乐库浏览（一期 FMA）
 * - MusicService.searchLibrary 委托 libraryPort
 * - importTrack：下载 → 文件存储 → saved_bgm（sourceType=import）
 * - FreeMusicArchiveAdapter：API 失败归一化为 MusicLibraryUnavailableError
 */
import { describe, expect, it, vi } from 'vitest';
import { MusicService } from '../../domain/services/MusicService';
import { FreeMusicArchiveAdapter } from '../../adapters/outbound/api/freemusicarchive/FreeMusicArchiveAdapter';
import { MusicLibraryUnavailableError, type IMusicLibraryPort, type MusicTrack } from '../../domain/ports/MusicLibraryPorts';
import type { SavedBgm } from '../../domain/entities/models';

const TRACK: MusicTrack = { id: 't1', title: 'Sunny', artist: 'Artist A', durationSec: 180, genre: 'Folk', license: 'CC-BY' };

function makeBase(overrides: Record<string, unknown> = {}) {
  return {
    router: { resolveMusic: vi.fn(), resolveText: vi.fn() },
    configStore: { load: vi.fn(() => ({ activePlatform: 'mock' })) },
    segmentRepo: { findById: vi.fn() },
    fileStorage: { storeBlob: vi.fn(async () => { }), getBlob: vi.fn(), deleteBlob: vi.fn(), blobExists: vi.fn(), getObjectUrl: vi.fn(), releaseObjectUrl: vi.fn(), initialize: vi.fn(), getStats: vi.fn(), evictLRU: vi.fn(), clearAll: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    ...overrides,
  };
}

type MusicServiceCtor = {
  new(
    router: unknown, configStore: unknown, segmentRepo: unknown,
    fileStorage: unknown, logger: unknown,
    costMeter?: unknown, httpFetch?: unknown, libraryPort?: unknown, savedBgmRepo?: unknown,
  ): MusicService;
};

describe('M-2 音乐库浏览', () => {
  function buildService(opts: { library?: IMusicLibraryPort; httpFetch?: unknown; savedBgmRepo?: unknown; fileStorage?: unknown } = {}): MusicService {
    const Ctor = MusicService as unknown as MusicServiceCtor;
    const base = makeBase();
    return new Ctor(
      base.router, base.configStore, base.segmentRepo,
      opts.fileStorage ?? base.fileStorage, base.logger,
      undefined, opts.httpFetch, opts.library, opts.savedBgmRepo,
    );
  }

  it('searchLibrary 委托 libraryPort.search', async () => {
    const library = { search: vi.fn(async () => [TRACK]), getPreviewUrl: vi.fn(), getDownloadUrl: vi.fn() } as unknown as IMusicLibraryPort;
    const svc = buildService({ library });
    const result = await svc.searchLibrary({ keyword: 'sunny' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Sunny');
    expect(library.search).toHaveBeenCalledWith({ keyword: 'sunny', genre: undefined });
  });

  it('未注入 libraryPort 时抛明确错误', async () => {
    const svc = buildService();
    await expect(svc.searchLibrary({})).rejects.toThrow(/libraryPort not injected/);
  });

  it('importTrack 下载并保存到 saved_bgm（sourceType=import）', async () => {
    const library = {
      search: vi.fn(),
      getPreviewUrl: vi.fn(),
      getDownloadUrl: vi.fn(async () => 'https://fma/t1.mp3'),
    } as unknown as IMusicLibraryPort;
    const saved: SavedBgm[] = [];
    const savedBgmRepo = {
      save: vi.fn(async (b: SavedBgm) => { saved.push(b); }),
      getById: vi.fn(), query: vi.fn(), delete: vi.fn(), count: vi.fn(),
    };
    const httpFetch = { fetchBlob: vi.fn(async () => new Blob(['audio'], { type: 'audio/mpeg' })) };
    const svc = buildService({
      library,
      httpFetch,
      savedBgmRepo,
      fileStorage: { storeBlob: vi.fn(async () => { }), getBlob: vi.fn(), deleteBlob: vi.fn(), blobExists: vi.fn(), getObjectUrl: vi.fn(), releaseObjectUrl: vi.fn(), initialize: vi.fn(), getStats: vi.fn(), evictLRU: vi.fn(), clearAll: vi.fn() },
    });
    const id = await svc.importTrack(TRACK, 'space-1');
    expect(id).toBeTruthy();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toContain('Sunny');
    expect(saved[0].sourceType).toBe('import');
    expect(saved[0].sourceId).toBe('t1');
    expect(saved[0].tags).toContain('CC-BY');
  });

  it('FMA 适配器：API 失败归一化为 MusicLibraryUnavailableError', async () => {
    const failingFetch = vi.fn(async () => { throw new TypeError('network down'); });
    const adapter = new FreeMusicArchiveAdapter(failingFetch as never);
    await expect(adapter.search({ keyword: 'x' })).rejects.toBeInstanceOf(MusicLibraryUnavailableError);
  });

  it('FMA 适配器：解析合法负载为 MusicTrack[]', async () => {
    const okFetch = vi.fn(async () => new Response(JSON.stringify({
      tracks: [{ track_id: '1', track_title: 'A', artist_name: 'B', track_duration: '90', track_genres: 'Rock', track_license: 'CC0' }],
    }), { status: 200 }));
    const adapter = new FreeMusicArchiveAdapter(okFetch as never);
    const result = await adapter.search({});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: '1', title: 'A', artist: 'B', durationSec: 90, genre: 'Rock', license: 'CC0' });
  });
});
