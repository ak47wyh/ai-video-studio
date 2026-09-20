import { describe, it, expect, vi } from 'vitest';
import { AssetLibraryService } from '../../domain/services/AssetLibraryService';
import type { SavedImage, SavedVoice, SavedPrompt, SavedVideo, SavedBgm } from '../../domain/entities/models';
import type { ISavedImageRepository, ISavedVoiceRepository, ISavedPromptRepository, ISavedVideoRepository, ISavedBgmRepository } from '../../domain/ports/AssetLibraryPorts';
import type { IFileStoragePort, IGeneratedFileRepository } from '../../domain/ports/FileStoragePorts';

function makeRepo<T extends { id: string }>() {
  const store = new Map<string, T>();
  return {
    store,
    repo: {
      save: vi.fn(async (item: T) => { store.set(item.id, item); }),
      getById: vi.fn(async (id: string) => store.get(id)),
      query: vi.fn(async () => Array.from(store.values())),
      delete: vi.fn(async (id: string) => { store.delete(id); }),
      count: vi.fn(async () => store.size),
    },
  };
}

function makeSvc(over: { image?: typeof makeRepo<SavedImage> extends () => infer R ? R : never } = {}) {
  const image = makeRepo<SavedImage>();
  const voice = makeRepo<SavedVoice>();
  const prompt = makeRepo<SavedPrompt>();
  const video = makeRepo<SavedVideo>();
  const bgm = makeRepo<SavedBgm>();
  const storage = {} as unknown as IFileStoragePort;
  const fileRepo = {} as unknown as IGeneratedFileRepository;
  const svc = new AssetLibraryService(
    image.repo as unknown as ISavedImageRepository,
    voice.repo as unknown as ISavedVoiceRepository,
    prompt.repo as unknown as ISavedPromptRepository,
    video.repo as unknown as ISavedVideoRepository,
    bgm.repo as unknown as ISavedBgmRepository,
    () => storage,
    () => fileRepo,
  );
  void over;
  return { svc, image, voice, prompt, video, bgm };
}

describe('AssetLibraryService P3-5：统一资产中心（重命名/归档）', () => {
  it('renameAsset：名称 trim 后落库，空白名称拒绝', async () => {
    const { svc, image } = makeSvc();
    image.store.set('img1', { id: 'img1', name: '旧名' } as SavedImage);
    await svc.renameAsset('image', 'img1', '  新名字  ');
    expect(image.store.get('img1')?.name).toBe('新名字');
    await expect(svc.renameAsset('image', 'img1', '   ')).rejects.toThrow('Asset name required');
  });

  it('renameAsset：资产不存在时报错', async () => {
    const { svc } = makeSvc();
    await expect(svc.renameAsset('voice', 'nope', 'x')).rejects.toThrow('Asset not found');
  });

  it('setAssetArchived：archived 落库并保留其他字段', async () => {
    const { svc, bgm } = makeSvc();
    bgm.store.set('b1', { id: 'b1', name: 'BGM A' } as SavedBgm);
    await svc.setAssetArchived('bgm', 'b1', true);
    expect(bgm.store.get('b1')).toMatchObject({ id: 'b1', name: 'BGM A', archived: true });
    await svc.setAssetArchived('bgm', 'b1', false);
    expect(bgm.store.get('b1')?.archived).toBe(false);
  });

  it('五类 kind 均可路由（image/voice/prompt/video/bgm）', async () => {
    const { svc, image, voice, prompt, video, bgm } = makeSvc();
    image.store.set('i', { id: 'i', name: 'a' } as SavedImage);
    voice.store.set('v', { id: 'v', name: 'a' } as SavedVoice);
    prompt.store.set('p', { id: 'p', name: 'a' } as SavedPrompt);
    video.store.set('vd', { id: 'vd', name: 'a' } as SavedVideo);
    bgm.store.set('b', { id: 'b', name: 'a' } as SavedBgm);
    for (const kind of ['image', 'voice', 'prompt', 'video', 'bgm'] as const) {
      await expect(svc.setAssetArchived(kind, kind === 'image' ? 'i' : kind === 'voice' ? 'v' : kind === 'prompt' ? 'p' : kind === 'video' ? 'vd' : 'b', true)).resolves.toBeUndefined();
    }
  });
});
