/**
 * P0-4 资产沉淀：AssetLibraryService.saveBgmFromBlob / queryBgms / deleteBgm
 *
 * 覆盖：
 * - saveBgmFromBlob：Blob 落 OPFS + 元数据入 savedBgms（含 prompt/durationSec/audioBlobKey）
 * - queryBgms 透传仓库查询
 * - deleteBgm：删 Blob + 删文件记录 + 删元数据
 */
import { describe, it, expect, vi } from 'vitest';
import { AssetLibraryService } from '../../domain/services/AssetLibraryService';
import type { SavedBgm } from '../../domain/entities/models';
import type { ISavedImageRepository, ISavedVoiceRepository, ISavedPromptRepository, ISavedVideoRepository, ISavedBgmRepository, AssetQueryParams } from '../../domain/ports/AssetLibraryPorts';
import type { IFileStoragePort, IGeneratedFileRepository } from '../../domain/ports/FileStoragePorts';

function makeDeps() {
  const bgmRepo: ISavedBgmRepository = {
    save: vi.fn(async () => { }),
    getById: vi.fn(async (): Promise<SavedBgm | undefined> => undefined),
    query: vi.fn(async (): Promise<SavedBgm[]> => []),
    delete: vi.fn(async () => { }),
    count: vi.fn(async () => 0),
  };
  const storage: IFileStoragePort = {
    storeBlob: vi.fn(async () => { }),
    getObjectUrl: vi.fn(() => 'blob:mock'),
    deleteBlob: vi.fn(async () => { }),
  } as unknown as IFileStoragePort;
  const fileRepo: IGeneratedFileRepository = {
    save: vi.fn(async () => { }),
    delete: vi.fn(async () => { }),
  } as unknown as IGeneratedFileRepository;
  const svc = new AssetLibraryService(
    {} as ISavedImageRepository,
    {} as ISavedVoiceRepository,
    {} as ISavedPromptRepository,
    {} as ISavedVideoRepository,
    bgmRepo,
    () => storage,
    () => fileRepo,
  );
  return { svc, bgmRepo, storage, fileRepo };
}

function fakeBgm(partial: Partial<SavedBgm> = {}): SavedBgm {
  return {
    id: 'bgm-1',
    spaceId: 'sp-1',
    name: '片头曲',
    prompt: '史诗感弦乐',
    model: 'music-2.6',
    durationSec: 30,
    audioBlobKey: 'audio/bgm_x.mp3',
    tags: [],
    sourceType: 'lab',
    createdAt: 1,
    ...partial,
  };
}

describe('AssetLibraryService — BGM 资产（P0-4）', () => {
  it('saveBgmFromBlob：Blob 落 OPFS 且元数据完整入仓', async () => {
    const { svc, bgmRepo, storage, fileRepo } = makeDeps();
    const blob = new Blob(['audio'], { type: 'audio/mpeg' });
    const saved = await svc.saveBgmFromBlob({
      spaceId: 'sp-1',
      name: '片头曲',
      blob,
      prompt: '史诗感弦乐',
      model: 'music-2.6',
      durationSec: 30,
      sourceType: 'lab',
    });

    expect(storage.storeBlob).toHaveBeenCalledTimes(1);
    expect(fileRepo.save).toHaveBeenCalledTimes(1);
    expect(bgmRepo.save).toHaveBeenCalledTimes(1);
    const item = (bgmRepo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as SavedBgm;
    expect(item.name).toBe('片头曲');
    expect(item.prompt).toBe('史诗感弦乐');
    expect(item.durationSec).toBe(30);
    expect(item.spaceId).toBe('sp-1');
    expect(item.sourceType).toBe('lab');
    expect(item.audioBlobKey).toMatch(/^audio\/bgm_/);
    expect(saved.id).toBe(item.id);
  });

  it('queryBgms 透传仓库查询', async () => {
    const { svc, bgmRepo } = makeDeps();
    (bgmRepo.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeBgm()]);
    const result = await svc.queryBgms({ spaceId: 'sp-1' } as AssetQueryParams);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('片头曲');
  });

  it('deleteBgm：先删 Blob 与文件记录，再删元数据', async () => {
    const { svc, bgmRepo, storage, fileRepo } = makeDeps();
    (bgmRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeBgm());
    await svc.deleteBgm('bgm-1');
    expect(storage.deleteBlob).toHaveBeenCalledWith('audio/bgm_x.mp3');
    expect(fileRepo.delete).toHaveBeenCalledWith('file_bgm-1');
    expect(bgmRepo.delete).toHaveBeenCalledWith('bgm-1');
  });

  it('deleteBgm：记录不存在时静默跳过', async () => {
    const { svc, bgmRepo, storage } = makeDeps();
    (bgmRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await svc.deleteBgm('nope');
    expect(storage.deleteBlob).not.toHaveBeenCalled();
  });
});
