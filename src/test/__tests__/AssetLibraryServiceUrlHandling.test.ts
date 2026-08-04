/**
 * AssetLibraryService.saveImageFromUrl 单元测试 —— 验证不再 fetch 外部 URL
 *
 * 背景：
 *   此前 saveImageFromUrl 总是调用 fetch(imageUrl)，导致 OSS 等 CORS-阻断的
 *   URL 直接抛 "Failed to fetch" 错误。修复后：
 *   - data URI → 直接 atob 解码为 Blob，无任何 fetch
 *   - blob: URL → 抛错（blob: 仅在当前会话内有效）
 *   - http(s) URL → 尝试 fetch，失败时抛带 cause 的明确错误
 *
 * 通过 mock IFileStoragePort + ISavedImageRepository 验证：
 *   1. data:image/png;base64,AAA... 可以成功保存为 Blob
 *   2. data URI 解码后的 Blob 内容正确（不是 fetch 拿到的）
 *   3. CORS-blocked URL 会抛错（且不会经过 fetch 之前的路径）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetLibraryService } from '../../domain/services/AssetLibraryService';
import type { ISavedImageRepository, ISavedVoiceRepository, ISavedPromptRepository, ISavedVideoRepository } from '../../domain/ports/AssetLibraryPorts';
import type { IFileStoragePort, IGeneratedFileRepository } from '../../domain/ports/FileStoragePorts';
import type { IHttpFetchPort } from '../../domain/ports/CrossCuttingPorts';
import type { SavedImage, GeneratedFile } from '../../domain/entities/models';

class MockFileStorage implements IFileStoragePort {
  stored = new Map<string, Blob>();
  async initialize(): Promise<void> {}
  async storeBlob(path: string, blob: Blob): Promise<void> { this.stored.set(path, blob); }
  async getBlob(path: string): Promise<Blob | null> { return this.stored.get(path) ?? null; }
  async deleteBlob(path: string): Promise<void> { this.stored.delete(path); }
  async blobExists(path: string): Promise<boolean> { return this.stored.has(path); }
  async getObjectUrl(path: string): Promise<string> { return `mock://${path}`; }
  revokeObjectUrl(): void {}
  async getStats() {
    return {
      totalSize: 0, totalFiles: 0,
      byType: { image: { count: 0, size: 0 }, audio: { count: 0, size: 0 }, video: { count: 0, size: 0 }, other: { count: 0, size: 0 } },
      maxCapacity: Number.MAX_SAFE_INTEGER,
    };
  }
  async evictLRU() { return 0; }
  async clearAll() { this.stored.clear(); }
  isAvailable() { return true; }
  getStorageType() { return 'local' as const; }
}

class MockImageRepo implements ISavedImageRepository {
  saved: SavedImage[] = [];
  async save(img: SavedImage): Promise<void> { this.saved.push(img); }
  async getById(id: string) { return this.saved.find(s => s.id === id); }
  async delete(id: string): Promise<void> { this.saved = this.saved.filter(s => s.id !== id); }
  async query() { return this.saved; }
  async count() { return this.saved.length; }
  async update() {}
}

class MockFileRepo implements IGeneratedFileRepository {
  saved: GeneratedFile[] = [];
  async save(f: GeneratedFile): Promise<void> { this.saved.push(f); }
  async getById(id: string) { return this.saved.find(f => f.id === id); }
  async query() { return this.saved; }
  async delete(id: string): Promise<void> { this.saved = this.saved.filter(f => f.id !== id); }
  async findByPath(p: string) { return this.saved.find(f => f.storagePath === p); }
  async count() { return this.saved.length; }
  async getTotalSize() { return 0; }
  async findLeastRecentlyUsed() { return []; }
  async touchAccessTime() {}
}

const mockVoiceRepo: ISavedVoiceRepository = {} as ISavedVoiceRepository;
const mockPromptRepo: ISavedPromptRepository = {} as ISavedPromptRepository;
const mockVideoRepo: ISavedVideoRepository = {} as ISavedVideoRepository;

describe('AssetLibraryService.saveImageFromUrl —— data URI 处理（绕过 CORS）', () => {
  let service: AssetLibraryService;
  let storage: MockFileStorage;
  let imgRepo: MockImageRepo;

  beforeEach(() => {
    storage = new MockFileStorage();
    imgRepo = new MockImageRepo();
    service = new AssetLibraryService(
      imgRepo, mockVoiceRepo, mockPromptRepo, mockVideoRepo,
      storage,
      new MockFileRepo(),
      { fetchBlob: vi.fn(), fetchText: vi.fn(), fetchJson: vi.fn() },
    );
  });

  it('data:image/png;base64 成功解码为 Blob 并写入 fileStorage', async () => {
    // 1x1 PNG base64
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const dataUri = `data:image/png;base64,${pngBase64}`;

    const saved = await service.saveImageFromUrl({
      spaceId: 'space-1',
      name: 'test.png',
      imageUrl: dataUri,
      prompt: 'test prompt',
      model: 'test-model',
      aspectRatio: '1:1',
      sourceType: 'lab',
    });

    expect(saved.name).toBe('test.png');
    expect(imgRepo.saved.length).toBe(1);
    expect(storage.stored.size).toBe(1);
    const storedBlob = Array.from(storage.stored.values())[0];
    expect(storedBlob.type).toBe('image/png');
    // atob 出来的字节长度应该是 pngBase64 解码后的长度
    const expectedBytes = atob(pngBase64).length;
    expect(storedBlob.size).toBe(expectedBytes);
  });

  it('data:image/jpeg 也能正确识别 mime', async () => {
    // 真实有效的 1x1 JPEG base64（67 字节，标准 SOI/EOI 标记）
    const jpegBase64 = '/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==';
    const dataUri = `data:image/jpeg;base64,${jpegBase64}`;

    await service.saveImageFromUrl({
      spaceId: 'space-1',
      name: 't.jpg',
      imageUrl: dataUri,
      prompt: 'p',
      model: 'm',
      aspectRatio: '1:1',
      sourceType: 'lab',
    });

    const blob = Array.from(storage.stored.values())[0];
    expect(blob.type).toBe('image/jpeg');
  });

  it('非法的 data URI 会抛错（不静默）', async () => {
    await expect(service.saveImageFromUrl({
      spaceId: 's',
      name: 't',
      imageUrl: 'data:invalid_uri_no_comma',
      prompt: 'p',
      model: 'm',
      aspectRatio: '1:1',
      sourceType: 'lab',
    })).rejects.toThrow(/不是合法的 data URI/);
  });

  it('blob: URL 抛错（提示应改用 saveImageFromBlob）', async () => {
    await expect(service.saveImageFromUrl({
      spaceId: 's',
      name: 't',
      imageUrl: 'blob:http://localhost/abc-123',
      prompt: 'p',
      model: 'm',
      aspectRatio: '1:1',
      sourceType: 'lab',
    })).rejects.toThrow(/blob: URL/);
  });

  it('未识别的协议抛错', async () => {
    await expect(service.saveImageFromUrl({
      spaceId: 's',
      name: 't',
      imageUrl: 'ftp://example.com/image.png',
      prompt: 'p',
      model: 'm',
      aspectRatio: '1:1',
      sourceType: 'lab',
    })).rejects.toThrow(/无法识别/);
  });
});

describe('AssetLibraryService.saveImageFromUrl -- 外部 URL 失败时包装根因', () => {
  let service: AssetLibraryService;
  let storage: MockFileStorage;
  let httpFetch: IHttpFetchPort;

  beforeEach(() => {
    storage = new MockFileStorage();
    httpFetch = {
      fetchBlob: vi.fn(),
      fetchText: vi.fn(),
      fetchJson: vi.fn(),
    };
    service = new AssetLibraryService(
      new MockImageRepo(), mockVoiceRepo, mockPromptRepo, mockVideoRepo,
      storage,
      new MockFileRepo(),
      httpFetch,
    );
  });

  it('外部 URL fetch 失败时抛带 CORS 提示的错误（含 cause）', async () => {
    (httpFetch.fetchBlob as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(service.saveImageFromUrl({
        spaceId: 's',
        name: 't',
        imageUrl: 'https://hailuo-image-algeng-data.oss-cn-wulanchabu.aliyuncs.com/x.png',
        prompt: 'p',
        model: 'm',
        aspectRatio: '1:1',
        sourceType: 'lab',
      })).rejects.toThrow(/CORS/);
  });

  it('外部 URL HTTP 错误时抛带状态码的错误', async () => {
    (httpFetch.fetchBlob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('HTTP 403'));

    await expect(service.saveImageFromUrl({
        spaceId: 's',
        name: 't',
        imageUrl: 'https://example.com/x.png',
        prompt: 'p',
        model: 'm',
        aspectRatio: '1:1',
        sourceType: 'lab',
      })).rejects.toThrow(/HTTP 403/);
  });
});

describe('AssetLibraryService.saveImageFromBlob（基础流程回归）', () => {
  it('直接传入 Blob 不走任何 URL 解析', async () => {
    const storage = new MockFileStorage();
    const imgRepo = new MockImageRepo();
    const service = new AssetLibraryService(
      imgRepo, mockVoiceRepo, mockPromptRepo, mockVideoRepo,
      storage, new MockFileRepo(),
      { fetchBlob: vi.fn(), fetchText: vi.fn(), fetchJson: vi.fn() },
    );

    const blob = new Blob(['hello'], { type: 'image/png' });
    const saved = await service.saveImageFromBlob({
      spaceId: 's',
      name: 'direct.png',
      blob,
      prompt: 'p',
      model: 'm',
      aspectRatio: '1:1',
      sourceType: 'lab',
    });

    expect(saved.name).toBe('direct.png');
    expect(storage.stored.size).toBe(1);
    const stored = Array.from(storage.stored.values())[0];
    expect(stored.size).toBe(5);
  });
});